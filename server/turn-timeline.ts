import type { PaseoApi } from "@getpaseo/client";
import { lastTurn } from "../shared/summary";
import { logFailure } from "./error-report";

/**
 * The items of the turn that just ended. Paseo 0.13 sends `timeline: []` with `agent.turn_ended`
 * (0.12 filled it in), so an empty hook timeline is replaced by the last turn of the newest
 * timeline page, as the manual summary refresh reads it. A failed read leaves the hook's value.
 */
export async function turnTimeline<T extends { type: string }>(
  paseo: PaseoApi,
  agentId: string,
  hook: readonly T[],
): Promise<readonly T[]> {
  if (hook.length) return hook;
  try {
    const page = await paseo.agents.ref(agentId).timeline.refetch({ direction: "tail", limit: 200, projection: "projected" });
    return lastTurn(page.entries.flatMap((e) => (e.item ? [e.item as unknown as T] : [])));
  } catch (e) {
    logFailure("Flowly turn timeline not read:", e);
    return hook;
  }
}
