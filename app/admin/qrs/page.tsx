"use client";

import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { TABLES } from "@/lib/tables";

export default function QrSheet() {
  const [origin, setOrigin] = useState<string>("");
  useEffect(() => setOrigin(window.location.origin), []);

  return (
    <main className="min-h-screen p-6 print:p-2">
      <div className="no-print max-w-5xl mx-auto mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display text-sapthagiri-burgundy">
            Table QR Codes
          </h1>
          <p className="text-sm text-stone-600">
            One QR per table. Print this page, cut along the boxes, tape to the
            tables. Each code points to{" "}
            <code className="bg-stone-100 px-1">/order?table=…</code>.
          </p>
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
                <QRCodeSVG value={url} size={140} includeMargin={false} />
              ) : (
                <div className="w-[140px] h-[140px] bg-stone-100 animate-pulse rounded" />
              )}
              <div className="text-[9px] text-stone-400 mt-2 break-all">
                {url}
              </div>
            </div>
          );
        })}
      </div>
    </main>
  );
}
