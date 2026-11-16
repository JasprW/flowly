import { afterEach, expect, test, vi } from "vitest";
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PaseoApi } from "@getpaseo/client";
import { AgentService } from "./agent-service";
import { BoardService } from "./service";
import { agentFixture } from "./agent-fixture";
import { ideaDescription, ideaInstruction } from "../shared/ideas";
import { adoptIdea } from "./ideas";
import { sessionContext } from "../shared/scope";

const roots: string[] = [];
async function setup() {
  const f = await agentFixture();
  roots.push(f.root);
  return f;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })));
});
type Fixture = Awaited<ReturnType<typeof setup>>;
const idea = (ctx: Awaited<ReturnType<AgentService["get"]>>, title = "Fix the flaky test", extra = {}) => ({
  expectedRevision: ctx.revision,
  request: ctx.request,
  title,
  detail: "Make store.test deterministic.",
  rationale: "It failed twice while verifying this card.",
  ...extra,
});
async function propose(x: Fixture, title?: string, extra = {}) {
  return x.service.write(x.identity, "idea", idea(await x.service.get(x.identity), title, extra));
}
/** Fake Paseo for tasks.create: workspace creation plus the context refresh. */
function creator(x: Fixture) {
  const create = vi.fn(async (_options: unknown) => ({ id: "new-workspace" }));
  const paseo = {
    workspaces: {
      create,
      ref: () => ({ refresh: async () => ({ ...x.workspace(), id: "new-workspace" }) }),
    },
  } as unknown as PaseoApi;
  return { create, paseo };
}
const createInput = (ideaId?: string, operationId = "op-idea") => ({
  projectId: "p",
  operationId,
  title: "Fix the flaky test",
  description: "prefilled",
  status: "todo" as const,
  priority: "normal" as const,
  mode: "directory" as const,
  baseRef: "",
  ...(ideaId ? { ideaId } : {}),
});

test("proposing an idea records it with an event and receipt, without touching the card", async () => {
  const x = await setup(),
    before = (await x.store.read()).tasks[0];
  const result = await propose(x, "Fix the flaky test", { context: "store.test.ts line 40", type: "bugfix", priority: "high" });
  const board = await x.store.read();
  expect(board.tasks[0]).toEqual(before);
  expect(board.ideas).toEqual([
    expect.objectContaining({
      id: result.ideaId,
      taskId: "t",
      projectId: "p",
      agentId: "actor",
      title: "Fix the flaky test",
      context: "store.test.ts line 40",
      type: "bugfix",
      priority: "high",
      status: "open",
    }),
  ]);
  expect(board.events.at(-1)).toMatchObject({ action: "idea_proposed", actor: "agent", note: "Fix the flaky test" });
  expect(board.ideas[0].eventId).toBe(board.events.at(-1)!.id);
  expect(result.receipt).toMatchObject({ action: "idea", taskRevision: 1, status: "todo" });
  expect(result.current?.ideas).toEqual([{ id: result.ideaId, title: "Fix the flaky test", status: "open", scope: "new" }]);
});

test("an uncertain retry replays the receipt and idea; reusing the request differently is refused", async () => {
  const x = await setup(),
    ctx = await x.service.get(x.identity);
  const first = await x.service.write(x.identity, "idea", idea(ctx));
  const again = await x.service.write(x.identity, "idea", idea(ctx));
  expect(again).toMatchObject({ replayed: true, ideaId: first.ideaId });
  expect((await x.store.read()).ideas).toHaveLength(1);
  await expect(x.service.write(x.identity, "idea", idea(ctx, "Another title"))).rejects.toMatchObject({
    code: "REQUEST_REUSED",
  });
});

test("duplicate open titles and an eleventh open idea are refused", async () => {
  const x = await setup();
  await propose(x, "Fix the flaky test");
  await expect(propose(x, "  fix THE flaky test ")).rejects.toMatchObject({ code: "IDEA_DUPLICATE" });
  for (let i = 1; i < 10; i++) await propose(x, `Idea ${i}`);
  await expect(propose(x, "Idea 10")).rejects.toMatchObject({ code: "IDEA_LIMIT" });
  // Dismissing one frees a slot; a dismissed title may be proposed again.
  const first = (await x.store.read()).ideas[0];
  await x.store.updateIdea({ id: first.id, status: "dismissed" });
  await propose(x, "Fix the flaky test");
  expect((await x.store.read()).ideas.filter((i) => i.status === "open")).toHaveLength(10);
});

