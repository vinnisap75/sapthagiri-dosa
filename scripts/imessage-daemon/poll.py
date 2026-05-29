#!/usr/bin/env python3
"""Sapthagiri iMessage poll daemon.

Runs every 30 seconds via launchd. Reads pending iMessage notifications
from the Supabase `notifications` table, sends them via the Messages.app
AppleScript bridge, and marks the row delivered.

Config is read from ~/.sapthagiri/env (KEY=value lines):
    SUPABASE_URL              https://upxgcpkatrcejicailmp.supabase.co
    SUPABASE_SERVICE_ROLE_KEY <paste from Supabase dashboard>
    IMESSAGE_RECIPIENT        +1XXXXXXXXXX  (default; per-row recipient column overrides)

The script is intentionally dependency-free — uses only the stdlib so it
works on a stock macOS Python 3.

Author: orchestrator + sreec22.
"""

import json
import os
import subprocess
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


# ─────────── config ───────────


def load_env(path: Path) -> dict:
    """Parse a simple KEY=value file. Tolerates blanks, comments, quotes."""
    cfg: dict = {}
    if not path.exists():
        return cfg
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        v = v.strip()
        if (v.startswith('"') and v.endswith('"')) or (
            v.startswith("'") and v.endswith("'")
        ):
            v = v[1:-1]
        cfg[k.strip()] = v
    return cfg


# ─────────── Supabase REST ───────────


def fetch_pending(base: str, key: str, limit: int = 20) -> list:
    """Pull the next batch of pending iMessage notifications."""
    url = (
        f"{base}/rest/v1/notifications"
        f"?kind=eq.imessage&delivered_at=is.null&error=is.null"
        f"&select=id,title,body,recipient&order=created_at.asc&limit={limit}"
    )
    req = urllib.request.Request(
        url, headers={"apikey": key, "Authorization": f"Bearer {key}"}
    )
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read().decode())


def patch_row(base: str, key: str, row_id: str, patch_obj: dict) -> None:
    """Mark a single notification row delivered or errored."""
    url = f"{base}/rest/v1/notifications?id=eq.{row_id}"
    body = json.dumps(patch_obj).encode()
    req = urllib.request.Request(
        url,
        data=body,
        method="PATCH",
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        },
    )
    urllib.request.urlopen(req, timeout=10).read()


# ─────────── AppleScript bridge ───────────


def _escape_applescript(s: str) -> str:
    """Escape a string for embedding inside an AppleScript string literal."""
    return s.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")


def send_imessage(recipient: str, message: str) -> None:
    """Send `message` to `recipient` via the Messages.app AppleScript bridge.

    Requires that Messages.app is running and signed into iMessage on this
    Mac. On first run macOS will prompt for Automation permission for
    'osascript' to control 'Messages' — accept it once.
    """
    safe_msg = _escape_applescript(message)
    safe_to = _escape_applescript(recipient)
    # Messages automation is fragile on recent macOS: the classic
    # "buddy of service" lookup throws when no prior conversation exists.
    # Try it first, then fall back to "participant of account", which
    # succeeds on versions where the buddy form does not.
    script = (
        'tell application "Messages"\n'
        "    try\n"
        "        set targetService to 1st service whose service type = iMessage\n"
        f'        send "{safe_msg}" to buddy "{safe_to}" of targetService\n'
        "    on error\n"
        "        set targetAccount to 1st account whose service type = iMessage\n"
        f'        send "{safe_msg}" to participant "{safe_to}" of targetAccount\n'
        "    end try\n"
        "end tell\n"
    )
    subprocess.run(
        ["osascript", "-e", script],
        check=True,
        capture_output=True,
        timeout=15,
    )


# ─────────── main loop ───────────


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def main() -> int:
    cfg_path = Path.home() / ".sapthagiri" / "env"
    cfg = load_env(cfg_path)
    base = cfg.get("SUPABASE_URL") or os.environ.get("SUPABASE_URL")
    key = cfg.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get(
        "SUPABASE_SERVICE_ROLE_KEY"
    )
    default_to = cfg.get("IMESSAGE_RECIPIENT") or os.environ.get(
        "IMESSAGE_RECIPIENT"
    )

    if not base or not key:
        print(
            f"[{now_iso()}] missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in {cfg_path}",
            file=sys.stderr,
        )
        return 0
    if not default_to:
        print(
            f"[{now_iso()}] missing IMESSAGE_RECIPIENT in {cfg_path}",
            file=sys.stderr,
        )
        return 0

    try:
        rows = fetch_pending(base, key)
    except Exception as e:
        print(f"[{now_iso()}] fetch failed: {e}", file=sys.stderr)
        return 0

    for row in rows:
        rid = row["id"]
        title = row.get("title") or ""
        body = row.get("body") or ""
        recipient = row.get("recipient") or default_to
        msg = f"{title}: {body}" if title else body

        try:
            send_imessage(recipient, msg)
            patch_row(base, key, rid, {"delivered_at": now_iso()})
            print(f"[{now_iso()}] sent {rid} -> {recipient}")
        except subprocess.CalledProcessError as e:
            err = (e.stderr or b"").decode("utf-8", "ignore")[:300]
            print(f"[{now_iso()}] osascript failed for {rid}: {err}", file=sys.stderr)
            try:
                patch_row(base, key, rid, {"error": f"osascript: {err}"})
            except Exception:
                pass
        except Exception as e:
            print(f"[{now_iso()}] error for {rid}: {e}", file=sys.stderr)
            try:
                patch_row(base, key, rid, {"error": str(e)[:300]})
            except Exception:
                pass

    return 0


if __name__ == "__main__":
    sys.exit(main())
