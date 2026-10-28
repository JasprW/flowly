import { rm } from "node:fs/promises";
import type { PaseoApi } from "@getpaseo/client";
import { afterAll, expect, test } from "vitest";
import { agentFixture } from "./agent-fixture";
import { ReviewHistory } from "./review-history";
import { applyReviewDraft } from "./auto-review";
import type { BackgroundWorkspaces } from "./background-workspace";
import type { FlowLog } from "./flow-log";
import { deliveryStats, reworkQuotes, validateAnalysis, type FlowLike } from "../shared/review-history";

const roots: string[] = [];
afterAll(() => Promise.all(roots.map((r) => rm(r, { recursive: true, force: true }))));

const NOW = Date.parse("2026-10-28T12:00:00Z");
const at = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const deliver = (taskId: string, h: number): FlowLike => ({ at: at(h), taskId, action: "status_changed", actor: "agent", from: "development", to: "in_review" });
const a1 = (taskId: string, h: number): FlowLike => ({ at: at(h), taskId, action: "status_changed", actor: "system", rule: "A1", from: "in_review", to: "development" });
const a1r = (taskId: string, h: number): FlowLike => ({ at: at(h), taskId, action: "status_changed", actor: "system", rule: "A1r", from: "development", to: "in_review" });
const ended = (taskId: string, h: number): FlowLike => ({ at: at(h), taskId, action: "agent.turn_ended", actor: "system" });

test("rework after delivery leaves out turns A1r restored; counts deliveries and cards in the window", () => {
  const entries = [
    deliver("t1", 50), a1("t1", 49), ended("t1", 48), // reworked
    deliver("t2", 40), a1("t2", 39), ended("t2", 38.9), a1r("t2", 38.9), // commit-and-push turn: restored, not rework
    deliver("t3", 30), deliver("t3", 20), a1("t3", 19), ended("t3", 18), // two deliveries, reworked
    deliver("old", 24 * 100), a1("old", 24 * 99), // outside 90 days
  ];
  const s = deliveryStats(entries, NOW - 90 * 86_400_000, NOW);
  expect(s.deliveries).toBe(4);
  expect(s.delivered).toEqual(["t3", "t2", "t1"]);
  expect([...s.reworked.keys()].sort()).toEqual(["t1", "t3"]);
  // No later turn on t1: the window is still open.
  expect(s.reworked.get("t1")![0]).toEqual({ taskId: "t1", at: at(49), until: "" });
});

const started = (taskId: string, h: number): FlowLike => ({ at: at(h), taskId, action: "agent.turn_started", actor: "system" });

test("the user's words of a rework turn: clues written just after the turn ended count, the next turn's do not (§6.2)", () => {
  const ms = (h: number, plus: number) => new Date(Date.parse(at(h)) + plus).toISOString();
  // The rework turn's own start is logged a moment before A1; the next turn starts later.
  const entries = [deliver("t", 10), started("t", 9.0001), a1("t", 9), ended("t", 8), started("t", 5), ended("t", 4)];
  const turns = deliveryStats(entries, NOW - 86_400_000, NOW).reworked.get("t")!;
  expect(turns).toEqual([{ taskId: "t", at: at(9), until: at(5) }]);
  const clues = [
    { taskId: "t", kind: "feedback", text: "Run the tests first", at: ms(8, 180) }, // memory writes it ~200 ms after turn_ended
    { taskId: "t", kind: "message", text: "Later turn", at: ms(5, 100) },
    { taskId: "t", kind: "answer", text: "An answer", at: ms(8, 100) },
    { taskId: "u", kind: "feedback", text: "Other card", at: ms(8, 100) },
  ];
  expect(reworkQuotes(clues, "t", turns)).toEqual(["Run the tests first"]);
  // Still the latest turn: open to now.
  const open = deliveryStats([deliver("t", 10), a1("t", 9), ended("t", 8)], NOW - 86_400_000, NOW).reworked.get("t")!;
  expect(reworkQuotes([{ taskId: "t", kind: "feedback", text: "Any time after", at: at(1) }], "t", open)).toEqual(["Any time after"]);
});

