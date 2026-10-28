import { afterEach, expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { agentFixture } from "./agent-fixture";
import { AutoReviewService, applyReviewDraft, discardReviewDraft, type LlmReview, type LlmReviewInput, type RunCheck } from "./auto-review";
import type { AgentService } from "./agent-service";
import type { AutoReview, Lane } from "../shared/model";
import { projectLanes } from "../shared/lanes";
import { attentionItems } from "../shared/attention";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});

type Ctx = Awaited<ReturnType<AgentService["get"]>>;
const input = (ctx: Ctx, note = "checkpoint") => ({ expectedRevision: ctx.revision, request: ctx.request, note });

/** A card with auto review on; `exits` maps a check's command line to its exit code (missing: 0). */
async function setup(
  options: { review?: Partial<AutoReview>; lanes?: Lane[]; exits?: Record<string, number | "spawn" | "timeout">; llm?: LlmReview; conversation?: () => Promise<string[] | null> } = {},
) {
  const x = await agentFixture();
  roots.push(x.root);
  // The P1/P2 cases run without the built-in check; the P3 ones turn it on.
  const review: AutoReview = { enabled: true, checks: [{ name: "Tests", argv: ["npm", "test"] }], maxRounds: 2, goal: false, ...options.review };
  await x.store.mutate((b) => {
    b.projects[0]!.autoReview = review;
    if (options.lanes) b.projects[0]!.lanes = options.lanes;
  });
  const exits = { ...options.exits };
  const runs: string[] = [];
  let during: () => Promise<void> = async () => undefined;
  const run: RunCheck = async (argv) => {
    const key = argv.join(" ");
    runs.push(key);
    await during();
    const exit = exits[key] ?? 0;
    if (exit === "spawn") return { exitCode: null, timedOut: false, spawnError: "spawn npm ENOENT", ms: 1, output: "" };
    if (exit === "timeout") return { exitCode: null, timedOut: true, ms: 1, output: "slow" };
    return { exitCode: exit, timedOut: false, ms: 5, output: exit ? `\u001b[31mFAIL\u001b[0m expected 1 to be 2\n` : "ok\n" };
  };
  const sent: { agentId: string; text: string }[] = [];
  const reviews = new AutoReviewService(x.store, {
    workspace: async () => ({ directory: x.a, worktree: false }),
    sessionBusy: async (agentId) => x.actors[agentId]?.status === "running",
    sessionLive: async (agentId) => !!x.actors[agentId] && !x.actors[agentId]!.archivedAt,
    send: async (message) => {
      sent.push({ agentId: message.agentId, text: message.text });
    },
    run,
    ...(options.llm ? { llm: options.llm } : {}),
    ...(options.conversation ? { conversation: options.conversation } : {}),
    diff: async () => "diff --git a/x b/x",
  });
  let delivering: Promise<void> = Promise.resolve();
  x.service.onDelivered = (delivery, paseo) => {
    delivering = reviews.delivered(delivery, paseo);
  };
  /** Moves the card to `stage` and then delivers it, as the agent; waits for the review. */
  const deliver = async (stage?: "design" | "development" | "test") => {
    let ctx = await x.service.get(x.identity);
    if (stage && ctx.task.status !== stage) {
      await x.service.write(x.identity, "status", { ...input(ctx), status: stage });
      ctx = await x.service.get(x.identity);
    }
    await x.service.write(x.identity, "status", { ...input(ctx, "Delivered"), status: "in_review", nextMoves: [] });
    await delivering;
    await reviews.idle();
    return x.store.read();
  };
  const turnStarted = () =>
    x.store.mutate((b) => {
      x.store.event(b, { taskId: "t", actor: "system", action: "agent.turn_started", agentId: "actor" });
    });
  return { ...x, reviews, sent, runs, exits, deliver, turnStarted, setDuring: (fn: () => Promise<void>) => (during = fn) };
}

const card = async (x: { store: { read(): Promise<import("../shared/model").Board> } }) => (await x.store.read()).tasks[0]!;

