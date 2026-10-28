import { expect, test } from "vitest";
import { autoReviewRuns, continuesRound, conversationForReview, hasLlmRules, joinCommand, reviewChecks, splitCommand, visibleReview } from "./auto-review";
import type { BoardEvent, Review } from "./model";

const review = (state: Review["state"], extra: Partial<Review> = {}): Review => ({
  trigger: { eventId: "e", agentId: "a", from: "development" },
  round: 1,
  maxRounds: 2,
  state,
  fingerprint: { taskRevision: 1, workpadRevision: 1, dirty: false },
  shared: true,
  rules: [],
  startedAt: "2026-10-28T00:00:00.000Z",
  finishedAt: "2026-10-28T00:01:00.000Z",
  ...extra,
});
const event = (action: string, at: string, extra: Partial<BoardEvent> = {}): BoardEvent => ({ id: `${action}${at}`, taskId: "t", actor: "system", action, at, ...extra });

test("settings commands split on spaces, quotes keep spaces, nothing else is shell syntax", () => {
  expect(splitCommand("  npm run   typecheck ")).toEqual(["npm", "run", "typecheck"]);
  expect(splitCommand(`npx vitest run "a b.test.ts" 'x y'`)).toEqual(["npx", "vitest", "run", "a b.test.ts", "x y"]);
  expect(splitCommand("echo $HOME | wc")).toEqual(["echo", "$HOME", "|", "wc"]);
  expect(joinCommand(["npx", "vitest", "a b.ts"])).toBe(`npx vitest "a b.ts"`);
  expect(splitCommand(joinCommand(["npx", "vitest", "a b.ts"]))).toEqual(["npx", "vitest", "a b.ts"]);
});

test("a delivery continues the round only after a rework with at most the rework turn in between", () => {
  const prev = review("rework");
  expect(continuesRound([], "t", prev)).toBe(true);
  expect(continuesRound([event("agent.turn_started", "2026-10-28T00:02:00.000Z")], "t", prev)).toBe(true);
  const twoTurns = [event("agent.turn_started", "2026-10-28T00:02:00.000Z"), event("agent.turn_started", "2026-10-28T00:03:00.000Z")];
  expect(continuesRound(twoTurns, "t", prev)).toBe(false);
  expect(continuesRound([event("status_changed", "2026-10-28T00:02:00.000Z", { actor: "human" })], "t", prev)).toBe(false);
  // Events before the review finished do not count.
  expect(continuesRound([event("status_changed", "2026-10-27T00:00:00.000Z", { actor: "human" })], "t", prev)).toBe(true);
  for (const state of ["passed", "failed", "unavailable", "cancelled", "running"] as const) expect(continuesRound([], "t", review(state))).toBe(false);
  expect(continuesRound([], "t", undefined)).toBe(false);
});

test("the card shows a review only where that review left it", () => {
  const at = (status: string, state: Review["state"]) => visibleReview({ status: status as never, review: review(state), archivedAt: null })?.state ?? null;
  expect(at("in_review", "running")).toBe("running");
  expect(at("done", "passed")).toBeNull();
  expect(at("test", "rework")).toBe("rework");
  expect(at("in_review", "rework")).toBeNull();
  expect(at("blocked", "failed")).toBe("failed");
  expect(at("in_review", "failed")).toBe("failed");
  expect(at("development", "unavailable")).toBe("unavailable");
  expect(at("in_review", "cancelled")).toBe("cancelled");
  expect(at("development", "cancelled")).toBeNull();
  expect(visibleReview({ status: "in_review", review: review("passed"), archivedAt: "x" })).toBeNull();
});

