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
// ─────────── low-level opcodes ───────────
const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;
/** 32-column template — matches the SP742 / TSP100 receipt width we use. */
const COLS = 32;
const DIVIDER = "-".repeat(COLS);
/** At double-width ("font H") only ~half the columns fit per line. Lines longer
 *  than this fall back to tall-only so long dosa names stay on one line. */
const WIDE_COLS = 16;
/** A tiny byte-buffer with dialect-aware control sequences. */
class Printout {
    mode;
    buf = [];
    constructor(mode) {
        this.mode = mode;
    }
    /** Append raw control bytes. */
    raw(...bytes) {
        this.buf.push(...bytes);
        return this;
    }
    /**
     * Append text. We mask to a single byte per char (charCode & 0xff) to match
     * the printer's single-byte code page. IMPORTANT: callers must pass ASCII —
     * multi-byte glyphs (em-dash "—", middle-dot "·") get truncated to garbage,
     * so sanitizeForPrinter() upstream replaces them with ASCII equivalents.
     */
    text(s) {
        for (let i = 0; i < s.length; i++)
            this.buf.push(s.charCodeAt(i) & 0xff);
        return this;
    }
    feed(n = 1) {
        for (let i = 0; i < n; i++)
            this.buf.push(LF);
        return this;
    }
    init() {
        return this.raw(ESC, 0x40);
    }
    /**
     * n: 0 = left, 1 = center, 2 = right.
     * NOTE: only emitted in ESC/POS mode. The SP742 dot-impact unit prints the
     * Star Line alignment command (ESC GS a) as garbage, so in starline mode we
     * skip it and left-align — verified clean on the real printer.
     */
    align(n) {
        return this.mode === "starline" ? this : this.raw(ESC, 0x61, n);
    }
    bold(on) {
        if (this.mode === "starline") {
            return on ? this.raw(ESC, 0x45) : this.raw(ESC, 0x46); // ESC E / ESC F
        }
        return this.raw(ESC, 0x45, on ? 1 : 0); // ESC/POS: ESC E n
    }
    /**
     * Red ink on the SP742's 2-color ribbon. Star dot-impact uses ESC 4 (select
     * red/secondary) and ESC 5 (back to black). ESC/POS uses GS ( N for color,
     * which most cheap units ignore — so we no-op there.
     */
    red(on) {
        if (this.mode === "starline") {
            return on ? this.raw(ESC, 0x34) : this.raw(ESC, 0x35); // ESC 4 / ESC 5
        }
        return this; // ESC/POS color: skip (unsupported on our targets)
    }
    /**
     * Biggest text — table number only. Double-tall AND double-wide. On the
     * SP742 (dot impact) that's ESC h 1 + ESC W 1; double-width is fine here
     * because the table id is short, so the wide letter spacing doesn't matter.
     */
    bigOn() {
        return this.mode === "starline"
            ? this.raw(ESC, 0x68, 1, ESC, 0x57, 1) // ESC h 1 (tall) + ESC W 1 (wide)
            : this.raw(GS, 0x21, 0x33); //            ESC/POS: GS ! double w+h
    }
    bigOff() {
        return this.mode === "starline"
            ? this.raw(ESC, 0x68, 0, ESC, 0x57, 0) // cancel tall + wide
            : this.raw(GS, 0x21, 0x00);
    }
    /** Double-HEIGHT (taller). SP742 = ESC h n; ESC/POS = GS ! height bit. */
    tall(on) {
        return this.mode === "starline"
            ? this.raw(ESC, 0x68, on ? 1 : 0) // Star Line dot-impact: ESC h n
            : this.raw(GS, 0x21, on ? 0x01 : 0x00); // ESC/POS: GS ! double-height
    }
    /** Double-WIDTH (wider). SP742 = ESC W n; ESC/POS = GS ! width bit. */
    wide(on) {
        return this.mode === "starline"
            ? this.raw(ESC, 0x57, on ? 1 : 0) // Star Line dot-impact: ESC W n
            : this.raw(GS, 0x21, on ? 0x20 : 0x00); // ESC/POS: GS ! double-width
    }
    /**
     * Print one line at a given style, then reset and feed. Centralizes the
     * on/off bracketing so we never leak a style into the next line.
     */
    styled(s, o = {}) {
        if (o.red)
            this.red(true);
        if (o.bold)
            this.bold(true);
        if (o.tall)
            this.tall(true);
        if (o.wide)
            this.wide(true);
        this.text(s);
        if (o.wide)
            this.wide(false);
        if (o.tall)
            this.tall(false);
        if (o.bold)
            this.bold(false);
        if (o.red)
            this.red(false);
        return this.feed();
    }
    /** Feed and partial-cut. No-op on printers without a cutter (e.g. SP742). */
    cut() {
        return this.mode === "starline"
            ? this.raw(ESC, 0x64, 0x03) // Star Line: ESC d 3 (feed + partial cut)
            : this.raw(GS, 0x56, 0x01); //  ESC/POS:  GS V 1
    }
    bytes() {
        return new Uint8Array(this.buf);
    }
}
// ─────────── rendering ───────────
/**
 * Replace non-ASCII glyphs that would corrupt on a single-byte code page with
 * safe ASCII. Centralized so both the renderer and any callers stay honest.
 */
