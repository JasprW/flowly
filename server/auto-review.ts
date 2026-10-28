import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import type { PaseoApi } from "@getpaseo/client";
import { laneEnabled } from "../shared/lanes";
import { autoReviewLimits, type Board, type GitHead, type HistoryStatus, type Project, type ReviewRule, type RuleResult, type Task, type TaskType, type Workpad } from "../shared/model";
import {
  autoReviewOf,
  autoReviewRuns,
  continuesRound,
  conversationForReview,
  conversationLimits,
  defaultCheckTimeoutSec,
  failureSummary,
  GOAL_ID,
  outputTail,
  reviewFailedRule,
  reviewFinishedAction,
  reviewStartedAction,
  reworkMessage,
  reworkRule,
  reworkStage,
  reviewChecks,
  reviewConfigHash,
  ruleFits,
  ruleId,
} from "../shared/auto-review";
import type { BoardStore } from "./store";
import { isSummarizer } from "../shared/summary";
import { defaultGit, readHead, type Git } from "./workpad";
import { logFailure } from "./error-report";

/** An agent delivery to In review that starts a review (AUTO-REVIEW-SPEC §3.1). */
export type DeliveredReview = { taskId: string; projectId: string; eventId: string; agentId: string; from: HistoryStatus };

/** What the LLM review session reads (§12.4). */
export type LlmReviewInput = {
  task: { id: string; title: string; description: string; type?: TaskType; workspaceId: string };
  /** The project's default model, used when Settings → Models has no Review model. */
  projectModel?: string;
  rules: { id: string; name: string; prompt: string }[];
  /** The user's messages in the card's sessions, oldest first (§4.2); null when they could not be read. Only for the built-in check. */
  conversation?: string[] | null;
  /** The workspace is not a worktree: the diff may hold other cards' uncommitted changes (§2 limit 3). */
  shared?: boolean;
  guidance?: string;
  workpad: Workpad | null;
  deliveryNote: string;
  outputs: string[];
  commands: string[];
  diff: string;
  /** The delivering session, as the review session's parent. */
  parentAgentId: string;
};
export type LlmVerdict = { id: string; verdict: "pass" | "fail" | "na"; detail: string; file?: string; line?: number };
export type LlmReview = (input: LlmReviewInput, paseo: PaseoApi) => Promise<{ model: string; verdicts: LlmVerdict[] }>;

const diffLimit = 64 * 1024;
const execute = promisify(execFile);
/** Uncommitted changes plus the last few commits, cut at 64 KiB (§12.4). Never fails: an empty string when git does. */
export async function reviewDiff(directory: string): Promise<string> {
  const git = (args: string[]) =>
    execute("git", ["-C", directory, ...args], { timeout: 20_000, maxBuffer: 16 << 20, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } })
      .then((r) => r.stdout)
      .catch(() => "");
  const [uncommitted, recent] = await Promise.all([git(["diff", "HEAD", "--no-color"]), git(["log", "-5", "-p", "--no-color", "--format=commit %h %s"])]);
  const text = `# Uncommitted changes (git diff HEAD)\n${uncommitted || "(none)\n"}\n# Recent commits\n${recent}`;
  return text.length > diffLimit ? `${text.slice(0, diffLimit)}\n[diff truncated at 64 KiB]` : text;
}

/**
 * The user's messages in the card's sessions (§4.2): the projected tail of each session in its workspace, Flowly's own
 * temporary sessions left out. null when Paseo could not list them; one unreadable session is skipped.
 */
export async function readConversation(task: Pick<Task, "workspaceId">, paseo: PaseoApi): Promise<string[] | null> {
  const ids: string[] = [];
  let cursor: string | undefined;
  try {
    do {
      const page = await paseo.agents.list({ filter: { includeArchived: true }, page: { limit: 200, cursor } });
      for (const { agent } of page.entries) if (agent.workspaceId === task.workspaceId && !isSummarizer(agent as { labels?: Record<string, string> | null })) ids.push(agent.id);
      cursor = page.pageInfo.nextCursor ?? undefined;
    } while (cursor);
  } catch (e) {
    logFailure("Flowly auto review could not list the card's sessions:", e);
    return null;
  }
  const messages: { at: string; text: string }[] = [];
  for (const id of ids) {
    const res = await paseo.agents
      .ref(id)
      .timeline.refetch({ direction: "tail", limit: conversationLimits.perSession, projection: "projected" })
      .catch(() => null);
    for (const entry of (res?.entries || []) as { timestamp?: string; item?: { type?: unknown; text?: unknown } }[])
      if (entry.item?.type === "user_message" && typeof entry.item.text === "string") messages.push({ at: entry.timestamp || "", text: entry.item.text });
  }
  return conversationForReview(messages);
}

