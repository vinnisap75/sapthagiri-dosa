#!/usr/bin/env node
/**
 * Sapthagiri Hammer — local autonomous code-writing agent.
 *
 * Picks one open GitHub Issue labeled `agent:hammer`, briefs Claude with
 * the Hammer prompt + recent agent_log rows + the Issue body + the repo
 * tree, lets Claude edit files via tool use, commits to a feature branch,
 * pushes, and opens a PR. Posts a finishing row to agent_log with
 * handoff_to=custodian.
 *
 * Stdlib + global fetch only (Node ≥ 18). No npm install required.
 *
 * Config (~/.sapthagiri/env):
 *   ANTHROPIC_API_KEY             sk-ant-...
 *   SUPABASE_URL                  https://upxgcpkatrcejicailmp.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY     eyJ...
 *   GITHUB_REPO                   vinnisap75/sapthagiri-dosa
 *   GITHUB_PAT                    ghp_...   (gh auth token works too; we
 *                                            fall back to `gh auth token`)
 *
 * Usage:
 *   node scripts/agent/run-hammer.mjs           # pick + work one issue
 *   node scripts/agent/run-hammer.mjs --issue N # work a specific issue
 *   node scripts/agent/run-hammer.mjs --dry     # plan only, no commits
 */

import { readFile, writeFile, mkdir, stat, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import os from "node:os";

// ──────────────────────────── config ────────────────────────────

const HOME = os.homedir();
const ENV_FILE = path.join(HOME, ".sapthagiri", "env");
const REPO_ROOT = process.cwd();
const HAMMER_AGENT_PROMPT_PATH = ".agent-org/agents/HAMMER.md";
const PROTOCOL_PATH = ".agent-org/agents/PROTOCOL.md";
const MODEL = "claude-sonnet-4-5";
const MAX_TOOL_ROUNDS = 30;

function loadEnv() {
  const out = { ...process.env };
  if (existsSync(ENV_FILE)) {
    const raw = require("node:fs").readFileSync(ENV_FILE, "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (!m) continue;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      out[m[1]] = v;
    }
  }
  return out;
}

const env = loadEnv();
const ANTHROPIC_KEY = env.ANTHROPIC_API_KEY;
const SUPABASE_URL = env.SUPABASE_URL;
const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const GH_REPO = env.GITHUB_REPO || "vinnisap75/sapthagiri-dosa";
let GH_TOKEN = env.GITHUB_PAT;
if (!GH_TOKEN) {
  try {
    GH_TOKEN = execSync("gh auth token", { encoding: "utf8" }).trim();
  } catch {
    /* gh not authed, will fail below */
  }
}

function requireEnv(name, value) {
  if (!value) {
    console.error(`Hammer: missing ${name} (set in ${ENV_FILE} or process env)`);
    process.exit(2);
  }
}
requireEnv("ANTHROPIC_API_KEY", ANTHROPIC_KEY);
requireEnv("SUPABASE_URL", SUPABASE_URL);
requireEnv("SUPABASE_SERVICE_ROLE_KEY", SUPABASE_KEY);
requireEnv("GITHUB_PAT or gh auth", GH_TOKEN);

// ──────────────────────────── small helpers ────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry");
const ISSUE_OVERRIDE = (() => {
  const i = args.indexOf("--issue");
  return i >= 0 ? Number(args[i + 1]) : null;
})();

const sh = (cmd, opts = {}) =>
  execSync(cmd, { encoding: "utf8", cwd: REPO_ROOT, ...opts }).trim();
const shQuiet = (cmd) => sh(cmd, { stdio: ["ignore", "pipe", "pipe"] });

function nowISO() {
  return new Date().toISOString();
}

function log(...a) {
  console.log(`[${nowISO().slice(11, 19)}]`, ...a);
}

// ──────────────────────────── agent_log RPC ────────────────────────────

async function logEvent(agent, phase, taskId, message, payload = null) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/log_agent_event`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
    body: JSON.stringify({
      p_agent: agent,
      p_phase: phase,
      p_task_id: taskId,
      p_message: message.slice(0, 2000),
      p_payload: payload,
    }),
  });
  if (!res.ok) {
    console.error("agent_log write failed:", res.status, await res.text());
  }
}

async function recentAgentLog(limit = 20) {
  const url = `${SUPABASE_URL}/rest/v1/agent_log?order=created_at.desc&limit=${limit}`;
  const res = await fetch(url, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!res.ok) return [];
  const rows = await res.json();
  // Return oldest first so the LLM reads it chronologically.
  return rows.reverse();
}

function formatLogForPrompt(rows) {
  if (!rows.length) return "<recent_agent_log>(empty)</recent_agent_log>";
  const lines = rows.map((r) => {
    const ts = r.created_at.replace("T", " ").slice(0, 19);
    return `[${ts}] ${r.agent} · ${r.phase} — ${r.message}`;
  });
  return "<recent_agent_log>\n" + lines.join("\n") + "\n</recent_agent_log>";
}

// ──────────────────────────── GitHub API ────────────────────────────

async function gh(method, pathRel, body) {
  const res = await fetch(`https://api.github.com${pathRel}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${GH_TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`GitHub ${method} ${pathRel} → ${res.status}: ${txt.slice(0, 500)}`);
  }
  return res.status === 204 ? null : res.json();
}

