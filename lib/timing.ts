// Wait-time estimator for the kitchen.
//
// Assumptions:
//   • The dosa master can have up to PARALLEL_SLOTS items cooking at once.
//   • Each menu item has a per-item cookMinutes (6 for dosa, 8.5 for uttapam).
//   • An order's cook time = max(cookMinutes) across its items (cooked together).
//   • Wait time for a "queued" order = remaining time of all "cooking" orders
//     ahead of you, plus the cook time of any other "queued" orders that have
//     to grab a slot before you, divided across PARALLEL_SLOTS.
//
// This is intentionally simple — it gives the customer a realistic ballpark
// without trying to be a full job-scheduling simulator.

import type { MenuItem } from "./menu";
import { getItem } from "./menu";

export const PARALLEL_SLOTS = 4;

// How many active orders the kitchen display shows in the "batch" at once.
// You said batches of 3 — we surface that here so it's easy to tune.
export const DISPLAY_BATCH = 3;

export type OrderStatus = "queued" | "cooking" | "ready" | "served" | "cancelled";

export interface OrderItemLite {
  menu_item_id: string;
  quantity: number;
}

export interface OrderLite {
  id: string;
  status: OrderStatus;
  created_at: string;          // ISO
  cooking_started_at: string | null;  // ISO when master hit "Start"
  items: OrderItemLite[];
}

/** Total cook minutes for a single order — items cook in parallel on the
 *  master's tava, so we take the slowest item.  Each unit of quantity adds
 *  a tiny bit so quantity > 1 isn't free, but only modestly. */
export function orderCookMinutes(items: OrderItemLite[]): number {
  if (items.length === 0) return 0;
  let maxBase = 0;
  let totalUnits = 0;
  for (const it of items) {
    const m: MenuItem | undefined = getItem(it.menu_item_id);
    if (!m) continue;
    if (m.cookMinutes > maxBase) maxBase = m.cookMinutes;
    totalUnits += it.quantity;
  }
  // Add 1 min per extra unit beyond the first, capped to keep it sane.
  const extras = Math.max(0, totalUnits - 1);
  return maxBase + Math.min(extras, 6);
}

/** Minutes remaining for a single order based on its status + timestamps. */
export function remainingMinutes(order: OrderLite, now = new Date()): number {
  const total = orderCookMinutes(order.items);
  if (order.status === "ready" || order.status === "served") return 0;
  if (order.status === "cooking" && order.cooking_started_at) {
    const startedMs = new Date(order.cooking_started_at).getTime();
    const elapsedMin = (now.getTime() - startedMs) / 60000;
    return Math.max(0, total - elapsedMin);
  }
  return total;
}

/**
 * Estimate the wait time for `target` given the active queue.
 * `queue` is FIFO-ordered, oldest first, contains only "queued" or "cooking" orders.
 * Returns minutes until target finishes cooking.
 */
export function estimateWaitMinutes(
  target: OrderLite,
  queue: OrderLite[],
  now = new Date()
): number {
  // Sort cooking orders by remaining time ascending (they'll free slots first).
  const cooking = queue
    .filter((o) => o.status === "cooking")
    .map((o) => remainingMinutes(o, now))
    .sort((a, b) => a - b);

  // Initialise slot end-times.  An empty slot = 0 (free now).
  const slots: number[] = new Array(PARALLEL_SLOTS).fill(0);
  for (let i = 0; i < Math.min(cooking.length, PARALLEL_SLOTS); i++) {
    slots[i] = cooking[i];
  }
  // Keep slots ascending.
  slots.sort((a, b) => a - b);

  // Walk through every queued order ahead of target (in FIFO order).
  const queuedAhead = queue.filter(
    (o) => o.status === "queued" && new Date(o.created_at) < new Date(target.created_at)
  );

  for (const q of queuedAhead) {
    const cook = orderCookMinutes(q.items);
    // Assign to earliest-free slot.
    slots[0] += cook;
    slots.sort((a, b) => a - b);
  }

  // Now place target itself.
  if (target.status === "cooking") {
    return remainingMinutes(target, now);
  }
  const targetCook = orderCookMinutes(target.items);
  const finish = slots[0] + targetCook;
  return Math.max(0, Math.round(finish));
}

/** Friendly range string e.g. "8 – 11 min". */
export function waitRangeLabel(mins: number): string {
  if (mins <= 0) return "Ready!";
  const low = Math.max(1, Math.round(mins - 2));
  const high = Math.round(mins + 2);
  if (low === high) return `${low} min`;
  return `${low} – ${high} min`;
}
