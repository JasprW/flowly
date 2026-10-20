import { z } from "zod";
import type { PaseoAgent, PaseoApi } from "@getpaseo/client";
import type { ComponentType } from "react";
import type {
  PluginButtonContentProps,
  PluginClientContext,
  PluginButtonRegistration,
  PluginScreenParams,
} from "@getpaseo/plugin/client";
import type { RpcOutput } from "@getpaseo/plugin";
import { nativeChips, readBoard, readBoardChanged } from "../shared/rpc";
import { chipMoves } from "../shared/next-moves";
import { movesHidden, onMovesHidden } from "./hidden-moves";
import { chipStateIds, clearChipStates, setChipClient, setChipRefresher, setChipState, type ChipState } from "./native-chips";
import { listAgents } from "./resources";
import { readBoardDelta, type Board } from "./board-read";
import { t } from "../shared/i18n";

const id = z.string().min(1).max(200);
const linkSchema = z.object({
  taskId: id,
  sessionId: id,
  workspaceId: id,
  requestId: id,
});
export type CardSessionLink = z.infer<typeof linkSchema>;
/** A one-time drawer entry; an empty `sessionId` opens the card overview. */
export type SessionEntry = { sessionId: string; requestId: string };
export type LinkBoard = Board;

export function parseSessionLink(
  params?: PluginScreenParams,
): CardSessionLink | null {
  if (
    !params ||
    // An idea link ("Start a new task" from the Ideas chip) also carries a requestId.
    "ideaId" in params ||
    !["taskId", "sessionId", "workspaceId", "requestId"].some(
      (key) => key in params,
    )
  )
    return null;
  const result = linkSchema.safeParse(params);
  if (!result.success)
    throw new Error(
      t("Invalid Kanban session link. Open it again from the session chip."),
    );
  return result.data;
}
const ideaLinkSchema = z.object({ ideaId: id, requestId: id });
export type IdeaLink = z.infer<typeof ideaLinkSchema>;
/** "Start a new task" from the native Ideas chip: open Flowly's new-card form for this idea (NATIVE-SESSION-SPEC §7.3). */
export function parseIdeaLink(params?: PluginScreenParams): IdeaLink | null {
  if (!params || !("ideaId" in params)) return null;
  const result = ideaLinkSchema.safeParse(params);
  if (!result.success) throw new Error(t("Invalid idea link. Open it again from the Ideas chip."));
  return result.data;
}
export function sessionLinkKey(link: CardSessionLink) {
  return JSON.stringify([
    link.taskId,
    link.sessionId,
    link.workspaceId,
    link.requestId,
  ]);
}

/** Prefix a failure with the step that produced it, so host toasts are diagnosable. */
async function step<T>(label: string, run: () => Promise<T> | T): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    throw new Error(`${label}: ${text}`);
  }
}

export async function resolveSessionLink(
  paseo: PaseoApi,
  read: () => Promise<LinkBoard>,
  link: CardSessionLink,
) {
  const [board, snapshot] = await Promise.all([
    step(t("Kanban board read failed"), read),
    step(t("Session lookup failed"), () => paseo.agents.ref(link.sessionId).refresh()),
  ]);
  const task = board?.tasks?.find(
    (t) => t.id === link.taskId && t.workspaceId === link.workspaceId,
  );
  const project = task
    ? board.projects?.find((p) => p.id === task.projectId)
    : undefined;
  const actor = snapshot?.agent;
  if (!task || !project)
    throw new Error(
      t("This session's linked card is unavailable. Refresh the session chip or open Flowly."),
    );
  if (
    !actor ||
    actor.id !== link.sessionId ||
    actor.workspaceId !== task.workspaceId
  )
    throw new Error(
      t("This session is unavailable or its workspace changed. Refresh the session chip."),
    );
  return { board, task, project, actor, link };
}

let requestSequence = 0;
const newRequestId = () => `${Date.now()}-${++requestSequence}`;

/** The first chip round waits this long, so it does not compete with the plugin's own first paint (PERFORMANCE-SPEC, Cold start). */
export const CHIPS_START_DELAY_MS = 2500;

/** The Ideas chip's popover (NATIVE-SESSION-SPEC §7); passed in so this module stays free of UI code. */
export type ChipPopovers = {
  ideas: ComponentType<PluginButtonContentProps>;
};

