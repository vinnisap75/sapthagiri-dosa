#!/bin/bash
# Sapthagiri iMessage daemon — one-time installer.
#
# Installs:
#   ~/.sapthagiri/poll.py        — the polling script
#   ~/.sapthagiri/env            — config (chmod 600)
#   ~/Library/LaunchAgents/com.sapthagiri.imessage.plist
#
# After install, agents queueing rows into the Supabase `notifications`
# table (kind='imessage') get delivered to your iMessage within 30 seconds.
#
# Run from this directory:
#   ./install.sh

set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG_DIR="$HOME/.sapthagiri"
LAUNCH_AGENTS="$HOME/Library/LaunchAgents"
PLIST_DST="$LAUNCH_AGENTS/com.sapthagiri.imessage.plist"
LABEL="com.sapthagiri.imessage"

echo
echo "═══ Sapthagiri iMessage daemon installer ═══"
echo

# 1) Make sure Python 3 is available (macOS ships it as /usr/bin/python3).
if ! command -v /usr/bin/python3 >/dev/null 2>&1; then
  echo "❌ /usr/bin/python3 not found. Install Xcode Command Line Tools:"
  echo "     xcode-select --install"
  exit 1
fi

# 2) Make config dir.
mkdir -p "$CONFIG_DIR"
chmod 700 "$CONFIG_DIR"

# 3) Copy poll.py.
cp "$DIR/poll.py" "$CONFIG_DIR/poll.py"
chmod 700 "$CONFIG_DIR/poll.py"

# 4) Prompt for env values (only if env file doesn't already exist).
ENV_FILE="$CONFIG_DIR/env"
if [ ! -f "$ENV_FILE" ]; then
  echo "Set up config (~/.sapthagiri/env)."
  echo
  read -rp "  Supabase URL [https://upxgcpkatrcejicailmp.supabase.co]: " SB_URL
  SB_URL="${SB_URL:-https://upxgcpkatrcejicailmp.supabase.co}"

  echo
  echo "  Service-role key (paste from Supabase → Settings → API → service_role)."
  echo "  NOTE: this key bypasses RLS, treat it like a password. It stays local."
  read -rsp "  SUPABASE_SERVICE_ROLE_KEY: " SB_KEY
  echo
  if [ -z "$SB_KEY" ]; then
    echo "❌ service-role key required." >&2
    exit 1
  fi

  echo
  echo "  iMessage recipient (phone number with country code, e.g. +12015551234,"
  echo "  or Apple ID email)."
  read -rp "  IMESSAGE_RECIPIENT: " IM_TO
  if [ -z "$IM_TO" ]; then
    echo "❌ recipient required." >&2
    exit 1
  fi

  cat > "$ENV_FILE" <<EOF
# Sapthagiri iMessage daemon config. Keep this file private (chmod 600).
SUPABASE_URL=$SB_URL
SUPABASE_SERVICE_ROLE_KEY=$SB_KEY
IMESSAGE_RECIPIENT=$IM_TO
EOF
  chmod 600 "$ENV_FILE"
  echo "  wrote $ENV_FILE (chmod 600)"
else
  echo "✓ $ENV_FILE already exists, leaving it alone"
fi

# 5) Render the plist with the user's HOME path substituted.
mkdir -p "$LAUNCH_AGENTS"
sed "s|__HOME__|$HOME|g" "$DIR/com.sapthagiri.imessage.plist.template" > "$PLIST_DST"
chmod 644 "$PLIST_DST"
echo "✓ installed $PLIST_DST"

# 6) Load (or reload) the launch agent.
if launchctl list 2>/dev/null | grep -q "$LABEL"; then
  launchctl unload "$PLIST_DST" 2>/dev/null || true
fi
launchctl load "$PLIST_DST"
echo "✓ launched (StartInterval = 30s)"

# 7) Smoke test — enqueue a hello message via REST.
# shellcheck source=/dev/null
. "$ENV_FILE"
TEST_BODY="Sapthagiri iMessage daemon installed at $(date '+%Y-%m-%d %H:%M:%S'). Future pings will land here."
RESP=$(curl -sS -X POST \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  "$SUPABASE_URL/rest/v1/notifications" \
  -d "{
    \"kind\":\"imessage\",
    \"recipient\":\"$IMESSAGE_RECIPIENT\",
    \"title\":\"Sapthagiri\",
    \"body\":\"$TEST_BODY\",
    \"source\":\"installer\"
  }")

if echo "$RESP" | grep -q '"id"'; then
  echo "✓ test notification queued — should arrive within ~30s"
else
  echo "⚠ test enqueue failed (continuing anyway). Response:"
  echo "  $RESP"
  echo "  Common causes: notifications table missing (run migration 001), or wrong service-role key."
fi

echo
echo "Done. Useful commands:"
echo "  tail -f $CONFIG_DIR/poll.log     # live activity"
echo "  tail -f $CONFIG_DIR/poll.err     # errors only"
echo "  launchctl unload $PLIST_DST      # stop the daemon"
echo "  launchctl load $PLIST_DST        # restart it"
echo
echo "Messages.app must be signed in to iMessage on this Mac. The first time"
echo "the daemon runs you may see a macOS permission prompt asking osascript"
echo "to control Messages — click Allow."
echo
