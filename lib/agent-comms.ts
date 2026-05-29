/**
 * Agent communication helpers — Sapthagiri org.
 *
 * Every agent (sub-agent prompt, Vercel cron, in-repo TS code that
 * acts on behalf of an agent) calls these to read/write the shared
 * `public.agent_log` scratchpad.
 *
 * Wire protocol matches `.agent-org/agents/PROTOCOL.md` — the
 * authoritative source.
 *
 * Why is this a thin client wrapper instead of inlined RPC calls?
 *   • Centralises slug validation, payload shape, and error handling.
 *   • Gives every agent the same TypeScript types so a `finishing`
 *     payload doesn't drift between callers.
 *   • Makes a future swap (e.g. Slack webhook fan-out) a one-file
 *     change instead of N call sites.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

/** All recognised agent slugs. Add to this list when you onboard a new agent. */
export const AGENT_SLUGS = [
  "orchestrator",
  "sentry",
  "service-architect",
  "hammer",
  "custodian",
  "tava",
  "patron",
  "counter",
  "mirror",
] as const;

export type AgentSlug = (typeof AGENT_SLUGS)[number];

export type AgentPhase = "starting" | "note" | "blocked" | "finishing";

export interface AgentEventInput {
  agent: AgentSlug;
  phase: AgentPhase;
  /** Free-form correlation id — Cowork TaskCreate id, PR number, or your own slug. */
  task_id?: string | null;
  /** One line, human-readable. Keep it short. */
  message: string;
  /** Structured detail. See PROTOCOL.md §"What goes in payload". */
  payload?: Record<string, unknown> | null;
}

export interface AgentLogRow {
  id: string;
  agent: string;
  phase: AgentPhase;
  task_id: string | null;
  message: string;
  payload: Record<string, unknown> | null;
  created_at: string;
}

/** Write one row to agent_log. Returns the new row id. */
export async function logEvent(
  ev: AgentEventInput,
  client?: SupabaseClient
): Promise<string> {
  if (!AGENT_SLUGS.includes(ev.agent)) {
    throw new Error(`Unknown agent slug: ${ev.agent}`);
  }
  if (ev.message.length > 2000) {
    throw new Error(`agent_log message too long (max 2000, got ${ev.message.length})`);
  }
  const sb = client ?? supabase();
  const { data, error } = await sb.rpc("log_agent_event", {
    p_agent: ev.agent,
    p_phase: ev.phase,
    p_task_id: ev.task_id ?? null,
    p_message: ev.message,
    p_payload: ev.payload ?? null,
  });
  if (error) throw error;
  return data as unknown as string;
}

/**
 * Pull the most recent agent_log rows. Pass these into a sub-agent's
 * briefing so they wake up with shared context.
 */
export async function recentEvents(
  limit = 20,
  client?: SupabaseClient
): Promise<AgentLogRow[]> {
  const sb = client ?? supabase();
  const { data, error } = await sb
    .from("agent_log")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as AgentLogRow[];
}

/**
 * Convenience helper for the common pattern:
 *   const tx = beginAgentRun({ agent: "hammer", task_id: "issue-2" });
 *   await tx.start("Implementing cooking-mode toggle");
 *   ...do work...
 *   await tx.note("Found existing localStorage util to reuse");
 *   ...
 *   await tx.finish("PR #3 opened", { pr: 3, handoff_to: "custodian" });
 */
export function beginAgentRun(opts: {
  agent: AgentSlug;
  task_id?: string;
  client?: SupabaseClient;
}) {
  const { agent, task_id = null, client } = opts;
  return {
    start(message: string, payload?: Record<string, unknown>) {
      return logEvent({ agent, phase: "starting", task_id, message, payload }, client);
    },
    note(message: string, payload?: Record<string, unknown>) {
      return logEvent({ agent, phase: "note", task_id, message, payload }, client);
    },
    blocked(message: string, payload?: Record<string, unknown>) {
      return logEvent({ agent, phase: "blocked", task_id, message, payload }, client);
    },
    finish(message: string, payload?: Record<string, unknown>) {
      return logEvent({ agent, phase: "finishing", task_id, message, payload }, client);
    },
  };
}

/**
 * Format recent agent_log rows for embedding in an LLM prompt. Used by
 * the orchestrator when spawning a sub-agent.
 *
 * Returns a markdown block ready to paste into a system prompt:
 *
 *   <recent_agent_log>
 *   [2026-05-29 06:14:02] sentry · finishing — 3 P0 / 4 P1 / 5 P2 ...
 *   [2026-05-29 05:48:11] orchestrator · note — Migration 001 applied ...
 *   </recent_agent_log>
 */
export function formatLogForPrompt(rows: AgentLogRow[]): string {
  const lines = rows
    .slice()
    .sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
    .map((r) => {
      const ts = r.created_at.replace("T", " ").slice(0, 19);
      return `[${ts}] ${r.agent} · ${r.phase} — ${r.message}`;
    });
  return "<recent_agent_log>\n" + lines.join("\n") + "\n</recent_agent_log>";
}
