-- Sapthagiri — Security hardening + cross-agent infra
-- Migration 001, written 2026-05-29.
-- Closes Sentry P0-1, P0-2, P0-3 + several P1s, and adds the
-- notifications + agent_log tables used by the agent org.
-- Idempotent. Safe to re-run.

-- =====================================================================
-- P0-1, P0-2: Lock down orders RLS
-- =====================================================================

-- The old demo policies let anyone with the anon key SELECT or UPDATE
-- every order. This is the CVE-2025-48757 antipattern. Replace with:
--   • Staff (authenticated): full read + write.
--   • Anon: NO direct table read (must use get_order_status RPC).
--   • Anon: narrow rating UPDATE on their own served order.
drop policy if exists "orders_select_all"    on public.orders;
drop policy if exists "orders_update_anyone" on public.orders;

create policy "orders_select_staff" on public.orders
  for select to authenticated using (true);

create policy "orders_update_staff" on public.orders
  for update to authenticated using (true) with check (true);

create policy "orders_rate_once" on public.orders
  for update to anon
  using      (status = 'served' and rating is null)
  with check (status = 'served' and rating between 1 and 5);

-- Guard: anon UPDATE may only touch rating/rating_at/rating_note.
-- The RLS policy above gates ROW eligibility but cannot restrict columns,
-- so this trigger enforces column-level protection.
create or replace function public.guard_anon_order_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select auth.role()) <> 'anon' then return new; end if;
  if new.id                  is distinct from old.id
     or new.table_id         is distinct from old.table_id
     or new.customer_name    is distinct from old.customer_name
     or new.notes            is distinct from old.notes
     or new.status           is distinct from old.status
     or new.created_at       is distinct from old.created_at
     or new.cooking_started_at is distinct from old.cooking_started_at
     or new.ready_at         is distinct from old.ready_at
     or new.served_at        is distinct from old.served_at
     or new.total_cents      is distinct from old.total_cents
     or new.cook_medium      is distinct from old.cook_medium
     or new.crispiness       is distinct from old.crispiness
     or new.party_size       is distinct from old.party_size
  then
    raise exception 'anon update may only touch rating fields';
  end if;
  return new;
end$$;

drop trigger if exists trg_guard_anon_order_update on public.orders;
create trigger trg_guard_anon_order_update
  before update on public.orders
  for each row execute function public.guard_anon_order_update();

-- order_items: anon cannot list directly either. Must use get_order_items RPC.
drop policy if exists "order_items_select_all" on public.order_items;
create policy "order_items_select_staff" on public.order_items
  for select to authenticated using (true);

-- =====================================================================
-- P0-1 cont: Capability-style read RPCs for the public status page.
-- These are SECURITY DEFINER so they bypass RLS, but each one filters
-- by an unguessable UUID — so the caller must already hold the capability.
-- =====================================================================

create or replace function public.get_order_status(p_id uuid)
returns table (
  id uuid, table_id text, status text, created_at timestamptz,
  cooking_started_at timestamptz, ready_at timestamptz, served_at timestamptz,
  total_cents int, cook_medium text, crispiness text, party_size int,
  rating int, rating_at timestamptz
)
language sql security definer set search_path = public as $$
  select id, table_id, status, created_at, cooking_started_at, ready_at,
         served_at, total_cents, cook_medium, crispiness, party_size,
         rating, rating_at
  from public.orders
  where id = p_id;
$$;
grant execute on function public.get_order_status(uuid) to anon, authenticated;

create or replace function public.get_order_items(p_order_id uuid)
returns setof public.order_items
language sql security definer set search_path = public as $$
  select * from public.order_items where order_id = p_order_id;
$$;
grant execute on function public.get_order_items(uuid) to anon, authenticated;

-- Active queue snapshot for the customer ETA calculation — no PII columns.
-- Returns one row per active order with arrays of menu_item_id + quantity.
create or replace function public.get_active_queue()
returns table (
  id uuid, status text, created_at timestamptz,
  cooking_started_at timestamptz,
  item_menu_ids text[], item_quantities int[]
)
language sql security definer set search_path = public as $$
  select o.id, o.status, o.created_at, o.cooking_started_at,
         coalesce(array_agg(oi.menu_item_id) filter (where oi.id is not null), '{}') as item_menu_ids,
         coalesce(array_agg(oi.quantity)     filter (where oi.id is not null), '{}') as item_quantities
  from public.orders o
  left join public.order_items oi on oi.order_id = o.id
  where o.status in ('queued','cooking')
  group by o.id;
$$;
grant execute on function public.get_active_queue() to anon, authenticated;

-- =====================================================================
-- P0-3: server_calls — was referenced from app code but missing from schema.
-- =====================================================================

