import { afterEach, expect, test, vi } from "vitest";
import { SessionMetadataSync } from "./session-metadata";
import { hostSupports, resetHostSupport } from "./host-support";

afterEach(() => resetHostSupport());

type Agent = { id: string; archivedAt?: string | null; metadata?: Record<string, unknown> | null };


function fakePaseo(live: Agent[], setMetadata?: (id: string, patch: Record<string, string>) => Promise<void>) {
  const list = vi.fn(async () => ({ entries: live.map((agent) => ({ agent })), pageInfo: { nextCursor: null } }));
  const writes: [string, Record<string, string>][] = [];
  const paseo = {
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
  return { paseo: paseo as never, list, writes };
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
  const sync = new SessionMetadataSync(Date.now, 1000, async () => ({ sessions }), 0);
  sync.attach(paseo);
  sync.changed();
  await vi.waitFor(() => expect(writes).toEqual([["a2", { "flowly.taskId": null, "flowly.agentId": null }]]));
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
