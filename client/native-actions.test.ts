import { expect, test, vi } from "vitest";
import { CARD_UNAVAILABLE } from "../shared/card-detail";
import { continueIdea, dismissIdea, moveToDone, newCardFromIdea, wrapupNeed, wrapupNow } from "./native-actions";

const at = (s: number) => `2026-10-20T00:00:0${s}.000Z`;
function fake() {
  const state = {
    task: { id: "t1", projectId: "p", workspaceId: "w1", title: "Card", status: "development", revision: 7, archivedAt: null },
    events: [{ id: "ev1", taskId: "t1", actor: "agent", action: "next_moves_suggested", agentId: "a1", at: at(1), moves: [{ label: "Verify", prompt: "Verify it" }] }] as unknown[],
    ideas: [{ id: "i1", taskId: "t1", projectId: "p", status: "open" }],
    autoWrapup: false,
    offline: false,
    check: { blockers: [] as string[], warnings: [] as string[], revision: 8, workspace: { id: "w1" } as unknown, archiveWorkspace: true, sessions: 1 },
  };
  const calls: { name: string; input: unknown }[] = [];
  const sent: { agentId: string; text: string }[] = [];
  const client = {
    rpc: vi.fn(async (def: { name: string }, input: unknown) => {
      calls.push({ name: def.name, input });
      if (state.offline) throw new Error("Network request failed");
      if (def.name === "board.read" || def.name === "board.read-changed") throw new Error("the whole board must not be read");
      if (def.name === "cards.detail-changed") {
        const { taskId, workspaceId } = input as { taskId: string; workspaceId: string };
        if (taskId !== state.task.id || workspaceId !== state.task.workspaceId) throw new Error(CARD_UNAVAILABLE);
        return { etag: "e", value: { task: state.task, events: state.events } };
      }
      if (def.name === "projects.ideas-changed") return { etag: "e", value: { ideas: (input as { projectId: string }).projectId === "p" ? state.ideas : [] } };
      if (def.name === "tasks.context") return { available: true, reason: "", context: "" };
      if (def.name === "tasks.update") return { ...state.task, status: "done", revision: 8 };
      if (def.name === "tasks.wrapup-check") return { taskId: "t1", ...state.check };
      if (def.name === "sessions.native-chips") return { managed: [], ideas: true, autoWrapup: state.autoWrapup, nextMoveTap: "fill" };
      return {};
    }),
    paseo: {
      agents: {
        ref: (agentId: string) => ({
          refresh: async () => ({ agent: { id: agentId, workspaceId: "w1", status: "idle", archivedAt: null } }),
          send: async (text: string) => void sent.push({ agentId, text }),
        }),
      },
    },
    openScreen: vi.fn(),
  };
  return { client, state, calls, sent };
}

test("moveToDone uses the card's fresh revision while the suggestion is current", async () => {
  const x = fake();
  expect(await moveToDone(x.client as never, { taskId: "t1", workspaceId: "w1", agentId: "a1", eventId: "ev1" })).toMatchObject({ status: "done" });
  expect(x.calls.find((c) => c.name === "tasks.update")?.input).toEqual({ id: "t1", revision: 7, status: "done" });
});

test("moveToDone refuses a stale suggestion and a card that is already finished", async () => {
  const x = fake();
  x.state.events.push({ id: "ev2", taskId: "t1", actor: "system", action: "agent.turn_started", agentId: "a1", at: at(2) });
  await expect(moveToDone(x.client as never, { taskId: "t1", workspaceId: "w1", agentId: "a1", eventId: "ev1" })).rejects.toThrow(/no longer current/);
  const y = fake();
  y.state.task.status = "done";
  await expect(moveToDone(y.client as never, { taskId: "t1", workspaceId: "w1", agentId: "a1", eventId: "ev1" })).rejects.toThrow(/already/);
  expect([...x.calls, ...y.calls].some((c) => c.name === "tasks.update")).toBe(false);
});

test("wrapupNeed: nothing to archive asks nothing; blockers or warnings go to Flowly", async () => {
  const x = fake();
  Object.assign(x.state.check, { workspace: null, archiveWorkspace: false, sessions: 0 });
  expect(await wrapupNeed(x.client as never, { taskId: "t1" })).toBe("none");
  Object.assign(x.state.check, { workspace: { id: "w1" }, archiveWorkspace: false, sessions: 0 });
  expect(await wrapupNeed(x.client as never, { taskId: "t1" })).toBe("none");
  Object.assign(x.state.check, { sessions: 2 });
  expect(await wrapupNeed(x.client as never, { taskId: "t1" })).toBe("ask");
  x.state.check.warnings = ["2 uncommitted changes"];
  expect(await wrapupNeed(x.client as never, { taskId: "t1" })).toBe("needs-flowly");
});