async function pickIssue() {
  if (ISSUE_OVERRIDE) {
    return gh("GET", `/repos/${GH_REPO}/issues/${ISSUE_OVERRIDE}`);
  }
  const issues = await gh(
    "GET",
    `/repos/${GH_REPO}/issues?state=open&labels=agent:hammer&sort=created&direction=asc&per_page=20`
  );
  // Skip ones already "in-progress".
  const candidates = issues.filter(
    (i) => !i.pull_request && !i.labels.some((l) => l.name === "agent:in-progress")
  );
  // Priority order: p0 first, then p1, then others.
  candidates.sort((a, b) => {
    const score = (i) =>
      i.labels.some((l) => l.name === "priority:p0") ? 0 :
      i.labels.some((l) => l.name === "priority:p1") ? 1 : 2;
    return score(a) - score(b);
  });
  return candidates[0] || null;
}

async function addLabel(issueNum, label) {
  await gh("POST", `/repos/${GH_REPO}/issues/${issueNum}/labels`, {
    labels: [label],
  });
}

async function removeLabel(issueNum, label) {
  try {
    await gh("DELETE", `/repos/${GH_REPO}/issues/${issueNum}/labels/${encodeURIComponent(label)}`);
  } catch {/* ok if absent */}
}

async function commentOnIssue(issueNum, body) {
  await gh("POST", `/repos/${GH_REPO}/issues/${issueNum}/comments`, { body });
}

async function openPR({ branch, base, title, body }) {
  return gh("POST", `/repos/${GH_REPO}/pulls`, { title, body, head: branch, base });
}

// ──────────────────────────── git helpers ────────────────────────────

function gitClean() {
  try {
    sh("git diff --quiet && git diff --cached --quiet");
    return true;
  } catch {
    return false;
  }
}

function ensureFreshBranch(branchName) {
  sh("git fetch origin --prune");
  sh("git checkout main");
  sh("git reset --hard origin/main");
  // Delete branch if it exists, then create fresh.
  try { sh(`git branch -D ${branchName}`); } catch {/* ok */}
  sh(`git checkout -b ${branchName}`);
}

function commitAll(message) {
  sh("git add -A");
  // No-op commit guard.
  try {
    sh("git diff --cached --quiet");
    return false;
  } catch {/* there ARE staged changes */}
  // Write commit with trailer + co-author.
  const tmp = path.join(os.tmpdir(), `hammer-msg-${Date.now()}.txt`);
  const msg =
    message.trim() +
    "\n\n" +
    "Co-authored-by: sreec22 <sreec22@users.noreply.github.com>\n";
  require("node:fs").writeFileSync(tmp, msg);
  sh(`git commit -F ${tmp}`);
  return true;
}

function pushBranch(branchName) {
  sh(`git push -u origin ${branchName}`);
}

// ──────────────────────────── Anthropic tool-use ────────────────────────────

// Repo-scoped file tools. Hammer can't escape REPO_ROOT.
const TOOLS = [
  {
    name: "read_file",
    description: "Read the full contents of a file in the repo. Path is relative to repo root.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Repo-relative path, e.g. 'app/kitchen/page.tsx'" },
      },
      required: ["path"],
    },
  },
  {
    name: "list_dir",
    description: "List entries in a directory (non-recursive).",
    input_schema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description:
      "Write a file (creates or overwrites). Use this to make all edits. Path is repo-relative.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "delete_file",
    description: "Delete a file at the given repo-relative path.",
    input_schema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
  {
    name: "run_check",
    description:
      "Run a safe, read-only verification command. Allowed: 'npx tsc --noEmit', 'npm run build', 'npm test'. Anything else is rejected.",
    input_schema: {
      type: "object",
      properties: {
        cmd: {
          type: "string",
          enum: ["npx tsc --noEmit", "npm run build", "npm test"],
        },
      },
      required: ["cmd"],
    },
  },
  {
    name: "finish",
    description:
      "Signal you are done editing. Provide the PR title, PR body, branch name, and verdict.",
    input_schema: {
      type: "object",
      properties: {
        branch: { type: "string", description: "feat/<slug> or fix/<slug>" },
        title: { type: "string" },
        body: { type: "string" },
        files_touched: { type: "array", items: { type: "string" } },
        notes: { type: "string", description: "One paragraph for agent_log message field." },
      },
      required: ["branch", "title", "body", "files_touched", "notes"],
    },
  },
];

