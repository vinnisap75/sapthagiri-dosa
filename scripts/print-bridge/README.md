# Sapthagiri print-bridge

A tiny relay that lets the web app print to the kitchen printer.

## Why it's needed

The kitchen printer (Star **SP742** behind an **IFBD-HE07/08** LAN card) only
accepts jobs as raw ESC/POS bytes on **TCP port 9100**. It has **no WebPRNT
HTTP endpoint** (`/StarWebPRNT/SendMessage` returns 404).

Two things block the browser from printing directly:

1. **Browsers can't open raw TCP sockets** — `fetch()` only speaks HTTP.
2. **Vercel (cloud) can't reach a LAN IP** like `10.1.10.200`.

So a machine **on the kitchen WiFi** runs this bridge. The browser renders the
ticket to bytes, base64s them, and POSTs to the bridge; the bridge writes them
to the printer socket and reports the real result.

```
Kitchen tablet (browser)  ──POST /print {host,port,data}──▶  Bridge  ──:9100──▶  Printer
```

## Run it

From the repo root, on a Mac/PC on the same WiFi as the printer:

```bash
npm run bridge          # listens on http://0.0.0.0:4000
PORT=5000 npm run bridge # custom port
```

Then in the app at **/admin/printer** set:

| Field             | Value                          |
| ----------------- | ------------------------------ |
| Brand             | Star (WebPRNT)                 |
| Host              | `10.1.10.200` (the printer IP) |
| Port              | `9100`                         |
| Print bridge URL  | `http://<this-machine-ip>:4000`|

Hit **Test print** / **Print sample order**. A green result means the printer
actually accepted the bytes (not a fire-and-forget guess).

## Mixed content (the production gotcha)

The app is served over `https://` (Vercel) but this bridge is `http://`, and
browsers block https→http across origins.

**Recommended for production:** run the bridge on the **same machine** as the
kitchen browser and set the bridge URL to **`http://localhost:4000`**. Browsers
treat `localhost` / `127.0.0.1` as trustworthy and do **not** apply the
mixed-content block — so it works straight from the https app, no cert, no
flags. (This is why the app defaults the field to `http://localhost:4000`.)

If the bridge must live on a **different** LAN box than the browser:

- Allow "Insecure content" for the site (lock icon → Site settings), or
- Put a TLS cert in front of the bridge, or
- Open the app over `http://` on the LAN.

## Keep it running

Use `pm2`, a `launchd` plist (macOS), or a `systemd` unit so the bridge starts
at boot and restarts if it crashes. Example with pm2:

```bash
npx pm2 start scripts/print-bridge/server.mjs --name sapthagiri-bridge
npx pm2 save
```

## Endpoints

- `GET /health` → `{ ok: true }`
- `POST /print` body `{ host, port?, data }` (`data` = base64 ESC/POS) →
  `{ ok, ms, error? }`
