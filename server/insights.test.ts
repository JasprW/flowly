import { afterEach, expect, test } from "vitest";
import type { PaseoApi } from "@getpaseo/client";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BoardStore } from "./store";
import { FlowLog } from "./flow-log";
import { GitStats } from "./git-stats";
import { SummaryStore } from "./summaries";
import { DigestStore, InsightsService } from "./insights";
import type { SummarySettings } from "../shared/summary";
import type { BoardEvent } from "../shared/model";
import { insightsWithHabitsSchema } from "../shared/agent-habits";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
const settle = () => new Promise((r) => setTimeout(r, 30));
const NOW = Date.parse("2026-10-16T12:00:00.000Z");

async function setup(options: { rootWorkspace?: boolean } = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "ultra-insights-")));
  roots.push(root);
  const board = new BoardStore(join(root, "data"));
  const flow = new FlowLog(board.directory);
  board.flow = flow;
  await board.mutate((b) => {
    b.projects.push({ id: "p", paseoProjectId: "n", title: "P", description: "", primaryPath: root, repos: [root], revision: 1, createdAt: "", updatedAt: "", archivedAt: null });
    b.tasks.push({ id: "t", projectId: "p", workspaceId: "w", sourcePath: root, repoPaths: [root], title: "Login", description: "", status: "in_review", priority: "normal", position: 0, revision: 1, operationId: "o", createdAt: "2026-10-15T01:00:00.000Z", updatedAt: "2026-10-15T09:00:00.000Z", archivedAt: null });
    b.events.push(
      { id: "e1", taskId: "t", actor: "human", action: "created", at: "2026-10-15T01:00:00.000Z" },
      { id: "e2", taskId: "t", actor: "agent", action: "status_changed", from: "todo", to: "in_review", at: "2026-10-15T09:00:00.000Z" },
    );
  });
  const created: { workspaceId: string; labels: Record<string, string>; prompt: string; parent?: string; config?: { provider: string } }[] = [];
  let archived = 0;
  const replies: string[] = [];
  let reply = JSON.stringify({ headline: "Login is ready for review", done: [], progressed: [{ text: "Login built", taskId: "t" }], issues: [], next: [] });
  const paseo = {
    providers: {
      listAvailable: async () => ({ providers: [{ provider: "claude", available: true }] }),
      listModels: async () => ({ models: [{ id: "claude-haiku-5-5" }, { id: "claude-sonnet-5-5" }], error: null }),
    },
    agents: {
      list: async () => ({
        entries: [{ agent: { id: "a1", workspaceId: "w", provider: "codex", runtimeInfo: { model: "gpt-6-astra" }, status: "running", archivedAt: null, labels: {} } }],
        pageInfo: { nextCursor: null },
      }),
    },
    workspaces: {
      list: async () => ({
        entries: options.rootWorkspace ? [{ id: "root-ws", projectId: "n", workspaceDirectory: root }] : [],
        pageInfo: { nextCursor: null },
      }),
      ref: (workspaceId: string) => ({
        agents: {
          create: async (o: { labels: Record<string, string>; prompt: string; parent?: string }) => {
            created.push({ workspaceId, ...o });
            return {
              waitForFinish: async () => ({ status: "idle", error: null, lastMessage: replies.shift() ?? reply }),
              archive: async () => {
                archived++;
                return {};
              },
            };
          },
        },
      }),
    },
  } as unknown as PaseoApi;
  let settings: SummarySettings = { summaryEnabled: true, summaryModel: "", digestEnabled: true, retroEnabled: true };
  const digests = new DigestStore(board.directory);
  const git = new GitStats(async () => "");
  const service = new InsightsService(board, flow, git, new SummaryStore(board.directory), digests, async () => settings, async () => "en", 1000, () => NOW);
  return {
    root,
    board,
    flow,
    digests,
    service,
    paseo,
    created,
    archived: () => archived,
    replies,
    setReply: (text: string) => (reply = text),
    setSettings: (s: Partial<SummarySettings>) => (settings = { ...settings, ...s }),
  };
}

test("project insights backfill the flow log and count running sessions", async () => {
  const x = await setup();
  const result = await x.service.project({ projectId: "p", tz: "UTC" }, x.paseo);
  expect((await x.flow.read("p")).map((e) => e.id)).toEqual(["e1", "e2"]);
  expect(result.day).toBe("2026-10-16");
  expect(result.review).toEqual([{ taskId: "t", since: "2026-10-15T09:00:00.000Z" }]);
  // A session is running in the card's workspace: no "nothing is running" suggestion.
  expect(result.insights.map((i) => i.rule)).not.toContain("R7");
  await expect(x.service.project({ projectId: "nope", tz: "UTC" }, x.paseo)).rejects.toThrow("Project not found.");
});