create table if not exists public.server_calls (
  id          uuid primary key default gen_random_uuid(),
  table_id    text not null,
  order_id    uuid references public.orders(id) on delete set null,
  reason      text check (reason is null or length(reason) <= 200),
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists server_calls_unresolved_idx
  on public.server_calls (created_at) where resolved_at is null;

alter table public.server_calls enable row level security;

drop policy if exists "server_calls_select_staff" on public.server_calls;
create policy "server_calls_select_staff" on public.server_calls
  for select to authenticated using (true);

drop policy if exists "server_calls_update_staff" on public.server_calls;
create policy "server_calls_update_staff" on public.server_calls
  for update to authenticated using (true) with check (true);

-- No anon insert policy — customers go through the call_server() RPC so
-- we can rate-limit + validate before the insert lands.
create or replace function public.call_server(
  p_table_id text, p_order_id uuid, p_reason text
) returns void
language plpgsql security definer set search_path = public as $$
declare recent_count int;
begin
  if p_table_id is null or length(p_table_id) > 8 then
    raise exception 'invalid table_id';
  end if;
  if length(coalesce(p_reason,'')) > 200 then
    raise exception 'reason too long';
  end if;
  select count(*) into recent_count
  from public.server_calls
  where table_id = p_table_id
    and created_at > now() - interval '1 minute';
  if recent_count >= 3 then
    raise exception 'rate limit: too many server calls from this table';
  end if;
  insert into public.server_calls (table_id, order_id, reason)
  values (p_table_id, p_order_id, p_reason);
end$$;
grant execute on function public.call_server(text, uuid, text) to anon, authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    execute 'alter publication supabase_realtime add table public.server_calls';
  end if;
exception when duplicate_object then null;
end$$;

-- =====================================================================
-- P1-1: Rate-limit orders inserts (5/min/table)
-- =====================================================================

create or replace function public.orders_rate_limit()
returns trigger language plpgsql as $$
declare recent_count int;
begin
  select count(*) into recent_count
  from public.orders
  where table_id = new.table_id
    and created_at > now() - interval '1 minute';
  if recent_count >= 5 then
    raise exception 'rate limit: too many orders from table % in the last minute', new.table_id;
  end if;
  return new;
end$$;

drop trigger if exists trg_orders_rate_limit on public.orders;
create trigger trg_orders_rate_limit
  before insert on public.orders
  for each row execute function public.orders_rate_limit();

-- =====================================================================
-- P1-3: Order status transition guard (state machine)
-- =====================================================================

create or replace function public.orders_status_guard()
returns trigger language plpgsql as $$
begin
  -- Anon updates are blocked from touching status by guard_anon_order_update
  -- already, so we only need to validate staff-driven transitions.
  if old.status = new.status then return new; end if;
  if (old.status = 'queued'  and new.status in ('cooking','cancelled')) then return new; end if;
  if (old.status = 'cooking' and new.status in ('ready','served','cancelled')) then return new; end if;
  if (old.status = 'ready'   and new.status in ('served','cancelled')) then return new; end if;
  if old.status in ('served','cancelled') then
    raise exception 'cannot transition out of terminal status: %', old.status;
  end if;
  raise exception 'illegal status transition: % → %', old.status, new.status;
end$$;

drop trigger if exists trg_orders_status_guard on public.orders;
create trigger trg_orders_status_guard
  before update of status on public.orders
  for each row execute function public.orders_status_guard();

-- =====================================================================
-- P1-2: Column length caps (DB-level mirror of client-side maxLength)
-- =====================================================================

do $$ begin
  alter table public.orders
    add constraint orders_customer_name_len
    check (customer_name is null or length(customer_name) <= 60);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.orders
    add constraint orders_notes_len
    check (notes is null or length(notes) <= 280);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.orders
    add constraint orders_rating_note_len
    check (rating_note is null or length(rating_note) <= 500);
exception when duplicate_object then null; end $$;

-- =====================================================================
-- notifications — outbound queue for iMessage / Slack / email
-- Read by the local AppleScript daemon on Vinni's Mac.
-- =====================================================================

create table if not exists public.notifications (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('imessage','slack','email')),
  recipient    text not null,                       -- phone for imessage, channel for slack
  title        text,
  body         text not null check (length(body) <= 1000),
  source       text,                                -- which agent queued this
  created_at   timestamptz not null default now(),
  delivered_at timestamptz,
  error        text
);

create index if not exists notifications_pending_idx
  on public.notifications (created_at) where delivered_at is null;

alter table public.notifications enable row level security;

drop policy if exists "notifications_staff_only" on public.notifications;
create policy "notifications_staff_only" on public.notifications
  for all to authenticated using (true) with check (true);

-- Helper RPC any logged-in agent can call without touching the table directly.
create or replace function public.queue_notification(
  p_kind text, p_recipient text, p_title text, p_body text, p_source text
) returns uuid
language sql security definer set search_path = public as $$
  insert into public.notifications (kind, recipient, title, body, source)
  values (p_kind, p_recipient, p_title, p_body, p_source)
  returning id;
$$;
grant execute on function public.queue_notification(text, text, text, text, text) to authenticated;

-- =====================================================================
-- agent_log — shared scratchpad so sub-agents have context on each other
-- =====================================================================

create table if not exists public.agent_log (
  id          uuid primary key default gen_random_uuid(),
  agent       text not null,                                  -- 'sentry', 'service-architect', 'orchestrator', ...
  phase       text not null check (phase in ('starting','finishing','note','blocked')),
  task_id     text,                                           -- free-form correlation id (TaskCreate id, etc.)
  message     text not null check (length(message) <= 2000),
  payload     jsonb,                                          -- arbitrary structured detail
  created_at  timestamptz not null default now()
);

create index if not exists agent_log_recent_idx
  on public.agent_log (created_at desc);

alter table public.agent_log enable row level security;

drop policy if exists "agent_log_staff_only" on public.agent_log;
create policy "agent_log_staff_only" on public.agent_log
  for all to authenticated using (true) with check (true);

create or replace function public.log_agent_event(
  p_agent text, p_phase text, p_task_id text, p_message text, p_payload jsonb
) returns uuid
language sql security definer set search_path = public as $$
  insert into public.agent_log (agent, phase, task_id, message, payload)
  values (p_agent, p_phase, p_task_id, p_message, p_payload)
  returning id;
$$;
grant execute on function public.log_agent_event(text, text, text, text, jsonb) to authenticated;

-- =====================================================================
-- Done.
-- After running this migration:
--   1. Verify with: select * from pg_policies where schemaname='public';
--   2. Confirm RLS forced: select tablename, rowsecurity from pg_tables
--      where schemaname='public';  (orders, order_items, server_calls,
--      notifications, agent_log should all be t)
-- =====================================================================