test("analysis validation: reasons cite reworked cards, entries on fewer than 2 cards drop, ids renumber, invalid rules drop whole", () => {
  const cards = ["aaaaaaaa-1", "bbbbbbbb-2", "cccccccc-3"];
  const out = validateAnalysis(
    {
      reasons: [
        { title: "Tests not run", cards: ["aaaaaaaa", "bbbbbbbb"], quote: "run the tests" },
        { title: "One card only", cards: ["aaaaaaaa"] },
        { title: "Not reworked", cards: ["aaaaaaaa", "cccccccc"] },
      ],
      checks: [
        { rule: { id: "tests", name: "Tests", kind: "command", argv: ["npm", "test"] }, cards: ["aaaaaaaa", "bbbbbbbb"], why: "Twice untested." },
        { rule: { id: "goal", name: "Goal", kind: "llm", prompt: "x" }, cards: ["aaaaaaaa", "cccccccc"], why: "Reserved id." },
        { rule: { id: "lonely", name: "L", kind: "llm", prompt: "x" }, cards: ["aaaaaaaa"], why: "One card." },
        { rule: { id: "bad", name: "B", kind: "command", argv: "npm test" }, cards: ["aaaaaaaa", "bbbbbbbb"], why: "Shell string." },
        { rule: { id: "unknown", name: "U", kind: "llm", prompt: "x" }, cards: ["aaaaaaaa", "zzzzzzzz"], why: "Unknown card." },
      ],
    },
    { cards, reworked: new Set(["aaaaaaaa-1", "bbbbbbbb-2"]), existing: [{ id: "tests", name: "Tests", kind: "command", argv: ["npm", "test"] }] },
  );
  expect(out.reasons.map((r) => r.title)).toEqual(["Tests not run"]);
  expect(out.checks.map((c) => c.rule.id)).toEqual(["tests-2", "goal-2"]);
  expect(out.checks[0]!.cards).toEqual(["aaaaaaaa-1", "bbbbbbbb-2"]);
});

async function setup(entries: FlowLike[], reply: string) {
  const x = await agentFixture();
  roots.push(x.root);
  const ids = ["t", "u1", "u2", "u3"];
  await x.store.mutate((b) => {
    const base = b.tasks[0]!;
    for (const id of ids.slice(1)) b.tasks.push({ ...base, id, title: `Card ${id}`, workspaceId: `w-${id}`, operationId: `op-${id}` });
  });
  const removed: string[] = [];
  const created: unknown[] = [];
  let modelCalls = 0;
  let backgroundUsed = 0;
  const background = {
    use: async (_p: unknown, _api: unknown, work: (id: string) => Promise<unknown>) => {
      backgroundUsed++;
      return work("bg");
    },
  } as unknown as BackgroundWorkspaces;
  const paseo = {
    workspaces: {
      ref: (id: string) => ({
        agents: {
          create: async (input: unknown) => {
            created.push({ workspace: id, input });
            return { id: "analysis", waitForFinish: async () => ({ status: "idle", lastMessage: reply }) };
          },
        },
      }),
    },
  } as unknown as PaseoApi;
  const history = new ReviewHistory(x.store, { read: async () => entries } as unknown as FlowLog, {
    background,
    removeAgent: async (agent) => {
      removed.push((agent as { id: string }).id);
    },
    model: async () => {
      modelCalls++;
      return "claude/x";
    },
    summaries: async () => [],
    // Written just after the rework turn ended (at(48)), as memory does.
    memory: async () => ({ clues: [{ taskId: "t", kind: "feedback", text: "Run the tests first", at: new Date(Date.parse(at(48)) + 150).toISOString() }] }),
    memoryOn: () => true,
    now: () => NOW,
  });
  return { x, history, paseo, removed, created, calls: () => modelCalls, backgroundUsed: () => backgroundUsed };
}

test("fewer than 5 deliveries in 90 days: insufficient, no model call; status says not eligible", async () => {
  const h = await setup([deliver("t", 10), deliver("u1", 9)], "{}");
  expect(await h.history.analyze("p", h.paseo)).toEqual({ status: "insufficient" });
  expect(h.calls()).toBe(0);
  expect(await h.history.status("p")).toEqual({ state: "idle", eligible: false });
});

