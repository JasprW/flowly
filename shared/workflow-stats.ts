import { z } from "zod";
import { isWorkStatus } from "./model";
import { addDays, dayKey, dayStart, insightSchema, type FlowEntry, type Insight, type TaskHistory } from "./insights";
import { insightsWithHabitsSchema } from "./agent-habits";
import { TOKEN_SLOT_MS, addUsage, cacheHitRate, totalTokens, zeroUsage, type TokenUsage } from "./usage";

/**
 * Workflow statistics (INSIGHTS-REDESIGN-SPEC §3): how much attention a card takes,
 * how many review rounds, where its time goes and what it costs, by week against
 * the project's own past. Pure: the daemon passes the replayed histories.
 */

export const WINDOW_DAYS = 7;
/** Earlier windows pooled into the baseline. */
export const BASELINE_WINDOWS = 4;
export const TREND_WEEKS = 8;
/** Below this many finished cards a window or week is shown faded; a model row merges into "other". */
export const MIN_CARDS = 3;
/** Share of turns that must carry `byUser` before messages (and so attention) are shown. */
export const MIN_COVERAGE = 0.8;
/** Rules kept as workflow anomalies (§3.7). */
export const ANOMALY_RULES = ["R2", "R3", "R6"] as const;
export const TOP_SOURCES = 3;

const ms = (iso: string) => Date.parse(iso);

/** One finished card, counted from its creation to its first Done (§3.0). */
export type CardStat = {
  taskId: string;
  createdAt: number;
  /** First entry into a work lane (creation when it never had one). */
  start: number;
  finishedAt: number;
  turns: number;
  /** Turns that carry `byUser`, and those that are true. */
  known: number;
  messages: number;
  permissions: number;
  moves: number;
  questions: number;
  rounds: number;
  working: number;
  waiting: number;
  idle: number;
  model: string;
};

// ---- Interval arithmetic ---------------------------------------------------------

type Span = [number, number];
function union(spans: readonly Span[]): Span[] {
  const sorted = spans.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out: Span[] = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}
const length = (spans: readonly Span[]) => union(spans).reduce((n, [a, b]) => n + (b - a), 0);
const clip = (spans: readonly Span[], from: number, to: number): Span[] =>
  spans.map(([a, b]) => [Math.max(a, from), Math.min(b, to)] as Span).filter(([a, b]) => b > a);

// ---- Per card --------------------------------------------------------------------

const isRound = (e: FlowEntry) =>
  e.action === "status_changed" && e.from === "in_review" && !!e.to && e.to !== "done" && e.to !== "cancelled" && e.to !== "in_review";

export function cardStats(input: {
  histories: readonly TaskHistory[];
  /** Run intervals of each session. */
  sessions: readonly { agentId: string; start: number; end: number }[];
  /** A session's current model for turns that carry none (WORKFLOW-INSIGHTS-SPEC §12.5). */
  modelOf?(agentId: string): string | undefined;
}): CardStat[] {
  const runs = new Map<string, Span[]>();
  for (const s of input.sessions) {
    const list = runs.get(s.agentId);
    if (list) list.push([s.start, s.end]);
    else runs.set(s.agentId, [[s.start, s.end]]);
  }
  const out: CardStat[] = [];
  for (const h of input.histories) {
    if (h.incomplete) continue;
    const doneEntry = h.entries.find((e) => e.action === "status_changed" && e.to === "done");
    if (!doneEntry) continue;
    const createdAt = ms(h.task.createdAt);
    const finishedAt = ms(doneEntry.at);
    const life = h.entries.filter((e) => ms(e.at) <= finishedAt);
    const firstWork = h.intervals.find((iv) => isWorkStatus(iv.status) && iv.start < finishedAt);
    const start = Math.min(finishedAt, firstWork ? firstWork.start : createdAt);
    const ended = life.filter((e) => e.action === "agent.turn_ended");
    const agents = new Set(h.entries.map((e) => e.agentId).filter((id): id is string => !!id));
    const working = union(clip([...agents].flatMap((id) => runs.get(id) || []), start, finishedAt));
    // Waiting: in review or blocked, or a question reported and the next turn not yet started.
    const waitingSpans: Span[] = h.intervals
      .filter((iv) => iv.status === "in_review" || iv.status === "blocked")
      .map((iv) => [iv.start, iv.end] as Span);
    const starts = h.entries.filter((e) => e.action === "agent.turn_started").map((e) => ms(e.at));
    for (const q of life.filter((e) => e.reportKind === "question")) {
      const at = ms(q.at);
      const next = starts.find((s) => s > at);
      waitingSpans.push([at, next ?? finishedAt]);
    }
    const waitingClipped = clip(waitingSpans, start, finishedAt);
    const busy = length([...working, ...waitingClipped]);
    const workMs = length(working);
    // Model: the one most turns ran on.
    const counts = new Map<string, number>();
    for (const e of ended) {
      const model = e.model || (e.agentId ? input.modelOf?.(e.agentId) : undefined) || "";
      if (model) counts.set(model, (counts.get(model) || 0) + 1);
    }
    const model = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? "";
    out.push({
      taskId: h.task.id,
      createdAt,
      start,
      finishedAt,
      turns: ended.length,
      known: ended.filter((e) => typeof e.byUser === "boolean").length,
      messages: ended.filter((e) => e.byUser === true).length,
      permissions: life.filter((e) => e.action === "agent.permission_requested").length,
      moves: life.filter((e) => e.action === "status_changed" && e.actor === "human").length,
      questions: life.filter((e) => e.reportKind === "question").length,
      rounds: life.filter(isRound).length,
      working: workMs,
      waiting: busy - workMs,
      idle: Math.max(0, finishedAt - start - busy),
      model,
    });
  }
  return out;
}