test("wrapupNow leaves blockers and warnings to Flowly, else wraps up keeping the card", async () => {
  const x = fake();
  x.state.check.warnings = ["2 uncommitted changes"];
  expect(await wrapupNow(x.client as never, { taskId: "t1" })).toBe("needs-flowly");
  expect(x.calls.some((c) => c.name === "tasks.wrapup")).toBe(false);
  x.state.check.warnings = [];
  expect(await wrapupNow(x.client as never, { taskId: "t1" })).toBe("done");
  expect(x.calls.find((c) => c.name === "tasks.wrapup")?.input).toEqual({ id: "t1", revision: 8, acknowledgeWarnings: false, keepCard: true });
});

test("idea actions re-check the idea is open; New card opens the board with the idea", async () => {
  const x = fake();
  await continueIdea(x.client as never, { ideaId: "i1", projectId: "p", agentId: "a1" });
  expect(x.calls.find((c) => c.name === "ideas.adopt")?.input).toEqual({ id: "i1", agentId: "a1" });
  x.state.ideas[0].status = "dismissed";
  await expect(continueIdea(x.client as never, { ideaId: "i1", projectId: "p", agentId: "a1" })).rejects.toThrow(/no longer open/);
  await expect(dismissIdea(x.client as never, { ideaId: "i1", projectId: "p" })).rejects.toThrow(/no longer open/);
  x.state.ideas[0].status = "open";
  await dismissIdea(x.client as never, { ideaId: "i1", projectId: "p" });
  expect(x.calls.find((c) => c.name === "ideas.update")?.input).toEqual({ id: "i1", status: "dismissed" });
  newCardFromIdea(x.client as never, { ideaId: "i1", projectId: "p" });
  expect(x.client.openScreen).toHaveBeenCalledWith({ screenId: "board", params: { ideaId: "i1", projectId: "p", requestId: expect.any(String) } });
});

test("wrapupNeed reads Auto wrap up fresh: on, nothing is asked (the daemon wraps up)", async () => {
  const x = fake();
  Object.assign(x.state.check, { sessions: 2 });
  expect(await wrapupNeed(x.client as never, { taskId: "t1" })).toBe("ask");
  x.state.autoWrapup = true;
  expect(await wrapupNeed(x.client as never, { taskId: "t1" })).toBe("none");
});

test("outside session ideas go to the daemon with their target", async () => {
  const { runSessionIdea, dismissSessionIdea } = await import("./native-actions");
  const x = fake();
  await runSessionIdea(x.client as never, { agentId: "a9", ideaId: "i9", target: "workspace" });
  await dismissSessionIdea(x.client as never, { agentId: "a9", ideaId: "i8" });
  expect(x.calls.filter((c) => c.name.startsWith("sessions.idea"))).toEqual([
    { name: "sessions.idea-run", input: { agentId: "a9", ideaId: "i9", target: "workspace" } },
    { name: "sessions.idea-dismiss", input: { agentId: "a9", ideaId: "i8" } },
  ]);
});

test("each action reads only its own card or project", async () => {
  const x = fake();
  await moveToDone(x.client as never, { taskId: "t1", workspaceId: "w1", agentId: "a1", eventId: "ev1" });
  await dismissIdea(x.client as never, { ideaId: "i1", projectId: "p" });
  expect(x.calls.map((c) => c.name)).toEqual(["cards.detail-changed", "tasks.update", "projects.ideas-changed", "ideas.update"]);
});

test("a gone card or idea says so; a failed read reports the failure instead", async () => {
  const x = fake();
  await expect(moveToDone(x.client as never, { taskId: "gone", workspaceId: "w1", agentId: "a1", eventId: "ev1" })).rejects.toThrow(/This card is unavailable/);
  await expect(dismissIdea(x.client as never, { ideaId: "missing", projectId: "p" })).rejects.toThrow(/no longer open/);
  x.state.offline = true;
  await expect(moveToDone(x.client as never, { taskId: "t1", workspaceId: "w1", agentId: "a1", eventId: "ev1" })).rejects.toThrow("Network request failed");
  await expect(dismissIdea(x.client as never, { ideaId: "i1", projectId: "p" })).rejects.toThrow("Network request failed");
  expect(x.calls.slice(-2).map((c) => c.name)).toEqual(["cards.detail-changed", "projects.ideas-changed"]);
});
