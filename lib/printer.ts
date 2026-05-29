/**
 * Thermal printer client — Sapthagiri kitchen.
 *
 * Supports Star WebPRNT and Epson ePOS thermal printers over HTTP on the
 * local LAN. Both speak ESC/POS at the wire level; the difference is the
 * envelope:
 *   • Star WebPRNT  → POST to /StarWebPRNT/SendMessage with a SOAP body
 *   • Epson ePOS    → POST to /cgi-bin/epos/service.cgi?devid=local_printer
 *
 * Tested with: Star TSP143IIIW, Epson TM-m30.
 *
 * For SatuSun breakfast service: auto-print every incoming order so Ravi
 * has a paper queue beside the tawa.
 * For Wed Rava Dosa: print only when Cooking Mode = Vinni (tablet at
 * front station, Ravi is the destination cook).
 *
 * The client stays in the browser — the kitchen tablet talks to the
 * printer directly over WiFi. No server round-trip = no latency.
 */

// ─────────── public API ───────────

export interface PrinterConfig {
  brand: "star" | "epson";
  /** LAN IP of the printer, e.g. "192.168.1.42". No scheme, no port. */
  host: string;
  /** Optional port override; defaults: Star 80, Epson 80. */
  port?: number;
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

export interface TicketLine {
  /** Quantity, e.g. 2. */
  qty: number;
  /** Item name, e.g. "Masala Dosa". */
  name: string;
  /** Optional notes shown indented below the item. */
  notes?: string[];
  /** Bold the line (e.g. for headers). */
  bold?: boolean;
}

export interface Ticket {
  /** Table id, e.g. "A3". Big and centered at top. */
  tableId: string;
  /** Order id slug for the kitchen to grep, e.g. "71e5c39d". */
  orderId?: string;
  /** Time the order was placed. */
  createdAt: Date;
  /** Customer-facing note (e.g. dietary restriction). */
  customerNote?: string;
  /** Line items. */
  lines: TicketLine[];
  /** Free-text footer, e.g. "RAVA DOSA — make on big tawa". */
  footer?: string;
}

export interface PrintResult {
  ok: boolean;
  error?: string;
  /** Round-trip ms for debugging slow printers. */
  ms: number;
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
  const escpos = renderEscPos(ticket);
  return cfg.brand === "star"
    ? sendStarWebPRNT(cfg, escpos)
    : sendEpsonEpos(cfg, escpos);
}

/** Print a one-line test page so the admin knows the IP works. */
export async function printTest(cfg: PrinterConfig): Promise<PrintResult> {
  const ticket: Ticket = {
    tableId: "TEST",
    createdAt: new Date(),
    lines: [
      { qty: 1, name: "Printer test — Sapthagiri", bold: true },
      { qty: 1, name: `Brand: ${cfg.brand.toUpperCase()}` },
      { qty: 1, name: `Host: ${cfg.host}` },
    ],
    footer: "If you can read this, you are good to go.",
  };
  return printTicketWith(cfg, ticket);
}

// ─────────── ESC/POS rendering ───────────

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

/** Compose the raw ESC/POS byte stream for one ticket. */
function renderEscPos(ticket: Ticket): Uint8Array {
  const buf: number[] = [];
  const push = (...bytes: number[]) => buf.push(...bytes);
  const pushText = (s: string) => {
    for (let i = 0; i < s.length; i++) buf.push(s.charCodeAt(i) & 0xff);
  };

  // Initialize printer.
  push(ESC, 0x40);

  // Big centered table id.
  push(ESC, 0x61, 0x01); // align center
  push(GS, 0x21, 0x33); // double-width + double-height
  pushText(ticket.tableId);
  push(LF);
  push(GS, 0x21, 0x00); // reset size
  push(ESC, 0x61, 0x00); // align left

  // Timestamp + order id row.
  pushText(formatTime(ticket.createdAt));
  if (ticket.orderId) {
    pushText("   #" + ticket.orderId.slice(0, 6));
  }
  push(LF);
  pushText("--------------------------------");
  push(LF);

  // Customer note (Jain, allergies, etc.).
  if (ticket.customerNote) {
    push(ESC, 0x45, 0x01); // bold on
    pushText("NOTE: " + ticket.customerNote);
    push(ESC, 0x45, 0x00); // bold off
    push(LF);
    pushText("--------------------------------");
    push(LF);
  }

  // Line items.
  for (const line of ticket.lines) {
    if (line.bold) push(ESC, 0x45, 0x01);
    pushText(`${line.qty} x ${line.name}`);
    if (line.bold) push(ESC, 0x45, 0x00);
    push(LF);
    if (line.notes) {
      for (const n of line.notes) {
        pushText("    " + n);
        push(LF);
      }
    }
  }

  // Footer.
  if (ticket.footer) {
    push(LF);
    pushText("--------------------------------");
    push(LF);
    push(ESC, 0x45, 0x01);
    pushText(ticket.footer);
    push(ESC, 0x45, 0x00);
    push(LF);
  }

  // Feed + cut.
  push(LF, LF, LF, LF);
  push(GS, 0x56, 0x01); // partial cut

  return new Uint8Array(buf);
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// ─────────── wire transports ───────────

/** Star WebPRNT — SOAP envelope, base64-encoded ESC/POS in the body. */
async function sendStarWebPRNT(
  cfg: PrinterConfig,
  bytes: Uint8Array
): Promise<PrintResult> {
  const port = cfg.port ?? 80;
  const url = `http://${cfg.host}:${port}/StarWebPRNT/SendMessage`;
  const b64 = bytesToBase64(bytes);
  // Star expects a request envelope with binary data wrapped in a
  // <PrintRequestBinary> tag. Star calls this "Binary mode".
  const body =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<PrintRequestBinary>${b64}</PrintRequestBinary>`;
  return doPost(url, body, "text/xml; charset=UTF-8");
}

/** Epson ePOS-Print — XML envelope with base64 body. */
async function sendEpsonEpos(
  cfg: PrinterConfig,
  bytes: Uint8Array
): Promise<PrintResult> {
  const port = cfg.port ?? 80;
  const url = `http://${cfg.host}:${port}/cgi-bin/epos/service.cgi?devid=local_printer&timeout=10000`;
  // Epson's "raw command transmission" wrapper: send ESC/POS as <epos-print><epos-text command-binary="base64data"/></epos-print>
  // The simpler path used by most apps: post the raw bytes with
  // Content-Type application/octet-stream. Both work on TM-m30/T82.
  const ab = (bytes as Uint8Array & {
    buffer: ArrayBufferLike;
  }).buffer.slice(0);
  return doPost(url, ab as ArrayBuffer, "application/octet-stream");
}

async function doPost(
  url: string,
  body: string | ArrayBuffer,
  contentType: string
): Promise<PrintResult> {
  const start = performance.now();
  try {
    // mode: "no-cors" — thermal printers don't return CORS headers, so we
    // fire-and-forget. The response will be opaque (we can't read it), but
    // a successful fetch() that doesn't throw means the printer accepted
    // the bytes at the TCP level. Any throw = network unreachable, mixed
    // content blocked, etc.
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": contentType },
      body: body as BodyInit,
      mode: "no-cors",
    });
    const ms = Math.round(performance.now() - start);
    return { ok: true, ms };
  } catch (e) {
    const ms = Math.round(performance.now() - start);
    const msg = e instanceof Error ? e.message : String(e);
    let friendly = msg;
    if (/mixed content|blocked.*http/i.test(msg)) {
      friendly =
        "Browser blocked HTTP→HTTPS mixed content. Open this page over http:// " +
        "on the kitchen tablet, OR allow insecure content for this site in Chrome settings.";
    } else if (/Failed to fetch|NetworkError/i.test(msg)) {
      friendly = "Network error — printer offline, wrong IP, or different WiFi?";
    }
    return { ok: false, error: friendly, ms };
  }
}

