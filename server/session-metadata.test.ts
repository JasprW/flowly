import { afterEach, expect, test, vi } from "vitest";
import { SessionMetadataSync, taskMetadata, workspaceBindings } from "./session-metadata";
import { hostSupports, resetHostSupport } from "./host-support";

afterEach(() => resetHostSupport());

type Agent = { id: string; archivedAt?: string | null; metadata?: Record<string, unknown> | null };

type Workspace = { id: string; metadata?: Record<string, unknown> | null };

function fakePaseo(live: Agent[], setMetadata?: (id: string, patch: Record<string, string>) => Promise<void>, workspaces?: Workspace[]) {
  const list = vi.fn(async () => ({ entries: live.map((agent) => ({ agent })), pageInfo: { nextCursor: null } }));
  const writes: [string, Record<string, string>][] = [];
  const workspaceWrites: [string, Record<string, string | null>][] = [];
  const workspaceList = vi.fn(async () => ({ entries: workspaces ?? [], pageInfo: { nextCursor: null } }));
  const paseo = {
    ...(workspaces
      ? {
          workspaces: {
            list: workspaceList,
            ref: (id: string) => ({
              setMetadata: async (patch: Record<string, string | null>) => {
                workspaceWrites.push([id, patch]);
                // As Paseo does: top-level keys replace, null removes.
                const workspace = workspaces.find((w) => w.id === id)!;
                const next: Record<string, unknown> = { ...(workspace.metadata ?? {}) };
                for (const [key, value] of Object.entries(patch)) if (value === null) delete next[key]; else next[key] = value;
                workspace.metadata = next;
              },
            }),
          },
        }
      : {}),
    agents: {
      list,
      ref: (id: string) =>
        setMetadata === undefined
          ? {}
          : {
              setMetadata: async (patch: Record<string, string>) => {
                writes.push([id, patch]);
                await setMetadata(id, patch);
              },
            },
    },
  };
  return { paseo: paseo as never, list, writes, workspaceWrites, workspaceList };
}

test("writes the card and session ids on live managed sessions only, once per daemon run", async () => {
  const { paseo, writes, list } = fakePaseo([{ id: "a1" }, { id: "a2", metadata: { "flowly.taskId": "t2", "flowly.agentId": "a2" } }], async () => undefined);
  const sync = new SessionMetadataSync();
  await sync.sync(paseo, [{ agentId: "a1", taskId: "t1" }, { agentId: "a2", taskId: "t2" }, { agentId: "gone", taskId: "t3" }]);
  // a2 already carries the right ids (after a restart): not written again; "gone" is archived: skipped.
  expect(writes).toEqual([["a1", { "flowly.taskId": "t1", "flowly.agentId": "a1" }]]);
  await sync.sync(paseo, [{ agentId: "a1", taskId: "t1" }, { agentId: "a2", taskId: "t2" }, { agentId: "gone", taskId: "t3" }]);
  expect(writes).toHaveLength(1);
  // Nothing left to write: the live list is not read again.
  expect(list).toHaveBeenCalledTimes(1);
  expect(hostSupports("metadata")).toBe(true);
});

test("a session moved to another card is written again", async () => {
  const { paseo, writes } = fakePaseo([{ id: "a1" }], async () => undefined);
  const sync = new SessionMetadataSync();
  await sync.sync(paseo, [{ agentId: "a1", taskId: "t1" }]);
  await sync.sync(paseo, [{ agentId: "a1", taskId: "t9" }]);
  expect(writes.map(([, patch]) => patch["flowly.taskId"])).toEqual(["t1", "t9"]);
});

test.each([false, true])("a full pass keeps the rebound session's new metadata, then clears an actual unbind (cached: %s)", async (cached) => {
  const stored: Record<string, string> = { "flowly.taskId": "old", "flowly.agentId": "a1", other: "keep" };
  const { paseo, writes, list } = fakePaseo([], async (_id, patch) => {
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) delete stored[key];
      else stored[key] = value;
    }
  });
  // A daemon list is a snapshot: setMetadata does not change the copy already returned to this pass.
  list.mockImplementation(async () => ({ entries: [{ agent: { id: "a1", metadata: { ...stored } } }], pageInfo: { nextCursor: null } }));
  const sync = new SessionMetadataSync();
  if (cached) await sync.sync(paseo, [{ agentId: "a1", taskId: "old" }]);
  sync.changed();
  await sync.sync(paseo, [{ agentId: "a1", taskId: "new" }]);
  expect(writes).toEqual([["a1", { "flowly.taskId": "new", "flowly.agentId": "a1" }]]);
  expect(stored).toEqual({ "flowly.taskId": "new", "flowly.agentId": "a1", other: "keep" });

  sync.changed();
  await sync.sync(paseo, []);
  expect(writes[1]).toEqual(["a1", { "flowly.taskId": null, "flowly.agentId": null }]);
  expect(stored).toEqual({ other: "keep" });
});

