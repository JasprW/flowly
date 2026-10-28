import { reviewRuleSchema, type ReviewRule } from "./model";
import { GOAL_ID, ruleId, ruleSummary } from "./auto-review";

/**
 * Deliveries and rework after delivery (AUTO-REVIEW-SPEC §6.2, §7.1), counted by the daemon from the flow log.
 * A rework is a turn a person's message started while the card was in In review (A1 from in_review) that was not
 * restored by A1r: "commit and push" turns that report no work do not count.
 */
export type FlowLike = { at: string; taskId: string; action: string; actor: string; from?: string; to?: string; rule?: string };
/** A rework turn: from its A1 to the card's next turn start (`until`), or still open (`until` empty). */
export type ReworkTurn = { taskId: string; at: string; until: string };
export type DeliveryStats = {
  /** Agent deliveries to In review in the window. */
  deliveries: number;
  /** Cards delivered in the window, newest delivery first. */
  delivered: string[];
  /** Of those, the cards reworked after a delivery, with each rework turn. */
  reworked: Map<string, ReworkTurn[]>;
};

export const ANALYSIS_DAYS = 90;
export const ANALYSIS_MIN_DELIVERIES = 5;
export const NUDGE_DAYS = 14;
export const NUDGE_MIN_REWORKED = 3;
export const NUDGE_SNOOZE_DAYS = 30;
const DAY = 86_400_000;

export function deliveryStats(entries: readonly FlowLike[], from: number, to: number): DeliveryStats {
  const sorted = [...entries].sort((a, b) => a.at.localeCompare(b.at));
  const inWindow = (at: string) => {
    const t = Date.parse(at);
    return t >= from && t <= to;
  };
  let deliveries = 0;
  const lastDelivery = new Map<string, string>();
  for (const e of sorted)
    if (e.action === "status_changed" && e.actor === "agent" && e.to === "in_review" && inWindow(e.at)) {
      deliveries++;
      lastDelivery.set(e.taskId, e.at);
    }
  const reworked = new Map<string, ReworkTurn[]>();
  sorted.forEach((e, i) => {
    if (!(e.action === "status_changed" && e.rule === "A1" && e.from === "in_review" && inWindow(e.at) && lastDelivery.has(e.taskId))) return;
    let restored = false,
      ended = false,
      until = "";
    for (let j = i + 1; j < sorted.length; j++) {
      const n = sorted[j];
      if (n.taskId !== e.taskId) continue;
      if (n.action === "status_changed" && n.rule === "A1r") {
        restored = true;
        break;
      }
      if (n.action === "agent.turn_ended") ended = true;
      // The next turn starts after this one ended; the rework turn's own start can sit a moment either side of A1.
      if ((ended && n.action === "agent.turn_started") || (n.action === "status_changed" && n.rule === "A1")) {
        until = n.at;
        break;
      }
    }
    if (restored) return;
    const list = reworked.get(e.taskId) || [];
    list.push({ taskId: e.taskId, at: e.at, until });
    reworked.set(e.taskId, list);
  });
  const delivered = [...lastDelivery].sort((a, b) => b[1].localeCompare(a[1])).map(([id]) => id);
  return { deliveries, delivered, reworked };
}

export const windowFrom = (now: number, days: number) => now - days * DAY;

/**
 * The user's words in a card's rework turns (§6.2, §7.1): memory clues of kind feedback or message from the turn's A1 up
 * to the card's next turn start. Memory writes its clues just after the turn ends, so the turn end is no bound.
 */
export function reworkQuotes(clues: readonly { taskId: string; kind: string; text: string; at: string }[], taskId: string, turns: readonly ReworkTurn[]): string[] {
  return clues
    .filter((c) => c.taskId === taskId && (c.kind === "feedback" || c.kind === "message") && turns.some((r) => c.at >= r.at && (!r.until || c.at < r.until)))
    .map((c) => c.text);
}
export const short = (id: string) => id.slice(0, 8);

// ---- History analysis (§6.2) ------------------------------------------------------------------

export const analysisLimits = { material: 100_000, recap: 400, quotesPerCard: 3, quote: 400, commands: 4000, checks: 6, reasons: 6, why: 300 } as const;

export type AnalysisMaterial = {
  cards: { id: string; title: string; type?: string; tags: string[]; recap: string; reworked: boolean; quotes: string[] }[];
  memoryOn: boolean;
  workpadCommands: { command: string; cards: number }[];
  detected: string[];
  agentsCommands: string;
  rules: ReviewRule[];
};

