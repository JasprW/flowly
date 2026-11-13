/**
 * Background agents (PASEO-0.16-SPEC §3.1): Flowly's temporary sessions (card summary, session
 * insights, memory review, Insights digest, workflow insights, auto review) are created with
 * `background: true`, so Paseo 0.16 keeps them out of its agent lists, tabs, subagent tracks and
 * notifications. The plugin cannot read `server_info.features`, so support is learned from the
 * first create (§2, method B): an older host refuses `background` with one of the messages below,
 * Flowly remembers that until the plugin restarts (a daemon restart reloads it) and creates the
 * session the 0.15 way. Any other create failure is the caller's ordinary failure.
 */
let supported: boolean | null = null;

/** Refusals of `background` by a host that has no background agents. */
const REFUSED = [
  // 0.16 client against an older daemon.
  "Update the host to use background agents.",
  // 0.15.0–0.15.3 client, daemon without background workspaces.
  "Update the host to use background workspaces.",
  // 0.15.4 daemon: background only applies to a workspace it creates.
  "background is workspace creation intent",
];

export function isBackgroundRefusal(error: unknown) {
  const text = error instanceof Error ? error.message : String(error);
  return REFUSED.some((refusal) => text.includes(refusal));
}

/** Whether this host was seen to create background agents: true, false, or null before the first try. */
export function backgroundAgentsSupported() {
  return supported;
}

/** Tests only. */
export function resetBackgroundAgents(value: boolean | null = null) {
  supported = value;
}

/**
 * Creates a temporary session, hidden when the host supports it. `create` receives the extra
 * create options (`{ background: true }` or `{}`) to spread into its `agents.create` call.
 */
export async function createHidden<T>(create: (extra: { background?: true }) => Promise<T>): Promise<T> {
  if (supported !== false) {
    try {
      const agent = await create({ background: true });
      supported = true;
      return agent;
    } catch (error) {
      if (!isBackgroundRefusal(error)) throw error;
      supported = false;
      // An older host, not a failure: logged, not reported (PASEO-0.16-SPEC §2).
      console.log(`Flowly: this Paseo has no background agents; temporary sessions are created visible (${error instanceof Error ? error.message : String(error)}).`);
    }
  }
  return create({});
}

/** Whether a created session is a background one (the snapshot the create returned says so). */
export function isBackgroundAgent(agent: unknown) {
  const current = (agent as { current?: () => { background?: boolean } | null } | null)?.current;
  return typeof current === "function" && current.call(agent)?.background === true;
}
