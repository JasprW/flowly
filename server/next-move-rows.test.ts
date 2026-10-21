import { afterEach, expect, test } from "vitest";
import type { PaseoApi } from "@getpaseo/client";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BoardStore } from "./store";
import { NextMoveRows } from "./next-move-rows";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
const at = (s: number) => `2026-10-20T00:00:${String(s).padStart(2, "0")}.000Z`;

async function setup(status = "development") {
  const root = await realpath(await mkdtemp(join(tmpdir(), "flowly-next-rows-")));
  roots.push(root);
  const board = new BoardStore(join(root, "data"));
  const now = new Date().toISOString();
  await board.mutate((b) => {
    b.projects.push({ id: "p", paseoProjectId: "n", title: "P", description: "", primaryPath: root, repos: [root], revision: 1, createdAt: now, updatedAt: now, archivedAt: null });
    b.tasks.push({ id: "t", projectId: "p", workspaceId: "w", sourcePath: root, repoPaths: [root], title: "T", description: "", status: status as never, priority: "normal", position: 0, revision: 1, operationId: "o", createdAt: now, updatedAt: now, archivedAt: null });
  });
  const appended: { agentId: string; row: { id: string; kind: string; data: unknown } }[] = [];
  let fail = false;
  const paseo = {
    agents: {
      ref: (agentId: string) => ({
        timeline: {
          append: async (row: { id: string; kind: string; data: unknown }) => {
            if (fail) throw new Error("append failed");
            appended.push({ agentId, row });
            return { seq: 1, epoch: "e" };
          },
        },
      }),
    },
  } as unknown as PaseoApi;
  const event = (id: string, action: string, s: number, extra: object = {}) =>
    board.mutate((b) => void b.events.push({ id, taskId: "t", actor: action.startsWith("agent.") ? "system" : "agent", action, agentId: "a1", at: at(s), ...extra } as never));
  return { board, paseo, appended, event, rows: new NextMoveRows(board), failAppend: () => (fail = true) };
}

test("a completed turn with suggestions writes one ready card after the reply; the next turn rewrites it as a past card with the same moves", async () => {
  const x = await setup();
  await x.event("s1", "agent.turn_started", 1);
  await x.event("ev1", "next_moves_suggested", 2, { moves: [{ label: "Verify", prompt: "Verify it" }, { label: "Done", moveTo: "done" }] });
  await x.rows.turnEnded({ taskId: "t", agentId: "a1" }, x.paseo);
  expect(x.appended).toEqual([
    {
      agentId: "a1",
      row: {
        type: "plugin",
        id: "flowly-next-moves-ev1",
        kind: "flowly-next-moves",
        version: 1,
        data: { status: "ready", taskId: "t", workspaceId: "w", eventId: "ev1", moves: [{ label: "Verify", prompt: "Verify it" }, { label: "Done", moveTo: "done" }] },
      },
    },
  ]);
  await x.rows.turnStarted("a1", x.paseo);
  expect(x.appended[1]).toEqual({ agentId: "a1", row: { type: "plugin", id: "flowly-next-moves-ev1", kind: "flowly-next-moves", version: 1, data: { status: "past", eventId: "ev1", moves: [{ label: "Verify", prompt: "Verify it" }, { label: "Done", moveTo: "done" }] } } });
  // Nothing left to dismiss.
  await x.rows.turnStarted("a1", x.paseo);
  expect(x.appended).toHaveLength(2);
});

test("no card without current suggestions: none, an explicit empty list, or only action moves on a finished card", async () => {
  const x = await setup();
  await x.rows.turnEnded({ taskId: "t", agentId: "a1" }, x.paseo);
  await x.event("ev0", "next_moves_suggested", 1, { moves: [] });
  await x.rows.turnEnded({ taskId: "t", agentId: "a1" }, x.paseo);
  const y = await setup("done");
  await y.event("ev1", "next_moves_suggested", 1, { moves: [{ label: "Done", moveTo: "done" }] });
  await y.rows.turnEnded({ taskId: "t", agentId: "a1" }, y.paseo);
  expect([...x.appended, ...y.appended]).toEqual([]);
});

test("suggestions from an earlier turn are not shown again", async () => {
  const x = await setup();
  await x.event("ev1", "next_moves_suggested", 1, { moves: [{ label: "Verify", prompt: "Verify it" }] });
  await x.event("s2", "agent.turn_started", 2);
  await x.rows.turnEnded({ taskId: "t", agentId: "a1" }, x.paseo);
  expect(x.appended).toEqual([]);
});

test("an append failure is swallowed", async () => {
  const x = await setup();
  await x.event("ev1", "next_moves_suggested", 1, { moves: [{ label: "Verify", prompt: "Verify it" }] });
  x.failAppend();
  await expect(x.rows.turnEnded({ taskId: "t", agentId: "a1" }, x.paseo)).resolves.toBeUndefined();
  await expect(x.rows.turnStarted("a1", x.paseo)).resolves.toBeUndefined();
});
