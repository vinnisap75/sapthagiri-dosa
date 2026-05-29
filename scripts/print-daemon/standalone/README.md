# Standalone print-daemon — Android tablet (Termux), Pi, or any laptop

Self-contained kitchen print daemon. **One dependency**, plain `node`, no build
tools — so it runs reliably on a low-power always-on host. Prints every order to
the Star SP742 with nothing open, no login, no tablet screen.

`ticket.js` / `services.js` are compiled from `lib/`. Regenerate after changing
those sources with `npm run build:daemon` from the repo root.

---

## A) Lenovo Android tablet (Termux) — the restaurant's always-on host

The tablet runs the daemon in **Termux** (a real Linux environment). Screen can
be off. Keep it **plugged in and on the kitchen WiFi.**

### 1. Install the apps (from F-Droid — NOT the Play Store)
- **Termux**: https://f-droid.org/packages/com.termux/
- **Termux:Boot**: https://f-droid.org/packages/com.termux.boot/  (auto-start at boot)

### 2. In Termux
```bash
pkg update -y && pkg install -y nodejs git
git clone https://github.com/vinnisap75/sapthagiri-dosa.git
cd sapthagiri-dosa/scripts/print-daemon/standalone
npm install                         # just @supabase/supabase-js
cp printer.env.example printer.env
nano printer.env                    # paste the ROTATED service-role key, save
node daemon.mjs                     # TEST: place an order, watch it print. Ctrl-C to stop.
```
> If the daemon code lives on a branch not yet merged to `main`, after cloning
> run `git checkout <branch>` first (ask Sree which branch).

### 3. Stop Android from killing it
- Settings → Apps → **Termux** → Battery → **Unrestricted** (no optimization).
- Keep the tablet **plugged in**.

### 4. Auto-start on boot (so a reboot doesn't stop printing)
```bash
mkdir -p ~/.termux/boot
cat > ~/.termux/boot/print-daemon.sh <<'EOF'
#!/data/data/com.termux/files/usr/bin/sh
termux-wake-lock
cd ~/sapthagiri-dosa/scripts/print-daemon/standalone
node daemon.mjs >> ~/print-daemon.log 2>&1
EOF
chmod +x ~/.termux/boot/print-daemon.sh
```
Reboot the tablet once to confirm it auto-starts. Logs: `cat ~/print-daemon.log`.

---

## B) Raspberry Pi / Linux / laptop

```bash
git clone https://github.com/vinnisap75/sapthagiri-dosa.git
cd sapthagiri-dosa/scripts/print-daemon/standalone
npm install
cp printer.env.example printer.env   # fill SUPABASE_SERVICE_ROLE_KEY (rotated)
node daemon.mjs
```
For boot auto-start use the `sapthagiri-printdaemon.service` (systemd) one folder
up, pointing `ExecStart` at `node .../standalone/daemon.mjs`.

---

## Notes
- The migration `004_print_daemon.sql` must be applied (adds `printed_at`).
- `printer.env` holds the **service-role key** — gitignored, never commit/share.
  If it ever leaks, rotate it in Supabase → Settings → API.
- Don't let the host **sleep**; it must stay on during service to print.
