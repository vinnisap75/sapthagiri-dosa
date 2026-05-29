/**
 * Thermal/impact printer client — Sapthagiri kitchen (browser side).
 *
 * WHY A BRIDGE: our kitchen printer (Star SP742 behind an IFBD-HE07/08 LAN
 * card) only accepts jobs as raw ESC/POS on TCP port 9100 — it has no WebPRNT
 * HTTP endpoint (that path 404s). Browsers can't open raw TCP sockets, and our
 * Vercel deployment lives in the cloud where it can't route to a LAN IP. So
 * the browser POSTs a ticket to a tiny print-bridge running ON the restaurant
 * LAN (scripts/print-bridge), and the bridge does the raw socket write to the
 * printer.
 *
 *   Kitchen tablet (this code)  ──POST /print {host,port,mode,ticket}──▶
 *   Print-bridge (Node, on the LAN)  ──raw ESC/POS──▶  Printer :9100
 *
 * The bridge returns a REAL success/failure (it reads the socket result), so
 * unlike the old no-cors fire-and-forget, "Test print" reflects reality.
 *
 * Mixed-content note: an https:// page can't call an http:// bridge. On the
 * kitchen tablet either run the app over http on the LAN, or give the bridge a
 * cert. See scripts/print-bridge/README.md.
 */

import {
  Ticket,
  PrinterMode,
  renderTicket,
  orderToTicket,
} from "./ticket";

// Re-export so existing importers (app/kitchen, app/admin) keep working.
export type { Ticket, TicketLine, PrinterMode } from "./ticket";
export { orderToTicket } from "./ticket";

// ─────────── public API ───────────

export interface PrinterConfig {
  brand: "star" | "epson";
  /** LAN IP of the printer, e.g. "10.1.10.200". No scheme, no port. */
  host: string;
  /** Raw-print port; defaults to 9100 (JetDirect / ESC-POS raw). */
  port?: number;
  /**
   * Base URL of the LAN print-bridge, e.g. "http://10.1.10.197:4000".
   * The browser POSTs tickets here; the bridge sockets them to the printer.
   */
  bridgeUrl?: string;
  /**
   * Command dialect. Star SP742/IFBD = "starline"; Epson (and Star units in
   * ESC/POS firmware) = "escpos". Defaults from brand when omitted.
   */
  mode?: PrinterMode;
  /** Friendly label shown in the admin UI. */
  label?: string;
  /** When true, kitchen page fires a print for every NEW order it sees. */
  autoPrint?: boolean;
  /** Which services trigger auto-print:
   *   - "all":          every service (Wed, Sat, Sun)
   *   - "sat-sun-only": breakfast buffet only (Sree's most common use)
   *   - "wed-only":     Wednesday dinner only
   *  Defaults to "all" when undefined. */
  autoPrintScope?: "all" | "sat-sun-only" | "wed-only";
}

export interface PrintResult {
  ok: boolean;
  error?: string;
  /** Round-trip ms for debugging slow printers. */
  ms: number;
}

/** Default command dialect for a brand when config doesn't pin one. */
export function defaultMode(brand: PrinterConfig["brand"]): PrinterMode {
  return brand === "epson" ? "escpos" : "starline";
}

/** Persist the config in localStorage so the admin only sets IP once. */
const STORAGE_KEY = "sapthagiri-printer-config";

export function loadPrinterConfig(): PrinterConfig | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PrinterConfig) : null;
  } catch {
    return null;
  }
}

export function savePrinterConfig(cfg: PrinterConfig): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

export function clearPrinterConfig(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}

/** Top-level helper: print a ticket using the saved config. */
export async function printTicket(ticket: Ticket): Promise<PrintResult> {
  const cfg = loadPrinterConfig();
  if (!cfg) {
    return { ok: false, error: "No printer configured", ms: 0 };
  }
  return printTicketWith(cfg, ticket);
}

export async function printTicketWith(
  cfg: PrinterConfig,
  ticket: Ticket
): Promise<PrintResult> {
  if (!cfg.bridgeUrl) {
    return {
      ok: false,
      error:
        "No print-bridge URL set. Run scripts/print-bridge on a LAN machine " +
        "and add its URL in /admin/printer.",
      ms: 0,
    };
  }
  return sendToBridge(cfg, ticket);
}

/** Print a one-line test page so the admin knows the path works end to end. */
export async function printTest(cfg: PrinterConfig): Promise<PrintResult> {
  const ticket: Ticket = {
    tableId: "TEST",
    createdAt: new Date(),
    lines: [
      { qty: 1, name: "Printer test - Sapthagiri", bold: true },
      { qty: 1, name: `Brand: ${cfg.brand.toUpperCase()}` },
      { qty: 1, name: `Host: ${cfg.host}:${cfg.port ?? 9100}` },
    ],
    footer: "If you can read this, you are good to go.",
  };
  return printTicketWith(cfg, ticket);
}

// ─────────── transport: POST to the LAN bridge ───────────

/**
 * Render the ticket to bytes HERE (so the dialect/layout logic stays in one
 * place — lib/ticket.ts — shared with the on-screen preview), base64 it, and
 * POST to the bridge. The bridge stays a dumb, dependency-free relay: decode
 * base64, write to the printer socket, report the real result.
 */
async function sendToBridge(
  cfg: PrinterConfig,
  ticket: Ticket
): Promise<PrintResult> {
  const start = performance.now();
  const mode = cfg.mode ?? defaultMode(cfg.brand);
  const url = cfg.bridgeUrl!.replace(/\/+$/, "") + "/print";
  const data = bytesToBase64(renderTicket(ticket, mode));
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        host: cfg.host,
        port: cfg.port ?? 9100,
        data,
      }),
    });
    const ms = Math.round(performance.now() - start);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `Bridge HTTP ${res.status}. ${body}`.trim(), ms };
    }
    const result = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
    };
    return result.ok
      ? { ok: true, ms }
      : { ok: false, error: result.error ?? "Bridge reported failure.", ms };
  } catch (e) {
    const ms = Math.round(performance.now() - start);
    const msg = e instanceof Error ? e.message : String(e);
    let friendly = msg;
    if (/mixed content|blocked.*http/i.test(msg)) {
      friendly =
        "Browser blocked the http:// bridge from an https:// page. Open the " +
        "app over http on the kitchen tablet, or give the bridge a cert.";
    } else if (/Failed to fetch|NetworkError/i.test(msg)) {
      friendly =
        "Can't reach the print-bridge. Is it running, and on the same WiFi?";
    }
    return { ok: false, error: friendly, ms };
  }
}

// ─────────── byte rendering (re-exported for callers/tests) ───────────

/** Render a ticket to raw bytes. Thin pass-through to lib/ticket. */
export function renderTicketBytes(
  ticket: Ticket,
  mode: PrinterMode
): Uint8Array {
  return renderTicket(ticket, mode);
}

/** Browser-safe base64 of a byte array (avoids Node's Buffer). */
function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return typeof btoa !== "undefined"
    ? btoa(s)
    : Buffer.from(bytes).toString("base64");
}
