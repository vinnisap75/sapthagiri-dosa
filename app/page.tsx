"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { TABLES } from "@/lib/tables";
import {
  getActiveService,
  getNextService,
  formatServiceHours,
  serviceDayName,
} from "@/lib/services";
import { AuthGuard, SignOutButton } from "./_components/AuthGuard";

export default function LandingPage() {
  return (
    <AuthGuard>
      <Landing />
    </AuthGuard>
  );
}

function Landing() {
  const [origin, setOrigin] = useState<string>("");
  // Hydration-safe: compute service status on the client only. SSR renders a
  // blank slot, the client fills it in on mount.
  const [service, setService] = useState<{
    active: ReturnType<typeof getActiveService>;
    next: ReturnType<typeof getNextService>;
  } | null>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
    const tick = () => setService({ active: getActiveService(), next: getNextService() });
    tick();
    // Refresh every minute so the banner flips at the service boundary even
    // if the operator leaves this page open.
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  return (
    <main className="min-h-screen">
      <header className="bg-sapthagiri-burgundy text-white">
        <div className="max-w-5xl mx-auto px-6 py-8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-3xl">🪔</span>
            <div>
              <h1 className="text-2xl font-display tracking-wide">Sapthagiri</h1>
              <p className="text-xs uppercase tracking-[0.2em] text-sapthagiri-gold">
                Dosa Ordering Console
              </p>
            </div>
          </div>
          <SignOutButton className="text-xs uppercase tracking-wider text-sapthagiri-gold hover:text-white" />
        </div>
      </header>

      {/* Service status banner — flips between OPEN NOW / Closed + next service. */}
      <section className="max-w-5xl mx-auto px-6 pt-6">
        {service ? (
          service.active ? (
            <div className="rounded-xl border-2 border-green-600/40 bg-green-50 px-4 py-3 flex items-center gap-3">
              <span className="text-xl" aria-hidden>🟢</span>
              <div className="flex-1 min-w-0">
                <div className="text-[10px] uppercase tracking-[0.25em] text-green-800 font-semibold">
                  Open Now
                </div>
                <div className="text-sm font-semibold text-sapthagiri-burgundy">
                  {serviceDayName(service.active)} · {service.active.name}
                </div>
              </div>
              <div className="text-sm font-medium text-stone-700 tabular-nums whitespace-nowrap">
                {formatServiceHours(service.active)}
              </div>
            </div>
          ) : (
            <div className="rounded-xl border-2 border-sapthagiri-gold/50 bg-sapthagiri-cream px-4 py-3 flex items-center gap-3">
              <span className="text-xl" aria-hidden>🔴</span>
              <div className="flex-1 min-w-0">
                <div className="text-[10px] uppercase tracking-[0.25em] text-sapthagiri-burgundy font-semibold">
                  Closed
                </div>
                <div className="text-sm font-semibold text-sapthagiri-burgundy">
                  Next: {serviceDayName(service.next)} · {service.next.name}
                </div>
              </div>
              <div className="text-sm font-medium text-stone-700 tabular-nums whitespace-nowrap">
                {formatServiceHours(service.next)}
              </div>
            </div>
          )
        ) : (
          // SSR / pre-hydration placeholder keeps the layout from jumping.
          <div className="rounded-xl border-2 border-stone-200 bg-white px-4 py-3 h-[60px]" />
        )}
      </section>

      <section className="max-w-5xl mx-auto px-6 py-10 grid gap-6 md:grid-cols-3">
        <Link
          href="/kitchen"
          className="card p-6 hover:shadow-md transition block"
        >
          <div className="text-3xl mb-2">🍳</div>
          <h2 className="text-lg font-semibold">Kitchen / Dosa Master</h2>
          <p className="text-sm text-stone-600 mt-1">
            Live board of incoming orders. FIFO batch of 3.
          </p>
          <p className="text-xs mt-3 text-sapthagiri-burgundy font-semibold">
            Open on the kitchen tablet →
          </p>
        </Link>

        <Link
          href="/admin/qrs"
          className="card p-6 hover:shadow-md transition block"
        >
          <div className="text-3xl mb-2">🔳</div>
          <h2 className="text-lg font-semibold">Print Table QR Codes</h2>
          <p className="text-sm text-stone-600 mt-1">
            One QR per table — print, cut, tape to each table.
          </p>
          <p className="text-xs mt-3 text-sapthagiri-burgundy font-semibold">
            Open print sheet →
          </p>
        </Link>

        <Link
          href="/admin/stats"
          className="card p-6 hover:shadow-md transition block"
        >
          <div className="text-3xl mb-2">📊</div>
          <h2 className="text-lg font-semibold">Analytics</h2>
          <p className="text-sm text-stone-600 mt-1">
            Tonight's numbers: orders served, top dosas, ratings, busiest tables.
          </p>
          <p className="text-xs mt-3 text-sapthagiri-burgundy font-semibold">
            Open dashboard →
          </p>
        </Link>

        <Link
          href="/admin/printer"
          className="card p-6 hover:shadow-md transition block"
        >
          <div className="text-3xl mb-2">🧾</div>
          <h2 className="text-lg font-semibold">Kitchen Printer</h2>
          <p className="text-sm text-stone-600 mt-1">
            Pair the thermal printer + test print. Auto-prints Sat/Sun
            orders for Ravi.
          </p>
          <p className="text-xs mt-3 text-sapthagiri-burgundy font-semibold">
            Open printer settings →
          </p>
        </Link>

        <Link
          href="/admin/agent-log"
          className="card p-6 hover:shadow-md transition block"
        >
          <div className="text-3xl mb-2">📡</div>
          <h2 className="text-lg font-semibold">Agent Comms</h2>
          <p className="text-sm text-stone-600 mt-1">
            Live feed of what every agent is doing — starting, notes,
            blocked, finishing. Real-time via Supabase.
          </p>
          <p className="text-xs mt-3 text-sapthagiri-burgundy font-semibold">
            Watch the org work →
          </p>
        </Link>

        <Link
          href="/admin/slack"
          className="card p-6 hover:shadow-md transition block"
        >
          <div className="text-3xl mb-2">💬</div>
          <h2 className="text-lg font-semibold">Slack fan-out</h2>
          <p className="text-sm text-stone-600 mt-1">
            Point a Slack incoming-webhook here. Every agent message
            lands in #sapthagiri-floor automatically.
          </p>
          <p className="text-xs mt-3 text-sapthagiri-burgundy font-semibold">
            Configure webhook →
          </p>
        </Link>

        <Link
          href="/admin/preview"
          className="card p-6 hover:shadow-md transition block"
        >
          <div className="text-3xl mb-2">👀</div>
          <h2 className="text-lg font-semibold">Customer Preview</h2>
          <p className="text-sm text-stone-600 mt-1">
            See exactly what guests see when they scan the QR — pick any
            day (Wed / Sat / Sun) and any table.
          </p>
          <p className="text-xs mt-3 text-sapthagiri-burgundy font-semibold">
            Preview customer view →
          </p>
        </Link>
      </section>

      <section className="max-w-5xl mx-auto px-6 pb-4">
        <a
          href="/order?table=A1"
          className="text-xs text-stone-500 hover:text-sapthagiri-burgundy underline"
        >
          (preview as customer at table A1 →)
        </a>
      </section>

      <section className="max-w-5xl mx-auto px-6 py-6">
        <h3 className="text-sm uppercase tracking-wider text-stone-500 mb-3">
          Quick links per table
        </h3>
        <div className="flex flex-wrap gap-2">
          {TABLES.map((t) => (
            <a
              key={t.id}
              href={`/order?table=${encodeURIComponent(t.id)}`}
              className="rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm hover:bg-stone-50"
              title={`${t.seats} seats`}
            >
              {t.id}
            </a>
          ))}
        </div>
        {origin && (
          <p className="text-xs text-stone-500 mt-4">
            QR codes encode <code className="bg-stone-100 px-1">{origin}/order?table=…</code>
          </p>
        )}
      </section>
    </main>
  );
}