test("L1: with auto review on, failed or out-of-date checks refuse the delivery even with acknowledgeOpen", async () => {
  const x = await setup();
  let ctx = await x.service.get(x.identity);
  await x.service.write(x.identity, "status", { ...input(ctx), status: "development" });
  ctx = await x.service.get(x.identity);
  await x.service.write(x.identity, "workpad", {
    expectedRevision: ctx.revision,
    request: ctx.request,
    workpadRevision: ctx.workpad!.revision,
    acceptance: [{ text: "Works", done: true }],
    validation: [{ text: "Unit tests", command: "npm test", state: "fail" }],
    confusions: [],
  });
  ctx = await x.service.get(x.identity);
  for (const acknowledgeOpen of [false, true]) {
    const refused = await x.service.write(x.identity, "status", { ...input(ctx, "Delivered"), status: "in_review", acknowledgeOpen }).catch((e) => e);
    expect(refused).toMatchObject({ code: "WORKPAD_FAILING" });
    expect(String(refused.message)).toContain("check failed: Unit tests");
    expect(String(refused.message)).toContain("acknowledgeOpen does not apply");
  }
  expect((await card(x)).status).toBe("development");
  expect(x.runs).toEqual([]);
  // Off: the soft gate as before.
  await x.store.mutate((b) => {
    b.projects[0]!.autoReview = { ...b.projects[0]!.autoReview!, enabled: false };
  });
  const project = (await x.store.read()).projects[0]!;
  ctx = await x.service.get(x.identity);
  expect(ctx.project.revision).toBe(project.revision);
  const soft = await x.service.write(x.identity, "status", { ...input(ctx, "Delivered"), status: "in_review" }).catch((e) => e);
  expect(soft).toMatchObject({ code: "WORKPAD_OPEN" });
});

test("a passing review leaves the card in In review; a person's move into In review starts none", async () => {
  const x = await setup();
  const board = await x.deliver("development");
  const task = board.tasks[0]!;
  expect(task.status).toBe("in_review");
  expect(task.review).toMatchObject({ state: "passed", round: 1, maxRounds: 2, shared: true, trigger: { agentId: "actor", from: "development" } });
  // P1 `checks` read as a command rule (§12.1 migration).
  expect(task.review!.rules).toEqual([{ id: "tests", kind: "command", name: "Tests", state: "passed", argv: ["npm", "test"], exitCode: 0, ms: 5 }]);
  expect(board.events.map((e) => e.action)).toContain("review_finished");
  expect(x.sent).toEqual([]);
  // The review never changed the task revision: only the delivery did.
  const ctx = await x.service.get(x.identity);
  expect(ctx.review).toMatchObject({ state: "passed", round: 1, rules: [{ id: "tests", name: "Tests", command: "npm test", state: "passed" }] });
  expect(ctx.reviewRules).toMatchObject({ rules: [{ id: "tests", kind: "command", argv: ["npm", "test"] }], maxRounds: 2 });
  expect("review" in ctx.task).toBe(false);
  // A person moving it out and back starts nothing.
  await x.store.mutate((b) => {
    b.tasks[0]!.status = "development";
  });
  await x.store.mutate((b) => {
    b.tasks[0]!.status = "in_review";
  });
  await x.reviews.idle();
  expect(x.runs).toEqual(["npm test"]);
});

test("R1: a failure sends the card back to the stage it was delivered from, then the marked rework message", async () => {
  for (const stage of ["test", "design"] as const) {
    const x = await setup({ exits: { "npm test": 1 } });
    const board = await x.deliver(stage);
    const task = board.tasks[0]!;
    expect(task.status).toBe(stage);
    expect(task.review).toMatchObject({ state: "rework", round: 1 });
    expect(task.review!.rules[0]).toMatchObject({ state: "failed", exitCode: 1, tail: "FAIL expected 1 to be 2" });
    const moved = board.events.filter((e) => e.action === "status_changed").at(-1)!;
    expect(moved).toMatchObject({ actor: "system", rule: "R1", from: "in_review", to: stage, agentId: "actor" });
    expect(x.sent).toHaveLength(1);
    expect(x.sent[0]!.agentId).toBe("actor");
    expect(x.sent[0]!.text.startsWith("[Flowly auto review · rework 1/2]\n")).toBe(true);
    expect(x.sent[0]!.text).toContain("Commands: 0/1 passed\n✗ Tests (npm test) exited 1.");
    const ctx = await x.service.get(x.identity);
    expect(ctx.review).toMatchObject({ state: "rework", rules: [{ state: "failed", exitCode: 1 }] });
  }
});

