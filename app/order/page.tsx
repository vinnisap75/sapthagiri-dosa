"use client";

import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { MENU, MenuItem } from "@/lib/menu";
import { isValidTable } from "@/lib/tables";
import { supabase } from "@/lib/supabase";

interface LineItem {
  itemId: string;
  qty: number;
  noOnionGarlic: boolean;
}

function OrderInner() {
  const params = useSearchParams();
  const router = useRouter();
  const tableId = params.get("table") || "";
  const validTable = isValidTable(tableId);

  const [lines, setLines] = useState<Record<string, LineItem>>({});
  const [customerName, setCustomerName] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cartLines = Object.values(lines).filter((l) => l.qty > 0);
  const total = useMemo(() => {
    return cartLines.reduce((sum, l) => {
      const m = MENU.find((x) => x.id === l.itemId);
      return sum + (m ? m.price * l.qty : 0);
    }, 0);
  }, [cartLines]);

  function bump(item: MenuItem, delta: number) {
    setLines((prev) => {
      const cur = prev[item.id] ?? {
        itemId: item.id,
        qty: 0,
        noOnionGarlic: false,
      };
      const next = Math.max(0, cur.qty + delta);
      return { ...prev, [item.id]: { ...cur, qty: next } };
    });
  }
  function toggleNOG(itemId: string) {
    setLines((prev) => {
      const cur = prev[itemId];
      if (!cur) return prev;
      return { ...prev, [itemId]: { ...cur, noOnionGarlic: !cur.noOnionGarlic } };
    });
  }

  async function submit() {
    setError(null);
    if (!validTable) {
      setError("Invalid table — please rescan the QR at your table.");
      return;
    }
    if (cartLines.length === 0) {
      setError("Add at least one item before placing the order.");
      return;
    }
    setSubmitting(true);
    try {
      const sb = supabase();
      const totalCents = Math.round(total * 100);
      const { data: orderRow, error: insErr } = await sb
        .from("orders")
        .insert({
          table_id: tableId,
          customer_name: customerName.trim() || null,
          notes: notes.trim() || null,
          status: "queued",
          total_cents: totalCents,
        })
        .select()
        .single();

      if (insErr || !orderRow) {
        throw insErr ?? new Error("Failed to create order");
      }

      const itemRows = cartLines.map((l) => {
        const m = MENU.find((x) => x.id === l.itemId)!;
        return {
          order_id: orderRow.id,
          menu_item_id: m.id,
          name: m.name,
          quantity: l.qty,
          unit_price_cents: Math.round(m.price * 100),
          cook_minutes: m.cookMinutes,
          category: m.category,
          no_onion_garlic: l.noOnionGarlic && !!m.hasMasalaFilling,
        };
      });

      const { error: itemsErr } = await sb.from("order_items").insert(itemRows);
      if (itemsErr) throw itemsErr;

      router.push(`/status/${orderRow.id}`);
    } catch (e) {
      setError(
        e instanceof Error
          ? `${e.message} — is the schema installed and .env.local set?`
          : "Submission failed."
      );
      setSubmitting(false);
    }
  }

  if (!validTable) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="card p-6 max-w-md text-center">
          <div className="text-4xl mb-2">😕</div>
          <h1 className="text-xl font-semibold mb-1">Table not recognised</h1>
          <p className="text-sm text-stone-600">
            Please rescan the QR code on your table. If it keeps failing, ask a
            server for help.
          </p>
        </div>
      </main>
    );
  }

  const dosas = MENU.filter((m) => m.category === "dosa");
  const uttapams = MENU.filter((m) => m.category === "uttapam");

  return (
    <main className="min-h-screen pb-32">
      <header className="bg-sapthagiri-burgundy text-white">
        <div className="max-w-2xl mx-auto px-4 py-5 flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-[0.25em] text-sapthagiri-gold">
              Sapthagiri
            </div>
            <h1 className="text-xl font-display">Order — Table {tableId}</h1>
          </div>
          <div className="text-right text-xs">
            <div className="text-sapthagiri-gold uppercase tracking-wider">Total</div>
            <div className="text-lg font-semibold">${total.toFixed(2)}</div>
          </div>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-4 space-y-6">
        <Section title="Dosa" subtitle="Served with sambar and chutney">
          {dosas.map((m) => (
            <ItemRow
              key={m.id}
              item={m}
              line={lines[m.id]}
              onBump={(d) => bump(m, d)}
              onToggleNOG={() => toggleNOG(m.id)}
            />
          ))}
        </Section>

        <Section title="Uttapam" subtitle="Thick rice-and-lentil pancakes">
          {uttapams.map((m) => (
            <ItemRow
              key={m.id}
              item={m}
              line={lines[m.id]}
              onBump={(d) => bump(m, d)}
              onToggleNOG={() => toggleNOG(m.id)}
            />
          ))}
        </Section>

        <div className="card p-4 space-y-3">
          <h3 className="font-semibold">Your details</h3>
          <div className="grid gap-2">
            <input
              className="border rounded-lg px-3 py-2 text-sm"
              placeholder="Your name (optional)"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
            />
            <textarea
              className="border rounded-lg px-3 py-2 text-sm"
              placeholder="Notes for the kitchen (optional) — e.g. extra spicy, no chutney…"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-3 text-sm">
            {error}
          </div>
        )}
      </div>

      <div className="fixed bottom-0 inset-x-0 bg-white border-t border-stone-200 shadow-lg">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <div className="flex-1">
            <div className="text-xs text-stone-500">
              {cartLines.length === 0
                ? "Add items to begin"
                : `${cartLines.reduce((a, b) => a + b.qty, 0)} item(s)`}
            </div>
            <div className="font-semibold text-lg">${total.toFixed(2)}</div>
          </div>
          <button
            onClick={submit}
            disabled={submitting || cartLines.length === 0}
            className="btn-primary text-base px-6 py-3"
          >
            {submitting ? "Sending…" : "Place order"}
          </button>
        </div>
      </div>
    </main>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card overflow-hidden">
      <div className="px-4 py-3 bg-sapthagiri-cream border-b border-stone-200">
        <h2 className="font-display text-lg text-sapthagiri-burgundy">{title}</h2>
        {subtitle && <p className="text-xs text-stone-500">{subtitle}</p>}
      </div>
      <ul className="divide-y divide-stone-200">{children}</ul>
    </section>
  );
}

