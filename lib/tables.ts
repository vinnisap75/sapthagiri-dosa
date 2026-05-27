// Sapthagiri dining-room layout taken from the Clover Dining tablet screenshot.
// Each table id is what the QR code encodes (`/order?table=A3`).

export interface DiningTable {
  id: string;
  seats: number;
  section: "A" | "B" | "C" | "Other";
}

export const TABLES: DiningTable[] = [
  // Section A — 7 customer tables, 6 seats each (A8 excluded per request)
  { id: "A1", seats: 6, section: "A" },
  { id: "A2", seats: 6, section: "A" },
  { id: "A3", seats: 6, section: "A" },
  { id: "A4", seats: 6, section: "A" },
  { id: "A5", seats: 6, section: "A" },
  { id: "A6", seats: 6, section: "A" },
  { id: "A7", seats: 6, section: "A" },

  // Section B — small 2-tops + larger 4-tops
  { id: "B1", seats: 2, section: "B" },
  { id: "B2", seats: 2, section: "B" },
  { id: "B3", seats: 2, section: "B" },
  { id: "B4", seats: 4, section: "B" },
  { id: "B5", seats: 4, section: "B" },
  { id: "B6", seats: 4, section: "B" },
  { id: "B7", seats: 4, section: "B" },

  // Section C — 4 four-tops
  { id: "C1", seats: 4, section: "C" },
  { id: "C2", seats: 4, section: "C" },
  { id: "C3", seats: 4, section: "C" },
  { id: "C4", seats: 4, section: "C" },

  // Station, PURV, and Reserved areas intentionally excluded from QR codes —
  // they're not customer-facing tables.
];

export const TABLE_IDS: string[] = TABLES.map((t) => t.id);

export function isValidTable(id: string | null | undefined): boolean {
  if (!id) return false;
  return TABLE_IDS.includes(id);
}
