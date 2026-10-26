import { afterEach, expect, test } from "vitest";
import type { PaseoApi } from "@getpaseo/client";
import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BoardStore } from "./store";
import { FlowLog } from "./flow-log";
import { CommandLog } from "./command-log";
import { WorkflowInsightsService, WorkflowStore, projectScripts } from "./workflow-insights";
import { BoardService } from "./service";
import type { SummarySettings } from "../shared/summary";
import type { CommandRecord, WorkflowSettings } from "../shared/workflow-insights";
import { BackgroundWorkspaces } from "./background-workspace";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
const NOW = Date.parse("2026-10-19T12:00:00.000Z");
const settle = async (service: WorkflowInsightsService, projectId = "p") => {
  for (let i = 0; i < 100 && (await service.view(projectId)).running; i++) await new Promise((r) => setTimeout(r, 10));
};

async function setup() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "flowly-workflow-")));
  roots.push(root);
  const board = new BoardStore(join(root, "data"));
  const flow = new FlowLog(board.directory);
  board.flow = flow;
  await board.mutate((b) => {
    b.projects.push({ id: "p", paseoProjectId: "n", title: "P", description: "", primaryPath: root, repos: [root], revision: 1, createdAt: "", updatedAt: "", archivedAt: null });
    for (const [i, id] of ["aaaaaaaa-1", "bbbbbbbb-2", "cccccccc-3"].entries())
      b.tasks.push({ id, projectId: "p", workspaceId: `w${i}`, sourcePath: root, repoPaths: [root], title: `Card ${i}`, description: "", status: "development", priority: "normal", position: i, revision: 1, operationId: `o${i}`, createdAt: "2026-10-15T01:00:00.000Z", updatedAt: "2026-10-15T01:00:00.000Z", archivedAt: null });
  });
  const created: { workspaceId: string; labels: Record<string, string>; prompt: string; provider: string }[] = [];
  let archived = 0;
  const removed: string[] = [];
  const replies: string[] = [];
  const reply = (cards = ["aaaaaaaa", "bbbbbbbb"]) =>
    JSON.stringify({ findings: [{ target: "repo_tool", title: "i18n helper", evidence: "3 cards", proposal: "scripts/i18n.mjs", benefit: "fewer edits", confidence: "high", cards }], noise: "", verdict: "ok" });
  const timelines = new Map<string, { timestamp: string; item: unknown }[]>();
  const agentLabels = new Map<string, Record<string, string>>();
  const paseo = {
    providers: {
      listAvailable: async () => ({ providers: [{ provider: "claude", available: true }] }),
      listModels: async () => ({ models: [{ id: "claude-sonnet-5" }, { id: "claude-haiku-5-5" }], error: null }),
    },
    agents: {
      list: async () => ({
        entries: ["s0", "s1"].map((id, i) => ({ agent: { id, workspaceId: `w${i}`, provider: "claude", status: "idle", archivedAt: null, updatedAt: "2026-10-19T10:00:00.000Z", labels: agentLabels.get(id) || {} } })),
        pageInfo: { nextCursor: null },
      }),
      ref: (id: string) => ({
        refresh: async () => ({ agent: { id, labels: agentLabels.get(id) || {} } }),
        timeline: { refetch: async () => ({ entries: timelines.get(id) || [], hasOlder: false, startCursor: null }) },
      }),
    },
    workspaces: {
      create: async () => ({ id: "bg-ws" }),
      archive: async () => ({}),
      ref: (workspaceId: string) => ({
        agents: {
          create: async (o: { labels: Record<string, string>; prompt: string; config: { provider: string } }) => {
            created.push({ workspaceId, labels: o.labels, prompt: o.prompt, provider: o.config.provider });
            return {
              id: `run-${created.length}`,
              waitForFinish: async () => ({ status: "idle", error: null, lastMessage: replies.shift() ?? reply() }),
              run: async () => ({ status: "idle", error: null, lastMessage: replies.shift() ?? reply() }),
              current: () => ({ lastUsage: { inputTokens: 2, outputTokens: 900, totalCostUsd: 0.5, contextWindowUsedTokens: 120000 } }),
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
  let settings: WorkflowSettings = { enabled: true, model: "", intervalDays: 7, runHour: 9, timeZone: "UTC" };
  const summary: SummarySettings = { summaryEnabled: true, summaryModel: "", digestEnabled: true, retroEnabled: true };
  const log = new CommandLog(board.directory);
  const state = new WorkflowStore(board.directory);
  let now = NOW;
  const service = new WorkflowInsightsService(board, log, state, flow, async () => settings, async () => summary, async () => "en", () => now, 1000, "/home/me", new BackgroundWorkspaces(board.directory, async () => "live"), async (agent) => {
    removed.push(agent.id);
  });
  return {
    root,
    board,
    log,
    state,
    service,
    paseo,
    created,
    replies,
    summary,
    reply,
    timelines,
    agentLabels,
    archived: () => archived,
    removed,
    setSettings: (s: Partial<WorkflowSettings>) => (settings = { ...settings, ...s }),
    setNow: (t: number) => (now = t),
  };
}

const shell = (callId: string, command: string, status = "completed") => ({ type: "tool_call", callId, status, detail: { type: "shell", command } });
const records = (n: number, cards: number): CommandRecord[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `s:${i}`,
    at: new Date(NOW - 3_600_000).toISOString(),
    taskId: ["aaaaaaaa-1", "bbbbbbbb-2", "cccccccc-3"][i % cards],
    agentId: `s${i % cards}`,
    lane: "development",
    provider: "claude",
    status: "completed",
    actions: ["npm run typecheck", "npm test"],
    explore: 1,
  }));

test("the command log deduplicates, prunes after 30 days, and follows card delete, project remove and purge", async () => {
  const x = await setup();
  const old = { ...records(1, 1)[0], id: "old", at: "2026-09-01T00:00:00.000Z" };
  await x.log.append("p", [old], new Date("2026-09-01T01:00:00.000Z"));
  expect(await x.log.append("p", [...records(3, 3), ...records(3, 3)], new Date(NOW))).toBe(3);
  expect(await x.log.append("p", records(3, 3), new Date(NOW))).toBe(0);
  expect((await x.log.read("p")).map((r) => r.id)).toEqual(["s:0", "s:1", "s:2"]);
  const backup = await x.log.removeTask("p", "aaaaaaaa-1");
  expect(backup).toContain("task-aaaaaaaa-1-commands-");
  expect((await x.log.read("p")).map((r) => r.taskId)).not.toContain("aaaaaaaa-1");
  // A late append for the deleted card is dropped.
  expect(await x.log.append("p", [{ ...records(1, 1)[0], id: "late" }])).toBe(0);
  expect(await x.log.removeProject("p")).toContain("p-commands-");
  expect(await x.log.read("p")).toEqual([]);
  await x.log.append("q", [{ ...records(1, 1)[0], id: "q1", taskId: "q-card" }]);
  expect(await x.log.purge()).toBe(1);
  expect(await x.log.projects()).toEqual([]);
});

test("a turn's shell calls are recorded only when on, for the card of the workspace, never for summarizers", async () => {
  const x = await setup();
  const agent = { id: "s0", workspaceId: "w0", provider: "claude" };
  const timeline = [shell("c1", "cd /x && npm test && grep a b.ts"), { type: "assistant_message", text: "hi" }, shell("c2", "npm test", "running")];
  x.setSettings({ enabled: false });
  expect(await x.service.recordTurn(agent, timeline, x.paseo)).toBe(0);
  x.setSettings({ enabled: true });
  expect(await x.service.recordTurn(agent, timeline, x.paseo)).toBe(1);
  const [r] = await x.log.read("p");
  expect(r).toMatchObject({ id: "s0:c1", taskId: "aaaaaaaa-1", lane: "development", actions: ["npm test"], explore: 1 });
  x.agentLabels.set("s1", { flowly: "summarizer" });
  expect(await x.service.recordTurn({ id: "s1", workspaceId: "w1", provider: "claude" }, [shell("c9", "npm test")], x.paseo)).toBe(0);
  await x.board.mutate((b) => {
    b.projects[0].workflowInsights = false;
  });
  expect(await x.service.recordTurn(agent, [shell("c3", "npm test")], x.paseo)).toBe(0);
});

test("backfill reads card sessions' timelines once", async () => {
  const x = await setup();
  x.timelines.set("s0", [
    { timestamp: "2026-10-18T10:00:00.000Z", item: shell("c1", "npm run lint") },
    { timestamp: "2026-10-01T10:00:00.000Z", item: shell("c0", "npm run old") },
  ]);
  x.timelines.set("s1", [{ timestamp: "2026-10-19T10:00:00.000Z", item: shell("c1", "make build") }]);
  expect(await x.service.backfill("p", x.paseo)).toBe(2);
  expect(await x.service.backfill("p", x.paseo)).toBe(0);
  expect((await x.log.read("p")).map((r) => r.actions[0]).sort()).toEqual(["make build", "npm run lint"]);
});

test("a manual run calls the model once, stores validated suggestions and deletes its session", async () => {
  const x = await setup();
  await x.log.append("p", records(6, 3));
  expect(x.service.run("p", x.paseo, true)).toEqual({ queued: true });
  expect(x.service.run("p", x.paseo, true)).toEqual({ queued: false });
  await settle(x.service);
  const view = await x.service.view("p");
  expect(view.lastRun).toMatchObject({ status: "ok", model: "claude/claude-sonnet-5", manual: true, findings: 1, usage: { contextTokens: 120000, totalCostUsd: 0.5 } });
  expect(view.findings).toHaveLength(1);
  expect(view.findings[0]).toMatchObject({ title: "i18n helper", status: "open", cards: ["aaaaaaaa-1", "bbbbbbbb-2"] });
  expect(x.created[0].labels).toMatchObject({ flowly: "summarizer", "flowly-project": "p", "flowly-insight": "workflow" });
  expect(x.created[0].prompt).toContain("npm run typecheck");
  // Hard-deleted, not archived (AGENTS.md exception).
  expect(x.removed).toEqual(["run-1"]);
  expect(x.archived()).toBe(0);
  // The next run replaces it instead of adding a second copy.
  await x.service.run("p", x.paseo, true);
  await settle(x.service);
  expect((await x.service.view("p")).findings).toHaveLength(1);
  expect((await x.service.view("p")).lastRun).toMatchObject({ findings: 1, replaced: 1 });
});

test("a reply without JSON is retried once, then the run is an error", async () => {
  const x = await setup();
  await x.log.append("p", records(6, 3));
  x.replies.push("## Findings\n- something");
  x.service.run("p", x.paseo, true);
  await settle(x.service);
  expect((await x.service.view("p")).lastRun).toMatchObject({ status: "ok", findings: 1 });
  x.replies.push("no json", "still no json");
  x.service.run("p", x.paseo, true);
  await settle(x.service);
  expect((await x.service.view("p")).lastRun).toMatchObject({ status: "error", reason: "The workflow insights model returned no JSON." });
});

test("Run now on an empty log reads the last week first", async () => {
  const x = await setup();
  x.timelines.set("s0", [{ timestamp: "2026-10-19T10:00:00.000Z", item: shell("c1", "npm run lint") }]);
  x.service.run("p", x.paseo, true);
  await settle(x.service);
  expect((await x.log.read("p")).map((r) => r.id)).toEqual(["s0:c1"]);
  expect((await x.service.view("p")).lastRun?.status).not.toBe("skipped");
  const empty = await setup();
  empty.service.run("p", empty.paseo, true);
  await settle(empty.service);
  // No commands and no card active in 30 days: nothing to analyze (INSIGHTS-REDESIGN-SPEC §3.1).
  expect((await empty.service.view("p")).lastRun).toMatchObject({ status: "skipped", reason: "No recent activity." });
});

test("a configured model that is not offered fails without falling back", async () => {
  const x = await setup();
  await x.log.append("p", records(6, 3));
  x.setSettings({ model: "codex/gpt-9" });
  x.service.run("p", x.paseo, true);
  await settle(x.service);
  expect((await x.service.view("p")).lastRun).toMatchObject({ status: "error", reason: "Workflow insights model codex/gpt-9 is not available." });
  expect(x.created).toHaveLength(0);
});

test("scheduled runs skip quiet periods and empty logs without calling the model", async () => {
  const x = await setup();
  await x.service.tick();
  await settle(x.service);
  expect((await x.service.view("p")).lastRun).toBeNull();
  x.service.attach(x.paseo);
  await x.service.tick();
  await settle(x.service);
  // Nothing collected: the scheduled check waits instead of using up the interval.
  expect((await x.service.view("p")).lastRun).toBeNull();
  await x.log.append("p", records(10, 3));
  x.setNow(NOW + 7 * 86_400_000);
  await x.log.append("p", records(10, 3).map((r) => ({ ...r, id: `n${r.id}`, at: new Date(NOW + 7 * 86_400_000 - 1000).toISOString() })));
  await x.service.tick();
  await settle(x.service);
  expect((await x.service.view("p")).lastRun).toMatchObject({ status: "skipped", reason: "Not enough new activity." });
  expect(x.created).toHaveLength(0);
});

test("suggestions are dismissed with the current revision, accepted by creating a card, and forget a deleted card", async () => {
  const x = await setup();
  await x.log.append("p", records(6, 3));
  x.service.run("p", x.paseo, true);
  await settle(x.service);
  const view = await x.service.view("p");
  const id = view.findings[0].id;
  await expect(x.service.setStatus({ projectId: "p", findingId: id, status: "dismissed", expectedRevision: view.revision - 1 })).rejects.toThrow("REVISION_CONFLICT");
  const dismissed = await x.service.setStatus({ projectId: "p", findingId: id, status: "dismissed", expectedRevision: view.revision });
  await expect(x.service.check("p", id)).rejects.toThrow("no longer open");
  await x.service.setStatus({ projectId: "p", findingId: id, status: "open", expectedRevision: dismissed.revision });
  const service = new BoardService(x.board);
  service.insightFindings = { check: (p, f) => x.service.check(p, f), accept: (p, f, t) => x.service.accept(p, f, t) };
  const task = await service.createTask(
    { projectId: "p", operationId: "from-finding", title: "i18n helper", description: "", status: "todo", priority: "normal", mode: "existing", workspaceId: "w-free", baseRef: "", insightFindingId: id },
    { workspaces: { ref: () => ({ refresh: async () => ({ workspaceDirectory: x.root }) }) } } as unknown as PaseoApi,
  );
  const accepted = (await x.service.view("p")).findings[0];
  expect(accepted).toMatchObject({ status: "accepted", acceptedTaskId: task.id });
  await expect(x.service.setStatus({ projectId: "p", findingId: id, status: "dismissed", expectedRevision: (await x.service.view("p")).revision })).rejects.toThrow("already has a card");
  await expect(
    service.createTask({ projectId: "p", operationId: "again", title: "x", description: "", status: "todo", priority: "normal", mode: "existing", workspaceId: "w-other", baseRef: "", insightFindingId: id }, {} as PaseoApi),
  ).rejects.toThrow("no longer open");
  await x.service.removeTask("p", task.id);
  expect((await x.service.view("p")).findings[0].acceptedTaskId).toBeUndefined();
});

test("project remove backs up runs and suggestions; get_task lists paseo.json scripts", async () => {
  const x = await setup();
  await x.log.append("p", records(6, 3));
  x.service.run("p", x.paseo, true);
  await settle(x.service);
  await x.service.removeProject("p");
  expect((await x.state.read()).findings).toEqual([]);
  const removed = await readdir(join(x.board.directory, "removed"));
  expect(removed.some((n) => n.startsWith("p-workflow-insights-"))).toBe(true);
  expect(removed.some((n) => n.startsWith("p-commands-"))).toBe(true);
  expect(await projectScripts({ primaryPath: x.root })).toEqual([]);
  await writeFile(join(x.root, "paseo.json"), JSON.stringify({ scripts: { verify: { type: "script", command: "npm test" } } }));
  expect(await projectScripts({ primaryPath: x.root })).toEqual([{ name: "verify", type: "script" }]);
  expect(await readFile(join(x.root, "paseo.json"), "utf8")).toContain("npm test");
});

test("a later run replaces the open suggestions, keeps accepted and dismissed ones, and keeps the old list when it finds nothing valid (§5.3)", async () => {
  const x = await setup();
  await x.log.append("p", records(6, 3));
  x.service.run("p", x.paseo, true);
  await settle(x.service);
  const first = (await x.service.view("p")).findings[0];
  await x.state.update((state) => {
    state.findings.push(
      { ...first, id: "dddddddd-acc", fingerprint: "repo_tool:fixture-checklist", title: "Fixture checklist", status: "accepted", acceptedTaskId: "aaaaaaaa-1" },
      { ...first, id: "eeeeeeee-dis", fingerprint: "skill:doc-sync", target: "skill", title: "Doc sync", status: "dismissed" },
    );
    return { value: undefined, changed: true };
  });
  x.setNow(NOW + 86_400_000);
  const finding = (title: string, cards: string[]) => ({ target: "repo_tool", title, evidence: "5 cards", proposal: "scripts/x.mjs", benefit: "less typing", confidence: "high", cards });
  x.replies.push(JSON.stringify({ findings: [finding("Board inspector", ["bbbbbbbb", "cccccccc"]), finding("Fixture checklist", ["aaaaaaaa", "bbbbbbbb"])], noise: "", verdict: "" }));
  x.service.run("p", x.paseo, true);
  await settle(x.service);
  let view = await x.service.view("p");
  expect(view.findings.filter((f) => f.status === "open").map((f) => f.title)).toEqual(["Board inspector"]);
  expect(view.findings.map((f) => f.id)).toEqual(expect.arrayContaining(["dddddddd-acc", "eeeeeeee-dis"]));
  expect(view.findings.some((f) => f.id === first.id)).toBe(false);
  expect(view.lastRun).toMatchObject({ status: "ok", findings: 1, replaced: 1 });
  // Nothing valid (unknown cards): the previous suggestions stay.
  x.setNow(NOW + 2 * 86_400_000);
  x.replies.push(JSON.stringify({ findings: [finding("Something", ["zzzzzzzz", "yyyyyyyy"])], noise: "", verdict: "" }));
  x.service.run("p", x.paseo, true);
  await settle(x.service);
  view = await x.service.view("p");
  expect(view.findings.filter((f) => f.status === "open").map((f) => f.title)).toEqual(["Board inspector"]);
  expect(view.lastRun).toMatchObject({ findings: 0, replaced: 0, reason: "No suggestions this time." });
});

test("the cost of one cycle adds up each included project's latest priced run", async () => {
  const x = await setup();
  await x.board.mutate((b) => {
    b.projects.push({ ...b.projects[0], id: "q", paseoProjectId: "nq", title: "Q" });
    b.projects.push({ ...b.projects[0], id: "off", paseoProjectId: "no", title: "Off", workflowInsights: false });
  });
  const run = (projectId: string, at: string, cost?: number) => ({
    id: `${projectId}-${at}`,
    projectId,
    at,
    from: at,
    to: at,
    model: "m",
    manual: false,
    status: "ok" as const,
    findings: 0,
    replaced: 0,
    stats: { calls: 0, actions: 0, cards: 0, sessions: 0 },
    ...(cost === undefined ? {} : { usage: { totalCostUsd: cost } }),
  });
  await x.state.update((state) => {
    state.runs.push(run("p", "2026-10-18T05:00:00.000Z", 0.9), run("p", "2026-10-19T05:00:00.000Z", 0.5), run("q", "2026-10-19T05:00:00.000Z", 0.4), run("off", "2026-10-19T05:00:00.000Z", 9), run("p", "2026-10-19T06:00:00.000Z"));
    return { value: undefined, changed: true };
  });
  const overview = await x.service.overview();
  expect(overview.costProjects).toBe(2);
  expect(overview.cycleCostUsd).toBeCloseTo(0.9);
});

test("a busy project with two cards is analyzed on schedule, one interval after collecting started", async () => {
  const x = await setup();
  x.service.attach(x.paseo);
  await x.log.append("p", records(30, 2));
  // The first check starts collecting (and reads the last week); no run yet (INSIGHTS-REDESIGN-SPEC §3.1).
  await x.service.tick();
  await settle(x.service);
  await new Promise((r) => setTimeout(r, 20));
  expect((await x.state.read()).collectingSince.p).toBe(new Date(NOW).toISOString());
  await x.service.tick();
  await settle(x.service);
  expect((await x.service.view("p")).lastRun).toBeNull();
  expect(x.created).toHaveLength(0);
  const later = NOW + 7 * 86_400_000;
  x.setNow(later);
  await x.log.append("p", records(30, 2).map((r) => ({ ...r, id: `l${r.id}`, at: new Date(later - 3_600_000).toISOString() })));
  await x.service.tick();
  await settle(x.service);
  expect((await x.service.view("p")).lastRun).toMatchObject({ status: "ok", manual: false });
  expect(x.created).toHaveLength(1);
});

test("skill drafts: material from cards and memory, Run now without commands, add to project, then an update", async () => {
  const x = await setup();
  const body = "## When to use\n" + "Ship through a pull request and wait for the review. ".repeat(6);
  // Two cards active this week, no commands at all.
  await x.board.mutate((b) => {
    for (const [i, id] of ["aaaaaaaa-1", "bbbbbbbb-2"].entries()) {
      b.events.push({ id: `t${i}`, taskId: id, actor: "system", action: "agent.turn_ended", agentId: `s${i}`, at: "2026-10-19T09:00:00.000Z" });
      b.events.push({ id: `d${i}`, taskId: id, actor: "human", action: "status_changed", from: "in_review", to: "done", at: "2026-10-19T10:00:00.000Z" });
    }
    b.tasks[0].tags = [{ tag: "release", by: "agent", at: "" }];
  });
  await x.service.flow.reconcile(await x.board.read());
  x.service.skillSources = {
    summaries: async () => [{ taskId: "aaaaaaaa-1", target: "Ship v1.6.0", recap: "Merged after CodeRabbit", at: "2026-10-19T10:00:00.000Z" }],
    memory: async () => ({ clues: [{ taskId: "aaaaaaaa-1", kind: "feedback", text: "要等 CodeRabbit 评审完再合", at: "2026-10-19T09:30:00.000Z" }], entries: [{ projectId: "p", kind: "pitfall", title: "auto merge 不等于已评审", body: "", status: "active" }] }),
    memoryOn: () => true,
  };
  const draft = (over: Record<string, unknown> = {}) =>
    JSON.stringify({ findings: [{ target: "skill", title: "PR 交付与合入", evidence: "2 张卡", proposal: "", benefit: "", confidence: "high", cards: ["aaaaaaaa", "bbbbbbbb"], skill: { name: "flowly-ship", description: "Use when shipping a change.", body, ...over } }], noise: "", verdict: "" });
  x.replies.push(draft());
  x.service.run("p", x.paseo, true);
  await settle(x.service);
  const prompt = x.created[0].prompt;
  expect(prompt).toContain("Summary: Ship v1.6.0");
  expect(prompt).toContain("Owner (feedback): 要等 CodeRabbit 评审完再合");
  expect(prompt).toContain("- pitfall: auto merge 不等于已评审");
  let view = await x.service.view("p");
  expect(view.lastRun).toMatchObject({ status: "ok", findings: 1 });
  const f = view.findings[0];
  expect(f.skill).toMatchObject({ name: "flowly-ship" });

  await expect(x.service.installSkill({ projectId: "p", findingId: f.id, expectedRevision: view.revision + 5 })).rejects.toThrow("REVISION_CONFLICT");
  const result = await x.service.installSkill({ projectId: "p", findingId: f.id, expectedRevision: view.revision });
  expect(result).toMatchObject({ path: ".agents/skills/flowly-ship/SKILL.md", linked: true });
  expect(await readFile(join(x.root, ".claude/skills/flowly-ship/SKILL.md"), "utf8")).toContain("Use when shipping a change.");
  view = await x.service.view("p");
  expect(view.findings[0]).toMatchObject({ status: "accepted", acceptedSkill: "flowly-ship" });
  expect(view.installed.map((i) => i.name)).toEqual(["flowly-ship"]);
  await expect(x.service.installSkill({ projectId: "p", findingId: f.id, expectedRevision: view.revision })).rejects.toThrow("FINDING_NOT_OPEN");

  // The next run sees the installed text and proposes an update; the view carries the current body for the diff.
  x.replies.push(draft({ updates: true, body: body + "\n## Pitfalls\nAuto merge is not a review.", change: "加了坑" }));
  x.service.run("p", x.paseo, true);
  await settle(x.service);
  expect(x.created[1].prompt).toContain("# Current text of skill flowly-ship");
  view = await x.service.view("p");
  const update = view.findings.find((g) => g.status === "open")!;
  expect(update.skill).toMatchObject({ name: "flowly-ship", updates: true, change: "加了坑" });
  expect(view.current["flowly-ship"]).toBe(body.trim());
  await x.service.installSkill({ projectId: "p", findingId: update.id, expectedRevision: view.revision });
  expect(await readFile(join(x.root, ".agents/skills/flowly-ship/SKILL.md"), "utf8")).toContain("Auto merge is not a review.");
});

for (const secondLookupFails of [false, true]) {
  test(`summary fallback ${secondLookupFails ? "reuses the first inventory after lookup failure" : "discovers a summary-only provider"}`, async () => {
    const x = await setup();
    x.summary.summaryModels = ["custom/summary", "claude/claude-haiku-5-5"];
    let inventories = 0;
    x.paseo.providers.listAvailable = async () => {
      if (++inventories === 2 && secondLookupFails) throw new Error("provider list unavailable");
      return { providers: [{ provider: "claude", available: true }, { provider: "custom", available: true }] } as never;
    };
    x.paseo.providers.listModels = async (provider) => ({ models: [{ id: provider === "custom" ? "summary" : "claude-haiku-5-5" }], error: null }) as never;
    await x.log.append("p", records(6, 3));
    x.service.run("p", x.paseo, true);
    await settle(x.service);
    expect((await x.service.view("p")).lastRun).toMatchObject({ status: "ok", model: secondLookupFails ? "claude/claude-haiku-5-5" : "custom/summary" });
    expect(inventories).toBe(2);
    expect(x.created).toHaveLength(1);
    expect(x.removed).toEqual(["run-1"]);
    expect(x.archived()).toBe(0);
  });
}
