"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { AuthGuard, SignOutButton } from "../../_components/AuthGuard";
import { BrandLogo } from "../../_components/BrandLogo";

export default function SlackAdminPage() {
  return (
    <AuthGuard>
      <SlackAdmin />
    </AuthGuard>
  );
}

function SlackAdmin() {
  const [currentUrl, setCurrentUrl] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const sb = supabase();
        const { data, error } = await sb
          .from("agent_config")
          .select("value")
          .eq("key", "slack_webhook_url")
          .maybeSingle();
        if (cancelled) return;
        if (error) throw error;
        const v = (data?.value as string | null) ?? null;
        setCurrentUrl(v);
        setDraft(v ?? "");
      } catch (e) {
        setResult({
          ok: false,
          message:
            e instanceof Error
              ? `${e.message} — is migration 002_slack_fanout.sql applied?`
              : "Couldn't load the saved webhook URL.",
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function save() {
    setSaving(true);
    setResult(null);
    try {
      const sb = supabase();
      const trimmed = draft.trim();
      if (trimmed && !trimmed.startsWith("https://hooks.slack.com/")) {
        setResult({
          ok: false,
          message:
            "That doesn't look like a Slack incoming-webhook URL. Should start with https://hooks.slack.com/services/...",
        });
        return;
      }
      const { error } = await sb.rpc("set_agent_config", {
        p_key: "slack_webhook_url",
        p_value: trimmed || null,
      });
      if (error) throw error;
      setCurrentUrl(trimmed || null);
      setResult({
        ok: true,
        message: trimmed
          ? "Saved. Every new agent_log row will now fan out to that channel."
          : "Cleared. Slack fan-out is now disabled.",
      });
    } catch (e) {
      setResult({
        ok: false,
        message: e instanceof Error ? e.message : "Save failed.",
      });
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true);
    setResult(null);
    try {
      const sb = supabase();
      const { data, error } = await sb.rpc("slack_test");
      if (error) throw error;
      setResult({ ok: true, message: String(data) });
    } catch (e) {
      setResult({
        ok: false,
        message: e instanceof Error ? e.message : "Test failed.",
      });
    } finally {
      setTesting(false);
    }
  }

  const maskedCurrent = currentUrl
    ? currentUrl.slice(0, 32) + "…" + currentUrl.slice(-6)
    : null;

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
              <h1 className="text-lg font-display leading-none">Slack fan-out</h1>
            </div>
          </div>
          <div className="flex items-center gap-4 text-xs">
            <Link
              href="/admin/agent-log"
              className="uppercase tracking-wider text-sapthagiri-gold hover:text-white"
            >
              ← Agent Log
            </Link>
            <SignOutButton className="uppercase tracking-wider text-sapthagiri-gold hover:text-white" />
          </div>
        </div>
      </header>

      <section className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        <div className="card p-5 bg-sapthagiri-cream border-sapthagiri-gold/50">
          <p className="text-sm text-stone-800 leading-relaxed">
            Every agent message lands in the channel you point this at —
            <code> #sapthagiri-floor </code> recommended. The fan-out is a
            Postgres trigger that fires on every <code>agent_log</code>
            insert, so it works whether the message was written from the
            app, a cron, or any agent run.
          </p>
        </div>

        {/* Step-by-step setup */}
        <div className="card p-6 space-y-3">
          <h2 className="font-display text-lg text-sapthagiri-burgundy">
            One-time setup
          </h2>
          <ol className="text-sm text-stone-700 space-y-2 list-decimal list-inside">
            <li>
              Create (or pick) a Slack workspace + a channel called{" "}
              <code>#sapthagiri-floor</code>.
            </li>
            <li>
              In Slack go to{" "}
              <a
                href="https://api.slack.com/apps?new_app=1"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sapthagiri-burgundy underline"
              >
                api.slack.com/apps
              </a>{" "}
              → <strong>Create New App</strong> → <em>From scratch</em>.
            </li>
            <li>
              Open <strong>Incoming Webhooks</strong>, toggle it on, click
              <strong> Add New Webhook to Workspace</strong>, pick{" "}
              <code>#sapthagiri-floor</code>.
            </li>
            <li>
              Copy the URL (looks like{" "}
              <code>https://hooks.slack.com/services/T…/B…/…</code>) and
              paste it below.
            </li>
            <li>Save, then click Test — you should see a message land.</li>
          </ol>
        </div>

        {/* Webhook form */}
        <div className="card p-6 space-y-4">
          <label className="block text-sm">
            <div className="font-semibold mb-1">
              Incoming-webhook URL{" "}
              {currentUrl && (
                <span className="text-xs text-green-700 font-normal ml-2">
                  · current: {maskedCurrent}
                </span>
              )}
            </div>
            <input
              type="url"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="https://hooks.slack.com/services/T…/B…/…"
              disabled={loading}
              className="w-full border rounded-lg px-3 py-2 font-mono text-sm"
            />
          </label>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={save}
              disabled={saving || loading}
              className="btn-primary"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              onClick={test}
              disabled={testing || !currentUrl}
              className="rounded-lg border border-sapthagiri-burgundy text-sapthagiri-burgundy px-4 py-2 font-medium hover:bg-sapthagiri-cream disabled:opacity-50"
            >
              {testing ? "Sending…" : "💬 Send test message"}
            </button>
          </div>

          {result && (
            <div
              className={`rounded-lg p-3 text-sm ${
                result.ok
                  ? "bg-green-50 border border-green-200 text-green-800"
                  : "bg-red-50 border border-red-200 text-red-800"
              }`}
            >
              {result.message}
            </div>
          )}
        </div>

        <details className="card p-5 text-sm">
          <summary className="cursor-pointer font-semibold">
            How the fan-out works
          </summary>
          <div className="mt-3 text-stone-700 space-y-2">
            <p>
              On every <code>INSERT</code> into <code>agent_log</code>, the
              Postgres trigger <code>trg_agent_log_slack</code> reads the
              webhook URL from <code>agent_config</code> and asynchronously
              POSTs the message to Slack via <code>pg_net.http_post</code>.
              The trigger swallows its own errors so a bad webhook never
              breaks the underlying agent run.
            </p>
            <p>
              Message format includes agent emoji, phase color stripe, the
              message text, and the payload as a code block when present.
              See <code>supabase/migrations/002_slack_fanout.sql</code> for
              the exact rendering.
            </p>
            <p>
              To disable Slack temporarily: clear the input above and
              Save. The trigger no-ops when the URL is empty.
            </p>
          </div>
        </details>
      </section>
    </main>
  );
}
