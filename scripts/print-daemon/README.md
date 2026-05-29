# Sapthagiri print-daemon

Prints every new order to the kitchen printer **with no tablet, no browser, no
login** — so Android tablets, Macs, and phones all "just work" because printing
no longer depends on any of them.

## How it works

```
Customer → Send to kitchen → Supabase (cloud)
                                 │   daemon polls every ~2s (service-role key)
                                 ▼
       LAN box: print-daemon ──renders ticket──▶ Star SP742 :9100
```

- Runs on ONE always-on machine on the restaurant WiFi (Mac mini / Raspberry Pi
  / spare PC). Required because the printer is LAN-only and Vercel (cloud) can't
  reach it. An Android tablet or phone **can't** host this (no Node).
- Reads orders with the Supabase **service-role key** (RLS requires staff auth).
- Renders with the same `lib/ticket.ts` as everything else (red table id, font
  H, weekend buffet short codes).
- Sets `orders.printed_at` so it never double-prints and survives restarts.

## One-time setup on the LAN box

```bash
git clone <repo> sapthagiri-dosa && cd sapthagiri-dosa
npm install
cp scripts/print-daemon/printer.env.example scripts/print-daemon/printer.env
# edit printer.env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PRINTER_HOST
npm run daemon          # foreground test — place an order, watch it print
```

Get the service-role key from **Supabase Dashboard → Project Settings → API →
service_role**. It's a secret: it stays in `printer.env` (gitignored) on this
box only.

## Run it forever (auto-start at boot)

**macOS (launchd):** edit `REPO_PATH` in `com.sapthagiri.printdaemon.plist`, then

```bash
cp scripts/print-daemon/com.sapthagiri.printdaemon.plist ~/Library/LaunchAgents/
launchctl load -w ~/Library/LaunchAgents/com.sapthagiri.printdaemon.plist
tail -f /tmp/sapthagiri-printdaemon.log
```

**Raspberry Pi / Linux (systemd):** edit `User=`/`WorkingDirectory=` in
`sapthagiri-printdaemon.service`, then

```bash
sudo cp scripts/print-daemon/sapthagiri-printdaemon.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now sapthagiri-printdaemon
journalctl -u sapthagiri-printdaemon -f
```

## Notes

- **Don't let the box sleep.** On a Mac: System Settings → Energy → "Prevent
  automatic sleeping" (or `caffeinate`). A sleeping box won't print.
- The migration `supabase/migrations/004_print_daemon.sql` adds `printed_at` and
  marks all existing orders printed, so first start doesn't spew history.
- This replaces the need to keep `/kitchen` open for printing. The Kitchen Board
  still works for viewing/managing; it's just no longer required to print.
- `scripts/print-bridge/` (the browser→printer relay) is still there for the
  Kitchen Board's manual "print" button; the daemon is the always-on auto-print.
