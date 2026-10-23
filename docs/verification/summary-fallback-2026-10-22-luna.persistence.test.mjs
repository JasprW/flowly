import { afterEach, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BoardStore } from "../../server/store.ts";
import { SummaryService, SummaryStore } from "../../server/summaries.ts";

const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("a successful model followed by a persistence error does not call another model", async () => {
  const root = await mkdtemp(join(tmpdir(), "flowly-summary-persist-"));
  roots.push(root);
  const board = new BoardStore(join(root, "data"));
  const now = new Date().toISOString();
  await board.mutate((state) => {
    state.projects.push({ id: "p", paseoProjectId: "native-p", title: "P", description: "", primaryPath: root, repos: [root], revision: 1, createdAt: now, updatedAt: now, archivedAt: null });
    state.tasks.push({ id: "t", projectId: "p", workspaceId: "w", sourcePath: root, repoPaths: [root], title: "T", description: "", status: "development", priority: "normal", position: 0, revision: 1, operationId: "o", createdAt: now, updatedAt: now, archivedAt: null });
  });

  const store = new SummaryStore(board.directory);
  await store.add({ taskId: "t", model: "old", agentIds: [], state: "previous", target: "", recap: "", next: "" });
  store.add = async () => {
    throw new Error("simulated persistence failure");
  };

  const created = [];
  const removed = [];
  const paseo = {
    providers: {
      listAvailable: async () => ({ providers: [{ provider: "claude", available: true }, { provider: "codex", available: true }] }),
      listModels: async (provider) => ({ models: [{ id: provider === "claude" ? "claude-haiku-5-5" : "gpt-6-luna" }], error: null }),
    },
    workspaces: {
      ref: (workspaceId) => ({
        agents: {
          create: async (input) => {
            const id = `summary-child-${created.length + 1}`;
            created.push({ id, workspaceId, provider: input.config.provider, parent: input.parent });
            return {
              id,
              waitForFinish: async () => ({
                status: "idle",
                final: null,
                error: null,
                lastMessage: JSON.stringify({ update: true, state: "new", target: "Goal: g", recap: "r", next: "n" }),
              }),
              archive: async () => undefined,
            };
          },
        },
      }),
    },
    agents: { ref: () => ({ refresh: async () => null }) },
  };
  const service = new SummaryService(
    board,
    store,
    async () => ({ summaryEnabled: true, summaryModel: "", digestEnabled: true, retroEnabled: true }),
    async () => "en",
    undefined,
    undefined,
    async (agent) => { removed.push(agent.id); },
  );

  await service.enqueue("t", "parent-session", [
    { type: "user_message", text: "do work" },
    { type: "assistant_message", text: "done" },
  ], paseo);

  expect(created.map((child) => child.provider)).toEqual(["claude/claude-haiku-5-5"]);
  expect(removed).toEqual(["summary-child-1"]);
  expect(await store.latest("t")).toMatchObject({ state: "previous", model: "old" });
  expect((await store.read()).errors[0].message).toBe("simulated persistence failure");
});