export type CheckRun = { exitCode: number | null; timedOut: boolean; spawnError?: string; ms: number; output: string };
/** Runs one check as an argument array in `cwd`, never through a shell. */
export type RunCheck = (argv: readonly string[], cwd: string, timeoutMs: number) => Promise<CheckRun>;

export const runCheck: RunCheck = (argv, cwd, timeoutMs) =>
  new Promise((resolve) => {
    const started = Date.now();
    let output = "",
      timedOut = false,
      settled = false;
    const keep = (chunk: Buffer) => {
      output = (output + chunk.toString("utf8")).slice(-autoReviewLimits.tail * 2);
    };
    // Its own process group, so a timeout also stops the test runner's workers.
    const group = process.platform !== "win32";
    const child = spawn(argv[0], argv.slice(1), {
      cwd,
      detached: group,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, CI: "1", NO_COLOR: "1", FORCE_COLOR: "0" },
    });
    const kill = (signal: NodeJS.Signals) => {
      try {
        if (group && child.pid) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {
        // Already gone.
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill("SIGTERM");
      setTimeout(() => kill("SIGKILL"), 5000).unref();
    }, timeoutMs);
    const finish = (run: Omit<CheckRun, "ms" | "output" | "timedOut">) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ...run, timedOut, ms: Date.now() - started, output });
    };
    child.stdout?.on("data", keep);
    child.stderr?.on("data", keep);
    child.on("error", (e) => finish({ exitCode: null, spawnError: e.message }));
    child.on("close", (code) => finish({ exitCode: code }));
  });

export type AutoReviewDeps = {
  /** The card workspace's directory and whether it is a worktree; null when Paseo has none. */
  workspace: (task: Task, paseo: PaseoApi) => Promise<{ directory: string; worktree: boolean } | null>;
  /** The session is in a turn now (running or starting). */
  sessionBusy: (agentId: string, paseo: PaseoApi) => Promise<boolean>;
  /** The delivering session still exists and is not archived. */
  sessionLive: (agentId: string, task: Task, paseo: PaseoApi) => Promise<boolean>;
  /** Queues a message for a session; it goes out when the session's turn ends (the composer queue). */
  send: (input: { taskId: string; agentId: string; text: string }, paseo: PaseoApi) => Promise<unknown>;
  /** Judges the LLM rules in a temporary review session; absent makes them unavailable. */
  llm?: LlmReview;
  /** The user's messages in the card's sessions (§4.2), for the built-in check; null when unreadable. */
  conversation?: (task: Task, paseo: PaseoApi) => Promise<string[] | null>;
  /** The diff the review session reads; `reviewDiff` by default. */
  diff?: (directory: string) => Promise<string>;
  run?: RunCheck;
  git?: Git;
  clock?: () => number;
};


/**
 * The automatic review of agent deliveries (AUTO-REVIEW-SPEC): runs the project's checks in the card workspace,
 * then leaves a passed card in In review, sends a failed one back to rework (R1) or, past the limit, to Blocked (R2).
 * The review record lives on the task and never changes its revision.
 */
export class AutoReviewService {
  private chains = new Map<string, Promise<void>>();
  /** Deliveries waiting for their session's turn to end, by session. */
  private pending = new Map<string, DeliveredReview>();
  private readonly run: RunCheck;
  private readonly git: Git;
  private readonly clock: () => number;
  constructor(
    readonly store: BoardStore,
    readonly deps: AutoReviewDeps,
  ) {
    this.run = deps.run ?? runCheck;
    this.git = deps.git ?? defaultGit;
    this.clock = deps.clock ?? (() => Date.now());
  }

