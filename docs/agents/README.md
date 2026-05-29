# Sapthagiri agents — index

The org's roles, in one place. Read `PROTOCOL.md` first.

| File | Slug | Spawn frequency | Status |
|---|---|---|---|
| [`PROTOCOL.md`](./PROTOCOL.md) | — | — | The contract every agent extends |
| [`ORCHESTRATOR.md`](./ORCHESTRATOR.md) | `orchestrator` | Per Cowork session | Active |
| [`SENTRY.md`](./SENTRY.md) | `sentry` | On demand | Ran once 2026-05-29 |
| [`SERVICE_ARCHITECT.md`](./SERVICE_ARCHITECT.md) | `service-architect` | On demand | Ran once 2026-05-29 |
| [`HAMMER.md`](./HAMMER.md) | `hammer` | Per Issue | Spec only — needs an autonomous runtime |
| [`CUSTODIAN.md`](./CUSTODIAN.md) | `custodian` | Per PR | Spec only — wire to webhook later |

## Adding a new agent

1. Add a row to this table.
2. Add a row to the matrix in `PROTOCOL.md` "Tool restriction matrix".
3. Add the slug to `lib/agent-comms.ts` `AGENT_SLUGS`.
4. Add the emoji to `agent_emoji()` in a NEW migration (don't edit
   an existing one).
5. Write the agent's `.md` here with: role, tool row, MAY WRITE,
   MUST NOT WRITE, hard rules, workflow, acceptance criteria,
   anti-patterns.
6. Dry-run the agent 3 times before relying on its output.
7. Open the agent's first real Issue tagged `agent:<slug>`.

## What lives where

| Surface | What it holds |
|---|---|
| `docs/agents/*.md` | Per-agent prompts (committed, public) |
| `docs/PLAN.md` | Phased roadmap. Agents pick from here. |
| `docs/AGENT_QUESTIONS.md` | Open escalations. Agents append, Sree answers. |
| `docs/NIGHT_LOG/<date>.md` | Per-session retro + what shipped. |
| `.agent-org/SECURITY-AUDIT.md` | Sentry's findings (gitignored — may contain redacted secrets) |
| `.agent-org/HANDOFF.md` | Orchestrator's ops state (gitignored — has PAT refs etc.) |
| `.agent-org/worktrees/` | Runtime worktrees (gitignored) |
| Supabase `agent_log` table | Live chat between agents |
| `/admin/agent-log` | Live UI mirror |
| Slack `#sapthagiri-floor` | Live Slack mirror (once webhook is pasted) |
| `/admin/slack` | Webhook config UI |
