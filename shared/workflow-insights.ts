import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";
import { firstObject } from "./summary";
import { dayKey } from "./insights";

/**
 * Workflow insights (WORKFLOW-INSIGHTS-SPEC): a log of the shell commands agents
 * ran on a project's cards, and a periodic model run that suggests scripts,
 * tools and rules worth keeping. Pure logic; the daemon does the I/O.
 */

export const INTERVALS = [1, 3, 7, 14] as const;
export const RETENTION_DAYS = 30;
export const BACKFILL_DAYS = 7;
export const QUIET_ACTIONS = 50;
export const QUIET_CARDS = 2;
/** A busy project with fewer cards still runs (§4.1). */
export const BUSY_ACTIONS = 200;
/** Title similarity that marks a reworded repeat: same target / any target (§4.4). */
export const SIMILAR_SAME_TARGET = 0.6;
export const SIMILAR_ANY_TARGET = 0.7;
export const MATERIAL_LIMIT = 150_000;
export const INLINE_CHARS = 560;
export const INLINE_SAMPLE = 280;
export const FAILED_SAMPLE = 60;
export const FAILED_CHARS = 260;
export const MAX_FINDINGS = 8;
export const RUNS_KEPT = 20;
export const CLOSED_KEPT_DAYS = 90;
export const DISMISS_COOLDOWN_DAYS = 30;
export const RUN_TIMEOUT_MS = 900_000;
export const PROJECT_SCRIPTS_MAX = 20;
/** Auto: a capable model; cheap summary models miss cross-card patterns. Falls back to the Summary model. */
export const WORKFLOW_AUTO_MODELS = ["claude/claude-sonnet-5-5", "claude/claude-sonnet-5"] as const;
export const WORKFLOW_LABEL = { "flowly-insight": "workflow" } as const;
const DAY_MS = 86_400_000;

// ---- Settings ---------------------------------------------------------------

export const workflowInsightsSettings = defineSettings({
  id: "workflow-insights",
  scope: "host",
  version: 1,
  schema: z.object({
    enabled: z.boolean().default(false),
    /** `provider/model`; empty picks WORKFLOW_AUTO_MODELS, then the Summary model. */
    model: z.string().max(200).default(""),
    intervalDays: z
      .number()
      .int()
      .refine((n) => (INTERVALS as readonly number[]).includes(n))
      .catch(7)
      .default(7),
    runHour: z.number().int().min(0).max(23).catch(9).default(9),
    /** The device's zone, written by the client when it saves; empty uses the daemon's zone. */
    timeZone: z.string().max(64).default(""),
  }),
});
export type WorkflowSettings = z.infer<typeof workflowInsightsSettings.schema>;
/** Stored values may predate fields; the host does not apply schema defaults. */
export function workflowSettingsValues(values: unknown): WorkflowSettings {
  const parsed = workflowInsightsSettings.schema.safeParse(values ?? {});
  return parsed.success ? parsed.data : workflowInsightsSettings.schema.parse({});
}

/** Analysis window: at least a week, so cross-card patterns show; at most two. */
export const windowDays = (intervalDays: number) => Math.min(14, Math.max(7, intervalDays));

// ---- Command log ------------------------------------------------------------

export const commandRecordSchema = z.object({
  /** `<agentId>:<callId>`: the same shell call from a hook and a backfill is one record. */
  id: z.string().max(400),
  at: z.string(),
  taskId: z.string(),
  agentId: z.string(),
  /** The card's lane when the command ran. */
  lane: z.string().max(40),
  provider: z.string().max(80),
  status: z.enum(["completed", "failed", "other"]),
  /** Normalized keys of the action segments, in order. */
  actions: z.array(z.string().max(200)).max(40),
  explore: z.number().int().min(0),
  /** Files read by exploration segments (redacted), at most 4. */
  files: z.array(z.string().max(200)).max(4).optional(),
  /** Redacted, truncated inline script (python heredoc, node -e …). */
  inline: z.string().max(INLINE_CHARS + 2).optional(),
  /** Redacted, truncated command, kept only for failed calls. */
  failed: z.string().max(FAILED_CHARS + 2).optional(),
});
export type CommandRecord = z.infer<typeof commandRecordSchema>;

export type RedactContext = { repo: string; home: string };

