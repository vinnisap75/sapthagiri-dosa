"use client";

import { createClient, SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

/** Lazy singleton — built the first time it's used so a missing env var only
 *  fails when you actually try to call Supabase, not at import time. */
export function supabase(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing Supabase env vars. Copy .env.local.example to .env.local and fill in NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY."
    );
  }
  cached = createClient(url, key, {
    realtime: { params: { eventsPerSecond: 5 } },
  });
  return cached;
}

// ─────────── DB row shapes ───────────
export interface OrderRow {
  id: string;
  table_id: string;
  customer_name: string | null;
  notes: string | null;
  status: "queued" | "cooking" | "ready" | "served" | "cancelled";
  created_at: string;
  cooking_started_at: string | null;
  ready_at: string | null;
  served_at: string | null;
  total_cents: number;
}

export interface OrderItemRow {
  id: string;
  order_id: string;
  menu_item_id: string;
  name: string;
  quantity: number;
  unit_price_cents: number;
  cook_minutes: number;
  category: "dosa" | "uttapam";
  no_onion_garlic: boolean;
  /** Add-on slugs selected by the customer (from lib/menu.ts ADDONS). */
  addons: string[];
  /** Kitchen has crossed this item off the to-do list. */
  is_done: boolean;
  done_at: string | null;
  notes: string | null;
}

export interface OrderWithItems extends OrderRow {
  order_items: OrderItemRow[];
}
