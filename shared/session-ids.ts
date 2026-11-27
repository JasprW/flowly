/**
 * The provider's own id for a Paseo session (Claude session id, Codex thread
 * id …), taken from the agent's persistence handle, falling back to the live
 * runtime info. A plugin provider wraps its handle as
 * `plugin:{"version":1,"data":{"sessionId":"…"}}`; the inner id is used, and a
 * wrapper without one gives nothing. Returns "" when there is no id or it is
 * the Paseo agent id itself, so the caller shows a single Copy entry.
 */
export type SessionIdSource = {
  id: string;
  persistence?: { sessionId?: string | null; nativeHandle?: string | null } | null;
  runtimeInfo?: { sessionId?: string | null } | null;
};

export function providerSessionId(agent: SessionIdSource): string {
  const raw = (agent.persistence?.sessionId || agent.runtimeInfo?.sessionId || "").trim();
  const id = raw.startsWith("plugin:") ? pluginSessionId(raw.slice("plugin:".length)) : raw;
  return id && id !== agent.id ? id : "";
}

function pluginSessionId(json: string): string {
  try {
    const inner = (JSON.parse(json) as { data?: { sessionId?: unknown } })?.data?.sessionId;
    return typeof inner === "string" ? inner.trim() : "";
  } catch {
    return "";
  }
}
