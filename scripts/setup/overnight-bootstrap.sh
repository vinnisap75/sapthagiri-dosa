#!/bin/bash
# Sapthagiri — overnight bootstrap.
#
# One command. Run from the repo root before you go to sleep:
#   bash scripts/setup/overnight-bootstrap.sh
#
# What this does, in order:
#   1. Sanity-checks the repo + prereqs (git, gh, python3).
#   2. Fetches origin so we know remote state.
#   3. Stashes any uncommitted edits.
#   4. Creates feat/security-and-cross-agent-infra branched from origin/main.
#   5. Pops the stash onto the new branch.
#   6. Commits everything with the sreec22 co-author trailer.
#   7. Pushes the branch to origin.
#   8. Opens a PR from the branch into main (links Issue #1).
#   9. Enables branch protection on main via gh API (no sudo dance).
#  10. Applies labels to the open Issues.
#  11. Offers to install the iMessage daemon.
#
# Idempotent for the bits that can be. Stops on first error.

set -euo pipefail

REPO_SLUG="vinnisap75/sapthagiri-dosa"
BRANCH="feat/security-and-cross-agent-infra"
BASE="main"

# Pretty colors so the wall of output is scannable at 2am.
B=$'\033[1m'; G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; X=$'\033[0m'

step() { echo; echo "${B}$1${X}"; }
ok()   { echo "${G}  ✓${X} $1"; }
warn() { echo "${Y}  !${X} $1"; }
die()  { echo "${R}  ✗${X} $1"; exit 1; }

cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

# ──────────────────────────────────────────────────────────────
step "1. Prereq check"
# ──────────────────────────────────────────────────────────────
command -v git >/dev/null  || die "git not found"
command -v gh  >/dev/null  || die "gh (GitHub CLI) not found. Install: brew install gh"
command -v /usr/bin/python3 >/dev/null || die "/usr/bin/python3 not found (Xcode CLT)."
gh auth status >/dev/null 2>&1 || die "gh not authenticated. Run: gh auth login"
ok "git, gh, python3 all present"
ok "gh authenticated as $(gh api user --jq .login)"

# ──────────────────────────────────────────────────────────────
step "2. Clear any stale index lock"
# ──────────────────────────────────────────────────────────────
if [ -f .git/index.lock ]; then
  rm -f .git/index.lock
  ok "removed stale .git/index.lock"
else
  ok "no stale lock"
fi

# ──────────────────────────────────────────────────────────────
step "3. Fetch origin + verify ignore rules"
# ──────────────────────────────────────────────────────────────
git fetch origin --prune
ok "fetched origin"

git check-ignore .env.local >/dev/null 2>&1 || die ".env.local is NOT ignored — aborting before any push."
git check-ignore .agent-org/ >/dev/null 2>&1 || die ".agent-org/ is NOT ignored — aborting."
ok ".env.local + .agent-org/ both gitignored"

# Make sure none of those slipped into the index already.
if git ls-files .env.local .agent-org/ 2>/dev/null | grep -q .; then
  die "secret/private paths are already tracked. Run: git rm --cached <path>"
fi
ok "no secrets in the index"

# ──────────────────────────────────────────────────────────────
step "4. Stash working-tree edits"
# ──────────────────────────────────────────────────────────────
git add -A
if git diff --cached --quiet && git diff --quiet; then
  warn "no local changes detected — nothing to commit"
  HAS_CHANGES=0
else
  HAS_CHANGES=1
  STASH_NAME="overnight-bootstrap-$(date +%s)"
  git stash push -u -m "$STASH_NAME" >/dev/null
  ok "stashed local edits as $STASH_NAME"
fi

# ──────────────────────────────────────────────────────────────
step "5. Branch off origin/main"
# ──────────────────────────────────────────────────────────────
git checkout main 2>/dev/null || git checkout -b main origin/main
git reset --hard origin/main
ok "main synced to origin"

if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
  warn "branch $BRANCH already exists locally — re-using it"
  git checkout "$BRANCH"
  git reset --hard origin/main
else
  git checkout -b "$BRANCH"
  ok "created branch $BRANCH off origin/main"
fi

# ──────────────────────────────────────────────────────────────
step "6. Pop stash + commit"
# ──────────────────────────────────────────────────────────────
if [ "$HAS_CHANGES" -eq 1 ]; then
  git stash pop || die "stash pop failed — your edits are still in 'git stash list'"
  ok "applied stashed edits to $BRANCH"

  git add -A
  git commit -m "Security hardening + Wed/Sat/Sun service config + cross-agent infra

- supabase/migrations/001_security_hardening.sql (already applied to live)
  closes Sentry P0/P1: lock orders RLS to staff, add capability-style RPCs
  (get_order_status, get_order_items, get_active_queue, call_server),
  bring server_calls into schema, rate limit orders (5/min/table),
  status transition state machine, column length caps, notifications
  + agent_log tables + helper RPCs.
- lib/services.ts adds Wed dinner / Sat & Sun breakfast service config.
  Sat & Sun show limited 4-item breakfast menu; Rava Dosa CTA Wed-only.
