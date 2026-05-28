"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase, OrderRow, OrderItemRow, ServerCallRow } from "@/lib/supabase";
import {
  DISPLAY_BATCH,
  PARALLEL_SLOTS,
  orderCookMinutes,
  remainingMinutes,
  OrderLite,
} from "@/lib/timing";
import { AuthGuard, SignOutButton } from "../_components/AuthGuard";

interface FullOrder {
  order: OrderRow;
  items: OrderItemRow[];
}

type Filter = "all" | "served";

export default function KitchenPage() {
  return (
    <AuthGuard>
      <KitchenInner />
    </AuthGuard>
  );
}

/** LOUD notification chime for new orders. Web Audio at max gain, three
 *  ding-dongs in a row, square wave (more piercing than sine), routed
 *  through a slight high-shelf filter so it cuts through restaurant noise.
 *  Browser autoplay blocks unprimed AudioContexts, so we lazily create
 *  one inside a user-gesture handler. */
function playOrderChime(ctx: AudioContext) {
  const start = ctx.currentTime;
  // Repeat the two-note pattern THREE times so it's hard to miss.
  for (let rep = 0; rep < 3; rep++) {
    const base = start + rep * 0.55;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, base);
    gain.gain.exponentialRampToValueAtTime(1.0, base + 0.02); // max volume
    gain.gain.exponentialRampToValueAtTime(0.0001, base + 0.5);
    gain.connect(ctx.destination);
    for (const [freq, offset] of [
      [988, 0],     // B5 — bright, attention-grabbing
      [1318, 0.18], // E6 — even higher
    ] as const) {
      const o = ctx.createOscillator();
      o.type = "square"; // square wave = louder + harsher than sine
      o.frequency.value = freq;
      o.connect(gain);
      o.start(base + offset);
      o.stop(base + offset + 0.25);
    }
  }
}