test("an older host (refusal or no method) stops all writes until restart, without an error report", async () => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  const refused = fakePaseo([{ id: "a1" }, { id: "a2" }], async () => {
    throw new Error("Update the host to use metadata.");
  });
  const sync = new SessionMetadataSync();
  await sync.sync(refused.paseo, [{ agentId: "a1", taskId: "t1" }, { agentId: "a2", taskId: "t1" }]);
  expect(refused.writes).toHaveLength(1);
  await sync.sync(refused.paseo, [{ agentId: "a2", taskId: "t1" }]);
  expect(refused.list).toHaveBeenCalledTimes(1);

  resetHostSupport();
  const old = fakePaseo([{ id: "a1" }]);
  await new SessionMetadataSync().sync(old.paseo, [{ agentId: "a1", taskId: "t1" }]);
  expect(hostSupports("metadata")).toBe(false);
});

test("an archived session is looked at again after the recheck delay", async () => {
  let now = 0;
  const live: Agent[] = [];
  const { paseo, writes, list } = fakePaseo(live, async () => undefined);
  const sync = new SessionMetadataSync(() => now, 1000);
  await sync.sync(paseo, [{ agentId: "a1", taskId: "t1" }]);
  await sync.sync(paseo, [{ agentId: "a1", taskId: "t1" }]);
  expect(list).toHaveBeenCalledTimes(1);
  live.push({ id: "a1" });
  now = 1000;
  await sync.sync(paseo, [{ agentId: "a1", taskId: "t1" }]);
  expect(writes).toHaveLength(1);
});

test("a prepared session created after its first pass is retried without waiting for the offline recheck", async () => {
  const live: Agent[] = [];
  const { paseo, writes } = fakePaseo(live, async () => undefined);
  const sync = new SessionMetadataSync(() => 0);
  const managed = [{ agentId: "new", taskId: "t1" }];
  await sync.sync(paseo, managed);
  expect(writes).toEqual([]);
  live.push({ id: "new" });
  sync.created(paseo, "new");
  await sync.sync(paseo, managed);
  expect(writes).toEqual([["new", { "flowly.taskId": "t1", "flowly.agentId": "new" }]]);
});

test("after a board write, a session whose card is gone is cleared; background agents are left alone", async () => {
  const { paseo, writes } = fakePaseo(
    [
      { id: "a1", metadata: { "flowly.taskId": "t1", "flowly.agentId": "a1" } },
      { id: "a2", metadata: { "flowly.taskId": "deleted", "flowly.agentId": "a2" } },
      { id: "bg", metadata: { "flowly.taskId": "deleted" } },
      { id: "other" },
    ],
    async () => undefined,
  );
  const sessions = [{ agentId: "a1", taskId: "t1" }];
  const sync = new SessionMetadataSync(Date.now, 1000, async () => ({ sessions, workspaces: [] }), 0);
  sync.attach(paseo);
  sync.changed();
  await vi.waitFor(() => expect(writes).toEqual([["a2", { "flowly.taskId": null, "flowly.agentId": null }]]));
});

test("card workspaces get their card's id; a deleted card's workspace is cleared, others are not touched", async () => {
  const workspaces: Workspace[] = [{ id: "w1" }, { id: "w2", metadata: { "flowly.taskId": "t2" } }, { id: "w3", metadata: { "flowly.taskId": "gone" } }, { id: "w4" }];
  const { paseo, workspaceWrites } = fakePaseo([], async () => undefined, workspaces);
  const sync = new SessionMetadataSync();
  const bound = workspaceBindings({ tasks: [{ id: "t1", workspaceId: "w1" }, { id: "t2", workspaceId: "w2" }] });
  // The first pass after a start looks at every value (a card may have been deleted while the daemon was down).
  await sync.sync(paseo, [], bound);
  expect(workspaceWrites).toEqual([["w1", { "flowly.taskId": "t1" }], ["w3", { "flowly.taskId": null }]]);
  // Later chip rounds with nothing new do not list again; a value that went stale waits for the next board write.
  workspaces.push({ id: "w5", metadata: { "flowly.taskId": "gone" } });
  await sync.sync(paseo, [], bound);
  expect(workspaceWrites).toHaveLength(2);
  sync.changed();
  await sync.sync(paseo, [], bound);
  expect(workspaceWrites.slice(2)).toEqual([["w5", { "flowly.taskId": null }]]);
});

test("background agents get the card id at creation only once the host was seen to take metadata", async () => {
  expect(taskMetadata("t1")).toEqual({});
  const { paseo } = fakePaseo([{ id: "a1" }], async () => undefined);
  await new SessionMetadataSync().sync(paseo, [{ agentId: "a1", taskId: "t1" }]);
  expect(taskMetadata("t1")).toEqual({ metadata: { "flowly.taskId": "t1" } });
});