export function analysisMaterial(m: AnalysisMaterial): string {
  const card = (c: AnalysisMaterial["cards"][number]) =>
    `- ${short(c.id)} · ${c.title} · ${c.type || "untyped"} · ${c.tags.join(", ") || "-"} · ${c.reworked ? "REWORKED after delivery" : "accepted as delivered"}` +
    (c.recap ? `\n  recap: ${c.recap.replace(/\s+/g, " ").slice(0, analysisLimits.recap)}` : "") +
    (c.reworked
      ? `\n  the user's words in the rework turn: ${m.memoryOn ? (c.quotes.length ? c.quotes.map((q) => `「${q.slice(0, analysisLimits.quote)}」`).join(" ") : "(none recorded)") : "(memory off)"}`
      : "");
  const rest = [
    `\n# Check commands seen in workpads (command · cards)\n${m.workpadCommands.map((c) => `- ${c.command} · ${c.cards}`).join("\n") || "(none)"}`,
    `\n# Commands detected from the repository\n${m.detected.map((c) => `- ${c}`).join("\n") || "(none)"}`,
    `\n# AGENTS.md / CLAUDE.md commands\n${m.agentsCommands.slice(0, analysisLimits.commands) || "(none)"}`,
    `\n# Current rules (besides the built-in check "Does what you asked", which judges each delivery against the card and what the user said)\n${m.rules.map((r) => `- ${r.id} · ${r.name} · ${ruleSummary(r)}`).join("\n") || "(none)"}`,
  ].join("\n");
  const build = (cards: AnalysisMaterial["cards"]) => `# Cards delivered in the last ${ANALYSIS_DAYS} days (short id · title · type · tags · outcome)\n${cards.map(card).join("\n")}${rest}`;
  // Over the limit: drop the oldest card accepted as delivered first, then the oldest of any.
  const cards = [...m.cards];
  let text = build(cards);
  while (text.length > analysisLimits.material && cards.length) {
    const i = cards.map((c) => c.reworked).lastIndexOf(false);
    cards.splice(i >= 0 ? i : cards.length - 1, 1);
    text = build(cards);
  }
  return text.slice(0, analysisLimits.material);
}

export function analysisPrompt(material: string): string {
  return `You review how one software project's coding agents did over the last ${ANALYSIS_DAYS} days. Some cards were reworked after delivery: the owner sent the agent back to change something. Find why, and propose automatic checks Flowly runs on every delivery so those problems are caught before the owner sees the card.

Rules:
- Group the reasons for rework after delivery. Each reason lists the reworked cards it explains (8-character short ids) and, when there is one, a short quote of the owner's words.
- Propose a check only for a reason that would have prevented rework on at least 2 cards.
- What an exit code can decide becomes a command check, preferably an existing repository script: {"id": "lowercase-slug", "name": "short name", "kind": "command", "argv": ["npm", "run", "typecheck"]}. Never a shell string; argv is an argument array.
- Everything else becomes one concrete LLM check a reviewer can judge from the diff and the card: {"id", "name", "kind": "llm", "prompt": "one sentence: what must be true"}. Optional "types": ["feature","bugfix","refactor","chore","docs","research"] limits a check to those card types.
- Do not repeat the built-in check (it already judges whether the change does what the user asked) or a current rule.
- At most ${analysisLimits.checks} checks and ${analysisLimits.reasons} reasons. "why": one sentence, at most ${analysisLimits.why} characters.
- Do not use any tools. Answer with only one JSON object:
{"reasons":[{"title":"…","cards":["8-char ids"],"quote":"…"}],"checks":[{"rule":{…},"cards":["8-char ids"],"why":"…"}]}

${material}`;
}

export const analysisJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["reasons", "checks"],
  properties: {
    reasons: {
      type: "array",
      items: { type: "object", required: ["title", "cards"], properties: { title: { type: "string" }, cards: { type: "array", items: { type: "string" } }, quote: { type: "string" } } },
    },
    checks: {
      type: "array",
      items: { type: "object", required: ["rule", "cards", "why"], properties: { rule: { type: "object" }, cards: { type: "array", items: { type: "string" } }, why: { type: "string" } } },
    },
  },
} as const;

export type RawAnalysis = { reasons: { title: string; cards: string[]; quote?: string }[]; checks: { rule: unknown; cards: string[]; why: string }[] };

/** Lenient: the first JSON object of the reply; null when there is none. */
export function parseAnalysis(reply: string | null | undefined): RawAnalysis | null {
  if (!reply) return null;
  const start = reply.indexOf("{"),
    end = reply.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(reply.slice(start, end + 1));
  } catch {
    return null;
  }
  const o = raw as { reasons?: unknown; checks?: unknown };
  if (!o || typeof o !== "object") return null;
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : []);
  const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.trim()) : []);
  return {
    reasons: list(o.reasons).map((r) => ({ title: typeof r.title === "string" ? r.title.trim() : "", cards: ids(r.cards), ...(typeof r.quote === "string" && r.quote.trim() ? { quote: r.quote.trim() } : {}) })),
    checks: list(o.checks).map((c) => ({ rule: c.rule, cards: ids(c.cards), why: typeof c.why === "string" ? c.why.trim() : "" })),
  };
}

export type ValidAnalysis = {
  reasons: { title: string; cards: string[]; quote?: string }[];
  checks: { rule: ReviewRule; cards: string[]; why: string }[];
};