  /**
   * An agent delivered the card to In review; never throws. The review starts when that session's turn ends (§3.1):
   * whatever the agent still does in that turn (a commit, a workpad edit) would otherwise cancel it.
   */
  async delivered(delivery: DeliveredReview, paseo: PaseoApi) {
    // Recorded before the status check, so a turn ending meanwhile still finds it.
    this.pending.set(delivery.agentId, delivery);
    const busy = await this.deps.sessionBusy(delivery.agentId, paseo).catch(() => false);
    if (!busy) await this.turnEnded(delivery.agentId, paseo);
  }

  /** A session's turn ended: start the review of its delivery, if one waits. */
  turnEnded(agentId: string, paseo: PaseoApi) {
    const delivery = this.pending.get(agentId);
    if (!delivery) return Promise.resolve();
    this.pending.delete(agentId);
    return this.enqueue(delivery.projectId, delivery.taskId, () => this.review(delivery, false, paseo));
  }

  /** A person's Rerun from the drawer (§7): the card is in In review, round starts at 1. */
  async rerun(taskId: string, paseo: PaseoApi) {
    const board = await this.store.read();
    const task = board.tasks.find((t) => t.id === taskId);
    const project = task && board.projects.find((p) => p.id === task.projectId);
    if (!task || !project || task.archivedAt || project.archivedAt) throw new Error("Task is unavailable or archived.");
    if (task.status !== "in_review") throw new Error("Only a card in In review can be reviewed again.");
    if (!autoReviewRuns(project, task)) throw new Error("Turn on Auto review and keep a check that applies to this card in the project settings first.");
    if (task.review?.state === "running") throw new Error("A review of this card is already running.");
    const delivery = latestDelivery(board, task);
    if (!delivery) throw new Error("No agent delivered this card to In review, so there is no session to send rework to.");
    void this.enqueue(project.id, task.id, () => this.review(delivery, true, paseo));
    return { ok: true as const };
  }

  /** At plugin start: a review that was running when Flowly stopped never finishes, so it becomes Unavailable (§3.2). */
  recover() {
    return this.store.transaction((b) => {
      let changed = false;
      for (const t of b.tasks) {
        if (t.review?.state !== "running") continue;
        const reason = "Flowly restarted during the review.";
        t.review = {
          ...t.review,
          state: "unavailable",
          reason,
          finishedAt: this.now(),
          rules: t.review.rules.map((r) => (r.state === "queued" || r.state === "running" ? { ...r, state: "unavailable" as const, reason } : r)),
        };
        this.store.event(b, { taskId: t.id, actor: "system", action: reviewFinishedAction, agentId: t.review.trigger.agentId, note: "Auto review unavailable: Flowly restarted during the review." });
        changed = true;
      }
      return { value: changed, changed };
    });
  }

  /** Waits for every queued review; for tests and shutdown. */
  async idle() {
    while (this.chains.size) await Promise.all([...this.chains.values()]);
  }

  /** One review at a time per project: its cards may share a working directory. */
  private enqueue(key: string, taskId: string, job: () => Promise<void>) {
    const run = (this.chains.get(key) ?? Promise.resolve()).then(job).catch((e) => logFailure("Flowly auto review failed:", e, taskId));
    this.chains.set(key, run);
    void run.then(() => {
      if (this.chains.get(key) === run) this.chains.delete(key);
    });
    return run;
  }

  private now() {
    return new Date(this.clock()).toISOString();
  }

