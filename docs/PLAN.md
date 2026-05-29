# Sapthagiri — phased roadmap

> Agents work against named phases here, not against ad-hoc requests.
> When a request doesn't map to a phase, file an issue + add it here.
> When a phase completes, move it to **DONE** and tag the date.

## Phase 0 — Restaurant infrastructure ✅ DONE 2026-05-29

The base product. What customers and the kitchen actually use.

- [x] Customer QR-scan ordering flow (`/order`)
- [x] Live order-status page (`/status/[id]`) with wait estimate
- [x] Kitchen master board (`/kitchen`) with per-item 3-state tracking
- [x] Admin analytics (`/admin/stats`) — orders served, top dosas,
      ratings, busiest tables
- [x] Admin QR-print sheet (`/admin/qrs`)
- [x] Auth gate (staff sign-in)
- [x] Per-item crispiness + cook medium (ghee/oil)
- [x] Build-Your-Own dosa + uttapam with addons
- [x] Rating + rating-note after served
- [x] Loud chime for new orders (Web Audio synthesis)
- [x] Server-call button (kitchen pings staff)

## Phase 1 — Hardening + multi-service ✅ DONE 2026-05-29

Closes Sentry P0/P1 + enables the Sat/Sun breakfast buffets.

- [x] Migration 001: lock RLS to staff, capability RPCs, rate limits,
      column length caps, status state machine
- [x] Wed/Sat/Sun service config (`lib/services.ts`) with limited menu
      on weekends
- [x] Hide Jain (no-onion-no-garlic) modifier on Sat/Sun
- [x] Customer status page switched to RPCs (no anon SELECT)
- [x] Migration 002: agent_config + Slack fan-out trigger
- [x] Migration 003: orders.is_test column + Test Mode
- [x] `/admin/preview` — per-service customer view
- [x] `/admin/slack` — paste webhook UI
- [x] `/admin/printer` — Star/Epson ESC/POS scaffold
- [x] `/admin/agent-log` — live agent comms feed
- [x] Kitchen: Cooking Mode toggle, Prep tab, 16KB MP3 chime,
      Tests-hidden toggle
- [x] `is_test` filtered from analytics
- [x] CI workflow + CODEOWNERS + PR template
- [x] Branch protection on `main` (require PR + 1 approval)
- [x] iMessage daemon (launchd + osascript bridge)

## Phase 2 — Operationalize 🟡 IN PROGRESS

Make what's built actually run in production. No new features.

- [ ] Pair the actual thermal printer on the kitchen LAN, run the
      mixed-content workaround, confirm a real test print
- [ ] Wire printer auto-print to a real Sat/Sun service
- [ ] Create the Slack workspace + `#sapthagiri-floor` channel, paste
      the webhook URL at `/admin/slack`, fire `slack_test()`, watch the
      message land
- [ ] Revoke the `sapbuff` GitHub PAT (was used for tonight's pushes)
- [ ] First real Saturday breakfast service with the limited-menu flow
- [ ] First real Sunday breakfast service
- [ ] Capture failure modes from the first weekend in
      `docs/NIGHT_LOG/<date>.md` and feed them back into the agents

## Phase 3 — Tighten the agent org 🟡 SCAFFOLDED, NOT FULLY ACTIVE

The agents are documented but most haven't run for real.

- [ ] Custodian actually reviews PR #N (first time a PR opens, spawn it
      from the protocol)
- [ ] Sentry re-runs after Phase 1 changes settle, generates a fresh
      `.agent-org/SECURITY-AUDIT-002.md`
- [ ] Tighten the per-agent file-ownership matrices (this PR)
- [ ] Add a `/admin/agent-log` filter by `phase` so blocked rows pop
- [ ] First nightly health-check run by Tava (kitchen state + queue
      length + last 24h order count posted to agent_log)

## Phase 4 — Customer experience polish

These are "make Wednesday more pleasant" tasks, not load-bearing.

- [ ] Customer-side rating prompt → Google Maps review funnel (Wed only)
- [ ] Repeat-customer recognition (table + party + name pattern)
- [ ] Per-table HMAC token in the QR (prevent table-id forging)
- [ ] Server-side time gate (currently client-side, bypassable)
- [ ] iPad-friendly layout breakpoints on `/kitchen`

## Phase 5 — Stretch / explicitly out of scope this quarter

- LLM voice command / readback on the kitchen tablet
- Payments (Stripe + tip flow + receipt printing)
- Mirror agent — Google Maps review polling + reply drafts
- Patron agent — customer-experience monitor
- Counter agent — analytics digest poster
- Hammer-as-Copilot — when GitHub re-enables Copilot Pro trial
- Multi-restaurant SaaS

---

## How to use this file

- An agent picking work reads this top-down and picks the highest
  unblocked item under the current in-progress phase.
- When you finish a Phase 2 item, check the box AND write a line in
  `docs/NIGHT_LOG/<date>.md`.
- When the in-progress phase has zero unchecked items, promote it to
  ✅ DONE with the date and roll the next phase to IN PROGRESS.
- Adding new work: create an Issue, then list it here under the
  appropriate phase. If it doesn't fit a phase, it probably shouldn't
  be done.
