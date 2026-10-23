import { describe, expect, it } from "vitest";
import { prepare, type AnalyzeInput, type FlowEntry, type Insight } from "./insights";
import type { Task } from "./model";
import { cardStats, cardTokens, group, weekOf, workflowStats, type CardStat } from "./workflow-stats";

const H = 3_600_000;
let n = 0;
const ev = (taskId: string, at: string, action: string, extra: Partial<FlowEntry> = {}): FlowEntry => ({ id: `e${++n}`, at, taskId, actor: "system", action, ...extra });
const move = (taskId: string, at: string, from: string, to: string, extra: Partial<FlowEntry> = {}) => ev(taskId, at, "status_changed", { from, to, actor: "human", ...extra });
const task = (id: string, extra: Partial<Task> = {}) =>
  ({ id, title: `Task ${id}`, status: "done", priority: "normal", createdAt: "2026-10-12T00:00:00.000Z", archivedAt: null, workspaceId: `w-${id}`, ...extra }) as Task;
const base = (extra: Partial<AnalyzeInput>): AnalyzeInput => ({
  tasks: [],
  entries: [],
  now: Date.parse("2026-10-22T12:00:00.000Z"),
  tz: "UTC",
  runningAgents: new Set(),
  runningWorkspaces: new Set(),
  commits: [],
  repos: 0,
  gitError: null,
  ...extra,
});
const statsOf = (input: AnalyzeInput, modelOf?: (id: string) => string | undefined) => {
  const p = prepare(input);
  return cardStats({ histories: p.histories, sessions: p.sessions, modelOf });
};
const created = (id: string, at = "2026-10-12T00:00:00.000Z") => ev(id, at, "created", { actor: "human" });
const turn = (id: string, agent: string, from: string, to: string, extra: Partial<FlowEntry> = {}) => [
  ev(id, from, "agent.turn_started", { agentId: agent }),
  ev(id, to, "agent.turn_ended", { agentId: agent, outcome: "completed", ...extra }),
];

describe("per card (§3.1, §3.2)", () => {
  it("counts from creation to the first Done; rounds include resumes and drags back, not the move to Done", () => {
    const entries = [
      created("a"),
      move("a", "2026-10-12T01:00:00.000Z", "todo", "development"),
      ...turn("a", "s1", "2026-10-12T01:00:00.000Z", "2026-10-12T02:00:00.000Z", { byUser: true, model: "m/x" }),
      move("a", "2026-10-12T02:00:00.000Z", "development", "in_review", { actor: "agent" }),
      // the user replies on the card in review: rule A1 resumes it
      move("a", "2026-10-12T03:00:00.000Z", "in_review", "development", { actor: "system", rule: "A1" }),
      ...turn("a", "s1", "2026-10-12T03:00:00.000Z", "2026-10-12T04:00:00.000Z", { byUser: true, model: "m/x" }),
      ev("a", "2026-10-12T03:30:00.000Z", "agent.permission_requested", { agentId: "s1", tool: "Bash" }),
      move("a", "2026-10-12T04:00:00.000Z", "development", "in_review", { actor: "agent" }),
      // dragged back by hand
      move("a", "2026-10-12T05:00:00.000Z", "in_review", "development"),
      move("a", "2026-10-12T06:00:00.000Z", "development", "in_review", { actor: "agent" }),
      move("a", "2026-10-12T07:00:00.000Z", "in_review", "done"),
      // after the first Done: not counted
      move("a", "2026-10-13T00:00:00.000Z", "done", "development"),
      move("a", "2026-10-13T01:00:00.000Z", "development", "done"),
    ];
    const [a] = statsOf(base({ tasks: [task("a")], entries }));
    expect(a).toMatchObject({ rounds: 2, messages: 2, known: 2, turns: 2, permissions: 1, moves: 3, model: "m/x" });
    expect(a.finishedAt).toBe(Date.parse("2026-10-12T07:00:00.000Z"));
  });

  it("drops an A1 → A1r pair (a message that changed nothing) from the rounds", () => {
    const entries = [
      created("a"),
      move("a", "2026-10-12T01:00:00.000Z", "todo", "in_review", { actor: "agent" }),
      move("a", "2026-10-12T02:00:00.000Z", "in_review", "development", { actor: "system", rule: "A1" }),
      move("a", "2026-10-12T02:10:00.000Z", "development", "in_review", { actor: "system", rule: "A1r" }),
      move("a", "2026-10-12T03:00:00.000Z", "in_review", "done"),
    ];
    expect(statsOf(base({ tasks: [task("a")], entries }))[0].rounds).toBe(0);
  });

  it("leaves out cards without a Done and cards whose history was cut", () => {
    const entries = [created("a"), move("a", "2026-10-12T01:00:00.000Z", "todo", "development"), move("b", "2026-10-12T01:00:00.000Z", "todo", "done")];
    expect(statsOf(base({ tasks: [task("a", { status: "development" }), task("b")], entries }))).toEqual([]);
  });
});