function ItemRow({
  item,
  line,
  onBump,
  onToggleNOG,
}: {
  item: MenuItem;
  line?: LineItem;
  onBump: (delta: number) => void;
  onToggleNOG: () => void;
}) {
  const qty = line?.qty ?? 0;
  const nog = line?.noOnionGarlic ?? false;
  return (
    <li className="px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium">{item.name}</span>
            {item.vegOption && (
              <span className="badge bg-green-100 text-green-800">
                {item.vegOption}
              </span>
            )}
          </div>
          <p className="text-xs text-stone-500 mt-0.5">{item.description}</p>
          <p className="text-sm text-stone-700 mt-1">${item.price.toFixed(2)}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onBump(-1)}
            disabled={qty === 0}
            className="w-8 h-8 rounded-full border border-stone-300 text-lg disabled:opacity-40"
            aria-label="decrement"
          >
            −
          </button>
          <span className="w-6 text-center font-semibold">{qty}</span>
          <button
            onClick={() => onBump(1)}
            className="w-8 h-8 rounded-full bg-sapthagiri-burgundy text-white text-lg"
            aria-label="increment"
          >
            +
          </button>
        </div>
      </div>
      {qty > 0 && item.hasMasalaFilling && (
        <label className="mt-3 flex items-center gap-2 text-sm bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 cursor-pointer">
          <input
            type="checkbox"
            checked={nog}
            onChange={onToggleNOG}
            className="accent-sapthagiri-burgundy"
          />
          <span>
            <strong>No onion, no garlic</strong> · Jain-style masala (potato
            filling only)
          </span>
        </label>
      )}
    </li>
  );
}

export default function OrderPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center">Loading menu…</div>}>
      <OrderInner />
    </Suspense>
  );
}
