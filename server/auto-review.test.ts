import { afterEach, expect, test } from "vitest";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentFixture } from "./agent-fixture";
import {
  AutoReviewService,
  changedRepos,
  commandApplies,
  changedFrom,
  contentDigest,
  contentSnapshot,
  runCheck,
  defaultGit,
  linkedHead,
  linkedRepos,
  linkedReviewDiff,
  linkedShape,
  numstatShape,
  pairingHistoryLimit,
  readConversation,
  pathsChangedSince,
  repoPath,
  reviewDiff,
  reviewShape,
  type Git,
  type LlmReview,
  type LlmReviewInput,
  type RunCheck,
} from "./auto-review";
import { GuardrailsService } from "./guardrails";
import { reviewPrompt } from "./review-session";
import { AsyncQuestionTitles } from "./async-questions";
import { ReviewSnapshots } from "./review-snapshots";
import type { AgentService } from "./agent-service";
import type { ChangeShape, Lane } from "../shared/model";
import type { ConversationEntry } from "../shared/auto-review";
import { emptyCounts, type CardItem, type GuardrailEntry } from "../shared/guardrails";
import { projectLanes } from "../shared/lanes";
import { attentionItems } from "../shared/attention";
import { nativeAttentionToken } from "../shared/session-attention";
import { applyTurnEnded, applyTurnStarted, recordLifecycle } from "./progress-rules";
import { SessionReadService, SessionReadStore } from "./session-reads";

const roots: string[] = [];
/** Waits for each setup's review (started by a delivery) to finish, so it is not still writing when the data dir is removed. */
const settles: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(settles.splice(0).map((settle) => settle()));
  await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })));
});

type Ctx = Awaited<ReturnType<AgentService["get"]>>;
const input = (ctx: Ctx, note = "checkpoint") => ({ expectedRevision: ctx.revision, request: ctx.request, note });
const stamp = new Date().toISOString();
const command = (id: string, argv: string[], extra: Partial<GuardrailEntry> = {}): GuardrailEntry => ({
  id,
  projectId: "p",
  kind: "command",
  text: id === "tests" ? "Tests" : id.toUpperCase(),
  argv,
  state: "active",
  stateAt: stamp,
  counts: emptyCounts(),
  sources: [],
  by: "user",
  revision: 1,
  createdAt: stamp,
  updatedAt: stamp,
  ...extra,
});
const guideline = (id: string, text: string, extra: Partial<GuardrailEntry> = {}): GuardrailEntry => ({
  id,
  projectId: "p",
  kind: "guideline",
  text,
  scope: { types: "all", sizes: "all" },
  state: "active",
  stateAt: stamp,
  counts: emptyCounts(),
  sources: [{ taskId: "old", at: stamp, quote: `quote of ${id}` }],
  by: "learned",
  revision: 1,
  createdAt: stamp,
  updatedAt: stamp,
  ...extra,
});
const cardItem = (id: string, text: string): CardItem => ({ id, projectId: "p", taskId: "t", text, quote: `words of ${id}`, shape: {}, count: 1, state: "open", createdAt: stamp, updatedAt: stamp });
/** Passes every check it is given. */
const passAll: LlmReview = async (input) => ({ model: "claude/haiku", verdicts: input.checks.map((c) => ({ id: c.id, verdict: "pass" as const, detail: "Fine." })) });

/**
 * A card with auto review on and the project's guardrails: by default one active command "Tests" (npm test) and a
 * reviewer that passes everything. `exits` maps a command line to its exit code (missing: 0).
 */