describe("time split (§3.3)", () => {
  it("splits the active span into working, waiting and idle; parallel sessions count once", () => {
    const entries = [
      created("a"),
      move("a", "2026-10-12T00:00:00.000Z", "todo", "development"),
      ...turn("a", "s1", "2026-10-12T00:00:00.000Z", "2026-10-12T02:00:00.000Z"),
      ...turn("a", "s2", "2026-10-12T01:00:00.000Z", "2026-10-12T03:00:00.000Z"),
      // a question, answered by the next turn at 05:00
      ev("a", "2026-10-12T03:00:00.000Z", "progress_reported", { actor: "agent", reportKind: "question", agentId: "s1" }),
      ...turn("a", "s1", "2026-10-12T05:00:00.000Z", "2026-10-12T06:00:00.000Z"),
      move("a", "2026-10-12T06:00:00.000Z", "development", "in_review", { actor: "agent" }),
      // idle 08:00–10:00 would need a work lane: it waits in review until 10:00
      move("a", "2026-10-12T10:00:00.000Z", "in_review", "done"),
    ];
    const [a] = statsOf(base({ tasks: [task("a")], entries }));
    expect(a.working).toBe(4 * H);
    expect(a.waiting).toBe(2 * H + 4 * H);
    expect(a.idle).toBe(0);
    const idle = [created("b"), move("b", "2026-10-12T00:00:00.000Z", "todo", "development"), ...turn("b", "s3", "2026-10-12T00:00:00.000Z", "2026-10-12T01:00:00.000Z"), move("b", "2026-10-12T04:00:00.000Z", "development", "done")];
    const [b] = statsOf(base({ tasks: [task("b")], entries: idle }));
    expect([b.working, b.waiting, b.idle]).toEqual([H, 0, 3 * H]);
  });
});

const card = (over: Partial<CardStat>): CardStat => ({
  taskId: "x",
  createdAt: 0,
  start: 0,
  finishedAt: Date.parse("2026-10-21T12:00:00.000Z"),
  turns: 2,
  known: 2,
  messages: 1,
  permissions: 0,
  moves: 1,
  questions: 0,
  rounds: 1,
  working: H,
  waiting: H,
  idle: 0,
  model: "m/x",
  ...over,
});

describe("groups (§3.0, §3.1)", () => {
  it("takes medians; attention is null below 80% byUser coverage", () => {
    const g = group([card({ rounds: 0 }), card({ rounds: 2, messages: 3 }), card({ rounds: 30 })]);
    expect(g).toMatchObject({ finished: 3, rounds: 2, onePass: 1, attention: 2, coverage: 1 });
    const old = group([card({ known: 1, turns: 4 }), card({ known: 0, turns: 4 })]);
    expect(old.coverage).toBe(1 / 8);
    expect(old.attention).toBeNull();
    expect(old.rounds).toBe(1);
  });
});

