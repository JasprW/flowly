import { expect, test } from "vitest";
import { boardSchema } from "../shared/model";
import { readCardDetail, readProjectCardIndex, readProjectIdeas } from "./card-detail";
import * as rpc from "../shared/rpc";
const at = "2026-10-24T00:00:00Z";
const board = () => boardSchema.parse({ version: 5, revision: 1, projects: [{ id: "p", title: "P", description: "", paseoProjectId: "n", primaryPath: "/fixture", repos: ["/fixture"], revision: 1, createdAt: at, updatedAt: at, archivedAt: null }], tasks: [{ id: "t", projectId: "p", workspaceId: "w", sourcePath: "/fixture", repoPaths: ["/fixture"], title: "T", description: "body", status: "todo", priority: "normal", position: 0, revision: 1, operationId: "o", createdAt: at, updatedAt: at, archivedAt: null }], events: [{ id: "e", taskId: "t", action: "created", actor: "human", at, note: "one" }] });
test("each independent namespace retains etag and changes for event body without task revision", () => {
  const b = board(), input = { taskId: "t", workspaceId: "w" }, a = rpc.readCardDetailChanged.output.parse(readCardDetail(b, input));
  expect(readCardDetail(b, { ...input, etag: a.etag })).toEqual({ etag: a.etag });
  b.events[0].note = "two";
  const next = readCardDetail(b, { ...input, etag: a.etag }); expect(next.value?.events[0].note).toBe("two"); expect(next.etag).not.toBe(a.etag);
  const index = rpc.readProjectCardIndexChanged.output.parse(readProjectCardIndex(b, { projectId: "p" }));
  const ideas = rpc.readProjectIdeasChanged.output.parse(readProjectIdeas(b, { projectId: "p" }));
  expect(new Set([next.etag, index.etag, ideas.etag]).size).toBe(3);
  expect(readProjectCardIndex(b, { projectId: "p", etag: index.etag })).toEqual({ etag: index.etag });
  expect(readProjectIdeas(b, { projectId: "p", etag: ideas.etag })).toEqual({ etag: ideas.etag });
  expect(readCardDetail(b, { ...input, etag: "unknown" }).value).toBeDefined();
});
test("validation precedes matching etag, and schemas reject unrelated input fields", () => {
  const b = board(), input = { taskId: "t", workspaceId: "w" }, etag = readCardDetail(b, input).etag;
  b.tasks[0].workspaceId = "changed";
  expect(() => readCardDetail(b, { ...input, etag })).toThrow("unavailable");
  expect(rpc.readCardDetailChanged.input.safeParse({ ...input, since: { count: 1 } }).success).toBe(false);
  expect(rpc.readProjectCardIndexChanged.input.safeParse({ projectId: "p", taskId: "t" }).success).toBe(false);
});
