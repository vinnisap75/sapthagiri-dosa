"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { BrandLogo } from "@/app/_components/BrandLogo";

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const sb = supabase();
      const { error: authErr } = await sb.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (authErr) {
        setError(authErr.message);
        setSubmitting(false);
        return;
      }
      router.push(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Login failed.");
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <form onSubmit={submit} className="card p-6 w-full max-w-sm space-y-4">
        <div className="text-center">
          <div className="mx-auto mb-4 flex justify-center rounded-xl bg-sapthagiri-burgundy px-5 py-4">
            <BrandLogo variant="full" className="h-12 w-auto" priority />
          </div>
          <h1 className="text-2xl font-display text-sapthagiri-burgundy">
            Staff sign in
          </h1>
          <p className="text-xs text-stone-500 mt-1">
            Required to view the dashboard, kitchen, and admin pages.
          </p>
        </div>
        <input
          type="email"
          className="w-full border rounded-lg px-3 py-2 text-sm"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoFocus
        />
        <input
          type="password"
          className="w-full border rounded-lg px-3 py-2 text-sm"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-2 text-xs">
            {error}
          </div>
        )}
        <button
          type="submit"
          className="btn-primary w-full"
          disabled={submitting}
        >
          {submitting ? "Signing in…" : "Sign in"}
        </button>
        <p className="text-[10px] text-center text-stone-400">
          Customer pages (QR scan → order) don't need a login.
        </p>
      </form>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="p-8 text-center">Loading…</main>}>
      <LoginInner />
    </Suspense>
  );
}
