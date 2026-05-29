"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { AuthGuard, SignOutButton } from "../../_components/AuthGuard";

interface AgentLogRow {
  id: string;
  agent: string;
  phase: "starting" | "note" | "blocked" | "finishing";
  task_id: string | null;
  message: string;
  payload: Record<string, unknown> | null;
  created_at: string;
}

export default function AgentLogPage() {
  return (
    <AuthGuard>
      <AgentLogInner />
    </AuthGuard>
  );
}

// All known agent slugs (from lib/agent-comms.ts) — each gets a color.
const AGENT_COLORS: Record<string, { bg: string; fg: string; emoji: string }> = {
  orchestrator:       { bg: "bg-sapthagiri-burgundy", fg: "text-white",        emoji: "🎯" },
  sentry:             { bg: "bg-red-700",             fg: "text-white",        emoji: "🛡" },
  custodian:          { bg: "bg-purple-700",          fg: "text-white",        emoji: "🧐" },
  hammer:             { bg: "bg-emerald-700",         fg: "text-white",        emoji: "🔨" },
  "service-architect":{ bg: "bg-blue-700",            fg: "text-white",        emoji: "🏗" },
  tava:               { bg: "bg-amber-700",           fg: "text-white",        emoji: "🍳" },
  patron:             { bg: "bg-pink-700",            fg: "text-white",        emoji: "🙇" },
  counter:            { bg: "bg-teal-700",            fg: "text-white",        emoji: "📊" },
  mirror:             { bg: "bg-indigo-700",          fg: "text-white",        emoji: "🪞" },
  // Fallback handled in renderer.
};

const PHASE_BADGE: Record<AgentLogRow["phase"], string> = {
  starting:  "bg-blue-100 text-blue-900 border border-blue-300",
  note:      "bg-amber-100 text-amber-900 border border-amber-300",
  blocked:   "bg-red-100 text-red-900 border border-red-300",
  finishing: "bg-green-100 text-green-900 border border-green-300",
};

function AgentLogInner() {
  const [rows, setRows] = useState<AgentLogRow[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<Date>(new Date());
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // Tick once a second so "12s ago" labels stay live.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Initial load + Realtime subscription.
  useEffect(() => {
    let cancelled = false;
    const sb = supabase();

    async function loadInitial() {
      try {
        const { data, error: qerr } = await sb
          .from("agent_log")
          .select("*")
          .order("created_at", { ascending: true })
          .limit(500);
        if (qerr) throw qerr;
        if (cancelled) return;
        setRows((data ?? []) as AgentLogRow[]);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load agent_log");
      }
    }

    loadInitial();

    const channel = sb
      .channel("agent-log-stream")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "agent_log" },
        (payload) => {
          const row = payload.new as AgentLogRow;
          setRows((prev) => {
            // Dedupe in case of double-delivery.
            if (prev.some((r) => r.id === row.id)) return prev;
            return [...prev, row];
          });
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      sb.removeChannel(channel);
    };
  }, []);

  // Auto-scroll to the latest row when one arrives, unless the user
  // turned auto-scroll off (they're probably reading older history).
  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [rows, autoScroll]);

  const agents = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) set.add(r.agent);
    return Array.from(set).sort();
  }, [rows]);

  const visible = useMemo(
    () => (filter === "all" ? rows : rows.filter((r) => r.agent === filter)),
    [rows, filter]
  );

  // Group by task_id so a run reads as a thread.
  const threads = useMemo(() => groupByTask(visible), [visible]);

  // Status counts for the strip header.
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rows) c[r.agent] = (c[r.agent] ?? 0) + 1;
    return c;
  }, [rows]);

  return (
    <main className="min-h-screen bg-stone-50">
      <header className="bg-sapthagiri-burgundy text-white sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <span className="text-2xl">📡</span>
            <div>
              <div className="text-xs uppercase tracking-[0.25em] text-sapthagiri-gold">
                Sapthagiri · Admin
              </div>
              <h1 className="text-lg font-display">Agent Comms</h1>
            </div>
          </div>
          <div className="text-sm flex items-center gap-4 flex-wrap">
            <span className="text-sapthagiri-gold/90">
              {rows.length} events · {agents.length} agents
            </span>
            <label className="flex items-center gap-1 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
                className="accent-sapthagiri-gold"
              />
              Auto-scroll
            </label>
            <Link
              href="/"
              className="text-xs uppercase tracking-wider text-sapthagiri-gold hover:text-white"
            >
              ← Home
            </Link>
            <SignOutButton className="text-xs uppercase tracking-wider text-sapthagiri-gold hover:text-white" />
          </div>
        </div>

        {/* Agent filter chips */}
        <div className="max-w-5xl mx-auto px-6 pb-3 flex gap-2 overflow-x-auto">
          <Chip
            label="All"
            count={rows.length}
            active={filter === "all"}
            onClick={() => setFilter("all")}
          />
          {agents.map((a) => (
            <Chip
              key={a}
              label={`${(AGENT_COLORS[a]?.emoji ?? "🤖")} ${a}`}
              count={counts[a] ?? 0}
              active={filter === a}
              onClick={() => setFilter(a)}
            />
          ))}
        </div>
      </header>

      <section className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-3 text-sm mb-4">
            {error} — is `agent_log` table present + accessible to staff?
          </div>
        )}

        {visible.length === 0 ? (
          <div className="card p-8 text-center text-stone-500">
            No events yet. As soon as an agent posts to <code>agent_log</code>,
            it appears here in real time. Try seeding with:
            <pre className="text-xs text-left bg-stone-100 rounded p-3 mt-3 overflow-x-auto">
{`select log_agent_event('orchestrator','note','smoke-test',
  'hello from the SQL editor', null);`}
            </pre>
          </div>
        ) : (
          <ol className="space-y-3">
            {threads.map((thread) => (
              <Thread key={thread.key} thread={thread} now={now} />
            ))}
          </ol>
        )}
        <div ref={bottomRef} />
      </section>
    </main>
  );
}

