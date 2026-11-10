import { openLocalDaemon } from "./local-daemon";
import type { BoardStore } from "./store";
import type { BoardEvent } from "../shared/model";
import { paseoHome } from "./service";
import { isSummarizer } from "../shared/summary";
import { currentWrapup } from "../shared/wrapup-state";

/** Paseo's answer to "can this archived workspace come back?". */
export type RecoveryState =
  | { kind: "recoverable"; workspaceId: string; workspaceName: string; action: string; branch: string | null }
  | { kind: "unavailable"; workspaceId: string; reason: string; message: string };

/** One short-lived daemon connection for a restore run. */
export interface RecoveryConnection {
  inspect(workspaceId: string): Promise<RecoveryState>;
  restore(workspaceId: string): Promise<void>;
  /** Archived sessions in the workspace. */
  archivedSessions(workspaceId: string): Promise<ArchivedSession[]>;
  /** Unarchives the session and reloads it from persistence (Paseo "refresh"). */
  reviveSession(agentId: string): Promise<void>;
  close(): Promise<void>;
}
export type ArchivedSession = { id: string; archivedAt: string; labels: Record<string, string> };
export interface WorkspaceRecovery {
  connect(): Promise<RecoveryConnection>;
}

/**
 * COMPAT(sdk-workspace-restore): the plugin SDK (`PaseoApi`) has no workspace
 * restore or session unarchive in @getpaseo/client 0.11.2, but the daemon
 * serves `workspace.recovery.inspect/restore` and agent refresh (which
 * unarchives). Until the SDK exposes them, use a short-lived local connection
 * (`openLocalDaemon`). Replace with the SDK calls once they exist
 * (WORKSPACE-RESTORE-SPEC).
 */
export function daemonWorkspaceRecovery(home = paseoHome()): WorkspaceRecovery {
  return {
    async connect() {
      const client = await openLocalDaemon(
        home,
        "flowly-restore",
        ["inspectWorkspaceRecovery", "restoreWorkspace", "fetchAgents", "fetchAgent", "refreshAgent"],
        "This Paseo version cannot restore workspaces.",
      );
      return {
        inspect: (id) => client.inspectWorkspaceRecovery(id) as Promise<RecoveryState>,
        restore: (id) => client.restoreWorkspace(id),
        async archivedSessions(workspaceId) {
          const found: ArchivedSession[] = [];
          let cursor: string | undefined;
          do {
            const page = await client.fetchAgents({ filter: { includeArchived: true }, page: { limit: 200, cursor } });
            for (const { agent } of page.entries)
              if (agent.workspaceId === workspaceId && agent.archivedAt)
                found.push({ id: agent.id, archivedAt: agent.archivedAt, labels: agent.labels ?? {} });
            cursor = page.pageInfo.nextCursor ?? undefined;
          } while (cursor);
          return found;
        },
        async reviveSession(id) {
          try {
            await client.refreshAgent(id);
          } catch (e) {
            // Refresh unarchives before reloading; a session that never ran has
            // nothing to reload but is back all the same.
            const now = await client.fetchAgent(id).catch(() => null);
            if (!now || now.agent.archivedAt) throw e;
          }
        },
        close: () => client.close().catch(() => undefined),
      };
    },
  };
}

const finished = (status: string) => status === "done" || status === "cancelled";

/**
 * Whether the plugin itself archived this card's workspace and has not brought
 * it back since: a wrap-up that archived the workspace, or auto wrap-up.
 */
export function archivedByWrapup(events: BoardEvent[], taskId: string) {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.taskId !== taskId) continue;
    if (e.action === "workspace_restored") return false;
    if (e.action === "workspace_auto_archived") return true;
    if (e.action === "wrapped_up" && /(^|; )workspace archived(;|$)/.test(e.note || "")) return true;
  }
  return false;
}

/**
 * Sessions archived by one of this card's wrap-ups: archived at the moment a
 * wrap-up ran (the event is recorded right after archiving, and re-archiving a
 * workspace re-stamps its sessions). Sessions the user archived at other times,
 * and summarizer children, stay archived.
 */
export function sessionsArchivedByWrapup(events: BoardEvent[], taskId: string, sessions: ArchivedSession[]) {
  const times = events
    .filter((e) => e.taskId === taskId && (e.action === "wrapped_up" || e.action === "workspace_auto_archived"))
    .map((e) => Date.parse(e.at));
  return sessions.filter((s) => {
    if (isSummarizer(s)) return false;
    const at = Date.parse(s.archivedAt);
    return times.some((t) => at >= t - 120_000 && at <= t + 5_000);
  });
}

/**
 * Moving a wrapped-up card out of Done/Cancelled brings its workspace back:
 * Paseo unarchives it in place, or recreates a removed worktree on its kept
 * branch, under the same workspace ID, and the sessions its wrap-up archived
 * come back too. Only workspaces the plugin archived, or that the card created,
 * are restored; shared ones (e.g. the project main) are never touched.
 */