test("restoring a dismissed idea is refused while an open idea has the same title", async () => {
  const x = await setup();
  const { ideaId } = await propose(x, "Fix the flaky test");
  await x.store.updateIdea({ id: ideaId!, status: "dismissed" });
  await propose(x, "  FIX the flaky test ");
  const revision = (await x.store.read()).revision;
  await expect(x.store.updateIdea({ id: ideaId!, status: "open" })).rejects.toThrow("open idea with that title");
  const board = await x.store.read();
  expect(board.revision).toBe(revision);
  expect(board.ideas.find((i) => i.id === ideaId)?.status).toBe("dismissed");
  expect(board.ideas.filter((i) => i.status === "open")).toHaveLength(1);
});

test("finished and archived cards cannot receive ideas", async () => {
  const x = await setup();
  await x.store.editTask({ id: "t", revision: 1, status: "done", actor: "human" });
  await expect(propose(x)).rejects.toMatchObject({ code: "TASK_FINISHED" });
});

test("each card keeps at most 50 ideas, dropping the oldest closed ones", async () => {
  const x = await setup(),
    stamp = new Date().toISOString();
  await x.store.mutate((board) => {
    for (let i = 0; i < 50; i++)
      board.ideas.push({
        id: `old-${i}`, taskId: "t", projectId: "p", agentId: "actor", eventId: "e", title: `Old ${i}`,
        detail: "", rationale: "", context: "", status: "dismissed", createdAt: stamp, updatedAt: stamp,
      });
  });
  await propose(x, "Newest");
  const ideas = (await x.store.read()).ideas;
  expect(ideas).toHaveLength(50);
  expect(ideas.some((i) => i.id === "old-0")).toBe(false);
  expect(ideas.at(-1)?.title).toBe("Newest");
});

test("people dismiss and restore ideas; accepted ideas are final", async () => {
  const x = await setup();
  const { ideaId } = await propose(x);
  const revision = (await x.store.read()).revision;
  await x.store.updateIdea({ id: ideaId!, status: "open" });
  expect((await x.store.read()).revision).toBe(revision);
  expect((await x.store.updateIdea({ id: ideaId!, status: "dismissed" })).status).toBe("dismissed");
  expect((await x.store.updateIdea({ id: ideaId!, status: "open" })).status).toBe("open");
  expect((await x.store.read()).events.slice(-2).map((e) => e.action)).toEqual(["idea_dismissed", "idea_restored"]);
  const { create, paseo } = creator(x);
  await new BoardService(x.store).createTask(createInput(ideaId), paseo);
  expect(create).toHaveBeenCalledTimes(1);
  await expect(x.store.updateIdea({ id: ideaId!, status: "dismissed" })).rejects.toThrow("already became a card");
});

test("creating a card from an idea links both ways in one write", async () => {
  const x = await setup();
  const { ideaId } = await propose(x);
  const { create, paseo } = creator(x);
  const service = new BoardService(x.store);
  const card = await service.createTask(createInput(ideaId), paseo);
  const board = await x.store.read();
  expect(card.origin).toEqual({ taskId: "t", ideaId });
  expect(board.ideas[0]).toMatchObject({ status: "accepted", acceptedTaskId: card.id });
  expect(board.events.find((e) => e.action === "idea_accepted")).toMatchObject({
    taskId: "t",
    note: "Fix the flaky test → Fix the flaky test",
  });
  // A repeated submission returns the first card and leaves the idea alone.
  expect((await service.createTask(createInput(ideaId), paseo)).id).toBe(card.id);
  expect(create).toHaveBeenCalledTimes(1);
  expect((await service.context(card.id, paseo)).context).toContain("Follow-up of: Card (t) [Todo]\n");
  // The derived link is written with the card, without separate link events.
  expect((await x.store.read()).links).toEqual([
    expect.objectContaining({ kind: "derived", from: card.id, to: "t", ideaId, createdBy: "system" }),
  ]);
  expect(board.events.some((e) => e.action === "linked")).toBe(false);
});

test("an idea that is no longer open creates neither a workspace nor a card", async () => {
  const x = await setup();
  const { ideaId } = await propose(x);
  await x.store.updateIdea({ id: ideaId!, status: "dismissed" });
  const { create, paseo } = creator(x);
  const service = new BoardService(x.store);
  await expect(service.createTask(createInput(ideaId), paseo)).rejects.toThrow("no longer open");
  await expect(service.createTask(createInput("missing", "op-2"), paseo)).rejects.toThrow("no longer open");
  expect(create).not.toHaveBeenCalled();
  expect((await x.store.read()).tasks).toHaveLength(1);
});

