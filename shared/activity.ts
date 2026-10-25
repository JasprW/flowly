import { z } from "zod";
import { addDays, dayKey, type FlowEntry } from "./insights";

/**
 * Project activity for the Insights heatmap (INSIGHTS-REDESIGN-SPEC §2.1): turns that
 * ended each day, cards with a turn or a move, cards that entered Done. Pure; the
 * daemon passes the project's flow log, never `board.json` events (capped per card).
 */

/** 52 whole weeks plus the current one. */
export const ACTIVITY_WEEKS = 53;

export const activityDaySchema = z.object({
  day: z.string(),
  turns: z.number().int(),
  cards: z.number().int(),
  /** Cards that entered Done that day, each once. */
  done: z.array(z.string()),
});
export type ActivityDay = z.infer<typeof activityDaySchema>;
export const activitySchema = z.object({
  /** Monday of the first column. */
  from: z.string(),
  /** Days with any activity, oldest first. */
  days: z.array(activityDaySchema),
  /** Turn counts at which levels 2, 3 and 4 start (level 1 is any non-zero day below the first). */
  levels: z.array(z.number()),
});
export type Activity = z.infer<typeof activitySchema>;

/** Monday of the day's week. */
export function mondayOf(day: string): string {
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
  return addDays(day, -((dow + 6) % 7));
}

/** First day shown: the Monday ACTIVITY_WEEKS - 1 weeks before this week's. */
export const activityFrom = (today: string) => addDays(mondayOf(today), -7 * (ACTIVITY_WEEKS - 1));

/** The 25th, 50th and 75th percentiles (nearest rank) of the non-zero days, strictly increasing. */
export function activityLevels(counts: readonly number[]): number[] {
  const s = counts.filter((n) => n > 0).sort((a, b) => a - b);
  if (!s.length) return [];
  const at = (q: number) => s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)];
  const out: number[] = [];
  // A level starts just above a quantile, so each band holds about a quarter of the days.
  for (const q of [0.25, 0.5, 0.75]) {
    const start = at(q) + 1;
    if (start <= s[s.length - 1] && (!out.length || start > out[out.length - 1])) out.push(start);
  }
  return out;
}

/** 0 for no activity, otherwise 1–4. */
export function activityLevel(turns: number, levels: readonly number[]): number {
  if (turns <= 0) return 0;
  let level = 1;
  for (const start of levels) if (turns >= start) level++;
  return Math.min(4, level);
}

export function activity(input: { entries: readonly FlowEntry[]; today: string; tz: string | undefined }): Activity {
  const from = activityFrom(input.today);
  const byDay = new Map<string, { turns: number; cards: Set<string>; done: string[] }>();
  const get = (day: string) => {
    let d = byDay.get(day);
    if (!d) byDay.set(day, (d = { turns: 0, cards: new Set(), done: [] }));
    return d;
  };
  for (const e of input.entries) {
    const turn = e.action === "agent.turn_ended";
    const move = e.action === "status_changed";
    if (!turn && !move) continue;
    const day = dayKey(Date.parse(e.at), input.tz);
    if (day < from || day > input.today) continue;
    const d = get(day);
    d.cards.add(e.taskId);
    if (turn) d.turns++;
    if (move && e.to === "done" && !d.done.includes(e.taskId)) d.done.push(e.taskId);
  }
  const days = [...byDay]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, d]) => ({ day, turns: d.turns, cards: d.cards.size, done: d.done }));
  return { from, days, levels: activityLevels(days.map((d) => d.turns)) };
}
