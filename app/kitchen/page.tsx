"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase, OrderRow, OrderItemRow } from "@/lib/supabase";
import { DISPLAY_BATCH, PARALLEL_SLOTS, orderCookMinutes } from "@/lib/timing";

interface FullOrder {
  order: OrderRow;
  items: OrderItemRow[];
}

export default function KitchenPage() {
  const [orders, setOrders] = useState<FullOrder[]>([]);
  const [now, setNow] = useState<Date>(new Date());
  const [error, setError] = useState<string | null>(null);

  // Tick every second so elapsed-time displays stay alive.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const sb = supabase();

    async function load() {
      try {
        const { data, error: qerr } = await sb
          .from("orders")
          .select("*, order_items(*)")
          .order("created_at", { ascending: true });
        if (qerr) throw qerr;
        if (cancelled) return;
        setOrders(
          (data ?? []).map((row: any) => ({
            order: row as OrderRow,
            items: (row.order_items ?? []) as OrderItemRow[],
          }))
        );
      } catch (e) {
        setError(
          e instanceof Error
            ? `${e.message} — is the schema installed and .env.local set?`
            : "Could not load orders."
        );
      }
    }

    load();
    const channel = sb
      .channel("kitchen-orders")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders" },
        () => load()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "order_items" },
        () => load()
      )
      .subscribe();

    return () => {
      cancelled = true;
      sb.removeChannel(channel);
    };
  }, []);

  const active = useMemo(
    () =>
      orders.filter(
        (o) => o.order.status === "queued" || o.order.status === "cooking"
      ),
    [orders]
  );

  const batch = active.slice(0, DISPLAY_BATCH);
  const upNext = active.slice(DISPLAY_BATCH, DISPLAY_BATCH + 4);

  const recentlyDone = useMemo(
    () =>
      orders
        .filter((o) => o.order.status === "ready" || o.order.status === "served")
        .sort(
          (a, b) =>
            new Date(b.order.ready_at ?? b.order.created_at).getTime() -
            new Date(a.order.ready_at ?? a.order.created_at).getTime()
        )
        .slice(0, 6),
    [orders]
  );

  const cookingCount = active.filter((o) => o.order.status === "cooking").length;

  async function setStatus(order: OrderRow, next: OrderRow["status"]) {
    const patch: Partial<OrderRow> = { status: next };
    if (next === "cooking") patch.cooking_started_at = new Date().toISOString();
    if (next === "ready") patch.ready_at = new Date().toISOString();
    if (next === "served") patch.served_at = new Date().toISOString();
    const sb = supabase();
    await sb.from("orders").update(patch).eq("id", order.id);
  }

  return (
    <main className="min-h-screen">
      <header className="bg-sapthagiri-burgundy text-white">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🍳</span>
            <div>
              <div className="text-xs uppercase tracking-[0.25em] text-sapthagiri-gold">
                Sapthagiri · Kitchen
              </div>
              <h1 className="text-lg font-display">Dosa Master Board</h1>
            </div>
          </div>
          <div className="text-sm flex items-center gap-6">
            <div>
              <span className="text-sapthagiri-gold mr-1">Cooking</span>
              <strong>
                {cookingCount}/{PARALLEL_SLOTS}
              </strong>
            </div>
            <div>
              <span className="text-sapthagiri-gold mr-1">Queued</span>
              <strong>{active.filter((o) => o.order.status === "queued").length}</strong>
            </div>
            <div className="opacity-80">
              {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </div>
          </div>
        </div>
      </header>

      {error && (
        <div className="max-w-7xl mx-auto px-6 mt-4">
          <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-3 text-sm">
            {error}
          </div>
        </div>
      )}

      <section className="max-w-7xl mx-auto px-6 py-6">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-lg font-semibold">
            Current batch (next {DISPLAY_BATCH}, FIFO)
          </h2>
          <span className="text-xs text-stone-500">
            Older orders show first. Mark ready to slide in the next.
          </span>
        </div>

        {batch.length === 0 ? (
          <div className="card p-8 text-center text-stone-500">
            No active orders. 🍃
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {batch.map((o) => (
              <OrderCard
                key={o.order.id}
                full={o}
                now={now}
                onSetStatus={setStatus}
              />
            ))}
          </div>
        )}
      </section>

      {upNext.length > 0 && (
        <section className="max-w-7xl mx-auto px-6 pb-6">
          <h2 className="text-sm uppercase tracking-wider text-stone-500 mb-2">
            Up next
          </h2>
          <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-4">
            {upNext.map((o) => (
              <div
                key={o.order.id}
                className="card p-3 text-sm flex items-center justify-between"
              >
                <div>
                  <div className="font-semibold">Table {o.order.table_id}</div>
                  <div className="text-xs text-stone-500">
                    {o.items.reduce((a, b) => a + b.quantity, 0)} item(s)
                  </div>
                </div>
                <div className="text-xs text-stone-500">
                  {timeSince(o.order.created_at, now)} ago
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {recentlyDone.length > 0 && (
        <section className="max-w-7xl mx-auto px-6 pb-10">
          <h2 className="text-sm uppercase tracking-wider text-stone-500 mb-2">
            Recently completed
          </h2>
          <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
            {recentlyDone.map((o) => (
              <div
                key={o.order.id}
                className="card p-3 text-sm flex items-center justify-between"
              >
                <div>
                  <div className="font-semibold">Table {o.order.table_id}</div>
                  <div className="text-xs text-stone-500">
                    {o.items
                      .map((i) => `${i.quantity}× ${i.name}`)
                      .join(", ")}
                  </div>
                </div>
                {o.order.status === "ready" && (
                  <button
                    onClick={() => setStatus(o.order, "served")}
                    className="btn-ghost text-xs px-2 py-1"
                  >
                    Mark served
                  </button>
                )}
                {o.order.status === "served" && (
                  <span className="badge bg-blue-100 text-blue-900">served</span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

function OrderCard({
  full,
  now,
  onSetStatus,
}: {
  full: FullOrder;
  now: Date;
  onSetStatus: (o: OrderRow, s: OrderRow["status"]) => void;
}) {
  const { order, items } = full;
  const cookMins = orderCookMinutes(
    items.map((i) => ({ menu_item_id: i.menu_item_id, quantity: i.quantity }))
  );
  const elapsedSinceQueue = (now.getTime() - new Date(order.created_at).getTime()) / 1000;
  const elapsedCooking =
    order.cooking_started_at !== null
      ? (now.getTime() - new Date(order.cooking_started_at).getTime()) / 1000
      : 0;

  const cookingPct =
    order.status === "cooking"
      ? Math.min(100, (elapsedCooking / 60 / cookMins) * 100)
      : 0;

  const isOverdue =
    order.status === "cooking" && elapsedCooking / 60 > cookMins;

  const hasUttapam = items.some((i) => i.category === "uttapam");
  const hasMasala = items.some((i) => i.no_onion_garlic);

  return (
    <div
      className={`card overflow-hidden border-2 ${
        order.status === "cooking"
          ? isOverdue
            ? "border-red-400"
            : "border-amber-400"
          : "border-stone-200"
      }`}
    >
      <div
        className={`px-4 py-2 flex items-center justify-between ${
          order.status === "cooking"
            ? "bg-amber-50"
            : "bg-sapthagiri-cream"
        }`}
      >
        <div className="flex items-center gap-2">
          <span className="text-xl font-display text-sapthagiri-burgundy font-bold">
            {order.table_id}
          </span>
          <span
            className={`badge ${
              order.status === "cooking"
                ? "bg-amber-200 text-amber-900"
                : "bg-stone-200 text-stone-800"
            }`}
          >
            {order.status}
          </span>
          {hasUttapam && (
            <span className="badge bg-orange-100 text-orange-800">UTTAPAM</span>
          )}
        </div>
        <div className="text-xs text-stone-500 tabular-nums">
          {timeSince(order.created_at, now)} ago
        </div>
      </div>

      <ul className="px-4 py-3 space-y-1.5">
        {items.map((i) => (
          <li key={i.id} className="text-sm">
            <div className="flex items-baseline justify-between gap-2">
              <span>
                <span className="font-semibold mr-1">{i.quantity}×</span>
                {i.name}
              </span>
              <span className="text-xs text-stone-400">{i.cook_minutes}m</span>
            </div>
            {i.no_onion_garlic && (
              <div className="ml-5 text-xs font-semibold text-amber-800 bg-amber-100 inline-block px-2 py-0.5 rounded mt-0.5">
                🚫 NO ONION · NO GARLIC
              </div>
            )}
          </li>
        ))}
      </ul>

      {order.notes && (
        <div className="px-4 pb-2 text-xs italic text-stone-600">
          Notes: {order.notes}
        </div>
      )}

      {order.status === "cooking" && (
        <div className="px-4 pb-2">
          <div className="h-2 w-full bg-stone-200 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all ${
                isOverdue ? "bg-red-500" : "bg-amber-500"
              }`}
              style={{ width: `${cookingPct}%` }}
            />
          </div>
          <div className="text-[10px] text-stone-500 mt-1 tabular-nums">
            {fmtMinSec(elapsedCooking)} of ~{cookMins}m
          </div>
        </div>
      )}

      <div className="px-4 py-3 border-t border-stone-200 flex gap-2">
        {order.status === "queued" && (
          <button
            onClick={() => onSetStatus(order, "cooking")}
            className="btn-primary flex-1"
          >
            ▶ Start cooking
          </button>
        )}
        {order.status === "cooking" && (
          <>
            <button
              onClick={() => onSetStatus(order, "ready")}
              className="btn-gold flex-1"
            >
              🛎️ Mark ready
            </button>
            <button
              onClick={() => onSetStatus(order, "queued")}
              className="btn-ghost"
              title="Move back to queue"
            >
              ↩
            </button>
          </>
        )}
        <button
          onClick={() => {
            if (confirm(`Cancel order from ${order.table_id}?`))
              onSetStatus(order, "cancelled");
          }}
          className="btn-ghost text-stone-500"
          title="Cancel order"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

function timeSince(iso: string, now: Date): string {
  const secs = Math.max(0, (now.getTime() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return `${Math.floor(secs)}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function fmtMinSec(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}
