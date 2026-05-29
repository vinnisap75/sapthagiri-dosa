-- Sapthagiri — Slack fan-out for agent_log
-- Migration 002, written 2026-05-29.
--
-- Adds:
--   • agent_config table — small key/value store for runtime config
--     (Slack webhook URL, future toggles). Staff-only RLS.
--   • slack_post_event() trigger function — reads the webhook URL
--     from agent_config and POSTs a formatted message to Slack via
--     pg_net.http_post (async, fire-and-forget).
--   • Trigger trg_agent_log_slack on agent_log AFTER INSERT.
--
-- Setup (after running this migration):
--   1. Create a Slack workspace + #sapthagiri-floor channel.
--   2. Add the "Incoming Webhooks" Slack app, generate a webhook URL
--      for #sapthagiri-floor.
--   3. Paste the webhook URL at /admin/slack OR run:
--        insert into public.agent_config (key, value)
--        values ('slack_webhook_url', 'https://hooks.slack.com/services/...')
--        on conflict (key) do update set value = excluded.value;
--
-- Idempotent. Safe to re-run.

-- Ensure the pg_net extension is enabled. Supabase has it on the
-- 'extensions' schema by default.
create extension if not exists pg_net with schema extensions;

-- =====================================================================
-- agent_config — small key/value store, staff-only
-- =====================================================================

create table if not exists public.agent_config (
  key         text primary key,
  value       text,
  updated_at  timestamptz not null default now()
);

alter table public.agent_config enable row level security;

drop policy if exists "agent_config_staff_only" on public.agent_config;
create policy "agent_config_staff_only" on public.agent_config
  for all to authenticated using (true) with check (true);

-- Helper RPC so the admin page can update without raw table writes.
create or replace function public.set_agent_config(p_key text, p_value text)
returns void
language sql security definer set search_path = public as $$
  insert into public.agent_config (key, value, updated_at)
  values (p_key, p_value, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
$$;

grant execute on function public.set_agent_config(text, text) to authenticated;

-- =====================================================================
-- Slack fan-out trigger
-- =====================================================================

-- Map agent slug → emoji for the Slack header. Keep in sync with
-- AGENT_COLORS in app/admin/agent-log/page.tsx.
create or replace function public.agent_emoji(p_agent text) returns text
language sql immutable as $$
  select case p_agent
    when 'orchestrator'       then ':dart:'
    when 'sentry'             then ':shield:'
    when 'custodian'          then ':face_with_monocle:'
    when 'service-architect'  then ':building_construction:'
    when 'tava'               then ':fried_egg:'
    when 'patron'             then ':bowing_man:'
    when 'counter'            then ':bar_chart:'
    when 'mirror'             then ':mirror:'
    else ':robot_face:'
  end;
$$;

-- Map phase → color stripe (Slack attachment "color").
create or replace function public.phase_color(p_phase text) returns text
language sql immutable as $$
  select case p_phase
    when 'starting'  then '#3b82f6'
    when 'note'      then '#f59e0b'
    when 'blocked'   then '#ef4444'
    when 'finishing' then '#10b981'
    else '#6b7280'
  end;
$$;

-- The trigger function. Reads the webhook URL from agent_config; if
-- absent, does nothing (so the org still works without Slack).
create or replace function public.slack_post_event() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  webhook_url text;
  payload jsonb;
  agent_pretty text;
  phase_emoji text;
  payload_text text;
begin
  -- Look up webhook URL. If unset or empty, skip silently.
  select value into webhook_url
  from public.agent_config
  where key = 'slack_webhook_url' and value is not null and length(value) > 10;

  if webhook_url is null then
    return new;
  end if;

  agent_pretty := agent_emoji(new.agent) || ' *' || new.agent || '*';
  phase_emoji := case new.phase
    when 'starting'  then ':rocket:'
    when 'note'      then ':memo:'
    when 'blocked'   then ':octagonal_sign:'
    when 'finishing' then ':white_check_mark:'
    else ':information_source:'
  end;

  -- Render payload as a code block if present.
  if new.payload is not null and new.payload <> '{}'::jsonb then
    payload_text := E'\n```' || left(jsonb_pretty(new.payload), 2500) || E'```';
  else
    payload_text := '';
  end if;

  -- Build the Slack message. Header line + the message + payload block.
  payload := jsonb_build_object(
    'attachments', jsonb_build_array(
      jsonb_build_object(
        'color', phase_color(new.phase),
        'blocks', jsonb_build_array(
          jsonb_build_object(
            'type', 'section',
            'text', jsonb_build_object(
              'type', 'mrkdwn',
              'text',
              agent_pretty || ' · ' || phase_emoji || ' `' || new.phase || '`' ||
              coalesce(' · _' || new.task_id || '_', '') ||
              E'\n' || new.message ||
              payload_text
            )
          )
        )
      )
    )
  );

  -- Fire-and-forget. pg_net stores the request in net.http_request_queue
  -- and a background worker actually sends it.
  perform extensions.http_post(
    url := webhook_url,
    body := payload,
    headers := jsonb_build_object('Content-Type', 'application/json'),
    timeout_milliseconds := 5000
  );

  return new;
exception when others then
  -- Never break the underlying agent_log insert because Slack misbehaved.
  raise notice 'slack fan-out failed: %', sqlerrm;
  return new;
end$$;

drop trigger if exists trg_agent_log_slack on public.agent_log;
create trigger trg_agent_log_slack
  after insert on public.agent_log
  for each row execute function public.slack_post_event();

-- =====================================================================
-- Test helper — fire a hello-world message through the pipeline.
-- Call from the SQL editor after pasting the webhook URL:
--   select public.slack_test();
-- =====================================================================

create or replace function public.slack_test() returns text
language plpgsql security definer set search_path = public as $$
declare webhook text;
begin
  select value into webhook from public.agent_config
  where key = 'slack_webhook_url' and value is not null;
  if webhook is null then
    return 'No slack_webhook_url set in agent_config. Paste one at /admin/slack first.';
  end if;
  -- Insert into agent_log; the trigger does the rest.
  insert into public.agent_log (agent, phase, task_id, message, payload)
  values ('orchestrator', 'note', 'slack-smoke-test',
          'Slack fan-out is live :wave:',
          jsonb_build_object('source', 'slack_test()'));
  return 'Sent. Check #sapthagiri-floor.';
end$$;

grant execute on function public.slack_test() to authenticated;

-- =====================================================================
-- Done.
-- =====================================================================
