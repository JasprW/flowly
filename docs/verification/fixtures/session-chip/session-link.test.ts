import { afterEach, describe, expect, test, vi } from "vitest";
import { readBoardChanged } from "../../../../shared/rpc";

/** board.read-changed response carrying a full board (the chip poll reads by etag since 2026-10-18). */
const changed = (value: unknown) => ({ etag: "e1", value });
import {
  parseSessionLink,
  registerSessionChips,
  resolveSessionLink,
  sessionLinkKey,
} from "../../../../client/session-link";

const link = {
  taskId: "task-a",
  sessionId: "session-a",
  workspaceId: "workspace-a",
  requestId: "request-a",
};
const task: any = {
  id: link.taskId,
  projectId: "project-a",
  workspaceId: link.workspaceId,
  title: "Linked task",
};
const project: any = { id: task.projectId, title: "Project" };
const board: any = { projects: [project], tasks: [task], events: [] };
const actor: any = {
  id: link.sessionId,
  workspaceId: link.workspaceId,
  title: "Session",
  archivedAt: "2026-10-14T00:00:00Z",
};
const page = (agents: any[], nextCursor: string | null = null) => ({
  entries: agents.map((agent) => ({ agent })),
  pageInfo: { nextCursor },
});

afterEach(() => vi.useRealTimers());

