# Sapthagiri iMessage daemon

A tiny launchd-managed Python script that polls the Supabase `notifications`
table every 30 seconds and sends pending iMessages via the Messages.app
AppleScript bridge. Free, no third-party SaaS, no extra phone number.

Once installed, any agent (the orchestrator, Sentry, scheduled tasks, a
future Dankum) can text Vinni by inserting a single row.

## How it fits together

```
  any agent          Supabase                Vinni's Mac
  ─────────          ────────                ───────────
  log_agent_event  ──▶ agent_log     (cross-agent context)

  queue_notification ─▶ notifications ─poll(30s)─▶ poll.py
                                                       │
                                                       ▼
                                                  Messages.app
                                                       │
                                                       ▼
                                                  Vinni 📱
```

## Files in this folder

| File | Purpose |
|---|---|
| `poll.py` | The daemon. Stdlib-only Python 3. Reads `notifications` via REST, sends iMessage via osascript, marks `delivered_at`. |
| `com.sapthagiri.imessage.plist.template` | launchd plist with `__HOME__` placeholder; the installer renders it. |
| `install.sh` | One-shot installer — config prompts, copies files, loads the launch agent, sends a hello ping. |
| `README.md` | This file. |

## Prerequisites

1. macOS with Messages.app signed into iMessage.
2. Supabase migration `001_security_hardening.sql` applied (creates the
   `notifications` table + `queue_notification` RPC).
3. Your **service-role key** from Supabase → Settings → API. This bypasses
   RLS so the daemon can mark rows delivered. It stays local — chmod 600 in
   `~/.sapthagiri/env`. **Never commit it.**
4. Your iMessage recipient — phone number with country code (e.g.
   `+12015551234`) or Apple ID email.

## Install

```sh
cd scripts/imessage-daemon
./install.sh
```

You'll get an iMessage within ~30 seconds confirming install.

## Queue a message from anywhere

Any authenticated client can call the RPC:

```sql
select queue_notification(
  'imessage',
  '+12015551234',           -- recipient (null → daemon falls back to default)
  'Sapthagiri',             -- title
  'Kitchen ready to test — sapthagiribuffet.vercel.app',
  'orchestrator'            -- source agent
);
```

From JS:

```js
await supabase.rpc('queue_notification', {
  p_kind: 'imessage',
  p_recipient: '+12015551234',
  p_title: 'Sapthagiri',
  p_body: 'Order at Table A3 is overdue (12m)',
  p_source: 'tava',
});
```

## Logs

- `~/.sapthagiri/poll.log` — every successful send
- `~/.sapthagiri/poll.err` — errors

## Uninstall

```sh
launchctl unload ~/Library/LaunchAgents/com.sapthagiri.imessage.plist
rm ~/Library/LaunchAgents/com.sapthagiri.imessage.plist
rm -rf ~/.sapthagiri
```

## Security notes

- The service-role key in `~/.sapthagiri/env` is the highest-privilege
  Supabase key. It MUST stay local and NEVER ship to the browser or to git.
  The installer chmods the file 600.
- The plist runs as your user, not root.
- Messages.app on first daemon run will prompt macOS for automation
  permission — click Allow once.
- If the recipient column on a queued row is null, the daemon falls back to
  the `IMESSAGE_RECIPIENT` in `~/.sapthagiri/env`.

## Why not sendblue.io / Twilio?

Both work but cost money and depend on a third party. The local daemon is
free, private, and uses the Mac you already own. Tradeoff: needs the Mac
awake + Messages.app signed in. If Vinni's Mac is asleep, messages queue
in the table and deliver when it wakes.

For a true 24/7 always-on bridge later, swap `poll.py` for a sendblue call
and host on Vercel cron — same `notifications` table contract, no other
changes.
