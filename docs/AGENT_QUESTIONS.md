# Agent escalations — questions for Sree

> When an agent (including the orchestrator) hits a fork in the road
> it can't resolve from the spec, it appends an entry here and stops.
> Sree answers, the agent resumes on the next run.

## Format

Each question is a top-level heading. Below it:

- **Agent:** which slug raised it
- **Run / task_id:** correlation id from `agent_log`
- **Filed:** ISO date
- **Why this is a fork:** 1–3 sentences
- **The options:** A / B / C with the trade-offs
- **My recommendation:** the agent's pick, if any
- **Status:** OPEN / ANSWERED on YYYY-MM-DD / DROPPED

When Sree answers, the agent that asked moves the entry to
**ANSWERED**, records the choice in `agent_log` as a `note`, and
proceeds.

## Triggers — when to file an escalation

An agent MUST file here (and stop) before doing any of these without
explicit prior approval:

- Picking a branch name when the request was ambiguous
- Choosing between two valid migration strategies
- Touching `.env*`, secrets, or anything under `/.github/workflows/`
  that affects required checks
- Anything financial: subscriptions, paid SaaS signup, API spend
- Any destructive op: deleting rows, dropping tables, force-push,
  rewriting history
- Disabling a security control (RLS policy, branch protection,
  CODEOWNERS) even temporarily
- Adding a new dependency to `package.json`
- Anything where two reasonable people would disagree

An agent should NOT file here for:
- Stylistic choices (use the existing convention)
- Trivial naming inside the file the agent owns
- Anything explicitly covered in PROTOCOL.md or the agent's own spec

## Open

*(none right now — file new questions above this line)*

## Answered

*(historical decisions land here, with the date Sree answered)*

### Example entry (delete after first real one lands)

> **Q:** Should branch protection require code-owner review on every PR?
>
> - **Agent:** orchestrator
> - **Run / task_id:** orchestrator-2026-05-29-bp-001
> - **Filed:** 2026-05-29
> - **Why this is a fork:** Spur's setup requires it. Ours doesn't.
>   Adding it means every PR needs sreec22 (or vinnisap75) to click
>   approve, even on weekends. Without it, an admin push can land.
> - **Options:**
>   A. Require code-owner review (strictest, slowest)
>   B. Require 1 approval, no code-owner rule (current)
>   C. No protection (worst, undo earlier work)
> - **My recommendation:** B for now; revisit when there are >1 active
>   committers.
> - **Status:** ANSWERED 2026-05-29 → B
