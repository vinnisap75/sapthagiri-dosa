/**
 * Ticket model + ESC/POS rendering — Sapthagiri kitchen.
 *
 * Runtime-neutral on purpose: NO `window`, NO `fetch`, NO `Buffer`. This file
 * is imported by both the browser (lib/printer.ts) and the Node print-bridge
 * (scripts/print-bridge/server.mjs), so the exact same bytes get produced on
 * both sides. Keep it dependency-free.
 *
 * Command dialect matters. Our actual kitchen printer is a Star SP742 (impact)
 * behind an IFBD-HE07/08 LAN card — it speaks STAR LINE mode, not ESC/POS.
 * Epson units (and Star printers flipped to ESC/POS firmware) speak ESC/POS.
 * The two disagree on bold / character-size / cut, so `renderTicket` takes a
 * `mode` and emits the right opcodes per dialect. Plain text + line feeds are
 * identical in both.
 */

// ─────────── public types ───────────

export type PrinterMode = "starline" | "escpos";

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

// ─────────── low-level opcodes ───────────

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

/** 32-column template — matches the SP742 / TSP100 receipt width we use. */
const COLS = 32;
const DIVIDER = "-".repeat(COLS);

/** A tiny byte-buffer with dialect-aware control sequences. */
class Printout {
  private buf: number[] = [];
  constructor(private mode: PrinterMode) {}

  /** Append raw control bytes. */
  raw(...bytes: number[]): this {
    this.buf.push(...bytes);
    return this;
  }

  /**
   * Append text. We mask to a single byte per char (charCode & 0xff) to match
   * the printer's single-byte code page. IMPORTANT: callers must pass ASCII —
   * multi-byte glyphs (em-dash "—", middle-dot "·") get truncated to garbage,
   * so sanitizeForPrinter() upstream replaces them with ASCII equivalents.
   */
  text(s: string): this {
    for (let i = 0; i < s.length; i++) this.buf.push(s.charCodeAt(i) & 0xff);
    return this;
  }

  feed(n = 1): this {
    for (let i = 0; i < n; i++) this.buf.push(LF);
    return this;
  }

  init(): this {
    return this.raw(ESC, 0x40);
  }

  /** n: 0 = left, 1 = center, 2 = right. */
  align(n: 0 | 1 | 2): this {
    return this.mode === "starline"
      ? this.raw(ESC, GS, 0x61, n) // Star Line: ESC GS a n
      : this.raw(ESC, 0x61, n); //     ESC/POS:  ESC a n
  }

  bold(on: boolean): this {
    if (this.mode === "starline") {
      return on ? this.raw(ESC, 0x45) : this.raw(ESC, 0x46); // ESC E / ESC F
    }
    return this.raw(ESC, 0x45, on ? 1 : 0); // ESC/POS: ESC E n
  }

  /** Toggle double-width + double-height for the table header. */
  bigOn(): this {
    return this.mode === "starline"
      ? this.raw(ESC, 0x69, 1, 1) // Star Line: ESC i n1 n2 (height, width)
      : this.raw(GS, 0x21, 0x33); //  ESC/POS:  GS ! (double w+h)
  }

  bigOff(): this {
    return this.mode === "starline"
      ? this.raw(ESC, 0x69, 0, 0)
      : this.raw(GS, 0x21, 0x00);
  }

  /**
   * Double-HEIGHT (taller, same width) for the whole ticket body. Keeps the
   * full 32 columns so long dosa names don't wrap, while making every line big
   * enough for Ravi to read at a glance from across a busy tawa station.
   */
  tall(on: boolean): this {
    return this.mode === "starline"
      ? this.raw(ESC, 0x69, on ? 1 : 0, 0) // Star Line: ESC i height=1 width=0
      : this.raw(GS, 0x21, on ? 0x01 : 0x00); // ESC/POS: GS ! double-height
  }

  /** Feed and partial-cut. No-op on printers without a cutter (e.g. SP742). */
  cut(): this {
    return this.mode === "starline"
      ? this.raw(ESC, 0x64, 0x03) // Star Line: ESC d 3 (feed + partial cut)
      : this.raw(GS, 0x56, 0x01); //  ESC/POS:  GS V 1
  }

  bytes(): Uint8Array {
    return new Uint8Array(this.buf);
  }
}

// ─────────── rendering ───────────

/**
 * Replace non-ASCII glyphs that would corrupt on a single-byte code page with
 * safe ASCII. Centralized so both the renderer and any callers stay honest.
 */