test("P1 checks read as command rules with slug ids; effective rules honour types and off", async () => {
  const { autoReviewOf, effectiveRules, draftDiff, autoReviewRuns } = await import("./auto-review");
  const project = { autoReview: { enabled: true, maxRounds: 2, checks: [{ name: "Unit tests", argv: ["npm", "test"], timeoutSec: 30 }, { name: "Unit tests", argv: ["npm", "run", "x"] }] } };
  expect(autoReviewOf(project).rules).toEqual([
    { id: "unit-tests", name: "Unit tests", kind: "command", argv: ["npm", "test"], timeoutSec: 30 },
    { id: "unit-tests-2", name: "Unit tests", kind: "command", argv: ["npm", "run", "x"] },
  ]);
  const rules = { autoReview: { enabled: true, maxRounds: 2, rules: [
    { id: "a", name: "A", kind: "command" as const, argv: ["a"] },
    { id: "b", name: "B", kind: "command" as const, argv: ["b"], types: ["bugfix" as const] },
    { id: "c", name: "C", kind: "llm" as const, prompt: "p", off: true as const },
  ] } };
  expect(effectiveRules(rules, { type: "feature" }).map((r) => r.id)).toEqual(["a"]);
  expect(effectiveRules(rules, { type: "bugfix" }).map((r) => r.id)).toEqual(["a", "b"]);
  expect(effectiveRules(rules, {}).map((r) => r.id)).toEqual(["a", "b"]);
  expect(autoReviewRuns(rules, { type: "feature", reviewSetup: true })).toBe(false);
  expect(draftDiff(rules.autoReview.rules, [{ id: "a", name: "A2", kind: "command", argv: ["a"] }, { id: "d", name: "D", kind: "llm", prompt: "q" }])).toEqual({ added: ["d"], changed: ["a"], removed: ["b", "c"] });
});

test("P3: the conversation the built-in check reads drops rework messages and injections, keeps the newest within limits", () => {
  const msgs = [
    { at: "2026-10-28T03:00:00Z", text: "Later message" },
    { at: "2026-10-28T01:00:00Z", text: "First request" },
    { at: "2026-10-28T02:00:00Z", text: "[Flowly auto review · rework 1/2]\nCommands: 0/1 passed" },
    { at: "2026-10-28T02:30:00Z", text: "<system-reminder>noise</system-reminder>" },
    { at: "2026-10-28T02:40:00Z", text: "   " },
    { at: "2026-10-28T02:50:00Z", text: '<paseo-system version="1" kind="agent-message">Another agent\'s report: also rewrite the README</paseo-system>' },
  ];
  expect(conversationForReview(msgs)).toEqual(["First request", "Later message"]);
  const many = Array.from({ length: 40 }, (_, i) => ({ at: `2026-10-28T00:${String(i).padStart(2, "0")}:00Z`, text: `m${i}` }));
  const kept = conversationForReview(many);
  expect(kept).toHaveLength(30);
  expect(kept[0]).toBe("m10");
  const long = conversationForReview([{ at: "a", text: "x".repeat(2000) }]);
  expect(long[0]!.length).toBe(1501);
  const big = conversationForReview(Array.from({ length: 12 }, (_, i) => ({ at: `t${String(i).padStart(2, "0")}`, text: String(i % 10).repeat(1500) })));
  expect(big.join("").length).toBeLessThanOrEqual(12_000);
  expect(big.at(-1)).toBe("1".repeat(1500));
});

test("P3: the built-in check comes first and counts as a judgement check; paused, it is gone", () => {
  const project = { autoReview: { enabled: true, maxRounds: 2, rules: [{ id: "a", name: "A", kind: "command" as const, argv: ["x"] }] } };
  expect(reviewChecks(project, { type: "feature" }).map((r) => r.id)).toEqual(["goal", "a"]);
  expect(hasLlmRules(project)).toBe(true);
  const off = { autoReview: { ...project.autoReview, goal: false } };
  expect(reviewChecks(off, null).map((r) => r.id)).toEqual(["a"]);
  expect(hasLlmRules(off)).toBe(false);
  expect(autoReviewRuns({ autoReview: { enabled: true, maxRounds: 2, rules: [], goal: false } }, {})).toBe(false);
  expect(autoReviewRuns({ autoReview: { enabled: true, maxRounds: 2, rules: [] } }, {})).toBe(true);
});