  private async review(delivery: DeliveredReview, manual: boolean, paseo: PaseoApi) {
    const board = await this.store.read();
    const task = board.tasks.find((t) => t.id === delivery.taskId);
    const project = task && board.projects.find((p) => p.id === task.projectId);
    if (!task || !project || task.archivedAt || project.archivedAt || task.status !== "in_review" || !autoReviewRuns(project, task)) return;
    const where = await this.deps.workspace(task, paseo).catch(() => null);
    const head = where ? await readHead(where.directory, this.git, this.now()) : null;
    const startedAt = this.now();
    const config = autoReviewOf(project);
    // The checks in effect when it starts; editing them meanwhile does not change this review (§4.3).
    const rules = reviewChecks(project, task);
    const started = await this.store.transaction((b) => {
      const t = b.tasks.find((x) => x.id === delivery.taskId);
      if (!t || t.archivedAt || t.status !== "in_review") return { value: false, changed: false };
      const round = !manual && continuesRound(b.events, t.id, t.review) ? t.review!.round + 1 : 1;
      t.review = {
        trigger: { eventId: manual ? "" : delivery.eventId, agentId: delivery.agentId, from: delivery.from },
        round,
        maxRounds: config.maxRounds,
        state: "running",
        fingerprint: {
          taskRevision: t.revision,
          workpadRevision: b.workpads.find((w) => w.taskId === t.id)?.revision ?? 0,
          ...(head?.sha ? { sha: head.sha } : {}),
          dirty: !!head?.dirty,
        },
        shared: !where?.worktree,
        rules: rules.map((r) => ({ id: r.id, kind: r.kind, name: r.name, state: "queued" as const, ...(r.kind === "command" ? { argv: [...r.argv] } : {}) })),
        startedAt,
      };
      this.store.event(b, {
        taskId: t.id,
        actor: "system",
        action: reviewStartedAction,
        agentId: delivery.agentId,
        note: `Auto review started (round ${round})`,
      });
      return { value: true, changed: true };
    });
    if (!started) return;
    const set = (id: string, patch: Partial<RuleResult>) => this.updateRule(delivery.taskId, startedAt, [id], patch);
    if (!where) {
      await this.updateRule(delivery.taskId, startedAt, rules.map((r) => r.id), { state: "unavailable", reason: "The card's workspace directory is unavailable." });
    } else {
      // Every command rule runs, in list order; each result shows as soon as it is in (§12.4).
      for (const rule of rules) {
        if (rule.kind !== "command") continue;
        await set(rule.id, { state: "running" });
        const timeout = (rule.timeoutSec ?? defaultCheckTimeoutSec) * 1000;
        const run = await this.run(rule.argv, where.directory, timeout);
        const tail = outputTail(run.output, autoReviewLimits.tail);
        const passed = run.exitCode === 0 && !run.timedOut && !run.spawnError;
        // A command that cannot start or times out is the review's problem, not the agent's (§3.2 Unavailable).
        const state = passed ? "passed" : run.spawnError || run.timedOut ? "unavailable" : "failed";
        await set(rule.id, {
          state,
          exitCode: run.exitCode,
          ...(run.timedOut ? { timedOut: true } : {}),
          ms: Math.max(0, Math.round(run.ms)),
          ...(!passed && tail ? { tail } : {}),
          ...(run.spawnError ? { reason: `Could not start: ${run.spawnError}`.slice(0, autoReviewLimits.reason) } : {}),
          ...(run.timedOut ? { reason: `Timed out after ${timeout / 1000} s.` } : {}),
        });
      }
      await this.llmRules(delivery, startedAt, task, project, rules, config.guidance, where, paseo);
    }
    const after = where ? await readHead(where.directory, this.git, this.now()) : null;
    const rework = await this.finish(delivery.taskId, startedAt, where ? after : undefined);
    if (!rework) return;
    const live = await this.deps.sessionLive(rework.trigger.agentId, rework.task, paseo).catch(() => false);
    const sent = live
      ? await this.deps.send({ taskId: rework.task.id, agentId: rework.trigger.agentId, text: reworkMessage(rework.review) }, paseo).then(
          () => true,
          (e) => {
            logFailure("Flowly auto review rework not sent:", e, rework.task.id);
            return false;
          },
        )
      : false;
    if (!sent) await this.markUnavailable(delivery.taskId, startedAt, "The delivering session is no longer available, so the rework message was not sent.");
  }