test("a full pass repairs session and workspace mirrors even when they were cached as correct", async () => {
  const agent: Agent = { id: "a1", metadata: { "flowly.taskId": "t1", "flowly.agentId": "a1", other: "keep" } };
  const workspace: Workspace = { id: "w1", metadata: { "flowly.taskId": "t1", other: "keep" } };
  const { paseo, writes, workspaceWrites, list } = fakePaseo([agent], async (_id, patch) => {
    agent.metadata = { ...agent.metadata, ...patch };
  }, [workspace]);
  const sync = new SessionMetadataSync();
  const managed = [{ agentId: "a1", taskId: "t1" }];
  const bound = [{ workspaceId: "w1", taskId: "t1" }];
  await sync.sync(paseo, managed, bound);
  expect(writes).toEqual([]);
  expect(workspaceWrites).toEqual([]);
  agent.metadata = { ...agent.metadata, "flowly.taskId": "wrong" };
  workspace.metadata = { ...workspace.metadata, "flowly.taskId": "wrong" };
  sync.changed();
  await sync.sync(paseo, managed, bound);
  expect(agent.metadata).toEqual({ "flowly.taskId": "t1", "flowly.agentId": "a1", other: "keep" });
  expect(workspace.metadata).toEqual({ "flowly.taskId": "t1", other: "keep" });
  await sync.sync(paseo, managed, bound);
  expect(list).toHaveBeenCalledTimes(2);
});

test("a failed full-pass listing is retried after the last binding is removed", async () => {
  const { paseo, list, writes } = fakePaseo([{ id: "a1", metadata: { "flowly.taskId": "t1", "flowly.agentId": "a1" } }], async () => undefined);
  const sync = new SessionMetadataSync();
  await sync.sync(paseo, [{ agentId: "a1", taskId: "t1" }]);
  sync.changed();
  list.mockRejectedValueOnce(new Error("connection closed"));
  await sync.sync(paseo, []);
  expect(writes).toEqual([]);
  await sync.sync(paseo, []);
  expect(writes).toEqual([["a1", { "flowly.taskId": null, "flowly.agentId": null }]]);
});

test("a failed metadata write remains eligible for the next existing sync round", async () => {
  const write = vi.fn(async () => undefined).mockRejectedValueOnce(new Error("connection closed"));
  const { paseo, writes } = fakePaseo([{ id: "a1" }], write);
  const sync = new SessionMetadataSync();
  const managed = [{ agentId: "a1", taskId: "t1" }];
  await sync.sync(paseo, managed);
  expect(writes).toHaveLength(1);
  await sync.sync(paseo, managed);
  expect(writes).toHaveLength(2);
  await sync.sync(paseo, managed);
  expect(writes).toHaveLength(2);
});


test("absent bound workspaces defer repeated reads, then recheck on deadline or board change", async () => {
  let now = 0;
  const workspaces: Workspace[] = [];
  const { paseo, list, workspaceList, workspaceWrites } = fakePaseo([], async () => undefined, workspaces);
  const sync = new SessionMetadataSync(() => now, 1000);
  const bound = [{ workspaceId: "archived", taskId: "t1" }];
  await sync.sync(paseo, [], bound);
  await sync.sync(paseo, [], bound);
  now = 999;
  await sync.sync(paseo, [], bound);
  expect(list).toHaveBeenCalledTimes(1);
  expect(workspaceList).toHaveBeenCalledTimes(1);
  now = 1000;
  await sync.sync(paseo, [], bound);
  expect(workspaceList).toHaveBeenCalledTimes(2);
  workspaces.push({ id: "archived" });
  sync.changed();
  await sync.sync(paseo, [], bound);
  expect(workspaceWrites).toEqual([["archived", { "flowly.taskId": "t1" }]]);
});

test("workspace write failures stay eligible for the next existing round", async () => {
  const { paseo, workspaceList } = fakePaseo([], async () => undefined, [{ id: "w1" }]);
  const write = vi.fn(async () => undefined).mockRejectedValueOnce(new Error("connection closed"));
  Object.assign(paseo, { workspaces: { list: workspaceList, ref: () => ({ setMetadata: write }) } });
  const sync = new SessionMetadataSync();
  const bound = [{ workspaceId: "w1", taskId: "t1" }];
  await sync.sync(paseo, [], bound);
  expect(write).toHaveBeenCalledTimes(1);
  await sync.sync(paseo, [], bound);
  expect(write).toHaveBeenCalledTimes(2);
});