export function sanitizeForPrinter(s) {
    return s
        .replace(/[—–]/g, "-") // em/en dash → hyphen
        .replace(/[·•]/g, "-") // middle dot / bullet → hyphen
        .replace(/[’‘]/g, "'")
        .replace(/[“”]/g, '"')
        .replace(/[^\x20-\x7e\n]/g, ""); // drop anything else non-printable ASCII
}
function formatTime(d) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
/** Compose the raw byte stream for one ticket in the given dialect. */
export function renderTicket(ticket, mode = "starline") {
    const p = new Printout(mode);
    const t = (s) => sanitizeForPrinter(s);
    // Style tiers (tuned on the real SP742):
    //   BIG  = tall + wide + bold ("font H") — the cook's action items.
    //   SUB  = tall + bold — readable, but no double-width so long lines
    //          (timestamp, dividers, footer) don't wrap off the 3" paper.
    const BIG = { tall: true, wide: true, bold: true };
    const SUB = { tall: true, bold: true };
    p.init();
    // Table id — the biggest thing on the slip, printed in RED (2-color ribbon).
    p.styled(t(ticket.tableId), { ...BIG, red: true });
    // Timestamp + order id row.
    let head = formatTime(ticket.createdAt);
    if (ticket.orderId)
        head += "   #" + ticket.orderId.slice(0, 6);
    p.styled(head, SUB);
    p.styled(DIVIDER, SUB);
    // Customer note (Jain, allergies, etc.).
    if (ticket.customerNote) {
        p.styled(t("NOTE: " + ticket.customerNote), SUB);
        p.styled(DIVIDER, SUB);
    }
    // Line items — qty × name at BIG (font H) when it fits the double-width
    // line, else tall+bold so long names stay on one line. Sub-lines at SUB.
    for (const line of ticket.lines) {
        const label = t(`${line.qty} x ${line.name}`);
        p.styled(label, label.length <= WIDE_COLS ? BIG : SUB);
        if (line.notes) {
            for (const n of line.notes)
                p.styled(t("    " + n), SUB);
        }
    }
    // Buffet total — big, so the cook sees the count at a glance.
    if (ticket.total != null) {
        p.styled(DIVIDER, SUB);
        p.styled(`${ticket.total} Dosas`, BIG);
    }
    // Footer (e.g. the TEST marker).
    if (ticket.footer) {
        p.styled(DIVIDER, SUB);
        p.styled(t(ticket.footer), SUB);
    }
    // Minimal feed + cut — the cut command itself advances paper to the cutter,
    // so one line is enough. Keeps slips short (no wasted paper top or bottom).
    p.feed(1).cut();
    return p.bytes();
}
/**
 * Build a human-readable preview of a ticket that mirrors renderTicket's
 * layout (same sanitization, same 32-col dividers, same ordering). Used by the
 * admin page so staff can see what the printer will produce without burning
 * paper. This is a faithful *visual* model, not a byte decode.
 */
