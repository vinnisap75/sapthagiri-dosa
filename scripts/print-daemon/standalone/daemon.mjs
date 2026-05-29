/**
 * Sapthagiri print-daemon — STANDALONE build for a low-power always-on host
 * (Lenovo Android tablet via Termux, Raspberry Pi, old laptop...).
 *
 * Self-contained: plain Node + ONE dependency (@supabase/supabase-js). No tsx,
 * no Next, no build tools — so it installs cleanly on Termux/Android.
 *
 * ticket.js / services.js here are COMPILED from lib/ticket.ts + lib/services.ts.
 * If those sources change, regenerate with:  npm run build:daemon  (repo root).
 *
 * Setup + auto-start: see scripts/print-daemon/standalone/README.md.
 */

import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { orderToTicket, renderTicket } from "./ticket.js";
import { getActiveService } from "./services.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ── config (printer.env beside this file, or real env vars) ──
const file = process.env.PRINTER_ENV || path.join(HERE, "printer.env");
if (fs.existsSync(file)) {
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined)
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const PRINTER_HOST = process.env.PRINTER_HOST || "10.1.10.200";
const PRINTER_PORT = Number(process.env.PRINTER_PORT || 9100);
const PRINTER_MODE = process.env.PRINTER_MODE || "starline";
const POLL_MS = Number(process.env.POLL_MS || 2000);
const LOOKBACK_HOURS = Number(process.env.LOOKBACK_HOURS || 6);

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    "FATAL: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in printer.env " +
      "(copy printer.env.example)."
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function sendToPrinter(bytes) {
  return new Promise((resolve, reject) => {
    const sock = new net.Socket();
    let settled = false;
    const finish = (err) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      err ? reject(err) : resolve();
    };
    sock.setTimeout(8000);
    sock.once("error", finish);
    sock.once("timeout", () => finish(new Error("printer timeout")));
    sock.connect(PRINTER_PORT, PRINTER_HOST, () => {
      sock.write(Buffer.from(bytes));
      // Resolve on write-flush, not socket close (SP742 keeps it open).
      sock.end(() => {
        sock.setTimeout(0);
        finish();
      });
    });
  });
}

const inFlight = new Set();

async function tick() {
  const sinceIso = new Date(
    Date.now() - LOOKBACK_HOURS * 3600 * 1000
  ).toISOString();
  const { data, error } = await supabase
    .from("orders")
    .select("*, order_items(*)")
    .is("printed_at", null)
    .in("status", ["queued", "cooking"])
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: true });
  if (error) {
    console.error("[poll]", error.message);
    return;
  }
  for (const row of data ?? []) {
    if (inFlight.has(row.id)) continue;
    inFlight.add(row.id);
    try {
      const svc = getActiveService(new Date(row.created_at));
      const buffet = svc?.menu === "limited";
      const ticket = orderToTicket({
        tableId: row.table_id,
        orderId: row.id,
        createdAt: row.created_at,
        notes: row.notes,
        items: (row.order_items ?? []).map((i) => ({
          quantity: i.quantity,
          name: i.name,
          crispiness: i.crispiness,
          cook_medium: i.cook_medium,
          addons: i.addons,
          no_onion_garlic: i.no_onion_garlic,
        })),
        buffet,
        footer: row.is_test ? "*** TEST ORDER - DO NOT MAKE ***" : undefined,
      });
      await sendToPrinter(renderTicket(ticket, PRINTER_MODE));
      const { error: upErr } = await supabase
        .from("orders")
        .update({ printed_at: new Date().toISOString() })
        .eq("id", row.id);
      if (upErr) console.error("[mark-printed FAILED]", row.id, upErr.message);
      console.log(
        `[printed] ${row.table_id} #${row.id.slice(0, 6)} ` +
          `${(row.order_items ?? []).length} items${buffet ? " (buffet)" : ""}` +
          `${row.is_test ? " (TEST)" : ""}`
      );
    } catch (e) {
      console.error("[print FAILED]", row.id, e?.message ?? e);
    } finally {
      inFlight.delete(row.id);
    }
  }
}

console.log(
  `Sapthagiri print-daemon (standalone) up → ${PRINTER_HOST}:${PRINTER_PORT} ` +
    `(${PRINTER_MODE}), polling ${POLL_MS}ms`
);
let running = false;
setInterval(async () => {
  if (running) return;
  running = true;
  try {
    await tick();
  } finally {
    running = false;
  }
}, POLL_MS);
