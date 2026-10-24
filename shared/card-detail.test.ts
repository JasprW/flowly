import { expect, test } from "vitest";
import { boardSchema } from "./model";
import { cardDetail, cardDetailSchema, projectCardIndex, projectIdeas } from "./card-detail";
import { projectTagStats } from "./tags";

const at = "2026-10-24T00:00:00Z";
const p = { id: "p", title: "P", description: "", paseoProjectId: "n", primaryPath: "/fixture", repos: ["/fixture"], revision: 1, createdAt: at, updatedAt: at, archivedAt: null };
const t = { id: "t", projectId: "p", workspaceId: "w", sourcePath: "/fixture", repoPaths: ["/fixture"], title: "T", description: "keep description", status: "todo", priority: "normal", position: 0, revision: 1, operationId: "o", createdAt: at, updatedAt: at, archivedAt: null };
const fixture = () => boardSchema.parse({ version: 5, revision: 3, projects: [p], tasks: [t, { ...t, id: "linked", workspaceId: "w2", tags: [{ tag: "mobile", by: "human", at }] }, { ...t, id: "accepted", workspaceId: "w3", archivedAt: at }, { ...t, id: "other", workspaceId: "w4", description: "irrelevant".repeat(2000) }],
  links: [{ id: "l", projectId: "p", from: "t", to: "linked", kind: "related", createdBy: "human", createdAt: at }],
  events: Array.from({ length: 100 }, (_, i) => ({ id: String(i), taskId: "t", actor: "agent", action: "progress_reported", at, note: `full body ${i}` })).concat([{ id: "foreign", taskId: "other", actor: "human", action: "created", at, note: "other body" }]),
  ideas: [{ id: "i", taskId: "t", projectId: "p", agentId: "a", eventId: "e", title: "Idea", detail: "body", rationale: "why", context: "context", status: "accepted", acceptedTaskId: "accepted", createdAt: at, updatedAt: at }],
});
test("detail retains all 100 stored bodies, task fields and referenced archived targets, without unrelated content", () => {
  const board = fixture(), before = structuredClone(board), detail = cardDetailSchema.parse(cardDetail(board, { taskId: "t", workspaceId: "w" }));
  expect(detail.task).toEqual(board.tasks[0]); expect(detail.events).toEqual(board.events.slice(0, 100));
  expect(detail.relatedTasks.map(t => t.id)).toEqual(["t", "linked", "accepted"]);
  expect(detail.relatedTasks.every(t => !("description" in t))).toBe(true);
  expect(detail.ideas).toEqual(board.ideas); expect(JSON.stringify(detail)).not.toContain("other body");
  expect(boardSchema.safeParse(detail).success).toBe(false); expect(board).toEqual(before);
});
test("project context keeps full candidate coverage and exact tag rules, not description/history bodies", () => {
  const board = fixture(), index = projectCardIndex(board, "p");
  expect(index.cards.map(t => t.id)).toEqual(board.tasks.map(t => t.id));
  expect(index.tags).toEqual(projectTagStats(board.tasks, "p"));
  expect(JSON.stringify(index)).not.toContain("irrelevant");
  expect(projectIdeas(board, "p").ideas).toEqual(board.ideas);
  expect(() => projectCardIndex(board, "gone")).toThrow("unavailable");
});
test("deleted/rebound task or absent project rejects; archived scopes remain displayable", () => {
  const b = fixture(), input = { taskId: "t", workspaceId: "w" };
  for (const board of [{ ...b, tasks: [] }, { ...b, projects: [] }, { ...b, tasks: b.tasks.map(t => ({ ...t, workspaceId: "moved" })) }]) expect(() => cardDetail(board, input)).toThrow("unavailable");
  b.tasks[0].archivedAt = at; expect(cardDetail(b, input).task.archivedAt).toBe(at);
});
