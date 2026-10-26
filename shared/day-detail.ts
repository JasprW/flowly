import { z } from "zod";
import { addDays, dayKey, dayStart, sessionIntervals, type FlowEntry } from "./insights";
import { TOKEN_SLOT_MS, addUsage, totalTokens, zeroUsage, type TokenUsage } from "./usage";

/**
 * One day of a project for the day summary card (INSIGHTS-REDESIGN-SPEC §2.2): turns,
 * agent time and tokens per card. Pure; the daemon passes the project's flow log.
 */

export const dayCardSchema = z.object({
  taskId: z.string(),
  turns: z.number().int().nonnegative(),
  agentMs: z.number().nonnegative(),
  tokens: z.number().nonnegative().optional(),
  /** Entered Done that day. */
  done: z.boolean(),
});
export type DayCard = z.infer<typeof dayCardSchema>;

export const dayDetailSchema = z.object({
  day: z.string(),
  turns: z.number().int().nonnegative(),
  agentMs: z.number().nonnegative(),
  /** Present only when tokens were asked for and at least one session log was read. */
  tokens: z.number().nonnegative().optional(),
  /** Most agent time first, then most turns. */
  list: z.array(dayCardSchema),
});
export type DayDetail = z.infer<typeof dayDetailSchema>;

/**
 * The day's cards: every card with a turn ending or a move that day. Agent time is the part
 * of each session's run intervals inside the day (a turn over midnight is split); a turn
 * still running counts until `now` only when its session is in `running`.
 */
export function dayDetail(input: { entries: readonly FlowEntry[]; day: string; tz: string | undefined; now: number; running?: ReadonlySet<string> }): DayDetail {
  const { day, tz } = input;
  const from = dayStart(day, tz);
  const to = dayStart(addDays(day, 1), tz);
  const cards = new Map<string, DayCard>();
  const card = (taskId: string) => {
    let c = cards.get(taskId);
    if (!c) cards.set(taskId, (c = { taskId, turns: 0, agentMs: 0, done: false }));
    return c;
  };
  const taskOf = new Map<string, string>();
  for (const e of input.entries) {
    if (e.agentId) taskOf.set(e.agentId, e.taskId);
    const turn = e.action === "agent.turn_ended";
    const move = e.action === "status_changed";
    if (!turn && !move) continue;
    if (dayKey(Date.parse(e.at), tz) !== day) continue;
    const c = card(e.taskId);
    if (turn) c.turns++;
    if (move && e.to === "done") c.done = true;
  }
  for (const run of sessionIntervals(input.entries, input.now, input.running ?? new Set())) {
    const overlap = Math.min(run.end, to) - Math.max(run.start, from);
    const taskId = taskOf.get(run.agentId);
    if (overlap <= 0 || !taskId) continue;
    card(taskId).agentMs += overlap;
  }
  const list = [...cards.values()].sort((a, b) => b.agentMs - a.agentMs || b.turns - a.turns);
  return {
    day,
    turns: list.reduce((n, c) => n + c.turns, 0),
    agentMs: list.reduce((n, c) => n + c.agentMs, 0),
    list,
  };
}

/** Adds each card's tokens of the day from its sessions' 15-minute buckets; a card whose sessions were all unreadable gets none. */
export function withDayTokens(
  detail: DayDetail,
  series: readonly { taskId: string; buckets: ReadonlyMap<number, TokenUsage> | null }[],
  tz: string | undefined,
): DayDetail {
  const a = Math.floor(dayStart(detail.day, tz) / TOKEN_SLOT_MS);
  const b = Math.floor(dayStart(addDays(detail.day, 1), tz) / TOKEN_SLOT_MS);
  const per = new Map<string, TokenUsage>();
  for (const s of series) {
    if (!s.buckets) continue;
    let sum = per.get(s.taskId) ?? zeroUsage();
    for (const [slot, usage] of s.buckets) if (slot >= a && slot < b) sum = addUsage(sum, usage);
    per.set(s.taskId, sum);
  }
  if (!per.size) return detail;
  const list = detail.list.map((c) => (per.has(c.taskId) ? { ...c, tokens: totalTokens(per.get(c.taskId)!) } : c));
  return { ...detail, list, tokens: list.reduce((n, c) => n + (c.tokens ?? 0), 0) };
}

/** The share (0–1) of the day's busiest card (§2.2): by agent time, or by turns when no card has time. */
export function complexityShare(c: DayCard, list: readonly DayCard[]): number {
  const byTime = list.some((x) => x.agentMs > 0);
  const value = (x: DayCard) => (byTime ? x.agentMs : x.turns);
  const max = Math.max(0, ...list.map(value));
  return max > 0 ? value(c) / max : 0;
}

/** Level 1–4 of a share, in quarters, for the bar's opacity (the heatmap's scale). */
export const complexityLevel = (share: number) => (share <= 0.25 ? 1 : share <= 0.5 ? 2 : share <= 0.75 ? 3 : 4);