test("R1 falls back to the latest work stage when the card was delivered from elsewhere or that lane is off", async () => {
  const lanes = projectLanes(null).map((l) => (l.status === "test" ? { ...l, enabled: false } : l));
  const x = await setup({ exits: { "npm test": 1 }, lanes });
  // Delivered straight from Todo: the latest work stage is unknown, so the first enabled one.
  const board = await x.deliver();
  expect(board.tasks[0]!.status).toBe("design");
});

test("R2: past maxRounds the card goes to Blocked without another message; maxRounds 0 goes there at once", async () => {
  const x = await setup({ exits: { "npm test": 1 }, review: { maxRounds: 1 } });
  let board = await x.deliver("development");
  expect(board.tasks[0]).toMatchObject({ status: "development", review: { state: "rework", round: 1 } });
  // The rework turn starts and the agent delivers again: the same round continues.
  await x.turnStarted();
  board = await x.deliver();
  expect(board.tasks[0]).toMatchObject({ status: "blocked", review: { state: "failed", round: 2 } });
  expect(board.events.filter((e) => e.action === "status_changed").at(-1)).toMatchObject({ rule: "R2", to: "blocked", note: "Auto review failed after 1 rework round" });
  expect(x.sent).toHaveLength(1);

  const zero = await setup({ exits: { "npm test": 1 }, review: { maxRounds: 0 } });
  board = await zero.deliver("development");
  expect(board.tasks[0]).toMatchObject({ status: "blocked", review: { state: "failed", round: 1 } });
  expect(zero.sent).toEqual([]);

  const noBlocked = await setup({ exits: { "npm test": 1 }, review: { maxRounds: 0 }, lanes: projectLanes(null).map((l) => (l.status === "blocked" ? { ...l, enabled: false } : l)) });
  board = await noBlocked.deliver("development");
  expect(board.tasks[0]).toMatchObject({ status: "in_review", review: { state: "failed" } });
});

test("a person's message or move between deliveries starts the count again", async () => {
  const x = await setup({ exits: { "npm test": 1 }, review: { maxRounds: 1 } });
  await x.deliver("development");
  // The rework turn and a second turn the user started.
  await x.turnStarted();
  await x.turnStarted();
  const board = await x.deliver();
  expect(board.tasks[0]).toMatchObject({ status: "development", review: { state: "rework", round: 1 } });
  expect(x.sent).toHaveLength(2);
});

test("unavailable: a check that cannot start or times out, or a gone session, leaves the round count alone", async () => {
  for (const exit of ["spawn", "timeout"] as const) {
    const x = await setup({ exits: { "npm test": exit } });
    const board = await x.deliver("development");
    expect(board.tasks[0]).toMatchObject({ status: "in_review", review: { state: "unavailable", round: 1 } });
    expect(board.tasks[0]!.review!.reason).toMatch(exit === "spawn" ? /Tests: Could not start: spawn npm ENOENT/ : /Tests: Timed out after 600 s/);
    expect(x.sent).toEqual([]);
  }
  const x = await setup({ exits: { "npm test": 1 } });
  x.setDuring(async () => {
    x.actors.actor!.archivedAt = new Date().toISOString();
  });
  const board = await x.deliver("development");
  // R1 already moved it; it stays there.
  expect(board.tasks[0]).toMatchObject({ status: "development", review: { state: "unavailable", round: 1 } });
  expect(board.tasks[0]!.review!.finishedAt).toBeTruthy();
  expect(x.sent).toEqual([]);
});

test("cancelled: a card that changed during the review drops the result", async () => {
  const x = await setup({ exits: { "npm test": 1 } });
  x.setDuring(async () => {
    await x.store.mutate((b) => {
      b.workpads[0]!.revision++;
    });
  });
  const board = await x.deliver("development");
  expect(board.tasks[0]).toMatchObject({ status: "in_review", review: { state: "cancelled" } });
  expect(board.events.filter((e) => e.rule === "R1")).toEqual([]);
  expect(x.sent).toEqual([]);
});

