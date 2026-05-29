"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { MENU, MenuItem, addonsForCategory, ADDONS_BY_ID } from "@/lib/menu";
import { isValidTable } from "@/lib/tables";
import { supabase } from "@/lib/supabase";
import {
  SERVICES,
  LIMITED_MENU_IDS,
  getActiveService,
  getJustClosedService,
  formatServiceHours,
  serviceDayName,
  ServiceWindow,
} from "@/lib/services";
import { BrandLogo } from "@/app/_components/BrandLogo";

/** One configurable row in the cart. Each customizable item may have many
 *  lines (each with its own toppings); non-customizable items share a line. */
interface Line {
  lineId: string;
  itemId: string;
  qty: number;
  noOnionGarlic: boolean;
  masalaOnSide: boolean;
  crispiness: "crispy" | "soft";
  cookMedium: "oil" | "ghee";
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
  const [showPreview, setShowPreview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [callingServer, setCallingServer] = useState(false);
  const [serverCalled, setServerCalled] = useState(false);
  const [staffLoggedIn, setStaffLoggedIn] = useState(false);

  // Staff bypass: if a Supabase session exists (manager/kitchen logged in on
  // this device), open the menu regardless of the day/time gate so they can
  // demo or test the flow.
  useEffect(() => {
    let cancelled = false;
    supabase()
      .auth.getSession()
      .then(({ data }) => {
        if (!cancelled) setStaffLoggedIn(!!data.session);
      })
      .catch(() => {
        // Ignore — if Supabase isn't configured, just leave staffLoggedIn false.
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
            crispiness: "crispy",
            cookMedium: "oil",
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
          crispiness: "crispy",
          cookMedium: "oil",
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
  function setLineCrispiness(lineId: string, value: "crispy" | "soft") {
    setLines((prev) =>
      prev.map((l) => (l.lineId === lineId ? { ...l, crispiness: value } : l))
    );
  }
  function setLineCookMedium(lineId: string, value: "ghee" | "oil") {
    setLines((prev) =>
      prev.map((l) => (l.lineId === lineId ? { ...l, cookMedium: value } : l))
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
      // Goes through call_server RPC (rate-limited + length-checked) — the
      // server_calls table no longer accepts direct anon inserts.
      const { error: rpcErr } = await sb.rpc("call_server", {
        p_table_id: tableId,
        p_order_id: null,
        p_reason: reason,
      });
      if (rpcErr) throw rpcErr;
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
          party_size: partySize,
          // Test mode — when /admin/preview submits with ?test=1 the
          // order lands flagged so kitchen + stats can hide it.
          is_test: testMode,
        })
        .select()
        .single();
      if (insErr || !orderRow) throw insErr ?? new Error("Failed to create order");

      // Each physical dosa gets its own row so the kitchen can check them
      // off independently. qty=3 → 3 rows of quantity=1.
      const itemRows = lines.flatMap((l) => {
        const m = MENU.find((x) => x.id === l.itemId)!;
        const base = {
          order_id: orderRow.id,
          menu_item_id: m.id,
          name: m.name,
          quantity: 1,
          unit_price_cents: Math.round(m.price * 100),
          cook_minutes: m.cookMinutes,
          category: m.category,
          no_onion_garlic: l.noOnionGarlic && !!m.hasMasalaFilling,
          masala_on_side: l.masalaOnSide && m.category === "dosa",
          crispiness: l.crispiness,
          cook_medium: l.cookMedium,
          addons: m.isCustomizable ? l.addons : [],
        };
        return Array.from({ length: l.qty }, () => ({ ...base }));
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

  // Digital ordering is only open during our defined service windows
  // (see lib/services.ts).  Staff bypasses:
  //   • signed-in staff (Supabase session) → always open
  //   • ?preview=1 query param → always open (demos / screenshots)
  //   • ?service=wednesday|saturday|sunday → force a specific service so
  //     admin can preview Sat/Sun limited menu mid-week without time travel
  // After a Wednesday close, we surface the Google review CTA.
  const previewMode = params.get("preview") === "1";
  const testMode = params.get("test") === "1";
  const forcedServiceId = params.get("service");
  const forcedService = forcedServiceId
    ? SERVICES.find((s) => s.id === forcedServiceId) ?? null
    : null;
  const activeService = forcedService ?? getActiveService();
  const justClosedService = getJustClosedService();
  const isOpenNow =
    forcedService !== null ||
    previewMode ||
    staffLoggedIn ||
    activeService !== null;

  const GOOGLE_REVIEW_URL =
    "https://www.google.com/maps/place/Sapthagiri+Taste+Of+India/@40.7350028,-74.062476,17z/data=!4m8!3m7!1s0x89c2573021a9bda3:0x92334b2b8a48ba62!8m2!3d40.7350028!4d-74.062476!9m1!1b1";

  if (!isOpenNow) {
    // Only show the review CTA if the most-recent close TODAY was the
    // Wednesday dosa-night service.
    const showReviewCta = justClosedService?.id === "wednesday";
    return (
      <main className="min-h-screen flex items-center justify-center p-6 bg-sapthagiri-cream">
        <div className="card p-8 max-w-md text-center border-2 border-sapthagiri-gold">
          <div className="text-5xl mb-3">{showReviewCta ? "⭐" : "🌙"}</div>
          <div className="text-xs uppercase tracking-[0.25em] text-sapthagiri-gold mb-1">
            Sapthagiri · Table {tableId}
          </div>
          <h1 className="text-2xl font-display text-sapthagiri-burgundy mt-1">
            {showReviewCta
              ? "Thanks for joining us tonight!"
              : "We're closed right now"}
          </h1>

          <p className="text-sm text-stone-700 mt-4">
            The digital menu is only live during our service windows. Here's
            when we're open:
          </p>

          <ul className="mt-3 text-left text-sm bg-white/60 border border-sapthagiri-gold/40 rounded-lg divide-y divide-stone-200 overflow-hidden">
            {SERVICES.map((s) => (
              <li key={s.id} className="px-3 py-2 flex flex-col">
                <span className="font-semibold text-sapthagiri-burgundy">
                  {serviceDayName(s)}
                </span>
                <span className="text-stone-700 tabular-nums">
                  {formatServiceHours(s)}
                </span>
                <span className="text-xs text-stone-500">
                  {s.name}
                  {s.menu === "full" ? " (full menu)" : ""}
                </span>
              </li>
            ))}
          </ul>

          {showReviewCta ? (
            <>
              <p className="text-sm text-stone-700 mt-5 font-semibold">
                Enjoyed your meal? It would mean the world if you left us a
                review on Google Maps.
              </p>
              <a
                href={GOOGLE_REVIEW_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary mt-3 w-full inline-flex justify-center"
              >
                ⭐ Leave a Google review
              </a>
            </>
          ) : (
            <p className="text-sm text-stone-700 mt-4">
              For anything you need right now, please flag down a server.
            </p>
          )}
          <p className="text-xs text-stone-500 mt-4">Thank you! 🙏</p>
        </div>
      </main>
    );
  }

  // Pick the visible menu based on the active service.  Preview / staff
  // bypass with no real service active defaults to the full menu.
  const visibleMenu =
    activeService && activeService.menu === "limited"
      ? MENU.filter((m) => LIMITED_MENU_IDS.includes(m.id))
      : MENU;
  const showRavaDosaCard = activeService ? activeService.showRavaDosaButton : true;
  // Sat/Sun breakfast buffet doesn't run separate Jain masala — hide the
  // "no onion, no garlic" toggle entirely on those services.
  const allowJainModifier = activeService ? activeService.allowJainModifier : true;

  const dosas = visibleMenu.filter((m) => m.category === "dosa" && !m.isCustomizable);
  const uttapams = visibleMenu.filter((m) => m.category === "uttapam" && !m.isCustomizable);
  const customDosa = visibleMenu.find((m) => m.id === "custom-dosa");
  const customUttapam = visibleMenu.find((m) => m.id === "custom-uttapam");
  const showBuildYourOwn = !!customDosa || !!customUttapam;

  const customDosaLines = lines.filter((l) => l.itemId === "custom-dosa");
  const customUttapamLines = lines.filter((l) => l.itemId === "custom-uttapam");

  return (
    <main className="min-h-screen pb-40">
      <header className="bg-sapthagiri-burgundy text-white">
        <div className="max-w-2xl mx-auto px-4 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <BrandLogo variant="full" className="h-11 w-auto shrink-0" priority />
            <div className="min-w-0">
              <h1 className="text-lg font-display leading-none">
                Table {tableId}
              </h1>
              {testMode && (
                <span className="mt-1 inline-block bg-yellow-400 text-black px-2 py-0.5 rounded text-[10px] font-bold">
                  TEST MODE
                </span>
              )}
            </div>
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
        {/* Rava Dosa — not on the digital menu, customer summons a server.
            Only shown during services that offer Rava Dosa (Wed night). */}
        {showRavaDosaCard && (
          <section className="rounded-xl border-2 border-sapthagiri-gold bg-sapthagiri-cream p-4">
            <div className="flex items-start gap-3">
              <div className="text-3xl">🌾</div>
              <div className="flex-1 min-w-0">
                <h2 className="font-display text-lg text-sapthagiri-burgundy">
                  Want a Rava Dosa?
                </h2>
                <p className="text-xs text-stone-600 mt-0.5">
                  Rava dosas are made fresh by a server. Tap below and someone
                  will come by to take your order.
                </p>
              </div>
            </div>
            <button
              onClick={() => callServer("Rava Dosa")}
              disabled={callingServer || serverCalled}
              className={`mt-3 w-full rounded-lg font-semibold py-3 transition ${
                serverCalled
                  ? "bg-green-100 border border-green-300 text-green-800"
                  : "bg-sapthagiri-burgundy text-white hover:bg-[#561624]"
              }`}
            >
              {serverCalled
                ? "✓ Server notified — they're on their way"
                : callingServer
                ? "Calling…"
                : "🛎️ Call server for Rava Dosa"}
            </button>
          </section>
        )}

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


        {/* Build your own (dosa + uttapam) — hidden during limited (breakfast)
            services that don't offer custom builds. */}
        {showBuildYourOwn && (
          <Section
            title="Build your own"
            subtitle="One row per custom dosa or uttapam — add multiple with different toppings"
          >
            {customDosa && (
              <BuildYourOwn
                base={customDosa}
                lines={customDosaLines}
                onAdd={() => addOne(customDosa)}
                onBump={bumpLine}
                onDelete={deleteLine}
                onToggleAddon={toggleAddon}
                onToggleFlag={toggleFlag}
                onSetCrispiness={setLineCrispiness}
                onSetCookMedium={setLineCookMedium}
              />
            )}
            {customUttapam && (
              <BuildYourOwn
                base={customUttapam}
                lines={customUttapamLines}
                onAdd={() => addOne(customUttapam)}
                onBump={bumpLine}
                onDelete={deleteLine}
                onToggleAddon={toggleAddon}
                onToggleFlag={toggleFlag}
                onSetCrispiness={setLineCrispiness}
                onSetCookMedium={setLineCookMedium}
              />
            )}
          </Section>
        )}

        {dosas.length > 0 && (
          <Section title="Dosa" subtitle="Served with sambar and chutney">
            {dosas.map((m) => (
              <FixedItemRow
                key={m.id}
                item={m}
                line={lines.find((l) => l.itemId === m.id)}
                onAdd={() => addOne(m)}
                onBump={bumpLine}
                onToggleFlag={toggleFlag}
                onSetCrispiness={setLineCrispiness}
                onSetCookMedium={setLineCookMedium}
                allowJainModifier={allowJainModifier}
              />
            ))}
          </Section>
        )}

        {uttapams.length > 0 && (
          <Section title="Uttapam" subtitle="Thick rice-and-lentil pancakes">
            {uttapams.map((m) => (
              <FixedItemRow
                key={m.id}
                item={m}
                line={lines.find((l) => l.itemId === m.id)}
                onAdd={() => addOne(m)}
                onBump={bumpLine}
                onToggleFlag={toggleFlag}
                onSetCrispiness={setLineCrispiness}
                onSetCookMedium={setLineCookMedium}
                allowJainModifier={allowJainModifier}
              />
            ))}
          </Section>
        )}

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
  onSetCrispiness,
  onSetCookMedium,
  allowJainModifier = true,
}: {
  item: MenuItem;
  line?: Line;
  onAdd: () => void;
  onBump: (lineId: string, delta: number) => void;
  onToggleFlag: (lineId: string, key: "noOnionGarlic" | "masalaOnSide") => void;
  onSetCrispiness: (lineId: string, value: "crispy" | "soft") => void;
  onSetCookMedium: (lineId: string, value: "ghee" | "oil") => void;
  allowJainModifier?: boolean;
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
      {line && line.qty > 0 && (
        <>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <PillToggle
              label="✨ Crispy"
              active={line.crispiness === "crispy"}
              onClick={() => onSetCrispiness(line.lineId, "crispy")}
            />
            <PillToggle
              label="☁️ Soft"
              active={line.crispiness === "soft"}
              onClick={() => onSetCrispiness(line.lineId, "soft")}
            />
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <PillToggle
              label="🧈 Amul Ghee"
              active={line.cookMedium === "ghee"}
              onClick={() => onSetCookMedium(line.lineId, "ghee")}
            />
            <PillToggle
              label="🛢️ Oil"
              active={line.cookMedium === "oil"}
              onClick={() => onSetCookMedium(line.lineId, "oil")}
            />
          </div>
        </>
      )}
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
      {line && line.qty > 0 && item.hasMasalaFilling && allowJainModifier && (
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
  onSetCrispiness,
  onSetCookMedium,
}: {
  base: MenuItem;
  lines: Line[];
  onAdd: () => void;
  onBump: (lineId: string, delta: number) => void;
  onDelete: (lineId: string) => void;
  onToggleAddon: (lineId: string, addonId: string) => void;
  onToggleFlag: (lineId: string, key: "noOnionGarlic" | "masalaOnSide") => void;
  onSetCrispiness: (lineId: string, value: "crispy" | "soft") => void;
  onSetCookMedium: (lineId: string, value: "ghee" | "oil") => void;
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

              <div className="mt-2 grid grid-cols-2 gap-1.5">
                <PillToggle
                  label="✨ Crispy"
                  active={line.crispiness === "crispy"}
                  onClick={() => onSetCrispiness(line.lineId, "crispy")}
                />
                <PillToggle
                  label="☁️ Soft"
                  active={line.crispiness === "soft"}
                  onClick={() => onSetCrispiness(line.lineId, "soft")}
                />
              </div>
              <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                <PillToggle
                  label="🧈 Ghee"
                  active={line.cookMedium === "ghee"}
                  onClick={() => onSetCookMedium(line.lineId, "ghee")}
                />
                <PillToggle
                  label="🛢️ Oil"
                  active={line.cookMedium === "oil"}
                  onClick={() => onSetCookMedium(line.lineId, "oil")}
                />
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
  partySize,
  tableId,
  onEdit,
  onConfirm,
  submitting,
}: {
  lines: Line[];
  customerName: string;
  notes: string;
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
          </div>

          <ul className="divide-y divide-stone-200">
            {lines.map((l) => {
              const m = MENU.find((x) => x.id === l.itemId)!;
              return (
                <li key={l.lineId} className="py-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium">
                      {l.qty} × {m.name}{" "}
                      <span className="text-xs text-stone-500 ml-1">
                        {l.crispiness === "crispy" ? "✨ crispy" : "☁️ soft"}{" "}
                        · {l.cookMedium === "ghee" ? "🧈 ghee" : "🛢️ oil"}
                      </span>
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
