import { afterEach, expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { agentFixture } from "./agent-fixture";
import type { AgentService } from "./agent-service";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
async function setup() {
  const f = await agentFixture({ tags: false });
  roots.push(f.root);
  return f;
}
const input = (ctx: Awaited<ReturnType<AgentService["get"]>>) => ({ expectedRevision: ctx.revision, request: ctx.request });

test("drawer tag edits change only the board revision and record an event", async () => {
  const x = await setup();
  const before = await x.store.read();
  const task = await x.store.editTags({ taskId: "t", add: ["Drawer", "#perf"] });
  expect(task.tags?.map((t) => [t.tag, t.by])).toEqual([["drawer", "human"], ["perf", "human"]]);
  let board = await x.store.read();
  expect(board.revision).toBe(before.revision + 1);
  expect(board.tasks[0].revision).toBe(1);
  expect(board.events.at(-1)).toMatchObject({ action: "tags_changed", actor: "human", note: "+drawer +perf" });
  // No change: no write, no event.
  await x.store.editTags({ taskId: "t", add: ["drawer"], remove: ["missing"] });
  expect((await x.store.read()).revision).toBe(board.revision);
  await x.store.editTags({ taskId: "t", remove: ["drawer", "perf"] });
  board = await x.store.read();
  expect("tags" in board.tasks[0]).toBe(false);
  expect(board.events.at(-1)?.note).toBe("−drawer −perf");
  await expect(x.store.editTags({ taskId: "t", add: ["bad!"] })).rejects.toThrow("letters, numbers");
});

test("form edits merge against what the form opened with and bump the card revision", async () => {
  const x = await setup();
  await x.store.editTags({ taskId: "t", add: ["drawer", "old"] });
  // An agent adds a tag after the form opened.
  const ctx = await x.service.get(x.identity);
  await x.service.write(x.identity, "tags", { ...input(ctx), add: ["perf"] });
  const edited = await x.store.editTask({ id: "t", revision: 1, actor: "human", tags: ["drawer", "a11y"], tagsBase: ["drawer", "old"] });
  expect(edited.tags?.map((t) => t.tag)).toEqual(["drawer", "perf", "a11y"]);
  expect(edited.revision).toBe(2);
  const board = await x.store.read();
  expect(board.events.slice(-2).map((e) => e.action)).toEqual(["edited", "tags_changed"]);
  await expect(x.store.editTask({ id: "t", revision: 2, actor: "human", tags: ["x"] })).rejects.toThrow("sent together");
});

test("agent tool: adds once, replays, refuses invalid values whole, can't remove human tags, keeps task revision", async () => {
  const x = await setup();
  await x.store.editTags({ taskId: "t", add: ["drawer"] });
  let ctx = await x.service.get(x.identity);
  expect(ctx.task.tags?.map((t) => t.tag)).toEqual(["drawer"]);
  expect(ctx.projectTags).toEqual([{ tag: "drawer", count: 1 }]);
  const added = await x.service.write(x.identity, "tags", { ...input(ctx), add: ["Perf", "drawer"] });
  expect(added.receipt.taskRevision).toBe(ctx.revision.task);
  expect(added.current?.task.tags).toEqual([
    expect.objectContaining({ tag: "drawer", by: "human" }),
    expect.objectContaining({ tag: "perf", by: "agent", agentId: "actor" }),
  ]);
  const replay = await x.service.write(x.identity, "tags", { ...input(ctx), add: ["Perf", "drawer"] });
  expect(replay.replayed).toBe(true);
  ctx = await x.service.get(x.identity);
  // Same revision still valid after an agent tag write: the request just needs to be fresh.
  await expect(x.service.write(x.identity, "tags", { ...input(ctx), add: ["ok", "bad!"] })).rejects.toMatchObject({ code: "TAG_INVALID" });
  expect((await x.store.read()).tasks[0].tags).toHaveLength(2);
  await expect(x.service.write(x.identity, "tags", { ...input(ctx), remove: ["drawer"] })).rejects.toMatchObject({ code: "TAG_FORBIDDEN" });
  await expect(x.service.write(x.identity, "tags", { ...input(ctx), add: [], remove: [] })).rejects.toMatchObject({ code: "TAG_INVALID" });
  // No-op write: receipt without an event.
  const events = (await x.store.read()).events.length;
  const noop = await x.service.write(x.identity, "tags", { ...input(ctx), add: ["perf"] });
  expect(noop.receipt.eventId).toBe("");
  expect((await x.store.read()).events.length).toBe(events);
  ctx = await x.service.get(x.identity);
  const removed = await x.service.write(x.identity, "tags", { ...input(ctx), remove: ["perf"] });
  expect(removed.current?.task.tags?.map((t) => t.tag)).toEqual(["drawer"]);
  expect((await x.store.read()).events.at(-1)).toMatchObject({ action: "tags_changed", actor: "agent", agentId: "actor", note: "−perf" });
});

test("ideas carry normalized suggested tags", async () => {
  const x = await setup();
  const ctx = await x.service.get(x.identity);
  await x.service.write(x.identity, "idea", { ...input(ctx), title: "Follow", detail: "d", rationale: "r", tags: ["Session Composer"] });
  expect((await x.store.read()).ideas[0].tags).toEqual(["session-composer"]);
  const ctx2 = await x.service.get(x.identity);
  await expect(
    x.service.write(x.identity, "idea", { ...input(ctx2), title: "Other", detail: "d", rationale: "r", tags: ["bad!"] }),
  ).rejects.toMatchObject({ code: "TAG_INVALID" });
});
