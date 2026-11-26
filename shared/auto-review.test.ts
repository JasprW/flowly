import { expect, test } from "vitest";
import {
  autoReviewOf,
  autoReviewRuns,
  continuesRound,
  conversationForReview,
  countsTowardCap,
  diffPaths,
  unquoteGitPath,
  demotionFinding,
  hasEvidence,
  joinCommand,
  needsUserReason,
  nextFails,
  reviewContext,
  reviewProgress,
  reviewVerdict,
  reworkMessage,
  roundAwaitsTurnEnd,
  sameFinding,
  shouldDemote,
  splitCommand,
  stopReviewForPerson,
  visibleReview,
  markReviewHandled,
  rerunnablePlace,
  reviewSignal,
  conversationLine,
  userWords,
} from "./auto-review";
import { projectSchema, reviewSchema, type BoardEvent, type Review, type ReviewItem } from "./model";

const review = (state: Review["state"], extra: Partial<Review> = {}): Review => ({
  trigger: { eventId: "e", agentId: "a", from: "development" },
  round: 1,
  maxRounds: 2,
  state,
  fingerprint: { taskRevision: 1, workpadRevision: 1, dirty: false },
  shared: true,
  items: [],
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

test("a delivery continues the round unless a person moved the card or a turn a person started ended (§3.3)", () => {
  const prev = review("rework");
  const started = (at: string, agentId = "a") => event("agent.turn_started", at, { agentId });
  const ended = (at: string, byUser: boolean | undefined, agentId = "a") => event("agent.turn_ended", at, { agentId, ...(byUser === undefined ? {} : { byUser }) });
  expect(continuesRound([], "t", prev)).toBe(true);
  // The rework turn (the delivering session's first turn after the review) never counts, even though its message reads as the user's.
  expect(continuesRound([started("2026-10-28T00:02:00.000Z"), ended("2026-10-28T00:02:30.000Z", true)], "t", prev)).toBe(true);
  // A background wake-up after it does not reset; a person's message does, and so does a turn whose starter is unknown.
  const rework = [started("2026-10-28T00:02:00.000Z"), ended("2026-10-28T00:02:30.000Z", true)];
  expect(continuesRound([...rework, started("2026-10-28T00:03:00.000Z"), ended("2026-10-28T00:03:30.000Z", false)], "t", prev)).toBe(true);
  expect(continuesRound([...rework, started("2026-10-28T00:03:00.000Z"), ended("2026-10-28T00:03:30.000Z", true)], "t", prev)).toBe(false);
  expect(continuesRound([...rework, started("2026-10-28T00:03:00.000Z"), ended("2026-10-28T00:03:30.000Z", undefined)], "t", prev)).toBe(false);
  // A person's turn in another session of the card resets too, even before the rework turn.
  expect(continuesRound([started("2026-10-28T00:02:00.000Z", "b"), ended("2026-10-28T00:02:30.000Z", true, "b")], "t", prev)).toBe(false);
  // A turn that ended without starting after the review (the delivering turn of the previous review) does not count.
  expect(continuesRound([ended("2026-10-28T00:02:30.000Z", true)], "t", prev)).toBe(true);
  // A second turn still open: the round waits for its end to be recorded; the rework turn alone does not.
  const open = [...rework, started("2026-10-28T00:03:00.000Z")];
  expect(continuesRound(open, "t", prev)).toBe(true);
  expect(roundAwaitsTurnEnd(open, "t", prev)).toBe(true);
  expect(roundAwaitsTurnEnd([started("2026-10-28T00:02:00.000Z")], "t", prev)).toBe(false);
  expect(roundAwaitsTurnEnd(open, "t", review("passed"))).toBe(false);
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

const item = (id: string, kind: ReviewItem["kind"], state: ReviewItem["state"], extra: Partial<ReviewItem> = {}): ReviewItem => ({ id, kind, name: id, gating: true, state, ...extra });

test("a failed or unavailable review is handled by a turn or a person's status change, once; the signal ends, the card face stays (§3.5)", () => {
  const at = "2026-10-28T00:02:00.000Z";
  for (const state of ["failed", "unavailable"] as const) {
    const task = { status: "in_review" as const, archivedAt: null, review: review(state) };
    expect(markReviewHandled(task, { actor: "human", action: "edited" }, at)).toBe(false);
    expect(markReviewHandled(task, { actor: "agent", action: "status_changed" }, at)).toBe(false);
    expect(reviewSignal(task)).toMatchObject({ state });
    expect(markReviewHandled(task, { actor: "system", action: "agent.turn_started" }, at)).toBe(true);
    expect(markReviewHandled(task, { actor: "human", action: "status_changed" }, "2026-10-28T00:03:00.000Z")).toBe(false);
    expect(task.review.handledAt).toBe(at);
    expect(reviewSignal(task)).toBeNull();
    expect(visibleReview(task)).toMatchObject({ state });
  }
  const moved = { review: review("failed") };
  expect(markReviewHandled(moved, { actor: "human", action: "status_changed" }, at)).toBe(true);
  for (const r of [review("passed"), review("rework"), review("cancelled"), review("failed", { finishedAt: undefined }), undefined])
    expect(markReviewHandled({ review: r }, { actor: "system", action: "agent.turn_started" }, at)).toBe(false);
  // Older records have no handledAt: still a signal.
  expect(reviewSchema.parse(review("failed")).handledAt).toBeUndefined();
});

test("Rerun starts from In review, or from Blocked only after a failed review (§3.5)", () => {
  expect(rerunnablePlace({ status: "in_review", review: review("cancelled") })).toBe(true);
  expect(rerunnablePlace({ status: "blocked", review: review("failed") })).toBe(true);
  expect(rerunnablePlace({ status: "blocked", review: review("passed") })).toBe(false);
  expect(rerunnablePlace({ status: "development", review: review("unavailable") })).toBe(false);
  expect(rerunnablePlace({ status: "done", review: review("failed") })).toBe(false);
});

test("settings narrow to the switch and the rounds; stored rules, goal and guidance are kept on disk but ignored (GUARDRAILS-SPEC §8)", () => {
  const stored = { enabled: true, maxRounds: 3, rules: [{ id: "a", name: "A", kind: "command", argv: ["x"] }], goal: false, guidance: "g", checks: [] };
  expect(autoReviewOf({ autoReview: stored })).toEqual({ enabled: true, maxRounds: 3 });
  expect(autoReviewOf(null)).toEqual({ enabled: false, maxRounds: 2 });
  // Every delivery is reviewed while the switch is on: the built-in check always runs.
  expect(autoReviewRuns({ autoReview: { enabled: true, maxRounds: 2 } })).toBe(true);
  expect(autoReviewRuns({ autoReview: { enabled: false, maxRounds: 2 } })).toBe(false);
  // A project saved before guardrails still reads; a reviewDraft is dropped.
  const project = projectSchema.parse({ id: "p", title: "P", description: "", paseoProjectId: "n", primaryPath: "/p", repos: ["/p"], revision: 1, createdAt: "x", updatedAt: "x", archivedAt: null, autoReview: stored, reviewDraft: { rules: [] } });
  expect(project.autoReview?.enabled).toBe(true);
  expect(project).not.toHaveProperty("reviewDraft");
});

test("a review written before guardrails reads its rules as items", () => {
  const old = { ...review("rework"), items: undefined, rules: [
    { id: "unit", kind: "command", name: "Unit", state: "failed", argv: ["npm", "test"] },
    { id: "goal", kind: "llm", name: "Does what you asked", state: "passed" },
    { id: "i18n", kind: "llm", name: "i18n", state: "na" },
  ] };
  const read = reviewSchema.parse(old);
  expect(read.items.map((i) => [i.id, i.kind, i.gating])).toEqual([["unit", "command", true], ["goal", "goal", true], ["i18n", "guideline", true]]);
  expect(reviewSchema.parse({ ...review("passed"), items: undefined }).items).toEqual([]);
});

test("the verdict counts gating items only: observing commands never decide, disputed findings are not failures (§6.3)", () => {
  expect(reviewVerdict([item("c", "command", "failed", { gating: false }), item("goal", "goal", "passed")])).toBe("passed");
  expect(reviewVerdict([item("c", "command", "unavailable", { gating: false }), item("goal", "goal", "na")])).toBe("passed");
  expect(reviewVerdict([item("goal", "goal", "passed"), item("g", "guideline", "disputed")])).toBe("passed");
  expect(reviewVerdict([item("goal", "goal", "passed"), item("g", "guideline", "failed")])).toBe("failed");
  expect(reviewVerdict([item("c", "command", "unavailable"), item("goal", "goal", "skipped")])).toBe("unavailable");
  expect(reviewVerdict([item("c", "command", "failed"), item("x", "command", "unavailable")])).toBe("failed");
});

test("B1: a fail stands with a file in the diff, an existing repository file, or a quote found in what the reviewer was given", () => {
  const diff = new Set(["shared/a.ts"]);
  const existing = new Set(["shared/i18n/zh-TW.ts"]);
  const sources = ["Add a rerun button", "The card asked for a\n  Rerun   button on failed checks.", undefined, null];
  expect(hasEvidence({ file: "shared/a.ts" }, diff, existing, [])).toBe(true);
  expect(hasEvidence({ file: "shared/i18n/zh-TW.ts" }, diff, existing, [])).toBe(true);
  // Substring, case-insensitive, whitespace runs collapsed.
  expect(hasEvidence({ quote: "the card asked for a Rerun button" }, diff, existing, sources)).toBe(true);
  expect(hasEvidence({ quote: "  ADD a  rerun\tbutton " }, diff, existing, sources)).toBe(true);
  // An invented quote is no evidence; a valid file still is.
  expect(hasEvidence({ quote: "the user wanted a dark mode" }, diff, existing, sources)).toBe(false);
  expect(hasEvidence({ quote: "the user wanted a dark mode", file: "shared/a.ts" }, diff, existing, sources)).toBe(true);
  expect(hasEvidence({ quote: "the card asked for a Rerun button" }, diff, existing, [])).toBe(false);
  expect(hasEvidence({ file: "nowhere.ts" }, diff, existing, sources)).toBe(false);
  expect(hasEvidence({ quote: "  " }, diff, existing, sources)).toBe(false);
  expect(hasEvidence({}, diff, existing, sources)).toBe(false);
});

test("reviewProgress: passed (na included) and failed of the gating items; what runs now (§7.1.1)", () => {
  const running = (items: ReviewItem[]) => reviewProgress({ state: "running", items });
  expect(running([item("c", "command", "queued"), item("goal", "goal", "queued")])).toEqual({ passed: 0, failed: 0, total: 2, phase: "starting" });
  expect(running([item("c", "command", "running", { name: "npm test" }), item("o", "command", "queued", { gating: false }), item("goal", "goal", "queued")])).toEqual({
    passed: 0,
    failed: 0,
    total: 2,
    phase: "running",
    current: "npm test",
  });
  expect(running([item("c", "command", "passed"), item("o", "command", "failed", { gating: false }), item("goal", "goal", "running"), item("g", "guideline", "running"), item("d", "item", "disputed")])).toEqual({
    passed: 1,
    failed: 0,
    total: 3,
    phase: "judging",
    judging: 2,
  });
  expect(running([item("c", "command", "passed"), item("x", "command", "queued")]).phase).toBe("running");
  expect(reviewProgress({ state: "rework", items: [item("c", "command", "passed"), item("goal", "goal", "na"), item("g", "guideline", "failed")] })).toEqual({ passed: 2, failed: 1, total: 3, phase: "done" });
});

test("the rework message lists what failed in the user's words, with ids to dispute (§6.5)", () => {
  const r = review("rework", {
    items: [
      item("c1", "command", "passed", { argv: ["npm", "run", "typecheck"] }),
      item("c2", "command", "passed", { argv: ["npm", "test"] }),
      item("o", "command", "failed", { gating: false, argv: ["npm", "run", "test:e2e"] }),
      item("g1", "guideline", "failed", { name: "Every new UI string is in all catalogs", detail: 'zh-TW.ts has no entry for "Review passed"', file: "shared/i18n/zh-TW.ts", line: 412 }),
      item("goal", "goal", "failed", { name: "Does what you asked", detail: "the card asked for a Rerun button; none was added" }),
      item("g2", "guideline", "passed"),
    ],
  });
  const text = reworkMessage(r, new Map([["g1", "新文案也要进所有语言"]]));
  expect(text.split("\n")).toEqual([
    "[Flowly auto review · rework 1/2]",
    "Commands: 2/2 passed",
    '✗ [major] "新文案也要进所有语言" — zh-TW.ts has no entry for "Review passed" (shared/i18n/zh-TW.ts:412) [id: g1]',
    "✗ [major] Does what you asked — the card asked for a Rerun button; none was added [id: goal]",
    "Fix these, rerun the checks, update the acceptance list and deliver to In review again. If a finding is wrong, deliver with disputes=[{id, reason}].",
  ]);
  const skipped = reworkMessage(review("rework", { items: [item("c", "command", "failed", { argv: ["npm", "test"], exitCode: 1, tail: "1 failing" }), item("goal", "goal", "skipped")] }));
  expect(skipped).toContain("✗ c (npm test) exited 1. [id: c]");
  expect(skipped).toContain("    1 failing");
  expect(skipped).toContain("Review: skipped (a command failed)");
});

test("get_task's review lists items with kind, gating and the dispute reason; no fingerprint", () => {
  const ctx = reviewContext(review("passed", { items: [item("o", "command", "failed", { gating: false, argv: ["npm", "test"] }), item("g", "guideline", "disputed", { disputeReason: "not this card" })] }))!;
  expect(ctx.items).toEqual([
    { id: "o", kind: "command", name: "o", gating: false, state: "failed", command: "npm test" },
    { id: "g", kind: "guideline", name: "g", gating: true, state: "disputed", disputeReason: "not this card" },
  ]);
  expect(ctx).not.toHaveProperty("fingerprint");
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
  expect((long[0] as string).length).toBe(1501);
  const big = conversationForReview(Array.from({ length: 12 }, (_, i) => ({ at: `t${String(i).padStart(2, "0")}`, text: String(i % 10).repeat(1500) })));
  expect(big.join("").length).toBeLessThanOrEqual(12_000);
  expect(big.at(-1)).toBe("1".repeat(1500));
});

test("severity: only blocker and major fails decide; a minor one is shown, counted as passed on the strip and left out of rework (§3.6)", () => {
  const minor = item("g1", "guideline", "failed", { severity: "minor", detail: "wording" });
  expect(reviewVerdict([item("goal", "goal", "passed"), minor])).toBe("passed");
  expect(reviewVerdict([item("goal", "goal", "failed", { severity: "blocker" }), minor])).toBe("failed");
  // A missing severity is major, as before.
  expect(reviewVerdict([item("goal", "goal", "failed")])).toBe("failed");
  expect(reviewProgress(review("passed", { items: [item("goal", "goal", "passed"), minor] }))).toMatchObject({ passed: 2, failed: 0, total: 2 });
  const r = review("rework", { items: [item("goal", "goal", "failed", { severity: "blocker", detail: "core missing" }), minor] });
  const text = reworkMessage(r);
  expect(text).toContain("✗ [blocker] Does what you asked — core missing [id: goal]");
  expect(text).not.toContain("wording");
  expect(reviewContext(review("passed", { items: [minor] }))!.items[0]).toMatchObject({ severity: "minor", state: "failed" });
});

test("needs_user: decides only without a decisive fail and after unavailable; the rework message lists it apart (§3.6, §4.5)", () => {
  const ask = item("goal", "goal", "needs_user", { detail: "Install the build on the phone and confirm it." });
  expect(reviewVerdict([ask, item("g", "guideline", "passed")])).toBe("needs_user");
  expect(reviewVerdict([ask, item("g", "guideline", "failed", { severity: "major" })])).toBe("failed");
  expect(reviewVerdict([ask, item("g", "guideline", "unavailable")])).toBe("unavailable");
  expect(reviewVerdict([{ ...ask, severity: "minor" }, item("g", "guideline", "passed")])).toBe("passed");
  expect(reviewVerdict([{ ...ask, gating: false }])).toBe("passed");
  expect(needsUserReason([ask, item("i", "item", "needs_user", { name: "Ask the API team", detail: "Get a key" })])).toBe(
    "Does what you asked: Install the build on the phone and confirm it.; Ask the API team: Get a key",
  );
  expect(needsUserReason([item("i", "item", "needs_user", { detail: "x".repeat(600) })]).length).toBe(500);
  const text = reworkMessage(review("rework", { items: [item("g", "guideline", "failed", { detail: "bug" }), ask] }));
  expect(text.split("\n").slice(-3)).toEqual([
    "Needs the user (do not work around these; mention them in your delivery note):",
    "? Does what you asked — Install the build on the phone and confirm it. [id: goal]",
    "Fix these, rerun the checks, update the acceptance list and deliver to In review again. If a finding is wrong, deliver with disputes=[{id, reason}].",
  ]);
});

test("Review needs you shows in In review, calls Attention until a person acts, and counts toward the cap (§3.2, §3.5)", () => {
  const r = review("needs_user", { reason: "Does what you asked: test on the phone" });
  expect(visibleReview({ status: "in_review", review: r, archivedAt: null })?.state).toBe("needs_user");
  expect(visibleReview({ status: "development", review: r, archivedAt: null })).toBeNull();
  expect(reviewSignal({ status: "in_review", review: r, archivedAt: null })).toEqual({ state: "needs_user", key: `review:needs_user:${r.startedAt}` });
  const task = { review: { ...r } };
  // A turn starting is not a person acting: a background wake must not clear it (§3.2).
  expect(markReviewHandled(task, { actor: "system", action: "agent.turn_started" }, "2026-10-28T00:05:00.000Z")).toBe(false);
  expect(markReviewHandled(task, { actor: "system", action: "agent.turn_ended", byUser: false }, "2026-10-28T00:05:00.000Z")).toBe(false);
  expect(reviewSignal({ status: "in_review", review: task.review, archivedAt: null })?.state).toBe("needs_user");
  // The delivering turn (started before the review finished) ending later is not an answer to it.
  expect(markReviewHandled(task, { actor: "system", action: "agent.turn_ended", byUser: true }, "2026-10-28T00:05:00.000Z", "2026-10-28T00:00:30.000Z")).toBe(false);
  expect(markReviewHandled(task, { actor: "system", action: "agent.turn_ended", byUser: true }, "2026-10-28T00:05:00.000Z")).toBe(false);
  expect(markReviewHandled(task, { actor: "system", action: "agent.turn_ended", byUser: true }, "2026-10-28T00:05:00.000Z", "2026-10-28T00:04:00.000Z")).toBe(true);
  expect(reviewSignal({ status: "in_review", review: task.review, archivedAt: null })).toBeNull();
  const moved = { review: { ...r } };
  expect(markReviewHandled(moved, { actor: "human", action: "status_changed" }, "2026-10-28T00:05:00.000Z")).toBe(true);
  expect(["passed", "rework", "failed", "needs_user"].every((s) => countsTowardCap(s as Review["state"]))).toBe(true);
  expect(["cancelled", "unavailable", "running"].some((s) => countsTowardCap(s as Review["state"]))).toBe(false);
});

test("a person moving the card away or archiving it cancels the running review in that write; A1 does not; a person's move drops a held result (§3.2)", () => {
  const at = "2026-10-28T00:05:00.000Z";
  const running = () => ({ status: "development" as const, archivedAt: null as string | null, review: review("running", { finishedAt: undefined }) });
  const moved = running();
  expect(stopReviewForPerson(moved, { actor: "human", action: "status_changed", to: "development" }, at)).toBe(true);
  expect(moved.review).toMatchObject({ state: "cancelled", reason: "A person moved the card during the review.", finishedAt: at });
  const a1 = running();
  expect(stopReviewForPerson(a1, { actor: "system", action: "status_changed", to: "development" }, at)).toBe(false);
  expect(a1.review.state).toBe("running");
  const back = running();
  expect(stopReviewForPerson(back, { actor: "human", action: "status_changed", to: "in_review" }, at)).toBe(false);
  const archived = { ...running(), status: "in_review" as const, archivedAt: at };
  expect(stopReviewForPerson(archived, { actor: "human", action: "archive_changed" }, at)).toBe(true);
  const held = { status: "development" as const, archivedAt: null, review: review("cancelled", { held: true }) };
  expect(stopReviewForPerson(held, { actor: "human", action: "status_changed", to: "test" }, at)).toBe(false);
  expect(held.review.held).toBeUndefined();
  const archivedBack = { ...running(), status: "in_review" as const, archivedAt: at as string | null };
  expect(stopReviewForPerson(archivedBack, { actor: "human", action: "status_changed", to: "in_review" }, at)).toBe(true);
  const heldArchived = { status: "development" as const, archivedAt: at as string | null, review: review("cancelled", { held: true }) };
  expect(stopReviewForPerson(heldArchived, { actor: "human", action: "archive_changed" }, at)).toBe(false);
  expect(heldArchived.review.held).toBeUndefined();
});

test("card item demotion: three decisive fails in a row whose findings all differ (§3.6)", () => {
  expect(demotionFinding({ detail: "Missing  key", file: "a.ts", line: 3 })).toBe("a.ts:3 — Missing key");
  expect(demotionFinding({ detail: "x".repeat(300) })).toHaveLength(200);
  // Same place, or word sets with Jaccard ≥ 0.5 (English by word, CJK by character).
  expect(sameFinding("a.ts:3 — one thing", "a.ts:3 — another thing entirely")).toBe(true);
  expect(sameFinding("The zh-TW catalog has no entry for Rerun", "zh-TW catalog has no entry for the Rerun label")).toBe(true);
  expect(sameFinding("The zh-TW catalog has no entry", "The phone layout overflows on small screens")).toBe(false);
  expect(sameFinding("缺少繁体中文翻译", "繁体中文翻译缺少")).toBe(true);
  expect(sameFinding("缺少繁体中文翻译", "按钮在手机上溢出")).toBe(false);
  const a = "Catalog misses the Rerun label";
  const b = "Phone layout overflows the card";
  const c = "Spec section 3 was not updated";
  expect(shouldDemote([a, b], c)).toBe(true);
  expect(shouldDemote([a], c)).toBe(false);
  expect(shouldDemote([a, b], `${a} again`)).toBe(false);
  // Only the last two earlier fails count.
  expect(shouldDemote([a, a, b], c)).toBe(true);
  // Fail history: a decisive fail adds; pass, na and a minor fail clear; the rest leave it.
  const fail = item("i", "item", "failed", { detail: "d", file: "f.ts", line: 1 });
  expect(nextFails([a, b, c], fail)).toEqual([b, c, "f.ts:1 — d"]);
  expect(nextFails([a], item("i", "item", "passed"))).toEqual([]);
  expect(nextFails([a], item("i", "item", "na"))).toEqual([]);
  expect(nextFails([a], { ...fail, severity: "minor" })).toEqual([]);
  for (const state of ["needs_user", "disputed", "skipped", "unavailable"] as const) expect(nextFails([a], item("i", "item", state))).toBeUndefined();
});

test("the files a diff touches, from its headers (§3.6 regression backstop)", () => {
  const diff = "# Changes\ndiff --git a/src/a.ts b/src/a.ts\n+x\ndiff --git a/old.ts b/new.ts\n# New files\ndiff --git a/repo/x.md b/repo/x.md\n";
  expect([...diffPaths(diff)]).toEqual(["src/a.ts", "new.ts", "repo/x.md"]);
  // Git quotes a name with non-ASCII bytes, a tab or a quote, on either side.
  const quoted = 'diff --git "a/\\350\\257\\264\\346\\230\\216.ts" "b/\\350\\257\\264\\346\\230\\216.ts"\ndiff --git a/old.ts "b/a\\tb.ts"\ndiff --git "a/q\\"x.ts" b/plain.ts\n';
  expect([...diffPaths(quoted)]).toEqual(["说明.ts", "a\tb.ts", "plain.ts"]);
  expect(unquoteGitPath('"q\\"x\\\\y"')).toBe('q"x\\y');
  expect(unquoteGitPath("plain.ts")).toBe("plain.ts");
  // Raw UTF-8 (core.quotePath=false) outside the BMP, next to an escape.
  expect(unquoteGitPath('"🚀\\tx.ts"')).toBe("🚀\tx.ts");
});

test("E2: a question-tool answer keeps the question apart; only the whole answer is the user's words, even with an arrow in it", () => {
  const said = conversationForReview([
    { at: "b", text: ' Rename "Retry" → "Rerun" in the drawer ', ask: "What should\n the button say?" },
    { at: "a", text: "[Flowly auto review · rework 1/2]" , ask: "Odd answer?" },
  ]);
  expect(said).toEqual([
    { ask: "Odd answer?", answer: "[Flowly auto review · rework 1/2]" },
    { ask: "What should the button say?", answer: 'Rename "Retry" → "Rerun" in the drawer' },
  ]);
  expect(userWords(said[1]!)).toBe('Rename "Retry" → "Rerun" in the drawer');
  expect(userWords("Plain message")).toBe("Plain message");
  expect(conversationLine(said[1]!)).toBe('Answered the agent\'s question: "What should the button say?" → Rename "Retry" → "Rerun" in the drawer');
});