// ─────────── small utils ───────────

function bytesToBase64(bytes: Uint8Array): string {
  // Browser-safe base64. Avoids Buffer (Node-only).
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  if (typeof btoa !== "undefined") return btoa(s);
  // Node fallback (shouldn't run in our 'use client' callers).
  return Buffer.from(bytes).toString("base64");
}

// ─────────── conversions from app types ───────────

/**
 * Convert an OrderRow + OrderItemRow[] (from lib/supabase.ts) into a
 * Ticket the printer can consume. This is what kitchen page calls when
 * auto-print is on.
 */
export function orderToTicket(opts: {
  tableId: string;
  orderId: string;
  createdAt: string;
  notes?: string | null;
  items: Array<{
    quantity: number;
    name: string;
    crispiness?: "soft" | "crispy";
    cook_medium?: "oil" | "ghee";
    addons?: string[];
    no_onion_garlic?: boolean;
    masala_on_side?: boolean;
  }>;
  footer?: string;
}): Ticket {
  return {
    tableId: opts.tableId,
    orderId: opts.orderId,
    createdAt: new Date(opts.createdAt),
    customerNote: opts.notes ?? undefined,
    footer: opts.footer,
    lines: opts.items.map((i) => {
      const notes: string[] = [];
      const mods: string[] = [];
      if (i.crispiness) mods.push(i.crispiness === "crispy" ? "CRISPY" : "SOFT");
      if (i.cook_medium) mods.push(i.cook_medium === "ghee" ? "GHEE" : "OIL");
      if (mods.length) notes.push(mods.join(" · "));
      if (i.addons && i.addons.length) {
        notes.push("+ " + i.addons.map((a) => a.replace(/-/g, " ")).join(", "));
      }
      if (i.no_onion_garlic) notes.push("NO ONION / GARLIC");
      if (i.masala_on_side) notes.push("MASALA ON SIDE");
      return { qty: i.quantity, name: i.name, notes };
    }),
  };
}