// ─────────── small components ───────────

function Chip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm whitespace-nowrap transition ${
        active
          ? "bg-white text-sapthagiri-burgundy font-semibold shadow"
          : "bg-white/10 text-white hover:bg-white/20"
      }`}
    >
      <span>{label}</span>
      <span
        className={`inline-flex items-center justify-center min-w-[1.4rem] h-[1.4rem] rounded-full text-xs font-bold tabular-nums ${
          active
            ? "bg-sapthagiri-burgundy text-white"
            : "bg-white/30 text-white"
        }`}
      >
        {count}
      </span>
    </button>
  );
}

interface ThreadGroup {
  key: string;        // task_id or "untagged-<index>"
  taskId: string | null;
  agent: string;
  rows: AgentLogRow[];
}

function groupByTask(rows: AgentLogRow[]): ThreadGroup[] {
  const out: ThreadGroup[] = [];
  let untagged = 0;
  const map = new Map<string, ThreadGroup>();
  for (const r of rows) {
    const key = r.task_id ?? `__untagged-${untagged++}`;
    let g = map.get(key);
    if (!g) {
      g = { key, taskId: r.task_id, agent: r.agent, rows: [] };
      map.set(key, g);
      out.push(g);
    }
    g.rows.push(r);
  }
  return out;
}

function Thread({ thread, now }: { thread: ThreadGroup; now: Date }) {
  const head = thread.rows[0];
  const colors = AGENT_COLORS[head.agent] ?? {
    bg: "bg-stone-700",
    fg: "text-white",
    emoji: "🤖",
  };
  return (
    <li className="card overflow-hidden">
      <div className={`${colors.bg} ${colors.fg} px-4 py-2 flex items-center justify-between gap-3`}>
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-lg" aria-hidden>
            {colors.emoji}
          </span>
          <span className="font-semibold tracking-wide">{head.agent}</span>
          {thread.taskId && (
            <span className="text-xs opacity-80 font-mono truncate">
              · {thread.taskId}
            </span>
          )}
        </div>
        <span className="text-xs opacity-80 tabular-nums whitespace-nowrap">
          {timeAgo(head.created_at, now)}
        </span>
      </div>
      <ol className="divide-y divide-stone-200">
        {thread.rows.map((r) => (
          <li key={r.id} className="px-4 py-3 text-sm">
            <div className="flex items-start gap-3 flex-wrap">
              <span
                className={`badge ${PHASE_BADGE[r.phase]} text-[10px] uppercase tracking-wider`}
              >
                {r.phase}
              </span>
              <span className="flex-1 min-w-0">{r.message}</span>
              <span className="text-xs text-stone-400 tabular-nums whitespace-nowrap">
                {new Date(r.created_at).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </span>
            </div>
            {r.payload && Object.keys(r.payload).length > 0 && (
              <details className="mt-2">
                <summary className="text-xs text-stone-500 cursor-pointer hover:text-sapthagiri-burgundy">
                  payload
                </summary>
                <pre className="mt-1 text-[11px] bg-stone-50 border border-stone-200 rounded p-2 overflow-x-auto">
                  {JSON.stringify(r.payload, null, 2)}
                </pre>
              </details>
            )}
          </li>
        ))}
      </ol>
    </li>
  );
}

function timeAgo(iso: string, now: Date): string {
  const secs = Math.max(0, (now.getTime() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return `${Math.floor(secs)}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ${hrs % 24}h ago`;
}
