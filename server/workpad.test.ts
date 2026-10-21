import { afterEach, expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { agentFixture } from "./agent-fixture";
import { WorkpadService, readHead } from "./workpad";
import type { Workpad } from "../shared/model";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
async function setup(withPad = true) {
  const f = await agentFixture({ workpad: false });
  roots.push(f.root);
  const repo = { head: "aaaaaaaaaaaa", dirty: false, calls: 0 };
  const git = async (_cwd: string, args: string[]) => {
    repo.calls++;
    const key = args.join(" ");
    if (key === "rev-parse --short=12 HEAD") return repo.head;
    if (key === "rev-parse --abbrev-ref HEAD") return "main";
    if (key === "status --porcelain") return repo.dirty ? " M a" : "";
    throw new Error(key);
  };
  let now = Date.parse("2026-10-19T00:00:00.000Z");
  const service = new WorkpadService(f.store, git, () => now);
  if (withPad)
    await f.store.mutate((board) => {
      const pad: Workpad = {
        taskId: "t",
        projectId: "p",
        revision: 1,
        acceptance: [{ id: "a", text: "Shows checks", done: false, by: "agent", at: "2026-10-18T00:00:00.000Z" }],
        validation: [{ id: "unit", text: "Unit", state: "unrun", by: "agent", at: "2026-10-18T00:00:00.000Z" }],
        confusions: [{ id: "c", text: "Scope?", at: "2026-10-18T00:00:00.000Z" }],
        env: null,
        head: null,
        updatedAt: "2026-10-18T00:00:00.000Z",
        updatedBy: "agent",
        agentId: "actor",
      };
      board.workpads.push(pad);
    });
  return { ...f, repo, service, advance: (ms: number) => (now += ms) };
}

test("readHead: sha, branch and dirty state; null when git fails", async () => {
  const git = async (_cwd: string, args: string[]) =>
    args.join(" ") === "rev-parse --short=12 HEAD" ? "0123456789ab\n" : args[1] === "--abbrev-ref" ? "HEAD\n" : "?? new\n";
  expect(await readHead("/x", git, "2026-10-19T00:00:00.000Z")).toEqual({ sha: "0123456789ab", dirty: true, at: "2026-10-19T00:00:00.000Z" });
  expect(await readHead("/x", async () => Promise.reject(new Error("no repo")))).toBeNull();
});

test("a person's checks: pass stamps HEAD, unrun clears it; the task revision never moves", async () => {
  const x = await setup();
  x.repo.dirty = true;
  const before = (await x.store.read()).tasks[0]!.revision;
  const passed = await x.service.check({ taskId: "t", section: "validation", itemId: "unit", state: "pass" }, x.paseo);
  expect(passed.revision).toBe(2);
  expect(passed.updatedBy).toBe("human");
  expect(passed.validation[0]).toMatchObject({ state: "pass", sha: "aaaaaaaaaaaa", dirty: true, by: "human" });
  const reset = await x.service.check({ taskId: "t", section: "validation", itemId: "unit", state: "unrun" }, x.paseo);
  expect(reset.validation[0]).not.toHaveProperty("sha");
  const ticked = await x.service.check({ taskId: "t", section: "acceptance", itemId: "a", done: true }, x.paseo);
  expect(ticked.acceptance[0]).toMatchObject({ done: true, by: "human" });
  const board = await x.store.read();
  expect(board.tasks[0]!.revision).toBe(before);
  expect(board.events.filter((e) => e.action === "workpad_checked").map((e) => e.note)).toEqual([
    "Check: Unit → pass",
    "Check: Unit → unrun",
    "Acceptance: Shows checks → met",
  ]);
  await expect(x.service.check({ taskId: "t", section: "acceptance", itemId: "gone", done: true }, x.paseo)).rejects.toThrow("no longer in the workpad");
  await expect(x.service.check({ taskId: "t", section: "acceptance", itemId: "a", state: "pass" }, x.paseo)).rejects.toThrow();
});

test("resolving a confusion removes it; archived cards refuse edits", async () => {
  const x = await setup();
  expect((await x.service.resolveConfusion({ taskId: "t", itemId: "c" })).confusions).toEqual([]);
  await x.store.mutate((board) => {
    board.tasks[0]!.archivedAt = "2026-10-19T00:00:00.000Z";
  });
  await expect(x.service.check({ taskId: "t", section: "acceptance", itemId: "a", done: true }, x.paseo)).rejects.toThrow("Archived cards can't be changed.");
});

test("refresh runs git at most once per card per 30 seconds and stores a changed HEAD", async () => {
  const x = await setup();
  expect((await x.service.refresh({ taskId: "t" }, x.paseo)).head?.sha).toBe("aaaaaaaaaaaa");
  const calls = x.repo.calls;
  x.repo.head = "bbbbbbbbbbbb";
  expect((await x.service.refresh({ taskId: "t" }, x.paseo)).head?.sha).toBe("aaaaaaaaaaaa");
  expect(x.repo.calls).toBe(calls);
  x.advance(31_000);
  await x.service.refresh({ taskId: "t" }, x.paseo);
  expect((await x.store.read()).workpads[0]!.head?.sha).toBe("bbbbbbbbbbbb");
});

test("turn end: the last todo list becomes the session's plan; none keeps it; empty clears it", async () => {
  const x = await setup(false);
  const todo = (items: { text: string; completed: boolean }[]) => [{ type: "todo", items } as { type: string }];
  await x.service.recordTurn(x.identity, todo([{ text: "Spec", completed: true }, { text: "Build", completed: false }]), x.paseo);
  await x.service.recordTurn({ ...x.identity, agentId: "second" }, todo([{ text: "Verify", completed: false }]), x.paseo);
  let plans = (await x.store.read()).plans;
  expect(plans.map((p) => [p.agentId, p.items.map((i) => `${i.text}:${i.status}`)])).toEqual([
    ["actor", ["Spec:completed", "Build:pending"]],
    ["second", ["Verify:pending"]],
  ]);
  const revision = (await x.store.read()).revision;
  await x.service.recordTurn(x.identity, [{ type: "assistant_message" }], x.paseo);
  expect((await x.store.read()).revision).toBe(revision);
  await x.service.recordTurn(x.identity, todo([]), x.paseo);
  plans = (await x.store.read()).plans;
  expect(plans.map((p) => p.agentId)).toEqual(["second"]);
  // A session of another workspace never writes a plan here.
  await x.service.recordTurn({ ...x.identity, workspaceId: "other" }, todo([{ text: "X", completed: false }]), x.paseo);
  expect((await x.store.read()).plans).toHaveLength(1);
});

test("turn end refreshes HEAD only when checks have run", async () => {
  const x = await setup();
  await x.service.recordTurn(x.identity, [], x.paseo);
  expect(x.repo.calls).toBe(0);
  await x.service.check({ taskId: "t", section: "validation", itemId: "unit", state: "fail" }, x.paseo);
  x.repo.head = "cccccccccccc";
  await x.service.recordTurn(x.identity, [], x.paseo);
  expect((await x.store.read()).workpads[0]!.head?.sha).toBe("cccccccccccc");
});

test("deleting a card removes its workpad and plans with it, into the backup", async () => {
  const x = await setup();
  await x.service.recordTurn(x.identity, [{ type: "todo", items: [{ text: "A", completed: false }] } as { type: string }], x.paseo);
  const deleted = await x.store.deleteTask({ id: "t", revision: (await x.store.read()).tasks[0]!.revision });
  const board = await x.store.read();
  expect(board.workpads).toEqual([]);
  expect(board.plans).toEqual([]);
  const { readFile } = await import("node:fs/promises");
  const backup = JSON.parse(await readFile(deleted.backup, "utf8"));
  expect(backup.workpads).toHaveLength(1);
  expect(backup.plans).toHaveLength(1);
});

test("off for the project: no plan recorded, people's edits refused, no git on refresh", async () => {
  const x = await setup();
  await x.store.updateProject({ id: "p", revision: 1, workpad: false });
  await x.service.recordTurn(x.identity, [{ type: "todo", items: [{ text: "A", completed: false }] } as { type: string }], x.paseo);
  expect((await x.store.read()).plans).toEqual([]);
  await expect(x.service.check({ taskId: "t", section: "acceptance", itemId: "a", done: true }, x.paseo)).rejects.toThrow("turned off");
  await expect(x.service.resolveConfusion({ taskId: "t", itemId: "c" })).rejects.toThrow("turned off");
  expect(await x.service.refresh({ taskId: "t" }, x.paseo)).toEqual({ head: null });
  expect(x.repo.calls).toBe(0);
});
