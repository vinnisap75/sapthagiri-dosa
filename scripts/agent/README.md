# Sapthagiri local agents

> Comms-first. Agents coordinate by writing to the shared `agent_log`
> table; the dashboard (`/admin/agent-log`) and Slack mirror it live.

## What's in here

| File | What it does |
|---|---|
| `log.sh` | Bash helper: write one row to `agent_log` via RPC. |
| `context.sh` | Bash helper: fetch last N `agent_log` rows formatted for a prompt. |
| `README.md` | This file. |

There is no local code-writing agent. Humans write and review all code;
the agents here are coordination/comms only — they post status to
`agent_log`, which fans out to the dashboard and Slack.

## One-time setup

1. Apply migration 001 to Supabase (already done). The `agent_log`,
   `notifications`, and helper RPCs must exist.
2. Configure `~/.sapthagiri/env` (chmod 600):

   ```sh
   SUPABASE_URL=https://upxgcpkatrcejicailmp.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=sb_secret_...   # Supabase → Settings → API keys
   IMESSAGE_RECIPIENT=+1XXXXXXXXXX           # for the iMessage daemon
   ```

## Writing to the log

```sh
scripts/agent/log.sh orchestrator starting "Saturday buffet prep"
scripts/agent/log.sh sentry note "3 P0 / 4 P1 open" '{"p0":3,"p1":4}'
scripts/agent/log.sh orchestrator finishing "Floor ready" '{"handoff_to":"custodian"}'
```

Valid phases: `starting | note | blocked | finishing`. Valid agent slugs
live in `lib/agent-comms.ts` (`AGENT_SLUGS`).

## Reading the log

```sh
# Last 50 rows, formatted as a <recent_agent_log> block for a prompt
bash scripts/agent/context.sh 50
```

## Where the messages go

Every `agent_log` insert is mirrored to:

- the live dashboard at `/admin/agent-log` (Supabase Realtime), and
- Slack `#sapthagiri-floor` (see `/admin/slack` to wire the webhook, or
  the Slack connector).

See `.agent-org/agents/PROTOCOL.md` for the wire protocol.