  /** LLM rules (§12.4): one review session judges them all, only when every command rule passed (D9). */
  private async llmRules(
    delivery: DeliveredReview,
    startedAt: string,
    task: Task,
    project: Project,
    rules: ReviewRule[],
    guidance: string | undefined,
    where: { directory: string; worktree: boolean },
    paseo: PaseoApi,
  ) {
    const llm = rules.filter((r): r is Extract<ReviewRule, { kind: "llm" }> => r.kind === "llm");
    if (!llm.length) return;
    const ids = llm.map((r) => r.id);
    const now = (await this.store.read()).tasks.find((t) => t.id === delivery.taskId)?.review;
    if (!now || now.startedAt !== startedAt) return;
    const commands = now.rules.filter((r) => r.kind === "command");
    if (commands.some((r) => r.state === "failed")) {
      await this.updateRule(delivery.taskId, startedAt, ids, { state: "skipped", reason: "Command rules failed." });
      return;
    }
    if (commands.some((r) => r.state === "unavailable")) {
      await this.updateRule(delivery.taskId, startedAt, ids, { state: "skipped", reason: "A command rule could not run." });
      return;
    }
    if (!this.deps.llm) {
      await this.updateRule(delivery.taskId, startedAt, ids, { state: "unavailable", reason: "LLM review is unavailable in this Flowly build." });
      return;
    }
    await this.updateRule(delivery.taskId, startedAt, ids, { state: "running" });
    const board = await this.store.read();
    const deliveryEvent = board.events.find((e) => e.id === delivery.eventId);
    const input: LlmReviewInput = {
      task: { id: task.id, title: task.title, description: task.description, type: task.type, workspaceId: task.workspaceId },
      projectModel: project.agentModel ? `${project.agentModel.provider}/${project.agentModel.model}` : undefined,
      rules: llm.map((r) => ({ id: r.id, name: r.name, prompt: r.prompt })),
      ...(ids.includes(GOAL_ID) ? { conversation: this.deps.conversation ? await this.deps.conversation(task, paseo).catch(() => null) : null } : {}),
      ...(where.worktree ? {} : { shared: true }),
      guidance,
      workpad: board.workpads.find((w) => w.taskId === task.id) ?? null,
      deliveryNote: deliveryEvent?.note ?? "",
      outputs: board.artifacts.filter((a) => a.taskId === task.id && a.role === "output").map((a) => a.target),
      commands: commands.map((r) => `${r.name}: ${r.state}`),
      diff: await (this.deps.diff ?? reviewDiff)(where.directory),
      parentAgentId: delivery.agentId,
    };
    const started = this.clock();
    try {
      const result = await this.deps.llm(input, paseo);
      const ms = Math.max(0, Math.round(this.clock() - started));
      const byId = new Map(result.verdicts.map((v) => [v.id, v]));
      await this.store.transaction((b) => {
        const t = b.tasks.find((x) => x.id === delivery.taskId);
        if (!t?.review || t.review.startedAt !== startedAt) return { value: null, changed: false };
        t.review = {
          ...t.review,
          model: result.model.slice(0, 200),
          rules: t.review.rules.map((r) => {
            if (r.kind !== "llm" || !ids.includes(r.id)) return r;
            const v = byId.get(r.id);
            // A rule missing from the output was not judged (§12.4).
            if (!v) return { ...r, state: "unavailable", ms, reason: "The review session gave no verdict for this rule." };
            return {
              ...r,
              state: v.verdict === "pass" ? "passed" : v.verdict === "fail" ? "failed" : "na",
              ms,
              detail: v.detail.slice(0, autoReviewLimits.detail),
              ...(v.file ? { file: v.file.slice(0, 300) } : {}),
              ...(v.line ? { line: v.line } : {}),
            };
          }),
        };
        return { value: null, changed: true };
      });
    } catch (e) {
      const reason = `LLM review failed: ${e instanceof Error ? e.message : String(e)}`.slice(0, autoReviewLimits.reason);
      await this.updateRule(delivery.taskId, startedAt, ids, { state: "unavailable", reason });
    }
  }

  /** Writes rule results of the running review; no task revision, so the fingerprint is untouched (§12.5). */
  private updateRule(taskId: string, startedAt: string, ids: readonly string[], patch: Partial<RuleResult>) {
    return this.store.transaction((b) => {
      const t = b.tasks.find((x) => x.id === taskId);
      if (!t?.review || t.review.startedAt !== startedAt || t.review.state !== "running") return { value: null, changed: false };
      t.review = { ...t.review, rules: t.review.rules.map((r) => (ids.includes(r.id) ? { ...r, ...patch } : r)) };
      return { value: null, changed: true };
    });
  }

