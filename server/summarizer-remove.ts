import { openLocalDaemon } from "./local-daemon";
import { paseoHome } from "./service";
import { logFailure } from "./error-report";
import { isBackgroundAgent } from "./background-agent";

/** The child session a summarizer or insight run created, and is now done with. */
export type RemovableAgent = { id: string; archive(): Promise<unknown> };
export type RemoveAgent = (agent: RemovableAgent) => Promise<void>;

/** What the cleanup needs from a daemon connection; `DaemonClient` satisfies it. */
export interface AgentDeleter {
  deleteAgent(agentId: string): Promise<void>;
  close(): Promise<void>;
}

/**
 * A background session (Paseo 0.16, PASEO-0.16-SPEC §3.1) is archived through the SDK: Paseo leaves
 * archived background sessions out of its archive list, so nothing piles up where the user looks, and
 * no local connection is needed. When that archive fails, the hard delete below is tried.
 *
 * COMPAT(sdk-local-daemon): on an older host the plugin SDK can only archive a session, which leaves
 * every summarizer child in Paseo's archive. Hard-delete it over a short-lived local connection instead
 * (NATIVE-SESSION-SPEC §12.2). Only ever called with the id of a session this run created. When the
 * delete fails for any reason, fall back to archive() so nothing stays visible, and log it.
 */
export function daemonRemoveAgent(
  connect: () => Promise<AgentDeleter> = async () =>
    (await openLocalDaemon(paseoHome(), "flowly-summarizer-cleanup", ["deleteAgent"], "This Paseo version cannot delete sessions.")) as AgentDeleter,
): RemoveAgent {
  return async (agent) => {
    if (isBackgroundAgent(agent)) {
      try {
        await agent.archive();
        return;
      } catch (error) {
        logFailure("Flowly could not archive a background session; deleting it:", error);
      }
    }
    let client: AgentDeleter | null = null;
    try {
      client = await connect();
      await client.deleteAgent(agent.id);
    } catch (error) {
      logFailure("Flowly could not delete a summarizer session; archiving it:", error);
      await agent.archive().catch(() => undefined);
    } finally {
      await client?.close().catch(() => undefined);
    }
  };
}