/**
 * The daemon does not trust the model (§6.2): cards must be in the material and reasons must cite reworked cards;
 * entries resting on fewer than 2 cards are dropped; a rule must be valid as a whole (never truncated) and its id is
 * renumbered when it collides with an existing rule or the built-in check.
 */
export function validateAnalysis(raw: RawAnalysis, ctx: { cards: readonly string[]; reworked: ReadonlySet<string>; existing: readonly ReviewRule[] }): ValidAnalysis {
  const byShort = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const id of ctx.cards) {
    const s = short(id);
    if (byShort.has(s) && byShort.get(s) !== id) ambiguous.add(s);
    byShort.set(s, id);
  }
  const resolve = (list: readonly string[]) => [
    ...new Set(
      list
        .map((c) => c.replace(/^#/, "").slice(0, 8).toLowerCase())
        .filter((s) => byShort.has(s) && !ambiguous.has(s))
        .map((s) => byShort.get(s)!),
    ),
  ];
  const reasons: ValidAnalysis["reasons"] = [];
  for (const r of raw.reasons) {
    if (reasons.length >= analysisLimits.reasons) break;
    const cards = resolve(r.cards).filter((id) => ctx.reworked.has(id));
    if (!r.title || r.title.length > 200 || cards.length < 2) continue;
    reasons.push({ title: r.title, cards, ...(r.quote ? { quote: r.quote.slice(0, 400) } : {}) });
  }
  const taken = new Set<string>([GOAL_ID, ...ctx.existing.map((r) => r.id)]);
  const checks: ValidAnalysis["checks"] = [];
  for (const c of raw.checks) {
    if (checks.length >= analysisLimits.checks) break;
    const cards = resolve(c.cards);
    if (cards.length < 2 || !c.why || c.why.length > analysisLimits.why || !c.rule || typeof c.rule !== "object") continue;
    const candidate = { ...(c.rule as Record<string, unknown>) };
    const id = typeof candidate.id === "string" ? candidate.id : "";
    candidate.id = ruleId(id || String(candidate.name || "check"), taken);
    const parsed = reviewRuleSchema.safeParse(candidate);
    if (!parsed.success) continue;
    taken.add(parsed.data.id);
    checks.push({ rule: parsed.data, cards, why: c.why });
  }
  return { reasons, checks };
}

// ---- Insights (§7) ----------------------------------------------------------------------------

/** How each check fared in review_finished events since `from`: judged (passed, failed, not applicable) and failed. */
export function checkCounts(entries: readonly (FlowLike & { results?: readonly { id: string; state: string }[] })[], from: number) {
  const counts = new Map<string, { judged: number; failed: number }>();
  for (const e of entries) {
    if (e.action !== "review_finished" || !e.results || Date.parse(e.at) < from) continue;
    for (const r of e.results) {
      if (r.state !== "passed" && r.state !== "failed" && r.state !== "na") continue;
      const c = counts.get(r.id) || { judged: 0, failed: 0 };
      c.judged++;
      if (r.state === "failed") c.failed++;
      counts.set(r.id, c);
    }
  }
  return counts;
}

/** LLM rules (never the built-in check) judged at least 20 times without one failure: worth pausing to save tokens. */
export function pauseCandidates(rules: readonly ReviewRule[], counts: ReadonlyMap<string, { judged: number; failed: number }>, min: number) {
  return rules.filter((r) => r.kind === "llm" && !r.off && r.id !== GOAL_ID).flatMap((r) => {
    const c = counts.get(r.id);
    return c && c.judged >= min && c.failed === 0 ? [{ rule: r, judged: c.judged }] : [];
  });
}

/** The material's "# Auto review" section for the Insights run (§7.2). */
export function reviewInsightsMaterial(input: {
  rules: readonly ReviewRule[];
  counts: ReadonlyMap<string, { judged: number; failed: number }>;
  reworked: readonly { id: string; title: string; quotes: readonly string[] }[];
}): string {
  const lines = [
    "\n# Auto review",
    'Current rules (besides the built-in check "Does what you asked"), with reviews and failures in the window:',
    ...(input.rules.length
      ? input.rules.map((r) => {
          const c = input.counts.get(r.id);
          return `- ${r.id} · ${r.name} · ${r.kind === "command" ? r.argv.join(" ") : r.prompt.split("\n")[0]}${r.off ? " · paused" : ""} · ${c ? `${c.judged} reviews, ${c.failed} failed` : "not run"}`;
        })
      : ["(none)"]),
    "Cards the owner sent back after delivery, with the owner's words in that turn:",
    ...(input.reworked.length ? input.reworked.map((c) => `- ${short(c.id)} · ${c.title}${c.quotes.length ? ` · ${c.quotes.map((q) => `「${q}」`).join(" ")}` : ""}`) : ["(none)"]),
  ];
  return lines.join("\n");
}