test("Rerun: only in In review, from round 1, with the latest delivering session", async () => {
  const x = await setup({ exits: { "npm test": 1 }, review: { maxRounds: 0 } });
  await x.deliver("development");
  expect((await card(x)).status).toBe("blocked");
  await expect(x.reviews.rerun("t", x.paseo)).rejects.toThrow("Only a card in In review");
  await x.store.mutate((b) => {
    b.tasks[0]!.status = "in_review";
  });
  x.exits["npm test"] = 0;
  await x.reviews.rerun("t", x.paseo);
  await x.reviews.idle();
  expect(await card(x)).toMatchObject({ status: "in_review", review: { state: "passed", round: 1, trigger: { agentId: "actor", eventId: "" } } });
});

test("attention: a running review holds back unread sessions; a pass only releases them; failed and unavailable are signals", async () => {
  const x = await setup();
  await x.deliver("development");
  const board = await x.store.read();
  const agents = [{ id: "actor", workspaceId: "w", status: "idle", archivedAt: null, requiresAttention: true, attentionReason: "finished", updatedAt: "2026-10-28T00:00:00.000Z" }];
  const task = board.tasks[0]!;
  const passed = attentionItems(board, agents as never, [], false);
  expect(passed[0]).toMatchObject({ review: null, unread: 1 });
  expect(passed[0]!.signals.some((k) => k.startsWith("review:"))).toBe(false);
  // Read: nothing keeps a passed card in Attention.
  expect(attentionItems(board, [{ ...agents[0], requiresAttention: false, attentionReason: null }] as never, [], false)).toEqual([]);
  task.review = { ...task.review!, state: "running" };
  const running = attentionItems(board, agents as never, [], false);
  expect(running.find((i) => i.task.id === "t")?.unread ?? 0).toBe(0);
  for (const state of ["failed", "unavailable"] as const) {
    task.review = { ...task.review!, state };
    const item = attentionItems(board, [] as never, [], false)[0]!;
    expect(item).toMatchObject({ review: state });
    expect(item.signals).toEqual([`review:${state}:${task.review.startedAt}`]);
    expect(item.updatedAt).toBe(task.review.finishedAt);
  }
});

test("the review starts when the delivering session's turn ends, not while it is still running", async () => {
  const x = await setup();
  x.actors.actor!.status = "running";
  let board = await x.deliver("development");
  expect(x.runs).toEqual([]);
  expect(board.tasks[0]!.review).toBeUndefined();
  // Another session's turn ending does not start it.
  await x.reviews.turnEnded("second", x.paseo);
  expect(x.runs).toEqual([]);
  x.actors.actor!.status = "idle";
  await x.reviews.turnEnded("actor", x.paseo);
  await x.reviews.idle();
  board = await x.store.read();
  expect(board.tasks[0]!.review).toMatchObject({ state: "passed" });
  expect(x.runs).toEqual(["npm test"]);
  // Once only.
  await x.reviews.turnEnded("actor", x.paseo);
  await x.reviews.idle();
  expect(x.runs).toEqual(["npm test"]);
});

test("runCheck runs an argument array without a shell: exit code, output tail, timeout and a missing command", async () => {
  const { runCheck } = await import("./auto-review");
  const failed = await runCheck([process.execPath, "-e", "console.log('a b'); console.error('$HOME'); process.exit(3)"], process.cwd(), 10_000);
  expect(failed).toMatchObject({ exitCode: 3, timedOut: false });
  expect(failed.output).toContain("a b");
  expect(failed.output).toContain("$HOME");
  const slow = await runCheck([process.execPath, "-e", "setTimeout(() => {}, 60_000)"], process.cwd(), 300);
  expect(slow.timedOut).toBe(true);
  const missing = await runCheck(["flowly-no-such-command-xyz"], process.cwd(), 5_000);
  expect(missing.spawnError).toMatch(/ENOENT/);
});

test("recover: a review left running by a restart becomes unavailable", async () => {
  const x = await setup();
  await x.deliver("development");
  await x.store.mutate((b) => {
    b.tasks[0]!.review = { ...b.tasks[0]!.review!, state: "running" };
  });
  expect(await x.reviews.recover()).toBe(true);
  expect(await card(x)).toMatchObject({ review: { state: "unavailable", reason: "Flowly restarted during the review." } });
  expect(await x.reviews.recover()).toBe(false);
});

const cmd = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: id.toUpperCase(), kind: "command" as const, argv: ["echo", id], ...extra });
const llmRule = (id: string) => ({ id, name: id.toUpperCase(), kind: "llm" as const, prompt: `Rule ${id}` });