describe("session chip links", () => {
  test("parses full links, ignores ordinary board params, and rejects partial or oversized links", () => {
    expect(parseSessionLink(undefined)).toBeNull();
    expect(parseSessionLink({} as any)).toBeNull();
    expect(parseSessionLink({ projectId: "project-a" } as any)).toBeNull();
    expect(parseSessionLink(link as any)).toEqual(link);
    expect(sessionLinkKey(link)).toBe(JSON.stringify([
      link.taskId, link.sessionId, link.workspaceId, link.requestId,
    ]));
    expect(() => parseSessionLink({ taskId: link.taskId } as any)).toThrow(/Open it again/);
    expect(() => parseSessionLink({ ...link, requestId: "x".repeat(201) } as any)).toThrow(/Invalid/);
  });

  test("resolves a fresh board and the exact current actor; rejects moved or missing scope", async () => {
    const paseo: any = {
      agents: { ref: vi.fn(() => ({ refresh: vi.fn(async () => ({ agent: actor })) })) },
    };
    const resolved = await resolveSessionLink(paseo, async () => board, link);
    expect(resolved).toEqual({ board, task, project, actor, link });
    expect(paseo.agents.ref).toHaveBeenCalledWith(link.sessionId);
    await expect(resolveSessionLink(paseo, async () => ({ ...board, tasks: [] }), link)).rejects.toThrow(/linked card is unavailable/);
    const moved = { ...actor, workspaceId: "workspace-other" };
    paseo.agents.ref.mockReturnValue({ refresh: async () => ({ agent: moved }) });
    await expect(resolveSessionLink(paseo, async () => board, link)).rejects.toThrow(/workspace changed/);
  });

  test("registers linked paginated archived actors on the owning host and removes stale chips", async () => {
    vi.useFakeTimers();
    const first = { ...actor, id: "session-a" };
    const second = { ...actor, id: "session-b" };
    const unrelated = { ...actor, id: "session-unlinked", workspaceId: "elsewhere" };
    // Live sessions are listed each round (paginated); the archived scan finds none here.
    let liveRounds = 0;
    const list = vi.fn(async ({ filter, page: { cursor } }: any) => {
      if (filter.includeArchived) return page([]);
      if (!cursor) liveRounds++;
      if (liveRounds > 1) return page([second]);
      return cursor ? page([second]) : page([first, unrelated], "next");
    });
    const rpc = vi.fn(async (schema: unknown) => {
      expect(schema).toBe(readBoardChanged);
      return changed(board);
    });
    const pills = new Map<string, any>();
    const openScreen = vi.fn();
    const client: any = {
      paseo: { agents: { list, ref: vi.fn(() => ({ refresh: async () => ({ agent: first }) })) } },
      rpc,
      openScreen,
      addComposerPill: vi.fn((registration: any) => {
        const chip = {
          registration,
          update: vi.fn((button: any) => { chip.registration.button = button; }),
          remove: vi.fn(() => pills.delete(registration.agentId)),
        };
        pills.set(registration.agentId, chip);
        return chip;
      }),
    };
    const dispose = registerSessionChips(client, 100, 0);
    await vi.waitFor(() => expect(pills.size).toBe(2));
    expect(list).toHaveBeenCalledWith({ filter: { includeArchived: false }, page: { limit: 200, cursor: undefined } });
    expect(list).toHaveBeenCalledWith({ filter: { includeArchived: false }, page: { limit: 200, cursor: "next" } });
    expect([...pills.keys()].sort()).toEqual(["session-a", "session-b"]);
    const chip = pills.get("session-a");
    expect(chip.registration).toMatchObject({ workspaceId: link.workspaceId, agentId: "session-a" });
    expect(chip.registration.button.label).toBe("Task · Linked task");
    expect(chip.registration.button.title).toBe("Open Kanban task: Linked task");

    await vi.advanceTimersByTimeAsync(100);
    expect(pills.size).toBe(1);
    expect(pills.has("session-a")).toBe(false);
    expect(pills.has("session-b")).toBe(true);
    dispose();
    expect(pills.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(openScreen).not.toHaveBeenCalled();
  });

  test("truncates chip titles by Unicode code point without splitting emoji", async () => {
    const longTitle = `${"a".repeat(27)}😀tail`;
    const titledBoard = { ...board, tasks: [{ ...task, title: longTitle }] };
    const registrations = new Map<string, any>();
    const client: any = {
      paseo: { agents: { list: vi.fn().mockResolvedValue(page([actor])) } },
      rpc: vi.fn().mockResolvedValue(changed(titledBoard)),
      openScreen: vi.fn(),
      addComposerPill: vi.fn((item: any) => {
        const registration = { item, update: vi.fn(), remove: vi.fn() };
        registrations.set(item.agentId, registration);
        return registration;
      }),
    };
    const dispose = registerSessionChips(client, 50_000, 0);
    await vi.waitFor(() => expect(registrations.size).toBe(1));
    const label = registrations.get(actor.id).item.button.label;
    expect(label.endsWith("😀…")).toBe(true);
    expect(Array.from(label.split(" · ")[1]).length).toBe(29);
    dispose();
  });

  test("does not overlap refreshes; lookup failure clears registrations and retries", async () => {
    vi.useFakeTimers();
    let finishBoard!: (value: any) => void;
    const boardRead = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { finishBoard = resolve; }))
      .mockResolvedValueOnce(changed(board));
    const list = vi.fn().mockResolvedValue(page([actor]));
    const client: any = {
      paseo: { agents: { list, ref: vi.fn() } },
      // The archived scan is its own RPC now; only board reads are counted here.
      rpc: (def: { name?: string }, ...args: unknown[]) => (def.name === "sessions.archived-refs" ? Promise.resolve([]) : (boardRead as any)(def, ...args)),
      openScreen: vi.fn(),
      addComposerPill: vi.fn(() => ({ update: vi.fn(), remove: vi.fn() })),
    };
    const dispose = registerSessionChips(client, 10, 0);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(100);
    expect(boardRead).toHaveBeenCalledTimes(1);
    finishBoard(changed(board));
    await Promise.resolve();
    await Promise.resolve();
    expect(boardRead).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10);
    await Promise.resolve();
    expect(boardRead).toHaveBeenCalledTimes(2);
    dispose();

    const chipRemove = vi.fn();
    const failureClient: any = {
      paseo: { agents: { list: vi.fn().mockResolvedValue(page([actor])) } },
      rpc: vi.fn().mockResolvedValueOnce(changed(board)).mockRejectedValueOnce(new Error("offline")),
      openScreen: vi.fn(),
      addComposerPill: vi.fn(() => ({ update: vi.fn(), remove: chipRemove })),
    };
    const stop = registerSessionChips(failureClient, 10, 0);
    await vi.waitFor(() => expect(failureClient.addComposerPill).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(10);
    await vi.waitFor(() => expect(chipRemove).toHaveBeenCalledTimes(1));
    stop();
  });

  test("chip action navigates directly with a fresh request; the board screen validates", async () => {
    vi.useFakeTimers();
    const registrations = new Map<string, any>();
    const opened: any[] = [];
    const refreshActor = vi.fn();
    const list = vi.fn().mockResolvedValue(page([actor, { ...actor, id: "session-b" }]));
    const client: any = {
      paseo: { agents: { list, ref: (id: string) => refreshActor(id) } },
      rpc: vi.fn().mockResolvedValue(changed(board)),
      openScreen: vi.fn((route: any) => opened.push(route)),
      addComposerPill: vi.fn((item: any) => {
        const reg = { item, update: vi.fn(), remove: vi.fn() };
        registrations.set(item.agentId, reg);
        return reg;
      }),
    };
    const dispose = registerSessionChips(client, 5000, 0);
    await vi.waitFor(() => expect(registrations.size).toBe(2));
    const rpcCalls = client.rpc.mock.calls.length;
    await registrations.get("session-b").item.button.behavior.onPress();
    await registrations.get("session-b").item.button.behavior.onPress();
    expect(refreshActor).not.toHaveBeenCalled();
    expect(client.rpc.mock.calls.length).toBe(rpcCalls);
    expect(opened).toHaveLength(2);
    expect(opened[0]).toMatchObject({
      screenId: "board",
      params: { taskId: link.taskId, sessionId: "session-b", workspaceId: link.workspaceId },
    });
    expect(opened[0].params.requestId).not.toBe(opened[1].params.requestId);
    client.openScreen.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    await expect(registrations.get("session-a").item.button.behavior.onPress()).rejects.toThrow(
      "Couldn't open Flowly: boom",
    );
    dispose();
    await registrations.get("session-a").item.button.behavior.onPress();
    expect(opened).toHaveLength(2);
  });

  test("teardown fences late lookup completions and removes only owned chips", async () => {
    let resolveBoard!: (value: any) => void;
    const remove = vi.fn();
    const openScreen = vi.fn();
    const client: any = {
      paseo: { agents: { list: vi.fn().mockResolvedValue(page([actor])) } },
      rpc: vi.fn(() => new Promise((resolve) => { resolveBoard = resolve; })),
      openScreen,
      addComposerPill: vi.fn(() => ({ update: vi.fn(), remove })),
    };
    const dispose = registerSessionChips(client, 10, 0);
    dispose();
    resolveBoard(changed(board));
    await Promise.resolve();
    await Promise.resolve();
    expect(client.addComposerPill).not.toHaveBeenCalled();
    expect(openScreen).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });
});