export function sanitizeForPrinter(s: string): string {
  return s
    .replace(/[—–]/g, "-") // em/en dash → hyphen
    .replace(/[·•]/g, "-") // middle dot / bullet → hyphen
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x20-\x7e\n]/g, ""); // drop anything else non-printable ASCII
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Compose the raw byte stream for one ticket in the given dialect. */
export function renderTicket(
  ticket: Ticket,
  mode: PrinterMode = "starline"
): Uint8Array {
  const p = new Printout(mode);
  const t = (s: string) => sanitizeForPrinter(s);

  p.init();

  // Big centered table id (double width + height — the biggest thing on paper).
  p.align(1).bigOn().text(t(ticket.tableId)).feed().bigOff().align(0);

  // Everything below prints double-height so the whole ticket is readable from
  // across the kitchen, not just the table id.
  p.tall(true);

  // Timestamp + order id row.
  p.text(formatTime(ticket.createdAt));
  if (ticket.orderId) p.text("   #" + ticket.orderId.slice(0, 6));
  p.feed().text(DIVIDER).feed();

  // Customer note (Jain, allergies, etc.).
  if (ticket.customerNote) {
    p.bold(true).text(t("NOTE: " + ticket.customerNote)).bold(false).feed();
    p.text(DIVIDER).feed();
  }

  // Line items — the qty × name line is always bold (the part the cook acts on).
  for (const line of ticket.lines) {
    p.bold(true).text(t(`${line.qty} x ${line.name}`)).bold(false).feed();
    if (line.notes) {
      for (const n of line.notes) p.text(t("    " + n)).feed();
    }
  }

  // Footer.
  if (ticket.footer) {
    p.feed().text(DIVIDER).feed();
    p.bold(true).text(t(ticket.footer)).bold(false).feed();
  }

  // Back to normal size, then feed + cut.
  p.tall(false);
  p.feed(4).cut();

  return p.bytes();
}

// ─────────── on-screen preview ───────────

export interface PreviewLine {
  text: string;
  bold?: boolean;
  /** Rendered larger + centered (the table header — double width + height). */
  big?: boolean;
  center?: boolean;
  /** Double-height body line (matches renderTicket's tall() body). */
  tall?: boolean;
}

/**
 * Build a human-readable preview of a ticket that mirrors renderTicket's
 * layout (same sanitization, same 32-col dividers, same ordering). Used by the
 * admin page so staff can see what the printer will produce without burning
 * paper. This is a faithful *visual* model, not a byte decode.
 */
export function previewTicket(ticket: Ticket): PreviewLine[] {
  const t = (s: string) => sanitizeForPrinter(s);
  const out: PreviewLine[] = [];

  out.push({ text: t(ticket.tableId), big: true, center: true });

  // Everything below the header prints double-height (tall) — mirrors
  // renderTicket so the preview shows the real, readable-from-across-the-room size.
  let head = formatTime(ticket.createdAt);
  if (ticket.orderId) head += "   #" + ticket.orderId.slice(0, 6);
  out.push({ text: head, tall: true });
  out.push({ text: DIVIDER, tall: true });

  if (ticket.customerNote) {
    out.push({ text: t("NOTE: " + ticket.customerNote), bold: true, tall: true });
    out.push({ text: DIVIDER, tall: true });
  }

  for (const line of ticket.lines) {
    out.push({ text: t(`${line.qty} x ${line.name}`), bold: true, tall: true });
    if (line.notes)
      for (const n of line.notes) out.push({ text: t("    " + n), tall: true });
  }

  if (ticket.footer) {
    out.push({ text: DIVIDER, tall: true });
    out.push({ text: t(ticket.footer), bold: true, tall: true });
  }

  return out;
}

/** A representative sample order for previews / sample prints. */
export function sampleTicket(): Ticket {
  return {
    tableId: "A3",
    orderId: "71e5c39d",
    createdAt: new Date(),
    customerNote: "Jain — no onion/garlic",
    lines: [
      { qty: 2, name: "Masala Dosa", notes: ["CRISPY · GHEE"] },
      { qty: 1, name: "Rava Dosa", notes: ["+ extra chutney"] },
      { qty: 1, name: "Plain Dosa", notes: ["SOFT · OIL", "MASALA ON SIDE"] },
    ],
    footer: "*** TEST ORDER — DO NOT MAKE ***",
  };
}

// ─────────── conversions from app types ───────────

/**
 * Convert an OrderRow + OrderItemRow[] (from lib/supabase.ts) into a Ticket
 * the printer can consume. This is what the kitchen page calls.
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
      if (mods.length) notes.push(mods.join(" - "));
      if (i.addons && i.addons.length) {
        notes.push("+ " + i.addons.map((a) => a.replace(/-/g, " ")).join(", "));
      }
      if (i.no_onion_garlic) notes.push("NO ONION / GARLIC");
      if (i.masala_on_side) notes.push("MASALA ON SIDE");
      return { qty: i.quantity, name: i.name, notes };
    }),
  };
}