test("P2: only rules in effect run: type filter, paused rules, a card without a type runs every unpaused rule", async () => {
  const x = await setup({ review: { checks: undefined, rules: [cmd("all"), cmd("bug", { types: ["bugfix"] }), cmd("off", { off: true })] } });
  // The fixture card is a feature.
  let board = await x.deliver("development");
  expect(x.runs).toEqual(["echo all"]);
  expect(board.tasks[0]!.review!.rules.map((r) => r.id)).toEqual(["all"]);
  await x.store.mutate((b) => {
    delete b.tasks[0]!.type;
  });
  await x.reviews.rerun("t", x.paseo);
  await x.reviews.idle();
  expect(x.runs).toEqual(["echo all", "echo all", "echo bug"]);
  board = await x.store.read();
  expect(board.tasks[0]!.review).toMatchObject({ state: "passed", round: 1 });
});

test("P2: every command rule runs; with one failed the LLM rules are skipped and the card goes back to rework", async () => {
  let called = false;
  const x = await setup({
    review: { checks: undefined, rules: [cmd("a"), cmd("b"), cmd("c"), llmRule("l1")] },
    exits: { "echo b": 1 },
    llm: async () => {
      called = true;
      return { model: "m", verdicts: [] };
    },
  });
  const board = await x.deliver("test");
  const review = board.tasks[0]!.review!;
  expect(x.runs).toEqual(["echo a", "echo b", "echo c"]);
  expect(review.rules.map((r) => [r.id, r.state])).toEqual([["a", "passed"], ["b", "failed"], ["c", "passed"], ["l1", "skipped"]]);
  expect(review.rules[3]!.reason).toBe("Command rules failed.");
  expect(called).toBe(false);
  expect(board.tasks[0]).toMatchObject({ status: "test", review: { state: "rework" } });
  expect(x.sent[0]!.text).toContain("Commands: 2/3 passed\n✗ B (echo b) exited 1.");
  expect(x.sent[0]!.text).toContain("LLM review: skipped (command rules failed)");
});

test("P2: LLM rules are judged in one review session; fail plus not applicable fails the review with the reason and place", async () => {
  let seen: LlmReviewInput | undefined;
  const x = await setup({
    review: { checks: undefined, rules: [cmd("a"), llmRule("l1"), llmRule("l2")], guidance: "Node, no deps." },
    llm: async (input) => {
      seen = input;
      return { model: "claude/haiku", verdicts: [{ id: "l1", verdict: "fail", detail: "No regression test.", file: "src/a.ts", line: 3 }, { id: "l2", verdict: "na", detail: "No UI text changed." }] };
    },
  });
  const board = await x.deliver("development");
  const review = board.tasks[0]!.review!;
  expect(seen).toMatchObject({ rules: [{ id: "l1", prompt: "Rule l1" }, { id: "l2" }], guidance: "Node, no deps.", deliveryNote: "Delivered", diff: "diff --git a/x b/x", commands: ["A: passed"] });
  expect(review.rules.map((r) => [r.id, r.state])).toEqual([["a", "passed"], ["l1", "failed"], ["l2", "na"]]);
  expect(review.rules[1]).toMatchObject({ detail: "No regression test.", file: "src/a.ts", line: 3 });
  expect(review).toMatchObject({ state: "rework", model: "claude/haiku" });
  expect(x.sent[0]!.text).toContain("LLM review: 1/2 passed\n✗ L1: No regression test. (src/a.ts:3)");
});

test("P2: a rule the review session left out is unavailable; with the rest passing the review is Unavailable, no rework", async () => {
  const x = await setup({
    review: { checks: undefined, rules: [llmRule("l1"), llmRule("l2")] },
    llm: async () => ({ model: "m", verdicts: [{ id: "l1", verdict: "pass", detail: "Fine." }] }),
  });
  const board = await x.deliver("development");
  expect(board.tasks[0]).toMatchObject({ status: "in_review", review: { state: "unavailable", round: 1 } });
  expect(board.tasks[0]!.review!.rules.map((r) => r.state)).toEqual(["passed", "unavailable"]);
  expect(x.sent).toEqual([]);
  // A failing review session makes every LLM rule unavailable.
  const y = await setup({ review: { checks: undefined, rules: [llmRule("l1")] }, llm: async () => { throw new Error("model down"); } });
  const after = await y.deliver("development");
  expect(after.tasks[0]!.review!.rules[0]).toMatchObject({ state: "unavailable", reason: "LLM review failed: model down" });
});

