#!/bin/bash
# Sapthagiri — agent_log writer for shell agents (CI, scheduled tasks).
#
# Usage:
#   scripts/agent/log.sh <agent> <phase> <message> [payload-json]
#
# Examples:
#   scripts/agent/log.sh orchestrator starting "Kicking off Saturday buffet prep"
#   scripts/agent/log.sh sentry note "3 P0 / 4 P1 open" \
#       '{"p0":3,"p1":4}'
#   scripts/agent/log.sh orchestrator finishing "Floor ready" \
#       '{"handoff_to":"custodian"}'
#
# Env (loaded from ~/.sapthagiri/env or process env):
#   SUPABASE_URL
#   SUPABASE_SERVICE_ROLE_KEY  (or NEXT_PUBLIC_SUPABASE_ANON_KEY for read-only use)

set -euo pipefail

CONFIG="$HOME/.sapthagiri/env"
[ -f "$CONFIG" ] && set -a && . "$CONFIG" && set +a

: "${SUPABASE_URL:?SUPABASE_URL not set in env or ~/.sapthagiri/env}"
: "${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY not set}"

AGENT="${1:?agent slug required, e.g. orchestrator}"
PHASE="${2:?phase required: starting|note|blocked|finishing}"
MESSAGE="${3:?message required}"
PAYLOAD_JSON="${4:-null}"

# Validate phase locally so we get a useful error before Postgres yells.
case "$PHASE" in
  starting|note|blocked|finishing) ;;
  *) echo "invalid phase: $PHASE (must be starting|note|blocked|finishing)" >&2; exit 2 ;;
esac

# task_id is optional; pull from CI env if available.
TASK_ID="${GITHUB_RUN_ID:-${TASK_ID:-}}"
TASK_ID_JSON=$(if [ -n "$TASK_ID" ]; then printf '"%s"' "$TASK_ID"; else echo "null"; fi)

# Build the JSON body via python to safely escape the message.
BODY=$(/usr/bin/python3 - "$AGENT" "$PHASE" "$TASK_ID_JSON" "$MESSAGE" "$PAYLOAD_JSON" <<'PY'
import json, sys
agent, phase, task_id_raw, message, payload_raw = sys.argv[1:]
task_id = json.loads(task_id_raw)
try:
    payload = json.loads(payload_raw) if payload_raw != "null" else None
except Exception as e:
    print(f"bad payload JSON: {e}", file=sys.stderr); sys.exit(2)
print(json.dumps({
    "p_agent": agent,
    "p_phase": phase,
    "p_task_id": task_id,
    "p_message": message,
    "p_payload": payload,
}))
PY
)

RESP=$(curl -sS -X POST \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  "$SUPABASE_URL/rest/v1/rpc/log_agent_event" \
  --data "$BODY")

# RPC returns the new row id as a JSON string.
if echo "$RESP" | grep -q '"code"'; then
  echo "agent_log write failed: $RESP" >&2
  exit 1
fi
echo "$RESP"
