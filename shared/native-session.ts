import { z } from "zod";
import type { SummaryEntry } from "./summary";
import { nextMoveLimits, nextMoveSchema } from "./model";

/**
 * The progress summary as a row in the session's own timeline
 * (NATIVE-SESSION-SPEC §5.2): appended by the daemon to Paseo's timeline and
 * drawn there only; Flowly's own session view leaves plugin rows out (§5.4).
 */
/** Paseo accepts only `^[a-z][a-z0-9-]*$` for kinds and ids; anything else throws at registration and stops the client plugin. */
export const summaryRowKind = "flowly-summary";
export const summaryRowVersion = 1;

export const summaryRowSchema = z.object({
  taskId: z.string().min(1),
  workspaceId: z.string().min(1),
  entryId: z.string().min(1),
  state: z.string(),
  target: z.string(),
  recap: z.string(),
  next: z.string(),
  model: z.string(),
  at: z.string(),
});
export type SummaryRowData = z.infer<typeof summaryRowSchema>;

/** One row per summary version: appending the same version again replaces its row. */
export const summaryRowId = (entryId: string) => `${summaryRowKind}-${entryId}`;

export function summaryRow(entry: SummaryEntry, workspaceId: string) {
  const data: SummaryRowData = {
    taskId: entry.taskId,
    workspaceId,
    entryId: entry.id,
    state: entry.state,
    target: entry.target,
    recap: entry.recap,
    next: entry.next,
    model: entry.model,
    at: entry.at,
  };
  return { type: "plugin" as const, id: summaryRowId(entry.id), kind: summaryRowKind, version: summaryRowVersion, data };
}

/**
 * The session's suggested next steps as a card under the agent's last reply
 * (NATIVE-SESSION-SPEC §6). Written `ready` when a turn ends and rewritten
 * `dismissed` (same id, so it keeps its place and renders nothing) when the next
 * turn starts.
 */
export const nextRowKind = "flowly-next-moves";
export const nextRowVersion = 1;
export const nextRowSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ready"),
    taskId: z.string().min(1),
    workspaceId: z.string().min(1),
    /** The `next_moves_suggested` event the card shows; the card hides once it is no longer current. */
    eventId: z.string().min(1),
    moves: z.array(nextMoveSchema).min(1).max(nextMoveLimits.count),
  }),
  z.object({ status: z.literal("dismissed") }),
]);
export type NextRowData = z.infer<typeof nextRowSchema>;
export const nextRowId = (eventId: string) => `${nextRowKind}-${eventId}`;