export function previewTicket(ticket) {
    const t = (s) => sanitizeForPrinter(s);
    const out = [];
    // Mirrors renderTicket's two tiers: BIG (tall+wide+bold) for the table id and
    // item lines, SUB (tall+bold) for everything else.
    const BIG = { bold: true, tall: true, wide: true };
    const SUB = { bold: true, tall: true };
    out.push({ text: t(ticket.tableId), big: true, red: true, ...BIG });
    let head = formatTime(ticket.createdAt);
    if (ticket.orderId)
        head += "   #" + ticket.orderId.slice(0, 6);
    out.push({ text: head, ...SUB });
    out.push({ text: DIVIDER, ...SUB });
    if (ticket.customerNote) {
        out.push({ text: t("NOTE: " + ticket.customerNote), ...SUB });
        out.push({ text: DIVIDER, ...SUB });
    }
    for (const line of ticket.lines) {
        const label = t(`${line.qty} x ${line.name}`);
        out.push({ text: label, ...(label.length <= WIDE_COLS ? BIG : SUB) });
        if (line.notes)
            for (const n of line.notes)
                out.push({ text: t("    " + n), ...SUB });
    }
    if (ticket.total != null) {
        out.push({ text: DIVIDER, ...SUB });
        out.push({ text: `${ticket.total} Dosas`, ...BIG });
    }
    if (ticket.footer) {
        out.push({ text: DIVIDER, ...SUB });
        out.push({ text: t(ticket.footer), ...SUB });
    }
    return out;
}
/** A representative sample order for previews / sample prints. */
export function sampleTicket() {
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
/**
 * Short code for a buffet dosa = initials of each word, uppercased.
 *   "Sada Dosa" → "SD"   "Masala Dosa" → "MD"
 *   "Mysore Sada Dosa" → "MSD"   "Mysore Masala Dosa" → "MMD"
 * Keeps weekend lines short enough to print at full font H without shrinking.
 */
export function dosaCode(name) {
    return name
        .split(/\s+/)
        .map((w) => w[0]?.toUpperCase() ?? "")
        .join("");
}
// ─────────── conversions from app types ───────────
/**
 * Convert an OrderRow + OrderItemRow[] (from lib/supabase.ts) into a Ticket
 * the printer can consume. This is what the kitchen page calls.
 */
export function orderToTicket(opts) {
    if (opts.buffet) {
        const total = opts.items.reduce((n, i) => n + i.quantity, 0);
        return {
            tableId: opts.tableId,
            orderId: opts.orderId,
            createdAt: new Date(opts.createdAt),
            footer: opts.footer, // e.g. TEST marker; otherwise undefined
            total,
            lines: opts.items.map((i) => ({
                qty: i.quantity,
                // Short code so the line stays at full font H, no shrinking:
                //   Sada Dosa→SD, Masala Dosa→MD, Mysore Sada Dosa→MSD,
                //   Mysore Masala Dosa→MMD. (initials of each word).
                name: dosaCode(i.name),
            })),
        };
    }
    return {
        tableId: opts.tableId,
        orderId: opts.orderId,
        createdAt: new Date(opts.createdAt),
        customerNote: opts.notes ?? undefined,
        footer: opts.footer,
        lines: opts.items.map((i) => {
            const notes = [];
            const mods = [];
            if (i.crispiness)
                mods.push(i.crispiness === "crispy" ? "CRISPY" : "SOFT");
            if (i.cook_medium)
                mods.push(i.cook_medium === "ghee" ? "GHEE" : "OIL");
            if (mods.length)
                notes.push(mods.join(" - "));
            if (i.addons && i.addons.length) {
                notes.push("+ " + i.addons.map((a) => a.replace(/-/g, " ")).join(", "));
            }
            if (i.no_onion_garlic)
                notes.push("NO ONION / GARLIC");
            if (i.masala_on_side)
                notes.push("MASALA ON SIDE");
            return { qty: i.quantity, name: i.name, notes };
        }),
    };
}