function repoPath(rel) {
  const abs = path.resolve(REPO_ROOT, rel);
  if (!abs.startsWith(REPO_ROOT + path.sep) && abs !== REPO_ROOT) {
    throw new Error(`Path escapes repo: ${rel}`);
  }
  // Block edits in critical zones.
  const blocked = [
    /^\.git\//,
    /^\.env(\.|$)/,
    /^node_modules\//,
    /^\.next\//,
    /^supabase\/migrations\/.*\.sql$/, // open a NEW migration instead
  ];
  return { abs, rel, blocked: blocked.some((rx) => rx.test(rel)) };
}

async function execTool(name, input) {
  switch (name) {
    case "read_file": {
      const { abs } = repoPath(input.path);
      try {
        const s = await readFile(abs, "utf8");
        return s.length > 30000
          ? s.slice(0, 30000) + "\n...[truncated at 30k chars]"
          : s;
      } catch (e) {
        return `ERROR reading ${input.path}: ${e.message}`;
      }
    }
    case "list_dir": {
      const { abs } = repoPath(input.path);
      try {
        const entries = await readdir(abs, { withFileTypes: true });
        return entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).join("\n");
      } catch (e) {
        return `ERROR listing ${input.path}: ${e.message}`;
      }
    }
    case "write_file": {
      const p = repoPath(input.path);
      if (p.blocked) return `BLOCKED: ${input.path} is in a protected zone.`;
      if (DRY_RUN) return `DRY: would write ${input.content.length} chars to ${input.path}`;
      await mkdir(path.dirname(p.abs), { recursive: true });
      await writeFile(p.abs, input.content);
      return `OK wrote ${input.path} (${input.content.length} bytes)`;
    }
    case "delete_file": {
      const p = repoPath(input.path);
      if (p.blocked) return `BLOCKED: ${input.path}`;
      if (DRY_RUN) return `DRY: would delete ${input.path}`;
      try { await rm(p.abs, { force: true }); return `OK deleted ${input.path}`; }
      catch (e) { return `ERROR: ${e.message}`; }
    }
    case "run_check": {
      try {
        const out = sh(input.cmd, { stdio: ["ignore", "pipe", "pipe"] });
        return (out || "OK").slice(-4000);
      } catch (e) {
        return `FAILED (${e.status ?? "?"}): ${(e.stdout || "")
          .toString()
          .slice(-2000)}\n${(e.stderr || "").toString().slice(-2000)}`;
      }
    }
    case "finish":
      return { __finish: true, ...input };
    default:
      return `ERROR: unknown tool ${name}`;
  }
}

// ──────────────────────────── Anthropic API ────────────────────────────

