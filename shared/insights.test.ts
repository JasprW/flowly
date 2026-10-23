import { expect, test } from "vitest";
import { addDays, analyze, dayKey, dayStart, replay, sessionIntervals, type AnalyzeInput, type FlowEntry } from "./insights";
import type { Task } from "./model";

const H = 3_600_000;
let n = 0;
const ev = (taskId: string, at: string, action: string, extra: Partial<FlowEntry> = {}): FlowEntry => ({
  id: `e${++n}`,
  at,
  taskId,
  actor: "human",
  action,
  ...extra,
});
const move = (taskId: string, at: string, from: string, to: string, actor: FlowEntry["actor"] = "human") =>
  ev(taskId, at, "status_changed", { from, to, actor });
const task = (id: string, extra: Partial<Task> = {}) =>
  ({ id, title: `Task ${id}`, status: "todo", priority: "normal", createdAt: "2026-10-10T01:00:00.000Z", archivedAt: null, workspaceId: `w-${id}`, ...extra }) as Task;
const base = (extra: Partial<AnalyzeInput>): AnalyzeInput => ({
  tasks: [],
  entries: [],
  now: Date.parse("2026-10-16T12:00:00.000Z"),
  tz: "UTC",
  runningAgents: new Set(),
  runningWorkspaces: new Set(),
  commits: [],
  repos: 0,
  gitError: null,
  ...extra,
});

test("day keys and boundaries follow the time zone, including DST", () => {
  const t = Date.parse("2026-10-15T20:00:00.000Z");
  expect(dayKey(t, "UTC")).toBe("2026-10-15");
  expect(dayKey(t, "Asia/Singapore")).toBe("2026-10-16");
  expect(new Date(dayStart("2026-10-16", "Asia/Singapore")).toISOString()).toBe("2026-10-15T16:00:00.000Z");
  // US DST ends 2026-11-01: that day is 25 hours long in New York.
  const ny = "America/New_York";
  expect(dayStart("2026-11-02", ny) - dayStart("2026-11-01", ny)).toBe(25 * H);
  expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
});

test("replay rebuilds lane intervals; a card without a created event is incomplete", () => {
  const now = Date.parse("2026-10-12T00:00:00.000Z");
  const [a, b] = replay(
    [task("a", { status: "done" }), task("b", { status: "development" })],
    [
      ev("a", "2026-10-10T01:00:00.000Z", "created"),
      move("a", "2026-10-10T02:00:00.000Z", "todo", "in_progress"),
      move("a", "2026-10-11T02:00:00.000Z", "in_progress", "done"),
    ],
    now,
  );
  expect(a.incomplete).toBe(false);
  expect(a.intervals.map((i) => [i.status, i.end - i.start])).toEqual([
    ["todo", H],
    ["development", 24 * H],
    ["done", 22 * H],
  ]);
  expect(b.incomplete).toBe(true);
  expect(b.intervals).toEqual([{ status: "development", start: Date.parse("2026-10-10T01:00:00.000Z"), end: now }]);
});

test("session intervals pair turns; an open turn counts only while running", () => {
  const now = Date.parse("2026-10-16T12:00:00.000Z");
  const entries = [
    ev("a", "2026-10-16T08:00:00.000Z", "agent.turn_started", { agentId: "s1" }),
    ev("a", "2026-10-16T09:00:00.000Z", "agent.turn_ended", { agentId: "s1" }),
    ev("a", "2026-10-16T10:00:00.000Z", "agent.turn_started", { agentId: "s1" }),
    ev("b", "2026-10-16T11:00:00.000Z", "agent.turn_started", { agentId: "s2" }),
  ];
  expect(sessionIntervals(entries, now, new Set()).length).toBe(1);
  expect(sessionIntervals(entries, now, new Set(["s1"])).map((s) => s.end - s.start)).toEqual([H, 2 * H]);
});

