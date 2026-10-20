import type { PluginClientContext } from "@getpaseo/plugin/client";
import * as rpc from "../shared/rpc";
import { openNextMoves } from "../shared/next-moves";
import { chipRequestId } from "./native-chips";
import { t } from "../shared/i18n";

/**
 * What the native Next moves card and Ideas popover do (NATIVE-SESSION-SPEC §6.4, §7.3).
 * Every action re-reads the board first and refuses when what the user saw is
 * no longer current; it never acts on a different suggestion, idea or card.
 */
type Client = Pick<PluginClientContext, "rpc" | "paseo" | "openScreen">;

async function freshCard(client: Client, taskId: string) {
  const board = await client.rpc(rpc.readBoard, {});
  const task = board.tasks.find((x) => x.id === taskId);
  if (!task || task.archivedAt) throw new Error(t("This card is unavailable. Open Flowly to check it."));
  return { board, task };
}

/** The "Move to Done" suggestion, while it is still current: the card's fresh revision, like a drag to Done. */
export async function moveToDone(client: Client, input: { taskId: string; agentId: string; eventId: string }) {
  const { board, task } = await freshCard(client, input.taskId);
  if (openNextMoves(board.events, input.agentId)?.id !== input.eventId)
    throw new Error(t("This suggestion is no longer current."));
  if (task.status === "done" || task.status === "cancelled") throw new Error(t("This card is already finished."));
  return client.rpc(rpc.updateTask, { id: task.id, revision: task.revision, status: "done" });
}

/**
 * After a move to Done: whether to ask (MULTITASK-SPEC). With Auto wrap up on the daemon decides, so nothing is asked. Nothing to archive asks nothing, as
 * the board's dialog does (`client/wrapup.tsx`); blockers or warnings need Flowly's dialog to confirm them.
 */
export async function wrapupNeed(client: Client, input: { taskId: string }): Promise<"none" | "ask" | "needs-flowly"> {
  // Read the setting now, not from the chip refresh's copy: it may have just changed.
  if ((await client.rpc(rpc.nativeChips, {})).autoWrapup) return "none";
  const check = await client.rpc(rpc.wrapupCheck, { id: input.taskId });
  if (!check.workspace || (!check.archiveWorkspace && !check.sessions)) return "none";
  return check.blockers.length || check.warnings.length ? "needs-flowly" : "ask";
}

/** Wraps the card up when the preflight is clean; anything to confirm is left to Flowly's dialog. */
export async function wrapupNow(client: Client, input: { taskId: string }): Promise<"done" | "needs-flowly"> {
  const check = await client.rpc(rpc.wrapupCheck, { id: input.taskId });
  if (check.blockers.length || check.warnings.length) return "needs-flowly";
  await client.rpc(rpc.wrapup, { id: input.taskId, revision: check.revision, acknowledgeWarnings: false, keepCard: true });
  return "done";
}

async function openIdea(client: Client, ideaId: string) {
  const board = await client.rpc(rpc.readBoard, {});
  const idea = board.ideas.find((i) => i.id === ideaId);
  if (!idea || idea.status !== "open") throw new Error(t("This idea is no longer open."));
  return idea;
}

/** "Continue here": IDEAS-SPEC §6.2 unchanged (the daemon writes and sends the instruction). */
export async function continueIdea(client: Client, input: { ideaId: string; agentId: string }) {
  await openIdea(client, input.ideaId);
  return client.rpc(rpc.adoptIdea, { id: input.ideaId, agentId: input.agentId });
}

export async function dismissIdea(client: Client, input: { ideaId: string }) {
  await openIdea(client, input.ideaId);
  return client.rpc(rpc.updateIdea, { id: input.ideaId, status: "dismissed" });
}

/** "New card": Flowly's new-card form prefilled from the idea (the board validates the link). */
export function newCardFromIdea(client: Client, input: { ideaId: string }) {
  client.openScreen({ screenId: "board", params: { ideaId: input.ideaId, requestId: chipRequestId() } });
}

/** "Open in Flowly" from the popover: the card's overview, as the Task chip opens it. */
export function openCard(client: Client, input: { taskId: string; workspaceId: string; agentId: string }) {
  client.openScreen({
    screenId: "board",
    params: { taskId: input.taskId, workspaceId: input.workspaceId, sessionId: input.agentId, requestId: chipRequestId() },
  });
}
