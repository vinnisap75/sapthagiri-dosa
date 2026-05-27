"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase, OrderRow, OrderItemRow, ServerCallRow } from "@/lib/supabase";
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
  const [serverCalls, setServerCalls] = useState<ServerCallRow[]>([]);
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

    async function loadCalls() {
      const { data } = await sb
        .from("server_calls")
        .select("*")
        .is("resolved_at", null)
        .order("created_at", { ascending: true });
      if (cancelled) return;
      setServerCalls((data ?? []) as ServerCallRow[]);
    }

    load();
    loadCalls();
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
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "server_calls" },
        () => loadCalls()
      )
      .subscribe();

    return () => {
      cancelled = true;
      sb.removeChannel(channel);
    };
  }, []);

  async function resolveServerCall(id: string) {
    const sb = supabase();
    await sb
      .from("server_calls")
      .update({ resolved_at: new Date().toISOString() })
      .eq("id", id);
  }

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

  /** Toggle a single item's done flag.  If every item in the parent order is
   *  now done, also bump the order's status to "ready" (UX: kitchen has
   *  visually crossed off all its work). */
  async function toggleItemDone(
    full: FullOrder,
    item: OrderItemRow,
    forceDone?: boolean
  ) {
    const nextDone = forceDone !== undefined ? forceDone : !item.is_done;
    const sb = supabase();
    await sb
      .from("order_items")
      .update({
        is_done: nextDone,
        done_at: nextDone ? new Date().toISOString() : null,
      })
      .eq("id", item.id);

    // If every item is now done AND order is not yet ready/served, mark ready.
    const allDone =
      full.items.every((i) => (i.id === item.id ? nextDone : i.is_done)) &&
      nextDone;
    if (
      allDone &&
      full.order.status !== "ready" &&
      full.order.status !== "served" &&
      full.order.status !== "cancelled"
    ) {
      await setStatus(full.order, "ready");
    }
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

      {serverCalls.length > 0 && (
        <div className="max-w-7xl mx-auto px-6 mt-4">
          <div className="bg-amber-100 border-2 border-amber-400 rounded-xl px-4 py-3 flex items-center gap-3 flex-wrap">
            <span className="text-2xl animate-pulse">🛎️</span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-amber-900 uppercase tracking-wider">
                Server requested
              </div>
              <div className="flex flex-wrap gap-2 mt-1">
                {serverCalls.map((c) => (
                  <div
                    key={c.id}
                    className="bg-white border border-amber-300 rounded-lg px-3 py-1.5 text-sm flex items-center gap-2"
                  >
                    <span className="font-display font-bold text-sapthagiri-burgundy">
                      {c.table_id}
                    </span>
                    <span className="text-xs text-stone-500">
                      · {timeSince(c.created_at, now)} ago
                    </span>
                    <button
                      onClick={() => resolveServerCall(c.id)}
                      className="ml-1 text-xs font-semibold text-green-700 hover:text-green-900"
                    >
                      ✓ done
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <section className="max-w-7xl mx-auto px-6 py-6">
        {visible.length === 0 ? (
          <div className="card p-8 text-center text-stone-500">
            No orders here yet. 🍃
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {/* All active orders, oldest first — the dosa master picks them
                up FIFO but every table is on screen so nothing is hidden. */}
            {visible.map((o) => (
              <OrderCard
                key={o.order.id}
                full={o}
                now={now}
                queueAll={active}
                onSetStatus={setStatus}
                onToggleItem={(item, forceDone) => toggleItemDone(o, item, forceDone)}
              />
            ))}
          </div>
        )}
      </section>

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
  onToggleItem,
}: {
  full: FullOrder;
  now: Date;
  queueAll: FullOrder[];
  onSetStatus: (o: OrderRow, s: OrderRow["status"]) => void;
  onToggleItem: (item: OrderItemRow, forceDone?: boolean) => void;
}) {
  const { order, items } = full;
  const doneCount = items.filter((i) => i.is_done).length;
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

      {/* Meta row — clock icon, item count, progress, cook prefs, badges */}
      <div className="px-4 py-2 border-b border-stone-200 text-sm text-stone-700 flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="flex items-center gap-1">
          <span className="text-stone-400">🕒</span>
          {new Date(order.created_at).toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
          })}
        </span>
        <span className="flex items-center gap-1 tabular-nums">
          <span className="text-stone-400">✓</span>
          {doneCount}/{items.length} done
        </span>
        <span className="badge bg-amber-50 text-amber-900 border border-amber-200">
          {order.cook_medium === "ghee" ? "🧈 GHEE" : "🛢️ OIL"}
        </span>
        <span className="badge bg-blue-50 text-blue-900 border border-blue-200">
          {order.crispiness === "crispy" ? "✨ CRISPY" : "☁️ SOFT"}
        </span>
        {hasUttapam && (
          <span className="badge bg-orange-100 text-orange-800">UTTAPAM</span>
        )}
        {hasJain && (
          <span className="badge bg-amber-200 text-amber-900">
            🚫 NO ONION/GARLIC
          </span>
        )}
      </div>

      {/* To-do list — tap each row to cross it off as cooked */}
      <ul className="px-2 py-2 flex-1">
        {items.map((i) => (
          <li key={i.id}>
            <button
              type="button"
              onClick={() => onToggleItem(i)}
              className={`w-full flex items-start gap-2 text-left px-2 py-2 rounded-lg hover:bg-stone-50 transition ${
                i.is_done ? "opacity-60" : ""
              }`}
            >
              <span
                className={`mt-0.5 w-5 h-5 rounded border-2 flex items-center justify-center text-xs flex-shrink-0 ${
                  i.is_done
                    ? "bg-green-600 border-green-600 text-white"
                    : "bg-white border-stone-400"
                }`}
                aria-hidden
              >
                {i.is_done ? "✓" : ""}
              </span>
              <span className="flex-1 min-w-0 text-sm">
                <span
                  className={`block ${
                    i.is_done ? "line-through text-stone-500" : ""
                  }`}
                >
                  <span className="font-semibold mr-1 tabular-nums">
                    {i.quantity}×
                  </span>
                  {i.name}
                  <span className="ml-2 text-xs text-stone-400 tabular-nums">
                    {i.cook_minutes}m
                  </span>
                </span>
                {i.addons && i.addons.length > 0 && (
                  <span className="mt-0.5 flex flex-wrap gap-1">
                    {i.addons.map((a) => (
                      <span
                        key={a}
                        className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${
                          i.is_done
                            ? "bg-stone-100 text-stone-400"
                            : "bg-sapthagiri-burgundy text-white"
                        }`}
                      >
                        + {a.replace(/-/g, " ")}
                      </span>
                    ))}
                  </span>
                )}
                {i.no_onion_garlic && (
                  <span className="mt-0.5 inline-block text-xs font-semibold text-amber-900 bg-amber-100 px-2 py-0.5 rounded">
                    🚫 NO ONION · NO GARLIC
                  </span>
                )}
                {i.masala_on_side && (
                  <span className="mt-0.5 ml-1 inline-block text-xs font-semibold text-sapthagiri-burgundy bg-sapthagiri-cream px-2 py-0.5 rounded border border-sapthagiri-gold/40">
                    ⚪ MASALA ON SIDE
                  </span>
                )}
              </span>
            </button>
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
