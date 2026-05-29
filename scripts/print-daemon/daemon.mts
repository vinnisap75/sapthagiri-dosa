/**
 * Sapthagiri headless PRINT DAEMON.
 *
 * Runs on an always-on machine on the restaurant LAN (Mac mini / Raspberry Pi /
 * spare PC). Watches Supabase for new orders and prints each one to the kitchen
 * printer — with NO tablet, NO browser, and NO one logged in. The Kitchen Board
 * becomes optional; printing no longer depends on any client device.
 *
 *   Customer → Send to kitchen → Supabase (cloud)
 *                                    │  this daemon polls every ~2s
 *                                    ▼
 *            LAN box: print-daemon ──renders ticket──▶ printer :9100
 *
 * It authenticates with the Supabase SERVICE-ROLE key (RLS now requires staff
 * auth to read orders). That secret lives ONLY in scripts/print-daemon/printer.env
 * on this box — never in the app, never in git.
 *
 * Dedupe: each printed order gets orders.printed_at set, so restarts never
 * reprint. A failed print leaves printed_at null → retried next tick.
 *
 * Run:  npm run daemon       (reads scripts/print-daemon/printer.env)
 * Boot: see README (launchd on macOS / systemd on Linux).
 */

import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { orderToTicket, renderTicket, type PrinterMode } from "../../lib/ticket";
import { getActiveService } from "../../lib/services";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ─────────── config (printer.env on this box, or real env vars) ───────────

function loadEnvFile(): void {
  const file = process.env.PRINTER_ENV || path.join(HERE, "printer.env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}
loadEnvFile();

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const PRINTER_HOST = process.env.PRINTER_HOST || "10.1.10.200";
const PRINTER_PORT = Number(process.env.PRINTER_PORT || 9100);
const PRINTER_MODE = (process.env.PRINTER_MODE as PrinterMode) || "starline";
const POLL_MS = Number(process.env.POLL_MS || 2000);
const LOOKBACK_HOURS = Number(process.env.LOOKBACK_HOURS || 6);

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    "FATAL: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.\n" +
      "Copy scripts/print-daemon/printer.env.example → printer.env and fill it in."
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ─────────── raw printing (direct socket, same as the bridge) ───────────

function sendToPrinter(bytes: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    const sock = new net.Socket();
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      err ? reject(err) : resolve();
    };
    sock.setTimeout(8000);
    sock.once("error", finish);
    sock.once("timeout", () =>
      finish(new Error(`printer timeout ${PRINTER_HOST}:${PRINTER_PORT}`))
    );
    sock.connect(PRINTER_PORT, PRINTER_HOST, () => {
      sock.write(Buffer.from(bytes));
      // Resolve on write-flush, NOT socket close — the SP742 holds the
      // connection open after a job (waiting for close = false 8s "hang").
      sock.end(() => {
        sock.setTimeout(0);
        finish();
      });
    });
  });
}

// ─────────── poll loop ───────────

interface ItemRow {
  quantity: number;
  name: string;
  crispiness?: "soft" | "crispy";
  cook_medium?: "oil" | "ghee";
  addons?: string[];
  no_onion_garlic?: boolean;
}
interface OrderRow {
  id: string;
  table_id: string;
  created_at: string;
  notes: string | null;
  status: string;
  is_test: boolean;
  order_items: ItemRow[];
}

/** Orders currently being printed this tick — guards against the same row
 *  being picked up twice before printed_at lands. */
const inFlight = new Set<string>();

async function tick(): Promise<void> {
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

  for (const row of (data ?? []) as OrderRow[]) {
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
      if (upErr) {
        // Printed but couldn't mark — log loudly; may reprint next tick.
        console.error("[mark-printed FAILED]", row.id, upErr.message);
      }
      console.log(
        `[printed] ${row.table_id} #${row.id.slice(0, 6)} ` +
          `${(row.order_items ?? []).length} items${buffet ? " (buffet)" : ""}` +
          `${row.is_test ? " (TEST)" : ""}`
      );
    } catch (e) {
      // Leave printed_at null → retried next tick.
      console.error(
        "[print FAILED]",
        row.id,
        e instanceof Error ? e.message : String(e)
      );
    } finally {
      inFlight.delete(row.id);
    }
  }
}

console.log(
  `Sapthagiri print-daemon up → ${PRINTER_HOST}:${PRINTER_PORT} ` +
    `(${PRINTER_MODE}), polling every ${POLL_MS}ms`
);
let running = false;
setInterval(async () => {
  if (running) return; // skip if a slow tick is still going
  running = true;
  try {
    await tick();
  } finally {
    running = false;
  }
}, POLL_MS);