test("deleting a card or removing a project backs up and removes its ideas", async () => {
  const x = await setup();
  const { ideaId } = await propose(x);
  const { paseo } = creator(x);
  const derived = await new BoardService(x.store).createTask(createInput(ideaId), paseo);
  const source = (await x.store.read()).tasks.find((t) => t.id === "t")!;
  const { backup } = await x.store.deleteTask({ id: "t", revision: source.revision });
  expect(JSON.parse(await readFile(backup, "utf8")).ideas).toHaveLength(1);
  const board = await x.store.read();
  expect(board.ideas).toEqual([]);
  // The derived card keeps its origin; the UI shows the source as deleted.
  expect(board.tasks.find((t) => t.id === derived.id)?.origin).toEqual({ taskId: "t", ideaId });

  const y = await setup();
  await propose(y);
  const removed = await y.store.removeProject({ id: "p", revision: 1, alsoPaseo: false });
  expect(JSON.parse(await readFile(removed.backup, "utf8")).ideas).toHaveLength(1);
  expect((await y.store.read()).ideas).toEqual([]);
  expect(await readdir(join(y.store.directory, "removed"))).toHaveLength(1);
});

test("a board written before ideas reads with no ideas", async () => {
  const x = await setup();
  const raw = JSON.parse(await readFile(x.store.path, "utf8"));
  delete raw.ideas;
  await writeFile(x.store.path, JSON.stringify(raw));
  expect((await x.store.read()).ideas).toEqual([]);
  await propose(x);
  expect((await x.store.read()).ideas).toHaveLength(1);
});

test("the prefilled description carries the idea, why, context, source card and its progress", () => {
  const text = ideaDescription(
    { detail: "Do X.", rationale: "Because Y.", context: "file.ts" },
    { id: "t", title: "Source" },
    { target: "Goal: ship", recap: "- done A" },
  );
  expect(text).toBe("Do X.\n\nWhy: Because Y.\n\nContext:\nfile.ts\n\nFrom card: Source (t)\n\nSource progress:\nGoal: ship\n- done A");
  expect(ideaDescription({ detail: "Do X.", rationale: "", context: "" }, undefined, null)).toBe("Do X.");
  const long = ideaDescription({ detail: "x".repeat(25000), rationale: "", context: "" }, undefined);
  expect(long).toHaveLength(20000);
  expect(long.endsWith("…")).toBe(true);
});

test("session context lists the card's links only when it has some", async () => {
  const x = await setup();
  const board = await x.store.read();
  const [task] = board.tasks, [project] = board.projects;
  const dirs = [{ repo: x.a, directory: x.a }];
  expect(sessionContext(task, project, dirs, x.a)).not.toContain("Follow-up of");
  expect(sessionContext(task, project, dirs, x.a, ["Follow-up of: Source (s) [Todo]"])).toContain("Follow-up of: Source (s) [Todo]\n");
});

test("Do it in this task marks the idea for the chosen session and queues the instruction", async () => {
  const x = await setup();
  const { ideaId } = await propose(x, "Extend the filter", { scope: "here", context: "filters.ts" });
  expect((await x.store.read()).ideas[0].scope).toBe("here");
  const push = vi.fn(async () => ({}));
  const idea = await adoptIdea(x.store, push, { id: ideaId!, agentId: "second" }, x.paseo);
  expect(idea).toMatchObject({ status: "accepted", acceptedAgentId: "second" });
  expect(push).toHaveBeenCalledWith(
    {
      taskId: "t",
      agentId: "second",
      text: "Good idea — go ahead with it in this task: Extend the filter\n\nMake store.test deterministic.\n\nWhy: It failed twice while verifying this card.\n\nContext:\nfilters.ts",
    },
    x.paseo,
  );
  const board = await x.store.read();
  expect(board.events.at(-1)).toMatchObject({ action: "idea_adopted", actor: "human", agentId: "second" });
  expect(board.tasks[0].revision).toBe(1);
  await expect(adoptIdea(x.store, push, { id: ideaId!, agentId: "second" }, x.paseo)).rejects.toThrow("no longer open");
  expect(push).toHaveBeenCalledTimes(1);
});

test("Do it in this task refuses another workspace's or an archived session and reverts a failed hand-off", async () => {
  const x = await setup();
  const { ideaId } = await propose(x);
  const push = vi.fn(async () => ({}));
  await expect(adoptIdea(x.store, push, { id: ideaId!, agentId: "wrong" }, x.paseo)).rejects.toThrow("live session");
  x.actors.second.archivedAt = new Date().toISOString();
  await expect(adoptIdea(x.store, push, { id: ideaId!, agentId: "second" }, x.paseo)).rejects.toThrow("live session");
  expect(push).not.toHaveBeenCalled();
  const events = (await x.store.read()).events.length;
  const failing = vi.fn(async () => {
    throw new Error("Queue is full (50 messages).");
  });
  await expect(adoptIdea(x.store, failing, { id: ideaId!, agentId: "actor" }, x.paseo)).rejects.toThrow("Queue is full");
  const board = await x.store.read();
  expect(board.ideas[0]).toMatchObject({ status: "open" });
  expect(board.ideas[0].acceptedAgentId).toBeUndefined();
  expect(board.events).toHaveLength(events);
});

