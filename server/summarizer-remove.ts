import { openLocalDaemon } from "./local-daemon";
import { paseoHome } from "./service";

/** The child session a summarizer or insight run created, and is now done with. */
export type RemovableAgent = { id: string; archive(): Promise<unknown> };
export type RemoveAgent = (agent: RemovableAgent) => Promise<void>;

/** What the cleanup needs from a daemon connection; `DaemonClient` satisfies it. */
export interface AgentDeleter {
  deleteAgent(agentId: string): Promise<void>;
  close(): Promise<void>;
}

/**
 * COMPAT(sdk-local-daemon): the plugin SDK (0.11.2) can only archive a session, which leaves every
 * summarizer child in Paseo's archive. Hard-delete it over a short-lived local connection instead
 * (NATIVE-SESSION-SPEC §12.2). Only ever called with the id of a session this run created. When the
 * delete fails for any reason, fall back to archive() so nothing stays visible, and log it.
 */
export function daemonRemoveAgent(
  connect: () => Promise<AgentDeleter> = async () =>
    (await openLocalDaemon(paseoHome(), "flowly-summarizer-cleanup", ["deleteAgent"], "This Paseo version cannot delete sessions.")) as AgentDeleter,
): RemoveAgent {
  return async (agent) => {
    let client: AgentDeleter | null = null;
    try {
      client = await connect();
      await client.deleteAgent(agent.id);
    } catch (error) {
      console.error("Flowly could not delete a summarizer session; archiving it:", error instanceof Error ? error.message : String(error));
      await agent.archive().catch(() => undefined);
    } finally {
      await client?.close().catch(() => undefined);
    }
  };
}
