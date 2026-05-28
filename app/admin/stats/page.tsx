"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase, OrderRow, OrderItemRow, ServerCallRow } from "@/lib/supabase";
import { ADDONS_BY_ID } from "@/lib/menu";
import { AuthGuard, SignOutButton } from "../../_components/AuthGuard";

interface FullOrder {
  order: OrderRow;
  items: OrderItemRow[];
}

export default function StatsPage() {
  return (
    <AuthGuard>
      <Stats />
    </AuthGuard>
  );
}

function Stats() {
  const [orders, setOrders] = useState<FullOrder[]>([]);
  const [calls, setCalls] = useState<ServerCallRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const sb = supabase();
    let cancelled = false;
    async function load() {
      try {
        const [{ data: ordRows, error: oerr }, { data: callRows }] =
          await Promise.all([
            sb.from("orders").select("*, order_items(*)").order("created_at"),
            sb.from("server_calls").select("*"),
          ]);
        if (oerr) throw oerr;
        if (cancelled) return;
        setOrders(
          ((ordRows ?? []) as (OrderRow & { order_items: OrderItemRow[] })[])
            .map((r) => ({
              order: r as OrderRow,
              items: (r.order_items ?? []) as OrderItemRow[],
            }))
        );
        setCalls((callRows ?? []) as ServerCallRow[]);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't load stats");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    // light auto-refresh every 30s so the page stays current
    const t = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  // ────── Derived stats ──────
  const stats = useMemo(() => computeStats(orders, calls), [orders, calls]);

  return (
    <main className="min-h-screen pb-16">
      <header className="bg-sapthagiri-burgundy text-white">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <span className="text-2xl">📊</span>
            <div>
              <div className="text-xs uppercase tracking-[0.25em] text-sapthagiri-gold">
                Sapthagiri · Analytics
              </div>
              <h1 className="text-lg font-display">Tonight's numbers</h1>
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <Link
              href="/"
              className="text-sapthagiri-gold hover:text-white uppercase tracking-wider"
            >
              ← Dashboard
            </Link>
            <SignOutButton className="text-sapthagiri-gold hover:text-white uppercase tracking-wider" />
          </div>
        </div>
      </header>

      {error && (
        <div className="max-w-6xl mx-auto px-6 mt-4">
          <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-3 text-sm">
            {error}
          </div>
        </div>
      )}

      {loading && orders.length === 0 ? (
        <p className="text-center text-stone-500 py-16">Crunching numbers…</p>
      ) : (
        <div className="max-w-6xl mx-auto px-6 py-6 space-y-6">
          {/* Headline numbers */}
          <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Orders placed" value={stats.totalOrders} accent="burgundy" />
            <Stat label="Dosas / items served" value={stats.itemsServed} accent="gold" />
            <Stat label="People served" value={stats.peopleServed} accent="burgundy" />
            <Stat label="Active right now" value={stats.activeOrders} accent="gold" />
          </section>

          <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Avg party size" value={stats.avgPartySize?.toFixed(1) ?? "—"} small />
            <Stat label="Avg cook time" value={stats.avgCookSeconds != null ? `${Math.round(stats.avgCookSeconds / 60)}m ${Math.round(stats.avgCookSeconds % 60)}s` : "—"} small />
            <Stat label="Tables used" value={stats.distinctTables} small />
            <Stat label="Server calls" value={stats.totalServerCalls} small />
          </section>

          {/* Status breakdown */}
          <section className="card p-5">
            <h2 className="font-display text-lg text-sapthagiri-burgundy mb-3">
              Where orders went
            </h2>
            <div className="space-y-2">
              {(
                [
                  ["served", "✓ Served", "bg-green-500"],
                  ["ready", "🛎️ Ready", "bg-sapthagiri-burgundy"],
                  ["cooking", "🔥 Cooking", "bg-blue-500"],
                  ["queued", "📋 Queued", "bg-stone-500"],
                  ["cancelled", "✕ Cancelled", "bg-red-500"],
                ] as const
              ).map(([key, label, color]) => {
                const n = stats.statusCounts[key] ?? 0;
                const pct = stats.totalOrders ? (n / stats.totalOrders) * 100 : 0;
                return (
                  <BarRow key={key} label={label} value={n} pct={pct} color={color} />
                );
              })}
            </div>
          </section>

          {/* Top items */}
          <section className="card p-5">
            <h2 className="font-display text-lg text-sapthagiri-burgundy mb-3">
              Top items tonight
            </h2>
            {stats.topItems.length === 0 ? (
              <p className="text-sm text-stone-500">No items yet.</p>
            ) : (
              <div className="space-y-2">
                {stats.topItems.map((row) => {
                  const pct =
                    stats.topItems[0].count > 0
                      ? (row.count / stats.topItems[0].count) * 100
                      : 0;
                  return (
                    <BarRow
                      key={row.name}
                      label={row.name}
                      value={row.count}
                      pct={pct}
                      color="bg-sapthagiri-burgundy"
                    />
                  );
                })}
              </div>
            )}
          </section>

          <section className="grid md:grid-cols-2 gap-6">
            {/* Topping popularity */}
            <div className="card p-5">
              <h2 className="font-display text-lg text-sapthagiri-burgundy mb-3">
                Most-picked toppings
              </h2>
              {stats.topAddons.length === 0 ? (
                <p className="text-sm text-stone-500">No Build-Your-Own picks yet.</p>
              ) : (
                <div className="space-y-2">
                  {stats.topAddons.map((row) => {
                    const pct =
                      stats.topAddons[0].count > 0
                        ? (row.count / stats.topAddons[0].count) * 100
                        : 0;
                    return (
                      <BarRow
                        key={row.id}
                        label={row.label}
                        value={row.count}
                        pct={pct}
                        color="bg-sapthagiri-gold"
                      />
                    );
                  })}
                </div>
              )}
            </div>

            {/* Cooking preferences */}
            <div className="card p-5">
              <h2 className="font-display text-lg text-sapthagiri-burgundy mb-3">
                Preferences
              </h2>
              <div className="grid grid-cols-2 gap-3">
                <PrefBox label="✨ Crispy" n={stats.crispy} total={stats.crispy + stats.soft} />
                <PrefBox label="☁️ Soft" n={stats.soft} total={stats.crispy + stats.soft} />
                <PrefBox label="🧈 Amul Ghee" n={stats.ghee} total={stats.ghee + stats.oil} />
                <PrefBox label="🛢️ Oil" n={stats.oil} total={stats.ghee + stats.oil} />
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <FlagRow
                  label="🚫 No onion / no garlic"
                  n={stats.noOnionGarlic}
                  total={stats.itemsServed}
                />
                <FlagRow
                  label="⚪ Masala on side"
                  n={stats.masalaOnSide}
                  total={stats.itemsServed}
                />
              </div>
            </div>
          </section>

          {/* Ratings */}
          <section className="card p-5">
            <h2 className="font-display text-lg text-sapthagiri-burgundy mb-3">
              Customer ratings
            </h2>
            <div className="flex flex-wrap items-end gap-6">
              <div>
                <div className="text-5xl font-display text-sapthagiri-burgundy tabular-nums">
                  {stats.avgRating != null ? stats.avgRating.toFixed(2) : "—"}
                </div>
                <div className="text-xs uppercase tracking-widest text-stone-500">
                  Average · {stats.ratedOrders} review{stats.ratedOrders === 1 ? "" : "s"}
                </div>
              </div>
              <div className="flex-1 min-w-[200px] space-y-1.5">
                {[5, 4, 3, 2, 1].map((s) => {
                  const n = stats.ratingDist[s] ?? 0;
                  const pct = stats.ratedOrders ? (n / stats.ratedOrders) * 100 : 0;
                  return (
                    <div key={s} className="flex items-center gap-2 text-sm">
                      <span className="w-10 text-amber-500">{"⭐".repeat(s)}</span>
                      <div className="flex-1 bg-stone-100 rounded-full h-3 overflow-hidden">
                        <div
                          className="h-full bg-amber-400"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-xs text-stone-500 tabular-nums w-6 text-right">
                        {n}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
            {stats.ratingNotes.length > 0 && (
              <div className="mt-5 border-t border-stone-200 pt-4">
                <div className="text-xs uppercase tracking-wider text-stone-500 mb-2">
                  Recent notes
                </div>
                <ul className="space-y-2">
                  {stats.ratingNotes.slice(0, 5).map((r, i) => (
                    <li key={i} className="text-sm">
                      <span className="text-amber-500 mr-2">{"⭐".repeat(r.rating)}</span>
                      <span className="text-stone-700 italic">"{r.note}"</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          {/* Per-hour distribution */}
          <section className="card p-5">
            <h2 className="font-display text-lg text-sapthagiri-burgundy mb-3">
              Orders by hour
            </h2>
            <div className="flex items-end gap-1.5 h-32">
              {stats.hourly.map((b) => {
                const max = Math.max(1, ...stats.hourly.map((x) => x.count));
                const h = (b.count / max) * 100;
                return (
                  <div key={b.hour} className="flex-1 flex flex-col items-center">
                    <div className="text-[10px] text-stone-500 tabular-nums">
                      {b.count > 0 ? b.count : ""}
                    </div>
                    <div
                      className="w-full bg-sapthagiri-burgundy rounded-t"
                      style={{ height: `${h}%`, minHeight: b.count > 0 ? 2 : 0 }}
                    />
                    <div className="text-[10px] text-stone-400 mt-1 tabular-nums">
                      {String(b.hour).padStart(2, "0")}
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-stone-500 mt-2">
              Hour of day (24h). Bar height = order count.
            </p>
          </section>

          {/* Per-table */}
          <section className="card p-5">
            <h2 className="font-display text-lg text-sapthagiri-burgundy mb-3">
              Busiest tables
            </h2>
            {stats.topTables.length === 0 ? (
              <p className="text-sm text-stone-500">No tables yet.</p>
            ) : (
              <div className="space-y-2">
                {stats.topTables.map((row) => {
                  const pct =
                    stats.topTables[0].orders > 0
                      ? (row.orders / stats.topTables[0].orders) * 100
                      : 0;
                  return (
                    <BarRow
                      key={row.table}
                      label={`Table ${row.table}`}
                      value={`${row.orders} order${row.orders === 1 ? "" : "s"} · ${row.items} item${row.items === 1 ? "" : "s"}`}
                      pct={pct}
                      color="bg-blue-500"
                    />
                  );
                })}
              </div>
            )}
          </section>

          <p className="text-center text-xs text-stone-400">
            Auto-refreshes every 30s. Data covers active + served-in-last-12h
            (the RLS visibility window for the kitchen).
          </p>
        </div>
      )}
    </main>
  );
}

// ─────────── presentation components ───────────

function Stat({
  label,
  value,
  accent,
  small,
}: {
  label: string;
  value: number | string;
  accent?: "burgundy" | "gold";
  small?: boolean;
}) {
  return (
    <div
      className={`card px-4 py-3 ${
        accent === "burgundy"
          ? "border-l-4 border-sapthagiri-burgundy"
          : accent === "gold"
          ? "border-l-4 border-sapthagiri-gold"
          : ""
      }`}
    >
      <div className="text-xs uppercase tracking-wider text-stone-500">
        {label}
      </div>
      <div
        className={`font-display text-sapthagiri-burgundy tabular-nums ${
          small ? "text-2xl" : "text-3xl"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function BarRow({
  label,
  value,
  pct,
  color,
}: {
  label: string;
  value: string | number;
  pct: number;
  color: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between text-sm mb-0.5">
        <span>{label}</span>
        <span className="text-stone-600 tabular-nums">{value}</span>
      </div>
      <div className="h-2 bg-stone-100 rounded-full overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function PrefBox({ label, n, total }: { label: string; n: number; total: number }) {
  const pct = total ? Math.round((n / total) * 100) : 0;
  return (
    <div className="bg-sapthagiri-cream rounded-lg px-3 py-2">
      <div className="text-xs text-stone-600">{label}</div>
      <div className="text-xl font-display tabular-nums text-sapthagiri-burgundy">
        {n} <span className="text-xs text-stone-500">({pct}%)</span>
      </div>
    </div>
  );
}

function FlagRow({ label, n, total }: { label: string; n: number; total: number }) {
  const pct = total ? Math.round((n / total) * 100) : 0;
  return (
    <div className="flex items-center justify-between">
      <span className="text-stone-700">{label}</span>
      <span className="tabular-nums text-stone-600">
        {n} <span className="text-xs text-stone-400">({pct}%)</span>
      </span>
    </div>
  );
}

// ─────────── computation ───────────

interface ComputedStats {
  totalOrders: number;
  activeOrders: number;
  itemsServed: number;
  peopleServed: number;
  avgPartySize: number | null;
  avgCookSeconds: number | null;
  distinctTables: number;
  totalServerCalls: number;
  statusCounts: Record<OrderRow["status"], number>;
  topItems: { name: string; count: number }[];
  topAddons: { id: string; label: string; count: number }[];
  crispy: number;
  soft: number;
  ghee: number;
  oil: number;
  noOnionGarlic: number;
  masalaOnSide: number;
  avgRating: number | null;
  ratedOrders: number;
  ratingDist: Record<number, number>;
  ratingNotes: { rating: number; note: string }[];
  hourly: { hour: number; count: number }[];
  topTables: { table: string; orders: number; items: number }[];
}

function computeStats(orders: FullOrder[], calls: ServerCallRow[]): ComputedStats {
  const statusCounts: Record<OrderRow["status"], number> = {
    queued: 0,
    cooking: 0,
    ready: 0,
    served: 0,
    cancelled: 0,
  };
  const itemCount = new Map<string, number>();
  const addonCount = new Map<string, number>();
  const tableStat = new Map<string, { orders: number; items: number }>();
  const hourCount = new Array(24).fill(0);
  let itemsServed = 0;
  let peopleServed = 0;
  let partySum = 0;
  let partyCount = 0;
  let cookSecSum = 0;
  let cookSecCount = 0;
  let crispy = 0;
  let soft = 0;
  let ghee = 0;
  let oil = 0;
  let noOnionGarlic = 0;
  let masalaOnSide = 0;
  let ratingSum = 0;
  let ratedOrders = 0;
  const ratingDist: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const ratingNotes: { rating: number; note: string }[] = [];

  for (const { order, items } of orders) {
    statusCounts[order.status]++;

    const totalItems = items.length;
    itemsServed += totalItems;

    if (order.party_size) {
      peopleServed += order.party_size;
      partySum += order.party_size;
      partyCount += 1;
    }

    if (
      order.cooking_started_at &&
      (order.ready_at || order.served_at)
    ) {
      const start = new Date(order.cooking_started_at).getTime();
      const end = new Date(order.ready_at ?? order.served_at!).getTime();
      if (end > start) {
        cookSecSum += (end - start) / 1000;
        cookSecCount += 1;
      }
    }

    const hour = new Date(order.created_at).getHours();
    hourCount[hour]++;

    const t = tableStat.get(order.table_id) ?? { orders: 0, items: 0 };
    t.orders += 1;
    t.items += totalItems;
    tableStat.set(order.table_id, t);

    if (order.rating) {
      ratingSum += order.rating;
      ratedOrders += 1;
      ratingDist[order.rating] = (ratingDist[order.rating] ?? 0) + 1;
      if (order.rating_note) ratingNotes.push({ rating: order.rating, note: order.rating_note });
    }

    for (const i of items) {
      itemCount.set(i.name, (itemCount.get(i.name) ?? 0) + 1);
      if (i.crispiness === "crispy") crispy++;
      else soft++;
      if (i.cook_medium === "ghee") ghee++;
      else oil++;
      if (i.no_onion_garlic) noOnionGarlic++;
      if (i.masala_on_side) masalaOnSide++;
      for (const a of i.addons ?? []) addonCount.set(a, (addonCount.get(a) ?? 0) + 1);
    }
  }

  return {
    totalOrders: orders.length,
    activeOrders:
      statusCounts.queued + statusCounts.cooking + statusCounts.ready,
    itemsServed,
    peopleServed,
    avgPartySize: partyCount ? partySum / partyCount : null,
    avgCookSeconds: cookSecCount ? cookSecSum / cookSecCount : null,
    distinctTables: tableStat.size,
    totalServerCalls: calls.length,
    statusCounts,
    topItems: [...itemCount.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8),
    topAddons: [...addonCount.entries()]
      .map(([id, count]) => ({
        id,
        label: ADDONS_BY_ID[id]?.label ?? id,
        count,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 9),
    crispy,
    soft,
    ghee,
    oil,
    noOnionGarlic,
    masalaOnSide,
    avgRating: ratedOrders ? ratingSum / ratedOrders : null,
    ratedOrders,
    ratingDist,
    ratingNotes: ratingNotes.reverse(),
    hourly: hourCount.map((count, hour) => ({ hour, count })),
    topTables: [...tableStat.entries()]
      .map(([table, v]) => ({ table, orders: v.orders, items: v.items }))
      .sort((a, b) => b.orders - a.orders)
      .slice(0, 8),
  };
}