test("ideas default to a new-card scope; the instruction skips empty parts", async () => {
  const x = await setup();
  await propose(x);
  expect((await x.store.read()).ideas[0].scope).toBe("new");
  expect(ideaInstruction({ title: " T ", detail: "Do it.", rationale: "", context: "" })).toBe(
    "Good idea — go ahead with it in this task: T\n\nDo it.",
  );
});

test("a session started with the idea as its first instruction is only recorded, not sent again", async () => {
  const x = await setup();
  const { ideaId } = await propose(x, "Extend the filter", { scope: "here" });
  const push = vi.fn(async () => ({}));
  const idea = await adoptIdea(x.store, push, { id: ideaId!, agentId: "second", send: false }, x.paseo);
  expect(idea).toMatchObject({ status: "accepted", acceptedAgentId: "second" });
  expect(push).not.toHaveBeenCalled();
  expect((await x.store.read()).events.at(-1)).toMatchObject({ action: "idea_adopted", agentId: "second" });
});

test("ideas outlive the card's lifecycle: finished or archived cards keep them open (IDEAS-INBOX-SPEC §2)", async () => {
  const x = await setup();
  const { ideaId } = await propose(x, "Extend the filter", { scope: "here" });
  await x.store.editTask({ id: "t", revision: 1, status: "done", actor: "human" });
  await x.store.editTask({ id: "t", revision: 2, archived: true, actor: "human" });
  expect((await x.store.read()).ideas[0]).toMatchObject({ status: "open" });
  // Not now and Restore still work on an archived card.
  expect((await x.store.updateIdea({ id: ideaId!, status: "dismissed" })).status).toBe("dismissed");
  expect((await x.store.updateIdea({ id: ideaId!, status: "open" })).status).toBe("open");
  // Its sessions must not resume work: only a new card.
  const push = vi.fn(async () => ({}));
  await expect(adoptIdea(x.store, push, { id: ideaId!, agentId: "second" }, x.paseo)).rejects.toThrow("This card is finished");
  await expect(adoptIdea(x.store, push, { id: ideaId!, agentId: "second", send: false }, x.paseo)).rejects.toThrow("This card is finished");
  expect(push).not.toHaveBeenCalled();
  expect((await x.store.read()).ideas[0]).toMatchObject({ status: "open" });
  const { paseo } = creator(x);
  const card = await new BoardService(x.store).createTask(createInput(ideaId), paseo);
  expect((await x.store.read()).ideas[0]).toMatchObject({ status: "accepted", acceptedTaskId: card.id });
});

test("a Done card that is not archived also refuses Do it in this task", async () => {
  const x = await setup();
  const { ideaId } = await propose(x, "Extend the filter", { scope: "here" });
  await x.store.editTask({ id: "t", revision: 1, status: "cancelled", actor: "human" });
  await expect(adoptIdea(x.store, vi.fn(async () => ({})), { id: ideaId!, agentId: "second" }, x.paseo)).rejects.toThrow("This card is finished");
});

test("an archived project makes its ideas read-only", async () => {
  const x = await setup();
  const { ideaId } = await propose(x);
  const project = (await x.store.read()).projects[0];
  await x.store.updateProject({ id: "p", revision: project.revision, archived: true });
  await expect(x.store.updateIdea({ id: ideaId!, status: "dismissed" })).rejects.toThrow("The project is archived.");
});

test("with Ideas off, new proposals are refused without writing; an earlier proposal still replays (IDEAS-INBOX-SPEC §10)", async () => {
  const x = await setup();
  const ctx = await x.service.get(x.identity);
  const first = await x.service.write(x.identity, "idea", idea(ctx));
  x.service.ideasOn = async () => false;
  expect((await x.service.write(x.identity, "idea", idea(ctx))).replayed).toBe(true);
  const before = await x.store.read();
  await expect(propose(x, "Another")).rejects.toMatchObject({ code: "IDEAS_DISABLED" });
  const after = await x.store.read();
  expect(after.ideas).toEqual(before.ideas);
  expect(after.revision).toBe(before.revision);
  expect(first.ideaId).toBeTruthy();
});
