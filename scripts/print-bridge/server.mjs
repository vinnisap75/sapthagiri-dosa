/**
 * Sapthagiri print-bridge — a tiny LAN relay between the browser and the
 * kitchen printer.
 *
 * Why this exists: the printer (Star SP742 / IFBD-HE07/08) only accepts jobs
 * as raw bytes on TCP port 9100. Browsers can't open raw sockets, and the
 * Vercel-hosted app can't route to a LAN IP. So the browser renders the ticket
 * to ESC/POS bytes, base64s them, and POSTs here; this process — running on a
 * machine on the kitchen WiFi — opens the socket and writes the bytes, then
 * reports back whether the printer actually took the job.
 *
 * Dependency-free on purpose (Node core only). Run it with:
 *     npm run bridge
 * or directly:
 *     node scripts/print-bridge/server.mjs
 *
 * Env:
 *   PORT  — HTTP port to listen on (default 4000)
 *
 * Endpoints:
 *   GET  /health  → { ok: true }
 *   POST /print   → body { host, port?, data(base64) } → { ok, ms, error? }
 */

import http from "node:http";
import net from "node:net";

const PORT = Number(process.env.PORT) || 4000;
const PRINT_TIMEOUT_MS = 8000;

/** Open a raw TCP socket to the printer, write the bytes, and resolve once our
 *  write side is flushed (FIN sent). We do NOT wait for the printer to close —
 *  Star units hold the connection open after a job, which would look like a
 *  hang. A connect/write error or a connect timeout still rejects. */
function sendToPrinter(host, port, bytes) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (err) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      err ? reject(err) : resolve();
    };

    // Guards the connect phase; cleared once we've flushed our write.
    socket.setTimeout(PRINT_TIMEOUT_MS);
    socket.once("error", finish);
    socket.once("timeout", () =>
      finish(new Error(`Timed out after ${PRINT_TIMEOUT_MS}ms talking to ${host}:${port}`))
    );
    socket.connect(port, host, () => {
      socket.write(bytes);
      // end(cb) fires after all queued bytes are flushed and FIN is sent — the
      // point at which the printer has the full job.
      socket.end(() => {
        socket.setTimeout(0);
        finish();
      });
    });
  });
}

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json",
    // Allow the browser app (any origin) to read the result.
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, {});
  if (req.method === "GET" && req.url === "/health")
    return send(res, 200, { ok: true, service: "sapthagiri-print-bridge" });

  if (req.method === "POST" && req.url === "/print") {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > 5_000_000) req.destroy(); // sanity cap
    });
    req.on("end", async () => {
      const start = Date.now();
      try {
        const { host, port = 9100, data } = JSON.parse(raw || "{}");
        if (!host || typeof data !== "string") {
          return send(res, 400, { ok: false, error: "Need { host, data(base64) }" });
        }
        const bytes = Buffer.from(data, "base64");
        await sendToPrinter(host, Number(port), bytes);
        const ms = Date.now() - start;
        console.log(`[print] ${bytes.length}B → ${host}:${port} OK (${ms}ms)`);
        return send(res, 200, { ok: true, ms });
      } catch (e) {
        const ms = Date.now() - start;
        const error = e instanceof Error ? e.message : String(e);
        console.error(`[print] FAILED (${ms}ms): ${error}`);
        return send(res, 200, { ok: false, error, ms });
      }
    });
    return;
  }

  send(res, 404, { ok: false, error: "Not found" });
});

server.listen(PORT, () => {
  console.log(`Sapthagiri print-bridge listening on http://0.0.0.0:${PORT}`);
  console.log(`  health: GET  /health`);
  console.log(`  print:  POST /print  { host, port?, data(base64) }`);
});