  /** Writes the result; a card that changed meanwhile drops it (§3.2 Cancelled). Returns what rework to send. */
  private async finish(taskId: string, startedAt: string, after: GitHead | null | undefined) {
    return this.store.transaction((b) => {
      const t = b.tasks.find((x) => x.id === taskId);
      const project = t && b.projects.find((p) => p.id === t.projectId);
      const r = t?.review;
      if (!t || !project || !r || r.startedAt !== startedAt || r.state !== "running") return { value: null, changed: false };
      const finishedAt = this.now();
      const pad = b.workpads.find((w) => w.taskId === t.id);
      const changed =
        t.archivedAt ||
        t.status !== "in_review" ||
        t.revision !== r.fingerprint.taskRevision ||
        (pad?.revision ?? 0) !== r.fingerprint.workpadRevision ||
        (after !== undefined && ((after?.sha || undefined) !== r.fingerprint.sha || !!after?.dirty !== r.fingerprint.dirty));
      // Each check's result goes with the event, for the Insights counts (§8.3).
      const event = (note: string) =>
        this.store.event(b, { taskId: t.id, actor: "system", action: reviewFinishedAction, agentId: r.trigger.agentId, note, results: r.rules.map((x) => ({ id: x.id, state: x.state })) });
      if (changed) {
        t.review = { ...r, state: "cancelled", reason: "The card, its workpad or its code changed during the review.", finishedAt };
        // No results: a cancelled review judged nothing.
        this.store.event(b, { taskId: t.id, actor: "system", action: reviewFinishedAction, agentId: r.trigger.agentId, note: "Auto review cancelled: the card changed during the review" });
        return { value: null, changed: true };
      }
      // Overall (§12.4): any failed rule fails it; else any unavailable one makes it Unavailable; else it passed.
      const failed = r.rules.some((x) => x.state === "failed");
      const unavailable = r.rules.find((x) => x.state === "unavailable" || x.state === "queued" || x.state === "running");
      if (!failed && !unavailable) {
        t.review = { ...r, state: "passed", finishedAt };
        event(`Auto review passed (${r.rules.length} rule${r.rules.length === 1 ? "" : "s"})`);
        return { value: null, changed: true };
      }
      if (!failed) {
        const reason = `${unavailable!.name}: ${unavailable!.reason || "could not run"}`.slice(0, autoReviewLimits.reason);
        t.review = { ...r, state: "unavailable", reason, finishedAt };
        event(`Auto review unavailable: ${reason}`);
        return { value: null, changed: true };
      }
      const findings = failureSummary(r);
      const move = (to: Task["status"], rule: string, note: string) => {
        t.status = to;
        t.revision++;
        t.updatedAt = finishedAt;
        this.store.event(b, { taskId: t.id, actor: "system", action: "status_changed", agentId: r.trigger.agentId, rule, from: "in_review", to, note });
      };
      // Status first, then the message (§3.2): the rework turn then starts on a work stage, so A1 leaves it alone.
      const stage = r.round - 1 < r.maxRounds ? reworkStage(b.events, t, project, r.trigger.from) : null;
      if (stage) {
        t.review = { ...r, state: "rework", finishedAt };
        event(`Auto review failed: ${findings}`);
        move(stage, reworkRule, `Auto review failed; back to rework (${r.round}/${r.maxRounds})`);
        return { value: { task: { ...t }, trigger: r.trigger, review: t.review }, changed: true };
      }
      t.review = { ...r, state: "failed", finishedAt };
      event(`Auto review failed: ${findings}`);
      if (laneEnabled(project, "blocked")) move("blocked", reviewFailedRule, `Auto review failed after ${r.round - 1} rework round${r.round - 1 === 1 ? "" : "s"}`);
      return { value: null, changed: true };
    });
  }