test("P2: the setup card's deliveries are not reviewed", async () => {
  const x = await setup();
  await x.store.mutate((b) => {
    b.tasks[0]!.reviewSetup = true;
  });
  const board = await x.deliver("design");
  expect(board.tasks[0]!.status).toBe("in_review");
  expect(board.tasks[0]!.review).toBeUndefined();
  expect(x.runs).toEqual([]);
});

test("P2: flowly_propose_review_rules validates, writes a draft without a project revision, replaces it; Apply and Discard", async () => {
  const x = await setup({ review: { enabled: false } });
  const write = async (rules: unknown[], note = "Why") => {
    const ctx = await x.service.get(x.identity);
    return x.service.write(x.identity, "review_rules", { expectedRevision: ctx.revision, request: ctx.request, rules, note });
  };
  const before = (await x.store.read()).projects[0]!.revision;
  const bad = await write([
    cmd("a"),
    cmd("a"),
    { ...llmRule("long"), prompt: "x".repeat(2001) },
    cmd("typed", { types: ["epic"] }),
    ...Array.from({ length: 10 }, (_, i) => cmd(`c${i}`)),
  ]).catch((e) => e);
  expect(bad).toMatchObject({ code: "REVIEW_RULES_INVALID" });
  expect(String(bad.message)).toContain('Duplicate rule id "a"');
  expect(String(bad.message)).toContain("At most 10 command rules.");
  expect(String(bad.message)).toMatch(/rules\[2\]\.prompt/);
  expect(String(bad.message)).toMatch(/rules\[3\]\.types/);
  expect((await x.store.read()).projects[0]!.reviewDraft).toBeUndefined();

  const first = await write([cmd("lint")], "First");
  expect(first.reviewDraft).toEqual({ added: ["lint"], changed: [], removed: ["tests"] });
  const second = await write([cmd("tests", { argv: ["npm", "run", "test"] }), llmRule("acceptance")], "Second");
  expect(second.reviewDraft).toEqual({ added: ["acceptance"], changed: ["tests"], removed: [] });
  let project = (await x.store.read()).projects[0]!;
  expect(project.revision).toBe(before);
  expect(project.reviewDraft).toMatchObject({ note: "Second", by: { taskId: "t", agentId: "actor" } });
  const ctx = await x.service.get(x.identity);
  expect(ctx.reviewRules?.draft).toMatchObject({ taskId: "t", note: "Second", rules: [{ id: "tests" }, { id: "acceptance" }] });

  // The rules changed after the draft: Apply asks first.
  await x.store.mutate((b) => {
    b.projects[0]!.autoReview = { enabled: false, maxRounds: 3, rules: [cmd("other")] };
  });
  const at = (await x.store.read()).projects[0]!.reviewDraft!.at;
  expect(await applyReviewDraft(x.store, { projectId: "p", at, confirm: false })).toEqual({ status: "confirm" });
  const applied = await applyReviewDraft(x.store, { projectId: "p", at, confirm: true });
  project = (await x.store.read()).projects[0]!;
  expect(applied).toEqual({ status: "applied", revision: project.revision });
  expect(project.revision).toBe(before + 1);
  expect(project.reviewDraft).toBeUndefined();
  expect(project.autoReview).toMatchObject({ enabled: true, maxRounds: 3, rules: [{ id: "tests", argv: ["npm", "run", "test"] }, { id: "acceptance" }] });

  await write([cmd("x")]);
  const xAt = (await x.store.read()).projects[0]!.reviewDraft!.at;
  expect(await discardReviewDraft(x.store, { projectId: "p", at: xAt })).toEqual({ status: "discarded" });
  project = (await x.store.read()).projects[0]!;
  expect(project.reviewDraft).toBeUndefined();
  expect(project.autoReview!.rules!.map((r) => r.id)).toEqual(["tests", "acceptance"]);
});

