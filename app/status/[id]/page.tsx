"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { supabase, OrderRow, OrderItemRow } from "@/lib/supabase";
import {
  estimateWaitMinutes,
  waitRangeLabel,
  OrderLite,
} from "@/lib/timing";
import { ADDONS_BY_ID } from "@/lib/menu";

interface ActiveQueue {
  order: OrderRow;
  items: { menu_item_id: string; quantity: number }[];
}

export default function StatusPage() {
  const params = useParams<{ id: string }>();
  const orderId = params.id;

  const [order, setOrder] = useState<OrderRow | null>(null);
  const [items, setItems] = useState<OrderItemRow[]>([]);
  const [queue, setQueue] = useState<ActiveQueue[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<Date>(new Date());

  // Rating UI state
  const [chosenRating, setChosenRating] = useState<number | null>(null);
  const [ratingNote, setRatingNote] = useState("");
  const [submittingRating, setSubmittingRating] = useState(false);

  // Call-Server UI state
  const [callingServer, setCallingServer] = useState(false);
  const [serverCalled, setServerCalled] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!orderId) return;
    let cancelled = false;
    const sb = supabase();

    async function load() {
      try {
        const [{ data: ord, error: oerr }, { data: its, error: ierr }] =
          await Promise.all([
            sb.from("orders").select("*").eq("id", orderId).single(),
            sb.from("order_items").select("*").eq("order_id", orderId),
          ]);
        if (oerr) throw oerr;
        if (ierr) throw ierr;
        if (cancelled) return;
        setOrder(ord as OrderRow);
        setItems((its ?? []) as OrderItemRow[]);
        await loadQueue();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load order.");
      }
    }

    async function loadQueue() {
      const { data } = await sb
        .from("orders")
        .select("*, order_items(menu_item_id, quantity)")
        .in("status", ["queued", "cooking"])
        .order("created_at", { ascending: true });
      if (cancelled) return;
      setQueue(
        (data ?? []).map((row: any) => ({
          order: row as OrderRow,
          items: row.order_items as { menu_item_id: string; quantity: number }[],
        }))
      );
    }

    load();

    const channel = sb
      .channel(`order-${orderId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders" },
        () => load()
      )
      .subscribe();

    return () => {
      cancelled = true;
      sb.removeChannel(channel);
    };
  }, [orderId]);

  const waitLabel = useMemo(() => {
    if (!order) return "…";
    if (order.status === "ready") return "Ready!";
    if (order.status === "served") return "Served";
    if (order.status === "cancelled") return "Cancelled";

    const target: OrderLite = {
      id: order.id,
      status: order.status,
      created_at: order.created_at,
      cooking_started_at: order.cooking_started_at,
      items: items.map((i) => ({
        menu_item_id: i.menu_item_id,
        quantity: i.quantity,
      })),
    };
    const queueLite: OrderLite[] = queue.map((q) => ({
      id: q.order.id,
      status: q.order.status,
      created_at: q.order.created_at,
      cooking_started_at: q.order.cooking_started_at,
      items: q.items,
    }));
    return waitRangeLabel(estimateWaitMinutes(target, queueLite, now));
  }, [order, items, queue, now]);

  const position = useMemo(() => {
    if (!order) return null;
    const active = queue.filter(
      (q) =>
        (q.order.status === "queued" || q.order.status === "cooking") &&
        new Date(q.order.created_at) <= new Date(order.created_at)
    );
    return active.length;
  }, [order, queue]);

  async function callServer() {
    if (!order || callingServer) return;
    setCallingServer(true);
    try {
      const sb = supabase();
      await sb.from("server_calls").insert({
        table_id: order.table_id,
        order_id: order.id,
        reason: "From order status page",
      });
      setServerCalled(true);
      setTimeout(() => setServerCalled(false), 4000);
    } catch {
      // ignore — they can flag staff directly
    } finally {
      setCallingServer(false);
    }
  }

  async function submitRating() {
    if (!order || chosenRating === null) return;
    setSubmittingRating(true);
    try {
      const sb = supabase();
      await sb
        .from("orders")
        .update({
          rating: chosenRating,
          rating_at: new Date().toISOString(),
          rating_note: ratingNote.trim() || null,
        })
        .eq("id", order.id);
      // local optimistic update
      setOrder({
        ...order,
        rating: chosenRating,
        rating_at: new Date().toISOString(),
        rating_note: ratingNote.trim() || null,
      });
    } catch {
      // swallow
    } finally {
      setSubmittingRating(false);
    }
  }

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="card p-6 max-w-md text-center">
          <div className="text-4xl mb-2">⚠️</div>
          <p className="text-sm">{error}</p>
        </div>
      </main>
    );
  }

  if (!order) {
    return <main className="p-8 text-center">Loading your order…</main>;
  }

  const statusColor: Record<string, string> = {
    queued: "bg-stone-200 text-stone-800",
    cooking: "bg-amber-100 text-amber-900",
    ready: "bg-green-100 text-green-900",
    served: "bg-blue-100 text-blue-900",
    cancelled: "bg-red-100 text-red-900",
  };

  return (
    <main className="min-h-screen pb-24">
      <header className="bg-sapthagiri-burgundy text-white">
        <div className="max-w-2xl mx-auto px-4 py-5">
          <div className="text-xs uppercase tracking-[0.25em] text-sapthagiri-gold">
            Sapthagiri
          </div>
          <h1 className="text-xl font-display">
            Order Status — Table {order.table_id}
          </h1>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">
        <div className="card p-6 text-center">
          <div className="flex justify-center mb-3">
            <span className={`badge ${statusColor[order.status] ?? ""} text-sm`}>
              {order.status}
            </span>
          </div>

          {order.status === "ready" ? (
            <>
              <div className="text-5xl mb-2">🛎️</div>
              <div className="text-2xl font-display text-sapthagiri-burgundy">
                Your order is ready!
              </div>
              <p className="text-sm text-stone-600 mt-2">
                Pickup at the counter or wait for it to be served to Table{" "}
                {order.table_id}.
              </p>
            </>
          ) : order.status === "served" ? (
            <>
              <div className="text-5xl mb-2">🍽️</div>
              <div className="text-xl font-display">Enjoy your meal!</div>
            </>
          ) : (
            <>
              <div className="text-xs uppercase tracking-widest text-stone-500">
                Estimated wait
              </div>
              <div className="text-5xl font-display text-sapthagiri-burgundy my-2">
                {waitLabel}
              </div>
              {position !== null && (
                <p className="text-sm text-stone-600">
                  Queue position: <strong>#{position}</strong>
                </p>
              )}
              <p className="text-xs text-stone-500 mt-2">
                Updates live — keep this page open.
              </p>
            </>
          )}
        </div>

        {/* Rating prompt after served */}
        {order.status === "served" && (
          <div className="card p-5">
            {order.rating ? (
              <div className="text-center">
                <div className="text-2xl mb-1">
                  {"⭐".repeat(order.rating)}
                  {"☆".repeat(5 - order.rating)}
                </div>
                <p className="text-sm text-stone-600">Thanks for your feedback!</p>
                {order.rating_note && (
                  <p className="text-xs text-stone-500 mt-1 italic">
                    "{order.rating_note}"
                  </p>
                )}
              </div>
            ) : (
              <>
                <h3 className="font-semibold text-center">
                  How was your meal?
                </h3>
                <p className="text-xs text-stone-500 text-center mb-3">
                  Tap a star to rate.
                </p>
                <div className="flex justify-center gap-2 mb-3">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      onClick={() => setChosenRating(n)}
                      className="text-3xl transition transform hover:scale-110"
                      aria-label={`${n} stars`}
                    >
                      {chosenRating !== null && n <= chosenRating ? "⭐" : "☆"}
                    </button>
                  ))}
                </div>
                <textarea
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                  placeholder="Leave a note (optional)"
                  rows={2}
                  value={ratingNote}
                  onChange={(e) => setRatingNote(e.target.value)}
                />
                <button
                  onClick={submitRating}
                  disabled={chosenRating === null || submittingRating}
                  className="mt-3 w-full btn-primary"
                >
                  {submittingRating ? "Sending…" : "Submit rating"}
                </button>
              </>
            )}
          </div>
        )}

        {/* Order details */}
        <div className="card p-4">
          <h3 className="font-semibold mb-2">Your order</h3>
          <ul className="divide-y divide-stone-200">
            {items.map((i) => (
              <li key={i.id} className="py-2">
                <div className="font-medium">
                  {i.quantity} × {i.name}{" "}
                  <span className="text-xs text-stone-500 ml-1">
                    {i.crispiness === "crispy" ? "✨ crispy" : "☁️ soft"}{" "}
                    · {i.cook_medium === "ghee" ? "🧈 ghee" : "🛢️ oil"}
                  </span>
                </div>
                {i.addons && i.addons.length > 0 && (
                  <div className="text-xs text-stone-700 mt-1 flex flex-wrap gap-1">
                    {i.addons.map((a) => (
                      <span
                        key={a}
                        className="bg-sapthagiri-cream border border-sapthagiri-gold/40 px-2 py-0.5 rounded-full"
                      >
                        + {ADDONS_BY_ID[a]?.label ?? a.replace(/-/g, " ")}
                      </span>
                    ))}
                  </div>
                )}
                {i.no_onion_garlic && (
                  <div className="text-xs text-amber-800 mt-0.5">
                    🚫 No onion, no garlic (Jain masala)
                  </div>
                )}
                {i.masala_on_side && (
                  <div className="text-xs text-sapthagiri-burgundy mt-0.5">
                    ⚪ Masala on the side
                  </div>
                )}
              </li>
            ))}
          </ul>
          {order.notes && (
            <p className="text-xs text-stone-500 mt-3 italic">
              Note: "{order.notes}"
            </p>
          )}
        </div>

        {/* Action buttons */}
        <div className="grid grid-cols-2 gap-2">
          <Link
            href={`/order?table=${encodeURIComponent(order.table_id)}`}
            className="rounded-lg border-2 border-sapthagiri-burgundy text-sapthagiri-burgundy bg-white text-center px-4 py-3 font-semibold hover:bg-sapthagiri-cream"
          >
            + Order more
          </Link>
          <button
            onClick={callServer}
            disabled={callingServer || serverCalled}
            className={`rounded-lg border-2 text-center px-4 py-3 font-semibold ${
              serverCalled
                ? "bg-green-50 border-green-300 text-green-800"
                : "bg-white border-stone-300 text-stone-700 hover:bg-stone-50"
            }`}
          >
            {serverCalled
              ? "✓ Server notified"
              : callingServer
              ? "Calling…"
              : "🛎️ Call Server"}
          </button>
        </div>

        <p className="text-xs text-center text-stone-500">
          Order ID: <code>{order.id.slice(0, 8)}</code>
        </p>
      </div>
    </main>
  );
}