test.each([false, true])("a creation during a slow pass gets one fresh pass, without looping after failure (%s)", async (fail) => {
  vi.useFakeTimers();
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const live: Agent[] = [];
  const write = vi.fn(async () => undefined);
  if (fail) write.mockRejectedValueOnce(new Error("connection closed"));
  const { paseo, list, writes } = fakePaseo(live, write);
  list.mockImplementationOnce(async () => {
    await blocked;
    return { entries: [], pageInfo: { nextCursor: null } };
  });
  let sessions: { agentId: string; taskId: string }[] = [];
  const bindings = vi.fn(async () => ({ sessions, workspaces: [] }));
  const sync = new SessionMetadataSync(Date.now, 120000, bindings);
  sync.attach(paseo);
  try {
    const first = sync.fromBindings();
    await vi.advanceTimersByTimeAsync(0);
    sessions = [{ agentId: "new", taskId: "t1" }];
    live.push({ id: "new" });
    sync.created(paseo, "new");
    await vi.advanceTimersByTimeAsync(1000);
    release();
    await first;
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toEqual(["new", { "flowly.taskId": "t1", "flowly.agentId": "new" }]);
    expect(bindings).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60000);
    expect(writes).toHaveLength(1);
    if (fail) {
      await sync.fromBindings();
      expect(writes).toHaveLength(2);
    }
  } finally {
    release();
    sync.stop();
    vi.useRealTimers();
  }
});

test("a creation while bindings are being read gets a fresh pass after the old snapshot", async () => {
  vi.useFakeTimers();
  let releaseBindings!: () => void, releasePass!: () => void;
  const blockedBindings = new Promise<void>((resolve) => { releaseBindings = resolve; });
  const blockedPass = new Promise<void>((resolve) => { releasePass = resolve; });
  let sessions: { agentId: string; taskId: string }[] = [];
  const live: Agent[] = [];
  const { paseo, list, writes } = fakePaseo(live, async () => undefined);
  list.mockImplementationOnce(async () => {
    await blockedPass;
    return { entries: [], pageInfo: { nextCursor: null } };
  });
  const bindings = vi.fn(async () => ({ sessions, workspaces: [] })).mockImplementationOnce(async () => {
    const snapshot = { sessions, workspaces: [] };
    await blockedBindings;
    return snapshot;
  });
  const sync = new SessionMetadataSync(Date.now, 120000, bindings);
  sync.attach(paseo);
  try {
    const first = sync.fromBindings();
    await vi.advanceTimersByTimeAsync(0);
    sessions = [{ agentId: "new", taskId: "t1" }];
    live.push({ id: "new" });
    sync.created(paseo, "new");
    releaseBindings();
    await vi.advanceTimersByTimeAsync(1000);
    expect(list).toHaveBeenCalledTimes(1);
    releasePass();
    await first;
    await vi.waitFor(() => expect(writes).toEqual([["new", { "flowly.taskId": "t1", "flowly.agentId": "new" }]]));
    expect(bindings).toHaveBeenCalledTimes(2);
  } finally {
    releaseBindings();
    releasePass();
    sync.stop();
    vi.useRealTimers();
  }
});

test.each([false, true])("a deletion during the bindings read still runs full cleanup (cached: %s)", async (cached) => {
  vi.useFakeTimers();
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  let sessions = [{ agentId: "a1", taskId: "t1" }];
  let bound = [{ workspaceId: "w1", taskId: "t1" }];
  const stored: Record<string, string> = { "flowly.taskId": "t1", "flowly.agentId": "a1", other: "keep" };
  const workspace: Workspace = { id: "w1", metadata: { "flowly.taskId": "t1", other: "keep" } };
  const { paseo, list } = fakePaseo([], async (_id, patch) => {
    for (const [key, value] of Object.entries(patch)) if (value === null) delete stored[key]; else stored[key] = value;
  }, [workspace]);
  list.mockImplementation(async () => ({ entries: [{ agent: { id: "a1", metadata: { ...stored } } }], pageInfo: { nextCursor: null } }));
  const bindings = vi.fn(async () => ({ sessions, workspaces: bound })).mockImplementationOnce(async () => {
    const snapshot = { sessions, workspaces: bound };
    await blocked;
    return snapshot;
  });
  const sync = new SessionMetadataSync(Date.now, 120000, bindings);
  sync.attach(paseo);
  try {
    if (cached) await sync.sync(paseo, sessions, bound);
    const first = sync.fromBindings();
    await vi.advanceTimersByTimeAsync(0);
    sessions = [];
    bound = [];
    sync.changed();
    release();
    await first;
    await vi.waitFor(() => {
      expect(stored).toEqual({ other: "keep" });
      expect(workspace.metadata).toEqual({ other: "keep" });
    });
    expect(bindings).toHaveBeenCalledTimes(2);
  } finally {
    release();
    sync.stop();
    vi.useRealTimers();
  }
});