test("day stats count flow, rework, turns, agent time, peak sessions and lanes", () => {
  const day = "2026-10-16";
  const entries = [
    ev("a", "2026-10-16T01:00:00.000Z", "created"),
    move("a", "2026-10-16T02:00:00.000Z", "todo", "development", "agent"),
    move("a", "2026-10-16T03:00:00.000Z", "development", "in_review", "agent"),
    move("a", "2026-10-16T04:00:00.000Z", "in_review", "development"),
    move("a", "2026-10-16T05:00:00.000Z", "development", "done"),
    move("b", "2026-10-15T05:00:00.000Z", "todo", "done"),
    move("b", "2026-10-16T06:00:00.000Z", "done", "development"),
    ev("a", "2026-10-16T02:00:00.000Z", "agent.turn_started", { agentId: "s1" }),
    ev("b", "2026-10-16T02:30:00.000Z", "agent.turn_started", { agentId: "s2" }),
    ev("a", "2026-10-16T03:00:00.000Z", "agent.turn_ended", { agentId: "s1", outcome: "completed" }),
    ev("b", "2026-10-16T04:30:00.000Z", "agent.turn_ended", { agentId: "s2", outcome: "failed" }),
    ev("a", "2026-10-16T03:00:00.000Z", "progress_reported", { reportKind: "question", actor: "agent" }),
  ];
  const result = analyze(
    base({
      day,
      tasks: [task("a", { status: "done", createdAt: "2026-10-16T01:00:00.000Z" }), task("b", { status: "development" })],
      entries,
      commits: [{ hash: "h", at: "2026-10-16T07:00:00Z", subject: "x", repo: "/r", files: [{ path: "f.ts", added: 5, deleted: 2 }] }],
    }),
  );
  const s = result.stats;
  expect(s).toMatchObject({ created: 1, done: 1, reopened: 1, rework: 1, questions: 1, peakSessions: 2, commits: 1, added: 5, deleted: 2 });
  expect(s.turns).toEqual({ completed: 1, failed: 1, canceled: 0 });
  expect(s.agentMs).toBe(H + 2 * H);
  expect(s.lanes).toEqual({ done: 1, development: 1 });
  expect(result.git.topFiles).toEqual([{ path: "f.ts", changes: 7, commits: 1 }]);
  expect(result.trend.length).toBe(7);
  expect(result.trend[6]).toMatchObject({ day, created: 1, done: 1, work: 1 });
});

test("waiting lists: In review oldest first with the time it entered", () => {
  const result = analyze(
    base({
      tasks: [task("a", { status: "in_review" }), task("b", { status: "in_review" })],
      entries: [move("a", "2026-10-16T10:00:00.000Z", "development", "in_review"), move("b", "2026-10-15T10:00:00.000Z", "development", "in_review")],
    }),
  );
  expect(result.review).toEqual([
    { taskId: "b", since: "2026-10-15T10:00:00.000Z" },
    { taskId: "a", since: "2026-10-16T10:00:00.000Z" },
  ]);
});

const rules = (input: Partial<AnalyzeInput>) => analyze(base(input)).insights.map((i) => i.rule);

test("R1 review backlog: three cards, or one waiting 24h", () => {
  const recent = move("a", "2026-10-16T10:00:00.000Z", "development", "in_review");
  expect(rules({ tasks: [task("a", { status: "in_review" })], entries: [recent] })).not.toContain("R1");
  expect(rules({ tasks: [task("a", { status: "in_review" })], entries: [move("a", "2026-10-15T10:00:00.000Z", "development", "in_review")] })).toContain("R1");
  const three = ["a", "b", "c"].map((id) => task(id, { status: "in_review" }));
  expect(rules({ tasks: three, entries: three.map((t) => move(t.id, "2026-10-16T10:00:00.000Z", "development", "in_review")) })).toContain("R1");
});

test("R2 stalled: 48h without activity in a work lane, unless a session runs", () => {
  const stale = [task("a", { status: "development" })];
  const entries = [move("a", "2026-10-14T10:00:00.000Z", "todo", "development")];
  expect(rules({ tasks: stale, entries })).toContain("R2");
  expect(rules({ tasks: stale, entries, runningWorkspaces: new Set(["w-a"]) })).not.toContain("R2");
  expect(rules({ tasks: stale, entries: [...entries, ev("a", "2026-10-15T10:00:00.000Z", "agent.turn_ended")] })).not.toContain("R2");
});

test("R3 rework hotspot: three review rounds and not finished (INSIGHTS-REDESIGN-SPEC §3.7)", () => {
  const back = (at: string) => move("a", at, "in_review", "development");
  const two = [back("2026-10-16T01:00:00.000Z"), back("2026-10-16T02:00:00.000Z")];
  const three = [...two, back("2026-10-16T03:00:00.000Z")];
  expect(rules({ tasks: [task("a", { status: "development" })], entries: two })).not.toContain("R3");
  expect(rules({ tasks: [task("a", { status: "development" })], entries: three })).toContain("R3");
  expect(rules({ tasks: [task("a", { status: "done" })], entries: three })).not.toContain("R3");
});

test("R4 priority inversion: an urgent card waits while lower priority work starts", () => {
  const urgent = task("u", { status: "todo", priority: "urgent", createdAt: "2026-10-10T00:00:00.000Z" });
  const low = task("l", { status: "development", priority: "normal" });
  const started = move("l", "2026-10-12T00:00:00.000Z", "todo", "development");
  expect(rules({ tasks: [urgent, low], entries: [started], runningWorkspaces: new Set(["w-l"]) })).toContain("R4");
  expect(rules({ tasks: [urgent, low], entries: [], runningWorkspaces: new Set(["w-l"]) })).not.toContain("R4");
  const fresh = task("u", { status: "todo", priority: "urgent", createdAt: "2026-10-15T00:00:00.000Z" });
  expect(rules({ tasks: [fresh, low], entries: [move("l", "2026-10-15T12:00:00.000Z", "todo", "development")], runningWorkspaces: new Set(["w-l"]) })).not.toContain("R4");
});