test("project insights carry the agent habits; turns without a stamped model take the session's current one", async () => {
  const x = await setup();
  const a = (id: string, action: string, at: string, extra: Partial<BoardEvent> = {}): BoardEvent => ({ id, taskId: "t", actor: action.startsWith("agent.") ? "system" : "agent", action, agentId: "a1", at, ...extra });
  await x.board.mutate((b) => {
    b.events.push(
      a("h1", "agent.turn_started", "2026-10-16T09:00:00.000Z"),
      a("h2", "next_moves_suggested", "2026-10-16T09:01:00.000Z", { moves: [{ label: "Verify", prompt: "Verify it." }] }),
      a("h3", "status_changed", "2026-10-16T09:02:00.000Z", { from: "development", to: "in_review", reportKind: "progress" }),
      a("h4", "agent.turn_ended", "2026-10-16T09:03:00.000Z", { outcome: "completed" }),
      a("h5", "agent.turn_started", "2026-10-16T10:00:00.000Z"),
      a("h6", "status_changed", "2026-10-16T10:01:00.000Z", { from: "development", to: "in_review", reportKind: "progress" }),
      a("h7", "agent.turn_ended", "2026-10-16T10:02:00.000Z", { outcome: "completed", model: "claude/claude-sonnet-5", pick: 0 }),
    );
  });
  const result = await x.service.project({ projectId: "p", tz: "UTC" }, x.paseo);
  // The RPC validates its answer against this schema; a mismatch would fail every Insights read.
  const { habits } = insightsWithHabitsSchema.parse(result);
  expect(habits.days).toHaveLength(7);
  expect(habits.days.at(-1)).toMatchObject({ day: "2026-10-16", deliveries: 2, moves: 1, movesAny: 1, offered: 1, picked: 1 });
  expect(Object.fromEntries(habits.models.map((m) => [m.model, m.deliveries]))).toEqual({ "codex/gpt-6-astra": 1, "claude/claude-sonnet-5": 1 });
  // The flow log keeps what the counters need from a suggestion, not its text.
  const logged = (await x.flow.read("p")).find((e) => e.id === "h2");
  expect(logged).toMatchObject({ offered: 1 });
  expect(JSON.stringify(logged)).not.toContain("Verify it");
});

test("a past day's digest is generated once on read; today's only on refresh", async () => {
  const x = await setup({ rootWorkspace: true });
  const first = await x.service.digest({ projectId: "p", tz: "UTC", day: "2026-10-15" }, x.paseo);
  expect(first).toMatchObject({ entry: null, running: true, empty: false });
  await settle();
  const second = await x.service.digest({ projectId: "p", tz: "UTC", day: "2026-10-15" }, x.paseo);
  expect(second.entry).toMatchObject({ headline: "Login is ready for review", progressed: [{ text: "Login built", taskId: "t" }], model: "claude/claude-haiku-5-5" });
  expect(x.created.length).toBe(1);
  expect(x.created[0]).toMatchObject({ workspaceId: "root-ws", labels: { flowly: "summarizer", "flowly-project": "p" } });
  expect(x.created[0].prompt).toContain("## Card t: Login");
  expect(x.created[0].prompt).toContain("Todo → In review (agent)");
  expect(x.archived()).toBe(1);

  const today = await x.service.digest({ projectId: "p", tz: "UTC", day: "2026-10-16" }, x.paseo);
  expect(today).toMatchObject({ entry: null, running: false, empty: true });
  expect(x.created.length).toBe(1);
});

test("auto generation follows the setting; failures are recorded and the session archived; no workspace falls back to a card", async () => {
  const x = await setup();
  x.setSettings({ digestEnabled: false });
  const off = await x.service.digest({ projectId: "p", tz: "UTC", day: "2026-10-15" }, x.paseo);
  expect(off).toMatchObject({ running: false, enabled: false });
  x.setReply("not json");
  x.service.refresh({ projectId: "p", tz: "UTC", day: "2026-10-15" }, x.paseo);
  await settle();
  const failed = await x.service.digest({ projectId: "p", tz: "UTC", day: "2026-10-15" }, x.paseo);
  expect(failed.error?.message).toContain("no JSON");
  expect(x.created[0].workspaceId).toBe("w");
  expect(x.archived()).toBe(1);
});

test("project removal backs up and drops digests", async () => {
  const x = await setup({ rootWorkspace: true });
  await x.service.digest({ projectId: "p", tz: "UTC", day: "2026-10-15" }, x.paseo);
  await settle();
  expect((await x.digests.read()).entries.length).toBe(1);
  const backup = await x.digests.removeProject("p");
  expect(backup).toContain("p-digests-");
  expect((await x.digests.read()).entries).toEqual([]);
});

test("daily digest follows summary model priority and records the successful model", async () => {
  const x = await setup();
  x.setSettings({ summaryModels: ["claude/claude-sonnet-5-5", "claude/claude-haiku-5-5"] });
  x.replies.push("quota limit");
  await x.service.digest({ projectId: "p", tz: "UTC", day: "2026-10-15" }, x.paseo);
  await settle();
  const result = await x.service.digest({ projectId: "p", tz: "UTC", day: "2026-10-15" }, x.paseo);
  expect(result.entry?.model).toBe("claude/claude-haiku-5-5");
  expect(x.created.map((a) => a.config?.provider)).toEqual(["claude/claude-sonnet-5-5", "claude/claude-haiku-5-5"]);
  expect(x.archived()).toBe(2);
});
