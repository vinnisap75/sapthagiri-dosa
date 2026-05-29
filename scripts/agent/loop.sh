#!/bin/bash
# Sapthagiri local agent loop.
#
# Keeps Hammer running every N seconds with caffeinate so the Mac stays
# awake. Run this from terminal before you sleep:
#
#   bash scripts/agent/loop.sh
#
# Stop with Ctrl-C. To run detached in the background:
#
#   nohup bash scripts/agent/loop.sh > ~/.sapthagiri/agent-loop.log 2>&1 &
#
# To stop the detached process:
#
#   pkill -f scripts/agent/loop.sh

set -u

INTERVAL="${HAMMER_INTERVAL:-300}"  # 5 min between runs by default
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LOG="$HOME/.sapthagiri/agent-loop.log"
mkdir -p "$(dirname "$LOG")"

echo "═══ Sapthagiri agent loop ═══"
echo "  repo:     $ROOT"
echo "  interval: ${INTERVAL}s"
echo "  log:      $LOG"
echo

# caffeinate: prevent display sleep, disk sleep, system idle sleep.
# -i = idle, -s = system, -d = display, -m = disk.
# Wrap the whole loop in caffeinate so the Mac stays awake while this
# script runs.
exec caffeinate -i -s -d -m bash -c '
  set -u
  cd "'"$ROOT"'"
  while true; do
    echo "[$(date "+%Y-%m-%d %H:%M:%S")] tick"
    node scripts/agent/run-hammer.mjs 2>&1 || echo "  Hammer exited with error (continuing)"
    echo "[$(date "+%Y-%m-%d %H:%M:%S")] sleeping '"$INTERVAL"'s"
    sleep '"$INTERVAL"'
  done
' | tee -a "$LOG"
