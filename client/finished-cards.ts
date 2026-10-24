import type { BoardEvent, Status, Task } from "../shared/model";

/** Lanes whose old cards can be tucked away (FINISHED-CARDS-SPEC). */
export const finishedLanes: readonly Status[] = ["done", "cancelled"];
/** Choices for "Hide finished cards after"; 0 shows every card. */
export const hideFinishedChoices = [0, 3, 7, 14, 30] as const;

/**
 * IDs of Done/Cancelled cards that entered their lane (latest move into it,
 * else their last update) more than `days` days ago. `keep` (the open card) is never hidden. 0 days hides nothing.
 */
export function olderFinished(
  tasks: readonly Task[],
  events: readonly BoardEvent[],
  days: number,
  now = Date.now(),
  keep = "",
): ReadonlySet<string> {
  if (!(days > 0)) return new Set();
  const candidates = tasks.filter((t) => finishedLanes.includes(t.status) && t.id !== keep);
  if (!candidates.length) return new Set();
  // One pass over events instead of one per card.
  const entered = new Map<string, string>();
  const wanted = new Map(candidates.map((t) => [t.id, t.status]));
  for (const e of events)
    if (e.action === "status_changed" && wanted.get(e.taskId) === e.to && e.at > (entered.get(e.taskId) || "")) entered.set(e.taskId, e.at);
  return olderFinishedFromDates(tasks, entered, days, now, keep);
}

/** The same time boundary when overview supplied the latest entry dates. */
export function olderFinishedFromDates(tasks: readonly Task[], entered: ReadonlyMap<string, string>, days: number, now = Date.now(), keep = ""): ReadonlySet<string> {
  if (!(days > 0)) return new Set();
  const cutoff = new Date(now - days * 86_400_000).toISOString();
  return new Set(tasks.filter(t => finishedLanes.includes(t.status) && t.id !== keep && (entered.get(t.id) || t.updatedAt) < cutoff).map(t => t.id));
}