/** Secrets, credentials and personal paths never reach the log or the model (§3.2). */
export function redact(text: string, ctx: RedactContext): string {
  let s = text;
  if (ctx.repo) s = s.split(ctx.repo).join(".");
  if (ctx.home) s = s.split(ctx.home).join("~");
  return s
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "<email>")
    .replace(/(https?:\/\/)[^@\s/]+@/g, "$1<cred>@")
    .replace(/(Authorization:\s*(?:Bearer|Basic|token))\s+\S+/gi, "$1 <secret>")
    .replace(/\b([A-Za-z_][A-Za-z0-9_]*(?:TOKEN|KEY|SECRET|PASSWORD|PASSWD|AUTH)[A-Za-z0-9_]*)=("[^"]*"|'[^']*'|\S+)/gi, "$1=<v>")
    .replace(/\b(eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_.-]+|gh[pousr]_[A-Za-z0-9]{16,}|sk-[A-Za-z0-9_-]{16,}|xox[abprs]-[A-Za-z0-9-]{10,})/g, "<secret>")
    // No "/": long slash-separated paths are context, not secrets.
    .replace(/[A-Za-z0-9_+=-]{40,}/g, "<secret>")
    // No lookbehind: the client loads this module too, and older Hermes rejects it.
    .replace(/(^|[^\w.~])\/(?:private\/)?(?:tmp|var\/folders)\/[\w./-]*/g, "$1<tmp>");
}

/** Splits at top-level `&&`, `||`, `;`, `|` and newlines; quotes, `$( )` and heredocs stay whole. */
export function splitChain(command: string): string[] {
  const s = command.replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2\b/g, "<heredoc>");
  const out: string[] = [];
  let cur = "",
    quote: string | null = null,
    depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i],
      n = s[i + 1];
    if (quote) {
      cur += c;
      if (c === quote && s[i - 1] !== "\\") quote = null;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      cur += c;
      continue;
    }
    if (c === "(") depth++;
    if (c === ")") depth = Math.max(0, depth - 1);
    if (depth === 0 && ((c === "&" && n === "&") || (c === "|" && n === "|"))) {
      out.push(cur);
      cur = "";
      i++;
      continue;
    }
    if (depth === 0 && (c === ";" || c === "\n" || c === "|")) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

function words(segment: string): string[] {
  const out: string[] = [];
  const re = /"((?:\\.|[^"])*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(segment))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