test("the analysis writes an analysis draft with the daemon's numbers; the session is hard-deleted; Apply can leave a check out", async () => {
  const entries = [
    deliver("t", 50), a1("t", 49), ended("t", 48),
    deliver("u1", 40), a1("u1", 39), ended("u1", 38),
    deliver("u2", 30), a1("u2", 29), ended("u2", 28.9), a1r("u2", 28.9),
    deliver("u3", 20), deliver("u3", 10),
  ];
  const reply = JSON.stringify({
    reasons: [{ title: "Tests not run", cards: ["t", "u1"], quote: "Run the tests first" }],
    checks: [
      { rule: { id: "tests", name: "Tests", kind: "command", argv: ["npm", "test"] }, cards: ["t", "u1"], why: "Two cards came back untested." },
      { rule: { id: "copy", name: "Copy", kind: "llm", prompt: "New strings are in all catalogs." }, cards: ["t", "u1"], why: "Missing strings twice." },
      { rule: { id: "once", name: "Once", kind: "llm", prompt: "x" }, cards: ["u2"], why: "One card." },
    ],
  });
  const h = await setup(entries, reply);
  expect(await h.history.analyze("p", h.paseo)).toEqual({ status: "started" });
  for (let i = 0; i < 50 && (await h.history.status("p")).state === "running"; i++) await new Promise((r) => setTimeout(r, 10));
  const status = await h.history.status("p");
  expect(status).toEqual({ state: "idle", eligible: true });
  expect(h.removed).toEqual(["analysis"]);
  expect(h.backgroundUsed()).toBe(1);
  expect((h.created[0] as { workspace: string }).workspace).toBe("bg");
  const prompt = ((h.created[0] as { input: { prompt: string } }).input.prompt);
  expect(prompt).toContain("REWORKED after delivery");
  expect(prompt).toContain("「Run the tests first」");
  const project = (await h.x.store.read()).projects[0]!;
  const draft = project.reviewDraft!;
  expect(draft.by).toEqual({ analysis: true });
  // Delivered cards t, u1, u2, u3; reworked t and u1 (u2's turn was restored by A1r).
  expect(draft.summary).toMatchObject({ delivered: 4, reworked: 2 });
  expect(draft.added!.map((a) => a.id)).toEqual(["tests", "copy"]);
  expect(draft.rules.map((r) => r.id)).toEqual(["tests", "copy"]);
  expect(project.revision).toBe(1);
  const applied = await applyReviewDraft(h.x.store, { projectId: "p", at: draft.at, confirm: true, exclude: ["copy", "not-added"] });
  expect(applied).toMatchObject({ status: "applied", revision: 2 });
  expect((await h.x.store.read()).projects[0]!.autoReview).toMatchObject({ enabled: true, rules: [{ id: "tests" }] });
});

test("a failed analysis is reported in its status and can be started again", async () => {
  const entries = [deliver("t", 5), deliver("u1", 4), deliver("u2", 3), deliver("u3", 2), deliver("t", 1)];
  const h = await setup(entries, "no json here");
  await h.history.analyze("p", h.paseo);
  for (let i = 0; i < 50 && (await h.history.status("p")).state === "running"; i++) await new Promise((r) => setTimeout(r, 10));
  expect(await h.history.status("p")).toMatchObject({ state: "failed", error: "The analysis returned no JSON." });
  expect(h.removed).toEqual(["analysis"]);
  expect(await h.history.analyze("p", h.paseo)).toEqual({ status: "started" });
});

test("suggestions that do not fit the 10-per-kind limit are left out and counted; the analysis still succeeds", async () => {
  const entries = [deliver("t", 50), a1("t", 49), ended("t", 48), deliver("u1", 40), a1("u1", 39), ended("u1", 38), deliver("u2", 30), deliver("u3", 20), deliver("u3", 10)];
  const reply = JSON.stringify({
    reasons: [],
    checks: [
      { rule: { id: "lint", name: "Lint", kind: "command", argv: ["npm", "run", "lint"] }, cards: ["t", "u1"], why: "Lint failed twice." },
      { rule: { id: "copy", name: "Copy", kind: "llm", prompt: "Strings in all catalogs." }, cards: ["t", "u1"], why: "Missing strings twice." },
    ],
  });
  const h = await setup(entries, reply);
  await h.x.store.mutate((b) => {
    b.projects[0]!.autoReview = { enabled: false, maxRounds: 2, rules: Array.from({ length: 10 }, (_, i) => ({ id: `c${i}`, name: `C${i}`, kind: "command" as const, argv: ["echo", String(i)] })) };
  });
  await h.history.analyze("p", h.paseo);
  for (let i = 0; i < 50 && (await h.history.status("p")).state === "running"; i++) await new Promise((r) => setTimeout(r, 10));
  expect((await h.history.status("p")).state).toBe("idle");
  const draft = (await h.x.store.read()).projects[0]!.reviewDraft!;
  expect(draft.added!.map((a) => a.id)).toEqual(["copy"]);
  expect(draft.rules.filter((r) => r.kind === "command")).toHaveLength(10);
  expect(draft.summary!.dropped).toBe(1);
});
