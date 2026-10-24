import { z } from "zod";
import type { BoardEvent } from "./model";
import { asksQuestion } from "./permission-question";
import { parentOf } from "./subagents";

export const sessionReadReceiptSchema = z.strictObject({
  taskId: z.string().min(1).max(200),
  workspaceId: z.string().min(1).max(200),
  agentId: z.string().min(1).max(200),
  token: z.string().min(1).max(512),
  readAt: z.string().datetime(),
});
export type SessionReadReceipt = z.infer<typeof sessionReadReceiptSchema>;
export const sessionReadStateSchema = z
  .strictObject({
    version: z.literal(1),
    receipts: z.array(sessionReadReceiptSchema).max(10000),
  })
  .refine(
    (state) =>
      new Set(
        state.receipts.map((receipt) =>
          JSON.stringify([
            receipt.taskId,
            receipt.workspaceId,
            receipt.agentId,
          ]),
        ),
      ).size === state.receipts.length,
    "Duplicate session read watermark.",
  );
/**
 * A user's explicit "Mark as unread" is stored as this session's record with
 * this token: the session stays unread until it is read again, whatever the
 * native attention state.
 */
export const manualUnreadToken = "manual-unread";

export const markSessionReadInput = z.strictObject({
  taskId: z.string().min(1).max(200),
  agentId: z.string().min(1).max(200),
  /** The attention token the reader saw; omitted when there is none (manual unread only). */
  token: z.string().min(1).max(512).optional(),
});
export type MarkSessionReadInput = z.infer<typeof markSessionReadInput>;
export const markSessionUnreadInput = z.strictObject({
  taskId: z.string().min(1).max(200),
  agentId: z.string().min(1).max(200),
});
export type MarkSessionUnreadInput = z.infer<typeof markSessionUnreadInput>;

export interface AttentionAgent {
  id: string;
  workspaceId?: string;
  status: "idle" | "running" | "initializing" | "error" | "closed";
  archivedAt?: string | null;
  pendingPermissions?: readonly unknown[];
  lastUserMessageAt?: string | null;
  requiresAttention?: boolean;
  attentionReason?: "finished" | "error" | "permission" | null;
  attentionTimestamp?: string | null;
  labels?: Record<string, string> | null;
}

export function nativeAttentionToken(agent: AttentionAgent): string | null {
  if (
    agent.requiresAttention !== true ||
    !agent.attentionReason ||
    !agent.attentionTimestamp ||
    !Number.isFinite(Date.parse(agent.attentionTimestamp))
  )
    return null;
  return JSON.stringify([
    agent.id,
    agent.attentionReason,
    agent.attentionTimestamp,
  ]);
}

export function sessionAttention(
  agent: AttentionAgent,
  taskId: string,
  receipts: readonly SessionReadReceipt[] = [],
  events: readonly BoardEvent[] = [],
) {
  const latest = events.filter(e => e.agentId === agent.id && e.taskId === taskId &&
    (e.action === "agent.turn_started" || e.action === "agent.turn_ended")).at(-1);
  return sessionAttentionFromTurn(agent, taskId, receipts, latest);
}

/** Same live-state/receipt rules, with the daemon's named last-turn fact. */
export function sessionAttentionFromTurn(
  agent: AttentionAgent,
  taskId: string,
  receipts: readonly SessionReadReceipt[] = [],
  latest?: { action: string; at: string },
) {
  const token = nativeAttentionToken(agent);
  const archived = !!agent.archivedAt;
  const record = receipts.find(
    (r) => r.taskId === taskId && r.workspaceId === agent.workspaceId && r.agentId === agent.id,
  );
  const manualUnread = record?.token === manualUnreadToken;
  // A Paseo subagent's finished turn is its main agent's to read, not the user's (user decision
  // 2026-10-20): it never counts as unread unless the user marked it so. Approvals and errors still do.
  const subagent = !!parentOf(agent);
  const unread =
    !archived &&
    (manualUnread || (!subagent && agent.requiresAttention === true && (!token || record?.token !== token)));
  const permission =
    !archived &&
    (!!agent.pendingPermissions?.length ||
      (agent.requiresAttention === true &&
        agent.attentionReason === "permission"));
  const error =
    !archived &&
    (agent.status === "error" ||
      (agent.requiresAttention === true && agent.attentionReason === "error"));
  const promptAt = agent.lastUserMessageAt
    ? Date.parse(agent.lastUserMessageAt)
    : Number.NEGATIVE_INFINITY;
  const finishedSignal =
    agent.attentionReason === "finished" &&
    (!agent.attentionTimestamp ||
      Date.parse(agent.attentionTimestamp) >= promptAt) &&
    (latest?.action !== "agent.turn_started" ||
      (!!agent.attentionTimestamp &&
        Date.parse(agent.attentionTimestamp) >= Date.parse(latest.at)));
  const endedSignal =
    latest?.action === "agent.turn_ended" && Date.parse(latest.at) >= promptAt;
  const finished =
    !archived &&
    agent.status === "idle" &&
    !permission &&
    !error &&
    !!(finishedSignal || endedSignal);
  return {
    token,
    unread,
    manualUnread: !archived && manualUnread,
    permission,
    /** The pending request is an agent question (AskUserQuestion), not a tool approval. */
    question: permission && asksQuestion(agent),
    error,
    finished,
    running: !archived && agent.status === "running",
    starting: !archived && agent.status === "initializing",
    readKnown: manualUnread || agent.requiresAttention !== undefined,
    needsAttention: unread || permission || error,
  };
}

export function sessionAttentionSummary(
  agents: readonly AttentionAgent[],
  task: { id: string; workspaceId: string },
  receipts: readonly SessionReadReceipt[] = [],
  events: readonly BoardEvent[] = [],
) {
  return summarizeSessions(agents, task, a => sessionAttention(a, task.id, receipts, events));
}

export function sessionAttentionSummaryFromTurns(
  agents: readonly AttentionAgent[],
  task: { id: string; workspaceId: string },
  receipts: readonly SessionReadReceipt[],
  turns: ReadonlyMap<string, { latestTurn?: { action: string; at: string } }>,
) {
  return summarizeSessions(agents, task, a => sessionAttentionFromTurn(a, task.id, receipts, turns.get(a.id)?.latestTurn));
}

function summarizeSessions(agents: readonly AttentionAgent[], task: { id: string; workspaceId: string }, stateOf: (agent: AttentionAgent) => ReturnType<typeof sessionAttention>) {
  const current = [
    ...new Map(
      agents
        .filter((a) => a.workspaceId === task.workspaceId)
        .map((a) => [a.id, a]),
    ).values(),
  ].filter((a) => !a.archivedAt);
  const states = current.map(stateOf);
  return {
    total: current.length,
    running: states.filter((s) => s.running).length,
    starting: states.filter((s) => s.starting).length,
    finished: states.filter((s) => s.finished).length,
    unread: states.filter((s) => s.unread).length,
    attention: states.filter((s) => s.needsAttention).length,
    permissions: states.filter((s) => s.permission && !s.question).length,
    questions: states.filter((s) => s.question).length,
    errors: states.filter((s) => s.error).length,
    unknownRead: states.filter((s) => !s.readKnown).length,
  };
}
export type SessionAttentionSummary = ReturnType<
  typeof sessionAttentionSummary
>;
