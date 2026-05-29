"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { TABLES } from "@/lib/tables";
import {
  SERVICES,
  ServiceWindow,
  formatServiceHours,
  serviceDayName,
} from "@/lib/services";
import { AuthGuard, SignOutButton } from "../../_components/AuthGuard";

export default function CustomerPreviewPage() {
  return (
    <AuthGuard>
      <CustomerPreviewInner />
    </AuthGuard>
  );
}

function CustomerPreviewInner() {
  // Default to Saturday so the most "different" view (limited menu, no
  // Rava Dosa) loads first — Sree's most common reason for opening this.
  const [serviceId, setServiceId] = useState<ServiceWindow["id"]>("saturday");
  const [tableId, setTableId] = useState<string>(TABLES[0]?.id ?? "A1");
  const [showStatus, setShowStatus] = useState(false);
  // Test Mode — when ON, orders submitted from this iframe are flagged
  // is_test=true so they don't show up in the kitchen Active tab by
  // default and never count toward Wednesday analytics.
  const [testMode, setTestMode] = useState(true);

  const service = useMemo(
    () => SERVICES.find((s) => s.id === serviceId)!,
    [serviceId]
  );

  // The order page accepts ?service= to force a specific window — this
  // bypasses the "are we open right now?" gate so we can preview Sat/Sun
  // on a Thursday afternoon. ?test=1 marks any submitted order is_test.
  const previewUrl = `/order?table=${encodeURIComponent(
    tableId
  )}&service=${serviceId}&preview=1${testMode ? "&test=1" : ""}`;

  return (
    <main className="min-h-screen bg-stone-50">
      <header className="bg-sapthagiri-burgundy text-white">
        <div className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <span className="text-2xl">👀</span>
            <div>
              <div className="text-xs uppercase tracking-[0.25em] text-sapthagiri-gold">
                Sapthagiri · Admin
              </div>
              <h1 className="text-lg font-display">Customer Preview</h1>
            </div>
          </div>
          <div className="flex items-center gap-4 text-xs">
            <Link
              href="/"
              className="uppercase tracking-wider text-sapthagiri-gold hover:text-white"
            >
              ← Home
            </Link>
            <SignOutButton className="uppercase tracking-wider text-sapthagiri-gold hover:text-white" />
          </div>
        </div>
      </header>

      <section className="max-w-6xl mx-auto px-6 py-6 space-y-4">
        {/* Pickers */}
        <div className="card p-4 flex flex-col md:flex-row gap-4 md:items-end">
          <div className="flex-1">
            <div className="text-xs uppercase tracking-wider text-stone-500 mb-1.5">
              Service window
            </div>
            <div className="flex flex-wrap gap-2">
              {SERVICES.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setServiceId(s.id)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium border transition ${
                    serviceId === s.id
                      ? "bg-sapthagiri-burgundy text-white border-sapthagiri-burgundy"
                      : "bg-white text-stone-700 border-stone-300 hover:border-stone-500"
                  }`}
                >
                  {serviceDayName(s)} · {s.name}
                </button>
              ))}
            </div>
            <div className="text-xs text-stone-500 mt-1.5 tabular-nums">
              {formatServiceHours(service)} ·{" "}
              {service.menu === "limited" ? "Limited menu (4 dosas)" : "Full menu"}
              {service.showRavaDosaButton && " · Rava Dosa CTA"}
            </div>
          </div>

          <div className="md:w-48">
            <div className="text-xs uppercase tracking-wider text-stone-500 mb-1.5">
              Table
            </div>
            <select
              value={tableId}
              onChange={(e) => setTableId(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            >
              {TABLES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.id} · {t.seats} seats
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="text-xs uppercase tracking-wider text-stone-500 mb-1.5">
              Test Mode
            </div>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={testMode}
                onChange={(e) => setTestMode(e.target.checked)}
                className="w-5 h-5 accent-sapthagiri-burgundy"
              />
              <span className="text-sm">
                {testMode ? (
                  <span className="font-semibold text-yellow-700">
                    🧪 ON — orders won't pollute stats
                  </span>
                ) : (
                  <span className="text-stone-600">
                    OFF — orders are real
                  </span>
                )}
              </span>
            </label>
          </div>

          <div>
            <a
              href={previewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block px-4 py-2 rounded-lg text-sm font-medium border border-stone-300 bg-white text-stone-700 hover:border-stone-500"
            >
              Open in new tab ↗
            </a>
          </div>
        </div>

        {/* Helper note */}
        <div className="card p-3 text-xs text-stone-600 bg-sapthagiri-cream border-sapthagiri-gold/40">
          You're seeing exactly what a customer scanning the QR for{" "}
          <strong>Table {tableId}</strong> on{" "}
          <strong>{serviceDayName(service)}</strong> would see. The{" "}
          <code>?service={serviceId}&preview=1</code> URL params force the
          service window so you can preview Sat / Sun mid-week without
          waiting. Try ordering — orders submitted here DO land in the live
          kitchen board, so use table <code>TEST</code> if you want to play
          without polluting tonight's stats.
        </div>

        {/* Iframe */}
        <div className="card overflow-hidden">
          <iframe
            key={previewUrl}
            src={previewUrl}
            className="w-full h-[80vh] bg-white"
            // sandbox isn't applied — same origin, full functionality needed
            // so the customer flow (submit, redirect to /status) works inside
            // the preview.
            title="Customer view preview"
          />
        </div>

        {/* Per-service quick-reference */}
        <div className="grid md:grid-cols-3 gap-3">
          {SERVICES.map((s) => (
            <button
              key={s.id}
              onClick={() => setServiceId(s.id)}
              className={`card p-4 text-left transition ${
                serviceId === s.id
                  ? "ring-2 ring-sapthagiri-burgundy"
                  : "hover:shadow-md"
              }`}
            >
              <div className="text-xs uppercase tracking-wider text-stone-500">
                {serviceDayName(s)}
              </div>
              <div className="font-display text-base text-sapthagiri-burgundy mt-0.5">
                {s.name}
              </div>
              <div className="text-xs text-stone-600 mt-1 tabular-nums">
                {formatServiceHours(s)}
              </div>
              <div className="text-xs text-stone-500 mt-1">
                {s.menu === "limited"
                  ? "4-dosa breakfast menu"
                  : "Full menu (all dosas + uttapams + Build Your Own)"}
                {s.showRavaDosaButton && " · 🌾 Rava Dosa CTA"}
              </div>
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}