// ---- Aggregates ------------------------------------------------------------------

/** Nearest-rank quantile; the median averages the middle pair. */
export function quantile(values: readonly number[], q: number): number | null {
  if (!values.length) return null;
  const s = values.slice().sort((a, b) => a - b);
  if (q === 0.5) {
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)];
}
const median = (values: readonly number[]) => quantile(values, 0.5);

const num = z.number();
const nullable = num.nullable();
const groupSchema = z.object({
  finished: z.number().int(),
  /** Share of the cards' turns that carry `byUser`; attention is null below MIN_COVERAGE. */
  coverage: nullable,
  attention: nullable,
  attentionP75: nullable,
  messages: nullable,
  permissions: nullable,
  moves: nullable,
  questions: nullable,
  rounds: nullable,
  roundsP75: nullable,
  onePass: z.number().int(),
  onePassShare: nullable,
});
export type Group = z.infer<typeof groupSchema>;

export function group(cards: readonly CardStat[]): Group {
  const turns = cards.reduce((n, c) => n + c.turns, 0);
  const known = cards.reduce((n, c) => n + c.known, 0);
  const coverage = turns ? known / turns : cards.length ? 1 : null;
  const attentionOk = coverage !== null && coverage >= MIN_COVERAGE;
  const attention = cards.map((c) => c.messages + c.permissions + c.moves);
  const onePass = cards.filter((c) => c.rounds === 0).length;
  return {
    finished: cards.length,
    coverage,
    attention: attentionOk ? median(attention) : null,
    attentionP75: attentionOk ? quantile(attention, 0.75) : null,
    messages: attentionOk ? median(cards.map((c) => c.messages)) : null,
    permissions: median(cards.map((c) => c.permissions)),
    moves: median(cards.map((c) => c.moves)),
    questions: median(cards.map((c) => c.questions)),
    rounds: median(cards.map((c) => c.rounds)),
    roundsP75: quantile(cards.map((c) => c.rounds), 0.75),
    onePass,
    onePassShare: cards.length ? onePass / cards.length : null,
  };
}

/** Monday of the day's week. */
export function weekOf(day: string): string {
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
  return addDays(day, -((dow + 6) % 7));
}

export const workflowStatsSchema = z.object({
  window: z.object({ from: z.string(), to: z.string(), current: z.boolean() }),
  /** Cards left out because their early history was cut. */
  incomplete: z.number().int(),
  now: groupSchema,
  baseline: groupSchema,
  time: z.object({
    working: num,
    waiting: num,
    idle: num,
    /** Median active span (first work lane → first Done) per card. */
    activeMedian: nullable,
    topTools: z.array(z.object({ tool: z.string(), count: z.number().int() })),
    topAskers: z.array(z.object({ taskId: z.string(), count: z.number().int() })),
  }),
  quality: z.object({ turns: z.number().int(), failed: z.number().int(), failedShare: nullable, reopened: z.number().int() }),
  agentMs: nullable,
  models: z.array(groupSchema.extend({ model: z.string() })),
  weeks: z.array(groupSchema.extend({ week: z.string(), partial: z.boolean(), landed: z.array(z.string()) })),
  anomalies: z.array(insightSchema),
  /** First day a turn carried `byUser`, for the footnote (§7.3). */
  byUserSince: z.string().nullable(),
  /** Card ids per bucket, so the token reader can sum each card's active span. */
  cards: z.array(z.object({ taskId: z.string(), start: z.number(), finishedAt: z.number(), inWindow: z.boolean(), week: z.string().nullable() })),
});
export type WorkflowStats = z.infer<typeof workflowStatsSchema>;