  private markUnavailable(taskId: string, startedAt: string, reason: string) {
    return this.store.transaction((b) => {
      const t = b.tasks.find((x) => x.id === taskId);
      if (!t?.review || t.review.startedAt !== startedAt) return { value: null, changed: false };
      t.review = { ...t.review, state: "unavailable", reason, finishedAt: t.review.finishedAt ?? this.now() };
      this.store.event(b, { taskId, actor: "system", action: reviewFinishedAction, agentId: t.review.trigger.agentId, note: `Auto review unavailable: ${reason}` });
      return { value: null, changed: true };
    });
  }
}

/** The latest agent delivery of the card to In review, for a person's Rerun. */
function latestDelivery(board: Board, task: Task): DeliveredReview | null {
  for (let i = board.events.length - 1; i >= 0; i--) {
    const e = board.events[i];
    if (e.taskId === task.id && e.action === "status_changed" && e.to === "in_review" && e.actor === "agent" && e.agentId && e.from)
      return { taskId: task.id, projectId: task.projectId, eventId: e.id, agentId: e.agentId, from: e.from };
  }
  if (task.review) return { taskId: task.id, projectId: task.projectId, eventId: task.review.trigger.eventId, agentId: task.review.trigger.agentId, from: task.review.trigger.from };
  return null;
}

/**
 * Apply the project's draft (AUTO-REVIEW-SPEC §12.3): replaces rules, guidance and rounds, turns Auto review on.
 * `at` is the draft the person looked at; a newer draft (or none) is refused as stale so nothing unseen is applied.
 */
export function applyReviewDraft(
  store: BoardStore,
  input: { projectId: string; at: string; confirm: boolean; exclude?: readonly string[]; add?: readonly { name: string; argv: string[] }[] },
) {
  return store.transaction<{ status: "stale" } | { status: "confirm" } | { status: "applied"; revision: number }>((b) => {
    const p = b.projects.find((x) => x.id === input.projectId);
    if (!p || p.archivedAt) throw new Error("Project not found.");
    const draft = p.reviewDraft;
    if (!draft || draft.at !== input.at) return { value: { status: "stale" as const }, changed: false };
    const current = autoReviewOf(p);
    // The rules changed after the draft was proposed: ask before overwriting them.
    if (!input.confirm && reviewConfigHash(current) !== draft.baseHash) return { value: { status: "confirm" as const }, changed: false };
    // Only the analysis's new checks can be left out; the rest of the draft is applied as shown (§6.4).
    const added = new Set((draft.added || []).map((x) => x.id));
    const skip = new Set((input.exclude || []).filter((id) => added.has(id)));
    const goal = draft.goal ?? current.goal;
    const rules: ReviewRule[] = draft.rules.filter((r) => !skip.has(r.id));
    // Ticked repository commands join as command checks; a command already there or one over the limit is skipped.
    for (const c of input.add || []) {
      if (rules.some((r) => r.kind === "command" && r.argv.join("\0") === c.argv.join("\0")) || !ruleFits(rules, "command")) continue;
      rules.push({ id: ruleId(c.name, new Set([GOAL_ID, ...rules.map((r) => r.id)])), name: c.name, kind: "command", argv: [...c.argv] });
    }
    p.autoReview = {
      enabled: true,
      maxRounds: draft.maxRounds ?? current.maxRounds,
      rules,
      ...(goal ? {} : { goal: false }),
      ...((draft.guidance ?? current.guidance) ? { guidance: draft.guidance ?? current.guidance } : {}),
    };
    delete p.reviewDraft;
    p.revision++;
    p.updatedAt = new Date().toISOString();
    return { value: { status: "applied" as const, revision: p.revision }, changed: true };
  });
}

/** Discard the draft the person looked at (`at`); a newer draft (or none) is refused as stale. Nothing else changes. */
export function discardReviewDraft(store: BoardStore, input: { projectId: string; at: string }) {
  return store.transaction<{ status: "stale" } | { status: "discarded" }>((b) => {
    const p = b.projects.find((x) => x.id === input.projectId);
    if (!p?.reviewDraft || p.reviewDraft.at !== input.at) return { value: { status: "stale" as const }, changed: false };
    delete p.reviewDraft;
    return { value: { status: "discarded" as const }, changed: true };
  });
}
