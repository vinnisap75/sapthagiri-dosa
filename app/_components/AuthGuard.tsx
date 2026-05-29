"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase";
import type { Session } from "@supabase/supabase-js";

/** Wrap protected pages (landing, kitchen, admin). Redirects to /login if
 *  no Supabase session exists. Customer pages (/order, /status) DON'T use
 *  this — they're QR-public on purpose. */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState<"loading" | "in" | "out">("loading");

  useEffect(() => {
    let cancelled = false;
    const sb = supabase();

    sb.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (data.session) setState("in");
      else {
        setState("out");
        router.replace(`/login?next=${encodeURIComponent(pathname || "/")}`);
      }
    });

    const { data: sub } = sb.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      if (session) setState("in");
      else {
        setState("out");
        router.replace(`/login?next=${encodeURIComponent(pathname || "/")}`);
      }
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [router, pathname]);

  if (state === "loading") {
    return (
      <main className="min-h-screen flex items-center justify-center text-stone-500">
        Checking session…
      </main>
    );
  }
  if (state === "out") {
    return null;
  }
  return <>{children}</>;
}

/** Optional sign-out button to drop into headers on protected pages. */
export function SignOutButton({ className }: { className?: string }) {
  const [busy, setBusy] = useState(false);
  async function signOut() {
    setBusy(true);
    try {
      await supabase().auth.signOut();
      // onAuthStateChange in AuthGuard will redirect.
    } finally {
      setBusy(false);
    }
  }
  return (
    <button onClick={signOut} disabled={busy} className={className}>
      {busy ? "…" : "Sign out"}
    </button>
  );
}