async function setup(
  options: {
    maxRounds?: number;
    lanes?: Lane[];
    exits?: Record<string, number | "spawn" | "timeout">;
    llm?: LlmReview;
    conversation?: () => Promise<ConversationEntry[] | null>;
    entries?: GuardrailEntry[];
    items?: CardItem[];
    shape?: ChangeShape;
    paths?: string[];
    exists?: (path: string) => Promise<boolean>;
    memory?: boolean;
    baseRef?: string;
    /** The workspace directory and git to use, with the real diff and shape (a linked root); default: fakes. */
    directory?: string;
    /** Real git, diff and shape in the fixture's own workspace directory (`x.a`). */
    real?: boolean;
    git?: Git;
    run?: RunCheck;
    /** The fake diff's text, per call (the review session's input). */
    diffText?: (since?: string) => string;
    /** The card's workspace is a shared directory (not a worktree): commands then do not decide (§6.3 step 1). Default: the card's own worktree. */
    shared?: boolean;
  } = {},
) {
  const x = await agentFixture();
  roots.push(x.root);
  await x.store.mutate((b) => {
    b.projects[0]!.autoReview = { enabled: true, maxRounds: options.maxRounds ?? 2 };
    if (options.lanes) b.projects[0]!.lanes = options.lanes;
    if (options.memory === false) b.projects[0]!.memory = false;
    if (options.baseRef) b.tasks[0]!.baseRef = options.baseRef;
  });
  const guardrails = new GuardrailsService(x.store, () => Date.now(), async () => []);
  x.service.guardrails = guardrails;
  await guardrails.store.update((state) => {
    state.entries.push(...(options.entries ?? [command("tests", ["npm", "test"])]));
    state.items.push(...(options.items ?? []));
    return { value: undefined, changed: true };
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
  // `changed`: what `git diff <sha> --name-only -z` lists (paths that differ from the review start's commit).
  const repo = { head: "aaaaaaaaaaaa", changed: [] as string[] };
  const place = { shared: !!options.shared };
  const git: Git =
    options.git ??
    (options.real ? defaultGit : undefined) ??
    (async (_cwd, args) => {
      const key = args.join(" ");
      if (key === "rev-parse --short=12 HEAD") return repo.head;
      if (key === "rev-parse --abbrev-ref HEAD") return "main";
      if (args[0] === "diff" && args.includes("--name-only")) return repo.changed.join("\0");
      return "";
    });
  const diffs: (string | undefined)[] = [];
  const bases: (string | undefined)[] = [];
  const sent: { agentId: string; text: string }[] = [];
  // A plugin restart builds a new service on the same store (`restart`).
  const make = () => new AutoReviewService(x.store, {
    workspace: async () => ({ directory: options.directory ?? x.a, worktree: !place.shared }),
    sessionBusy: async (agentId) => x.actors[agentId]?.status === "running",
    sessionLive: async (agentId) => !!x.actors[agentId] && !x.actors[agentId]!.archivedAt,
    send: async (message) => {
      sent.push({ agentId: message.agentId, text: message.text });
    },
    run: options.run ?? run,
    git,
    guardrails,
    llm: options.llm ?? passAll,
    ...(options.conversation ? { conversation: options.conversation } : {}),
    ...(options.directory || options.real
      ? {}
      : {
          diff: async (_dir: string, since?: string, baseRef?: string) => {
            diffs.push(since);
            bases.push(baseRef);
            return options.diffText ? options.diffText(since) : "diff --git a/x b/x";
          },
          shape: async (_dir: string, baseRef?: string) => (bases.push(baseRef), { shape: options.shape ?? { files: 1, lines: 10, size: "s" as const }, paths: new Set(options.paths ?? ["src/a.ts"]) }),
        }),
    exists: options.exists ?? (async () => false),
  });
  let reviews = make();
  x.store.onReviewStop = (taskId) => reviews.stop(taskId);
  let delivering: Promise<void> = Promise.resolve();
  x.service.onDelivered = (delivery, paseo) => {
    delivering = reviews.delivered(delivery, paseo);
  };
  const restart = () => {
    reviews = make();
    return reviews;
  };
  /** Moves the card to `stage` and then delivers it, as the agent; waits for the review. */
  const deliver = async (stage?: "design" | "development" | "test", extra: Record<string, unknown> = {}) => {
    let ctx = await x.service.get(x.identity);
    if (stage && ctx.task.status !== stage) {
      await x.service.write(x.identity, "status", { ...input(ctx), status: stage });
      ctx = await x.service.get(x.identity);
    }
    await x.service.write(x.identity, "status", { ...input(ctx, "Delivered"), status: "in_review", nextMoves: [], ...extra });
    await delivering;
    await reviews.idle();
    return x.store.read();
  };
  settles.push(async () => {
    await delivering;
    await reviews.idle();
  });
  const turnStarted = () =>
    x.store.mutate((b) => {
      x.store.event(b, { taskId: "t", actor: "system", action: "agent.turn_started", agentId: "actor" });
    });
  const turnEnded = (byUser?: boolean) =>
    x.store.mutate((b) => {
      x.store.event(b, { taskId: "t", actor: "system", action: "agent.turn_ended", agentId: "actor", ...(byUser === undefined ? {} : { byUser }) });
    });
  const entry = async (id: string) => (await guardrails.store.read()).entries.find((e) => e.id === id)!;
  return { ...x, get reviews() { return reviews; }, restart, guardrails, sent, runs, exits, repo, place, diffs, bases, deliver, turnStarted, turnEnded, entry, setDuring: (fn: () => Promise<void>) => (during = fn) };
}

const card = async (x: { store: { read(): Promise<import("../shared/model").Board> } }) => (await x.store.read()).tasks[0]!;

test("no L1 any more: an unticked acceptance list delivers; a card without one gets SETUP_INCOMPLETE once (GUARDRAILS-SPEC §6.1)", async () => {
  const x = await setup();
  let ctx = await x.service.get(x.identity);
  await x.service.write(x.identity, "status", { ...input(ctx), status: "development" });
  ctx = await x.service.get(x.identity);
  await x.service.write(x.identity, "workpad", { expectedRevision: ctx.revision, request: ctx.request, workpadRevision: ctx.workpad!.revision, acceptance: [{ text: "Works", done: false }] });
  ctx = await x.service.get(x.identity);
  await x.service.write(x.identity, "status", { ...input(ctx, "Delivered"), status: "in_review" });
  expect((await card(x)).status).toBe("in_review");
  // Without an acceptance list: refused once, then let through with acknowledgeOpen.
  await x.store.mutate((b) => {
    b.tasks[0]!.status = "development";
    b.workpads[0]!.acceptance = [];
  });
  ctx = await x.service.get(x.identity);
  const refused = await x.service.write(x.identity, "status", { ...input(ctx, "Delivered"), status: "in_review", acknowledgeOpen: true }).catch((e) => e);
  expect(refused).toMatchObject({ code: "SETUP_INCOMPLETE" });
  expect(String(refused.message)).toContain("no acceptance list");
  await x.service.write(x.identity, "status", { ...input(ctx, "Delivered"), status: "in_review", acknowledgeOpen: true });
  expect((await card(x)).status).toBe("in_review");
});

test("a passing review leaves the card in In review; a person's move into In review starts none", async () => {
  const x = await setup();
  const board = await x.deliver("development");
  const task = board.tasks[0]!;
  expect(task.status).toBe("in_review");
  expect(task.review).toMatchObject({ state: "passed", round: 1, maxRounds: 2, shared: false, trigger: { agentId: "actor", from: "development" }, shape: { files: 1, lines: 10, size: "s" }, model: "claude/haiku" });
  expect(task.review!.items).toEqual([
    { id: "tests", kind: "command", name: "Tests", gating: true, state: "passed", argv: ["npm", "test"], exitCode: 0, ms: 5 },
    expect.objectContaining({ id: "goal", kind: "goal", name: "Does what you asked", gating: true, state: "passed" }),
  ]);
  expect(task.review).not.toHaveProperty("rules");
  // review_finished carries each item's result and kind (§6.4).
  expect(board.events.filter((e) => e.action === "review_finished").at(-1)!.results).toEqual([
    { id: "tests", state: "passed", kind: "command" },
    { id: "goal", state: "passed", kind: "goal" },
  ]);
  expect(x.sent).toEqual([]);
  // The review never changed the task revision: only the delivery did.
  const ctx = await x.service.get(x.identity);
  expect(ctx.review).toMatchObject({ state: "passed", round: 1, items: [{ id: "tests", name: "Tests", command: "npm test", state: "passed", gating: true }, { id: "goal" }] });
  expect(ctx).not.toHaveProperty("reviewRules");
  expect(ctx.guardrails).toMatchObject({ enabled: true, maxRounds: 2, commands: [{ id: "tests", name: "Tests", argv: ["npm", "test"], state: "active" }] });
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
    let called = false;
    const x = await setup({
      exits: { "npm test": 1 },
      llm: async (i) => {
        called = true;
        return passAll(i, null as never);
      },
    });
    const board = await x.deliver(stage);
    const task = board.tasks[0]!;
    expect(task.status).toBe(stage);
    expect(task.review).toMatchObject({ state: "rework", round: 1 });
    expect(task.review!.items[0]).toMatchObject({ state: "failed", exitCode: 1, tail: "FAIL expected 1 to be 2" });
    // One repository: nothing to say where it ran (§6.3).
    expect(task.review!.items[0]!.detail).toBeUndefined();
    // D9: the review session runs only when every gating command passed.
    expect(task.review!.items[1]).toMatchObject({ id: "goal", state: "skipped", reason: "A command failed." });
    expect(called).toBe(false);
    const moved = board.events.filter((e) => e.action === "status_changed").at(-1)!;
    expect(moved).toMatchObject({ actor: "system", rule: "R1", from: "in_review", to: stage, agentId: "actor" });
    expect(x.sent).toHaveLength(1);
    expect(x.sent[0]!.agentId).toBe("actor");
    expect(x.sent[0]!.text.startsWith("[Flowly auto review · rework 1/2]\n")).toBe(true);
    expect(x.sent[0]!.text).toContain("Commands: 0/1 passed\n✗ Tests (npm test) exited 1. [id: tests]");
    expect(x.sent[0]!.text).toContain("Review: skipped (a command failed)");
    const ctx = await x.service.get(x.identity);
    expect(ctx.review).toMatchObject({ state: "rework", items: [{ state: "failed", exitCode: 1 }, { state: "skipped" }] });
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
  const x = await setup({ exits: { "npm test": 1 }, maxRounds: 1 });
  let board = await x.deliver("development");
  expect(board.tasks[0]).toMatchObject({ status: "development", review: { state: "rework", round: 1 } });
  // The rework turn starts and the agent delivers again: the same round continues.
  await x.turnStarted();
  board = await x.deliver();
  expect(board.tasks[0]).toMatchObject({ status: "blocked", review: { state: "failed", round: 2 } });
  expect(board.events.filter((e) => e.action === "status_changed").at(-1)).toMatchObject({ rule: "R2", to: "blocked", note: "Auto review failed after 1 rework round" });
  expect(x.sent).toHaveLength(1);

  const zero = await setup({ exits: { "npm test": 1 }, maxRounds: 0 });
  board = await zero.deliver("development");
  expect(board.tasks[0]).toMatchObject({ status: "blocked", review: { state: "failed", round: 1 } });
  expect(zero.sent).toEqual([]);

  const noBlocked = await setup({ exits: { "npm test": 1 }, maxRounds: 0, lanes: projectLanes(null).map((l) => (l.status === "blocked" ? { ...l, enabled: false } : l)) });
  board = await noBlocked.deliver("development");
  expect(board.tasks[0]).toMatchObject({ status: "in_review", review: { state: "failed" } });
});

test("a person's message between deliveries starts the count again; a background wake-up does not (§3.3)", async () => {
  const x = await setup({ exits: { "npm test": 1 }, maxRounds: 1 });
  await x.deliver("development");
  // The rework turn, then a second turn the user started.
  await x.turnStarted();
  await x.turnEnded(true);
  await x.turnStarted();
  await x.turnEnded(true);
  let board = await x.deliver();
  expect(board.tasks[0]).toMatchObject({ status: "development", review: { state: "rework", round: 1 } });
  expect(x.sent).toHaveLength(2);
  // The rework turn, then a turn a background task woke (byUser false): the round goes on and reaches the limit.
  await x.turnStarted();
  await x.turnEnded(true);
  await x.turnStarted();
  await x.turnEnded(false);
  board = await x.deliver();
  expect(board.tasks[0]).toMatchObject({ status: "blocked", review: { state: "failed", round: 2 } });
  expect(x.sent).toHaveLength(2);
});

test("unavailable: a check that cannot start or times out, or a gone session, leaves the round count alone", async () => {
  for (const exit of ["spawn", "timeout"] as const) {
    const x = await setup({ exits: { "npm test": exit } });
    const board = await x.deliver("development");
    expect(board.tasks[0]).toMatchObject({ status: "in_review", review: { state: "unavailable", round: 1 } });
    expect(board.tasks[0]!.review!.reason).toMatch(exit === "spawn" ? /Tests: Could not start: spawn npm ENOENT/ : /Tests: Timed out after 600 s/);
    // The judged checks were skipped: a command that could not run says nothing about the change.
    expect(board.tasks[0]!.review!.items.find((i) => i.kind === "goal")).toMatchObject({ state: "skipped", reason: "A command could not run." });
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

test("Rerun: in In review, from round 1, with the latest delivering session", async () => {
  const x = await setup({ exits: { "npm test": 1 }, maxRounds: 0 });
  await x.deliver("development");
  await x.store.mutate((b) => {
    b.tasks[0]!.status = "in_review";
  });
  x.exits["npm test"] = 0;
  await x.reviews.rerun("t", x.paseo);
  await x.reviews.idle();
  expect(await card(x)).toMatchObject({ status: "in_review", review: { state: "passed", round: 1, trigger: { agentId: "actor", eventId: "" } } });
  expect((await card(x)).review!.handledAt).toBeUndefined();
});

test("Rerun from Blocked after a failed review: moves to In review and waits in one write, ends the Attention signal (§3.5)", async () => {
  const { reviewSignal } = await import("../shared/auto-review");
  const x = await setup({ exits: { "npm test": 1 }, maxRounds: 0 });
  await x.deliver("development");
  let task = await card(x);
  expect(task).toMatchObject({ status: "blocked", review: { state: "failed" } });
  expect(reviewSignal(task)).toMatchObject({ state: "failed" });
  const revision = task.revision;
  x.exits["npm test"] = 0;
  await x.reviews.rerun("t", x.paseo);
  // Before the review starts: In review, waiting, the old failure hidden and handled.
  task = await card(x);
  expect(task).toMatchObject({ status: "in_review", revision: revision + 1, reviewWaiting: { agentId: "actor", from: "development" } });
  expect(task.reviewWaiting!.eventId).toMatch(/^rerun:/);
  expect(reviewSignal(task)).toBeNull();
  // Refused while the first is queued or already running (whichever check the timing reaches first).
  await expect(x.reviews.rerun("t", x.paseo)).rejects.toThrow(/waiting to start|already running/);
  const board = await x.store.read();
  expect(board.events.filter((e) => e.action === "status_changed").at(-1)).toMatchObject({ actor: "human", from: "blocked", to: "in_review", note: "Rerun auto review" });
  await x.reviews.idle();
  task = await card(x);
  expect(task.reviewWaiting).toBeUndefined();
  expect(task).toMatchObject({ status: "in_review", review: { state: "passed", round: 1, trigger: { eventId: "" } } });
});

test("Rerun past the rework limit gives the agent a whole new round budget; maxRounds 0 goes back to Blocked (§3.5)", async () => {
  const { reviewSignal } = await import("../shared/auto-review");
  const x = await setup({ exits: { "npm test": 1 }, maxRounds: 1 });
  await x.deliver("development");
  await x.turnStarted();
  await x.deliver();
  expect(await card(x)).toMatchObject({ status: "blocked", review: { state: "failed", round: 2 } });
  expect(x.sent).toHaveLength(1);
  await x.reviews.rerun("t", x.paseo);
  await x.reviews.idle();
  expect(await card(x)).toMatchObject({ status: "development", review: { state: "rework", round: 1 } });
  expect(x.sent).toHaveLength(2);
  expect(x.sent[1]!.text).toMatch(/^\[Flowly auto review/);

  const zero = await setup({ exits: { "npm test": 1 }, maxRounds: 0 });
  await zero.deliver("development");
  const first = (await card(zero)).review!.startedAt;
  await zero.reviews.rerun("t", zero.paseo);
  await zero.reviews.idle();
  const task = await card(zero);
  expect(task).toMatchObject({ status: "blocked", review: { state: "failed", round: 1 } });
  expect(task.review!.handledAt).toBeUndefined();
  // A new failure is a new signal.
  expect(reviewSignal(task)!.key).not.toBe(`review:failed:${first}`);
  expect(zero.sent).toEqual([]);
});

test("Rerun is refused in a work stage, in Blocked without a failed review, and in Done; the card stays (§3.5)", async () => {
  const x = await setup({ exits: { "npm test": 1 } });
  x.setDuring(async () => {
    x.actors.actor!.archivedAt = new Date().toISOString();
  });
  // R1, then the rework could not be delivered: Unavailable in Development.
  await x.deliver("development");
  expect(await card(x)).toMatchObject({ status: "development", review: { state: "unavailable" } });
  const message = "Only a card in In review, or in Blocked after its review failed, can be reviewed again.";
  await expect(x.reviews.rerun("t", x.paseo)).rejects.toThrow(message);
  for (const status of ["blocked", "done"] as const) {
    await x.store.mutate((b) => {
      b.tasks[0]!.status = status;
    });
    await expect(x.reviews.rerun("t", x.paseo)).rejects.toThrow(message);
    expect((await card(x)).status).toBe(status);
  }
  await x.store.mutate((b) => {
    b.tasks[0]!.status = "in_review";
    b.projects[0]!.autoReview!.enabled = false;
  });
  await expect(x.reviews.rerun("t", x.paseo)).rejects.toThrow("Turn on Auto review");
  expect((await card(x)).reviewWaiting).toBeUndefined();
});

test("Rerun from Blocked is refused while the In review lane is off; the card stays in Blocked (§3.5)", async () => {
  const x = await setup({ exits: { "npm test": 1 }, maxRounds: 0 });
  await x.deliver("development");
  const before = await card(x);
  expect(before).toMatchObject({ status: "blocked", review: { state: "failed" } });
  await x.store.mutate((b) => {
    b.projects[0]!.lanes = projectLanes(null).map((l) => (l.status === "in_review" ? { ...l, enabled: false } : l));
  });
  await expect(x.reviews.rerun("t", x.paseo)).rejects.toThrow("In review is not a lane in this project.");
  expect(await card(x)).toMatchObject({ status: "blocked", revision: before.revision });
  expect((await card(x)).reviewWaiting).toBeUndefined();
});

test("Rerun in In review while another review runs: the card waits and hides the old result until its review starts (§3.5)", async () => {
  const { reviewSignal, visibleReview } = await import("../shared/auto-review");
  const x = await setup({ exits: { "npm test": "spawn" } });
  await x.deliver("development");
  let task = await card(x);
  expect(task).toMatchObject({ status: "in_review", review: { state: "unavailable" } });
  expect(reviewSignal(task)).toMatchObject({ state: "unavailable" });
  // Another card of the project is being reviewed: this one queues behind it.
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const queue = x.reviews as unknown as { enqueue(key: string, taskId: string, job: () => Promise<void>): Promise<void> };
  const blocked = queue.enqueue(task.projectId, "other", () => gate);
  x.exits["npm test"] = 0;
  const runs = x.runs.length;
  await x.reviews.rerun("t", x.paseo);
  task = await card(x);
  expect(task.status).toBe("in_review");
  expect(task.reviewWaiting?.eventId).toMatch(/^rerun:/);
  expect(visibleReview(task)).toBeNull();
  expect(reviewSignal(task)).toBeNull();
  expect(x.runs.length).toBe(runs);
  release();
  await blocked;
  await x.reviews.idle();
  task = await card(x);
  expect(task.reviewWaiting).toBeUndefined();
  expect(task.review).toMatchObject({ state: "passed", round: 1 });
});

test("Rerun is refused while a review runs, without a delivery, or with Auto review off in Blocked; nothing is written (§3.5)", async () => {
  const x = await setup({ exits: { "npm test": 1 }, maxRounds: 0 });
  await x.deliver("development");
  const unchanged = async (run: () => Promise<unknown>, message: string | RegExp) => {
    const before = await x.store.read();
    await expect(run()).rejects.toThrow(message);
    const after = await x.store.read();
    expect(after.revision).toBe(before.revision);
    expect(after.tasks[0]).toEqual(before.tasks[0]);
    expect(after.events.length).toBe(before.events.length);
  };
  // Blocked after a failure, but Auto review is off: the card does not move to In review.
  await x.store.mutate((b) => {
    b.projects[0]!.autoReview!.enabled = false;
  });
  expect((await card(x)).status).toBe("blocked");
  await unchanged(() => x.reviews.rerun("t", x.paseo), "Turn on Auto review");
  await x.store.mutate((b) => {
    b.projects[0]!.autoReview!.enabled = true;
    b.tasks[0]!.status = "in_review";
    b.tasks[0]!.review!.state = "running";
  });
  await unchanged(() => x.reviews.rerun("t", x.paseo), "A review of this card is already running.");

  // A person dragged a card into In review that no agent ever delivered.
  const never = await setup();
  await never.store.mutate((b) => {
    b.tasks[0]!.status = "in_review";
  });
  const before = await never.store.read();
  await expect(never.reviews.rerun("t", never.paseo)).rejects.toThrow("No agent delivered this card");
  const after = await never.store.read();
  expect(after.revision).toBe(before.revision);
  expect(after.tasks[0]).toEqual(before.tasks[0]);
});

test("handled (§3.5, D18): a turn on the card or a person's move ends the review's Attention signal; A1r back to Blocked does not raise it again", async () => {
  const { reviewSignal, visibleReview } = await import("../shared/auto-review");
  const x = await setup({ exits: { "npm test": 1 }, maxRounds: 0 });
  await x.deliver("development");
  let board = await x.store.read();
  const finished = board.tasks[0]!;
  const unread = [{ id: "actor", workspaceId: "w", status: "idle", archivedAt: null, requiresAttention: true, attentionReason: "finished", updatedAt: "2026-10-28T00:00:00.000Z" }];
  expect(attentionItems(board, [] as never, [], false)[0]).toMatchObject({ review: "failed" });
  expect(finished.review!.handledAt).toBeUndefined();
  // Mark as read on the card's session clears its unread, not the review's signal.
  Object.assign(x.actors.actor!, { requiresAttention: true, attentionReason: "finished", attentionTimestamp: "2026-10-28T00:00:00.000Z" });
  const reads = new SessionReadService(x.store, new SessionReadStore(join(x.root, "reads")));
  const receipt = await reads.mark({ taskId: "t", agentId: "actor", token: nativeAttentionToken(x.actors.actor as never)! }, x.paseo);
  expect(receipt).toBeTruthy();
  board = await x.store.read();
  expect(board.tasks[0]!.review!.handledAt).toBeUndefined();
  expect(attentionItems(board, [x.actors.actor] as never, (await reads.reads.read()).receipts, false)[0]).toMatchObject({ review: "failed", unread: 0 });

  // The person replies: A1 moves the card to a work stage; the agent answers without a report and A1r restores Blocked.
  await x.store.mutate((b) => {
    recordLifecycle(x.store, b, x.identity, "agent.turn_started");
    expect(applyTurnStarted(x.store, b, x.identity, "First actor")).toBe(true);
  });
  board = await x.store.read();
  expect(board.tasks[0]!.status).toBe("development");
  expect(board.tasks[0]!.review!.handledAt).toBeTruthy();
  await x.store.mutate((b) => {
    recordLifecycle(x.store, b, x.identity, "agent.turn_ended", { kind: "completed" } as never);
    expect(applyTurnEnded(x.store, b, x.identity, { kind: "completed" } as never)).toBe(true);
  });
  board = await x.store.read();
  expect(board.events.filter((e) => e.action === "status_changed").map((e) => e.rule).slice(-2)).toEqual(["A1", "A1r"]);
  let task = board.tasks[0]!;
  expect(task.status).toBe("blocked");
  expect(task.review!.handledAt).toBeTruthy();
  expect(visibleReview(task)).toMatchObject({ state: "failed" });
  expect(reviewSignal(task)).toBeNull();
  expect(attentionItems(board, [] as never, [], false)).toEqual([]);
  // Other signals of the card still count.
  expect(attentionItems(board, unread as never, [], false)[0]).toMatchObject({ review: null, unread: 1 });
  // The first action is kept.
  const handledAt = task.review!.handledAt;
  await x.turnStarted();
  expect((await card(x)).review!.handledAt).toBe(handledAt);

  // A person's drag from Blocked to In review: the card face keeps the failure, Attention does not.
  const moved = await setup({ exits: { "npm test": 1 }, maxRounds: 0 });
  await moved.deliver("development");
  task = await card(moved);
  await moved.store.placeTask({ id: "t", revision: task.revision, status: "in_review", beforeId: null, afterId: null });
  task = await card(moved);
  expect(task.review!.handledAt).toBeTruthy();
  expect(visibleReview(task)).toMatchObject({ state: "failed" });
  expect(reviewSignal(task)).toBeNull();

  // Unavailable after R1 could not deliver the rework, in Development: a turn on the card ends it too.
  const gone = await setup({ exits: { "npm test": 1 } });
  gone.setDuring(async () => {
    gone.actors.actor!.archivedAt = new Date().toISOString();
  });
  await gone.deliver("development");
  expect(reviewSignal(await card(gone))).toMatchObject({ state: "unavailable" });
  await gone.turnStarted();
  expect(reviewSignal(await card(gone))).toBeNull();

  // A pass is never marked.
  const passed = await setup();
  await passed.deliver("development");
  await passed.turnStarted();
  expect((await card(passed)).review!.handledAt).toBeUndefined();
});

test("handled (§3.5, §13.3): after Dismiss, the next unread brings the card back without Review failed; handledAt leaves questions, permissions and errors alone", async () => {
  const x = await setup({ exits: { "npm test": 1 }, maxRounds: 0 });
  await x.deliver("development");
  const idle = { id: "actor", workspaceId: "w", status: "idle", archivedAt: null, requiresAttention: false, attentionReason: null };
  let board = await x.store.read();
  const failed = attentionItems(board, [idle] as never, [], false)[0]!;
  expect(failed).toMatchObject({ review: "failed", dismissed: false });
  // Dismiss: the card is set aside while the failure is all it waits on.
  await x.store.dismissAttention({ taskId: "t", signals: failed.signals });
  board = await x.store.read();
  expect(attentionItems(board, [idle] as never, [], false)[0]).toMatchObject({ review: "failed", dismissed: true });

  // The person replies in the session (A1 → handled); the agent's answer is a new unread, so the card comes back without the failure.
  await x.store.mutate((b) => {
    recordLifecycle(x.store, b, x.identity, "agent.turn_started");
    applyTurnStarted(x.store, b, x.identity, "First actor");
  });
  const later = new Date(Date.now() + 60_000).toISOString();
  const answered = { ...idle, requiresAttention: true, attentionReason: "finished", attentionTimestamp: later, lastUserMessageAt: stamp, updatedAt: later };
  board = await x.store.read();
  expect(board.tasks[0]!.review!.handledAt).toBeTruthy();
  const back = attentionItems(board, [answered] as never, [], false)[0]!;
  expect(back).toMatchObject({ review: null, unread: 1, dismissed: false });
  expect(back.signals.some((k) => k.startsWith("review:"))).toBe(false);

  // Same card, review handled: a Kanban question, a permission request and a session error each still count.
  await x.store.mutate((b) => {
    x.store.event(b, { taskId: "t", actor: "agent", action: "progress_reported", agentId: "actor", reportKind: "question", note: "Which one?" });
  });
  board = await x.store.read();
  expect(board.tasks[0]!.review!.handledAt).toBeTruthy();
  const asking = attentionItems(board, [idle] as never, [], false)[0]!;
  expect(asking).toMatchObject({ review: null, questions: 1, dismissed: false });
  const permission = { ...idle, requiresAttention: true, attentionReason: "permission", attentionTimestamp: later, pendingPermissions: [{ id: "req-1", kind: "tool" }] };
  expect(attentionItems(board, [permission] as never, [], false)[0]).toMatchObject({ review: null, permissions: 1 });
  const error = { ...idle, status: "error", requiresAttention: true, attentionReason: "error", attentionTimestamp: later };
  expect(attentionItems(board, [error] as never, [], false)[0]).toMatchObject({ review: null, errors: 1 });
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
  // A new delivery hides the old failure and holds unread until its review starts.
  task.reviewWaiting = { eventId: "next", agentId: "actor", from: "development", since: stamp };
  expect(attentionItems(board, agents as never, [], false)).toEqual([]);
});

test("the review starts when the delivering session's turn ends, not while it is still running", async () => {
  const x = await setup();
  x.actors.actor!.status = "running";
  let board = await x.deliver("development");
  expect(x.runs).toEqual([]);
  expect(board.tasks[0]!.review).toBeUndefined();
  // Waiting is recorded in the delivery's own write (§3.1).
  expect(board.tasks[0]!.reviewWaiting).toMatchObject({ agentId: "actor", from: "development" });
  // Another session's turn ending does not start it.
  await x.reviews.turnEnded("second", x.paseo);
  expect(x.runs).toEqual([]);
  x.actors.actor!.status = "idle";
  await x.reviews.turnEnded("actor", x.paseo);
  await x.reviews.idle();
  board = await x.store.read();
  expect(board.tasks[0]!.review).toMatchObject({ state: "passed" });
  expect(board.tasks[0]!.reviewWaiting).toBeUndefined();
  expect(x.runs).toEqual(["npm test"]);
  // Once only.
  await x.reviews.turnEnded("actor", x.paseo);
  await x.reviews.idle();
  expect(x.runs).toEqual(["npm test"]);
});

test("while a delivery waits for its review the previous result is hidden; the wait ends when the review starts (§3.1, §9)", async () => {
  const { visibleReview, reviewing, reviewSignal } = await import("../shared/auto-review");
  const x = await setup();
  await x.deliver("development");
  expect((await card(x)).review).toMatchObject({ state: "passed" });
  // The user sends it back; the agent delivers again while its turn is still running.
  await x.store.mutate((b) => {
    b.tasks[0]!.status = "development";
  });
  x.actors.actor!.status = "running";
  await x.deliver();
  let task = await card(x);
  expect(task.review).toMatchObject({ state: "passed" });
  expect(task.reviewWaiting).toBeTruthy();
  expect(visibleReview(task)).toBeNull();
  expect(reviewing(task)).toBe(true);
  expect(reviewSignal(task)).toBeNull();
  await expect(x.reviews.rerun("t", x.paseo)).rejects.toThrow(/waiting to start/);
  // The review's start clears it in the same write.
  let seen: unknown = "unset";
  x.setDuring(async () => {
    seen = (await card(x)).reviewWaiting;
  });
  x.actors.actor!.status = "idle";
  await x.reviews.turnEnded("actor", x.paseo);
  await x.reviews.idle();
  expect(seen).toBeUndefined();
  task = await card(x);
  expect(task.reviewWaiting).toBeUndefined();
  expect(visibleReview(task)).toMatchObject({ state: "passed" });
});

test("a waiting delivery that is not reviewed (card moved out of In review) does not leave the card waiting", async () => {
  const x = await setup();
  x.actors.actor!.status = "running";
  await x.deliver("development");
  expect((await card(x)).reviewWaiting).toBeTruthy();
  await x.store.mutate((b) => {
    b.tasks[0]!.status = "development";
  });
  await x.reviews.turnEnded("actor", x.paseo);
  await x.reviews.idle();
  expect(x.runs).toEqual([]);
  expect((await card(x)).reviewWaiting).toBeUndefined();
});

test("recover: a delivery still waiting for its review at a restart becomes unavailable and can be rerun", async () => {
  const x = await setup();
  x.actors.actor!.status = "running";
  await x.deliver("development");
  expect(await x.reviews.recover()).toBe(true);
  const task = await card(x);
  expect(task.reviewWaiting).toBeUndefined();
  expect(task.review).toMatchObject({ state: "unavailable", reason: "Flowly restarted before the review started.", trigger: { agentId: "actor", from: "development" }, items: [] });
  expect(await x.reviews.recover()).toBe(false);
  x.actors.actor!.status = "idle";
  await x.reviews.rerun("t", x.paseo);
  await x.reviews.idle();
  expect((await card(x)).review).toMatchObject({ state: "passed" });
});

test("turning Auto review off before the delivering turn ends clears the waiting marker without running checks", async () => {
  const x = await setup();
  x.actors.actor!.status = "running";
  await x.deliver("development");
  await x.store.mutate((b) => {
    b.projects[0]!.autoReview!.enabled = false;
  });
  await x.reviews.turnEnded("actor", x.paseo);
  await x.reviews.idle();
  expect(x.runs).toEqual([]);
  expect((await card(x)).reviewWaiting).toBeUndefined();
});

test("a fast review computes immediately but sends rework only after the delivering turn is recorded", async () => {
  const x = await setup({ exits: { "npm test": 1 } });
  x.actors.actor!.status = "running";
  await x.deliver("development");
  let release!: (ready: boolean) => void;
  const recorded = new Promise<boolean>((resolve) => { release = resolve; });
  let computed!: () => void;
  const reworked = new Promise<void>((resolve) => { computed = resolve; });
  x.store.onCommit = () => {
    void x.store.read().then((b) => { if (b.tasks[0]!.review?.state === "rework") computed(); });
  };
  x.reviews.deps.send = async (message) => {
    await x.store.mutate((b) => { x.store.event(b, { taskId: "t", actor: "system", action: "agent.turn_started", agentId: "actor" }); });
    x.sent.push({ agentId: message.agentId, text: message.text });
  };
  const review = x.reviews.turnEnded("actor", x.paseo, recorded);
  try {
    await reworked;
    // The failed command ran once more at the same commit (§6.3 step 1) and failed again.
    expect(x.runs).toEqual(["npm test", "npm test"]);
    expect(x.sent).toEqual([]);
    await x.store.mutate((b) => {
      x.store.event(b, { taskId: "t", actor: "system", action: "agent.turn_ended", agentId: "actor", model: "codex/test", pick: 0, byUser: true });
    });
    release(true);
    await review;
    expect(x.sent).toHaveLength(1);
    const facts = (await x.store.read()).events.filter((e) => e.action === "agent.turn_started" || e.action === "agent.turn_ended");
    expect(facts.slice(-2).map((e) => e.action)).toEqual(["agent.turn_ended", "agent.turn_started"]);
    expect(facts.at(-2)).toMatchObject({ model: "codex/test", pick: 0, byUser: true });
  } finally {
    x.store.onCommit = null;
    release(true);
    await x.reviews.idle();
  }
});

test("a lifecycle write failure does not start a rework turn", async () => {
  const x = await setup({ exits: { "npm test": 1 } });
  x.actors.actor!.status = "running";
  await x.deliver("development");
  await x.reviews.turnEnded("actor", x.paseo, Promise.resolve(false));
  expect(x.sent).toEqual([]);
  expect((await card(x)).review).toMatchObject({ state: "unavailable", reason: "The delivering turn could not be recorded, so the rework message was not sent." });
  // The rework never went out, so that review does not count toward the card's cap (§3.3).
  expect((await card(x)).reviewCount ?? 0).toBe(0);
});

test("a second card keeps waiting while the project's first review runs; reviews remain serial", async () => {
  const x = await setup();
  x.actors.actor!.status = "running";
  await x.deliver("development");
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { entered = resolve; });
  x.setDuring(async () => { entered(); await gate; });
  const first = x.reviews.turnEnded("actor", x.paseo);
  try {
    await started;
    await x.store.mutate((b) => {
      b.tasks.push({ ...b.tasks[0]!, id: "second-card", workspaceId: "second-workspace", operationId: "second-create", review: undefined,
        reviewWaiting: { eventId: "second-delivery", agentId: "second", from: "development", since: stamp } });
    });
    x.actors.second!.status = "running";
    await x.reviews.delivered({ taskId: "second-card", projectId: "p", eventId: "second-delivery", agentId: "second", from: "development" }, x.paseo);
    const second = x.reviews.turnEnded("second", x.paseo);
    const queued = (await x.store.read()).tasks.find((t) => t.id === "second-card")!;
    expect(queued.reviewWaiting).toBeTruthy();
    expect(queued.review).toBeUndefined();
    expect(x.runs).toEqual(["npm test"]);
    release();
    await Promise.all([first, second]);
    const finished = (await x.store.read()).tasks.find((t) => t.id === "second-card")!;
    expect(finished.reviewWaiting).toBeUndefined();
    expect(finished.review?.state).toBe("passed");
    expect(x.runs).toEqual(["npm test", "npm test"]);
  } finally {
    release();
    await x.reviews.idle();
  }
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
  // Stopped before it started: nothing is spawned.
  const controller = new AbortController();
  controller.abort();
  const marker = join(tmpdir(), `flowly-runcheck-${process.pid}-${Date.now()}`);
  const stopped = await runCheck([process.execPath, "-e", `require("fs").writeFileSync(${JSON.stringify(marker)}, "x")`], process.cwd(), 5_000, controller.signal);
  expect(stopped).toMatchObject({ exitCode: null, spawnError: "Stopped." });
  expect(existsSync(marker)).toBe(false);
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

test("an observing command runs and shows its result but never decides the review; it counts toward its promotion (§4.5)", async () => {
  const x = await setup({
    entries: [command("tests", ["npm", "test"]), command("e2e", ["npm", "run", "test:e2e"], { state: "observing", by: "detect", observe: { reviews: 2, passed: 0 } })],
    exits: { "npm run test:e2e": 1 },
  });
  let board = await x.deliver("development");
  expect(x.runs).toEqual(["npm test", "npm run test:e2e"]);
  expect(board.tasks[0]!.review!.items.map((i) => [i.id, i.gating, i.state])).toEqual([
    ["tests", true, "passed"],
    ["e2e", false, "failed"],
    ["goal", true, "passed"],
  ]);
  expect(board.tasks[0]).toMatchObject({ status: "in_review", review: { state: "passed" } });
  expect(x.sent).toEqual([]);
  // Three reviews without a pass: still observing; a pass on the next one makes it active.
  expect(await x.entry("e2e")).toMatchObject({ state: "observing", observe: { reviews: 3, passed: 0 } });
  x.exits["npm run test:e2e"] = 0;
  await x.reviews.rerun("t", x.paseo);
  await x.reviews.idle();
  expect(await x.entry("e2e")).toMatchObject({ state: "active", stateReason: "observed", counts: { reviews: 2, passes: 1 } });
  expect((await x.entry("e2e")).observe).toBeUndefined();
  // A command that cannot run three times in a row is paused (§4.5).
  x.exits["npm test"] = "spawn";
  for (let i = 0; i < 3; i++) {
    await x.reviews.rerun("t", x.paseo);
    await x.reviews.idle();
  }
  expect(await x.entry("tests")).toMatchObject({ state: "paused", stateReason: "cannot run" });
  board = await x.store.read();
  expect(board.events.filter((e) => e.action === "guardrail_retired").map((e) => e.guardrail)).toEqual([{ change: "paused", kind: "command", id: "tests" }]);
});

test("what is judged: the built-in check, guidelines in scope by type and size, the card's open items; Guardrails off leaves only commands and the goal (§6.2, B4)", async () => {
  let seen: LlmReviewInput | undefined;
  const llm: LlmReview = async (input) => {
    seen = input;
    return passAll(input, null as never);
  };
  const entries = [
    command("tests", ["npm", "test"]),
    guideline("g-small", "Small feature rule", { scope: { types: ["feature"], sizes: ["s"] } }),
    guideline("g-large", "Large-only rule", { scope: { types: "all", sizes: ["l"] } }),
    guideline("g-bug", "Bugfix-only rule", { scope: { types: ["bugfix"], sizes: "all" } }),
    guideline("g-paused", "Paused rule", { state: "paused" }),
  ];
  const x = await setup({ entries, items: [cardItem("i-1", "Keeps the scroll position")], llm, conversation: async () => ["Add login."] });
  const board = await x.deliver("development");
  expect(board.tasks[0]!.review!.items.map((i) => [i.id, i.kind])).toEqual([
    ["tests", "command"],
    ["goal", "goal"],
    ["g-small", "guideline"],
    ["i-1", "item"],
  ]);
  expect(seen!.checks.map((c) => [c.id, c.kind, c.quote])).toEqual([
    ["goal", "goal", undefined],
    ["g-small", "guideline", "quote of g-small"],
    ["i-1", "item", "words of i-1"],
  ]);
  expect(seen!.checks[0]!.text).toContain("A later instruction replaces an earlier one");
  expect(seen!.conversation).toEqual(["Add login."]);
  expect(seen).toMatchObject({ deliveryNote: "Delivered", diff: "diff --git a/x b/x", commands: ["Tests: passed"], acceptance: [{ text: "Seeded criterion" }] });
  expect(seen!.incremental).toBeUndefined();
  // Guardrails off for the project: no guidelines or items, the commands and the goal still run.
  const off = await setup({ entries, items: [cardItem("i-1", "Keeps the scroll position")], memory: false });
  const after = await off.deliver("development");
  expect(after.tasks[0]!.review!.items.map((i) => i.id)).toEqual(["tests", "goal"]);
  // No guardrails at all: the built-in check alone.
  const bare = await setup({ entries: [] });
  expect((await bare.deliver("development")).tasks[0]!.review!.items.map((i) => i.id)).toEqual(["goal"]);
  expect(bare.runs).toEqual([]);
});

test("B1: a fail without evidence becomes na; a file in the diff, an existing repository file or a quote found in the reviewer's input keeps it", async () => {
  const llm: LlmReview = async () => ({
    model: "m",
    verdicts: [
      { id: "goal", verdict: "fail", detail: "Feels incomplete." },
      { id: "g-diff", verdict: "fail", detail: "Wrong here.", file: "./src/a.ts", line: 3 },
      { id: "g-repo", verdict: "fail", detail: "No zh-TW entry.", file: "shared/i18n/zh-TW.ts" },
      { id: "g-quote", verdict: "fail", detail: "No Rerun button.", quote: "add a Rerun button" },
      { id: "g-outside", verdict: "fail", detail: "Elsewhere.", file: "../other/x.ts" },
      { id: "g-words", verdict: "fail", detail: "Same as before.", quote: "QUOTE OF  g-words" },
      { id: "g-title", verdict: "fail", detail: "Not the card.", quote: "card" },
      { id: "g-invented", verdict: "fail", detail: "No dark mode.", quote: "the user asked for a dark mode" },
    ],
  });
  const ids = ["g-diff", "g-repo", "g-quote", "g-outside", "g-words", "g-title", "g-invented"];
  const entries = ids.map((id) => guideline(id, id));
  const x = await setup({ entries, llm, exists: async (path) => path.endsWith("shared/i18n/zh-TW.ts"), conversation: async () => ["Please ADD a\n rerun button next to each failed check."] });
  const board = await x.deliver("development");
  const items = board.tasks[0]!.review!.items;
  expect(items.map((i) => [i.id, i.state, i.reason])).toEqual([
    ["goal", "na", "no evidence"],
    ["g-diff", "failed", undefined],
    ["g-repo", "failed", undefined],
    // From the conversation, the check's own user words and the card title.
    ["g-quote", "failed", undefined],
    ["g-outside", "na", "no evidence"],
    ["g-words", "failed", undefined],
    ["g-title", "failed", undefined],
    // A quote that appears nowhere the reviewer was given is no evidence.
    ["g-invented", "na", "no evidence"],
  ]);
  expect(items[1]).toMatchObject({ file: "src/a.ts", line: 3 });
  expect(items[3]).toMatchObject({ quote: "add a Rerun button" });
  // The rework message uses the user's words for guidelines.
  expect(x.sent[0]!.text).toContain('✗ [major] "quote of g-diff" — Wrong here. (src/a.ts:3) [id: g-diff]');
});

test("round 2 reads only the changes since the previous delivery and keeps what passed before (§6.3)", async () => {
  const inputs: LlmReviewInput[] = [];
  let round = 0;
  const llm: LlmReview = async (input) => {
    inputs.push(input);
    round++;
    return round === 1
      ? { model: "m", verdicts: [{ id: "goal", verdict: "pass", detail: "ok" }, { id: "g1", verdict: "fail", detail: "zh-TW missing", file: "src/a.ts" }] }
      : { model: "m", verdicts: [{ id: "g1", verdict: "pass", detail: "fixed" }] };
  };
  const x = await setup({ entries: [guideline("g1", "i18n everywhere")], llm });
  await x.deliver("development");
  expect(x.diffs).toEqual([undefined]);
  await x.turnStarted();
  x.repo.head = "bbbbbbbbbbbb";
  const board = await x.deliver();
  expect(board.tasks[0]!.review).toMatchObject({ state: "passed", round: 2 });
  expect(x.diffs).toEqual([undefined, "aaaaaaaaaaaa"]);
  expect(inputs[1]).toMatchObject({ incremental: true });
  expect(inputs[1]!.checks.map((c) => [c.id, c.previous?.state])).toEqual([["goal", "passed"], ["g1", "failed"]]);
  // The goal passed in round 1 and was not judged again: its pass stands.
  expect(board.tasks[0]!.review!.items.find((i) => i.id === "goal")).toMatchObject({ state: "passed", reason: "Passed in the previous round; not judged again." });
  // Caught (§6.6): failed in round 1, passed in round 2 of the same card.
  expect(await x.entry("g1")).toMatchObject({ counts: { caught: 1, reviews: 2, passes: 1 } });
  expect((await x.entry("g1")).counts.lastCaughtAt).toBeTruthy();
  // A person's Rerun starts from round 1 with the whole diff.
  await x.reviews.rerun("t", x.paseo);
  await x.reviews.idle();
  expect(x.diffs.at(-1)).toBeUndefined();
});

test("disputes: only failed findings of the latest review, kept on the card; the disputed check is judged again with the dispute (§6.1, E1)", async () => {
  let seen: LlmReviewInput | undefined;
  let round = 0;
  const llm: LlmReview = async (input) => {
    seen = input;
    round++;
    return { model: "m", verdicts: input.checks.map((c) => ({ id: c.id, verdict: round === 1 && c.id === "g1" ? ("fail" as const) : ("pass" as const), detail: round === 1 ? "No zh-TW entry." : "d", file: "src/a.ts", line: 3 })) };
  };
  const x = await setup({ entries: [command("tests", ["npm", "test"]), guideline("g1", "Rule one")], llm });
  await x.deliver("development");
  expect((await card(x)).review!.state).toBe("rework");
  await x.turnStarted();
  let ctx = await x.service.get(x.identity);
  // An id that did not fail, or a dispute without a delivery, is refused and nothing is stored.
  const bad = await x.service.write(x.identity, "status", { ...input(ctx, "Delivered"), status: "in_review", disputes: [{ id: "tests", reason: "no" }] }).catch((e) => e);
  expect(bad).toMatchObject({ code: "INVALID_INPUT" });
  expect(String(bad.message)).toContain("(g1)");
  const midWork = await x.service.write(x.identity, "status", { ...input(ctx), status: "test", disputes: [{ id: "g1", reason: "no" }] }).catch((e) => e);
  expect(midWork).toMatchObject({ code: "INVALID_INPUT" });
  expect((await card(x)).disputes).toBeUndefined();
  const before = (await card(x)).revision;
  const board = await x.deliver(undefined, { disputes: [{ id: "g1", reason: "This card does not touch UI text." }] });
  const task = board.tasks[0]!;
  // The dispute keeps the finding and the commit it failed on.
  expect(task.disputes).toEqual([
    { id: "g1", kind: "guideline", name: "Rule one", reason: "This card does not touch UI text.", round: 1, at: expect.any(String), sha: "aaaaaaaaaaaa", finding: "No zh-TW entry. (src/a.ts:3)" },
  ]);
  // Judged again, with the finding and the agent's reason; the reviewer accepts it here.
  expect(seen!.checks.find((c) => c.id === "g1")).toMatchObject({ dispute: { finding: "No zh-TW entry. (src/a.ts:3)", reason: "This card does not touch UI text.", round: 1 } });
  expect(task.review!.items.find((i) => i.id === "g1")).toMatchObject({ state: "passed", disputeReason: "This card does not touch UI text.", gating: true });
  expect(task.review).toMatchObject({ state: "passed", round: 2 });
  // The delivery's own revision bump only; the dispute itself adds none.
  expect(task.revision).toBe(before + 1);
  // A disputed finding is not "caught" when it later passes.
  expect((await x.entry("g1")).counts.caught).toBe(0);
  // Sending the same dispute again is idempotent (the reason is updated; it did not fail again, so the finding stays).
  await x.store.mutate((b) => {
    b.tasks[0]!.status = "development";
  });
  ctx = await x.service.get(x.identity);
  await x.service.write(x.identity, "status", { ...input(ctx, "Again"), status: "in_review", disputes: [{ id: "g1", reason: "Still not UI." }] });
  await x.reviews.idle();
  expect((await card(x)).disputes).toEqual([expect.objectContaining({ id: "g1", reason: "Still not UI.", round: 1, finding: "No zh-TW entry. (src/a.ts:3)" })]);
  // Done: the dispute still stands, so it counts as a misfire and is cleared (§6.6).
  await x.guardrails.finishTask("t");
  expect((await x.entry("g1")).counts.misfire).toBe(1);
  expect((await card(x)).disputes).toBeUndefined();
});

test("a disputed goal is still judged on every later delivery; failing again ends the dispute (§6.3, E1)", async () => {
  const inputs: LlmReviewInput[] = [];
  const goalVerdicts: ("pass" | "fail")[] = ["fail", "fail", "pass"];
  const llm: LlmReview = async (input) => {
    inputs.push(input);
    const verdict = goalVerdicts[inputs.length - 1]!;
    return { model: "m", verdicts: input.checks.map((c) => ({ id: c.id, verdict, detail: `Round ${inputs.length}: no Rerun button.`, quote: "Add a Rerun button" })) };
  };
  const x = await setup({ llm, maxRounds: 3, conversation: async () => ["Add a Rerun button."] });
  await x.deliver("development");
  expect((await card(x)).review).toMatchObject({ state: "rework" });
  await x.turnStarted();
  x.repo.head = "bbbbbbbbbbbb";
  let board = await x.deliver(undefined, { disputes: [{ id: "goal", reason: "The user dropped the Rerun button." }] });
  // The goal was judged again, not skipped as disputed; the reviewer saw the finding and the reason.
  expect(inputs).toHaveLength(2);
  expect(inputs[1]!.checks.map((c) => c.id)).toEqual(["goal"]);
  expect(inputs[1]!.checks[0]).toMatchObject({ dispute: { reason: "The user dropped the Rerun button.", round: 1, finding: "Round 1: no Rerun button." } });
  expect(reviewPrompt(inputs[1]!)).toContain('disputed: the round 1 finding was "Round 1: no Rerun button."');
  expect(reviewPrompt(inputs[1]!)).toContain("agent's reason: The user dropped the Rerun button.");
  expect(reviewPrompt(inputs[1]!)).toContain("unless you have new evidence");
  // It failed again: the review sends the card back and the dispute ends.
  expect(board.tasks[0]!.review).toMatchObject({ state: "rework", round: 2 });
  expect(board.tasks[0]!.review!.items.find((i) => i.id === "goal")).toMatchObject({ state: "failed", disputeReason: "The user dropped the Rerun button." });
  expect(board.tasks[0]!.disputes).toBeUndefined();
  // The next delivery judges the goal again, with no dispute to show.
  await x.turnStarted();
  board = await x.deliver();
  expect(inputs).toHaveLength(3);
  expect(inputs[2]!.checks.map((c) => c.id)).toEqual(["goal"]);
  expect(inputs[2]!.checks[0]!.dispute).toBeUndefined();
  expect(board.tasks[0]!.review).toMatchObject({ state: "passed", round: 3 });
});

test("a check still disputed needs a new verdict in every rework round; it does not inherit its earlier pass (§6.3 step 2, E1)", async () => {
  const inputs: LlmReviewInput[] = [];
  const llm: LlmReview = async (input) => {
    inputs.push(input);
    const n = inputs.length;
    // Round 1: goal fails. Round 2: goal passes, g1 fails. Round 3: the reviewer leaves the goal out.
    const verdicts = input.checks
      .filter((c) => !(n === 3 && c.id === "goal"))
      .map((c) => ({ id: c.id, verdict: (n === 1 && c.id === "goal") || (n === 2 && c.id === "g1") ? ("fail" as const) : ("pass" as const), detail: `Round ${n}.`, file: "src/a.ts" }));
    return { model: "m", verdicts };
  };
  // Each round's diff touches src/a.ts, so g1's round 2 fail is a regression of that round (§3.6), not demoted.
  const x = await setup({ entries: [guideline("g1", "Rule one")], llm, maxRounds: 3, diffText: () => "diff --git a/src/a.ts b/src/a.ts\n+x" });
  await mkdir(join(x.a, "src"), { recursive: true });
  await writeFile(join(x.a, "src/a.ts"), "round 1");
  await x.deliver("development");
  await x.turnStarted();
  x.repo.head = "bbbbbbbbbbbb";
  await writeFile(join(x.a, "src/a.ts"), "round 2");
  let board = await x.deliver(undefined, { disputes: [{ id: "goal", reason: "The user changed the request." }] });
  expect(board.tasks[0]!.review).toMatchObject({ state: "rework", round: 2 });
  expect(board.tasks[0]!.review!.items.find((i) => i.id === "goal")).toMatchObject({ state: "passed" });
  expect(board.tasks[0]!.disputes).toEqual([expect.objectContaining({ id: "goal" })]);
  await x.turnStarted();
  x.repo.head = "cccccccccccc";
  await writeFile(join(x.a, "src/a.ts"), "round 3");
  board = await x.deliver();
  // Round 3 is incremental and still shows the dispute; the prompt asks for a verdict on it.
  expect(inputs[2]).toMatchObject({ incremental: true });
  expect(inputs[2]!.checks.find((c) => c.id === "goal")).toMatchObject({ previous: { state: "passed" }, dispute: { reason: "The user changed the request." } });
  expect(reviewPrompt(inputs[2]!)).toContain("every disputed check needs a verdict");
  // Left out, it does not keep its round 2 pass.
  expect(board.tasks[0]!.review!.items.find((i) => i.id === "goal")).toMatchObject({ state: "unavailable", reason: "The review session gave no verdict for this check." });
  expect(board.tasks[0]!.review!.items.find((i) => i.id === "g1")).toMatchObject({ state: "passed" });
});

test("a disputed command is skipped only at the commit it failed on; new code runs and decides it again (§6.3 step 1, E1)", async () => {
  const x = await setup({ exits: { "npm test": 1 }, maxRounds: 3 });
  await x.deliver("development");
  expect((await card(x)).review).toMatchObject({ state: "rework" });
  await x.turnStarted();
  // Same commit: not run, recorded as disputed; the review session still judges the goal.
  const runs = x.runs.length;
  let board = await x.deliver(undefined, { disputes: [{ id: "tests", reason: "Fails on the machine's load, not this change." }] });
  expect(board.tasks[0]!.disputes).toEqual([expect.objectContaining({ id: "tests", sha: "aaaaaaaaaaaa", finding: "exited 1" })]);
  expect(x.runs).toHaveLength(runs);
  expect(board.tasks[0]!.review!.items.find((i) => i.id === "tests")).toMatchObject({ state: "disputed", disputeReason: "Fails on the machine's load, not this change." });
  expect(board.tasks[0]!.review!.items.find((i) => i.id === "goal")).toMatchObject({ state: "passed" });
  expect(board.tasks[0]!.review).toMatchObject({ state: "passed" });
  // New commit: it runs (and is retried once), fails, sends the card back and ends the dispute.
  await x.store.mutate((b) => {
    b.tasks[0]!.status = "development";
  });
  x.repo.head = "cccccccccccc";
  board = await x.deliver();
  expect(x.runs).toHaveLength(runs + 2);
  expect(board.tasks[0]!.review!.items.find((i) => i.id === "tests")).toMatchObject({ state: "failed", exitCode: 1 });
  expect(board.tasks[0]!.review!.state).toBe("rework");
  expect(board.tasks[0]!.disputes).toBeUndefined();
});

test("a disputed command that the user edits runs again at the same commit: the dispute was about the old command (§6.3 step 1, E1)", async () => {
  const x = await setup({ exits: { "npm test": 1 }, maxRounds: 3 });
  await x.deliver("development");
  await x.turnStarted();
  let board = await x.deliver(undefined, { disputes: [{ id: "tests", reason: "The command itself is wrong." }] });
  expect(board.tasks[0]!.disputes).toEqual([expect.objectContaining({ id: "tests", sha: "aaaaaaaaaaaa", argv: ["npm", "test"] })]);
  expect(board.tasks[0]!.review!.items.find((i) => i.id === "tests")).toMatchObject({ state: "disputed" });
  // The user fixes the command; the code did not change.
  await x.guardrails.store.update((state) => {
    state.entries.find((e) => e.id === "tests")!.argv = ["npm", "run", "test"];
    return { value: undefined, changed: true };
  });
  await x.store.mutate((b) => {
    b.tasks[0]!.status = "development";
  });
  const runs = x.runs.length;
  board = await x.deliver();
  expect(x.runs.slice(runs)).toEqual(["npm run test"]);
  expect(board.tasks[0]!.review!.items.find((i) => i.id === "tests")).toMatchObject({ state: "passed", argv: ["npm", "run", "test"] });
  expect(board.tasks[0]!.review).toMatchObject({ state: "passed" });
});

test("a command disputed from a worktree still runs when the same commit is delivered from a shared directory (§6.3 step 1)", async () => {
  const x = await setup({ exits: { "npm test": 1 }, maxRounds: 3 });
  await x.deliver("development");
  await x.turnStarted();
  let board = await x.deliver(undefined, { disputes: [{ id: "tests", reason: "Load." }] });
  expect(board.tasks[0]!.review!.items.find((i) => i.id === "tests")).toMatchObject({ state: "disputed" });
  // Same sha, now in a shared directory: the command does not decide, so the dispute does not skip it and its result shows.
  await x.store.mutate((b) => {
    b.tasks[0]!.status = "development";
  });
  x.place.shared = true;
  const runs = x.runs.length;
  board = await x.deliver();
  expect(x.runs).toHaveLength(runs + 1);
  expect(board.tasks[0]!.review!.items.find((i) => i.id === "tests")).toMatchObject({ state: "failed", gating: false, exitCode: 1 });
  expect(board.tasks[0]!.review).toMatchObject({ state: "passed", shared: true });
  // A failure that decided nothing does not end the dispute: back in the worktree at the same sha it is skipped again.
  expect(board.tasks[0]!.disputes).toEqual([expect.objectContaining({ id: "tests" })]);
});

test("in a shared directory commands run and show their result but never send the card back (§6.3 step 1, E3)", async () => {
  let seen: LlmReviewInput | undefined;
  const x = await setup({
    shared: true,
    exits: { "npm test": 1 },
    llm: async (input) => {
      seen = input;
      return passAll(input, x.paseo);
    },
  });
  const board = await x.deliver("development");
  const review = board.tasks[0]!.review!;
  expect(board.tasks[0]!.status).toBe("in_review");
  expect(review).toMatchObject({ state: "passed", shared: true });
  // Shown, not deciding, and not retried; the review session ran anyway (D9 counts only deciding commands).
  expect(review.items.find((i) => i.id === "tests")).toMatchObject({ state: "failed", gating: false, exitCode: 1 });
  expect(x.runs).toEqual(["npm test"]);
  expect(review.items.find((i) => i.id === "goal")).toMatchObject({ state: "passed" });
  expect(x.sent).toEqual([]);
  expect(seen!.commands).toEqual(["Tests: failed (ran in a shared directory; does not decide)"]);
  expect(reviewPrompt(seen!)).toContain("do not decide this review");
  // It decided nothing, so it cannot be disputed (a later delivery from a worktree at the same sha must still run it).
  await x.store.mutate((b) => {
    b.tasks[0]!.status = "development";
  });
  const ctx = await x.service.get(x.identity);
  const refused = await x.service.write(x.identity, "status", { ...input(ctx, "Delivered"), status: "in_review", disputes: [{ id: "tests", reason: "Load." }] }).catch((e) => e);
  expect(refused).toMatchObject({ code: "INVALID_INPUT" });
  expect(String(refused.message)).toContain("(it has none)");
  expect((await card(x)).disputes).toBeUndefined();
  // A shared failure that passes later was never sent back, so it is not "caught" (§6.6).
  x.exits["npm test"] = 0;
  await x.deliver();
  expect((await x.entry("tests")).counts).toMatchObject({ caught: 0, reviews: 2 });
});

test("a deciding command that fails runs once more at the same commit: a pass then is flaky, not a rework (§6.3 step 1, E3)", async () => {
  let calls = 0;
  const x = await setup({
    run: async () => (++calls === 1 ? { exitCode: 1, timedOut: false, ms: 4, output: "Timeout in vitest worker\n" } : { exitCode: 0, timedOut: false, ms: 6, output: "ok\n" }),
  });
  const board = await x.deliver("development");
  const review = board.tasks[0]!.review!;
  expect(calls).toBe(2);
  expect(review).toMatchObject({ state: "passed" });
  expect(review.items.find((i) => i.id === "tests")).toMatchObject({
    state: "passed",
    flaky: true,
    ms: 10,
    tail: "Timeout in vitest worker",
    reason: "Failed once and passed when run again at the same commit.",
  });
  expect(x.sent).toEqual([]);
  expect(board.tasks[0]!.status).toBe("in_review");
  // get_task shows it.
  const ctx = await x.service.get(x.identity);
  expect(ctx.review!.items.find((i) => i.id === "tests")).toMatchObject({ state: "passed", flaky: true });
});

test("a rerun that times out or cannot start keeps the first failure: the card goes back for rework (§6.3 step 1, E3)", async () => {
  for (const second of [
    { exitCode: null, timedOut: true, ms: 7, output: "slow\n" },
    { exitCode: null, timedOut: false, spawnError: "spawn npm ENOENT", ms: 7, output: "" },
  ]) {
    let calls = 0;
    const x = await setup({ run: async () => (++calls === 1 ? { exitCode: 1, timedOut: false, ms: 4, output: "FAIL a.test.ts\n" } : second) });
    const board = await x.deliver("development");
    expect(calls).toBe(2);
    expect(board.tasks[0]!.review).toMatchObject({ state: "rework" });
    const item = board.tasks[0]!.review!.items.find((i) => i.id === "tests")!;
    expect(item).toMatchObject({ state: "failed", exitCode: 1, ms: 11, tail: "FAIL a.test.ts" });
    expect(item.flaky).toBeUndefined();
    expect(item.timedOut).toBeUndefined();
  }
});

test("a failed command is not retried when the commit changed meanwhile (§6.3 step 1)", async () => {
  let calls = 0;
  const x = await setup({ exits: { "npm test": 1 } });
  x.setDuring(async () => {
    if (++calls === 1) x.repo.head = "dddddddddddd";
  });
  const board = await x.deliver("development");
  expect(x.runs).toEqual(["npm test"]);
  // Only the commit changed, not the content (AUTO-REVIEW-SPEC §3.6), so the first failure stands.
  expect(board.tasks[0]!.review!.state).toBe("rework");
});

test("the review reads answers given in question tools as what the user said, in time order with the messages (§4.2, E2)", async () => {
  const timelines: Record<string, { timestamp: string; item: Record<string, unknown> }[]> = {
    a1: [
      { timestamp: "2026-11-26T10:00:00.000Z", item: { type: "user_message", text: "Add a Rerun button to failed checks." } },
      {
        timestamp: "2026-11-26T10:01:00.000Z",
        item: {
          type: "tool_call",
          name: "AskUserQuestion",
          callId: "c1",
          status: "completed",
          detail: {
            input: { questions: [{ question: "Where should Rerun go?", header: "Place", options: [{ label: "Drawer" }, { label: "Card" }] }] },
            output: 'User has answered your questions: "Where should Rerun go?"="Drawer only". You can now continue.',
          },
        },
      },
      { timestamp: "2026-11-26T10:03:00.000Z", item: { type: "user_message", text: "[Flowly auto review · rework 1/2]\nfix it" } },
    ],
    a2: [{ timestamp: "2026-11-26T10:02:00.000Z", item: { type: "user_message", text: "Answers to your questions:\n\nKeep the old label?\nNo" } }],
    other: [{ timestamp: "2026-11-26T09:00:00.000Z", item: { type: "user_message", text: "Another card's message" } }],
  };
  const agents = [
    { id: "a1", workspaceId: "w" },
    { id: "a2", workspaceId: "w" },
    { id: "other", workspaceId: "elsewhere" },
  ];
  const paseo = {
    agents: {
      list: async () => ({ entries: agents.map((agent) => ({ agent })), pageInfo: {} }),
      ref: (id: string) => ({ timeline: { refetch: async () => ({ entries: timelines[id] ?? [] }) } }),
    },
  } as unknown as Parameters<typeof readConversation>[1];
  const said = await readConversation({ workspaceId: "w" }, paseo);
  expect(said).toEqual([
    "Add a Rerun button to failed checks.",
    { ask: "Where should Rerun go?", answer: "Drawer only" },
    "Answers to your questions:\n\nKeep the old label?\nNo",
  ]);
  // It reaches the review session's input and counts as a source for quoted evidence.
  let seen: LlmReviewInput | undefined;
  const x = await setup({
    conversation: async () => said,
    llm: async (input) => {
      seen = input;
      return { model: "m", verdicts: [{ id: "goal", verdict: "fail", detail: "Rerun must stay in the drawer.", quote: "Drawer only" }] };
    },
  });
  const board = await x.deliver("development");
  expect(seen!.conversation).toContainEqual({ ask: "Where should Rerun go?", answer: "Drawer only" });
  expect(reviewPrompt(seen!)).toContain('[2] Answered the agent\'s question: "Where should Rerun go?" → Drawer only');
  expect(board.tasks[0]!.review!.items.find((i) => i.id === "goal")).toMatchObject({ state: "failed", quote: "Drawer only" });
});

/**
 * A session timeline, one second per entry from 10:00:00: a string is a user message, `{ said, at }` one at that time,
 * `{ asked }` the request_user_input_async tool call of that call id.
 */
type CodexLine = string | { asked: string } | { said: string; at: string };
const codexTimeline = (lines: readonly CodexLine[]) =>
  lines.map((line, i) => ({
    timestamp: typeof line === "object" && "said" in line ? line.at : `2026-11-26T10:00:${String(i).padStart(2, "0")}.000Z`,
    item:
      typeof line === "string"
        ? { type: "user_message", text: line }
        : "said" in line
          ? { type: "user_message", text: line.said }
          : { type: "tool_call", name: "request_user_input_async", callId: line.asked, status: "completed", detail: { type: "plain_text", text: "Question" } },
  }));
/**
 * The async question hooks as Paseo calls them (§4.2 ⑤⑥): a question is asked at 09:59:00 and the timeline epoch read
 * then ("e1" unless given, `null` for a read that never finished, `at` for when it finished), and every answer is seen at
 * 10:00:05, seconds from the messages Paseo sent for them.
 */
function codexHooks() {
  let now = 0;
  const q = new AsyncQuestionTitles(() => now);
  const request = (agentId: string, callId: string, titles: string[], read: { epoch?: string | null; at?: string } = {}) => {
    now = Date.parse("2026-11-26T09:59:00.000Z");
    q.remember(agentId, { id: `permission-${callId}`, name: "request_user_input_async", kind: "question", input: { questions: titles.map((question, i) => ({ id: String(i), header: `Question ${i + 1}`, question })) } });
    if (read.at) now = Date.parse(read.at);
    if (read.epoch !== null) q.askedIn(agentId, `permission-${callId}`, read.epoch ?? "e1");
  };
  const answer = (agentId: string, callId: string, answers: string[]) => {
    now = Date.parse("2026-11-26T10:00:05.000Z");
    return q.resolved(agentId, `permission-${callId}`, { behavior: "allow", updatedInput: { answers: Object.fromEntries(answers.map((a, i) => [`Question ${i + 1}`, a])) } });
  };
  return { q, request, answer };
}

test("a Codex answers message is read as the answers of the call it was sent for, and stays whole without it, from readConversation through the quote check (§4.2, E2)", async () => {
  // Paseo keeps request_user_input_async questions and answers in the timeline only as plain text; Flowly takes the
  // titles from the permission request and the answers from the resolution of the request actually answered.
  const hooks = codexHooks();
  const q = hooks.q;
  const request = (agentId: string, callId: string, ...titles: string[]) => hooks.request(agentId, callId, titles);
  const answer = (agentId: string, callId: string, ...answers: string[]) => hooks.answer(agentId, callId, answers);
  // Two questions, then a single question with the same title as the first; the user answers the earlier call.
  request("a1", "two", "Which label?", "Should the drawer keep the old label,\nor follow the card?");
  request("a1", "one", "Which label?");
  answer("a1", "two", 'Keep "Retry" on the card.\n\nRename the drawer one to "Rerun".', "Follow the card");
  const two = 'Answers to your questions:\n\nWhich label?\nKeep "Retry" on the card.\n\nRename the drawer one to "Rerun".\n\nShould the drawer keep the old label,\nor follow the card?\nFollow the card';
  // Later the single question is answered too, with a blank line followed by exactly two lines.
  answer("a1", "one", "Keep the card as it is.\n\nIn the drawer:\nrename Retry to Rerun");
  const one = "Answers to your questions:\n\nWhich label?\nKeep the card as it is.\n\nIn the drawer:\nrename Retry to Rerun";
  const paseo = (texts: string[], agentId = "a1") =>
    ({
      agents: {
        list: async () => ({ entries: [{ agent: { id: agentId, workspaceId: "w" } }], pageInfo: {} }),
        ref: () => ({ timeline: { refetch: async () => ({ epoch: "e1", hasOlder: false, entries: codexTimeline([{ asked: "two" }, { asked: "one" }, ...texts]) }) } }),
      },
    }) as unknown as Parameters<typeof readConversation>[1];
  const read = (texts: string[], agentId?: string) => readConversation({ workspaceId: "w" }, paseo(texts, agentId), (id) => q.session(id));
  expect(await read([two, one])).toEqual([
    { ask: "Which label?", answer: 'Keep "Retry" on the card.\n\nRename the drawer one to "Rerun".' },
    // The question is context: its line break is folded like any other in the review input.
    { ask: "Should the drawer keep the old label, or follow the card?", answer: "Follow the card" },
    { ask: "Which label?", answer: "Keep the card as it is.\n\nIn the drawer:\nrename Retry to Rerun" },
  ]);
  // Without the answered call (another session, or a plugin reload since) the message stays the user's whole message.
  expect(await read([two], "a2")).toEqual([two]);
  expect(await readConversation({ workspaceId: "w" }, paseo([two]))).toEqual([two]);

  let seen: LlmReviewInput | undefined;
  const judged = async (quote: string, texts: string[], agentId?: string) => {
    const x = await setup({
      conversation: () => read(texts, agentId),
      llm: async (input) => {
        seen = input;
        return { model: "m", verdicts: [{ id: "goal", verdict: "fail", detail: "Wrong.", quote }] };
      },
    });
    return (await x.deliver("development")).tasks[0]!.review!.items.find((i) => i.id === "goal");
  };
  const none = { state: "na", reason: "no evidence" };
  // Both answers of the earlier call reach the same review session's input, each with its own question.
  await judged("Follow the card", [two]);
  expect(seen!.conversation).toEqual([
    { ask: "Which label?", answer: 'Keep "Retry" on the card.\n\nRename the drawer one to "Rerun".' },
    { ask: "Should the drawer keep the old label, or follow the card?", answer: "Follow the card" },
  ]);
  expect(reviewPrompt(seen!)).toContain('Answered the agent\'s question: "Should the drawer keep the old label, or follow the card?" → Follow the card');
  // Every line of both answers is evidence; no line of the second question is.
  expect(await judged('Rename the drawer one to "Rerun"', [two])).toMatchObject({ state: "failed", quote: 'Rename the drawer one to "Rerun"' });
  expect(await judged('Keep "Retry" on the card', [two])).toMatchObject({ state: "failed", quote: 'Keep "Retry" on the card' });
  expect(await judged("Follow the card", [two])).toMatchObject({ state: "failed", quote: "Follow the card" });
  expect(await judged("Should the drawer keep the old label", [two])).toMatchObject(none);
  expect(await judged("or follow the card?", [two])).toMatchObject(none);
  expect(await judged("Which label", [two])).toMatchObject(none);
  expect(await judged("In the drawer:", [one])).toMatchObject({ state: "failed", quote: "In the drawer:" });
  // Without it nothing the user wrote is lost: the whole message is a quote source.
  expect(await judged("Follow the card", [two], "a2")).toMatchObject({ state: "failed", quote: "Follow the card" });
});

test("two answered Codex calls that build the same message text are paired with their messages in order only when certain, otherwise kept whole (§4.2, E2)", async () => {
  // Call A asks two questions; call B later asks one with A's first title, and its multi-line answer reads like A's
  // whole answer, so both answers messages are the same text.
  const hooks = codexHooks();
  const q = hooks.q;
  const request = (callId: string, ...titles: string[]) => hooks.request("a1", callId, titles);
  const answer = (callId: string, ...answers: string[]) => hooks.answer("a1", callId, answers);
  request("A", "Which label?", "Where?");
  request("B", "Which label?");
  answer("A", "Rerun", "Drawer only");
  answer("B", "Rerun\n\nWhere?\nDrawer only");
  const same = "Answers to your questions:\n\nWhich label?\nRerun\n\nWhere?\nDrawer only";
  expect(q.answers("a1").map((a) => a.message)).toEqual([same, same]);
  // `hasOlder` false: the read holds the whole timeline; true: older entries lie before the window; "missing": Paseo
  // left it out, which may also mean older entries.
  // `epoch`: the timeline's now; the hooks read "e1" when each question is asked, and a rewind since gives a new one.
  const paseo = (lines: CodexLine[], hasOlder: boolean | "missing", epoch: string) =>
    ({
      agents: {
        list: async () => ({ entries: [{ agent: { id: "a1", workspaceId: "w" } }], pageInfo: {} }),
        ref: () => ({ timeline: { refetch: async () => ({ epoch, ...(hasOlder === "missing" ? {} : { hasOlder }), entries: codexTimeline(lines) }) } }),
      },
    }) as unknown as Parameters<typeof readConversation>[1];
  const read = (lines: CodexLine[], hasOlder: boolean | "missing" = false, epoch = "e1", held: AsyncQuestionTitles = q) =>
    readConversation({ workspaceId: "w" }, paseo(lines, hasOlder, epoch), (id) => held.session(id));
  const a = [
    { ask: "Which label?", answer: "Rerun" },
    { ask: "Where?", answer: "Drawer only" },
  ];
  const b = { ask: "Which label?", answer: "Rerun\n\nWhere?\nDrawer only" };
  // The earlier message is A's two answers, the later one B's single answer.
  expect(await read([{ asked: "A" }, same, { asked: "B" }, "Thanks", same])).toEqual([...a, "Thanks", b]);
  // The session was rewound to before B: B's call and message are gone from the whole timeline, though the hooks
  // recorded B's answer. The message left is A's, both answers kept.
  expect(await read([{ asked: "A" }, same])).toEqual(a);
  expect(await read([{ asked: "A" }, same, "Thanks"])).toEqual([...a, "Thanks"]);
  // A rewind that removed B's answer but kept its question: two calls, one message, not certain whose; it stays whole.
  expect(await read([{ asked: "A" }, { asked: "B" }, same])).toEqual([same]);
  // The read window cut off A's question and kept both answers: A may sit before the window, so neither is paired.
  expect(await read([{ asked: "B" }, same, same], true)).toEqual([same, same]);
  expect(await read([{ asked: "B" }, "Thanks", same], true)).toEqual(["Thanks", same]);
  // A message whose call is in no timeline read stays the user's whole message.
  expect(await read([same])).toEqual([same]);
  expect(await read([same], true)).toEqual([same]);
  // A page without `hasOlder` may have older entries; with no start cursor to page back from, nothing is paired.
  expect(await read([{ asked: "A" }, same], "missing")).toEqual([same]);
  // Only the exact text Paseo sends is paired: a trailing line break makes it the user's own message (the review input
  // trims it like any message).
  expect(await read([{ asked: "A" }, `${same}\n`])).toEqual([same]);
  // A rewind kept A's question and removed its answer, and the user sent the same text again in a new turn 30 seconds
  // after the answer: the rewind gave the timeline a new epoch, so the source is not certain and it stays whole.
  expect(await read([{ asked: "A" }, { said: same, at: "2026-11-26T10:00:35.000Z" }], false, "e2")).toEqual([same]);
  expect(await read([{ asked: "A" }, same], false, "e2")).toEqual([same]);
  // A page without an epoch is not certain either.
  expect(await read([{ asked: "A" }, same], false, "")).toEqual([same]);
  // The epoch is the one read when A was asked, never one read after the answer, which a rewind may already have
  // replaced. A read that had not finished by the answer, or finished only after the message, proves nothing.
  const late = codexHooks();
  late.request("a1", "A", ["Which label?", "Where?"], { epoch: null });
  late.answer("a1", "A", ["Rerun", "Drawer only"]);
  late.q.askedIn("a1", "permission-A", "e1");
  expect(await read([{ asked: "A" }, same], false, "e1", late.q)).toEqual([same]);
  const slow = codexHooks();
  slow.request("a1", "A", ["Which label?", "Where?"], { at: "2026-11-26T10:00:03.000Z" });
  slow.answer("a1", "A", ["Rerun", "Drawer only"]);
  expect(await read([{ asked: "A" }, same], false, "e1", slow.q)).toEqual([same]);
  expect(await read([{ asked: "A" }, "Thanks", "Thanks", "Thanks", same], false, "e1", slow.q)).toEqual(["Thanks", "Thanks", "Thanks", ...a]);
  // Typed again 20 minutes later: not A's answers message.
  const retyped = { said: same, at: "2026-11-26T10:20:00.000Z" };
  expect(await read([{ asked: "A" }, retyped])).toEqual([same]);
  // A's answer kept and B's removed, then retyped: B's message is far from B's answer, so neither text is paired.
  expect(await read([{ asked: "A" }, same, { asked: "B" }, retyped])).toEqual([same, same]);
  // Paseo may record the message shortly before the hook sees the answer (a steered turn) or after it (a new turn):
  // within a minute either way it is paired; 61 seconds or an unreadable time is not.
  expect(await read([{ asked: "A" }, { said: same, at: "2026-11-26T09:59:40.000Z" }])).toEqual(a);
  expect(await read([{ asked: "A" }, { said: same, at: "2026-11-26T10:01:05.000Z" }])).toEqual(a);
  expect(await read([{ asked: "A" }, { said: same, at: "2026-11-26T10:01:06.000Z" }])).toEqual([same]);
  expect(await read([{ asked: "A" }, { said: same, at: "" }])).toEqual([same]);

  let seen: LlmReviewInput | undefined;
  const judged = async (quote: string, lines: CodexLine[] = [{ asked: "A" }, same, { asked: "B" }, same]) => {
    const x = await setup({
      conversation: () => read(lines),
      llm: async (input) => {
        seen = input;
        return { model: "m", verdicts: [{ id: "goal", verdict: "fail", detail: "Wrong.", quote }] };
      },
    });
    return (await x.deliver("development")).tasks[0]!.review!.items.find((i) => i.id === "goal");
  };
  expect(await judged("Drawer only")).toMatchObject({ state: "failed", quote: "Drawer only" });
  expect(seen!.conversation).toEqual([...a, b]);
  // A's titles are questions; only B's answer, which the user typed, contains "Where?" as their own words.
  expect(await judged("Which label")).toMatchObject({ state: "na", reason: "no evidence" });
  // After the rewind A's message is not read as B's answer: A's second title is a question, not the user's words.
  const rewound: CodexLine[] = [{ asked: "A" }, same];
  expect(await judged("Drawer only", rewound)).toMatchObject({ state: "failed", quote: "Drawer only" });
  expect(seen!.conversation).toEqual(a);
  expect(await judged("Where?", rewound)).toMatchObject({ state: "na", reason: "no evidence" });
  expect(await judged("Which label", rewound)).toMatchObject({ state: "na", reason: "no evidence" });
  // When the pairing is not certain the message is never read as B's single answer; it reaches the review whole.
  for (const [lines, hasOlder] of [
    [[{ asked: "A" }, { asked: "B" }, same], false],
    [[{ asked: "B" }, same, same], true],
  ] as const) {
    seen = undefined;
    const x = await setup({
      conversation: () => read([...lines], hasOlder),
      llm: async (input) => {
        seen = input;
        return { model: "m", verdicts: [{ id: "goal", verdict: "fail", detail: "Wrong.", quote: "Drawer only" }] };
      },
    });
    await x.deliver("development");
    expect(seen!.conversation).not.toContainEqual(b);
    expect((seen!.conversation ?? []).every((entry) => entry === same)).toBe(true);
    expect(seen!.conversation?.length).toBeGreaterThan(0);
  }
});

test("a Codex answers message whose owner is not certain (a call from before a plugin reload, a message older than the call, a start out of reach) stays whole; a partial read pages back to the start (§4.2, E2)", async () => {
  const same = "Answers to your questions:\n\nWhich label?\nRerun\n\nWhere?\nDrawer only";
  const a = [
    { ask: "Which label?", answer: "Rerun" },
    { ask: "Where?", answer: "Drawer only" },
  ];
  const b = { ask: "Which label?", answer: "Rerun\n\nWhere?\nDrawer only" };
  const questions = (...calls: [string, string[], string[]][]) => {
    const hooks = codexHooks();
    for (const [callId, titles] of calls) hooks.request("a1", callId, titles);
    for (const [callId, , answers] of calls) hooks.answer("a1", callId, answers);
    return hooks.q;
  };
  const A: [string, string[], string[]] = ["A", ["Which label?", "Where?"], ["Rerun", "Drawer only"]];
  const B: [string, string[], string[]] = ["B", ["Which label?"], ["Rerun\n\nWhere?\nDrawer only"]];
  type Line = string | { asked: string };
  // `pages`: the timeline from its start, one page per element; the review reads the last one first and pages back.
  const read = async (q: AsyncQuestionTitles, pages: Line[][], options: { epochChange?: boolean } = {}) => {
    const all = codexTimeline(pages.flat());
    const ranges: [number, number][] = [];
    let from = 0;
    for (const page of pages) {
      ranges.push([from, from + page.length]);
      from += page.length;
    }
    const pageAt = (n: number) => ({
      epoch: options.epochChange && n < pages.length - 1 ? "e2" : "e1",
      hasOlder: n > 0,
      startCursor: n > 0 ? { epoch: "e1", seq: n } : null,
      entries: all.slice(ranges[n]![0], ranges[n]![1]),
    });
    const calls: unknown[] = [];
    const paseo = {
      agents: {
        list: async () => ({ entries: [{ agent: { id: "a1", workspaceId: "w" } }], pageInfo: {} }),
        ref: () => ({
          timeline: {
            refetch: async (o: { direction: string; cursor?: { seq: number } }) => {
              calls.push(o);
              return o.direction === "before" ? pageAt(o.cursor!.seq - 1) : pageAt(pages.length - 1);
            },
          },
        }),
      },
    } as unknown as Parameters<typeof readConversation>[1];
    return { said: await readConversation({ workspaceId: "w" }, paseo, (id) => q.session(id)), reads: calls.length };
  };

  // A was answered before a plugin reload, so the hooks know only B; a rewind then removed B's answer and kept its question.
  const onlyB = questions(B);
  expect((await read(onlyB, [[{ asked: "A" }, same, { asked: "B" }]])).said).toEqual([same]);
  // The message comes after B's question but A, asked before it and unknown to the hooks, may have sent it.
  expect((await read(onlyB, [[{ asked: "A" }, { asked: "B" }, same]])).said).toEqual([same]);
  // With both calls known, the same timeline is certain.
  const both = questions(A, B);
  expect((await read(both, [[{ asked: "A" }, same, { asked: "B" }, same]])).said).toEqual([...a, b]);
  // A message older than the only call that built its text is not that call's.
  expect((await read(both, [[same, { asked: "A" }, { asked: "B" }, same]])).said).toEqual([same, same]);
  // A dismissed call is known: it sent nothing, so it does not block the answers after it.
  const withDismissed = questions(A);
  withDismissed.remember("a1", { id: "permission-D", name: "request_user_input_async", kind: "question", input: { questions: [{ id: "0", header: "Question 1", question: "Skip?" }] } });
  withDismissed.resolved("a1", "permission-D", { behavior: "deny" });
  expect((await read(withDismissed, [[{ asked: "D" }, { asked: "A" }, same]])).said).toEqual(a);

  // A partial read pages back to the session's start to see every question call first.
  const paged = await read(both, [[{ asked: "A" }], [same, { asked: "B" }], ["Thanks", same]]);
  expect(paged.said).toEqual(["Thanks", b]);
  expect(paged.reads).toBe(3);
  // The window cut off A's question and kept both answers: read back to A, both are paired.
  expect((await read(both, [[{ asked: "A" }, { asked: "B" }], [same, same]])).said).toEqual([...a, b]);
  // Before the reload: paging back finds A, unknown to the hooks, so the message stays whole.
  expect((await read(onlyB, [[{ asked: "A" }, same], [{ asked: "B" }, "Thanks", same]])).said).toEqual(["Thanks", same]);
  // The timeline changed while paging back: nothing is paired.
  expect((await read(both, [[{ asked: "A" }, { asked: "B" }], [same, same]], { epochChange: true })).said).toEqual([same, same]);
  // No answers message to pair: the review does not page back.
  expect((await read(both, [[{ asked: "A" }], ["Thanks"]])).reads).toBe(1);
  // Paging back reads at most `pairingHistoryLimit` entries before the tail page, entries without an item included, and
  // never asks for more than is left; reaching the start at exactly the limit still pairs.
  const far = async (older: number) => {
    const [askA, message] = codexTimeline([{ asked: "A" }, same]);
    const all = [askA!, ...Array.from({ length: older - 1 }, () => ({})), message!];
    const limits: number[] = [];
    const page = (end: number, limit: number) => {
      const start = Math.max(0, end - limit);
      return { epoch: "e1", hasOlder: start > 0, startCursor: start > 0 ? { epoch: "e1", seq: start } : null, entries: all.slice(start, end) };
    };
    const paseo = {
      agents: {
        list: async () => ({ entries: [{ agent: { id: "a1", workspaceId: "w" } }], pageInfo: {} }),
        ref: () => ({
          timeline: {
            refetch: async (o: { direction: string; limit: number; cursor?: { seq: number } }) => {
              if (o.direction !== "before") return page(all.length, 1);
              limits.push(o.limit);
              return page(o.cursor!.seq, o.limit);
            },
          },
        }),
      },
    } as unknown as Parameters<typeof readConversation>[1];
    return { said: await readConversation({ workspaceId: "w" }, paseo, (id) => both.session(id)), asked: limits.reduce((n, l) => n + l, 0) };
  };
  expect(await far(pairingHistoryLimit)).toEqual({ said: a, asked: pairingHistoryLimit });
  expect(await far(pairingHistoryLimit + 1)).toEqual({ said: [same], asked: pairingHistoryLimit });

  // The reviewer's input never holds B's single answer for A's message, and A's second title is not B's answer.
  let seen: LlmReviewInput | undefined;
  const x = await setup({
    conversation: async () => (await read(onlyB, [[{ asked: "A" }, same, { asked: "B" }]])).said,
    llm: async (input) => {
      seen = input;
      return { model: "m", verdicts: [{ id: "goal", verdict: "fail", detail: "Wrong.", quote: "Drawer only" }] };
    },
  });
  await x.deliver("development");
  expect(seen!.conversation).toEqual([same]);
});

test("only the user's answer in a question tool counts as quoted evidence, not the agent's question (§4.2, B1)", async () => {
  let said: ConversationEntry[] = [{ ask: "Should I add a rerun button?", answer: "No" }];
  const run = async (quote: string) => {
    const x = await setup({ conversation: async () => said, llm: async () => ({ model: "m", verdicts: [{ id: "goal", verdict: "fail", detail: "Wrong.", quote }] }) });
    return (await x.deliver("development")).tasks[0]!.review!.items.find((i) => i.id === "goal");
  };
  expect(await run("add a rerun button")).toMatchObject({ state: "na", reason: "no evidence" });
  expect(await run("No")).toMatchObject({ state: "failed", quote: "No" });
  // An answer with an arrow in it is quoted whole: any part of it is evidence, the question never is.
  said = [{ ask: "What should the button say?", answer: 'Rename "Retry" → "Rerun" in the drawer' }];
  expect(await run('Rename "Retry"')).toMatchObject({ state: "failed", quote: 'Rename "Retry"' });
  expect(await run('"Rerun" in the drawer')).toMatchObject({ state: "failed" });
  expect(await run("What should the button say")).toMatchObject({ state: "na", reason: "no evidence" });
});

test("signals at review end: reviews and passes counted; two misfires in 30 days pause a guideline with an event (§6.6, §6.7)", async () => {
  const recent = new Date(Date.now() - 86_400_000).toISOString();
  const x = await setup({ entries: [guideline("g1", "Rule one", { counts: { ...emptyCounts(), misfire: 2, misfireAt: [recent, recent] } }), guideline("g2", "Rule two")] });
  const board = await x.deliver("development");
  expect(board.tasks[0]!.review!.state).toBe("passed");
  expect(await x.entry("g1")).toMatchObject({ state: "paused", stateReason: "misfired twice in 30 days", counts: { reviews: 1, passes: 1 } });
  expect(await x.entry("g2")).toMatchObject({ state: "active", counts: { reviews: 1, passes: 1, caught: 0 } });
  const events = (await x.store.read()).events.filter((e) => e.action === "guardrail_retired");
  expect(events.map((e) => [e.taskId, e.guardrail])).toEqual([["t", { change: "paused", kind: "guideline", id: "g1" }]]);
  // A cancelled review judged nothing and counts nothing.
  const y = await setup({ entries: [command("tests", ["npm", "test"]), guideline("g3", "Rule three")] });
  y.setDuring(async () => {
    await y.store.mutate((b) => {
      b.workpads[0]!.revision++;
    });
  });
  expect((await y.deliver("development")).tasks[0]!.review!.state).toBe("cancelled");
  expect((await y.entry("g3")).counts.reviews).toBe(0);
  expect((await y.entry("tests")).counts.reviews).toBe(0);
});

test("a check the review session left out is unavailable; with the rest passing the review is Unavailable, no rework", async () => {
  const x = await setup({ entries: [guideline("g1", "Rule one")], llm: async () => ({ model: "m", verdicts: [{ id: "goal", verdict: "pass", detail: "Fine." }] }) });
  const board = await x.deliver("development");
  expect(board.tasks[0]).toMatchObject({ status: "in_review", review: { state: "unavailable", round: 1 } });
  expect(board.tasks[0]!.review!.items.map((r) => r.state)).toEqual(["passed", "unavailable"]);
  expect(x.sent).toEqual([]);
  // A failing review session makes every judged check unavailable.
  const y = await setup({ llm: async () => { throw new Error("model down"); } });
  const after = await y.deliver("development");
  expect(after.tasks[0]!.review!.items[1]).toMatchObject({ state: "unavailable", reason: "The review session failed: model down" });
});

test("the delivery's shape from git --numstat: files, changed lines (binary 0), size band, renames (§6.2)", () => {
  const { shape, paths } = numstatShape("3\t2\tsrc/a.ts\n-\t-\tlogo.png\n", "40\t10\tsrc/{old => new}/b.ts\n1\t0\tsrc/a.ts\n");
  expect(shape).toEqual({ files: 3, lines: 56, size: "m" });
  expect([...paths].sort()).toEqual(["logo.png", "src/a.ts", "src/new/b.ts"]);
  expect(numstatShape("").shape).toEqual({ files: 0, lines: 0, size: "s" });
  expect([...numstatShape('1\t0\t"\\350\\257\\264\\346\\230\\216.ts"\n').paths]).toEqual(["说明.ts"]);
  // A name that itself starts and ends with quotes is decoded once, keeping them.
  expect([...numstatShape('1\t0\t"\\"\\350\\257\\264\\346\\230\\216.ts\\""\n').paths]).toEqual(['"说明.ts"']);
  expect(numstatShape("500\t1\tbig.ts").shape.size).toBe("l");
  expect(repoPath("/w", "./src/a.ts")).toBe("src/a.ts");
  expect(repoPath("/w", "/w/src/a.ts")).toBe("src/a.ts");
  expect(repoPath("/w", "../x.ts")).toBeNull();
  expect(repoPath("/w", "/etc/passwd")).toBeNull();
});

test("a worktree card's base ref reaches the shape and the review diff (§6.2)", async () => {
  const x = await setup({ baseRef: "refs/heads/main" });
  await x.deliver("development");
  expect(x.bases).toEqual(["refs/heads/main", "refs/heads/main"]);
});

/** A fake git that records each call's argv; `answers` maps an argv to its output, an Error to throw, or a `git diff --no-index` exit 1. */
function recordingGit(answers: Record<string, string | Error | { exit1: string }>) {
  const calls: string[] = [];
  const git: Git = async (_cwd, args) => {
    const key = args.join(" ");
    calls.push(key);
    const answer = answers[key] ?? "";
    if (answer instanceof Error) throw answer;
    if (typeof answer === "object") throw Object.assign(new Error("exit 1"), { code: 1, stdout: answer.exit1 });
    return answer;
  };
  return { git, calls };
}
const base = "0123456789abcdef0123456789abcdef01234567";
const untracked = "ls-files --others --exclude-standard -z";

test("shape: a worktree card counts its own change since the merge-base plus untracked files, text by lines and binary 0 (§6.2)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "flowly-shape-"));
  roots.push(dir);
  await writeFile(join(dir, "fixture.txt"), Array.from({ length: 450 }, (_, i) => `line ${i}`).join("\n"));
  await writeFile(join(dir, "logo.png"), Buffer.from([0x89, 0x50, 0x00, 0x4e, 0x0a]));
  // Over 1 MiB: one file, 0 lines, not read.
  await writeFile(join(dir, "dump.log"), "x\n".repeat(600_000));
  const { git, calls } = recordingGit({
    "merge-base refs/heads/main HEAD": `${base}\n`,
    [`diff ${base} --numstat`]: "3\t2\tsrc/a.ts\n",
    [untracked]: "fixture.txt\0logo.png\0dump.log\0",
  });
  const measured = await reviewShape(dir, "refs/heads/main", git);
  expect(calls).toEqual(["merge-base refs/heads/main HEAD", `diff ${base} --numstat`, untracked]);
  expect(measured!.shape).toEqual({ files: 4, lines: 455, size: "l" });
  expect([...measured!.paths].sort()).toEqual(["dump.log", "fixture.txt", "logo.png", "src/a.ts"]);
});

test("shape: a directory card, or a base ref git cannot resolve, keeps git diff HEAD plus the last five commits, with untracked files (§6.2)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "flowly-shape-"));
  roots.push(dir);
  await writeFile(join(dir, "new.ts"), "a\nb\n");
  const answers = { "diff HEAD --numstat": "1\t1\tsrc/a.ts\n", "log -5 --numstat --format=": "10\t0\tsrc/b.ts\n", [untracked]: "new.ts\0" };
  const directory = recordingGit(answers);
  expect((await reviewShape(dir, undefined, directory.git))!.shape).toEqual({ files: 3, lines: 14, size: "s" });
  expect(directory.calls).toEqual(["diff HEAD --numstat", "log -5 --numstat --format=", untracked]);
  const failed = recordingGit({ ...answers, "merge-base gone HEAD": new Error("fatal: Not a valid object name gone") });
  expect((await reviewShape(dir, "gone", failed.git))!.shape).toEqual({ files: 3, lines: 14, size: "s" });
  expect(failed.calls).toEqual(["merge-base gone HEAD", "diff HEAD --numstat", "log -5 --numstat --format=", untracked]);
});

test("review diff: the card's branch since the merge-base, then untracked files under their own heading; round 2 adds them too (§6.3)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "flowly-diff-"));
  roots.push(dir);
  await mkdir(join(dir, "docs"));
  await writeFile(join(dir, "docs/new.md"), "hello\n");
  await writeFile(join(dir, "dump.log"), "x".repeat((1 << 20) + 1));
  const answers = {
    "merge-base main HEAD": `${base}\n`,
    [`diff ${base} --no-color`]: "diff --git a/src/a.ts b/src/a.ts\n",
    "diff aaaaaaaaaaaa --no-color": "diff --git a/src/c.ts b/src/c.ts\n",
    [untracked]: "docs/new.md\0dump.log\0",
    "diff --no-index --no-color -- /dev/null docs/new.md": { exit1: "diff --git a/docs/new.md b/docs/new.md\n+hello\n" },
  };
  const worktree = recordingGit(answers);
  const text = await reviewDiff(dir, { baseRef: "main" }, worktree.git);
  expect(worktree.calls).toEqual(["merge-base main HEAD", `diff ${base} --no-color`, untracked, "diff --no-index --no-color -- /dev/null docs/new.md"]);
  expect(text).toContain(`# Changes on this card's branch (git diff ${base})\ndiff --git a/src/a.ts`);
  expect(text).toContain("# New files (untracked)\ndiff --git a/docs/new.md b/docs/new.md\n+hello");
  expect(text).not.toContain("# Recent commits");
  // Over 1 MiB: named, never diffed.
  expect(text).toContain("new file dump.log (over 1 MiB or unreadable, not shown)");
  const round2 = recordingGit(answers);
  const later = await reviewDiff(dir, { since: "aaaaaaaaaaaa", baseRef: "main" }, round2.git);
  expect(round2.calls).toEqual(["diff aaaaaaaaaaaa --no-color", untracked, "diff --no-index --no-color -- /dev/null docs/new.md"]);
  expect(later).toContain("# New files (untracked)\ndiff --git a/docs/new.md");
  // A directory card: uncommitted changes and the last five commits, then the new files.
  const directory = recordingGit(answers);
  expect(await reviewDiff(dir, {}, directory.git)).toContain("# Recent commits\n\n# New files (untracked)\ndiff --git a/docs/new.md");
  expect(directory.calls.slice(0, 3)).toEqual(["diff HEAD --no-color", "log -5 -p --no-color --format=commit %h %s", untracked]);
});

/** Two Git repositories behind symlinks in a plain folder, like a linked root (PROJECT-PICKER-SPEC), each with one commit. */
async function linkedRoot() {
  const base = await mkdtemp(join(tmpdir(), "flowly-linked-"));
  roots.push(base);
  const git = (cwd: string, ...args: string[]) => defaultGit(cwd, ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...args]);
  for (const name of ["admin", "smith"]) {
    const repo = join(base, "repos", name);
    await mkdir(join(repo, "src"), { recursive: true });
    await git(repo, "init", "-q", "-b", "main");
    await writeFile(join(repo, "src/app.ts"), "export const a = 1;\n");
    await writeFile(join(repo, "package.json"), JSON.stringify({ scripts: name === "smith" ? { test: "vitest", typecheck: "tsc" } : { test: "jest" } }));
    await git(repo, "add", ".");
    await git(repo, "commit", "-q", "-m", "init");
  }
  const root = join(base, "root");
  await mkdir(root);
  await symlink(join(base, "repos/admin"), join(root, "Admin"), "dir");
  await symlink(join(base, "repos/smith"), join(root, "SMITH"), "dir");
  await mkdir(join(root, "notes"));
  await mkdir(join(root, ".hidden"));
  return { base, root, git };
}

test("linked root: the repositories behind its links, then each one's change with its paths under the link's name (§6.2)", async () => {
  const { root, base } = await linkedRoot();
  const repos = await linkedRepos(root);
  expect(repos).toEqual([
    { name: "Admin", directory: join(root, "Admin") },
    { name: "SMITH", directory: join(root, "SMITH") },
  ]);
  // A Git repository itself is not a linked root's child list; a folder without .git is skipped.
  expect(await readHeadOf(root)).toBeNull();
  await writeFile(join(base, "repos/smith/src/app.ts"), "export const a = 2;\nexport const b = 3;\n");
  await writeFile(join(base, "repos/smith/src/new.ts"), "x\ny\n");
  const shape = await linkedShape(repos);
  // Both repositories' last commits count, as for any directory card (D6), plus SMITH's edit and new file.
  expect(shape!.paths).toEqual(new Set(["Admin/package.json", "Admin/src/app.ts", "SMITH/package.json", "SMITH/src/app.ts", "SMITH/src/new.ts"]));
  expect(shape!.shape.files).toBe(5);
  expect(shape!.shape.lines).toBeGreaterThan(0);
  const diff = await linkedReviewDiff(repos);
  expect(diff).toContain("## Repository Admin (its paths start with Admin/)");
  expect(diff).toContain("## Repository SMITH (its paths start with SMITH/)");
  expect(diff).toContain("diff --git a/SMITH/src/app.ts b/SMITH/src/app.ts");
  expect(diff).toContain("+export const b = 3;");
  expect(diff).toContain("+++ b/SMITH/src/new.ts");
  expect(diff).not.toMatch(/a\/src\/app\.ts/);
  // Round 2: each repository since its own previous commit; a new commit in one changes the digest.
  const first = await linkedHead(repos, defaultGit);
  expect(Object.keys(first.repos)).toEqual(["Admin", "SMITH"]);
  expect(first.head).toMatchObject({ dirty: true });
  expect(first.head!.sha).toMatch(/^[0-9a-f]{12}$/);
  await writeFile(join(base, "repos/admin/src/app.ts"), "export const a = 9;\n");
  const later = await linkedReviewDiff(repos, { since: first.repos });
  expect(later).toContain(`# Changes since the previous delivery (git diff ${first.repos.Admin})`);
  expect(later).toContain("diff --git a/Admin/src/app.ts b/Admin/src/app.ts");
}, 20_000);
const readHeadOf = async (dir: string) => (await linkedHead([{ name: "root", directory: dir }], defaultGit)).head;

test("linked root: a command runs where its script is, and applies nowhere else (§6.3)", async () => {
  const { root } = await linkedRoot();
  expect(await commandApplies(["npm", "run", "typecheck"], join(root, "SMITH"))).toBe(true);
  expect(await commandApplies(["npm", "run", "typecheck"], join(root, "Admin"))).toBe(false);
  expect(await commandApplies(["npm", "test"], join(root, "Admin"))).toBe(true);
  expect(await commandApplies(["npm", "ci"], join(root, "Admin"))).toBe(true);
  expect(await commandApplies(["npm", "test"], join(root, "notes"))).toBe(false);
  expect(await commandApplies(["make", "check"], join(root, "SMITH"))).toBe(false);
  expect(await commandApplies(["go", "test", "./..."], join(root, "SMITH"))).toBe(false);
  expect(await commandApplies(["./scripts/check.sh"], join(root, "SMITH"))).toBe(true);
  await writeFile(join(root, "SMITH", "Makefile"), "build:\n\ttrue\ncheck: build ## all\n\ttrue\n");
  expect(await commandApplies(["make", "check"], join(root, "SMITH"))).toBe(true);
  expect(await commandApplies(["make", "-j", "4", "lint"], join(root, "SMITH"))).toBe(false);
}, 20_000);

test("linked root review: shape from both repositories, commands per repository, any failure fails, a cited file under a link counts (§6.2, §6.3)", async () => {
  const { root, base } = await linkedRoot();
  await writeFile(join(base, "repos/smith/src/app.ts"), "export const a = 2;\n");
  const seen: LlmReviewInput[] = [];
  const cwds: string[] = [];
  const x = await setup({
    directory: root,
    run: async (argv, cwd) => (cwds.push(`${argv.join(" ")} @ ${cwd.split("/").pop()}`), { exitCode: 0, timedOut: false, ms: 2, output: "" }),
    git: defaultGit,
    entries: [command("tests", ["npm", "test"]), command("types", ["npm", "run", "typecheck"]), command("make", ["make", "check"])],
    exists: async (path) => existsSync(path),
    llm: async (input) => {
      seen.push(input);
      return { model: "claude/haiku", verdicts: [{ id: "goal", verdict: "fail", detail: "Still returns 1 in Admin.", file: "Admin/src/app.ts", line: 1 }] };
    },
  });
  const board = await x.deliver("development");
  const review = board.tasks[0]!.review!;
  // Admin is untouched (its only commit predates the card): only SMITH runs the commands.
  expect(cwds).toEqual(["npm test @ SMITH", "npm run typecheck @ SMITH"]);
  expect(review.items.find((i) => i.id === "tests")).toMatchObject({ state: "passed", ms: 2, detail: "Ran in SMITH." });
  expect(review.items.find((i) => i.id === "make")).toMatchObject({ state: "skipped", reason: "No repository this delivery changed has this command." });
  expect(review.shape!.files).toBeGreaterThan(0);
  expect(review.fingerprint.repos).toEqual({ Admin: expect.stringMatching(/^[0-9a-f]{12}$/), SMITH: expect.stringMatching(/^[0-9a-f]{12}$/) });
  expect(seen[0]!.diff).toContain("diff --git a/SMITH/src/app.ts b/SMITH/src/app.ts");
  // The finding cites a file in a linked repository: evidence, so it fails and the rework message names it.
  expect(review.items.find((i) => i.id === "goal")).toMatchObject({ state: "failed", file: "Admin/src/app.ts" });
  expect(x.sent.at(-1)!.text).toContain("Admin/src/app.ts:1");
}, 20_000);

test("linked root rework: a repository linked after the previous review counts in full as this round's change, even past its diff share (§3.6)", async () => {
  const { root, base, git } = await linkedRoot();
  await writeFile(join(base, "repos/smith/src/app.ts"), "export const a = 2;\n");
  let round = 0;
  const seen: LlmReviewInput[] = [];
  const x = await setup({
    directory: root,
    run: async () => ({ exitCode: 0, timedOut: false, ms: 1, output: "" }),
    git: defaultGit,
    entries: [],
    maxRounds: 3,
    exists: async (path) => existsSync(path),
    llm: async (input) => {
      seen.push(input);
      round++;
      if (round === 1) return { model: "m", verdicts: [{ id: "goal", verdict: "fail", severity: "major", detail: "Still returns 2 in SMITH.", file: "SMITH/src/app.ts", line: 1 }] };
      return { model: "m", verdicts: [{ id: "goal", verdict: "fail", severity: "major", detail: "The new extra module never exports its handler.", file: "Extra/src/z.ts", line: 1 }] };
    },
  });
  expect((await x.deliver("development")).tasks[0]!.review).toMatchObject({ state: "rework", round: 1 });
  // A third repository is linked between the rounds; its first file is large enough to push src/z.ts out of its share.
  const extra = join(base, "repos/extra");
  await mkdir(join(extra, "src"), { recursive: true });
  await git(extra, "init", "-q", "-b", "main");
  await writeFile(join(extra, "a-big.ts"), "x\n");
  await git(extra, "add", ".");
  await git(extra, "commit", "-q", "-m", "init");
  await writeFile(join(extra, "a-big.ts"), `${"const filler = 1;\n".repeat(3000)}`);
  await writeFile(join(extra, "src/z.ts"), "export const handler = 0;\n");
  await symlink(extra, join(root, "Extra"), "dir");
  await x.turnStarted();
  const review = (await x.deliver()).tasks[0]!.review!;
  expect(seen[1]!.diff).toContain("[Extra: diff truncated]");
  expect(seen[1]!.diff).not.toContain("Extra/src/z.ts");
  expect(seen[1]!.changedThisRound).toContain("Extra/src/z.ts");
  expect(review).toMatchObject({ state: "rework", round: 2 });
  expect(review.items.find((i) => i.id === "goal")).toMatchObject({ state: "failed", severity: "major", file: "Extra/src/z.ts" });
}, 20_000);

test("linked root review: a command that fails in one repository fails, with that repository's output", async () => {
  const { root, base } = await linkedRoot();
  await writeFile(join(base, "repos/admin/src/app.ts"), "export const a = 2;\n");
  await writeFile(join(base, "repos/smith/src/app.ts"), "export const a = 2;\n");
  const x = await setup({
    directory: root,
    git: defaultGit,
    run: async (_argv, cwd) => (cwd.endsWith("SMITH") ? { exitCode: 1, timedOut: false, ms: 3, output: "FAIL smith.test.ts\n" } : { exitCode: 0, timedOut: false, ms: 2, output: "" }),
  });
  const review = (await x.deliver("development")).tasks[0]!.review!;
  // Run twice (failed, then the same commit again): the time is both runs together.
  expect(review.items.find((i) => i.id === "tests")).toMatchObject({ state: "failed", exitCode: 1, ms: 10, detail: "Ran in Admin, SMITH." });
  expect(review.items.find((i) => i.id === "tests")!.tail).toContain("[SMITH]");
  expect(review.items.find((i) => i.id === "goal")).toMatchObject({ state: "skipped" });
}, 20_000);

test("linked root: commands run only in the repositories this delivery changed, all of them when none did (§6.3)", async () => {
  const { root, base, git } = await linkedRoot();
  const repos = await linkedRepos(root);
  const since = new Date(Date.now() + 1000).toISOString();
  expect((await changedRepos(repos, since)).map((r) => r.name)).toEqual(["Admin", "SMITH"]);
  await writeFile(join(base, "repos/smith/src/new.ts"), "x\n");
  expect((await changedRepos(repos, since)).map((r) => r.name)).toEqual(["SMITH"]);
  // A commit after the card was created counts, though the tree is clean again.
  await git(join(base, "repos/smith"), "add", ".");
  await git(join(base, "repos/smith"), "commit", "-q", "-m", "work");
  expect((await changedRepos(repos, new Date(Date.now() - 60_000).toISOString())).map((r) => r.name)).toEqual(["Admin", "SMITH"]);
  expect((await changedRepos(repos, since)).map((r) => r.name)).toEqual(["Admin", "SMITH"]);
  const failing: Git = async (cwd, args) => (cwd.endsWith("Admin") ? Promise.reject(new Error("not a repo")) : defaultGit(cwd, args));
  expect((await changedRepos(repos, since, failing)).map((r) => r.name)).toEqual(["Admin"]);
}, 20_000);

test("linked root diff: a large change in one repository cannot push the others out of the 64 KiB (§6.2)", async () => {
  const { root, base } = await linkedRoot();
  await writeFile(join(base, "repos/admin/src/app.ts"), Array.from({ length: 20_000 }, (_, i) => `export const v${i} = ${i};`).join("\n"));
  await writeFile(join(base, "repos/smith/src/app.ts"), "export const a = 2;\n");
  const diff = await linkedReviewDiff(await linkedRepos(root));
  expect(diff.length).toBeLessThanOrEqual(64 * 1024 + 100);
  expect(diff).toContain("[Admin: diff truncated]");
  expect(diff).toContain("## Repository SMITH (its paths start with SMITH/)");
  expect(diff).toContain("diff --git a/SMITH/src/app.ts b/SMITH/src/app.ts");
}, 20_000);

test("a rework round lists every path changed since the previous commit, past the cut diff: NUL-separated, untracked too (§3.6)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "flowly-changed-since-"));
  try {
    const git = (...args: string[]) => defaultGit(dir, ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...args]);
    await git("init", "-q", "-b", "main");
    await writeFile(join(dir, "a.ts"), "1\n");
    await writeFile(join(dir, "说明.md"), "1\n");
    await git("add", ".");
    await git("commit", "-q", "-m", "init");
    const since = (await git("rev-parse", "HEAD")).trim();
    await writeFile(join(dir, "big.ts"), "x".repeat(200_000));
    await git("add", "big.ts");
    await git("commit", "-q", "-m", "big");
    await writeFile(join(dir, "说明.md"), "2\n");
    await writeFile(join(dir, "new file.ts"), "n\n");
    expect([...(await pathsChangedSince(dir, since))].sort()).toEqual(["big.ts", "new file.ts", "说明.md"]);
    expect([...(await pathsChangedSince(dir, since, defaultGit, "repo/"))].sort()).toEqual(["repo/big.ts", "repo/new file.ts", "repo/说明.md"]);
    // Not a commit id: nothing is listed (and nothing is run).
    expect((await pathsChangedSince(dir, "--output=x")).size).toBe(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 20_000);

/** The fixture workspace as a git repository with a worktree on `feat/wt` that changed a file, committed and not. */
async function workspaceWithWorktree(dir: string, root: string) {
  const git = (cwd: string, ...args: string[]) => defaultGit(cwd, ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...args]);
  await mkdir(dir, { recursive: true });
  await git(dir, "init", "-q", "-b", "main");
  await writeFile(join(dir, "package.json"), JSON.stringify({ scripts: { test: "vitest" } }));
  await writeFile(join(dir, "app.ts"), "export const a = 1;\n");
  await git(dir, "add", ".");
  await git(dir, "commit", "-q", "-m", "init");
  const worktree = join(root, "wt");
  await git(dir, "worktree", "add", "-q", "-b", "feat/wt", worktree);
  await writeFile(join(worktree, "feature.ts"), "export const feature = true;\n");
  await git(worktree, "add", ".");
  await git(worktree, "commit", "-q", "-m", "feature");
  await writeFile(join(worktree, "app.ts"), "export const a = 2;\n");
  // Another session's uncommitted change and a later commit on main: neither is this card's.
  await writeFile(join(dir, "other.ts"), "export const other = 1;\n");
  await git(dir, "add", "other.ts");
  await git(dir, "commit", "-q", "-m", "other card");
  await writeFile(join(dir, "app.ts"), "export const a = 99;\n");
  return { worktree: await realpath(worktree), git };
}

test("a delivery that names a worktree is reviewed there: commands, diff since the branch point, fingerprint, not shared (§3.4)", async () => {
  const seen: LlmReviewInput[] = [];
  const cwds: string[] = [];
  const x = await setup({
    real: true,
    run: async (argv, cwd) => (cwds.push(cwd), { exitCode: 0, timedOut: false, ms: 2, output: "" }),
    llm: async (input) => (seen.push(input), passAll(input, undefined as never)),
  });
  const { worktree, git } = await workspaceWithWorktree(x.a, x.root);
  const board = await x.deliver("development", { worktree: "feat/wt" });
  const delivered = board.events.findLast((e) => e.action === "status_changed" && e.to === "in_review")!;
  expect(delivered.worktree).toBe(worktree);
  const review = board.tasks[0]!.review!;
  expect(review).toMatchObject({ state: "passed", shared: false, worktree });
  expect(cwds).toEqual([worktree]);
  expect(review.fingerprint.sha).toBe((await git(worktree, "rev-parse", "--short=12", "HEAD")).trim());
  expect(review.fingerprint.dirty).toBe(true);
  const input = seen[0]!;
  expect(input.worktree).toBe(worktree);
  expect(input.shared).toBeUndefined();
  expect(input.diff).toContain("feature.ts");
  expect(input.diff).toContain("+export const a = 2;");
  expect(input.diff).not.toContain("other.ts");
  expect(input.diff).not.toContain("a = 99");
  expect(reviewPrompt(input)).toContain(`The delivered code is in the git worktree ${worktree}`);
  // Rerun keeps the worktree; once it is gone the review is unavailable instead of checking the workspace.
  await git(x.a, "worktree", "remove", "--force", worktree);
  await x.reviews.rerun("t", x.paseo);
  await x.reviews.idle();
  const again = (await card(x)).review!;
  expect(again.state).toBe("unavailable");
  expect(again.reason).toContain("The delivered worktree is unavailable");
  // Kept on the review, so a later Rerun still names it even after the delivery event is trimmed.
  expect(again.worktree).toBe(worktree);
  expect(cwds).toEqual([worktree]);
}, 20_000);

test("restart recovery keeps the waiting worktree after its delivery event is trimmed; Rerun checks that worktree", async () => {
  const cwds: string[] = [];
  const x = await setup({ real: true, run: async (_argv, cwd) => (cwds.push(cwd), { exitCode: 0, timedOut: false, ms: 1, output: "" }) });
  const { worktree } = await workspaceWithWorktree(x.a, x.root);
  x.actors.actor!.status = "running";
  await x.deliver("development", { worktree: "feat/wt" });
  expect((await card(x)).reviewWaiting?.worktree).toBe(worktree);
  await x.store.mutate((b) => {
    for (let i = 0; i < 100; i++) x.store.event(b, { taskId: "t", actor: "agent", action: "progress", note: `checkpoint ${i}` });
  });
  expect((await x.store.read()).events.some((e) => e.to === "in_review")).toBe(false);
  await x.reviews.recover();
  expect((await card(x)).review).toMatchObject({ state: "unavailable", worktree });
  x.actors.actor!.status = "idle";
  await x.reviews.rerun("t", x.paseo);
  await x.reviews.idle();
  expect(cwds).toEqual([worktree]);
  expect((await card(x)).review).toMatchObject({ state: "passed", worktree, shared: false });
}, 20_000);

test("a worktree that is not this card's repository, or named outside a delivery, is refused and the card stays (§3.4)", async () => {
  const x = await setup({ real: true });
  await workspaceWithWorktree(x.a, x.root);
  const other = join(x.root, "other");
  await mkdir(other);
  await defaultGit(other, ["init", "-q"]);
  let ctx = await x.service.get(x.identity);
  await x.service.write(x.identity, "status", { ...input(ctx), status: "development" });
  ctx = await x.service.get(x.identity);
  await expect(x.service.write(x.identity, "status", { ...input(ctx, "Delivered"), status: "in_review", nextMoves: [], worktree: other })).rejects.toMatchObject({
    code: "INVALID_INPUT",
    message: expect.stringContaining("not a worktree of this card's repository"),
  });
  await expect(x.service.write(x.identity, "status", { ...input(ctx), status: "test", worktree: "feat/wt" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  expect((await card(x)).status).toBe("development");
});

/** The workspace's origin is "github.com/acme/app", served by a local bare repository that has PR 7 at the worktree's commit. */
async function withPullRequest(x: { a: string; root: string }, worktree: string, git: (cwd: string, ...args: string[]) => Promise<string>) {
  const bare = join(x.root, "remote.git");
  await defaultGit(x.root, ["init", "-q", "--bare", bare]);
  await git(x.a, "remote", "add", "origin", "https://github.com/acme/app.git");
  await git(x.a, "config", `url.${bare}.insteadOf`, "https://github.com/acme/app.git");
  await git(worktree, "push", "-q", "origin", "HEAD:refs/pull/7/head");
}

test("a delivery with this repository's PR and no worktree is reviewed in the worktree holding its head, with a notice (§3.4)", async () => {
  const seen: LlmReviewInput[] = [];
  const cwds: string[] = [];
  const x = await setup({
    real: true,
    run: async (argv, cwd) => (cwds.push(cwd), { exitCode: 0, timedOut: false, ms: 2, output: "" }),
    llm: async (input) => (seen.push(input), passAll(input, undefined as never)),
  });
  const { worktree, git } = await workspaceWithWorktree(x.a, x.root);
  await withPullRequest(x, worktree, git);
  let ctx = await x.service.get(x.identity);
  await x.service.write(x.identity, "status", { ...input(ctx), status: "development" });
  ctx = await x.service.get(x.identity);
  const result = (await x.service.write(x.identity, "status", {
    ...input(ctx, "Delivered"),
    status: "in_review",
    nextMoves: [],
    outputs: [{ target: "https://github.com/acme/app/pull/7" }],
  })) as { notice?: string };
  expect(result.notice).toContain(`The auto review will check the worktree ${worktree}, which holds the head of https://github.com/acme/app/pull/7`);
  await x.reviews.idle();
  const board = await x.store.read();
  expect(board.events.findLast((e) => e.to === "in_review")!.worktree).toBe(worktree);
  expect(board.tasks[0]!.review).toMatchObject({ state: "passed", shared: false, worktree });
  expect(cwds).toEqual([worktree]);
  expect(seen[0]!.diff).toContain("feature.ts");
}, 20_000);

test("a PR whose head is in several worktrees, or of another repository, changes nothing: the workspace is reviewed (§3.4)", async () => {
  const cwds: string[] = [];
  const x = await setup({ real: true, shared: true, run: async (argv, cwd) => (cwds.push(cwd), { exitCode: 0, timedOut: false, ms: 2, output: "" }) });
  const { worktree, git } = await workspaceWithWorktree(x.a, x.root);
  await withPullRequest(x, worktree, git);
  // Another repository's PR: nothing found.
  let board = await x.deliver("development", { outputs: [{ target: "https://github.com/acme/other/pull/7" }] });
  expect(board.events.findLast((e) => e.to === "in_review")!.worktree).toBeUndefined();
  // This repository's PR, but its head is in two worktrees: not unique, nothing found.
  await git(x.a, "worktree", "add", "-q", "--detach", join(x.root, "wt2"), "feat/wt");
  board = await x.deliver("development", { outputs: [{ target: "https://github.com/acme/app/pull/7" }] });
  expect(board.events.findLast((e) => e.to === "in_review")!.worktree).toBeUndefined();
  expect(board.tasks[0]!.review).toMatchObject({ shared: true });
  expect(board.tasks[0]!.review!.worktree).toBeUndefined();
  expect(cwds.every((c) => c === x.a)).toBe(true);
}, 20_000);


// ---- Convergence (AUTO-REVIEW-SPEC §3.6, 2026-11-26) --------------------------------------------------------------

const verdicts = (list: Awaited<ReturnType<LlmReview>>["verdicts"]): LlmReview => async (input) => ({
  model: "m",
  verdicts: input.checks.map((c) => list.find((v) => v.id === c.id) ?? { id: c.id, verdict: "pass" as const, detail: "Fine." }),
});

test("severity: a minor fail passes the review, shows on the item and counts as na for guardrails; a major one sends rework", async () => {
  const x = await setup({ entries: [guideline("g1", "Clear wording")], llm: verdicts([{ id: "g1", verdict: "fail", severity: "minor", detail: "One label could be shorter.", file: "src/a.ts" }]) });
  let board = await x.deliver("development");
  expect(board.tasks[0]).toMatchObject({ status: "in_review", review: { state: "passed" } });
  expect(board.tasks[0]!.review!.items.find((i) => i.id === "g1")).toMatchObject({ state: "failed", severity: "minor" });
  expect(board.events.filter((e) => e.action === "review_finished").at(-1)!.results!.find((r) => r.id === "g1")).toMatchObject({ state: "failed", severity: "minor" });
  const z = await setup({ llm: verdicts([{ id: "goal", verdict: "needs_user", severity: "minor", detail: "Someone could try it on a phone later." }]) });
  const minorAsk = await z.deliver("development");
  expect(minorAsk.events.filter((e) => e.action === "review_finished").at(-1)!.results!.find((r) => r.id === "goal")).toMatchObject({ state: "needs_user", severity: "minor" });
  expect(x.sent).toEqual([]);
  expect((await x.entry("g1")).counts).toMatchObject({ reviews: 1, passes: 1 });

  const y = await setup({ entries: [guideline("g1", "Clear wording")], llm: verdicts([{ id: "g1", verdict: "fail", severity: "major", detail: "Wrong text.", file: "src/a.ts" }]) });
  board = await y.deliver("development");
  expect(board.tasks[0]).toMatchObject({ status: "development", review: { state: "rework" } });
  expect(y.sent[0]!.text).toContain('✗ [major] "quote of g1" — Wrong text. (src/a.ts) [id: g1]');
});

test("needs_user: no rework, the card stays in In review, Attention says what to do; without detail it is na (§3.2, §9.4)", async () => {
  const x = await setup({ llm: verdicts([{ id: "goal", verdict: "needs_user", severity: "major", detail: "Install the build on the phone and confirm the picker opens." }]) });
  const board = await x.deliver("development");
  const task = board.tasks[0]!;
  expect(task).toMatchObject({ status: "in_review", reviewCount: 1, review: { state: "needs_user", round: 1, reason: "Does what you asked: Install the build on the phone and confirm the picker opens." } });
  expect(task.review!.items.find((i) => i.id === "goal")).toMatchObject({ state: "needs_user", severity: "major" });
  expect(x.sent).toEqual([]);
  expect(board.events.filter((e) => e.rule === "R1" || e.rule === "R2")).toEqual([]);
  expect(attentionItems(board, [] as never, [], false)[0]).toMatchObject({ review: "needs_user" });
  // The delivering turn's end, recorded after the review finished, keeps it.
  await x.turnEnded(true);
  expect(attentionItems(await x.store.read(), [] as never, [], false)).toHaveLength(1);
  // A background wake (a turn no person started) keeps it; the turn a person's message started ends it.
  await x.turnStarted();
  await x.turnEnded(false);
  expect(attentionItems(await x.store.read(), [] as never, [], false)).toHaveLength(1);
  await x.turnStarted();
  await x.turnEnded(true);
  expect(attentionItems(await x.store.read(), [] as never, [], false)).toEqual([]);

  const y = await setup({ llm: verdicts([{ id: "goal", verdict: "needs_user", detail: "  " }]) });
  const other = (await y.deliver("development")).tasks[0]!;
  expect(other.review).toMatchObject({ state: "passed" });
  expect(other.review!.items.find((i) => i.id === "goal")).toMatchObject({ state: "na", reason: "no detail" });
});

test("a decisive fail with needs_user: rework lists both apart", async () => {
  const x = await setup({
    entries: [guideline("g1", "Tests for new rules")],
    llm: verdicts([
      { id: "g1", verdict: "fail", detail: "No test.", file: "src/a.ts" },
      { id: "goal", verdict: "needs_user", detail: "Ask the API team for a key." },
    ]),
  });
  const board = await x.deliver("development");
  expect(board.tasks[0]).toMatchObject({ status: "development", review: { state: "rework" } });
  expect(x.sent[0]!.text).toContain("Needs the user (do not work around these; mention them in your delivery note):\n? Does what you asked — Ask the API team for a key. [id: goal]");
});

test("rework round: a fail of what passed before must cite a file this round changed, else it is minor (§3.6)", async () => {
  let round = 0;
  const seen: LlmReviewInput[] = [];
  const llm: LlmReview = async (input) => {
    round++;
    seen.push(input);
    if (round === 1) return { model: "m", verdicts: [{ id: "goal", verdict: "fail", severity: "blocker", detail: "Missing.", file: "src/a.ts" }, { id: "g1", verdict: "pass", detail: "ok" }] };
    if (round === 2) return { model: "m", verdicts: [{ id: "goal", verdict: "pass", detail: "Fixed." }, { id: "g1", verdict: "fail", detail: "New nit elsewhere.", file: "src/a.ts" }] };
    return { model: "m", verdicts: [{ id: "goal", verdict: "pass", detail: "Fixed." }, { id: "g1", verdict: "fail", detail: "Broke it here.", file: "src/b.ts" }] };
  };
  const x = await setup({ entries: [guideline("g1", "i18n everywhere")], llm, paths: ["src/a.ts", "src/b.ts"], diffText: (since) => (since ? "diff --git a/src/b.ts b/src/b.ts\n+x" : "diff --git a/src/a.ts b/src/a.ts\n+x") });
  await mkdir(join(x.a, "src"), { recursive: true });
  await writeFile(join(x.a, "src/a.ts"), "one");
  await x.deliver("development");
  await x.turnStarted();
  await writeFile(join(x.a, "src/b.ts"), "this round");
  let board = await x.deliver();
  expect(board.tasks[0]!.review).toMatchObject({ state: "passed", round: 2 });
  expect(board.tasks[0]!.review!.items.find((i) => i.id === "g1")).toMatchObject({ state: "failed", severity: "minor", reason: "Not caused by this round's changes." });
  // Same again, but the fail cites a file this round changed: a real regression decides.
  const y = await setup({ entries: [guideline("g1", "i18n everywhere")], llm, paths: ["src/a.ts", "src/b.ts"], diffText: (since) => (since ? "diff --git a/src/b.ts b/src/b.ts\n+x" : "diff --git a/src/a.ts b/src/a.ts\n+x") });
  round = 0;
  await mkdir(join(y.a, "src"), { recursive: true });
  await y.deliver("development");
  await y.turnStarted();
  await writeFile(join(y.a, "src/b.ts"), "this round");
  round = 2;
  board = await y.deliver();
  expect(board.tasks[0]!.review).toMatchObject({ state: "rework", round: 2 });
  expect(board.tasks[0]!.review!.items.find((i) => i.id === "g1")).toMatchObject({ state: "failed" });
  expect(board.tasks[0]!.review!.items.find((i) => i.id === "g1")!.severity).toBeUndefined();
  // The reviewer sees each unresolved failure's severity, so it can keep it (§3.6).
  expect(seen[1]!.checks.find((c) => c.id === "goal")!.previous).toMatchObject({ state: "failed", severity: "blocker" });

  // A file already uncommitted at the previous delivery and untouched since is not this round's change, even though
  // git still lists it against the previous commit: a new fail citing it is minor.
  const z = await setup({ entries: [guideline("g1", "i18n everywhere")], llm, paths: ["src/a.ts", "src/b.ts"], diffText: () => "diff --git a/src/a.ts b/src/a.ts\n+x\ndiff --git a/src/b.ts b/src/b.ts\n+y" });
  round = 0;
  await mkdir(join(z.a, "src"), { recursive: true });
  await writeFile(join(z.a, "src/a.ts"), "uncommitted since round 1");
  z.repo.changed = ["src/a.ts"];
  await z.deliver("development");
  await z.turnStarted();
  await writeFile(join(z.a, "src/b.ts"), "this round");
  z.repo.changed = ["src/a.ts", "src/b.ts"];
  board = await z.deliver();
  expect(board.tasks[0]!.review).toMatchObject({ state: "passed", round: 2 });
  expect(board.tasks[0]!.review!.items.find((i) => i.id === "g1")).toMatchObject({ state: "failed", severity: "minor", reason: "Not caused by this round's changes." });
});

test("rework round after a plugin restart still compares with the previous review's snapshot, read from disk (§3.6)", async () => {
  let round = 0;
  const llm: LlmReview = async () => {
    round++;
    if (round === 1) return { model: "m", verdicts: [{ id: "goal", verdict: "fail", severity: "blocker", detail: "Missing.", file: "src/b.ts" }, { id: "g1", verdict: "pass", detail: "ok" }] };
    return { model: "m", verdicts: [{ id: "goal", verdict: "pass", detail: "Fixed." }, { id: "g1", verdict: "fail", detail: "Old nit.", file: "src/a.ts" }] };
  };
  const scenario = async (between?: (x: Awaited<ReturnType<typeof setup>>) => Promise<void>) => {
    round = 0;
    const x = await setup({ entries: [guideline("g1", "i18n everywhere")], llm, maxRounds: 3, paths: ["src/a.ts", "src/b.ts"], diffText: () => "diff --git a/src/a.ts b/src/a.ts\n+x\ndiff --git a/src/b.ts b/src/b.ts\n+y" });
    await mkdir(join(x.a, "src"), { recursive: true });
    await writeFile(join(x.a, "src/a.ts"), "uncommitted since round 1");
    x.repo.changed = ["src/a.ts"];
    expect((await x.deliver("development")).tasks[0]!.review).toMatchObject({ state: "rework", round: 1 });
    // The plugin restarts between the rounds: a new service with nothing in memory.
    x.restart();
    await between?.(x);
    await x.turnStarted();
    await writeFile(join(x.a, "src/b.ts"), "this round");
    x.repo.changed = ["src/a.ts", "src/b.ts"];
    return (await x.deliver()).tasks[0]!.review!;
  };
  // src/a.ts was already uncommitted at round 1 and is untouched since: a fail citing it is minor, as without a restart.
  const kept = await scenario();
  expect(kept).toMatchObject({ state: "passed", round: 2 });
  expect(kept.items.find((i) => i.id === "g1")).toMatchObject({ state: "failed", severity: "minor", reason: "Not caused by this round's changes." });
  // An unreadable snapshot file reads as none: every candidate path counts, so the same fail decides.
  const corrupt = await scenario(async (x) => {
    const file = join(x.store.directory, "review-snapshots", "t.json");
    expect(existsSync(file)).toBe(true);
    await writeFile(file, "{ not json");
  });
  expect(corrupt).toMatchObject({ state: "rework", round: 2 });
  expect(corrupt.items.find((i) => i.id === "g1")!.severity).toBeUndefined();
});

test("rework round after a restart: a check that failed before and now fails for something new in a file this round did not change is minor; the same file, no earlier file or a changed file still decide (§3.6)", async () => {
  type V = { detail: string; file?: string; quote?: string };
  const verdict = (v: V) => ({ id: "goal", verdict: "fail" as const, severity: "blocker" as const, ...v });
  const scenario = async (first: V, second: V) => {
    const seen: LlmReviewInput[] = [];
    const llm: LlmReview = async (input) => {
      seen.push(input);
      return { model: "m", verdicts: [verdict(seen.length === 1 ? first : second)] };
    };
    const x = await setup({ entries: [], llm, maxRounds: 3, paths: ["src/a.ts", "src/b.ts"], diffText: () => "diff --git a/src/a.ts b/src/a.ts\n+x\ndiff --git a/src/b.ts b/src/b.ts\n+y" });
    await mkdir(join(x.a, "src"), { recursive: true });
    await writeFile(join(x.a, "src/a.ts"), "uncommitted since round 1");
    x.repo.changed = ["src/a.ts"];
    expect((await x.deliver("development")).tasks[0]!.review).toMatchObject({ state: "rework", round: 1 });
    x.restart();
    await x.turnStarted();
    await writeFile(join(x.a, "src/b.ts"), "this round");
    x.repo.changed = ["src/a.ts", "src/b.ts"];
    const review = (await x.deliver()).tasks[0]!.review!;
    return { review, goal: review.items.find((i) => i.id === "goal")!, seen };
  };
  // Round 1 failed on src/b.ts; round 2 finds something else in src/a.ts, untouched since round 1: not this round's.
  const old = await scenario({ detail: "The Rerun button is missing from the drawer.", file: "src/b.ts" }, { detail: "Variable naming in the parser is inconsistent.", file: "src/a.ts" });
  expect(old.review).toMatchObject({ state: "passed", round: 2 });
  expect(old.goal).toMatchObject({ state: "failed", severity: "minor", reason: "Not caused by this round's changes." });
  // The reviewer was told which files this round changed (from the snapshot read after the restart).
  expect(old.seen[1]!.changedThisRound).toEqual(["src/b.ts"]);
  expect(reviewPrompt(old.seen[1]!)).toContain("Files this round actually changed (other files in the diff were already changed at the previous delivery and are not this round's work): src/b.ts");
  // A new problem in a file this round changed is a regression: it decides.
  const changed = await scenario({ detail: "The Rerun button is missing from the drawer.", file: "src/a.ts" }, { detail: "Variable naming in the parser is inconsistent.", file: "src/b.ts" });
  expect(changed.review).toMatchObject({ state: "rework", round: 2 });
  expect(changed.goal.severity).toBe("blocker");
  // The same untouched file as last time may be the unfixed problem worded differently: it keeps its severity.
  const same = await scenario({ detail: "The Rerun button is missing from the drawer.", file: "src/a.ts" }, { detail: "Variable naming in the parser is inconsistent.", file: "src/a.ts" });
  expect(same.review).toMatchObject({ state: "rework", round: 2 });
  expect(same.goal.severity).toBe("blocker");
  // Last time's fail cited no file: no way to tell it apart, so it keeps its severity.
  const unplaced = await scenario({ detail: "The Rerun button is missing from the drawer.", quote: "Card" }, { detail: "Variable naming in the parser is inconsistent.", file: "src/a.ts" });
  expect(unplaced.review).toMatchObject({ state: "rework", round: 2 });
  expect(unplaced.goal.severity).toBe("blocker");
  // The same finding in another untouched file (largely the same words) keeps its severity too.
  const reworded = await scenario({ detail: "The Rerun button is missing from the drawer.", file: "src/b.ts" }, { detail: "The Rerun button is still missing from the drawer.", file: "src/a.ts" });
  expect(reworded.review).toMatchObject({ state: "rework", round: 2 });
});

test("review snapshots: written atomically per card, unreadable or wrong-shaped files read as none, removed with the card and at start when the card is gone (§3.6)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "flowly-snapshots-"));
  roots.push(dir);
  const files = new Map([["src/a.ts", "abc"], ["src/b c.ts", "exec:def"]]);
  await new ReviewSnapshots(dir).set("t1", { startedAt: "2026-11-27T00:00:00.000Z", files });
  await new ReviewSnapshots(dir).set("t2", { startedAt: "2026-11-27T00:00:01.000Z", files });
  // A fresh instance (a restart) reads what an earlier one wrote.
  expect(await new ReviewSnapshots(dir).get("t1")).toEqual({ startedAt: "2026-11-27T00:00:00.000Z", files });
  expect(await new ReviewSnapshots(dir).get("missing")).toBeUndefined();
  // Ids that are not card ids never reach the file system.
  expect(await new ReviewSnapshots(dir).get("../t1")).toBeUndefined();
  for (const bad of ["{", JSON.stringify({ version: 2, startedAt: "x", files: {} }), JSON.stringify({ version: 1, startedAt: "x", files: { a: 1 } }), JSON.stringify({ version: 1, startedAt: "x", files: [] })]) {
    await writeFile(join(dir, "review-snapshots", "bad.json"), bad);
    expect(await new ReviewSnapshots(dir).get("bad")).toBeUndefined();
  }
  const store = new ReviewSnapshots(dir);
  await store.remove(["t1"]);
  expect(existsSync(join(dir, "review-snapshots", "t1.json"))).toBe(false);
  expect(await store.get("t1")).toBeUndefined();
  // One failed removal does not skip the others; the failure is still reported.
  await new ReviewSnapshots(dir).set("t4", { startedAt: "x", files });
  await mkdir(join(dir, "review-snapshots", "t5.json", "child"), { recursive: true });
  await expect(new ReviewSnapshots(dir).remove(["t5", "t4"])).rejects.toThrow();
  expect(existsSync(join(dir, "review-snapshots", "t4.json"))).toBe(false);
  // At start: files of cards that no longer exist go; a write in progress (.tmp) stays.
  await writeFile(join(dir, "review-snapshots", "t3.json.123.tmp"), "{}");
  await rm(join(dir, "review-snapshots", "t5.json"), { recursive: true });
  expect(await new ReviewSnapshots(dir).cleanup(new Set(["t2"]))).toBe(1);
  expect(existsSync(join(dir, "review-snapshots", "t2.json"))).toBe(true);
  expect(existsSync(join(dir, "review-snapshots", "bad.json"))).toBe(false);
  expect(existsSync(join(dir, "review-snapshots", "t3.json.123.tmp"))).toBe(true);
});

test("changedFrom: a path counts when its content differs from the snapshot; one the snapshot lacks counts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "flowly-changed-"));
  await writeFile(join(dir, "a"), "1");
  await writeFile(join(dir, "b"), "2");
  const { files } = await contentSnapshot(dir, ["a", "b"]);
  expect([...(await changedFrom(dir, files, ["a", "b"]))]).toEqual([]);
  await writeFile(join(dir, "b"), "3");
  await writeFile(join(dir, "c"), "new");
  expect([...(await changedFrom(dir, files, ["c"]))].sort()).toEqual(["b", "c"]);
  // A mode change alone counts; a directory (a submodule) always counts.
  const { files: now } = await contentSnapshot(dir, ["a", "b", "c"]);
  await chmod(join(dir, "a"), 0o755);
  await mkdir(join(dir, "sub"));
  const { files: withSub } = await contentSnapshot(dir, ["sub"]);
  // Windows has no executable bit.
  if (process.platform !== "win32") expect([...(await changedFrom(dir, now, ["a", "b", "c"]))]).toEqual(["a"]);
  expect([...(await changedFrom(dir, withSub, ["sub"]))]).toEqual(["sub"]);
  await rm(dir, { recursive: true, force: true });
});

test("the card's cap: its 10th judged review that fails goes to Blocked without rework; Done clears the count (§3.3)", async () => {
  const x = await setup({ exits: { "npm test": 1 } });
  await x.store.mutate((b) => {
    b.tasks[0]!.reviewCount = 9;
  });
  const board = await x.deliver("development");
  expect(board.tasks[0]).toMatchObject({ status: "blocked", reviewCount: 10, review: { state: "failed", round: 1, reason: "This card reached 10 reviews, so no more automatic rework." } });
  expect(board.events.filter((e) => e.rule === "R2").at(-1)).toMatchObject({ note: "Auto review stopped after 10 reviews of this card" });
  expect(x.sent).toEqual([]);
  const task = await card(x);
  await x.store.placeTask({ id: "t", revision: task.revision, status: "done", beforeId: null, afterId: null });
  expect((await card(x)).reviewCount).toBeUndefined();
  // Cancelled and unavailable reviews do not count.
  const y = await setup({ exits: { "npm test": "spawn" } });
  expect((await y.deliver("development")).tasks[0]!.reviewCount).toBeUndefined();
});

test("the card's cap: past 10 reviews an agent's delivery runs no commands and no review session; a person's Rerun still reviews (§3.3)", async () => {
  let sessions = 0;
  const x = await setup({
    llm: async (input) => {
      sessions++;
      return passAll(input, undefined as never);
    },
  });
  await x.store.mutate((b) => {
    b.tasks[0]!.reviewCount = 10;
  });
  let ctx = await x.service.get(x.identity);
  await x.service.write(x.identity, "status", { ...input(ctx), status: "development" });
  ctx = await x.service.get(x.identity);
  const result = (await x.service.write(x.identity, "status", { ...input(ctx, "Delivered"), status: "in_review", nextMoves: [] })) as { notice?: string };
  await x.reviews.idle();
  const task = await card(x);
  expect(task).toMatchObject({ status: "in_review", reviewCount: 10 });
  expect(task.reviewWaiting).toBeUndefined();
  expect(task.review).toBeUndefined();
  expect(x.runs).toEqual([]);
  expect(sessions).toBe(0);
  expect(result.notice).toContain("This card reached 10 reviews, so no automatic review runs");
  // The person's Rerun is reviewed.
  await x.reviews.rerun("t", x.paseo);
  await x.reviews.idle();
  expect((await card(x)).review).toMatchObject({ state: "passed" });
  expect(sessions).toBe(1);
});

test("card item demotion: the third decisive fail in a row with a different finding stops deciding; it stays observing (§3.6)", async () => {
  const item = { ...cardItem("i1", "Handle the phone layout"), fails: ["Catalog misses the Rerun label", "Phone layout overflows the card"] };
  const x = await setup({ items: [item], llm: verdicts([{ id: "i1", verdict: "fail", detail: "Spec section 3 was not updated", file: "src/a.ts" }]) });
  let board = await x.deliver("development");
  expect(board.tasks[0]!.review).toMatchObject({ state: "passed" });
  expect(board.tasks[0]!.review!.items.find((i) => i.id === "i1")).toMatchObject({ state: "failed", gating: false, reason: "Failed 3 times in a row with a different finding each time, so it no longer decides the review." });
  let stored = (await x.guardrails.store.read()).items.find((i) => i.id === "i1")!;
  expect(stored).toMatchObject({ observing: true });
  expect(stored.fails).toHaveLength(3);
  // The next review judges it without letting it decide.
  board = await x.deliver();
  expect(board.tasks[0]!.review!.items.find((i) => i.id === "i1")).toMatchObject({ gating: false });
  expect(board.tasks[0]!.review!.state).toBe("passed");

  // The same finding again: it still decides.
  const same = { ...cardItem("i1", "Handle the phone layout"), fails: ["Spec section 3 was not updated", "Phone layout overflows the card"] };
  const y = await setup({ items: [same], llm: verdicts([{ id: "i1", verdict: "fail", detail: "Spec section 3 was not updated", file: "src/a.ts" }]) });
  board = await y.deliver("development");
  expect(board.tasks[0]!.review).toMatchObject({ state: "rework" });
  stored = (await y.guardrails.store.read()).items.find((i) => i.id === "i1")!;
  expect(stored.observing).toBeUndefined();
  // A pass clears the run.
  const z = await setup({ items: [{ ...cardItem("i1", "x"), fails: ["a b c"] }] });
  await z.deliver("development");
  expect((await z.guardrails.store.read()).items.find((i) => i.id === "i1")!.fails).toBeUndefined();
});

test("content fingerprint: a commit during the review keeps the result; editing a changed file cancels it (§3.6)", async () => {
  const x = await setup({ exits: { "npm test": 1 } });
  await mkdir(join(x.a, "src"), { recursive: true });
  await writeFile(join(x.a, "src/a.ts"), "one");
  x.setDuring(async () => {
    x.repo.head = "bbbbbbbbbbbb";
  });
  let board = await x.deliver("development");
  expect(board.tasks[0]).toMatchObject({ status: "development", review: { state: "rework" } });
  expect(board.tasks[0]!.review!.fingerprint.content).toMatch(/^[0-9a-f]{16}$/);

  const y = await setup({ exits: { "npm test": 1 } });
  await mkdir(join(y.a, "src"), { recursive: true });
  await writeFile(join(y.a, "src/a.ts"), "one");
  y.setDuring(async () => {
    await writeFile(join(y.a, "src/a.ts"), "two");
  });
  board = await y.deliver("development");
  expect(board.tasks[0]).toMatchObject({ status: "in_review", review: { state: "cancelled", reason: "The card, its workpad or its code changed during the review." } });
  expect(y.sent).toEqual([]);

  // A file outside the delivery's changed set, edited after the start, cancels it too.
  const z = await setup({ exits: { "npm test": 1 } });
  await mkdir(join(z.a, "src"), { recursive: true });
  await writeFile(join(z.a, "src/a.ts"), "one");
  z.setDuring(async () => {
    await writeFile(join(z.a, "src/b.ts"), "new");
    z.repo.changed = ["src/b.ts"];
    z.repo.head = "bbbbbbbbbbbb";
  });
  board = await z.deliver("development");
  expect(board.tasks[0]).toMatchObject({ status: "in_review", review: { state: "cancelled" } });
  expect(z.sent).toEqual([]);

  // In a shared directory another session's file outside the set does not (D6).
  const w = await setup({ shared: true, llm: verdicts([{ id: "goal", verdict: "fail", detail: "core missing", file: "src/a.ts", line: 1 }]) });
  await mkdir(join(w.a, "src"), { recursive: true });
  await writeFile(join(w.a, "src/a.ts"), "one");
  w.setDuring(async () => {
    await writeFile(join(w.a, "src/other.ts"), "someone else's");
    w.repo.changed = ["src/other.ts"];
  });
  board = await w.deliver("development");
  expect(board.tasks[0]).toMatchObject({ status: "development", review: { state: "rework" } });
});

test("contentDigest: a symbolic link counts by its target path, not the target's bytes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "flowly-digest-link-"));
  await writeFile(join(dir, "a.json"), "{}");
  await writeFile(join(dir, "b.json"), "{}");
  await symlink("a.json", join(dir, "link.json"));
  const before = await contentDigest(dir, ["link.json"]);
  await rm(join(dir, "link.json"));
  await symlink("b.json", join(dir, "link.json"));
  expect(await contentDigest(dir, ["link.json"])).not.toBe(before);
  // A regular file whose text is the target is not the same as the link.
  const linked = await contentDigest(dir, ["link.json"]);
  await rm(join(dir, "link.json"));
  await writeFile(join(dir, "link.json"), "b.json");
  expect(await contentDigest(dir, ["link.json"])).not.toBe(linked);
  // Outside the workspace: only the path is read.
  await rm(join(dir, "link.json"));
  await symlink("/nonexistent/flowly-target", join(dir, "link.json"));
  expect(await contentDigest(dir, ["link.json"])).not.toBe(await contentDigest(dir, ["missing.json"]));
  await rm(dir, { recursive: true, force: true });
});

test("contentDigest: the paths' content, order-free; a deleted file differs from an empty one", async () => {
  const dir = await mkdtemp(join(tmpdir(), "flowly-digest-"));
  roots.push(dir);
  await writeFile(join(dir, "a"), "1");
  await writeFile(join(dir, "b"), "2");
  const one = await contentDigest(dir, ["a", "b"]);
  expect(await contentDigest(dir, ["b", "a", "a"])).toBe(one);
  await writeFile(join(dir, "b"), "3");
  expect(await contentDigest(dir, ["a", "b"])).not.toBe(one);
  const gone = await contentDigest(dir, ["a", "c"]);
  await writeFile(join(dir, "c"), "");
  expect(await contentDigest(dir, ["a", "c"])).not.toBe(gone);
});

test("a person moving the card away stops the review at once: commands and the review session end, Cancelled, no rework (§3.2)", async () => {
  let aborted = 0;
  const run: RunCheck = (_argv, _cwd, _timeout, signal) =>
    new Promise((resolve) => {
      signal?.addEventListener("abort", () => {
        aborted++;
        resolve({ exitCode: null, timedOut: false, ms: 1, output: "" });
      });
    });
  const x = await setup({ run });
  const ctx = await x.service.get(x.identity);
  await x.service.write(x.identity, "status", { ...input(ctx), status: "development" });
  const delivered = await x.service.get(x.identity);
  void x.service.write(x.identity, "status", { ...input(delivered, "Delivered"), status: "in_review", nextMoves: [] });
  // Wait until the command runs.
  for (let i = 0; i < 100 && (await card(x)).review?.items[0]?.state !== "running"; i++) await new Promise((r) => setTimeout(r, 10));
  const task = await card(x);
  await x.store.placeTask({ id: "t", revision: task.revision, status: "design", beforeId: null, afterId: null });
  await x.reviews.idle();
  const board = await x.store.read();
  expect(aborted).toBe(1);
  expect(board.tasks[0]).toMatchObject({ status: "design", review: { state: "cancelled", reason: "A person moved the card during the review." } });
  expect(board.events.filter((e) => e.action === "review_finished").map((e) => e.note)).toEqual(["Auto review cancelled: a person moved the card"]);
  expect(x.sent).toEqual([]);

  // The review session's wait ends too.
  let released = false;
  let listening!: () => void;
  const ready = new Promise<void>((resolve) => (listening = resolve));
  const llm: LlmReview = (_input, _paseo, signal) =>
    new Promise((_resolve, reject) => {
      const stop = () => {
        released = true;
        reject(new Error("Stopped."));
      };
      if (signal?.aborted) return stop();
      signal?.addEventListener("abort", stop);
      listening();
    });
  const y = await setup({ llm });
  const c1 = await y.service.get(y.identity);
  await y.service.write(y.identity, "status", { ...input(c1), status: "development" });
  const c2 = await y.service.get(y.identity);
  void y.service.write(y.identity, "status", { ...input(c2, "Delivered"), status: "in_review", nextMoves: [] });
  // The reviewer is waiting with its abort listener in place.
  await ready;
  const t2 = await card(y);
  await y.store.placeTask({ id: "t", revision: t2.revision, status: "development", beforeId: null, afterId: null });
  await y.reviews.idle();
  expect(released).toBe(true);
  expect((await card(y)).review).toMatchObject({ state: "cancelled", reason: "A person moved the card during the review." });
});

/** The command-run hook runs at every run (a failed gating command runs twice, §6.3 step 1): act at the first only. */
const firstRunOnly = (fn: () => Promise<unknown>) => {
  let done = false;
  return async () => {
    if (done) return;
    done = true;
    await fn();
  };
};

test("A1 during the review holds the result; A1r back unchanged applies it, changed drops it; a person's move drops it (§3.2)", async () => {
  const a1 = async (x: Awaited<ReturnType<typeof setup>>) =>
    x.store.mutate((b) => {
      recordLifecycle(x.store, b, x.identity, "agent.turn_started");
      applyTurnStarted(x.store, b, x.identity, "First actor");
    });
  const a1r = async (x: Awaited<ReturnType<typeof setup>>) => {
    await x.store.mutate((b) => {
      recordLifecycle(x.store, b, x.identity, "agent.turn_ended", { kind: "completed" } as never);
      applyTurnEnded(x.store, b, x.identity, { kind: "completed" } as never);
    });
    await x.reviews.restored("t", x.paseo);
    await x.reviews.idle();
  };
  // Unchanged: the failed result applies after A1r, with R1 and the rework message.
  const x = await setup({ exits: { "npm test": 1 } });
  x.setDuring(firstRunOnly(() => a1(x)));
  let board = await x.deliver("development");
  expect(board.tasks[0]).toMatchObject({ status: "development", review: { state: "cancelled", held: true, reason: "The card left In review during the review." } });
  expect(x.sent).toEqual([]);
  await a1r(x);
  board = await x.store.read();
  expect(board.tasks[0]).toMatchObject({ status: "development", review: { state: "rework" } });
  expect(board.tasks[0]!.review!.held).toBeUndefined();
  expect(board.events.filter((e) => e.action === "status_changed").map((e) => e.rule).slice(-3)).toEqual(["A1", "A1r", "R1"]);
  expect(x.sent).toHaveLength(1);

  // A pass applies too.
  const p = await setup();
  p.setDuring(firstRunOnly(() => a1(p)));
  await p.deliver("development");
  await a1r(p);
  expect((await card(p))).toMatchObject({ status: "in_review", review: { state: "passed" } });

  // Changed meanwhile: dropped.
  const y = await setup({ exits: { "npm test": 1 } });
  y.setDuring(firstRunOnly(() => a1(y)));
  await y.deliver("development");
  await y.store.mutate((b) => {
    b.workpads[0]!.revision++;
  });
  await a1r(y);
  expect(await card(y)).toMatchObject({ status: "in_review", review: { state: "cancelled", reason: "The card, its workpad or its code changed during the review." } });
  expect(y.sent).toEqual([]);

  // A person's move while held drops it.
  const z = await setup({ exits: { "npm test": 1 } });
  z.setDuring(firstRunOnly(() => a1(z)));
  await z.deliver("development");
  const t = await card(z);
  await z.store.placeTask({ id: "t", revision: t.revision, status: "test", beforeId: null, afterId: null });
  expect((await card(z)).review!.held).toBeUndefined();
  await z.reviews.restored("t", z.paseo);
  await z.reviews.idle();
  expect((await card(z)).review!.state).toBe("cancelled");
});

test("runCheck: an abort ends the command and its children at once", async () => {
  const controller = new AbortController();
  const dir = await mkdtemp(join(tmpdir(), "flowly-abort-"));
  const marker = join(dir, "started");
  // The marker appears once the background child runs; it holds the output pipes open until it is killed.
  const pending = runCheck(["sh", "-c", 'sleep 30 & touch "$0"; wait', marker], tmpdir(), 60_000, controller.signal);
  for (let i = 0; i < 500 && !existsSync(marker); i++) await new Promise((r) => setTimeout(r, 10));
  expect(existsSync(marker)).toBe(true);
  const aborted = Date.now();
  controller.abort();
  const result = await pending;
  expect(Date.now() - aborted).toBeLessThan(5000);
  expect(result.spawnError).toBeUndefined();
  expect(result.timedOut).toBe(false);
  await rm(dir, { recursive: true, force: true });
});