export function registerSessionChips(
  client: PluginClientContext,
  interval = 5000,
  startDelay = CHIPS_START_DELAY_MS,
  popovers?: ChipPopovers,
) {
  const registrations = new Map<
    string,
    { binding: string; label: string; chip: PluginButtonRegistration }
  >();
  // The Ideas pills, by session; `signature` covers what the popover shows. The Next moves card is a timeline row
  // (NATIVE-SESSION-SPEC §6): this refresh only records which suggestion set is current for it.
  type Extra = { binding: string; signature: string; chip: PluginButtonRegistration };
  const ideaPills = new Map<string, Extra>();
  let chipInfo: { managed: Set<string>; ideas: boolean; autoWrapup: boolean; nextMoveTap: "fill" | "copy" } | null = null,
    chipInfoAt = 0;
  if (popovers) setChipClient(client);
  let lastRound: { current: LinkBoard; live: PaseoAgent[]; tasks: Map<string, LinkBoard["tasks"][number]> } | null = null;
  // Hiding a set on the Next moves card takes it away at once, not at the next round.
  const stopHidden = onMovesHidden(() => {
    if (!disposed && lastRound) syncExtras(lastRound.current, lastRound.live, lastRound.tasks);
  });
  // This poll runs on every client, phones included, where each response is
  // decoded on the JS thread while the user may be typing in a composer
  // (PERFORMANCE-SPEC). So: the board is re-read only when its etag changed,
  // live sessions are listed each round, and the archived scan (every agent on
  // the host) only when the board changed or once a minute.
  let board: LinkBoard | null = null,
    etag = "",
    archived: PaseoAgent[] = [],
    archivedAt = 0;
  const archivedEvery = 60_000;
  const opening = new Set<string>();
  let disposed = false,
    timer: ReturnType<typeof setTimeout> | undefined,
    latestClick = 0;
  function clearExtras() {
    for (const { chip } of ideaPills.values()) chip.remove();
    ideaPills.clear();
    clearChipStates();
  }
  function clear() {
    for (const { chip } of registrations.values()) chip.remove();
    registrations.clear();
    clearExtras();
    lastRound = null;
  }
  // Adds, updates in place, or removes one Next/Ideas pill; `button` is null to remove.
  function syncPill(
    pills: Map<string, Extra>,
    id: string,
    agentId: string,
    workspaceId: string,
    binding: string,
    signature: string,
    button: ReturnType<typeof ideasButton> | null,
  ) {
    let existing = pills.get(agentId);
    if (existing && (!button || existing.binding !== binding)) {
      existing.chip.remove();
      pills.delete(agentId);
      existing = undefined;
    }
    if (!button) return;
    if (existing) {
      if (existing.signature !== signature) {
        existing.chip.update(button);
        existing.signature = signature;
      }
    } else pills.set(agentId, { binding, signature, chip: client.addComposerPill({ id, workspaceId, agentId, button }) });
  }
  // Built in their own calls (Hermes, see chipButton). The content comes from the chip store, keyed by session.
  function ideasButton(state: ChipState) {
    return {
      title: t("Ideas for this card"),
      label: t("Ideas · {n}", { n: state.ideas.length }),
      icon: "Lightbulb",
      behavior: { kind: "popover" as const, Content: popovers!.ideas },
    };
  }
  /** NATIVE-SESSION-SPEC §6.1, §7.1: managed, live sessions of an active card only. */
  function syncExtras(current: LinkBoard, agents: readonly PaseoAgent[], tasks: Map<string, LinkBoard["tasks"][number]>) {
    if (!popovers || !chipInfo) return;
    const seen = new Set<string>();
    for (const actor of agents) {
      const task = actor.workspaceId ? tasks.get(actor.workspaceId) : undefined;
      const project = task && current.projects.find((p) => p.id === task.projectId);
      if (!task || !project || task.archivedAt || project.archivedAt || actor.archivedAt || !chipInfo.managed.has(actor.id)) continue;
      seen.add(actor.id);
      const finished = task.status === "done" || task.status === "cancelled";
      const moves = chipMoves({ events: current.events ?? [], agent: actor, cardFinished: finished, hidden: movesHidden });
      const ideas = chipInfo.ideas
        ? (current.ideas ?? []).filter((i) => i.taskId === task.id && i.status === "open").sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        : [];
      const state: ChipState = { task, project, agentId: actor.id, moves, ideas, autoWrapup: chipInfo.autoWrapup, nextMoveTap: chipInfo.nextMoveTap };
      setChipState(actor.id, state);
      const binding = JSON.stringify([task.id, task.workspaceId]);
      syncPill(ideaPills, "flowly-ideas", actor.id, task.workspaceId, binding,
        JSON.stringify(ideas.map((i) => [i.id, i.updatedAt])), ideas.length ? ideasButton(state) : null);
    }
    for (const agentId of [...ideaPills.keys()]) {
      if (seen.has(agentId)) continue;
      ideaPills.get(agentId)?.chip.remove();
      ideaPills.delete(agentId);
    }
    for (const agentId of chipStateIds()) if (!seen.has(agentId)) setChipState(agentId, null);
  }
  // The board screen re-reads and validates the link before showing anything
  // (fail-closed), so the chip only navigates. Keeping SDK/RPC calls out of
  // the press handler avoids host-specific failures in the action context.
  async function open(link: CardSessionLink) {
    if (disposed) return;
    await step(t("Couldn't open Flowly"), () =>
      client.openScreen({
        screenId: "board",
        params: { ...link, requestId: newRequestId() },
      }),
    );
  }
  // Built in its own call so the press handler keeps this chip's task and
  // session: Hermes gives loop-body `const`s one binding for the whole loop,
  // so a closure created in the loop would see the last iteration's values.
  function chipButton(task: LinkBoard["tasks"][number], sessionId: string) {
    const titleCharacters = Array.from(task.title);
    const link = { taskId: task.id, workspaceId: task.workspaceId, sessionId };
    return {
      title: t("Open Kanban task: {title}", { title: task.title }),
      label: t("Task · {title}", { title: titleCharacters.length > 28 ? titleCharacters.slice(0, 28).join("") + "…" : task.title }),
      icon: "PanelsTopLeft",
      behavior: {
        kind: "action" as const,
        onPress: () => open({ ...link, requestId: newRequestId() }),
      },
    };
  }
  // One round at a time: an extra request while a round runs queues exactly one more, right after it.
  let running = false,
    again = false;
  function refreshNow() {
    if (disposed) return;
    if (running) {
      again = true;
      return;
    }
    clearTimeout(timer);
    void refresh();
  }
  if (popovers) setChipRefresher(refreshNow);
  async function refresh() {
    running = true;
    try {
      const [boardResult, liveResult] = await Promise.allSettled([
        // The daemon may answer an etag with a patch of what changed, which readBoardDelta applies to the board held here.
        readBoardDelta((input) => client.rpc(readBoardChanged, input), board ?? undefined, etag && board ? etag : undefined),
        listAgents(client.paseo, undefined, false),
      ]);
      if (disposed) return;
      if (boardResult.status !== "fulfilled" || liveResult.status !== "fulfilled" || (!boardResult.value.value && !board)) {
        board = null;
        etag = "";
        clear();
        return;
      }
      const changed = !!boardResult.value.value;
      if (boardResult.value.value) board = boardResult.value.value;
      etag = boardResult.value.etag;
      const live = liveResult.value;
      const liveIds = new Set(live.map((a) => a.id));
      const archivedIds = new Set(archived.map((a) => a.id));
      // A chipped session that left the live list was probably just archived.
      const vanished = [...registrations.keys()].some((id) => !liveIds.has(id) && !archivedIds.has(id));
      if (changed || vanished || Date.now() - archivedAt >= archivedEvery) {
        const all = await listAgents(client.paseo, undefined, true);
        if (disposed) return;
        archived = all.filter((a) => !!a.archivedAt);
        archivedAt = Date.now();
      }
      // Managed sessions and the Ideas switch: when the board changed, else once a minute (a setting change alone).
      // A session in a card's workspace that is not known as managed yet may just have been prepared: check sooner.
      const unknown =
        !!chipInfo &&
        Date.now() - chipInfoAt >= 15_000 &&
        live.some((a) => !chipInfo!.managed.has(a.id) && !!a.workspaceId && board!.tasks.some((x) => x.workspaceId === a.workspaceId));
      if (popovers && (changed || unknown || !chipInfo || Date.now() - chipInfoAt >= archivedEvery)) {
        const info = await client.rpc(nativeChips, {}).catch(() => null);
        if (disposed) return;
        chipInfo = info
          ? { managed: new Set(info.managed.map((m) => m.agentId)), ideas: info.ideas, autoWrapup: info.autoWrapup, nextMoveTap: info.nextMoveTap }
          : chipInfo;
        chipInfoAt = Date.now();
      }
      const agents = [...live, ...archived.filter((a) => !liveIds.has(a.id))];
      const current = board!;
      const tasks = new Map(
        current.tasks
          .filter((t) => current.projects.some((p) => p.id === t.projectId))
          .map((t) => [t.workspaceId, t]),
      );
      const found = new Set<string>();
      for (const actor of agents) {
        const task = actor.workspaceId
          ? tasks.get(actor.workspaceId)
          : undefined;
        if (!task) continue;
        found.add(actor.id);
        const binding = JSON.stringify([task.id, task.workspaceId]);
        let existing = registrations.get(actor.id);
        if (existing && existing.binding !== binding) {
          existing.chip.remove();
          registrations.delete(actor.id);
          existing = undefined;
        }
        const button = chipButton(task, actor.id);
        // Updating a pill re-renders the host composer next to the user's input: only when its text changed.
        const label = `${button.label}\n${button.title}`;
        if (existing) {
          if (existing.label !== label) {
            existing.chip.update(button);
            existing.label = label;
          }
        } else
          registrations.set(actor.id, {
            binding,
            label,
            chip: client.addComposerPill({
              id: "kanban-task",
              workspaceId: task.workspaceId,
              agentId: actor.id,
              button,
            }),
          });
      }
      for (const [agentId, registration] of registrations) {
        if (!found.has(agentId)) {
          registration.chip.remove();
          registrations.delete(agentId);
        }
      }
      lastRound = { current, live, tasks };
      syncExtras(current, live, tasks);
    } catch {
      if (!disposed) clear();
    } finally {
      running = false;
      if (!disposed) {
        if (again) {
          again = false;
          void refresh();
        } else
          timer = setTimeout(() => {
            void refresh();
          }, interval);
      }
    }
  }
  if (startDelay > 0)
    timer = setTimeout(() => {
      void refresh();
    }, startDelay);
  else void refresh();
  return () => {
    disposed = true;
    latestClick++;
    clearTimeout(timer);
    stopHidden();
    clear();
    lastRound = null;
    if (popovers) {
      setChipClient(null);
      setChipRefresher(null);
    }
  };
}