test("P2: Apply and Discard refuse a draft the person did not see (replaced or gone)", async () => {
  const x = await setup({ review: { enabled: false } });
  const write = async (rules: unknown[], note: string) => {
    const ctx = await x.service.get(x.identity);
    return x.service.write(x.identity, "review_rules", { expectedRevision: ctx.revision, request: ctx.request, rules, note });
  };
  await write([cmd("a")], "A");
  const seenA = (await x.store.read()).projects[0]!.reviewDraft!.at;
  await write([cmd("b")], "B");
  const before = (await x.store.read()).projects[0]!;
  expect(before.reviewDraft!.at).not.toBe(seenA);
  // Apply while looking at A: B is not applied, nothing changes.
  expect(await applyReviewDraft(x.store, { projectId: "p", at: seenA, confirm: true })).toEqual({ status: "stale" });
  let project = (await x.store.read()).projects[0]!;
  expect(project.revision).toBe(before.revision);
  expect(project.reviewDraft).toMatchObject({ note: "B" });
  expect(project.autoReview).toMatchObject({ enabled: false });
  // Discard while looking at A: B stays.
  expect(await discardReviewDraft(x.store, { projectId: "p", at: seenA })).toEqual({ status: "stale" });
  expect((await x.store.read()).projects[0]!.reviewDraft).toMatchObject({ note: "B" });
  // Once gone, both are stale.
  const seenB = (await x.store.read()).projects[0]!.reviewDraft!.at;
  expect(await discardReviewDraft(x.store, { projectId: "p", at: seenB })).toEqual({ status: "discarded" });
  expect(await applyReviewDraft(x.store, { projectId: "p", at: seenB, confirm: true })).toEqual({ status: "stale" });
  expect(await discardReviewDraft(x.store, { projectId: "p", at: seenB })).toEqual({ status: "stale" });
  project = (await x.store.read()).projects[0]!;
  expect(project.revision).toBe(before.revision);
});

test("P2: get_task reviewRules carries only this card's rules; the setup and proposing cards get all", async () => {
  const rules = [cmd("all"), cmd("bug", { types: ["bugfix"] }), cmd("off", { off: true }), { ...llmRule("docs"), types: ["docs" as const] }];
  const x = await setup({ review: { checks: undefined, rules, guidance: "Project guidance" } });
  await x.store.mutate((b) => {
    b.tasks[0]!.type = "feature";
  });
  let ctx = await x.service.get(x.identity);
  expect(ctx.reviewRules!.rules.map((r) => r.id)).toEqual(["all"]);
  expect(ctx.reviewRules!.guidance).toBeUndefined();
  // An LLM rule in effect brings the guidance.
  await x.store.mutate((b) => {
    b.tasks[0]!.type = "docs";
  });
  ctx = await x.service.get(x.identity);
  expect(ctx.reviewRules!.rules.map((r) => r.id)).toEqual(["all", "docs"]);
  expect(ctx.reviewRules!.guidance).toBe("Project guidance");
  // The setup card sees every rule, paused and filtered ones included.
  await x.store.mutate((b) => {
    b.tasks[0]!.reviewSetup = true;
  });
  ctx = await x.service.get(x.identity);
  expect(ctx.reviewRules!.rules.map((r) => r.id)).toEqual(["all", "bug", "off", "docs"]);
  expect(ctx.reviewRules!.guidance).toBe("Project guidance");
  // So does the card that proposed the current draft.
  await x.store.mutate((b) => {
    delete b.tasks[0]!.reviewSetup;
    b.tasks[0]!.type = "feature";
  });
  const c = await x.service.get(x.identity);
  await x.service.write(x.identity, "review_rules", { expectedRevision: c.revision, request: c.request, rules: [cmd("all")], note: "Trim" });
  ctx = await x.service.get(x.identity);
  expect(ctx.reviewRules!.rules.map((r) => r.id)).toEqual(["all", "bug", "off", "docs"]);
});

test("P3: with only the built-in check, a delivery runs it alone, with the card and the user's messages as input", async () => {
  let seen: LlmReviewInput | undefined;
  const x = await setup({
    review: { checks: undefined, rules: [], goal: undefined },
    conversation: async () => ["Add the login form.", "Leave password reset for later."],
    llm: async (input) => {
      seen = input;
      return { model: "m", verdicts: [{ id: "goal", verdict: "pass", detail: "The form is there." }] };
    },
  });
  const board = await x.deliver("development");
  const review = board.tasks[0]!.review!;
  expect(x.runs).toEqual([]);
  expect(review.rules.map((r) => [r.id, r.kind, r.name, r.state])).toEqual([["goal", "llm", "Does what you asked", "passed"]]);
  expect(seen!.rules.map((r) => r.id)).toEqual(["goal"]);
  expect(seen!.rules[0]!.prompt).toContain("A later instruction replaces an earlier one");
  expect(seen!.conversation).toEqual(["Add the login form.", "Leave password reset for later."]);
  expect(seen!.task.title).toBe(board.tasks[0]!.title);
  // review_finished carries each check's result for Insights (§8.3).
  expect(board.events.filter((e) => e.action === "review_finished").at(-1)!.results).toEqual([{ id: "goal", state: "passed" }]);
});

