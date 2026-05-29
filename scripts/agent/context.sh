#!/bin/bash
# Sapthagiri — fetch recent agent_log rows.
#
# Spits out the last N rows formatted as a markdown block, ready to
# paste into a sub-agent's prompt.
#
# Usage:
#   scripts/agent/context.sh           # default: last 20 rows
#   scripts/agent/context.sh 50        # last 50 rows
#   scripts/agent/context.sh 20 sentry # last 20 rows for one agent
#
# Output:
#   <recent_agent_log>
#   [2026-05-29 06:14:02] sentry · finishing — 3 P0 / 4 P1 / ...
#   ...
#   </recent_agent_log>

set -euo pipefail

CONFIG="$HOME/.sapthagiri/env"
[ -f "$CONFIG" ] && set -a && . "$CONFIG" && set +a

: "${SUPABASE_URL:?SUPABASE_URL not set}"
KEY="${SUPABASE_SERVICE_ROLE_KEY:-${NEXT_PUBLIC_SUPABASE_ANON_KEY:-}}"
[ -n "$KEY" ] || { echo "need SUPABASE_SERVICE_ROLE_KEY or anon key" >&2; exit 2; }

LIMIT="${1:-20}"
FILTER_AGENT="${2:-}"

URL="$SUPABASE_URL/rest/v1/agent_log?order=created_at.desc&limit=$LIMIT"
if [ -n "$FILTER_AGENT" ]; then
  URL="$URL&agent=eq.$FILTER_AGENT"
fi

RESP=$(curl -sS \
  -H "apikey: $KEY" \
  -H "Authorization: Bearer $KEY" \
  "$URL")

# Format for prompt injection.
/usr/bin/python3 - "$RESP" <<'PY'
import json, sys
rows = json.loads(sys.argv[1])
# Sort ascending for chronological readability inside the prompt.
rows.sort(key=lambda r: r["created_at"])
print("<recent_agent_log>")
for r in rows:
    ts = r["created_at"].replace("T", " ")[:19]
    print(f'[{ts}] {r["agent"]} · {r["phase"]} — {r["message"]}')
print("</recent_agent_log>")
PY