function KitchenInner() {
  const [orders, setOrders] = useState<FullOrder[]>([]);
  const [serverCalls, setServerCalls] = useState<ServerCallRow[]>([]);
  const [now, setNow] = useState<Date>(new Date());
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  // Persist sound preference so refresh doesn't silently disable it.
  // (Browser autoplay still requires a user gesture to first construct
  //  AudioContext, but we remember the preference and remind the master.)
  const SOUND_PREF_KEY = "sapthagiri-kitchen-sound-on";
  const [soundOn, setSoundOn] = useState(false);

  // Track which order IDs we've already announced so we only chime on truly new ones.
  const seenOrderIdsRef = useRef<Set<string>>(new Set());
  const audioCtxRef = useRef<AudioContext | null>(null);

  // On mount: read the persisted preference. If it was on, render the toggle
  // visually as "Tap to re-arm" so the master knows to tap to restore audio.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const v = window.localStorage.getItem(SOUND_PREF_KEY);
    if (v === "1") setSoundOn(true);
  }, []);

  function enableSound() {
    // Toggle off: clear pref, stop future chimes (AudioCtx kept for re-enable)
    if (soundOn && audioCtxRef.current) {
      setSoundOn(false);
      try {
        window.localStorage.setItem(SOUND_PREF_KEY, "0");
      } catch {}
      return;
    }
    // Toggle on: create the audio context inside this user-gesture handler
    if (!audioCtxRef.current) {
      try {
        const AC =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;
        audioCtxRef.current = new AC();
      } catch {
        return;
      }
    }
    // Play confirmation chime
    try {
      playOrderChime(audioCtxRef.current);
    } catch {}
    setSoundOn(true);
    try {
      window.localStorage.setItem(SOUND_PREF_KEY, "1");
    } catch {}
  }

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
        const rows = (data ?? []) as (OrderRow & { order_items: OrderItemRow[] })[];

        // Detect newly-arrived ORDERS (still in active states) and chime.
        const prevSize = seenOrderIdsRef.current.size;
        const newActiveIds: string[] = [];
        rows.forEach((r) => {
          if (
            !seenOrderIdsRef.current.has(r.id) &&
            ["queued", "cooking"].includes(r.status)
          ) {
            newActiveIds.push(r.id);
          }
          seenOrderIdsRef.current.add(r.id);
        });
        // Skip the chime on the very first load (everything is "new" then).
        if (
          prevSize > 0 &&
          newActiveIds.length > 0 &&
          soundOn &&
          audioCtxRef.current
        ) {
          playOrderChime(audioCtxRef.current);
        }

        setOrders(
          rows.map((row) => ({
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

  // Served orders go in their own tab so the master can review them later.
  const served = useMemo(
    () =>
      orders
        .filter((o) => o.order.status === "served")
        .sort(
          (a, b) =>
            new Date(b.order.served_at ?? b.order.created_at).getTime() -
            new Date(a.order.served_at ?? a.order.created_at).getTime()
        ),
    [orders]
  );

  const visible = useMemo<FullOrder[]>(() => {
    // Two-tab model: Active shows everything not-served (queued + cooking +
    // ready). Served shows only served. Once every dosa on an order is
    // checked, the order auto-jumps to Served, so 'ready' is usually a
    // very brief transient state that the master rarely needs to see.
    if (filter === "served") return served;
    return [...ready, ...cooking, ...queued];
  }, [filter, queued, cooking, ready, served]);

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

  /** Cycle an item through three states on each tap:
   *  pending (no started_at, not done)
   *    → cooking (started_at set, not done)
   *      → done (started_at set, is_done true)
   *        → pending again (reset both)
   *  When all items hit "done", the order auto-flips to "ready" and we also
   *  bump the order to "cooking" the moment the first item starts. */
  async function cycleItemState(full: FullOrder, item: OrderItemRow) {
    const sb = supabase();
    const now = new Date().toISOString();

    let patch: Partial<OrderItemRow>;
    let nextStartedAt: string | null = item.started_at;
    let nextIsDone: boolean = item.is_done;

    if (!item.started_at && !item.is_done) {
      // pending → cooking (on the pan)
      patch = { started_at: now };
      nextStartedAt = now;
      // Auto-bump order to cooking on the first item that starts.
      if (full.order.status === "queued") {
        await setStatus(full.order, "cooking");
      }
    } else if (item.started_at && !item.is_done) {
      // cooking → done
      patch = { is_done: true, done_at: now };
      nextIsDone = true;
    } else {
      // done → reset to pending
      patch = { started_at: null, is_done: false, done_at: null };
      nextStartedAt = null;
      nextIsDone = false;
    }

    await sb.from("order_items").update(patch).eq("id", item.id);

    // If after this change every item is done, jump the order all the way
    // to "served" — skips Ready since the dosa master already physically
    // confirmed each dosa is done. This keeps the Active tab clean.
    const allDone = full.items.every((i) =>
      i.id === item.id ? nextIsDone : i.is_done
    ) && nextIsDone;
    if (
      allDone &&
      full.order.status !== "served" &&
      full.order.status !== "cancelled"
    ) {
      await setStatus(full.order, "served");
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
            <button
              onClick={enableSound}
              className={`text-xs uppercase tracking-wider px-2 py-1 rounded transition ${
                soundOn && audioCtxRef.current
                  ? "bg-sapthagiri-gold text-[#3a2410]"
                  : soundOn
                  ? "bg-amber-400 text-[#3a2410] animate-pulse"
                  : "text-sapthagiri-gold hover:text-white border border-sapthagiri-gold/60"
              }`}
              title="Toggle new-order chime"
            >
              {soundOn && audioCtxRef.current
                ? "🔔 ON"
                : soundOn
                ? "🔔 Tap to re-arm"
                : "🔕 Tap to enable sound"}
            </button>
            <div className="opacity-80 tabular-nums">
              {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </div>
            <SignOutButton className="text-xs uppercase tracking-wider text-sapthagiri-gold hover:text-white" />
          </div>
        </div>

        {/* Status filter tabs (mimics the DoorDash-style header) */}
        <div className="max-w-7xl mx-auto px-6 pb-3 flex gap-2 overflow-x-auto">
          <FilterPill
            label="Active"
            count={active.length + ready.length}
            active={filter === "all"}
            onClick={() => setFilter("all")}
          />
          <FilterPill
            label="Served"
            count={served.length}
            active={filter === "served"}
            onClick={() => setFilter("served")}
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

      {(() => {
        // Hide server calls older than 5 minutes — the master has either
        // already handled them or they're stale.
        const FIVE_MIN_MS = 5 * 60 * 1000;
        const fresh = serverCalls.filter(
          (c) => now.getTime() - new Date(c.created_at).getTime() < FIVE_MIN_MS
        );
        if (fresh.length === 0) return null;
        return (
        <div className="max-w-7xl mx-auto px-6 mt-4">
          <div className="bg-amber-100 border-2 border-amber-400 rounded-xl px-4 py-3 flex items-center gap-3 flex-wrap">
            <span className="text-2xl animate-pulse">🛎️</span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-amber-900 uppercase tracking-wider">
                Server requested
              </div>
              <div className="flex flex-wrap gap-2 mt-1">
                {fresh.map((c) => {
                  const isRava = c.reason && /rava/i.test(c.reason);
                  return (
                    <div
                      key={c.id}
                      className={`bg-white rounded-lg px-3 py-1.5 text-sm flex items-center gap-2 ${
                        isRava
                          ? "border-2 border-sapthagiri-gold"
                          : "border border-amber-300"
                      }`}
                    >
                      <span className="font-display font-bold text-sapthagiri-burgundy">
                        {c.table_id}
                      </span>
                      {c.reason && (
                        <span
                          className={`text-xs font-semibold px-2 py-0.5 rounded ${
                            isRava
                              ? "bg-sapthagiri-burgundy text-white"
                              : "bg-stone-100 text-stone-700"
                          }`}
                        >
                          {isRava ? "🌾 " : ""}
                          {c.reason}
                        </span>
                      )}
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
                  );
                })}
              </div>
            </div>
          </div>
        </div>
        );
      })()}

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
                onCycleItem={(item) => cycleItemState(o, item)}
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
  onCycleItem,
}: {
  full: FullOrder;
  now: Date;
  queueAll: FullOrder[];
  onSetStatus: (o: OrderRow, s: OrderRow["status"]) => void;
  onCycleItem: (item: OrderItemRow) => void;
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
  } else if (order.status === "served") {
    headerClass = "bg-green-700 text-white";
    statusLabel = "Served";
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
            ) : order.status === "served" ? (
              <>
                <div className="text-[10px] uppercase tracking-wider opacity-80">
                  Served at
                </div>
                <div className="text-base font-bold tabular-nums">
                  {order.served_at
                    ? new Date(order.served_at).toLocaleTimeString([], {
                        hour: "numeric",
                        minute: "2-digit",
                      })
                    : "—"}
                </div>
              </>
            ) : (
              <div className="text-2xl">🛎️</div>
            )}
          </div>
        </div>
      </div>

      {/* Meta row — prominent arrival time, item count, badges */}
      <div className="px-4 py-2 border-b border-stone-200 text-sm text-stone-700 flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="flex items-center gap-1 font-semibold text-sapthagiri-burgundy tabular-nums">
          🕒 {new Date(order.created_at).toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
          })}
        </span>
        <span className="flex items-center gap-1 tabular-nums">
          <span className="text-stone-400">✓</span>
          {doneCount}/{items.length} done
        </span>
        {order.party_size && (
          <span className="badge bg-stone-100 text-stone-800 border border-stone-300">
            👥 {order.party_size === 8 ? "8+" : order.party_size}
          </span>
        )}
        {hasUttapam && (
          <span className="badge bg-orange-100 text-orange-800">UTTAPAM</span>
        )}
        {hasJain && (
          <span className="badge bg-amber-200 text-amber-900">
            🚫 NO ONION/GARLIC
          </span>
        )}
      </div>

      {/* To-do list — tap each row to cycle:
          pending → on pan (highlighted) → done (strikethrough) → pending */}
      <ul className="px-2 py-2 flex-1">
        {items.map((i) => {
          const state: "pending" | "cooking" | "done" = i.is_done
            ? "done"
            : i.started_at
            ? "cooking"
            : "pending";
          return (
          <li key={i.id}>
            <button
              type="button"
              onClick={() => onCycleItem(i)}
              className={`w-full flex items-start gap-2 text-left px-2 py-2 rounded-lg transition ${
                state === "done"
                  ? "opacity-60"
                  : state === "cooking"
                  ? "bg-amber-100 ring-2 ring-amber-300"
                  : "hover:bg-stone-50"
              }`}
            >
              <span
                className={`mt-0.5 w-9 h-9 rounded-lg border-[3px] flex items-center justify-center text-xl font-bold flex-shrink-0 shadow-sm ${
                  state === "done"
                    ? "bg-green-600 border-green-700 text-white"
                    : state === "cooking"
                    ? "bg-amber-400 border-amber-600 text-white animate-pulse"
                    : "bg-white border-stone-500 hover:border-sapthagiri-burgundy"
                }`}
                aria-hidden
              >
                {state === "done" ? "✓" : state === "cooking" ? "🔥" : ""}
              </span>
              <span className="flex-1 min-w-0 text-sm">
                <span
                  className={`block ${
                    state === "done" ? "line-through text-stone-500" : ""
                  }`}
                >
                  <span className="font-semibold mr-1 tabular-nums">
                    {i.quantity}×
                  </span>
                  {i.name}
                  <span
                    className={`ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                      i.crispiness === "crispy"
                        ? "bg-blue-100 text-blue-900"
                        : "bg-stone-100 text-stone-700"
                    }`}
                  >
                    {i.crispiness === "crispy" ? "✨ CRISPY" : "☁️ SOFT"}
                  </span>
                  <span className="ml-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-50 text-amber-900 border border-amber-200">
                    {i.cook_medium === "ghee" ? "🧈 GHEE" : "🛢️ OIL"}
                  </span>
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
          );
        })}
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

      {/* Action buttons — hidden for served (terminal state) */}
      {order.status === "served" ? (
        <div className="px-4 pb-3 pt-1 text-xs text-stone-500 italic">
          Order complete · archived to the Served tab.
        </div>
      ) : (
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
            onClick={() => onSetStatus(order, "served")}
            className="flex-1 rounded-xl bg-green-600 hover:bg-green-700 text-white font-semibold py-3 text-sm transition"
          >
            ✓ Mark all served
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
      )}
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
