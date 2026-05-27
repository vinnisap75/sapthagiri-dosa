"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { TABLES } from "@/lib/tables";
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

  useEffect(() => {
    setOrigin(window.location.origin);
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

        <a
          href="/order?table=A1"
          className="card p-6 hover:shadow-md transition block"
        >
          <div className="text-3xl mb-2">📱</div>
          <h2 className="text-lg font-semibold">Customer Preview</h2>
          <p className="text-sm text-stone-600 mt-1">
            See what a customer sees when they scan table A1's QR.
          </p>
          <p className="text-xs mt-3 text-sapthagiri-burgundy font-semibold">
            Open as customer →
          </p>
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
