#!/bin/bash
# Sapthagiri — one-shot initial-push script.
#
# Why this exists: the Cowork sandbox can't write to `.git/`, so we can't
# stage/commit/push from there. This script does it from your Mac
# terminal with the right author + co-author trailer.
#
# Run from the repo root:
#   bash scripts/setup/initial-push.sh
#
# Idempotent: safe to re-run after fixing any errors.

set -euo pipefail

REPO_URL="https://github.com/vinnisap75/sapthagiri-dosa.git"
BRANCH_MAIN="main"

cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

echo
echo "═══ Sapthagiri initial push ═══"
echo

# 1) Clear any stale index lock from interrupted git operations.
if [ -f .git/index.lock ]; then
  echo "→ removing stale .git/index.lock"
  rm -f .git/index.lock
fi

# 2) Configure author. Email already set in repo config; we just set name.
git config user.name "vinnisap75"
echo "→ author: $(git config user.name) <$(git config user.email)>"

# 3) Stage everything that's not gitignored. Verify .env.local + .agent-org/
#    are excluded BEFORE staging.
echo
echo "→ verifying ignore rules…"
if git check-ignore .env.local >/dev/null 2>&1; then
  echo "  ✓ .env.local ignored"
else
  echo "  ✗ .env.local NOT ignored — aborting."
  exit 1
fi
if git check-ignore .agent-org/ >/dev/null 2>&1; then
  echo "  ✓ .agent-org/ ignored"
else
  echo "  ✗ .agent-org/ NOT ignored — aborting."
  exit 1
fi

git add -A

STAGED_COUNT=$(git diff --cached --name-only | wc -l | tr -d ' ')
echo "→ $STAGED_COUNT files staged"

# 4) Sanity: bail if any of the danger files slipped through.
if git diff --cached --name-only | grep -E '(\.env\.local$|^\.agent-org/|service_role)'; then
  echo "✗ Danger files in stage — aborting."
  exit 1
fi
echo "  ✓ no danger files in stage"

# 5) Initial commit on main with the co-author trailer.
echo
echo "→ committing initial import…"
git commit -m "Initial commit: Sapthagiri Dosa ordering app + security hardening

Customer QR ordering flow, kitchen master board, admin analytics +
QR-print sheet, in-restaurant auth gate, multi-buffet service config
(Wed dinner + Sat/Sun breakfast).

Schema includes the first security-hardening migration that closes the
demo-grade RLS holes flagged by the Sentry sub-agent (see
.agent-org/SECURITY-AUDIT.md, gitignored).

Highlights:
- supabase/migrations/001_security_hardening.sql closes Sentry P0/P1:
  orders SELECT/UPDATE locked to authenticated staff; column-level anon
  guard trigger; capability-style read RPCs (get_order_status etc.);
  server_calls table brought into schema with rate-limited call_server
  RPC; orders insert rate limit (5/min/table); status transition state
  machine; column length caps (60/280/500); notifications + agent_log
  tables and helper RPCs.
- lib/services.ts: Wed/Sat/Sun service config; Sat/Sun show limited
  4-item breakfast menu; Rava Dosa CTA only on Wed.
- app/order, app/status switched to RPCs (anon can no longer read the
  orders / order_items tables directly).
- scripts/imessage-daemon/: local launchd poll loop that delivers
  Supabase notifications via Messages.app.
- .github/workflows/ci.yml + CODEOWNERS + PR template enforce
  regression checks for every PR to main.

Co-authored-by: sreec22 <sreec22@users.noreply.github.com>
"

# 6) Add the remote if not already there. (Idempotent.)
if git remote get-url origin >/dev/null 2>&1; then
  echo "→ origin already set: $(git remote get-url origin)"
else
  git remote add origin "$REPO_URL"
  echo "→ added remote origin → $REPO_URL"
fi

# 7) Push main. If the remote already has a main with commits, this will
#    reject — that's fine, we'll deal with it manually.
echo
echo "→ pushing $BRANCH_MAIN to origin…"
git push -u origin "$BRANCH_MAIN"

echo
echo "═══ Done. ═══"
echo
echo "Next steps (you do these in the GitHub web UI):"
echo
echo "  1. Enable branch protection on main:"
echo "     Settings → Branches → Add branch protection rule"
echo "     - Branch name pattern: main"
echo "     - Require a pull request before merging  ✓"
echo "     - Require approvals: 1"
echo "     - Require review from Code Owners  ✓"
echo "     - Require status checks to pass before merging  ✓"
echo "       └─ Required check: 'build' (from .github/workflows/ci.yml)"
echo "       └─ Required check: 'secret-scan'"
echo "     - Require branches to be up to date  ✓"
echo "     - Do not allow force pushes  ✓"
echo "     - Do not allow deletions  ✓"
echo
echo "  2. Enable secret scanning + push protection:"
echo "     Settings → Code security → enable Secret scanning + Push protection"
echo
echo "  3. Add Vercel deploy hook (if not already linked):"
echo "     Vercel → Project → Settings → Git → connect to vinnisap75/sapthagiri-dosa"
echo
echo "  4. Apply the SQL migration to Supabase:"
echo "     Open Supabase → SQL Editor → paste supabase/migrations/001_security_hardening.sql → Run"
echo "     This is REQUIRED before any new code that calls the new RPCs ships to prod."
echo
