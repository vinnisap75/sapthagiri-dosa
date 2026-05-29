// Service-window configuration for the customer-facing /order page.
//
// Sapthagiri now runs three service windows. Digital ordering OPENS ONE HOUR
// BEFORE each service so guests can order ahead, and closes at service end:
//   • Wednesday Dosa Night          5:00 PM – 10:30 PM   (full menu; service 6 PM)
//   • Saturday Breakfast Buffet     7:00 AM – 12:00 PM   (4-dosa limited; service 8 AM)
//   • Sunday Breakfast Buffet       7:00 AM – 12:00 PM   (4-dosa limited; service 8 AM)
//
// The /order page uses getActiveService() to decide whether the digital menu
// is open right now, and which menu to show.  Staff can bypass by signing in
// (or by appending ?preview=1).

export type ServiceMenu = "full" | "limited";

export interface ServiceWindow {
  id: "wednesday" | "saturday" | "sunday";
  name: string;
  dayOfWeek: number;        // 0=Sun ... 6=Sat
  openMins: number;         // minutes since midnight
  closeMins: number;
  menu: ServiceMenu;
  showRavaDosaButton: boolean;
  /** Show the Jain-style "no onion, no garlic" toggle on masala dosas.
   *  Off for the Sat/Sun breakfast buffet by request — Vinni's kitchen
   *  doesn't run a separate Jain masala on weekends. */
  allowJainModifier: boolean;
}

export const SERVICES: ServiceWindow[] = [
  { id: "wednesday", name: "Dosa Night",                 dayOfWeek: 3, openMins: 17 * 60, closeMins: 22 * 60 + 30, menu: "full",    showRavaDosaButton: true,  allowJainModifier: true  },
  { id: "saturday",  name: "Saturday Breakfast Buffet",  dayOfWeek: 6, openMins:  7 * 60, closeMins: 12 * 60,      menu: "limited", showRavaDosaButton: false, allowJainModifier: false },
  { id: "sunday",    name: "Sunday Breakfast Buffet",    dayOfWeek: 0, openMins:  7 * 60, closeMins: 12 * 60,      menu: "limited", showRavaDosaButton: false, allowJainModifier: false },
];

/** Menu items available during a "limited" (breakfast buffet) service. */
export const LIMITED_MENU_IDS = [
  "sada-dosa",
  "masala-dosa",
  "mysore-sada-dosa",
  "mysore-masala-dosa",
];

/** Returns the currently-open service window, or null if closed. */
export function getActiveService(now: Date = new Date()): ServiceWindow | null {
  const day = now.getDay();
  const mins = now.getHours() * 60 + now.getMinutes();
  return (
    SERVICES.find(
      (s) => s.dayOfWeek === day && mins >= s.openMins && mins < s.closeMins
    ) ?? null
  );
}

/** Returns the most recently-closed service today (for the "thanks, leave a
 *  review" message after Wednesday dosa night ends). */
export function getJustClosedService(now: Date = new Date()): ServiceWindow | null {
  const day = now.getDay();
  const mins = now.getHours() * 60 + now.getMinutes();
  return (
    SERVICES.find((s) => s.dayOfWeek === day && mins >= s.closeMins) ?? null
  );
}

/** Human-readable hours like "6:00 PM – 10:30 PM" */
export function formatServiceHours(s: ServiceWindow): string {
  const f = (m: number) => {
    const h = Math.floor(m / 60);
    const mm = m % 60;
    const hh = ((h + 11) % 12) + 1;
    const ampm = h >= 12 ? "PM" : "AM";
    return `${hh}:${String(mm).padStart(2, "0")} ${ampm}`;
  };
  return `${f(s.openMins)} – ${f(s.closeMins)}`;
}

/** Returns the soonest upcoming service window from `now` (could be later
 *  today or wrap into next week).  Useful for "Next service: …" banners. */
export function getNextService(now: Date = new Date()): ServiceWindow {
  const day = now.getDay();
  const mins = now.getHours() * 60 + now.getMinutes();

  let best: ServiceWindow = SERVICES[0];
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const s of SERVICES) {
    // Days until this service's open boundary (0–6).
    let dayDelta = (s.dayOfWeek - day + 7) % 7;
    // If it's "today" but we're already past close, push to next week.
    if (dayDelta === 0 && mins >= s.closeMins) dayDelta = 7;
    const delta = dayDelta * 24 * 60 + (s.openMins - mins);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = s;
    }
  }
  return best;
}

/** Capitalised day name for a ServiceWindow's dayOfWeek. */
export function serviceDayName(s: ServiceWindow): string {
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][s.dayOfWeek];
}
