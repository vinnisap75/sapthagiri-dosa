"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase, OrderRow, OrderItemRow } from "@/lib/supabase";
import {
  DISPLAY_BATCH,
  PARALLEL_SLOTS,
  orderCookMinutes,
  remainingMinutes,
  OrderLite,
} from "@/lib/timing";

interface FullOrder {
  order: OrderRow;
  items: OrderItemRow[];
}

type Filter = "all" | "needs-action" | "in-progress" | "ready";

export default function KitchenPage() {
  const [orders, setOrders] = useState<FullOrder[]>([]);
  const [now, setNow] = useState<Date>(new Date());
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  // Tick every second so timers update live.
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
        setError(null);
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
  const ready = useMemo(
    () => orders.filter((o) => o.order.status === "ready"),
    [orders]
  );
  const queued = useMemo(
    () => orders.filter((o) => o.order.status === "queued"),
    [orders]
  );
  const cooking = useMemo(
    () => orders.filter((o) => o.order.status === "cooking"),
    [orders]
  );

  const visible = useMemo<FullOrder[]>(() => {
    const set =
      filter === "needs-action"
        ? queued
        : filter === "in-progress"
        ? cooking
        : filter === "ready"
        ? ready
        : [...ready, ...cooking, ...queued]; // "All" — surface ready first
    return set;
  }, [filter, queued, cooking, ready]);

  const recentlyServed = useMemo(
    () =>
      orders
        .filter((o) => o.order.status === "served")
        .sort(
          (a, b) =>
            new Date(b.order.served_at ?? b.order.created_at).getTime() -
            new Date(a.order.served_at ?? a.order.created_at).getTime()
        )
        .slice(0, 6),
    [orders]
  );

  async function setStatus(order: OrderRow, next: OrderRow["status"]) {
    const patch: Partial<OrderRow> = { status: next };
    if (next === "cooking") patch.cooking_started_at = new Date().toISOString();
    if (next === "ready") patch.ready_at = new Date().toISOString();
    if (next === "served") patch.served_at = new Date().toISOString();
    const sb = supabase();
    await sb.from("orders").update(patch).eq("id", order.id);
  }

  return (
    <main className="min-h-screen pb-16">
      <header className="bg-sapthagiri-burgundy text-white sticky top-0 z-30">
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
                {cooking.length}/{PARALLEL_SLOTS}
              </strong>
            </div>
            <div>
              <span className="text-sapthagiri-gold mr-1">Queued</span>
              <strong>{queued.length}</strong>
            </div>
            <div className="opacity-80 tabular-nums">
              {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </div>
          </div>
        </div>

        {/* Status filter tabs (mimics the DoorDash-style header) */}
        <div className="max-w-7xl mx-auto px-6 pb-3 flex gap-2 overflow-x-auto">
          <FilterPill
            label="All"
            count={active.length + ready.length}
            active={filter === "all"}
            onClick={() => setFilter("all")}
          />
          <FilterPill
            label="Needs action"
            count={queued.length}
            active={filter === "needs-action"}
            onClick={() => setFilter("needs-action")}
          />
          <FilterPill
            label="In progress"
            count={cooking.length}
            active={filter === "in-progress"}
            onClick={() => setFilter("in-progress")}
          />
          <FilterPill
            label="Ready"
            count={ready.length}
            active={filter === "ready"}
            onClick={() => setFilter("ready")}
          />
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
        {filter === "all" && (
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-lg font-semibold">
              Active batch (next {DISPLAY_BATCH}, FIFO)
            </h2>
            <span className="text-xs text-stone-500">
              Older orders show first.
            </span>
          </div>
        )}

        {visible.length === 0 ? (
          <div className="card p-8 text-center text-stone-500">
            No orders here yet. 🍃
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {visible
              .slice(0, filter === "all" ? DISPLAY_BATCH + ready.length : visible.length)
              .map((o) => (
                <OrderCard
                  key={o.order.id}
                  full={o}
                  now={now}
                  queueAll={active}
                  onSetStatus={setStatus}
                />
              ))}
          </div>
        )}
      </section>

      {filter === "all" &&
        active.length > DISPLAY_BATCH && (
          <section className="max-w-7xl mx-auto px-6 pb-6">
            <h2 className="text-sm uppercase tracking-wider text-stone-500 mb-2">
              Up next ({active.length - DISPLAY_BATCH})
            </h2>
            <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-4">
              {active.slice(DISPLAY_BATCH).map((o) => (
                <div
                  key={o.order.id}
                  className="card p-3 text-sm flex items-center justify-between"
                >
                  <div>
                    <div className="font-semibold">{o.order.table_id}</div>
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

      {recentlyServed.length > 0 && filter === "all" && (
        <section className="max-w-7xl mx-auto px-6 pb-10">
          <h2 className="text-sm uppercase tracking-wider text-stone-500 mb-2">
            Recently served
          </h2>
          <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
            {recentlyServed.map((o) => (
              <div
                key={o.order.id}
                className="card p-3 text-sm flex items-center justify-between"
              >
                <div>
                  <div className="font-semibold">{o.order.table_id}</div>
                  <div className="text-xs text-stone-500">
                    {o.items
                      .map((i) => `${i.quantity}× ${i.name}`)
                      .join(", ")}
                  </div>
                </div>
                <span className="badge bg-blue-100 text-blue-900">served</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

function FilterPill({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-1.5 rounded-full text-sm whitespace-nowrap transition ${
        active
          ? "bg-white text-sapthagiri-burgundy font-semibold shadow"
          : "bg-white/10 text-white hover:bg-white/20"
      }`}
    >
      <span>{label}</span>
      <span
        className={`inline-flex items-center justify-center min-w-[1.4rem] h-[1.4rem] rounded-full text-xs font-bold tabular-nums ${
          active
            ? "bg-sapthagiri-burgundy text-white"
            : "bg-white/30 text-white"
        }`}
      >
        {count}
      </span>
    </button>
  );
}

function OrderCard({
  full,
  now,
  queueAll,
  onSetStatus,
}: {
  full: FullOrder;
  now: Date;
  queueAll: FullOrder[];
  onSetStatus: (o: OrderRow, s: OrderRow["status"]) => void;
}) {
  const { order, items } = full;
  const cookMins = orderCookMinutes(
    items.map((i) => ({ menu_item_id: i.menu_item_id, quantity: i.quantity }))
  );
  const totalItems = items.reduce((a, b) => a + b.quantity, 0);
  const hasUttapam = items.some((i) => i.category === "uttapam");
  const hasJain = items.some((i) => i.no_onion_garlic);

  const elapsedCooking =
    order.cooking_started_at !== null
      ? (now.getTime() - new Date(order.cooking_started_at).getTime()) / 1000
      : 0;

  // Cooking "ready in" estimate
  const orderLite: OrderLite = {
    id: order.id,
    status: order.status,
    created_at: order.created_at,
    cooking_started_at: order.cooking_started_at,
    items: items.map((i) => ({
      menu_item_id: i.menu_item_id,
      quantity: i.quantity,
    })),
  };
  const remainingMin =
    order.status === "cooking" ? Math.max(0, Math.round(remainingMinutes(orderLite, now))) : null;

  // Visual style per status
  let headerClass = "bg-stone-700 text-white";
  let statusLabel = "Queued";
  if (order.status === "cooking") {
    headerClass = "bg-blue-600 text-white";
    statusLabel = "In progress";
  } else if (order.status === "ready") {
    headerClass = "bg-sapthagiri-burgundy text-white";
    statusLabel = "Ready";
  }

  const cookingPct =
    order.status === "cooking"
      ? Math.min(100, (elapsedCooking / 60 / cookMins) * 100)
      : 0;
  const isOverdue =
    order.status === "cooking" && elapsedCooking / 60 > cookMins;

  return (
    <div className="card overflow-hidden flex flex-col">
      {/* Colored status header — matches the screenshot style */}
      <div className={`${headerClass} px-4 py-3`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-widest opacity-80">
              {statusLabel}
            </div>
            <div className="text-2xl font-display font-bold leading-tight">
              {order.table_id}
            </div>
            {order.customer_name && (
              <div className="text-xs opacity-80 mt-0.5">{order.customer_name}</div>
            )}
          </div>
          <div className="text-right">
            {order.status === "cooking" ? (
              <>
                <div className="text-[10px] uppercase tracking-wider opacity-80">
                  Ready in
                </div>
                <div className="text-xl font-bold tabular-nums">
                  {remainingMin}m
                </div>
              </>
            ) : order.status === "queued" ? (
              <>
                <div className="text-[10px] uppercase tracking-wider opacity-80">
                  Waiting
                </div>
                <div className="text-xl font-bold tabular-nums">
                  {timeSince(order.created_at, now)}
                </div>
              </>
            ) : (
              <div className="text-2xl">🛎️</div>
            )}
          </div>
        </div>
      </div>

      {/* Meta row — clock icon, item count, utensils equivalent */}
      <div className="px-4 py-2 border-b border-stone-200 text-sm text-stone-700 flex flex-wrap items-center gap-x-5 gap-y-1">
        <span className="flex items-center gap-1">
          <span className="text-stone-400">🕒</span>
          {new Date(order.created_at).toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
          })}
        </span>
        <span className="flex items-center gap-1">
          <span className="text-stone-400">🥡</span>
          {totalItems} item{totalItems === 1 ? "" : "s"}
        </span>
        {hasUttapam && (
          <span className="badge bg-orange-100 text-orange-800">uttapam</span>
        )}
        {hasJain && (
          <span className="badge bg-amber-200 text-amber-900">
            🚫 no onion / garlic
          </span>
        )}
      </div>

      {/* Items list */}
      <ul className="px-4 py-3 space-y-1.5 flex-1">
        {items.map((i) => (
          <li key={i.id} className="text-sm">
            <div className="flex items-baseline justify-between gap-2">
              <span>
                <span className="font-semibold mr-1 tabular-nums">{i.quantity}</span>
                {i.name}
              </span>
              <span className="text-xs text-stone-400 tabular-nums">{i.cook_minutes}m</span>
            </div>
            {i.no_onion_garlic && (
              <div className="ml-5 text-xs font-semibold text-amber-900 bg-amber-100 inline-block px-2 py-0.5 rounded mt-0.5">
                🚫 NO ONION · NO GARLIC
              </div>
            )}
          </li>
        ))}
      </ul>

      {order.notes && (
        <div className="px-4 pb-2 text-xs italic text-stone-600 bg-amber-50 mx-3 mb-2 rounded p-2 border border-amber-200">
          "{order.notes}"
        </div>
      )}

      {/* Cook progress bar */}
      {order.status === "cooking" && (
        <div className="px-4 pb-2">
          <div className="h-2 w-full bg-stone-200 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all ${
                isOverdue ? "bg-red-500" : "bg-blue-500"
              }`}
              style={{ width: `${cookingPct}%` }}
            />
          </div>
          <div className="text-[10px] text-stone-500 mt-1 tabular-nums">
            {fmtMinSec(elapsedCooking)} of ~{cookMins}m
          </div>
        </div>
      )}

      {/* Big single action button at the bottom */}
      <div className="px-3 pb-3 pt-1 flex gap-2 items-center">
        {order.status === "queued" && (
          <button
            onClick={() => onSetStatus(order, "cooking")}
            className="flex-1 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 text-sm transition"
          >
            ▶ Start cooking
          </button>
        )}
        {order.status === "cooking" && (
          <button
            onClick={() => onSetStatus(order, "ready")}
            className="flex-1 rounded-xl bg-sapthagiri-burgundy hover:bg-[#561624] text-white font-semibold py-3 text-sm transition"
          >
            🛎️ Mark ready
          </button>
        )}
        {order.status === "ready" && (
          <button
            onClick={() => onSetStatus(order, "served")}
            className="flex-1 rounded-xl bg-green-600 hover:bg-green-700 text-white font-semibold py-3 text-sm transition"
          >
            ✓ Mark served
          </button>
        )}
        <button
          onClick={() => {
            if (confirm(`Cancel order from ${order.table_id}?`))
              onSetStatus(order, "cancelled");
          }}
          className="rounded-xl border border-stone-300 text-stone-500 hover:bg-stone-100 py-3 px-3 text-sm transition"
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
