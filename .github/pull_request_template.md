# What this PR does

<!-- One sentence. e.g. "Adds cooking-mode toggle to /kitchen so the runner
sees who's on the pan." -->

# Why

<!-- The user story or operational reason. e.g. "Vinni leaves after 1–2h
and Ravi takes over; without this the runner has no way to know." -->

# How

<!-- Bullet list of the concrete changes. File-level if helpful. -->

# Test plan

- [ ] `npm run build` passes locally
- [ ] Manual test path 1: ...
- [ ] Manual test path 2: ...

# Regression checks (Custodian agent will re-verify)

- [ ] No new `console.log` of `customer_name`, `notes`, or `rating_note`
- [ ] Customer pages (`app/order`, `app/status`) still use RPCs — no direct `.from('orders')`
- [ ] If the schema changed: new migration file in `supabase/migrations/` (not edits to existing files)
- [ ] If a new env var is needed: `.env.local.example` updated AND Vercel env var documented in PR
- [ ] If a new dep was added: it's actively maintained (no last-commit-was-2019)
- [ ] No `.env.local`, `.agent-org/`, or service-role key in the diff

# Screenshots (UI changes only)

<!-- Before / after, mobile + tablet if relevant. The Lenovo kitchen
tablet is the most important target. -->

# Co-authors

Add `Co-Authored-By:` trailers for everyone who pair-worked on this — the
orchestrator and sreec22 should appear by default per project convention.