- app/order/page.tsx + app/status/[id]/page.tsx switched to RPCs because
  anon SELECT on orders/order_items is no longer allowed.
- scripts/imessage-daemon/: local launchd poll loop that delivers
  Supabase notifications via Messages.app.
- .github/workflows/ci.yml + CODEOWNERS + PR template gate every PR.
- scripts/setup/overnight-bootstrap.sh: this script.

Refs Issue #1 (status page broken until this lands).

Co-authored-by: sreec22 <sreec22@users.noreply.github.com>
"
  ok "committed"
else
  warn "no commit needed"
fi

# ──────────────────────────────────────────────────────────────
step "7. Push branch"
# ──────────────────────────────────────────────────────────────
git push -u origin "$BRANCH"
ok "pushed $BRANCH to origin"

# ──────────────────────────────────────────────────────────────
step "8. Open PR (links Issue #1)"
# ──────────────────────────────────────────────────────────────
EXISTING_PR=$(gh pr list --head "$BRANCH" --base "$BASE" --json number --jq '.[0].number' 2>/dev/null || echo "")
if [ -z "$EXISTING_PR" ]; then
  PR_URL=$(gh pr create \
    --base "$BASE" \
    --head "$BRANCH" \
    --title "Security hardening + multi-buffet config + iMessage daemon (closes #1)" \
    --body "Closes #1.

Migration 001 is already applied to Supabase live, which means the
production customer status page is currently broken until this lands.

See \`.agent-org/SECURITY-AUDIT.md\` (gitignored, on local) for Sentry's
P0/P1 audit findings that this PR closes.

### Verification checklist
- [ ] CI green
- [ ] Smoke test customer status page after merge (Vercel auto-deploys)
- [ ] Smoke test /kitchen still works
- [ ] Smoke test 'Call server' button on both /order and /status

Co-authored-by: sreec22 <sreec22@users.noreply.github.com>")
  ok "PR opened: $PR_URL"
else
  warn "PR already exists: #$EXISTING_PR"
  gh pr view "$EXISTING_PR" --web 2>/dev/null || true
fi

# ──────────────────────────────────────────────────────────────
step "9. Enable branch protection on main (via gh API, no sudo)"
# ──────────────────────────────────────────────────────────────
gh api -X PUT "repos/$REPO_SLUG/branches/main/protection" --input - <<'JSON' >/dev/null
{
  "required_status_checks": null,
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": false,
    "required_approving_review_count": 1,
    "require_last_push_approval": false
  },
  "restrictions": null,
  "required_linear_history": false,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_conversation_resolution": false,
  "lock_branch": false,
  "allow_fork_syncing": false
}
JSON
ok "branch protection enabled on main"
ok "    • PR required + 1 approval + dismiss stale on push"
ok "    • no force-push, no deletion"
ok "    (status check enforcement skipped — CI workflow ships in this PR; enable as required check after first green run)"

# ──────────────────────────────────────────────────────────────
step "10. Label the open Issues"
# ──────────────────────────────────────────────────────────────
gh label create "priority:p0" --color B60205 --description "Ship before next service" --force >/dev/null 2>&1 || true
gh label create "priority:p1" --color D93F0B --description "Ship this week"             --force >/dev/null 2>&1 || true
gh label create "agent:hammer" --color 0E8A16 --description "For the code-writing agent (Copilot Cloud Agent when available)" --force >/dev/null 2>&1 || true
gh label create "agent:custodian" --color 5319E7 --description "For the PR review agent" --force >/dev/null 2>&1 || true
ok "labels exist"

gh issue edit 1 --add-label "priority:p0,agent:hammer" >/dev/null 2>&1 || warn "labeling issue #1 failed"
gh issue edit 2 --add-label "priority:p1,agent:hammer" >/dev/null 2>&1 || warn "labeling issue #2 failed"
ok "issues #1 and #2 labeled"

# ──────────────────────────────────────────────────────────────
step "11. iMessage daemon — install now?"
# ──────────────────────────────────────────────────────────────
if [ -f "$HOME/Library/LaunchAgents/com.sapthagiri.imessage.plist" ]; then
  warn "daemon already installed — skipping"
else
  echo
  read -rp "  Install the iMessage daemon now? (y/N) " ANS
  if [[ "$ANS" =~ ^[Yy]$ ]]; then
    bash scripts/imessage-daemon/install.sh
  else
    warn "skipped daemon install — run scripts/imessage-daemon/install.sh later"
  fi
fi

# ──────────────────────────────────────────────────────────────
step "Done"
# ──────────────────────────────────────────────────────────────
echo
echo "  ${G}Sleep well.${X} In the morning:"
echo
echo "    1. Check the PR Custodian-style: gh pr checks"
echo "    2. Merge it:                     gh pr merge --squash --delete-branch"
echo "    3. Vercel auto-deploys.          Test on phone: scan a QR, verify status page loads."
echo "    4. If Copilot Cloud Agent is on your plan, assign it to Issue #2 for the kitchen UI."
echo
echo "  All agent activity logs live in Supabase table public.agent_log."
echo "  All iMessage pings queue into public.notifications."
echo
