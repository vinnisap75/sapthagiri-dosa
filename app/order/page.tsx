"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { MENU, MenuItem, addonsForCategory, ADDONS_BY_ID } from "@/lib/menu";
import { isValidTable } from "@/lib/tables";
import { supabase } from "@/lib/supabase";

/** One configurable row in the cart. Each customizable item may have many
 *  lines (each with its own toppings); non-customizable items share a line. */
interface Line {
  lineId: string;
  itemId: string;
  qty: number;
  noOnionGarlic: boolean;
  masalaOnSide: boolean;
  addons: string[];
}

function newLineId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function OrderInner() {
  const params = useSearchParams();
  const router = useRouter();
  const tableId = params.get("table") || "";
  const validTable = isValidTable(tableId);

  const [lines, setLines] = useState<Line[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [notes, setNotes] = useState("");
  const [partySize, setPartySize] = useState<number | null>(null);
  const [cookMedium, setCookMedium] = useState<"oil" | "ghee">("oil");
  const [crispiness, setCrispiness] = useState<"crispy" | "soft">("crispy");
  const [showPreview, setShowPreview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [callingServer, setCallingServer] = useState(false);
  const [serverCalled, setServerCalled] = useState(false);

  const totalItems = lines.reduce((a, b) => a + b.qty, 0);

  /** Add one of `item` to the cart. For customizable items, every call adds
   *  a new line so the customer can configure each independently. */
  function addOne(item: MenuItem) {
    setLines((prev) => {
      if (item.isCustomizable) {
        return [
          ...prev,
          {
            lineId: newLineId(),
            itemId: item.id,
            qty: 1,
            noOnionGarlic: false,
            masalaOnSide: false,
            addons: [],
          },
        ];
      }
      // Non-customizable: merge into existing line if any.
      const existing = prev.find((l) => l.itemId === item.id);
      if (existing) {
        return prev.map((l) =>
          l.lineId === existing.lineId ? { ...l, qty: l.qty + 1 } : l
        );
      }
      return [
        ...prev,
        {
          lineId: newLineId(),
          itemId: item.id,
          qty: 1,
          noOnionGarlic: false,
          masalaOnSide: false,
          addons: [],
        },
      ];
    });
  }

  function bumpLine(lineId: string, delta: number) {
    setLines((prev) =>
      prev
        .map((l) => (l.lineId === lineId ? { ...l, qty: l.qty + delta } : l))
        .filter((l) => l.qty > 0)
    );
  }
  function deleteLine(lineId: string) {
    setLines((prev) => prev.filter((l) => l.lineId !== lineId));
  }
  function toggleFlag(lineId: string, key: "noOnionGarlic" | "masalaOnSide") {
    setLines((prev) =>
      prev.map((l) => (l.lineId === lineId ? { ...l, [key]: !l[key] } : l))
    );
  }
  function toggleAddon(lineId: string, addonId: string) {
    setLines((prev) =>
      prev.map((l) => {
        if (l.lineId !== lineId) return l;
        const has = l.addons.includes(addonId);
        return {
          ...l,
          addons: has ? l.addons.filter((a) => a !== addonId) : [...l.addons, addonId],
        };
      })
    );
  }

  async function callServer(reason: string) {
    if (callingServer) return;
    setCallingServer(true);
    try {
      const sb = supabase();
      await sb.from("server_calls").insert({
        table_id: tableId,
        reason,
      });
      setServerCalled(true);
      setTimeout(() => setServerCalled(false), 4000);
    } catch (e) {
      setError("Could not reach a server — please flag staff directly.");
    } finally {
      setCallingServer(false);
    }
  }

  async function submit() {
    setError(null);
    if (!validTable) {
      setError("Invalid table — please rescan the QR at your table.");
      return;
    }
    if (lines.length === 0) {
      setError("Add at least one item before placing the order.");
      return;
    }
    setSubmitting(true);
    try {
      const sb = supabase();
      // Compute total internally — never shown to the customer.
      const totalCents = lines.reduce((sum, l) => {
        const m = MENU.find((x) => x.id === l.itemId);
        if (!m) return sum;
        const addonsPrice = l.addons.reduce(
          (s, a) => s + (ADDONS_BY_ID[a]?.extraPrice ?? 0) * 100,
          0
        );
        return sum + (Math.round(m.price * 100) + Math.round(addonsPrice)) * l.qty;
      }, 0);

      const { data: orderRow, error: insErr } = await sb
        .from("orders")
        .insert({
          table_id: tableId,
          customer_name: customerName.trim() || null,
          notes: notes.trim() || null,
          status: "queued",
          total_cents: totalCents,
          cook_medium: cookMedium,
          crispiness: crispiness,
          party_size: partySize,
        })
        .select()
        .single();
      if (insErr || !orderRow) throw insErr ?? new Error("Failed to create order");

      const itemRows = lines.map((l) => {
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
          masala_on_side: l.masalaOnSide && m.category === "dosa",
          addons: m.isCustomizable ? l.addons : [],
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

  const dosas = MENU.filter((m) => m.category === "dosa" && !m.isCustomizable);
  const uttapams = MENU.filter((m) => m.category === "uttapam" && !m.isCustomizable);
  const customDosa = MENU.find((m) => m.id === "custom-dosa")!;
  const customUttapam = MENU.find((m) => m.id === "custom-uttapam")!;

  const customDosaLines = lines.filter((l) => l.itemId === "custom-dosa");
  const customUttapamLines = lines.filter((l) => l.itemId === "custom-uttapam");

  return (
    <main className="min-h-screen pb-40">
      <header className="bg-sapthagiri-burgundy text-white">
        <div className="max-w-2xl mx-auto px-4 py-5 flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-[0.25em] text-sapthagiri-gold">
              Sapthagiri
            </div>
            <h1 className="text-xl font-display">Order — Table {tableId}</h1>
          </div>
          <div className="text-right text-xs">
            <div className="text-sapthagiri-gold uppercase tracking-wider">
              Items
            </div>
            <div className="text-lg font-semibold tabular-nums">{totalItems}</div>
          </div>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-4 space-y-6">
        {/* Party size — helps the server know who to expect at the table */}
        <section className="card p-4">
          <h2 className="font-display text-lg text-sapthagiri-burgundy mb-1">
            How many people at your table?
          </h2>
          <p className="text-xs text-stone-500 mb-3">
            So the server knows how many to look after.
          </p>
          <div className="flex flex-wrap gap-2">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
              <PillToggle
                key={n}
                label={n === 8 ? "8+" : String(n)}
                active={partySize === n}
                onClick={() => setPartySize(n)}
              />
            ))}
          </div>
        </section>

        {/* Cook preferences — applied to every dosa in the order */}
        <section className="card p-4">
          <h2 className="font-display text-lg text-sapthagiri-burgundy mb-1">
            How would you like it cooked?
          </h2>
          <p className="text-xs text-stone-500 mb-3">
            Applies to every dosa in this order.
          </p>
          <div className="grid grid-cols-2 gap-2 mb-3">
            <PillToggle
              label="🧈 Amul Ghee"
              active={cookMedium === "ghee"}
              onClick={() => setCookMedium("ghee")}
            />
            <PillToggle
              label="🛢️ Oil"
              active={cookMedium === "oil"}
              onClick={() => setCookMedium("oil")}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <PillToggle
              label="✨ Crispy"
              active={crispiness === "crispy"}
              onClick={() => setCrispiness("crispy")}
            />
            <PillToggle
              label="☁️ Soft"
              active={crispiness === "soft"}
              onClick={() => setCrispiness("soft")}
            />
          </div>
        </section>

        {/* Build your own (dosa + uttapam) */}
        <Section
          title="Build your own"
          subtitle="One row per custom dosa or uttapam — add multiple with different toppings"
        >
          <BuildYourOwn
            base={customDosa}
            lines={customDosaLines}
            onAdd={() => addOne(customDosa)}
            onBump={bumpLine}
            onDelete={deleteLine}
            onToggleAddon={toggleAddon}
            onToggleFlag={toggleFlag}
          />
          <BuildYourOwn
            base={customUttapam}
            lines={customUttapamLines}
            onAdd={() => addOne(customUttapam)}
            onBump={bumpLine}
            onDelete={deleteLine}
            onToggleAddon={toggleAddon}
            onToggleFlag={toggleFlag}
          />
        </Section>

        <Section title="Dosa" subtitle="Served with sambar and chutney">
          {dosas.map((m) => (
            <FixedItemRow
              key={m.id}
              item={m}
              line={lines.find((l) => l.itemId === m.id)}
              onAdd={() => addOne(m)}
              onBump={bumpLine}
              onToggleFlag={toggleFlag}
            />
          ))}
        </Section>

        <Section title="Uttapam" subtitle="Thick rice-and-lentil pancakes">
          {uttapams.map((m) => (
            <FixedItemRow
              key={m.id}
              item={m}
              line={lines.find((l) => l.itemId === m.id)}
              onAdd={() => addOne(m)}
              onBump={bumpLine}
              onToggleFlag={toggleFlag}
            />
          ))}
        </Section>

        <div className="card p-4 space-y-3">
          <h3 className="font-semibold">Your details</h3>
          <div className="grid gap-2">
            <input
              className="border rounded-lg px-3 py-2 text-sm"
              placeholder="Your name (helps the server find you)"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
            />
            <textarea
              className="border rounded-lg px-3 py-2 text-sm"
              placeholder="Notes for the kitchen (optional)"
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

      {/* Sticky bottom bar with Call Server + Review */}
      <div className="fixed bottom-0 inset-x-0 bg-white border-t border-stone-200 shadow-lg">
        <div className="max-w-2xl mx-auto px-4 py-3 space-y-2">
          <div className="flex items-center gap-2">
            <button
              onClick={() => callServer("From order screen")}
              disabled={callingServer || serverCalled}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition ${
                serverCalled
                  ? "bg-green-50 border-green-300 text-green-800"
                  : "border-stone-300 hover:bg-stone-50"
              }`}
            >
              {serverCalled
                ? "✓ Server notified — they're on their way"
                : callingServer
                ? "Calling…"
                : "🛎️ Call Server"}
            </button>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <div className="text-xs uppercase tracking-wider text-stone-500">
                Your basket
              </div>
              <div className="font-semibold text-lg tabular-nums">
                {totalItems === 0
                  ? "No items yet"
                  : `${totalItems} item${totalItems === 1 ? "" : "s"}`}
              </div>
            </div>
            <button
              onClick={() => setShowPreview(true)}
              disabled={lines.length === 0}
              className="btn-primary text-base px-6 py-3"
            >
              Review →
            </button>
          </div>
        </div>
      </div>

      {/* Preview modal */}
      {showPreview && (
        <PreviewModal
          lines={lines}
          customerName={customerName}
          notes={notes}
          cookMedium={cookMedium}
          crispiness={crispiness}
          partySize={partySize}
          tableId={tableId}
          onEdit={() => setShowPreview(false)}
          onConfirm={submit}
          submitting={submitting}
        />
      )}
    </main>
  );
}

// ─────────── presentation components ───────────

function PillToggle({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2 rounded-lg text-sm font-medium transition border ${
        active
          ? "bg-sapthagiri-burgundy text-white border-sapthagiri-burgundy"
          : "bg-white text-stone-700 border-stone-300 hover:border-stone-500"
      }`}
    >
      {label}
    </button>
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
      <div className="divide-y divide-stone-200">{children}</div>
    </section>
  );
}

function FixedItemRow({
  item,
  line,
  onAdd,
  onBump,
  onToggleFlag,
}: {
  item: MenuItem;
  line?: Line;
  onAdd: () => void;
  onBump: (lineId: string, delta: number) => void;
  onToggleFlag: (lineId: string, key: "noOnionGarlic" | "masalaOnSide") => void;
}) {
  const qty = line?.qty ?? 0;
  return (
    <div className="px-4 py-3">
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
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => line && onBump(line.lineId, -1)}
            disabled={qty === 0}
            className="w-8 h-8 rounded-full border border-stone-300 text-lg disabled:opacity-40"
            aria-label="decrement"
          >
            −
          </button>
          <span className="w-6 text-center font-semibold">{qty}</span>
          <button
            onClick={onAdd}
            className="w-8 h-8 rounded-full bg-sapthagiri-burgundy text-white text-lg"
            aria-label="increment"
          >
            +
          </button>
        </div>
      </div>
      {line && line.qty > 0 && item.hasMasalaFilling && (
        <label className="mt-2 flex items-center gap-2 text-sm bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 cursor-pointer">
          <input
            type="checkbox"
            checked={line.masalaOnSide}
            onChange={() => onToggleFlag(line.lineId, "masalaOnSide")}
            className="accent-sapthagiri-burgundy"
          />
          <span>
            <strong>Masala on the side</strong> — get the potato filling
            separately
          </span>
        </label>
      )}
      {line && line.qty > 0 && item.hasMasalaFilling && (
        <label className="mt-2 flex items-center gap-2 text-sm bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 cursor-pointer">
          <input
            type="checkbox"
            checked={line.noOnionGarlic}
            onChange={() => onToggleFlag(line.lineId, "noOnionGarlic")}
            className="accent-sapthagiri-burgundy"
          />
          <span>
            <strong>No onion, no garlic</strong> · Jain-style masala
          </span>
        </label>
      )}
    </div>
  );
}

function BuildYourOwn({
  base,
  lines,
  onAdd,
  onBump,
  onDelete,
  onToggleAddon,
  onToggleFlag,
}: {
  base: MenuItem;
  lines: Line[];
  onAdd: () => void;
  onBump: (lineId: string, delta: number) => void;
  onDelete: (lineId: string) => void;
  onToggleAddon: (lineId: string, addonId: string) => void;
  onToggleFlag: (lineId: string, key: "noOnionGarlic" | "masalaOnSide") => void;
}) {
  const addons = addonsForCategory(base.category);
  return (
    <div className="px-4 py-3 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-medium">{base.name}</div>
          <p className="text-xs text-stone-500">{base.description}</p>
        </div>
        <button
          onClick={onAdd}
          className="rounded-lg bg-sapthagiri-burgundy text-white text-sm px-3 py-2 whitespace-nowrap"
        >
          + Add
        </button>
      </div>

      {lines.length === 0 ? (
        <p className="text-xs text-stone-400">Tap "Add" to start building one.</p>
      ) : (
        <div className="space-y-3">
          {lines.map((line, idx) => (
            <div
              key={line.lineId}
              className="rounded-lg border border-stone-200 bg-stone-50 p-3"
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="text-sm font-semibold">
                  {base.name} #{idx + 1}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => onBump(line.lineId, -1)}
                    className="w-7 h-7 rounded-full border border-stone-300 text-base"
                    aria-label="decrement"
                  >
                    −
                  </button>
                  <span className="w-6 text-center font-semibold">{line.qty}</span>
                  <button
                    onClick={() => onBump(line.lineId, +1)}
                    className="w-7 h-7 rounded-full bg-sapthagiri-burgundy text-white text-base"
                    aria-label="increment"
                  >
                    +
                  </button>
                  <button
                    onClick={() => onDelete(line.lineId)}
                    className="ml-1 text-stone-400 hover:text-red-600 text-sm px-1"
                    aria-label="remove"
                  >
                    ✕
                  </button>
                </div>
              </div>

              <div className="text-[10px] uppercase tracking-wider text-stone-500 mb-1.5">
                Toppings
              </div>
              <div className="flex flex-wrap gap-1.5">
                {addons.map((a) => {
                  const on = line.addons.includes(a.id);
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => onToggleAddon(line.lineId, a.id)}
                      className={`px-2.5 py-1 rounded-full text-xs border transition ${
                        on
                          ? "bg-sapthagiri-burgundy text-white border-sapthagiri-burgundy"
                          : "bg-white text-stone-700 border-stone-300 hover:border-stone-500"
                      }`}
                    >
                      {on ? "✓ " : "+ "}
                      {a.label}
                    </button>
                  );
                })}
              </div>

              {/* Masala-on-side only makes sense for items that have a
                  built-in masala filling, so it's not shown on Build Your
                  Own — customers compose their own toppings here. */}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────── preview modal ───────────

function PreviewModal({
  lines,
  customerName,
  notes,
  cookMedium,
  crispiness,
  partySize,
  tableId,
  onEdit,
  onConfirm,
  submitting,
}: {
  lines: Line[];
  customerName: string;
  notes: string;
  cookMedium: "ghee" | "oil";
  crispiness: "soft" | "crispy";
  partySize: number | null;
  tableId: string;
  onEdit: () => void;
  onConfirm: () => void;
  submitting: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-stone-200 sticky top-0 bg-white">
          <h2 className="text-lg font-display text-sapthagiri-burgundy">
            Review your order — Table {tableId}
          </h2>
          <p className="text-xs text-stone-500">
            Last chance to edit — once you confirm, it's on the way.
          </p>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div className="text-sm text-stone-700 flex flex-wrap gap-2">
            {partySize && (
              <span className="inline-flex items-center gap-1 bg-stone-100 rounded-full px-3 py-1">
                👥 {partySize === 8 ? "8+" : partySize}{" "}
                {partySize === 1 ? "person" : "people"}
              </span>
            )}
            <span className="inline-flex items-center gap-1 bg-stone-100 rounded-full px-3 py-1">
              {cookMedium === "ghee" ? "🧈 Amul Ghee" : "🛢️ Oil"}
            </span>
            <span className="inline-flex items-center gap-1 bg-stone-100 rounded-full px-3 py-1">
              {crispiness === "crispy" ? "✨ Crispy" : "☁️ Soft"}
            </span>
          </div>

          <ul className="divide-y divide-stone-200">
            {lines.map((l) => {
              const m = MENU.find((x) => x.id === l.itemId)!;
              return (
                <li key={l.lineId} className="py-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium">
                      {l.qty} × {m.name}
                    </span>
                    {l.noOnionGarlic && (
                      <span className="badge bg-amber-100 text-amber-900">
                        🚫 no onion / garlic
                      </span>
                    )}
                  </div>
                  {l.addons.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {l.addons.map((a) => (
                        <span
                          key={a}
                          className="text-[11px] bg-sapthagiri-burgundy text-white px-2 py-0.5 rounded-full"
                        >
                          + {ADDONS_BY_ID[a]?.label ?? a}
                        </span>
                      ))}
                    </div>
                  )}
                  {l.masalaOnSide && (
                    <div className="mt-1 text-xs text-sapthagiri-burgundy">
                      ⚪ Masala on the side
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          {customerName && (
            <p className="text-xs text-stone-500">
              Name: <strong className="text-stone-700">{customerName}</strong>
            </p>
          )}
          {notes && (
            <p className="text-xs text-stone-500 italic">
              Note for kitchen: "{notes}"
            </p>
          )}
        </div>

        <div className="px-5 py-3 border-t border-stone-200 bg-stone-50 sticky bottom-0 flex gap-2">
          <button
            onClick={onEdit}
            disabled={submitting}
            className="flex-1 rounded-lg border border-stone-300 bg-white px-4 py-3 font-medium hover:bg-stone-100"
          >
            ← Edit
          </button>
          <button
            onClick={onConfirm}
            disabled={submitting}
            className="flex-1 rounded-lg bg-sapthagiri-burgundy text-white px-4 py-3 font-medium hover:bg-[#561624] disabled:opacity-60"
          >
            {submitting ? "Sending…" : "Send to kitchen →"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function OrderPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center">Loading menu…</div>}>
      <OrderInner />
    </Suspense>
  );
}