export class WorkspaceRestoreService {
  constructor(
    readonly store: BoardStore,
    readonly recovery: WorkspaceRecovery = daemonWorkspaceRecovery(),
  ) {}

  private readonly runs = new Map<string, Promise<UnwrapResult>>();

  restoreAfterReopen(id: string): Promise<void> {
    return this.locked(id, () => this.once(id, false)).then(() => undefined);
  }

  /**
   * Unwrap in place (WORKSPACE-RESTORE-SPEC "Unwrap in place"): the same restore
   * for a wrapped-up card that stays in Done/Cancelled. Rejects with the reason
   * when nothing could be restored; a card not wrapped up is a silent no-op.
   */
  async unwrap(id: string): Promise<UnwrapResult> {
    const board = await this.store.read();
    const task = board.tasks.find((t) => t.id === id);
    if (!task) throw new Error("Task not found.");
    if (task.archivedAt) throw new Error("Card is archived.");
    if (!finished(task.status)) throw new Error("Only Done or Cancelled cards can be unwrapped.");
    return this.locked(id, () => this.once(id, true));
  }

  private locked(id: string, start: () => Promise<UnwrapResult>) {
    const pending = this.runs.get(id);
    if (pending) return pending;
    const run = start().finally(() => this.runs.delete(id));
    this.runs.set(id, run);
    return run;
  }

  private async once(id: string, manual: boolean): Promise<UnwrapResult> {
    const none: UnwrapResult = { restored: false, failed: [] };
    const actor = manual ? "human" : "system";
    const record = (action: string, note: string) =>
      this.store.mutate((board) => {
        if (board.tasks.some((t) => t.id === id))
          this.store.event(board, { taskId: id, actor, action, note });
      });
    // Unwrap reports why nothing came back; a reopen only records it.
    const skip = async (note: string, report: boolean) => {
      if (report || manual) await record("workspace_restore_skipped", note);
      if (manual) throw new Error(note);
      return none;
    };
    const board = await this.store.read();
    const task = board.tasks.find((t) => t.id === id);
    if (!task || task.archivedAt) return none;
    if (manual ? !currentWrapup(board.events, id) : finished(task.status)) return none;
    const wrapped = board.events.some(
      (e) => e.taskId === id && (e.action === "wrapped_up" || e.action === "workspace_auto_archived"),
    );
    const ours = archivedByWrapup(board.events, id);
    const owned = task.ownsWorkspace === true;
    if (!wrapped && !owned) return none;
    let daemon: RecoveryConnection;
    try {
      daemon = await this.recovery.connect();
    } catch (e) {
      return skip(`Could not reach Paseo: ${message(e)}`, ours);
    }
    try {
      let state: RecoveryState;
      try {
        state = await daemon.inspect(task.workspaceId);
      } catch (e) {
        return skip(`Could not reach Paseo: ${message(e)}`, ours);
      }
      let restored: RecoveryState | null = null;
      if (state.kind === "recoverable") {
        // Someone else archived it: leave the workspace and its sessions alone.
        if (!ours && !owned) return manual ? skip("The workspace was archived outside this card's wrap-up.", true) : none;
        const current = (await this.store.read()).tasks.find((t) => t.id === id);
        if (!current || current.archivedAt || (!manual && finished(current.status))) return none;
        try {
          await daemon.restore(task.workspaceId);
        } catch (e) {
          return skip(`Restoring failed: ${message(e)}`, true);
        }
        restored = state;
      } else if (state.reason !== "workspace_not_archived") {
        return skip(state.message, ours);
      }
      const revive = sessionsArchivedByWrapup(
        (await this.store.read()).events,
        id,
        await daemon.archivedSessions(task.workspaceId).catch(() => []),
      );
      let revived = 0;
      const failed: string[] = [];
      for (const session of revive) {
        try {
          await daemon.reviveSession(session.id);
          revived++;
        } catch (e) {
          failed.push(`${session.id.slice(0, 8)}: ${message(e)}`);
        }
      }
      const sessions = [
        `${revived} session(s) restored`,
        ...(failed.length ? [`not restored: ${failed.join("; ")}`] : []),
      ].join("; ");
      if (restored)
        await record(
          "workspace_restored",
          `${restored.action === "restore" ? `Worktree recreated${restored.branch ? ` on branch ${restored.branch}` : ""} and workspace restored` : "Workspace restored"}; ${sessions}.`,
        );
      // Unwrap always ends the wrapped-up state, even when only sessions came back.
      else if (manual) await record("workspace_restored", `Workspace already active; ${sessions}.`);
      else if (revive.length) await record("sessions_restored", `${sessions}.`);
      else return none;
      return { restored: true, failed };
    } finally {
      await daemon.close();
    }
  }
}

export type UnwrapResult = { restored: boolean; failed: string[] };

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