async function claudeCall(messages, system) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 8000,
      system,
      tools: TOOLS,
      messages,
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Anthropic ${res.status}: ${txt.slice(0, 500)}`);
  }
  return res.json();
}

// ──────────────────────────── Hammer main loop ────────────────────────────

async function loadFile(relPath) {
  try { return await readFile(path.join(REPO_ROOT, relPath), "utf8"); }
  catch { return null; }
}

async function main() {
  if (!gitClean()) {
    console.error("Hammer refusing to start: working tree has uncommitted changes. Stash or commit first.");
    process.exit(3);
  }

  const issue = await pickIssue();
  if (!issue) {
    log("No open agent:hammer issues to work on. Exiting clean.");
    return;
  }

  const taskId = `hammer-issue-${issue.number}-${Date.now()}`;
  log(`Picked Issue #${issue.number}: ${issue.title}`);

  await logEvent("hammer", "starting", taskId,
    `Working Issue #${issue.number}: ${issue.title.slice(0, 120)}`,
    { issue: issue.number, dry_run: DRY_RUN });

  if (!DRY_RUN) {
    await addLabel(issue.number, "agent:in-progress").catch(() => {});
  }

  // Build the system prompt: protocol + Hammer + recent log.
  const protocolMd = (await loadFile(PROTOCOL_PATH)) || "";
  const hammerMd = (await loadFile(HAMMER_AGENT_PROMPT_PATH)) || "";
  const recent = await recentAgentLog(20);
  const logBlock = formatLogForPrompt(recent);

  const system =
    `You are HAMMER, the code-writing sub-agent for the Sapthagiri Dosa repo.\n\n` +
    `${logBlock}\n\n` +
    `<protocol>\n${protocolMd}\n</protocol>\n\n` +
    `<hammer_spec>\n${hammerMd}\n</hammer_spec>\n\n` +
    `Your correlation id: ${taskId}\n` +
    `Use the file tools to read context, then edit files. When ready, call the 'finish' tool with PR title, body, branch name, files_touched, and a 1-paragraph note. Don't run git yourself — the harness will commit, push, and open the PR after you finish.\n` +
    `Branch must start with 'feat/' or 'fix/'. Body must include 'Closes #${issue.number}'.\n` +
    `If a check fails (typecheck/build), iterate. Stop and call finish only when everything is green or when you're truly blocked (in which case explain in 'notes').`;

  const issueBlock =
    `<issue number="${issue.number}" title="${issue.title.replace(/"/g, "'")}">\n` +
    `${issue.body || "(no body)"}\n` +
    `</issue>`;

  const messages = [
    {
      role: "user",
      content: [{ type: "text", text: issueBlock + "\n\nStart by reading the most relevant files, then make the changes." }],
    },
  ];

  let finishPayload = null;
  let roundsLeft = MAX_TOOL_ROUNDS;
  while (roundsLeft-- > 0) {
    const res = await claudeCall(messages, system);
    messages.push({ role: "assistant", content: res.content });

    const toolUses = res.content.filter((b) => b.type === "tool_use");
    if (!toolUses.length) {
      // No tools called — Hammer talked but didn't act. Nudge once.
      messages.push({
        role: "user",
        content: [{ type: "text", text: "You didn't call any tool. Either edit files or call finish." }],
      });
      continue;
    }

    const toolResults = [];
    for (const tu of toolUses) {
      const result = await execTool(tu.name, tu.input);
      if (result && result.__finish) {
        finishPayload = result;
      }
      toolResults.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: typeof result === "string" ? result : JSON.stringify(result),
      });
    }
    messages.push({ role: "user", content: toolResults });

    if (finishPayload) break;
  }

  if (!finishPayload) {
    log("Hammer hit max rounds without calling finish. Aborting cleanly.");
    await logEvent("hammer", "blocked", taskId,
      `Hit max ${MAX_TOOL_ROUNDS} rounds on Issue #${issue.number} without calling finish.`,
      { issue: issue.number, mentions: ["orchestrator"] });
    if (!DRY_RUN) await removeLabel(issue.number, "agent:in-progress");
    return;
  }

  log(`Hammer finished editing. Branch: ${finishPayload.branch}`);

  if (DRY_RUN) {
    log("DRY mode — skipping git commit + push + PR.");
    await logEvent("hammer", "finishing", taskId,
      `DRY: would PR ${finishPayload.branch}: ${finishPayload.notes.slice(0, 200)}`,
      { issue: issue.number, files_touched: finishPayload.files_touched });
    return;
  }

  // Stage + commit + push + PR.
  let prNumber = null;
  try {
    // We're already on the new branch since Hammer edited in-place;
    // but we want a clean commit off origin/main with only Hammer's changes.
    // Strategy: stash Hammer's edits, checkout fresh branch off origin/main, pop, commit.
    sh("git add -A");
    const stashed = !gitClean();
    if (stashed) sh(`git stash push -u -m "hammer-${taskId}"`);
    ensureFreshBranch(finishPayload.branch);
    if (stashed) sh("git stash pop");

    commitAll(finishPayload.title);
    pushBranch(finishPayload.branch);

    const pr = await openPR({
      branch: finishPayload.branch,
      base: "main",
      title: finishPayload.title,
      body: `${finishPayload.body}\n\nCloses #${issue.number}\n\nCo-authored-by: sreec22 <sreec22@users.noreply.github.com>\n`,
    });
    prNumber = pr.number;
    log(`PR #${prNumber} opened: ${pr.html_url}`);

    await addLabel(prNumber, "agent:hammer").catch(() => {});
    await removeLabel(issue.number, "agent:in-progress");
    await commentOnIssue(issue.number,
      `🔨 Hammer opened #${prNumber}: ${finishPayload.notes}`);
  } catch (e) {
    log("Push/PR failed:", e.message);
    await logEvent("hammer", "blocked", taskId,
      `Push/PR failed: ${e.message}`,
      { issue: issue.number, mentions: ["orchestrator"] });
    if (!DRY_RUN) await removeLabel(issue.number, "agent:in-progress").catch(() => {});
    return;
  }

  await logEvent("hammer", "finishing", taskId,
    `PR #${prNumber} opened for Issue #${issue.number}: ${finishPayload.notes.slice(0, 200)}`,
    {
      issue: issue.number,
      pr: prNumber,
      branch: finishPayload.branch,
      files_touched: finishPayload.files_touched,
      handoff_to: "custodian",
    });
}

main().catch(async (e) => {
  console.error("Hammer crashed:", e);
  await logEvent("hammer", "blocked", `hammer-crash-${Date.now()}`,
    `Hammer crashed: ${e.message}`.slice(0, 2000),
    { mentions: ["orchestrator"] }).catch(() => {});
  process.exit(1);
});