test("R5 too much in parallel versus the finish rate", () => {
  const five = ["a", "b", "c", "d", "e"].map((id) => task(id, { status: "development" }));
  const running = new Set(five.map((t) => t.workspaceId));
  expect(rules({ tasks: five, runningWorkspaces: running })).toContain("R5");
  expect(rules({ tasks: five.slice(0, 4), runningWorkspaces: running })).not.toContain("R5");
  const done = ["2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15"].flatMap((d, i) =>
    [0, 1, 2].map((k) => move(`x${i}${k}`, `${d}T10:00:00.000Z`, "development", "done")),
  );
  expect(rules({ tasks: five, entries: done, runningWorkspaces: running })).not.toContain("R5");
});

test("R6 repeated failures within 24h", () => {
  const fail = (at: string) => ev("a", at, "agent.turn_ended", { outcome: "failed", agentId: "s" });
  const t = [task("a", { status: "development" })];
  const running = new Set(["w-a"]);
  expect(rules({ tasks: t, entries: [fail("2026-10-16T01:00:00.000Z"), fail("2026-10-16T02:00:00.000Z")], runningWorkspaces: running })).toContain("R6");
  expect(rules({ tasks: t, entries: [fail("2026-10-14T01:00:00.000Z"), fail("2026-10-16T02:00:00.000Z")], runningWorkspaces: running })).not.toContain("R6");
});

test("R7 next up: nothing running, Todo by priority then wait; at most 5 insights, warnings first", () => {
  const todo = [
    task("a", { priority: "low" }),
    task("b", { priority: "high" }),
    task("c", { priority: "normal" }),
    task("d", { priority: "normal", createdAt: "2026-10-01T00:00:00.000Z" }),
  ];
  const r7 = analyze(base({ tasks: todo })).insights.find((i) => i.rule === "R7")!;
  expect(r7.taskIds).toEqual(["b", "d", "c"]);
  expect(rules({ tasks: todo, runningWorkspaces: new Set(["w-a"]) })).not.toContain("R7");
  const many = Array.from({ length: 8 }, (_, i) => task(`f${i}`, { status: "development" }));
  const failures = many.flatMap((t) => [0, 1].map((k) => ev(t.id, `2026-10-16T0${k + 1}:00:00.000Z`, "agent.turn_ended", { outcome: "failed" })));
  const list = analyze(base({ tasks: [...many, ...todo], entries: failures })).insights;
  expect(list.length).toBe(5);
  expect(list.every((i) => i.severity === "warning")).toBe(true);
});

test("a resume that rule A1r undid is neither rework nor a new review wait", () => {
  const entries = [
    move("a", "2026-10-16T01:00:00.000Z", "development", "in_review", "agent"),
    { ...move("a", "2026-10-16T05:00:00.000Z", "in_review", "development", "system"), rule: "A1" },
    { ...move("a", "2026-10-16T05:01:00.000Z", "development", "in_review", "system"), rule: "A1r" },
  ];
  const result = analyze(base({ tasks: [task("a", { status: "in_review" })], entries }));
  expect(result.stats.rework).toBe(0);
  expect(result.review).toEqual([{ taskId: "a", since: "2026-10-16T01:00:00.000Z" }]);
  // A resume that stuck (the agent went on working) is rework.
  const kept = analyze(base({ tasks: [task("a", { status: "development" })], entries: entries.slice(0, 2) }));
  expect(kept.stats.rework).toBe(1);
});

test("tokens by day: slots summed in the zone's day, 7-day trend and average, top cards, missing logs", async () => {
  const { tokenInsights } = await import("./insights");
  const slot = (iso: string) => Math.floor(Date.parse(iso) / (15 * 60_000));
  const u = (input: number, output = 0) => ({ input, cacheRead: 0, cacheWrite: 0, output, reasoning: 0 });
  const series = [
    // 2026-10-15T17:00Z is 2026-10-16 01:00 in Singapore.
    { taskId: "a", buckets: new Map([[slot("2026-10-15T17:00:00Z"), u(100, 10)], [slot("2026-10-15T15:45:00Z"), u(7)]]) },
    { taskId: "b", buckets: new Map([[slot("2026-10-16T03:00:00Z"), u(500)], [slot("2026-10-14T03:00:00Z"), u(70)]]) },
    { taskId: "b", buckets: null },
  ];
  const r = tokenInsights({ series, now: Date.parse("2026-10-16T06:00:00Z"), tz: "Asia/Singapore" });
  expect(r.day).toBe("2026-10-16");
  expect(r.tokens).toEqual(u(600, 10));
  expect(r.tasks.map((t) => t.taskId)).toEqual(["b", "a"]);
  expect(r.trend.map((d) => d.total)).toEqual([0, 0, 0, 0, 70, 7, 610]);
  expect(r.average).toBe(11);
  expect({ sessions: r.sessions, missing: r.missing }).toEqual({ sessions: 3, missing: 1 });
});
