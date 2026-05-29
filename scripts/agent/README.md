# Sapthagiri local agents

> Comms-first. Mac stays plugged in + awake; everything else is wired.

## What's in here

| File | What it does |
|---|---|
| `log.sh` | Bash helper: write one row to `agent_log` via RPC. |
| `context.sh` | Bash helper: fetch last N `agent_log` rows formatted for a prompt. |
| `run-hammer.mjs` | The autonomous code agent. Picks one open `agent:hammer` Issue, edits files via Anthropic API tool use, commits, pushes, opens a PR, posts to `agent_log`. |
| `loop.sh` | `caffeinate`-wrapped loop that runs Hammer every 5 min. |
| `README.md` | This file. |

## One-time setup

1. Apply migration 001 to Supabase (already done). The `agent_log`,
   `notifications`, and helper RPCs must exist.
2. Configure `~/.sapthagiri/env` (chmod 600):

   ```sh
   SUPABASE_URL=https://upxgcpkatrcejicailmp.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=eyJ...          # from Supabase → Settings → API
   ANTHROPIC_API_KEY=sk-ant-...              # from console.anthropic.com
   GITHUB_REPO=vinnisap75/sapthagiri-dosa
   # GITHUB_PAT optional — falls back to `gh auth token`
   IMESSAGE_RECIPIENT=+1XXXXXXXXXX           # for the iMessage daemon
   ```

3. Confirm `gh auth status` is signed in (`gh auth login` if not).
4. Confirm `node --version` ≥ 18.

## Running tonight

Open Terminal, leave window visible:

```sh
cd ~/Documents/Sapthagiri/Dosa
bash scripts/agent/loop.sh
```

That's it. It will:

- Keep your Mac awake with `caffeinate` (no display sleep, no system sleep)
- Every 5 minutes, run Hammer
- Hammer picks the highest-priority open Issue labeled `agent:hammer`
- Hammer reads the repo, edits files, commits to `feat/...`, pushes, opens a PR
- All activity logged to `agent_log`
- Output streamed to `~/.sapthagiri/agent-loop.log`

In the morning, scan the log + the PRs.

## Detached / background mode

If you want to close the terminal window:

```sh
nohup bash scripts/agent/loop.sh > ~/.sapthagiri/agent-loop.log 2>&1 &
```

Stop with:

```sh
pkill -f scripts/agent/loop.sh
```

## Safety rules baked in

- Hammer NEVER pushes to `main` (always feature branch + PR; branch
  protection on `main` enforces this even if it tried).
- Hammer cannot touch `.git/`, `.env*`, `node_modules/`, `.next/`, or
  existing files under `supabase/migrations/`.
- Every commit includes `Co-Authored-By: sreec22 <sreec22@users.noreply.github.com>`.
- Every run writes `starting` → `note`*N* → `finishing` rows to
  `agent_log` per the protocol in
  `.agent-org/agents/PROTOCOL.md`.
- Hammer refuses to start if there are uncommitted changes in the
  working tree.

## Debugging

```sh
# See the seeded smoke-test history + everything Hammer has logged
bash scripts/agent/context.sh 50

# Manually trigger one Hammer run (no loop)
node scripts/agent/run-hammer.mjs

# Try a specific issue (e.g. #2)
node scripts/agent/run-hammer.mjs --issue 2

# Plan-only (no commits, no PR) — great for verifying the prompt is right
node scripts/agent/run-hammer.mjs --issue 2 --dry

# Tail the loop log
tail -f ~/.sapthagiri/agent-loop.log
```

## Costs

Anthropic API tokens. A typical Hammer run for a small issue (~5 file
reads, ~3 edits, one PR) is roughly $0.10–$0.30 with Sonnet. Five runs
overnight is ~$1–$2. Cap with `MAX_TOOL_ROUNDS = 30` in
`run-hammer.mjs` if a run goes off the rails.

## Who watches the watcher

Future work: Custodian local runner (`scripts/agent/run-custodian.mjs`)
that polls open PRs Hammer opens, runs the regression checks, posts a
review. For tonight Hammer-only is enough — you review the PRs
yourself in the morning.
