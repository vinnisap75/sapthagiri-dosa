# Sapthagiri agent communication protocol — v2

> Every sub-agent in the Sapthagiri org follows this protocol.
> v2 adds the tool restriction matrix, worktree convention, branch
> naming rule, and concurrency caps that were missing in v1.

## The one rule

> **Read before you start. Write while you work. Sign off when you
> finish.** Escalate before you guess.

## The shared scratchpad

A single Supabase table — `public.agent_log` — is the org's chat
channel. Every agent reads from it and writes to it.

```sql
agent_log (
  id          uuid           -- row id
  agent       text           -- 'orchestrator', 'sentry', 'custodian', ...
  phase       text           -- 'starting' | 'note' | 'blocked' | 'finishing'
  task_id     text           -- correlation id (matches a TaskCreate id or a fresh slug)
  message     text           -- one-line plain English for humans
  payload     jsonb          -- arbitrary structured data
  created_at  timestamptz
)
```

Two interaction surfaces:

| Language | Helper |
|---|---|
| TypeScript | `import { logEvent, recentEvents } from "@/lib/agent-comms"` |
| Bash | `scripts/agent/log.sh` and `scripts/agent/context.sh` |
| SQL | `select log_agent_event(...)` / `select * from agent_log order by created_at desc limit 20` |

Every row mirrors live to `/admin/agent-log` and (when configured) to
Slack `#sapthagiri-floor`.

## Tool restriction matrix

This table is **load-bearing**. Each agent's prompt MUST match a row
here. If a tool isn't listed for an agent, the agent must refuse to
use it.

| Agent | Read | Edit | Bash | WebFetch | gh CLI | Supabase write | Push to feature branch | Merge to main |
|---|---|---|---|---|---|---|---|---|
| `orchestrator` | ✅ all | ✅ all | ✅ | ✅ | ✅ (no merge) | ✅ via RPC | ✅ | ❌ humans only |
| `sentry` | ✅ all | ⚠ only `.agent-org/SECURITY-AUDIT.md` | ❌ | ⚠ standards docs only | ❌ | ⚠ `agent_log` only | ❌ | ❌ |
| `service-architect` | ✅ all | ⚠ `lib/services.ts`, `lib/menu.ts`, customer-facing routes | ⚠ tsc/build only | ❌ | ⚠ open issues only | ⚠ `agent_log` only | ✅ | ❌ |
| `hammer` | ✅ all | ⚠ files listed in the Issue only | ⚠ tsc/build/test only | ❌ | ⚠ open PR, comment, label | ⚠ `agent_log` only | ✅ | ❌ |
| `custodian` | ✅ all | ❌ (review only) | ❌ | ❌ | ⚠ review state + comment | ⚠ `agent_log` only | ❌ | ❌ |
| `tava` (future) | ⚠ `orders`, `agent_log`, `server_calls` | ❌ | ❌ | ❌ | ❌ | ⚠ `agent_log` + `notifications` only | ❌ | ❌ |
| `patron` (future) | ⚠ `orders`, `agent_log` | ❌ | ❌ | ⚠ Google reviews only | ❌ | ⚠ `agent_log` + `notifications` only | ❌ | ❌ |
| `counter` (future) | ⚠ `orders`, `agent_log` | ❌ | ❌ | ❌ | ❌ | ⚠ `agent_log` + `notifications` only | ❌ | ❌ |
| `mirror` (future) | ⚠ `agent_log` | ❌ | ❌ | ⚠ Google Maps reviews | ❌ | ⚠ `agent_log` + `notifications` only | ❌ | ❌ |

Anything not listed = forbidden. Merging to `main` is ALWAYS a human
click. Branch protection enforces this even if an agent tries.

## Branch naming convention

```
feat/<short-slug>     # new functionality
fix/<short-slug>      # bug fix
chore/<short-slug>    # refactor, dep bumps, docs
agent/<role>/<slug>   # reserved for autonomous agent work
```

- Lowercase kebab-case, ≤ 40 chars.
- One branch per logical change. Don't pack multiple Issues into one.
- Never push directly to `main` — branch protection rejects it.

## Worktree convention

When an agent needs to clone or sync the repo (e.g. for a push), it
uses a dedicated worktree path. **Never share worktrees across
parallel agents** — they will stomp on each other's HEAD.

```sh
git worktree add .agent-org/worktrees/<role>-<task_id>/ -b <branch> origin/main
```

After the run, the orchestrator (or the agent itself if safe) removes
the worktree:

```sh
git worktree remove .agent-org/worktrees/<role>-<task_id>/
```

`.agent-org/worktrees/` is gitignored.