describe("window, weeks, models (§3.5, §3.6, §3.7)", () => {
  const anomalies: Insight[] = ["R1", "R2", "R3", "R4", "R5", "R6", "R7"].map((rule) => ({ rule, severity: "info", text: rule, taskIds: [] }));
  const at = (iso: string) => Date.parse(iso);
  const cards = [
    card({ taskId: "a", finishedAt: at("2026-10-21T12:00:00.000Z"), model: "m/x" }),
    card({ taskId: "b", finishedAt: at("2026-10-20T12:00:00.000Z"), model: "m/x" }),
    card({ taskId: "c", finishedAt: at("2026-10-19T12:00:00.000Z"), model: "m/x" }),
    card({ taskId: "d", finishedAt: at("2026-10-18T12:00:00.000Z"), model: "m/y" }),
    card({ taskId: "e", finishedAt: at("2026-10-01T12:00:00.000Z"), model: "m/y" }),
  ];
  const stats = (end: string) =>
    workflowStats({ cards, entries: [], incomplete: 0, end, today: "2026-10-22", tz: "UTC", now: at("2026-10-22T12:00:00.000Z"), landed: [{ taskId: "c", title: "Add verify script" }], insights: anomalies });

  it("windows the last 7 days and pools the 4 windows before as the baseline", () => {
    const s = stats("2026-10-22");
    expect(s.window).toEqual({ from: "2026-10-16", to: "2026-10-22", current: true });
    expect(s.now.finished).toBe(4);
    expect(s.baseline.finished).toBe(1);
  });

  it("gives a model its own row from 3 cards; the rest merge into other", () => {
    expect(stats("2026-10-22").models.map((m) => [m.model, m.finished])).toEqual([
      ["m/x", 3],
      ["", 1],
    ]);
  });

  it("splits weeks on Monday, marks this week partial and notes landed suggestions", () => {
    expect(weekOf("2026-10-22")).toBe("2026-10-19");
    expect(weekOf("2026-10-19")).toBe("2026-10-19");
    expect(weekOf("2026-10-18")).toBe("2026-10-12");
    const s = stats("2026-10-22");
    // Older weeks have no finished card here and are dropped; card "e" (Oct 1) keeps them down to its week.
    expect(s.weeks.map((w) => w.week)).toEqual(["2026-10-19", "2026-10-12", "2026-10-05", "2026-09-28"]);
    expect(s.weeks[0]).toMatchObject({ week: "2026-10-19", partial: true, finished: 3, landed: ["Add verify script"] });
    expect(s.weeks[1]).toMatchObject({ week: "2026-10-12", partial: false, finished: 1, landed: [] });
  });

  it("keeps only the workflow anomalies, and only while the window reaches today", () => {
    expect(stats("2026-10-22").anomalies.map((a) => a.rule)).toEqual(["R2", "R3", "R6"]);
    expect(stats("2026-10-15").anomalies).toEqual([]);
  });

  it("tops the permission tools and the cards that asked most", () => {
    const entries = [
      ev("a", "2026-10-20T00:00:00.000Z", "agent.permission_requested", { tool: "Bash" }),
      ev("a", "2026-10-20T01:00:00.000Z", "agent.permission_requested", { tool: "Bash" }),
      ev("b", "2026-10-20T01:00:00.000Z", "agent.permission_requested", { tool: "Write" }),
      ev("b", "2026-10-20T01:00:00.000Z", "agent.permission_requested"),
      ev("b", "2026-10-20T02:00:00.000Z", "progress_reported", { reportKind: "question" }),
      ev("b", "2026-10-20T02:00:00.000Z", "agent.turn_ended", { outcome: "failed" }),
      ev("b", "2026-10-20T03:00:00.000Z", "agent.turn_ended", { outcome: "completed" }),
    ];
    const s = workflowStats({ cards, entries, incomplete: 0, end: "2026-10-22", today: "2026-10-22", tz: "UTC", now: at("2026-10-22T12:00:00.000Z"), landed: [], insights: [] });
    expect(s.time.topTools).toEqual([
      { tool: "Bash", count: 2 },
      { tool: "Write", count: 1 },
    ]);
    expect(s.time.topAskers).toEqual([{ taskId: "b", count: 1 }]);
    expect(s.quality).toMatchObject({ turns: 2, failed: 1, failedShare: 0.5 });
  });
});

describe("tokens per card (§3.4)", () => {
  it("sums each card's tokens over its active span only", () => {
    const slot = (iso: string) => Math.floor(Date.parse(iso) / (15 * 60_000));
    const usage = (input: number) => ({ input, cacheRead: input, cacheWrite: 0, output: 0, reasoning: 0 });
    const buckets = new Map([
      [slot("2026-10-20T01:00:00.000Z"), usage(10)],
      [slot("2026-10-20T05:00:00.000Z"), usage(100)], // after the card finished
    ]);
    const r = cardTokens({
      series: [{ taskId: "a", buckets }, { taskId: "a", buckets: null }],
      cards: [{ taskId: "a", start: Date.parse("2026-10-20T00:00:00.000Z"), finishedAt: Date.parse("2026-10-20T02:00:00.000Z"), inWindow: true, week: "2026-10-19" }],
      modelOf: () => "m/x",
      models: ["m/x"],
    });
    expect(r.perCard).toBe(20);
    expect(r.cacheRate).toBe(0.5);
    expect(r.weeks).toEqual([{ week: "2026-10-19", perCard: 20 }]);
    expect(r.models).toEqual([{ model: "m/x", perCard: 20 }]);
    expect([r.sessions, r.missing]).toEqual([2, 1]);
  });
});
