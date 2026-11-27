import { afterEach, expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { agentFixture } from "./agent-fixture";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })));
});

async function setup() {
  const x = await agentFixture();
  roots.push(x.root);
  const stamp = new Date().toISOString();
  const card = (id: string, projectId: string, extra: Record<string, unknown> = {}) => ({
    id,
    projectId,
    workspaceId: `w-${id}`,
    sourcePath: x.a,
    repoPaths: [],
    title: `Card ${id}`,
    description: "",
    status: "todo" as const,
    priority: "normal" as const,
    position: 1,
    revision: 1,
    operationId: `create-${id}`,
    createdAt: stamp,
    updatedAt: stamp,
    archivedAt: null,
    tags: [{ tag: "human-tag", by: "human" as const, at: stamp }],
    ...extra,
  });
  await x.store.mutate((board) => {
    board.projects.push({ ...board.projects[0], id: "q", paseoProjectId: "other-native", title: "Other project", primaryPath: x.b, repos: [x.b] });
    board.tasks.push(card("other", "p"), card("foreign", "q", { sourcePath: x.b }), card("archived", "p", { archivedAt: stamp }));
  });
  const moved: { previous: string; status: string }[] = [];
  x.service.onCardStatus = (previous, task) => moved.push({ previous, status: task.status });
  const ctx = await x.service.get(x.identity);
  const base = { expectedRevision: ctx.revision, request: ctx.request, note: "Triage from the Notion comparison." };
  return { ...x, base, moved };
}

test("edits another card of the same project as the agent and runs the after-status hook", async () => {
  const x = await setup();
  const result = await x.service.editCard(x.identity, {
    ...x.base,
    cardId: "other",
    cardRevision: 1,
    title: "[Compliance Nr. 6] Other",
    priority: "high",
    status: "cancelled",
    addTags: ["compliance"],
  });
  expect(result.card).toMatchObject({
    title: "[Compliance Nr. 6] Other",
    priority: "high",
    status: "cancelled",
    tags: ["human-tag", "compliance"],
    revision: 2,
  });
  expect(x.moved).toEqual([{ previous: "todo", status: "cancelled" }]);
  const board = await x.store.read();
  const events = board.events.filter((e) => e.taskId === "other");
  expect(events.map((e) => [e.action, e.actor, e.agentId])).toEqual([
    ["status_changed", "agent", "actor"],
    ["tags_changed", "agent", "actor"],
  ]);
  expect(events[0].note).toBe("Triage from the Notion comparison.");
  // The session's own card is untouched, so its signed request stays valid.
  expect(board.tasks.find((t) => t.id === "t")!.revision).toBe(1);
});

test("refuses the own card, other projects, archived cards, stale revisions and human tags without writing", async () => {
  const x = await setup();
  const before = JSON.stringify((await x.store.read()).tasks);
  await expect(x.service.editCard(x.identity, { ...x.base, cardId: "t", cardRevision: 1, title: "x" })).rejects.toMatchObject({
    code: "INVALID_INPUT",
  });
  await expect(
    x.service.editCard(x.identity, { ...x.base, cardId: "foreign", cardRevision: 1, title: "x" }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    x.service.editCard(x.identity, { ...x.base, cardId: "archived", cardRevision: 1, title: "x" }),
  ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  await expect(
    x.service.editCard(x.identity, { ...x.base, cardId: "other", cardRevision: 7, title: "x" }),
  ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
  await expect(
    x.service.editCard(x.identity, { ...x.base, cardId: "other", cardRevision: 1, title: "x", removeTags: ["human-tag"] }),
  ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  await expect(x.service.editCard(x.identity, { ...x.base, cardId: "other", cardRevision: 1 })).rejects.toMatchObject({
    code: "INVALID_INPUT",
  });
  await expect(
    x.service.editCard({ ...x.identity, agentId: "second" }, { ...x.base, cardId: "other", cardRevision: 1, title: "x" }),
  ).rejects.toMatchObject({ code: "SESSION_MISMATCH" });
  expect(JSON.stringify((await x.store.read()).tasks)).toBe(before);
  expect(x.moved).toEqual([]);
});