const EXPLORE = new Set(
  "ls cat head tail sed gsed grep egrep rg ag find fd wc echo pwd which whereis sleep awk sort uniq cut tr xargs jq yq diff stat file mkdir rm rmdir cp mv touch true false test [ printf date ps kill pkill lsof tree basename dirname realpath readlink env export for while until do done if then elif fi else nl less more column tee comm du df open type command set source . unset exit read local return chmod chown ln strings xxd od hexdump md5 shasum sha256sum time timeout cal clear history alias whoami id uname hostname"
    .split(" "),
);
const GIT_EXPLORE = new Set(
  "status diff log show rev-parse branch ls-files blame grep remote config describe shortlog cat-file ls-tree reflog worktree symbolic-ref merge-base name-rev for-each-ref rev-list count-objects".split(" "),
);
const SKIP = /^(?:[{}]|break|continue|esac|case|in|umask|wait|trap|shift|cd|pushd|popd|;;)$|\)$|^\$|\(\)\s*\{?$|^\w[\w-]*\(\)/;
const FILE = /\.(?:tsx?|jsx?|mjs|cjs|md|json|ya?ml|toml|py|go|rs|swift|kt|java|css|html|sh)$/;

export type Segment = { kind: "skip" } | { kind: "explore"; files: string[] } | { kind: "action"; key: string };

/**
 * One shell segment → skip / explore / action with a normalized key (§3.2).
 * `scripts`: package.json script names, so `npx tsc` folds into `npm run typecheck`
 * only when that script exists.
 */
export function classify(segment: string, ctx: RedactContext, scripts: ReadonlySet<string> = new Set()): Segment {
  const t = words(segment);
  while (t.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(t[0])) t.shift();
  while (t.length && ["sudo", "time", "env", "command", "exec", "nohup", "builtin"].includes(t[0])) t.shift();
  if (t[0] === "git") while (t[1] === "-c" || t[1] === "-C") t.splice(1, 2);
  if (!t.length || SKIP.test(t[0])) return { kind: "skip" };
  const raw = t[0].replace(/^\(+/, "");
  if (!raw || SKIP.test(raw)) return { kind: "skip" };
  const base = raw.includes("/") && !raw.startsWith("./") ? raw.slice(raw.lastIndexOf("/") + 1) : raw;
  const rest = t.slice(1).map((w) => redact(w, ctx));
  const positional = rest.filter((w) => !w.startsWith("-") && !/^\d*>/.test(w) && w !== "2>&1");
  // Option values such as `--tail 2` are not part of what the command is.
  const named = positional.filter((w) => !/^\d+$/.test(w));
  if (EXPLORE.has(base)) return { kind: "explore", files: positional.filter((w) => FILE.test(w) && w.length <= 200).slice(0, 4) };
  if (base === "git") {
    const sub = positional[0] || "";
    return GIT_EXPLORE.has(sub) || !sub ? { kind: "explore", files: [] } : { kind: "action", key: `git ${sub}` };
  }
  let key: string;
  if (["npm", "pnpm", "yarn", "bun"].includes(base)) {
    const [sub = "", name = ""] = positional;
    if (sub === "test" || sub === "t") key = `${base} test`;
    else if (sub === "run" || sub === "run-script") key = `${base} run ${name}`;
    else if (sub === "i" || sub === "install" || sub === "ci" || sub === "add") key = `${base} ${sub === "i" ? "install" : sub}`;
    else key = `${base} ${sub}`;
  } else if (base === "npx" || base === "pnpx" || base === "bunx") {
    const tool = positional[0] || "";
    key = tool === "tsc" && scripts.has("typecheck") ? "npm run typecheck" : tool === "vitest" && scripts.has("test") ? "npm test" : `npx ${tool}`;
  } else if (["node", "python", "python3", "tsx", "deno", "ruby", "perl"].includes(base)) {
    const inline = rest.some((w) => w === "-e" || w === "-c" || w === "--eval" || w === "-" || w === "-p") || segment.includes("<heredoc>");
    const script = positional[0] || "";
    key = inline ? `${base} <inline>` : `${base} ${script.startsWith("<tmp>") ? "<tmp-script>" : script}`;
  } else if (base === "paseo") {
    key = `paseo ${named
      .slice(0, 3)
      .map((w) => (/^[0-9a-f]{6,}$|^(?:wks|prj|agt)_|<secret>/.test(w) ? "<id>" : w))
      .join(" ")}`;
  } else {
    key = `${base} ${named
      .slice(0, 2)
      .filter((w) => /^[\w.:@/-]{1,60}$/.test(w) && !w.startsWith("<") && !/^\.?\.?\//.test(w))
      .join(" ")}`;
  }
  return { kind: "action", key: key.replace(/\s+/g, " ").trim().slice(0, 200) };
}

/** Inline code worth keeping for the model (§3.2): heredoc interpreters and `-e` one-liners. */
export const isInline = (command: string) => /\b(?:python3?|node|ruby|perl|tsx|deno)\s+(?:-\s*<<|-[ecp]\b|--eval\b)|<<-?\s*['"]?(?:PY|EOF|JS|NODE)\b/.test(command);

type ShellItem = { type?: unknown; callId?: unknown; status?: unknown; detail?: unknown };
export type RecordMeta = { taskId: string; agentId: string; lane: string; provider: string; at: string };

/** A timeline item's shell call as a log record, or null when it is not a finished shell call. */
export function shellRecord(item: ShellItem, meta: RecordMeta, ctx: RedactContext, scripts: ReadonlySet<string>): CommandRecord | null {
  if (item.type !== "tool_call" || !item.detail || typeof item.detail !== "object") return null;
  const detail = item.detail as { type?: unknown; command?: unknown };
  if (detail.type !== "shell" || typeof detail.command !== "string" || !detail.command.trim()) return null;
  if (item.status === "running") return null;
  const callId = typeof item.callId === "string" && item.callId ? item.callId : null;
  if (!callId) return null;
  const command = detail.command;
  const actions: string[] = [];
  const files: string[] = [];
  let explore = 0;
  for (const segment of splitChain(command)) {
    const r = classify(segment, ctx, scripts);
    if (r.kind === "explore") {
      explore++;
      for (const f of r.files) if (files.length < 4 && !files.includes(f)) files.push(f);
    } else if (r.kind === "action" && actions.length < 40) actions.push(r.key);
  }
  const status = item.status === "completed" ? "completed" : item.status === "failed" ? "failed" : "other";
  const clip = (text: string, max: number) => (text.length > max ? text.slice(0, max) + " …" : text);
  const compactText = (text: string) => redact(text, ctx).replace(/[ \t]+/g, " ");
  return {
    id: `${meta.agentId}:${callId}`.slice(0, 400),
    at: meta.at,
    taskId: meta.taskId,
    agentId: meta.agentId,
    lane: meta.lane.slice(0, 40),
    provider: meta.provider.slice(0, 80),
    status,
    actions,
    explore,
    ...(files.length ? { files } : {}),
    ...(isInline(command) ? { inline: clip(compactText(command), INLINE_CHARS) } : {}),
    ...(status === "failed" ? { failed: clip(compactText(command).replace(/\s+/g, " "), FAILED_CHARS) } : {}),
  };
}

/** The card's lane at an instant, replayed from its status changes; `fallback` when it never moved. */
export function laneAt(changes: readonly { at: string; from?: string; to?: string }[], at: number, fallback: string): string {
  let lane: string | undefined;
  for (const c of changes) {
    const t = Date.parse(c.at);
    if (t <= at) lane = c.to || lane;
    else {
      if (lane === undefined) lane = c.from;
      break;
    }
  }
  return lane || fallback;
}

// ---- Scheduling -------------------------------------------------------------

function hourIn(ms: number, tz: string | undefined): number {
  try {
    const h = new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", ...(tz ? { timeZone: tz } : {}) }).format(new Date(ms));
    return Number(h) % 24;
  } catch {
    return new Date(ms).getHours();
  }
}

/** Calendar days between two day keys. */
function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/**
 * Due when past `runHour` local time and at least `intervalDays` calendar days
 * after the last run (any outcome). Missed runs collapse into one (§4.1).
 */
export function isDue(input: { now: number; tz: string | undefined; runHour: number; intervalDays: number; lastRunAt: string | null }): boolean {
  if (hourIn(input.now, input.tz) < input.runHour) return false;
  if (!input.lastRunAt) return true;
  return daysBetween(dayKey(Date.parse(input.lastRunAt), input.tz), dayKey(input.now, input.tz)) >= input.intervalDays;
}

/** The first instant after `now` when the project becomes due (for display). */
export function nextRunAt(input: { now: number; tz: string | undefined; runHour: number; intervalDays: number; lastRunAt: string | null }): number {
  if (isDue(input)) return input.now;
  for (let step = 1; step <= 24 * 16; step++) {
    const t = Math.floor(input.now / 3_600_000) * 3_600_000 + step * 3_600_000;
    if (isDue({ ...input, now: t })) return t;
  }
  return input.now + input.intervalDays * DAY_MS;
}

// ---- Aggregation and material ------------------------------------------------

export type CardInfo = { id: string; title: string; type?: string; tags: readonly string[]; lane: string };

export type Aggregate = {
  calls: number;
  actions: number;
  explore: number;
  cards: number;
  sessions: number;
  keys: { key: string; runs: number; cards: number; sessions: number; failed: number; lane: string }[];
  sequences: { keys: string[]; sessions: number }[];
  files: { file: string; reads: number }[];
  failed: { card: string; text: string }[];
  inline: { card: string; text: string }[];
};

export const shortId = (id: string) => id.slice(0, 8);

/** Rule pass over the window's records (§4.2): counts, sequences, read files, samples. */
export function aggregate(records: readonly CommandRecord[]): Aggregate {
  const sorted = [...records].sort((a, b) => a.agentId.localeCompare(b.agentId) || a.at.localeCompare(b.at));
  const keys = new Map<string, { runs: number; cards: Set<string>; sessions: Set<string>; failed: number; lanes: Map<string, number> }>();
  const perSession = new Map<string, string[]>();
  const files = new Map<string, number>();
  let actions = 0,
    explore = 0;
  for (const r of sorted) {
    explore += r.explore;
    for (const f of r.files || []) files.set(f, (files.get(f) || 0) + 1);
    for (const key of r.actions) {
      actions++;
      let k = keys.get(key);
      if (!k) keys.set(key, (k = { runs: 0, cards: new Set(), sessions: new Set(), failed: 0, lanes: new Map() }));
      k.runs++;
      k.cards.add(r.taskId);
      k.sessions.add(r.agentId);
      if (r.status === "failed") k.failed++;
      k.lanes.set(r.lane, (k.lanes.get(r.lane) || 0) + 1);
    }
    if (r.actions.length) perSession.set(r.agentId, [...(perSession.get(r.agentId) || []), ...r.actions]);
  }
  const grams = new Map<string, number>();
  for (const raw of perSession.values()) {
    const seq = raw.filter((k, i) => k !== raw[i - 1]);
    const seen = new Set<string>();
    for (let len = 2; len <= 4; len++)
      for (let i = 0; i + len <= seq.length; i++) {
        const g = seq.slice(i, i + len);
        if (new Set(g).size !== len) continue;
        const id = g.join("\u0000");
        if (seen.has(id)) continue;
        seen.add(id);
        grams.set(id, (grams.get(id) || 0) + 1);
      }
  }
  const inline = new Map<string, { card: string; text: string }[]>();
  const seenInline = new Set<string>();
  for (const r of sorted) {
    if (!r.inline) continue;
    const sig = r.inline.slice(0, 240);
    if (seenInline.has(sig)) continue;
    seenInline.add(sig);
    const list = inline.get(r.taskId) || [];
    list.push({ card: shortId(r.taskId), text: r.inline });
    inline.set(r.taskId, list);
  }
  return {
    calls: records.length,
    actions,
    explore,
    cards: new Set(records.map((r) => r.taskId)).size,
    sessions: perSession.size || new Set(records.map((r) => r.agentId)).size,
    keys: [...keys]
      .map(([key, k]) => ({ key, runs: k.runs, cards: k.cards.size, sessions: k.sessions.size, failed: k.failed, lane: [...k.lanes].sort((a, b) => b[1] - a[1])[0]?.[0] || "" }))
      .sort((a, b) => b.runs - a.runs || a.key.localeCompare(b.key)),
    sequences: [...grams]
      .filter(([, n]) => n >= 3)
      .map(([id, n]) => ({ keys: id.split("\u0000"), sessions: n }))
      .sort((a, b) => b.sessions - a.sessions || b.keys.length - a.keys.length),
    files: [...files].map(([file, reads]) => ({ file, reads })).sort((a, b) => b.reads - a.reads),
    failed: sorted.filter((r) => r.failed).map((r) => ({ card: shortId(r.taskId), text: r.failed! })),
    inline: roundRobin([...inline.values()]),
  };
}

/** One item per card in turn, so a few long sessions do not crowd out the rest. */
function roundRobin<T>(queues: T[][]): T[] {
  const lists = queues.map((q) => [...q]);
  const out: T[] = [];
  while (lists.some((q) => q.length)) for (const q of lists) if (q.length) out.push(q.shift()!);
  return out;
}

/**
 * Skip the model when little happened since the last run (§4.1): fewer than
 * QUIET_ACTIONS new actions, or fewer than QUIET_CARDS cards in the window
 * unless BUSY_ACTIONS new actions make up for it.
 */
export function quiet(sinceLast: readonly CommandRecord[], windowCards: number): boolean {
  const actions = sinceLast.reduce((n, r) => n + r.actions.length, 0);
  return actions < QUIET_ACTIONS || (windowCards < QUIET_CARDS && actions < BUSY_ACTIONS);
}

export type ExistingConfig = { paseoScripts: string[]; paseoWorktree: string; packageScripts: Record<string, string>; commands: string };

/** The model's input, within MATERIAL_LIMIT: fewer inline and failed samples first (§4.2). */
export function buildMaterial(input: {
  days: number;
  agg: Aggregate;
  cards: readonly CardInfo[];
  config: ExistingConfig;
  previous: readonly { target: string; title: string; status: string; proposal?: string }[];
}): string {
  const { agg } = input;
  const head = [
    `# Window: last ${input.days} days · ${agg.sessions} sessions on ${agg.cards} cards`,
    `Shell calls ${agg.calls}; action segments ${agg.actions}; exploration segments ${agg.explore}.`,
    `\n# Cards (short id · title · type · tags · current lane)\n${input.cards.map((c) => `- ${shortId(c.id)} · ${c.title} · ${c.type || "untyped"} · ${c.tags.join(", ") || "-"} · ${c.lane}`).join("\n")}`,
    `\n# Existing project config\npaseo.json scripts: ${input.config.paseoScripts.length ? input.config.paseoScripts.join(", ") : "none"}\npaseo.json worktree: ${input.config.paseoWorktree || "none"}\npackage.json scripts: ${JSON.stringify(input.config.packageScripts)}\nAGENTS.md / CLAUDE.md commands:\n${input.config.commands || "(none)"}`,
    `\n# Action commands (normalized key · runs · cards · sessions · failed runs · main lane), top 60\n${agg.keys.slice(0, 60).map((k) => `- ${k.key} · ${k.runs} · ${k.cards} · ${k.sessions} · ${k.failed} · ${k.lane}`).join("\n")}`,
    `\n# Repeated sequences of action commands within a session (distinct sessions >= 3), top 25\n${agg.sequences.slice(0, 25).map((s) => `- ${s.sessions} sessions: ${s.keys.join(" → ")}`).join("\n") || "(none)"}`,
    `\n# Files most often inspected with grep/sed/head/cat, top 30\n${agg.files.slice(0, 30).map((f) => `- ${f.file} · ${f.reads}`).join("\n") || "(none)"}`,
    `\n# Suggestions the owner already accepted or dismissed (status · target: title — proposal); never propose them again\n${
      input.previous.map((p) => `- ${p.status} · ${p.target}: ${p.title}${p.proposal ? ` — ${p.proposal.replace(/\s+/g, " ").slice(0, 160)}` : ""}`).join("\n") || "(none)"
    }`,
  ].join("\n");
  const failedPart = (n: number) => `\n# Failed shell calls (${agg.failed.length}), redacted, up to ${n}\n${agg.failed.slice(0, n).map((f) => `[card ${f.card}] ${f.text}`).join("\n") || "(none)"}`;
  const inlinePart = (n: number) =>
    `\n# Inline scripts (python heredoc / node -e …), ${agg.inline.length} distinct, redacted and truncated, sampled across cards, up to ${n}\n${agg.inline.slice(0, n).map((s) => `[card ${s.card}] ${s.text}`).join("\n\n") || "(none)"}`;
  let inlineN = INLINE_SAMPLE,
    failedN = FAILED_SAMPLE;
  let text = head + failedPart(failedN) + inlinePart(inlineN);
  while (text.length > MATERIAL_LIMIT && (inlineN > 0 || failedN > 0)) {
    if (inlineN > 0) inlineN = Math.max(0, inlineN - 20);
    else failedN = Math.max(0, failedN - 10);
    text = head + failedPart(failedN) + inlinePart(inlineN);
  }
  return text.length > MATERIAL_LIMIT ? text.slice(0, MATERIAL_LIMIT) : text;
}

// ---- Model call ---------------------------------------------------------------

export const findingTargets = ["paseo_script", "worktree_setup", "repo_tool", "agents_md", "skill"] as const;
export type FindingTarget = (typeof findingTargets)[number];
export const confidences = ["high", "medium", "low"] as const;
export const findingLimits = { title: 120, evidence: 1000, proposal: 4000, benefit: 500 } as const;

export function workflowPrompt(days: number, material: string): string {
  return `You analyse how coding agents worked on one software project over the last ${days} days, from the shell commands they ran, so the project owner can turn repeated work into reusable project settings and tools.

Targets you may recommend:
- "paseo_script": an entry in paseo.json "scripts" ({ "<name>": { "type": "script" | "service", "command": "...", "port"?: number }}), runnable by humans and agents with \`paseo script start <name>\`.
- "worktree_setup": commands for paseo.json "worktree.setup" (run once when a new git worktree is created) or "worktree.teardown".
- "repo_tool": a new script or CLI in the repository (e.g. scripts/x.mjs plus an npm script) for work agents currently redo by hand with inline code.
- "agents_md": a rule or command to add to AGENTS.md so agents stop rediscovering it.
- "skill": a reusable agent skill or checklist for a multi-step routine that needs judgement.

Rules:
- Base every finding on evidence in the material; cite counts and card short ids (the 8-character ids in brackets). Do not invent commands.
- Do not recommend what already exists (package.json scripts, paseo.json, AGENTS.md commands) unless combining them saves real effort; say so explicitly.
- Never turn git write operations (add, commit, push, tag) or one-off exploration into scripts.
- For inline scripts, infer their purpose and cluster them; this is where most of the value is expected.
- At most ${MAX_FINDINGS} findings, the most valuable first. Mark confidence honestly.
- Suggestions the owner already accepted or dismissed are listed. Do not propose them again, even reworded or narrowed. This run's findings replace the open suggestions of earlier runs, so list everything still worth doing, not only what is new.
- Write titles and texts in the language most card titles use.
- Do not use any tools. Answer with only one JSON object and nothing else:
{"findings":[{"target":"paseo_script|worktree_setup|repo_tool|agents_md|skill","title":"short title","evidence":"counts and card short ids","proposal":"concrete snippet or interface","benefit":"what it saves","confidence":"high|medium|low","cards":["8-char ids"]}],"noise":"what in the material was noise","verdict":"one or two sentences"}

${material}`;
}

const finding = {
  type: "object",
  additionalProperties: false,
  required: ["target", "title", "evidence", "proposal", "benefit", "confidence", "cards"],
  properties: {
    target: { enum: [...findingTargets] },
    title: { type: "string" },
    evidence: { type: "string" },
    proposal: { type: "string" },
    benefit: { type: "string" },
    confidence: { enum: [...confidences] },
    cards: { type: "array", items: { type: "string" } },
  },
};
/** Passed as outputSchema, but Claude does not enforce it: parsing stays lenient. */
export const workflowJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["findings", "noise", "verdict"],
  properties: { findings: { type: "array", items: finding }, noise: { type: "string" }, verdict: { type: "string" } },
} as const;
export const RETRY_PROMPT = "Reply again with only the JSON object described above, and nothing else.";

export type RawFinding = { target: string; title: string; evidence: string; proposal: string; benefit: string; confidence: string; cards: string[] };

const text = (v: unknown) => (typeof v === "string" ? v.trim() : Array.isArray(v) ? v.filter((x) => typeof x === "string").join("\n").trim() : "");

/** The model's findings; null when the reply holds no JSON object (the caller retries once). */
export function parseWorkflowOutput(reply: string | null | undefined): { findings: RawFinding[]; verdict: string } | null {
  const json = reply ? firstObject(reply) : null;
  if (!json) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const list = Array.isArray(o.findings) ? o.findings : null;
  if (!list) return null;
  return {
    verdict: text(o.verdict),
    findings: list
      .filter((f): f is Record<string, unknown> => !!f && typeof f === "object")
      .map((f) => ({
        target: text(f.target).toLowerCase(),
        title: text(f.title),
        evidence: text(f.evidence),
        proposal: text(f.proposal),
        benefit: text(f.benefit),
        confidence: text(f.confidence).toLowerCase(),
        cards: (Array.isArray(f.cards) ? f.cards : []).filter((c): c is string => typeof c === "string").map((c) => c.trim()),
      })),
  };
}

/** Same target and same words: a repeat of an earlier suggestion. */
export function fingerprint(target: string, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[`"'“”‘’()[\]{}.,:;!?]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !["a", "an", "the", "and", "or", "for", "to", "of", "with", "in", "on"].includes(w))
    .join("-");
  return `${target}:${slug}`.slice(0, 300);
}

export const findingStatuses = ["open", "accepted", "dismissed"] as const;
export const findingSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  runId: z.string(),
  fingerprint: z.string().max(300),
  target: z.enum(findingTargets),
  title: z.string().max(findingLimits.title),
  evidence: z.string().max(findingLimits.evidence),
  proposal: z.string().max(findingLimits.proposal),
  benefit: z.string().max(findingLimits.benefit),
  confidence: z.enum(confidences),
  /** Full card ids, resolved from the model's short ids. */
  cards: z.array(z.string()).max(20),
  status: z.enum(findingStatuses),
  acceptedTaskId: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Finding = z.infer<typeof findingSchema>;
export type FindingDraft = Omit<Finding, "id" | "projectId" | "runId" | "status" | "createdAt" | "updatedAt">;

const STOP_WORDS = new Set("a an the and or for to of with in on by as is are be via into from one new add use".split(" "));
/** Words (ASCII) and character pairs (CJK): titles mix languages and get reworded. */
function titleGrams(title: string): Set<string> {
  const out = new Set<string>();
  const lower = title.toLowerCase();
  for (const w of lower.match(/[a-z0-9][a-z0-9._-]*/g) || []) {
    const word = w.replace(/[._-]+$/, "");
    if (word.length > 1 && !STOP_WORDS.has(word)) out.add(word);
  }
  for (const run of lower.match(/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]+/g) || []) for (let i = 0; i + 1 < run.length; i++) out.add(run.slice(i, i + 2));
  return out;
}
/** Jaccard similarity of two titles, 0..1. */
export function titleSimilarity(a: string, b: string): number {
  const x = titleGrams(a),
    y = titleGrams(b);
  let common = 0;
  for (const g of x) if (y.has(g)) common++;
  const union = x.size + y.size - common;
  return union ? common / union : 0;
}
/** A clearly reworded repeat (of a closed suggestion, or within one run). */
export function similarFinding(a: { target: string; title: string }, b: { target: string; title: string }): boolean {
  const sim = titleSimilarity(a.title, b.title);
  return sim >= SIMILAR_ANY_TARGET || (a.target === b.target && sim >= SIMILAR_SAME_TARGET);
}

/**
 * The daemon does not trust the model's ids or lengths (§4.4). Unknown cards are
 * dropped; a finding citing fewer than two known cards (one, when the window has
 * one card) or with over-long fields is dropped. A finding repeating an accepted
 * or recently dismissed suggestion (same fingerprint or a similar title) is
 * dropped, and so is one repeating an earlier finding of the same run.
 */
export function validateFindings(raw: readonly RawFinding[], ctx: { cardIds: readonly string[]; existing: readonly Finding[]; now: number }): FindingDraft[] {
  const byShort = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const id of ctx.cardIds) {
    const s = shortId(id);
    if (byShort.has(s) && byShort.get(s) !== id) ambiguous.add(s);
    byShort.set(s, id);
  }
  const minCards = Math.min(2, ctx.cardIds.length);
  // Open ones are replaced by this run; accepted ones and dismissed ones in their cooldown must not come back.
  const closed = ctx.existing.filter((f) => f.status === "accepted" || (f.status === "dismissed" && ctx.now - Date.parse(f.updatedAt) < DISMISS_COOLDOWN_DAYS * DAY_MS));
  const prints = new Set(closed.map((f) => f.fingerprint));
  const out: FindingDraft[] = [];
  for (const f of raw) {
    if (out.length >= MAX_FINDINGS) break;
    if (!(findingTargets as readonly string[]).includes(f.target)) continue;
    if (!f.title || !f.proposal) continue;
    if (f.title.length > findingLimits.title || f.evidence.length > findingLimits.evidence || f.proposal.length > findingLimits.proposal || f.benefit.length > findingLimits.benefit) continue;
    const cards = [
      ...new Set(
        f.cards
          .map((c) => c.replace(/^card\s+/i, "").slice(0, 8).toLowerCase())
          .filter((s) => byShort.has(s) && !ambiguous.has(s))
          .map((s) => byShort.get(s)!),
      ),
    ];
    if (!cards.length || cards.length < minCards) continue;
    const draft: FindingDraft = {
      fingerprint: fingerprint(f.target, f.title),
      target: f.target as FindingTarget,
      title: f.title,
      evidence: f.evidence,
      proposal: f.proposal,
      benefit: f.benefit,
      confidence: (confidences as readonly string[]).includes(f.confidence) ? (f.confidence as Finding["confidence"]) : "medium",
      cards: cards.slice(0, 20),
    };
    if (prints.has(draft.fingerprint) || closed.some((e) => similarFinding(draft, e)) || out.some((a) => similarFinding(draft, a))) continue;
    prints.add(draft.fingerprint);
    out.push(draft);
  }
  return out;
}

/** Replaces the project's open suggestions with a run's new ones (in place); returns how many were removed (§5.3). */
export function replaceOpen(findings: Finding[], projectId: string, added: readonly Finding[]): number {
  let removed = 0;
  for (let i = findings.length - 1; i >= 0; i--) {
    if (findings[i].projectId === projectId && findings[i].status === "open") {
      findings.splice(i, 1);
      removed++;
    }
  }
  findings.push(...added);
  return removed;
}

// ---- Stored state and views ----------------------------------------------------

export const usageSchema = z.object({
  inputTokens: z.number().optional(),
  cachedInputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  totalCostUsd: z.number().optional(),
  /** What the run's context held at the end: the honest "tokens in" for one long turn. */
  contextTokens: z.number().optional(),
});
/** Tokens read for the run: the context it filled, else the reported input. */
export const usageIn = (u: RunUsage | undefined) => (u ? Math.max(u.contextTokens ?? 0, (u.inputTokens ?? 0) + (u.cachedInputTokens ?? 0)) : 0);
export type RunUsage = z.infer<typeof usageSchema>;
export const runSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  at: z.string(),
  from: z.string(),
  to: z.string(),
  model: z.string(),
  manual: z.boolean(),
  status: z.enum(["ok", "skipped", "error"]),
  reason: z.string().max(500).optional(),
  usage: usageSchema.optional(),
  findings: z.number().int().min(0).default(0),
  /** Open suggestions of earlier runs this run replaced (§5.3). */
  replaced: z.number().int().min(0).default(0),
  stats: z.object({ calls: z.number(), actions: z.number(), cards: z.number(), sessions: z.number() }),
});
export type WorkflowRun = z.infer<typeof runSchema>;
export const workflowStateSchema = z.object({
  version: z.literal(1),
  revision: z.number().int().min(0),
  runs: z.array(runSchema),
  findings: z.array(findingSchema),
});
export type WorkflowState = z.infer<typeof workflowStateSchema>;
export const emptyWorkflowState = (): WorkflowState => ({ version: 1, revision: 0, runs: [], findings: [] });

/** Keep the newest runs per project, open findings always, closed ones for CLOSED_KEPT_DAYS. */
export function trimState(state: WorkflowState, now: number) {
  const byProject = new Map<string, WorkflowRun[]>();
  for (const r of state.runs) byProject.set(r.projectId, [...(byProject.get(r.projectId) || []), r]);
  const keep = new Set<WorkflowRun>();
  for (const list of byProject.values()) for (const r of [...list].sort((a, b) => b.at.localeCompare(a.at)).slice(0, RUNS_KEPT)) keep.add(r);
  state.runs = state.runs.filter((r) => keep.has(r));
  state.findings = state.findings.filter((f) => f.status === "open" || now - Date.parse(f.updatedAt) < CLOSED_KEPT_DAYS * DAY_MS);
}

export const workflowViewSchema = z.object({
  enabled: z.boolean(),
  projectEnabled: z.boolean(),
  backfilling: z.boolean(),
  running: z.boolean(),
  nextRunAt: z.string().nullable(),
  windowDays: z.number(),
  lastRun: runSchema.nullable(),
  findings: z.array(findingSchema),
  revision: z.number(),
});
export type WorkflowView = z.infer<typeof workflowViewSchema>;

export const workflowOverviewSchema = z.object({
  lastRun: runSchema.nullable(),
  /** Projects with a command log on disk. */
  collected: z.number(),
  /** One cycle's cost: the latest run of each included project with a cost, summed (§2.3). */
  cycleCostUsd: z.number().nullable(),
  /** How many projects that sum covers. */
  costProjects: z.number(),
});

// ---- Project scripts for agents (§5.4) -------------------------------------------

/** Script names and types from a paseo.json text; [] when there are none or it does not parse. */
export function projectScriptsFrom(json: string): { name: string; type: "script" | "service" }[] {
  try {
    const raw = JSON.parse(json) as { scripts?: Record<string, { type?: unknown }> };
    if (!raw || typeof raw !== "object" || !raw.scripts || typeof raw.scripts !== "object") return [];
    return Object.entries(raw.scripts)
      .filter(([name]) => /^[\w.:-]{1,80}$/.test(name))
      .slice(0, PROJECT_SCRIPTS_MAX)
      .map(([name, entry]) => ({ name, type: entry && typeof entry === "object" && entry.type === "script" ? "script" : "service" }));
  } catch {
    return [];
  }
}

/** The new card's description: the model's proposal, its evidence, and how to land it (§5.2). */
export function findingDescription(f: Pick<Finding, "target" | "proposal" | "evidence" | "benefit">, cardTitles: readonly string[]): string {
  const landing: Record<FindingTarget, string> = {
    paseo_script:
      "Add it to paseo.json at the project root, run it once with `paseo script start <name>`, and commit it.",
    worktree_setup:
      "Add it to paseo.json at the project root, create a worktree to test the setup, and commit it: worktree setup only reads the committed paseo.json.",
    repo_tool: "Add the tool, mention it in AGENTS.md Commands, and replace one real use to prove it works.",
    agents_md: "Write it into AGENTS.md, then check it against the cited cards.",
    skill: "Write the skill or checklist, then check it against the cited cards.",
  };
  return [
    f.proposal,
    f.benefit ? `Benefit: ${f.benefit}` : "",
    f.evidence ? `Evidence: ${f.evidence}` : "",
    cardTitles.length ? `Cards: ${cardTitles.join("; ")}` : "",
    `How to land it: ${landing[f.target]}`,
    "Suggested by Flowly workflow insights.",
  ]
    .filter(Boolean)
    .join("\n\n");
}