export function workflowStats(input: {
  cards: readonly CardStat[];
  entries: readonly FlowEntry[];
  incomplete: number;
  /** Last day of the window. */
  end: string;
  today: string;
  tz: string | undefined;
  now: number;
  /** Accepted workflow-insight findings with the card that carried them out (§3.6). */
  landed: readonly { taskId: string; title: string }[];
  insights: readonly Insight[];
}): WorkflowStats {
  const { tz, end } = input;
  const from = addDays(end, 1 - WINDOW_DAYS);
  const start = dayStart(from, tz),
    stop = Math.min(input.now, dayStart(addDays(end, 1), tz));
  const baseStart = dayStart(addDays(from, -WINDOW_DAYS * BASELINE_WINDOWS), tz);
  const inside = (t: number, a: number, b: number) => t >= a && t < b;
  const windowCards = input.cards.filter((c) => inside(c.finishedAt, start, stop));
  const baseCards = input.cards.filter((c) => inside(c.finishedAt, baseStart, start));

  const windowEntries = input.entries.filter((e) => inside(ms(e.at), start, stop));
  const tools = new Map<string, number>();
  for (const e of windowEntries) if (e.action === "agent.permission_requested" && e.tool) tools.set(e.tool, (tools.get(e.tool) || 0) + 1);
  const askers = new Map<string, number>();
  for (const e of windowEntries) if (e.reportKind === "question") askers.set(e.taskId, (askers.get(e.taskId) || 0) + 1);
  const ended = windowEntries.filter((e) => e.action === "agent.turn_ended");
  const failed = ended.filter((e) => e.outcome === "failed").length;

  const byModel = new Map<string, CardStat[]>();
  for (const c of windowCards) {
    const list = byModel.get(c.model);
    if (list) list.push(c);
    else byModel.set(c.model, [c]);
  }
  const other: CardStat[] = [];
  const models: WorkflowStats["models"] = [];
  for (const [model, list] of byModel) {
    if (!model || list.length < MIN_CARDS) other.push(...list);
    else models.push({ model, ...group(list) });
  }
  models.sort((a, b) => b.finished - a.finished || a.model.localeCompare(b.model));
  if (other.length && models.length) models.push({ model: "", ...group(other) });

  const thisWeek = weekOf(input.today);
  const weekKeys = Array.from({ length: TREND_WEEKS }, (_, i) => addDays(thisWeek, -7 * (TREND_WEEKS - 1 - i)));
  const weekOfCard = (c: CardStat) => weekOf(dayKey(c.finishedAt, tz));
  const landedBy = new Map<string, string[]>();
  for (const l of input.landed) {
    const card = input.cards.find((c) => c.taskId === l.taskId);
    if (!card) continue;
    const w = weekOfCard(card);
    landedBy.set(w, [...(landedBy.get(w) || []), l.title]);
  }
  const weeks = weekKeys
    .map((week) => ({ week, partial: week === thisWeek, landed: landedBy.get(week) || [], ...group(input.cards.filter((c) => weekOfCard(c) === week)) }))
    .reverse();
  // Weeks before the first finished card are noise (a young project): drop them, keep this week.
  while (weeks.length > 1 && !weeks[weeks.length - 1].finished) weeks.pop();

  const firstByUser = input.entries.filter((e) => typeof e.byUser === "boolean").sort((a, b) => a.at.localeCompare(b.at))[0];
  const weekSet = new Set(weekKeys);
  return {
    window: { from, to: end, current: end >= input.today },
    incomplete: input.incomplete,
    now: group(windowCards),
    baseline: group(baseCards),
    time: {
      working: windowCards.reduce((n, c) => n + c.working, 0),
      waiting: windowCards.reduce((n, c) => n + c.waiting, 0),
      idle: windowCards.reduce((n, c) => n + c.idle, 0),
      activeMedian: median(windowCards.map((c) => c.finishedAt - c.start)),
      topTools: [...tools].map(([tool, count]) => ({ tool, count })).sort((a, b) => b.count - a.count || a.tool.localeCompare(b.tool)).slice(0, TOP_SOURCES),
      topAskers: [...askers].map(([taskId, count]) => ({ taskId, count })).sort((a, b) => b.count - a.count || a.taskId.localeCompare(b.taskId)).slice(0, TOP_SOURCES),
    },
    quality: {
      turns: ended.length,
      failed,
      failedShare: ended.length ? failed / ended.length : null,
      reopened: windowEntries.filter((e) => e.action === "status_changed" && (e.from === "done" || e.from === "cancelled") && e.to !== "done" && e.to !== "cancelled").length,
    },
    agentMs: median(windowCards.map((c) => c.working)),
    models,
    weeks,
    anomalies: end >= input.today ? input.insights.filter((i) => (ANOMALY_RULES as readonly string[]).includes(i.rule)) : [],
    byUserSince: firstByUser ? dayKey(ms(firstByUser.at), tz) : null,
    cards: input.cards
      .filter((c) => inside(c.finishedAt, start, stop) || weekSet.has(weekOfCard(c)))
      .map((c) => ({ taskId: c.taskId, start: c.start, finishedAt: c.finishedAt, inWindow: inside(c.finishedAt, start, stop), week: weekSet.has(weekOfCard(c)) ? weekOfCard(c) : null })),
  };
}

