import { afterEach, expect, test } from "vitest";
import { mkdtemp, readdir, readFile, realpath, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FlowLog } from "./flow-log";
import { BoardStore } from "./store";
import type { BoardEvent } from "../shared/model";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
async function dir() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "ultra-flow-")));
  roots.push(root);
  return root;
}
const tasks = [
  { id: "a", projectId: "p1" },
  { id: "b", projectId: "p1" },
  { id: "c", projectId: "p2" },
];
const event = (id: string, taskId: string, note?: string): BoardEvent => ({ id, taskId, actor: "human", action: "edited", at: `2026-10-16T00:00:0${id.length}.000Z`, ...(note ? { note } : {}) });

test("append groups by project, drops notes, and never writes an id twice", async () => {
  const flow = new FlowLog(await dir());
  await flow.append([event("1", "a", "secret"), event("2", "c")], { tasks } as never);
  await flow.append([event("1", "a"), event("3", "b")], { tasks } as never);
  expect((await flow.read("p1")).map((e) => e.id)).toEqual(["1", "3"]);
  expect((await flow.read("p2")).map((e) => e.id)).toEqual(["2"]);
  expect(JSON.stringify(await flow.read("p1"))).not.toContain("secret");
  // A fresh instance (daemon restart) reads ids from disk.
  const again = new FlowLog(flow.directory);
  await again.reconcile({ tasks, events: [event("1", "a"), event("4", "a")] } as never);
  expect((await again.read("p1")).map((e) => e.id)).toEqual(["1", "3", "4"]);
});

test("invalid lines are skipped and kept", async () => {
  const root = await dir();
  const flow = new FlowLog(root);
  await mkdir(join(root, "flow"));
  await writeFile(flow.path("p1"), '{"broken\n' + JSON.stringify(event("1", "a")) + "\n");
  await flow.append([event("2", "a")], { tasks } as never);
  expect((await flow.read("p1")).map((e) => e.id)).toEqual(["1", "2"]);
  expect(await readFile(flow.path("p1"), "utf8")).toContain('{"broken');
});

test("deleting a card rewrites the log and backs up its lines; stale reconcile does not bring them back", async () => {
  const root = await dir();
  const flow = new FlowLog(root);
  const board = { tasks, events: [event("1", "a"), event("2", "b")] };
  await flow.reconcile(board as never);
  const backup = await flow.removeTask("p1", "a");
  expect(backup).toContain(join(root, "removed", "task-a-flow-"));
  expect((await flow.read("p1")).map((e) => e.id)).toEqual(["2"]);
  await flow.reconcile(board as never);
  expect((await flow.read("p1")).map((e) => e.id)).toEqual(["2"]);
  expect(await readFile(backup!, "utf8")).toContain('"id":"1"');
});

test("removing a project moves its log to removed/", async () => {
  const root = await dir();
  const flow = new FlowLog(root);
  await flow.append([event("1", "a")], { tasks } as never);
  const backup = await flow.removeProject("p1");
  expect(backup).toContain(join(root, "removed", "p1-flow-"));
  expect(await flow.read("p1")).toEqual([]);
  expect(await readdir(join(root, "flow"))).toEqual([]);
});

test("board writes append their events to the flow log after commit, including events trimmed from the board", async () => {
  const root = await dir();
  const store = new BoardStore(root);
  const flow = new FlowLog(root);
  store.flow = flow;
  await store.mutate((board) => {
    board.projects.push({ id: "p1", title: "P", description: "", paseoProjectId: "n1", primaryPath: root, repos: [root], revision: 1, createdAt: "", updatedAt: "", archivedAt: null });
    board.tasks.push({ id: "a", projectId: "p1", workspaceId: "w", sourcePath: root, repoPaths: [root], title: "A", description: "", status: "todo", priority: "normal", position: 0, revision: 1, operationId: "o", createdAt: "", updatedAt: "", archivedAt: null });
    for (let i = 0; i < 105; i++) store.event(board, { taskId: "a", actor: "system", action: "agent.turn_started" });
  });
  // flow.read waits for the queued append, so no sleep is needed.
  expect((await store.read()).events.length).toBe(100);
  expect((await flow.read("p1")).length).toBe(105);
  // A failed transaction writes nothing.
  await expect(
    store.mutate((board) => {
      store.event(board, { taskId: "a", actor: "system", action: "x" });
      throw new Error("nope");
    }),
  ).rejects.toThrow("nope");
  await store.mutate(() => undefined);
  expect((await flow.read("p1")).length).toBe(105);
});