## Concurrency caps

- ≤ **3 PRs per night** from agents combined. More than that = too
  many things to review tomorrow.
- ≤ **2 agents writing files in parallel**. (Read-only agents have no
  cap.) If a third needs to write, the orchestrator queues it.
- Only **1 orchestrator session** at a time. If a second Cowork
  session opens, it reads `docs/SESSION_HANDOFF.md` and `agent_log`,
  then either picks up where the first left off or hard-aborts.

## The 5-step protocol

### 1. Before you start: read the last 20 rows

```ts
const recent = await recentEvents(20);
```

Or `bash scripts/agent/context.sh 20`. The orchestrator passes these
into your prompt as `<recent_agent_log>`. If you wake up without
context, fetch it yourself.

### 2. Write a `starting` row

```ts
await logEvent({
  agent: "<your-slug>",
  phase: "starting",
  task_id: "<correlation-id>",
  message: "<one line: what you're doing + why>",
  payload: { /* PR number, file paths, etc. */ },
});
```

### 3. Write `note` rows for anything non-obvious

Log surprises and hand-off-worthy context. Don't log "running tsc."

### 4. Write a `blocked` row when you stop on a dependency

```ts
await logEvent({
  agent: "<your-slug>",
  phase: "blocked",
  task_id: "<...>",
  message: "Need a Supabase service-role key in Vercel env to test the daemon path",
  payload: { mentions: ["orchestrator"], unblocker: "set SUPABASE_SERVICE_ROLE_KEY in Vercel" },
});
```

Then stop. Don't work around the block — that's how silent
divergence happens. If the decision is yours but ambiguous, file in
`docs/AGENT_QUESTIONS.md` instead.

### 5. Write a `finishing` row when you're done

Always. Even if you produced nothing.

```ts
await logEvent({
  agent: "<your-slug>",
  phase: "finishing",
  task_id: "<...>",
  message: "<one line: what you shipped + verdict>",
  payload: {
    files_touched: [...],
    outcome: "shipped" | "no_change" | "blocked",
    handoff_to: "custodian" | null,
  },
});
```

## Mentions

`payload.mentions = ["custodian"]` is a structured "@" — surfaces to
the orchestrator for routing. Use sparingly: only when a specific
other agent actually needs to see this.

## Hard "no" list (refuse on principle)

- ❌ Commit a secret (anon JWT is fine; service-role key, GH PAT,
   Stripe key, etc. is not). The CI scan blocks these too — don't
   test it.
- ❌ Push to `main` directly.
- ❌ `git push --force`, `git push --force-with-lease`, `git commit
   --amend` on a published commit.
- ❌ `git commit --no-verify` to skip hooks.
- ❌ `git rebase -i` on a published branch.
- ❌ `DROP TABLE`, `TRUNCATE`, or `DELETE FROM` without a `WHERE`.
- ❌ Mock the database in integration tests.
- ❌ Disable RLS, branch protection, CI required checks, or
   CODEOWNERS — even temporarily — without a row in
   `docs/AGENT_QUESTIONS.md` answered first.
- ❌ Add a new `package.json` dependency without an
   `docs/AGENT_QUESTIONS.md` entry.
- ❌ Auto-merge own PR (agents file PRs; humans merge).

## Setup checklist (one-time, per new agent)

1. Add a row to the matrix above.
2. Add a row to the roster in `docs/agents/<SLUG>.md`.
3. Add the slug to `lib/agent-comms.ts` `AGENT_SLUGS`.
4. Add the emoji to `agent_emoji()` in
   `supabase/migrations/002_slack_fanout.sql` (write a follow-up
   migration; don't edit a merged one).
5. Dry-run the agent 3 times before relying on its output.

## How a typical day looks

```
07:00  orchestrator (note) "Service window starts in 1h, no overnight failures"
07:05  tava (starting) "Kitchen pre-flight check"
07:06  tava (finishing) "All green; ratings table empty as expected"
08:14  patron (note) "Table A3 server_call sat unresolved for 5min"
08:15  orchestrator (note) "Pinged Vinni via iMessage about A3"
10:32  service-architect (starting) "Adding Thursday lunch window"
10:45  service-architect (blocked) "Need a copy on closed-page CTA — Q in AGENT_QUESTIONS"
11:00  orchestrator (note) "Sree answered Q12 — proceed with 'See you Wednesday'"
11:47  service-architect (finishing) "Window live, handoff_to: custodian"
11:48  custodian (starting) "Reviewing PR #14"
11:55  custodian (finishing) "Approved — 1 minor a11y note, non-blocking"
```

The org stays in sync without anyone chasing status.
