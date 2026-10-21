import type { PaseoApi } from "@getpaseo/client";
import type { BoardStore } from "./store";
import { openNextMoves, shownMoves } from "../shared/next-moves";
import { nextRowId, nextRowKind, nextRowVersion, type NextRowData } from "../shared/native-session";
import { within } from "./summaries";

const ROW_TIMEOUT_MS = 10_000;

/**
 * The session's suggested next steps as a card in Paseo's own timeline (NATIVE-SESSION-SPEC §6.1): written after a
 * completed turn, under the agent's last reply, and rewritten as dismissed in place when the session's next turn
 * starts. Best effort and in memory only, like every appended row: nothing here touches Flowly's own data.
 */
export class NextMoveRows {
  /** The card each session shows now, by agent id; forgotten on plugin reload (the client then hides stale cards). */
  private live = new Map<string, string>();
  constructor(
    readonly board: BoardStore,
    private timeoutMs = ROW_TIMEOUT_MS,
  ) {}

  async turnEnded(identity: { taskId: string; agentId: string }, paseo: PaseoApi): Promise<void> {
    try {
      const board = await this.board.read();
      const task = board.tasks.find((t) => t.id === identity.taskId);
      if (!task || task.archivedAt) return;
      const suggestion = openNextMoves(board.events, identity.agentId);
      if (!suggestion) return;
      const moves = shownMoves(suggestion.moves, task.status === "done" || task.status === "cancelled");
      if (!moves.length) return;
      const id = nextRowId(suggestion.id);
      const data: NextRowData = { status: "ready", taskId: task.id, workspaceId: task.workspaceId, eventId: suggestion.id, moves: [...moves] };
      await this.write(paseo, identity.agentId, id, data);
      this.live.set(identity.agentId, id);
    } catch (e) {
      console.error("Flowly next steps card not added:", e instanceof Error ? e.message : String(e));
    }
  }

  /** A suggestion for a session Flowly does not manage (NATIVE-SESSION-SPEC §12.4): same card, no card fields. */
  async writeSession(agentId: string, suggestionId: string, moves: { label: string; prompt: string }[], paseo: PaseoApi): Promise<void> {
    try {
      const id = nextRowId(suggestionId);
      await this.write(paseo, agentId, id, { status: "ready", eventId: suggestionId, moves });
      this.live.set(agentId, id);
    } catch (e) {
      console.error("Flowly next steps card not added:", e instanceof Error ? e.message : String(e));
    }
  }

  async turnStarted(agentId: string, paseo: PaseoApi): Promise<void> {
    const id = this.live.get(agentId);
    if (!id) return;
    this.live.delete(agentId);
    try {
      await this.write(paseo, agentId, id, { status: "dismissed" });
    } catch (e) {
      console.error("Flowly next steps card not dismissed:", e instanceof Error ? e.message : String(e));
    }
  }

  private write(paseo: PaseoApi, agentId: string, id: string, data: NextRowData) {
    return within(
      paseo.agents.ref(agentId).timeline.append({ type: "plugin", id, kind: nextRowKind, version: nextRowVersion, data }),
      this.timeoutMs,
    );
  }
}
