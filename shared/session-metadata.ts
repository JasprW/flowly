/**
 * The ids Flowly mirrors onto a card session's Paseo metadata (PASEO-0.16-SPEC §3.4, §3.6): only ids, never titles
 * or content. A mirror, not the source of truth: the binding of a session to its card is the plugin's data, so a
 * reader checks what it finds there (the chip state) and treats a stale or missing value as "not a card session".
 */
export const metadataTaskId = "flowly.taskId";
/** The session's own id: a composer item cannot otherwise tell which session's composer it sits in. */
export const metadataAgentId = "flowly.agentId";

/** The card session a metadata object names, or null. */
export function metadataSession(metadata: Readonly<Record<string, unknown>> | null | undefined): { taskId: string; agentId: string } | null {
  const taskId = metadata?.[metadataTaskId],
    agentId = metadata?.[metadataAgentId];
  return typeof taskId === "string" && taskId && typeof agentId === "string" && agentId ? { taskId, agentId } : null;
}