/** `insights.project` value (INSIGHTS-REDESIGN-SPEC §8). */
export const insightsViewSchema = insightsWithHabitsSchema.extend({ workflow: workflowStatsSchema });
export type InsightsView = z.infer<typeof insightsViewSchema>;

/** A digest headline for the daily record (`insights.digests`). */
export const digestHeadlineSchema = z.object({ day: z.string(), headline: z.string(), at: z.string() });
export type DigestHeadline = z.infer<typeof digestHeadlineSchema>;

// ---- Tokens per finished card (§3.4) ---------------------------------------------

export const cardTokensSchema = z.object({
  /** Window: median tokens per finished card and the cache hit rate over them. */
  perCard: nullable,
  cacheRate: nullable,
  weeks: z.array(z.object({ week: z.string(), perCard: nullable })),
  models: z.array(z.object({ model: z.string(), perCard: nullable })),
  /** Sessions read, and sessions without a local Claude Code / Codex log. */
  sessions: z.number().int(),
  missing: z.number().int(),
});
export type CardTokens = z.infer<typeof cardTokensSchema>;

/** Sums each finished card's tokens over its active span (first work lane → first Done). */
export function cardTokens(input: {
  series: readonly { taskId: string; buckets: ReadonlyMap<number, TokenUsage> | null }[];
  cards: WorkflowStats["cards"];
  /** Card → model, for the model rows (the same attribution as the stats). */
  modelOf(taskId: string): string;
  models: readonly string[];
}): CardTokens {
  const named = input.models.filter(Boolean);
  const per = new Map<string, TokenUsage>();
  for (const card of input.cards) {
    const a = Math.floor(card.start / TOKEN_SLOT_MS),
      b = Math.floor(card.finishedAt / TOKEN_SLOT_MS);
    let sum = zeroUsage();
    for (const s of input.series) {
      if (s.taskId !== card.taskId || !s.buckets) continue;
      for (const [slot, usage] of s.buckets) if (slot >= a && slot <= b) sum = addUsage(sum, usage);
    }
    per.set(card.taskId, sum);
  }
  const window = input.cards.filter((c) => c.inWindow);
  const totals = (list: readonly { taskId: string }[]) => list.map((c) => totalTokens(per.get(c.taskId)!)).filter((n) => n > 0);
  const all = window.reduce((sum, c) => addUsage(sum, per.get(c.taskId)!), zeroUsage());
  const weeks = [...new Set(input.cards.map((c) => c.week).filter((w): w is string => !!w))].map((week) => ({
    week,
    perCard: median(totals(input.cards.filter((c) => c.week === week))),
  }));
  return {
    perCard: median(totals(window)),
    cacheRate: cacheHitRate(all),
    weeks,
    // "" is the merged "other" row: every card whose model has no row of its own.
    models: input.models.map((model) => ({
      model,
      perCard: median(totals(window.filter((c) => (model ? input.modelOf(c.taskId) === model : !named.includes(input.modelOf(c.taskId)))))),
    })),
    sessions: input.series.length,
    missing: input.series.filter((s) => !s.buckets).length,
  };
}
