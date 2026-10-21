import type { PaseoAgent, PaseoAgentUpdate } from "@getpaseo/client";
import { isSummarizer } from "../shared/summary";

/**
 * The live (non-archived) sessions the chip refresh works from, kept by the agent stream instead of listing them
 * every round (NATIVE-SESSION-SPEC §8; a list is about 230 KB for 50 sessions, and a phone decodes every byte).
 * Same rules as the board's stream (`applyAgentUpdates` in `queries.ts`): archived and summarizer sessions are not
 * live sessions, and a copy older than the one held is ignored.
 */
export function applyLiveUpdate(
  map: Map<string, PaseoAgent>,
  update: PaseoAgentUpdate,
): { changed: boolean; before: PaseoAgent | null; after: PaseoAgent | null } {
  const id = update.kind === "upsert" ? update.agent.id : update.agentId;
  const before = map.get(id) ?? null;
  if (update.kind === "remove" || update.agent.archivedAt || isSummarizer(update.agent as PaseoAgent)) {
    if (!before) return { changed: false, before: null, after: null };
    map.delete(id);
    return { changed: true, before, after: null };
  }
  const agent = update.agent as PaseoAgent;
  if (before && before.updatedAt > agent.updatedAt) return { changed: false, before, after: before };
  map.set(id, agent);
  return { changed: true, before, after: agent };
}

/**
 * Whether a session's change can alter what its cards and chips show (NATIVE-SESSION-SPEC §6.2): it started or
 * finished working, waits on or got an answer, the person wrote, or it came, went or moved. Title, usage and other
 * churn do not, so they cause no refresh.
 */
export function relevantChange(before: PaseoAgent | null, after: PaseoAgent | null): boolean {
  if (!before || !after) return before !== after;
  return (
    before.status !== after.status ||
    before.lastUserMessageAt !== after.lastUserMessageAt ||
    (before.pendingPermissions?.length ?? 0) !== (after.pendingPermissions?.length ?? 0) ||
    before.attentionReason !== after.attentionReason ||
    before.workspaceId !== after.workspaceId
  );
}
