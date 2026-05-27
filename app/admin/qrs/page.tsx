"use client";

import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { TABLES } from "@/lib/tables";
import { AuthGuard } from "../../_components/AuthGuard";

/** A stable public URL is *strongly* recommended so QR codes don't change
 *  every time you re-print the sheet. Set NEXT_PUBLIC_PUBLIC_URL in
 *  .env.local (and on Vercel) to your final hosted URL, e.g.
 *  https://sapthagiri-dosa.vercel.app — then it doesn't matter whether you
 *  open this page on localhost or production, the QR codes encode the same
 *  hosted URL and never need to be re-printed. */
const STABLE_PUBLIC_URL = process.env.NEXT_PUBLIC_PUBLIC_URL;

export default function QrSheetPage() {
  return (
    <AuthGuard>
      <QrSheet />
    </AuthGuard>
  );
}

function QrSheet() {
  const [origin, setOrigin] = useState<string>("");
  useEffect(
    () => setOrigin(STABLE_PUBLIC_URL || window.location.origin),
    []
  );

  return (
    <main className="min-h-screen p-6 print:p-2">
      <div className="no-print max-w-5xl mx-auto mb-6 flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-display text-sapthagiri-burgundy">
            Table QR Codes
          </h1>
          <p className="text-sm text-stone-600">
            One QR per table. Print this page, cut along the boxes, tape to the
            tables.
          </p>
          {origin && (
            <p className="text-xs text-stone-500 mt-1">
              QRs encode <code className="bg-stone-100 px-1">{origin}/order?table=…</code>
              {STABLE_PUBLIC_URL ? (
                <span className="ml-2 inline-block bg-green-100 text-green-800 px-2 py-0.5 rounded">
                  ✓ stable hosted URL
                </span>
              ) : (
                <span className="ml-2 inline-block bg-amber-100 text-amber-900 px-2 py-0.5 rounded">
                  ⚠️ using current host — set NEXT_PUBLIC_PUBLIC_URL to make permanent
                </span>
              )}
            </p>
          )}
        </div>
        <button onClick={() => window.print()} className="btn-primary">
          🖨️ Print
        </button>
      </div>

      <div className="max-w-5xl mx-auto grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 print:grid-cols-4">
        {TABLES.map((t) => {
          const url = `${origin}/order?table=${encodeURIComponent(t.id)}`;
          return (
            <div
              key={t.id}
              className="bg-white border-2 border-stone-300 rounded-xl p-4 flex flex-col items-center text-center break-inside-avoid print:border-stone-400"
            >
              <div className="text-xs uppercase tracking-widest text-sapthagiri-gold">
                Sapthagiri
              </div>
              <div className="text-3xl font-display font-bold text-sapthagiri-burgundy">
                {t.id}
              </div>
              <div className="text-[10px] text-stone-500 mb-2">
                Scan to order · {t.seats} seats
              </div>
              {origin ? (
                <QRCodeSVG value={url} size={160} includeMargin={false} />
              ) : (
                <div className="w-[160px] h-[160px] bg-stone-100 animate-pulse rounded" />
              )}
            </div>
          );
        })}
      </div>
    </main>
  );
}