test("P3: no conversation reader leaves the conversation null; other LLM rules do not ask for it", async () => {
  let seen: LlmReviewInput | undefined;
  const x = await setup({
    review: { checks: undefined, rules: [llmRule("l1")], goal: false },
    conversation: async () => {
      throw new Error("should not be read");
    },
    llm: async (input) => {
      seen = input;
      return { model: "m", verdicts: [{ id: "l1", verdict: "pass", detail: "ok" }] };
    },
  });
  await x.deliver("development");
  expect(seen!.conversation).toBeUndefined();
  const y = await setup({
    review: { checks: undefined, rules: [], goal: true },
    llm: async (input) => {
      seen = input;
      return { model: "m", verdicts: [{ id: "goal", verdict: "pass", detail: "ok" }] };
    },
  });
  await y.deliver("development");
  expect(seen!.conversation).toBeNull();
});

test("P3: the built-in check paused and no other check: a delivery starts no review", async () => {
  const x = await setup({ review: { checks: undefined, rules: [], goal: false } });
  const board = await x.deliver("development");
  expect(board.tasks[0]!.status).toBe("in_review");
  expect(board.tasks[0]!.review).toBeUndefined();
});

test("P3: get_task says whether the built-in check is on; a draft can pause it and Apply does", async () => {
  const x = await setup({ review: { checks: undefined, rules: [cmd("a")], goal: undefined } });
  let ctx = await x.service.get(x.identity);
  expect(ctx.reviewRules).toMatchObject({ goal: true, rules: [{ id: "a" }] });
  // An LLM check among the card's checks brings the guidance; the built-in one counts.
  await x.store.mutate((b) => {
    b.projects[0]!.autoReview!.guidance = "Background";
  });
  ctx = await x.service.get(x.identity);
  expect(ctx.reviewRules!.guidance).toBe("Background");
  // "goal" is reserved.
  const bad = await x.service.write(x.identity, "review_rules", { expectedRevision: ctx.revision, request: ctx.request, rules: [cmd("goal")], note: "x" }).catch((e) => e);
  expect(bad).toMatchObject({ code: "REVIEW_RULES_INVALID" });
  ctx = await x.service.get(x.identity);
  await x.service.write(x.identity, "review_rules", { expectedRevision: ctx.revision, request: ctx.request, rules: [cmd("a")], goal: false, note: "Pause it" });
  const draft = (await x.store.read()).projects[0]!.reviewDraft!;
  expect(draft.goal).toBe(false);
  expect(await applyReviewDraft(x.store, { projectId: "p", at: draft.at, confirm: true })).toMatchObject({ status: "applied" });
  expect((await x.store.read()).projects[0]!.autoReview).toMatchObject({ goal: false, rules: [{ id: "a" }] });
});

test("P3: Apply adds the ticked repository commands as command checks; one already there is not added twice", async () => {
  const x = await setup({ review: { enabled: false, checks: undefined, rules: [] } });
  const ctx = await x.service.get(x.identity);
  await x.service.write(x.identity, "review_rules", { expectedRevision: ctx.revision, request: ctx.request, rules: [cmd("a")], note: "x" });
  const draft = (await x.store.read()).projects[0]!.reviewDraft!;
  const result = await applyReviewDraft(x.store, {
    projectId: "p",
    at: draft.at,
    confirm: true,
    add: [
      { name: "Tests", argv: ["npm", "run", "test"] },
      { name: "Same as a", argv: ["echo", "a"] },
    ],
  });
  expect(result).toMatchObject({ status: "applied" });
  const rules = (await x.store.read()).projects[0]!.autoReview!.rules!;
  expect(rules.map((r) => [r.id, r.kind === "command" ? r.argv.join(" ") : ""])).toEqual([["a", "echo a"], ["tests", "npm run test"]]);
});
