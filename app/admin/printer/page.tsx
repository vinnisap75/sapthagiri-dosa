"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  PrinterConfig,
  loadPrinterConfig,
  savePrinterConfig,
  clearPrinterConfig,
  printTest,
  printTicketWith,
} from "@/lib/printer";
import { previewTicket, sampleTicket } from "@/lib/ticket";
import { AuthGuard, SignOutButton } from "../../_components/AuthGuard";
import { BrandLogo } from "../../_components/BrandLogo";

export default function PrinterAdminPage() {
  return (
    <AuthGuard>
      <PrinterAdmin />
    </AuthGuard>
  );
}

function PrinterAdmin() {
  // Hydration-safe: don't read localStorage during SSR.
  const [cfg, setCfg] = useState<PrinterConfig | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // Form state — mirrors the persisted config.
  const [brand, setBrand] = useState<"star" | "epson">("star");
  const [host, setHost] = useState("");
  const [port, setPort] = useState<string>("9100");
  const [bridgeUrl, setBridgeUrl] = useState<string>("");
  const [label, setLabel] = useState<string>("Kitchen printer");
  const [autoPrint, setAutoPrint] = useState<boolean>(false);
  const [autoPrintScope, setAutoPrintScope] =
    useState<"all" | "sat-sun-only" | "wed-only">("all");
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    message: string;
    ms?: number;
  } | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    const saved = loadPrinterConfig();
    if (saved) {
      setCfg(saved);
      setBrand(saved.brand);
      setHost(saved.host);
      setPort(String(saved.port ?? 9100));
      setBridgeUrl(saved.bridgeUrl ?? "");
      setLabel(saved.label ?? "Kitchen printer");
      setAutoPrint(saved.autoPrint ?? false);
      setAutoPrintScope(saved.autoPrintScope ?? "all");
    }
    setHydrated(true);
  }, []);

  function save() {
    if (!host.trim()) {
      setTestResult({ ok: false, message: "Host is required" });
      return;
    }
    const next: PrinterConfig = {
      brand,
      host: host.trim(),
      port: port ? parseInt(port, 10) : undefined,
      bridgeUrl: bridgeUrl.trim() || undefined,
      mode: brand === "epson" ? "escpos" : "starline",
      label: label.trim() || undefined,
      autoPrint,
      autoPrintScope,
    };
    savePrinterConfig(next);
    setCfg(next);
    setTestResult({ ok: true, message: "Saved." });
  }

  function unpair() {
    clearPrinterConfig();
    setCfg(null);
    setHost("");
    setTestResult({ ok: true, message: "Unpaired." });
  }

  async function runTest() {
    if (!cfg) {
      setTestResult({ ok: false, message: "Save first, then test." });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const r = await printTest(cfg);
      if (r.ok) {
        setTestResult({
          ok: true,
          message: `Sent in ${r.ms}ms. Receipt should print now.`,
          ms: r.ms,
        });
      } else {
        setTestResult({
          ok: false,
          message: r.error ?? "Print failed.",
          ms: r.ms,
        });
      }
    } finally {
      setTesting(false);
    }
  }

  /** Print the full sample order so staff see the real ticket layout. */
  async function runSample() {
    if (!cfg) {
      setTestResult({ ok: false, message: "Save first, then print." });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const r = await printTicketWith(cfg, sampleTicket());
      setTestResult(
        r.ok
          ? { ok: true, message: `Sample sent in ${r.ms}ms.`, ms: r.ms }
          : { ok: false, message: r.error ?? "Print failed.", ms: r.ms }
      );
    } finally {
      setTesting(false);
    }
  }

  // Live, paper-styled preview of the sample order — what the printer outputs.
  const preview = previewTicket(sampleTicket());

  return (
    <main className="min-h-screen bg-stone-50">
      <header className="bg-sapthagiri-burgundy text-white">
        <div className="max-w-3xl mx-auto px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BrandLogo variant="wordmark" className="h-7 w-auto shrink-0" priority />
            <div className="border-l border-sapthagiri-gold/40 pl-3">
              <div className="text-xs uppercase tracking-[0.25em] text-sapthagiri-gold">
                Admin
              </div>
              <h1 className="text-lg font-display leading-none">Kitchen Printer</h1>
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

      <section className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        {/* Explanation card */}
        <div className="card p-5 bg-sapthagiri-cream border-sapthagiri-gold/50">
          <p className="text-sm text-stone-800 leading-relaxed">
            Pair a Star (WebPRNT) or Epson (ePOS) thermal printer on the
            same WiFi as the kitchen tablet. After you save the IP, hit
            <strong> Test print </strong> to confirm a receipt comes out.
          </p>
          <ul className="mt-3 text-xs text-stone-700 list-disc list-inside space-y-1">
            <li>
              Sat / Sun breakfast: every incoming order will auto-print so
              Ravi has a paper queue beside the tawa.
            </li>
            <li>
              Wed dinner: Rava Dosa orders print when Cooking Mode = Vinni
              (tablet at the front); otherwise they show on screen.
            </li>
          </ul>
        </div>

        {/* Form */}
        <div className="card p-6 space-y-4">
          <h2 className="font-display text-lg text-sapthagiri-burgundy">
            Printer configuration
          </h2>

          <div className="grid gap-3">
            <label className="text-sm">
              <div className="font-semibold mb-1">Brand</div>
              <div className="flex gap-2">
                {(["star", "epson"] as const).map((b) => (
                  <button
                    key={b}
                    onClick={() => setBrand(b)}
                    type="button"
                    className={`px-4 py-2 rounded-lg text-sm font-medium border transition ${
                      brand === b
                        ? "bg-sapthagiri-burgundy text-white border-sapthagiri-burgundy"
                        : "bg-white text-stone-700 border-stone-300 hover:border-stone-500"
                    }`}
                  >
                    {b === "star" ? "Star (WebPRNT)" : "Epson (ePOS)"}
                  </button>
                ))}
              </div>
            </label>

            <label className="text-sm">
              <div className="font-semibold mb-1">Host (LAN IP)</div>
              <input
                type="text"
                inputMode="numeric"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="192.168.1.42"
                className="w-full border rounded-lg px-3 py-2"
              />
              <p className="text-xs text-stone-500 mt-1">
                On the printer's self-test page or in your router's DHCP
                list. No <code>http://</code>, no trailing slash.
              </p>
            </label>

            <label className="text-sm">
              <div className="font-semibold mb-1">
                Port{" "}
                <span className="text-stone-400">(raw print, default 9100)</span>
              </div>
              <input
                type="text"
                inputMode="numeric"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                className="w-full border rounded-lg px-3 py-2"
              />
            </label>

            <label className="text-sm">
              <div className="font-semibold mb-1">Print bridge URL</div>
              <input
                type="text"
                value={bridgeUrl}
                onChange={(e) => setBridgeUrl(e.target.value)}
                placeholder="http://localhost:4000"
                className="w-full border rounded-lg px-3 py-2"
              />
              <p className="text-xs text-stone-500 mt-1">
                The little relay that talks to the printer on port 9100 (browsers
                can't open raw sockets). Run <code>npm run bridge</code> and paste
                its address. <strong>Best:</strong> run it on this same machine and
                use <code>http://localhost:4000</code> — browsers exempt localhost
                from the https→http block, so it just works in production.
              </p>
            </label>

            <label className="text-sm">
              <div className="font-semibold mb-1">Label (optional)</div>
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Kitchen printer"
                className="w-full border rounded-lg px-3 py-2"
              />
            </label>

            {/* Auto-print toggle + service scope. */}
            <div className="border-t border-stone-200 pt-3 mt-1">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={autoPrint}
                  onChange={(e) => setAutoPrint(e.target.checked)}
                  className="w-5 h-5 accent-sapthagiri-burgundy"
                />
                <span className="text-sm">
                  <strong>Auto-print incoming orders.</strong> Every new
                  order on the kitchen board fires a ticket.
                </span>
              </label>
              {autoPrint && (
                <div className="mt-2 ml-7">
                  <div className="text-xs uppercase tracking-wider text-stone-500 mb-1">
                    Auto-print for
                  </div>
                  <select
                    value={autoPrintScope}
                    onChange={(e) =>
                      setAutoPrintScope(e.target.value as typeof autoPrintScope)
                    }
                    className="text-sm border rounded-lg px-3 py-2 w-full max-w-xs"
                  >
                    <option value="all">All services (Wed + Sat + Sun)</option>
                    <option value="sat-sun-only">
                      Sat &amp; Sun breakfast only
                    </option>
                    <option value="wed-only">Wednesday dinner only</option>
                  </select>
                  <p className="text-xs text-stone-500 mt-1">
                    Test orders (
                    <code>is_test=true</code>) always print so you can dry-run.
                  </p>
                </div>
              )}
            </div>

            {/* Mixed-content warning. */}
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900 leading-relaxed">
              <strong>⚠ Mixed-content gotcha:</strong> the deployed app runs over{" "}
              <code>https://</code> but the print bridge is <code>http://</code>,
              and Chrome blocks that across origins. <strong>Easiest fix:</strong>{" "}
              run the bridge on the <em>same</em> machine as the kitchen browser and
              point this at <code>http://localhost:4000</code> — localhost is exempt
              from the block, so no cert or flags needed. If the bridge is on a{" "}
              <em>different</em> LAN box, either allow "Insecure content" for this
              site (lock icon → Site settings) or give the bridge a cert.
            </div>
          </div>

          <div className="flex flex-wrap gap-2 pt-2">
            <button onClick={save} className="btn-primary">
              Save
            </button>
            <button
              onClick={runTest}
              disabled={!cfg || testing}
              className="rounded-lg border border-sapthagiri-burgundy text-sapthagiri-burgundy px-4 py-2 font-medium hover:bg-sapthagiri-cream disabled:opacity-50"
            >
              {testing ? "Sending…" : "🧾 Test print"}
            </button>
            <button
              onClick={runSample}
              disabled={!cfg || testing}
              className="rounded-lg border border-stone-300 text-stone-700 px-4 py-2 font-medium hover:bg-stone-100 disabled:opacity-50"
            >
              {testing ? "Sending…" : "🍽 Print sample order"}
            </button>
            {cfg && (
              <button
                onClick={unpair}
                className="rounded-lg border border-stone-300 text-stone-600 px-4 py-2 font-medium hover:bg-stone-100"
              >
                Unpair
              </button>
            )}
          </div>

          {testResult && (
            <div
              className={`rounded-lg p-3 text-sm ${
                testResult.ok
                  ? "bg-green-50 border border-green-200 text-green-800"
                  : "bg-red-50 border border-red-200 text-red-800"
              }`}
            >
              {testResult.message}
            </div>
          )}
        </div>

        {/* Live receipt preview — what the printer outputs for an order. */}
        <div className="card p-6">
          <h2 className="font-display text-lg text-sapthagiri-burgundy mb-1">
            Receipt preview
          </h2>
          <p className="text-xs text-stone-500 mb-4">
            Exactly how a ticket prints — 32-column layout, same as{" "}
            <code>lib/ticket.ts</code>. Non-ASCII characters (—, ·) are converted
            to <code>-</code> so they don't garble on the printer.
          </p>
          <div className="flex justify-center">
            <div
              className="bg-white shadow-lg border border-stone-200 px-4 py-5 w-[400px] max-w-full font-mono text-[19px] font-semibold leading-snug text-stone-900"
              style={{ whiteSpace: "pre" }}
            >
              {preview.map((l, i) => (
                <div
                  key={i}
                  className={[
                    l.center ? "text-center" : "",
                    l.bold ? "font-bold" : "",
                    // Double-height body lines: taller glyphs, same width.
                    l.tall ? "text-[28px] leading-[1.15] scale-y-110 origin-left" : "",
                    l.big ? "text-5xl font-extrabold tracking-wider py-1" : "",
                  ].join(" ")}
                >
                  {l.text || " "}
                </div>
              ))}
              <div className="text-center text-stone-300 mt-3 text-xs">
                ✂ - - - - - - - - - - - - - -
              </div>
            </div>
          </div>
        </div>

        {/* Current pairing */}
        {hydrated && (
          <div className="card p-5 text-sm">
            <h3 className="font-semibold mb-1">Current pairing</h3>
            {cfg ? (
              <ul className="text-stone-700">
                <li>
                  <strong>Brand:</strong> {cfg.brand}
                </li>
                <li>
                  <strong>Host:</strong> {cfg.host}
                  {cfg.port ? `:${cfg.port}` : ""}
                </li>
                {cfg.label && (
                  <li>
                    <strong>Label:</strong> {cfg.label}
                  </li>
                )}
              </ul>
            ) : (
              <p className="text-stone-500">
                No printer paired yet. Save the form above to pair.
              </p>
            )}
          </div>
        )}

        {/* Troubleshooting */}
        <details className="card p-5 text-sm">
          <summary className="cursor-pointer font-semibold">
            Troubleshooting
          </summary>
          <ul className="mt-3 text-stone-700 list-disc list-inside space-y-1.5">
            <li>
              Connection refused → printer not on the same WiFi, wrong IP,
              or the WebPRNT/ePOS service is disabled in the printer
              admin page.
            </li>
            <li>
              CORS error → some browsers block <code>http://</code> from
              an <code>https://</code> page. Open this admin page over
              <code> http://</code> on the kitchen tablet, OR add the
              printer IP to your local hostname (then use HTTPS via
              mDNS / mkcert).
            </li>
            <li>
              Print is gibberish → wrong brand selected. Toggle Star ↔
              Epson and re-save.
            </li>
            <li>
              Print is truncated → printer paper too narrow for our 32-col
              template; we can switch to 48-col by editing
              <code> lib/printer.ts</code>.
            </li>
          </ul>
        </details>
      </section>
    </main>
  );
}
