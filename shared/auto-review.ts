import { enabledStatuses, laneEnabled } from "./lanes";
import {
  isWorkStatus,
  legacyStatus,
  workStatuses,
  autoReviewLimits,
  reviewRulesSchema,
  type BoardEvent,
  type HistoryStatus,
  type Project,
  type Review,
  type ReviewDraft,
  type ReviewRule,
  type RuleResult,
  type Status,
  type Task,
  type Workpad,
} from "./model";
import { validationFreshness } from "./workpad";

/** Rule ids on the status changes an automatic review makes (AUTO-REVIEW-SPEC §3.2). */
export const reworkRule = "R1";
export const reviewFailedRule = "R2";
export const reviewStartedAction = "review_started";
export const reviewFinishedAction = "review_finished";
export const defaultCheckTimeoutSec = 600;

/** A project's review settings with rules, P1 `checks` read as command rules (§8.1 migration). `goal`: the built-in check. */
export type ReviewConfig = { enabled: boolean; maxRounds: number; goal: boolean; rules: ReviewRule[]; guidance?: string };
export const defaultAutoReview: ReviewConfig = { enabled: false, maxRounds: 2, goal: true, rules: [] };

/**
 * The built-in check "Does what you asked" (AUTO-REVIEW-SPEC §4.2, D12): judged by the review session against the
 * card and what the user said in its sessions. Stored by id only; its name is translated where it is shown.
 */
export const GOAL_ID = "goal";
export const GOAL_NAME = "Does what you asked";
export const goalRule: Extract<ReviewRule, { kind: "llm" }> = {
  id: GOAL_ID,
  name: GOAL_NAME,
  kind: "llm",
  prompt:
    "The change does what the user asked for this card: its title and description, and what the user said in the card's conversation. A later instruction replaces an earlier one; something the user said to leave for later is not missing. Judge na when the request is too vague to judge. Do not judge against the workpad: it is the agent's own report.",
};

/** The card whose agent proposed the draft; none for the history analysis's draft (§6.2). */
export const draftTaskId = (draft: Pick<ReviewDraft, "by"> | undefined): string | undefined => (draft && "taskId" in draft.by ? draft.by.taskId : undefined);

/** Whether one more rule of this kind fits the project's limit (10 of each kind, §8.1). */
export const ruleFits = (rules: readonly Pick<ReviewRule, "kind">[], kind: ReviewRule["kind"]) =>
  rules.filter((r) => r.kind === kind).length < (kind === "command" ? autoReviewLimits.commandRules : autoReviewLimits.llmRules);
/** The readable refusal when a kind is full. */
export const ruleLimitMessage = (kind: ReviewRule["kind"]) =>
  `This project already has ${kind === "command" ? autoReviewLimits.commandRules : autoReviewLimits.llmRules} ${kind === "command" ? "command" : "LLM"} checks. Remove one first.`;

/** A new draft's `at`: now, and always after the draft it replaces, so Apply/Discard can tell them apart (§6.4). */
export const nextDraftAt = (prior: Pick<ReviewDraft, "at"> | undefined, now: number) =>
  new Date(Math.max(now, prior ? Date.parse(prior.at) + 1 : 0)).toISOString();

/** A rule id from a name: lowercase slug, unique against `taken`. */
export function ruleId(name: string, taken: ReadonlySet<string> = new Set()): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32).replace(/-+$/, "") || "rule";
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

export function autoReviewOf(project: Pick<Project, "autoReview"> | null | undefined): ReviewConfig {
  const stored = project?.autoReview;
  if (!stored) return defaultAutoReview;
  let rules = stored.rules;
  if (!rules) {
    const taken = new Set<string>();
    rules = (stored.checks || []).map((c) => {
      const id = ruleId(c.name, taken);
      taken.add(id);
      return { id, name: c.name, kind: "command" as const, argv: [...c.argv], ...(c.timeoutSec ? { timeoutSec: c.timeoutSec } : {}) };
    });
  }
  return { enabled: stored.enabled, maxRounds: stored.maxRounds, goal: stored.goal !== false, rules, ...(stored.guidance ? { guidance: stored.guidance } : {}) };
}
/** The project's switch: the hard workpad gate (L1) applies. */
export const autoReviewEnabled = (project: Pick<Project, "autoReview"> | null | undefined) => !!project?.autoReview?.enabled;
/** The rules a delivery of this card runs: not paused, and its type listed or no type filter (§12.1, D10). */
export function effectiveRules(project: Pick<Project, "autoReview"> | null | undefined, task?: Pick<Task, "type"> | null): ReviewRule[] {
  return autoReviewOf(project).rules.filter((r) => !r.off && (!r.types?.length || !task?.type || r.types.includes(task.type)));
}
/** Every check a delivery of this card runs, in order: the built-in check when on, then the rules in effect (§4.2). */
export function reviewChecks(project: Pick<Project, "autoReview"> | null | undefined, task?: Pick<Task, "type"> | null): ReviewRule[] {
  return [...(autoReviewOf(project).goal ? [goalRule] : []), ...effectiveRules(project, task)];
}
/** A delivery starts a review: the switch is on, the card is not the setup card, and some check applies to it. */
export const autoReviewRuns = (project: Pick<Project, "autoReview"> | null | undefined, task?: Pick<Task, "type" | "reviewSetup"> | null) =>
  autoReviewEnabled(project) && !task?.reviewSetup && reviewChecks(project, task).length > 0;
/** Judgement checks in use: the built-in one or an unpaused LLM rule (telemetry `f_auto_review_llm`, the cost line). */
export const judgesWithLlm = (config: Pick<ReviewConfig, "goal" | "rules">) => config.goal || config.rules.some((r) => r.kind === "llm" && !r.off);
export const hasLlmRules = (project: Pick<Project, "autoReview"> | null | undefined) => autoReviewEnabled(project) && judgesWithLlm(autoReviewOf(project));

/** Validates an agent's proposed rule set; every problem as one line (REVIEW_RULES_INVALID, §12.3). */
export function checkProposedRules(raw: unknown): { rules: ReviewRule[] } | { problems: string[] } {
  const parsed = reviewRulesSchema.safeParse(raw);
  if (parsed.success) return { rules: parsed.data };
  const problems = parsed.error.issues.map((issue) => {
    const where = issue.path.length ? `rules${issue.path.map((p) => (typeof p === "number" ? `[${p}]` : `.${String(p)}`)).join("")}: ` : "";
    return `${where}${issue.message}`;
  });
  // Zod skips the list checks once an element fails; repeat them on the raw list so every problem comes back at once.
  if (Array.isArray(raw)) {
    const items = raw as { id?: unknown; kind?: unknown }[];
    const seen = new Set<unknown>();
    items.forEach((item, index) => {
      const message = `Duplicate rule id "${String(item?.id)}".`;
      if (item?.id !== undefined && seen.has(item.id) && !problems.includes(`rules[${index}].id: ${message}`)) problems.push(`rules[${index}].id: ${message}`);
      seen.add(item?.id);
    });
    const count = (kind: string) => items.filter((i) => i?.kind === kind).length;
    if (count("command") > autoReviewLimits.commandRules && !problems.includes(`At most ${autoReviewLimits.commandRules} command rules.`)) problems.push(`At most ${autoReviewLimits.commandRules} command rules.`);
    if (count("llm") > autoReviewLimits.llmRules && !problems.includes(`At most ${autoReviewLimits.llmRules} LLM rules.`)) problems.push(`At most ${autoReviewLimits.llmRules} LLM rules.`);
  }
  return { problems };
}

/** A stable hash of what Apply replaces, to tell whether the rules changed since a draft was proposed. */
export function reviewConfigHash(config: Pick<ReviewConfig, "rules" | "guidance" | "maxRounds"> & { goal?: boolean }): string {
  // goal joins the hash only when off, so drafts proposed before it existed keep their hash.
  const text = JSON.stringify({ rules: config.rules, guidance: config.guidance ?? "", maxRounds: config.maxRounds, ...(config.goal === false ? { goal: false } : {}) });
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return `${text.length}:${(h >>> 0).toString(16)}`;
}

/** What a draft changes against the current rules, by id (§12.3). */
export function draftDiff(current: readonly ReviewRule[], draft: readonly ReviewRule[]) {
  const before = new Map(current.map((r) => [r.id, r]));
  const after = new Map(draft.map((r) => [r.id, r]));
  return {
    added: draft.filter((r) => !before.has(r.id)).map((r) => r.id),
    changed: draft.filter((r) => before.has(r.id) && JSON.stringify(before.get(r.id)) !== JSON.stringify(r)).map((r) => r.id),
    removed: current.filter((r) => !after.has(r.id)).map((r) => r.id),
  };
}

/** One line for a rule in lists: the command or the prompt's first line, and its type filter. */
export function ruleSummary(rule: ReviewRule): string {
  const body = rule.kind === "command" ? joinCommand(rule.argv) : rule.prompt.split("\n")[0];
  return rule.types?.length ? `${body} · ${rule.types.join(", ")}` : body;
}

/** Workpad lines that refuse a delivery outright while auto review is on (§4.1): failed and out-of-date checks. */
export function failingItemLines(workpad: Workpad): string[] {
  const lines: string[] = [];
  for (const v of workpad.validation) {
    if (v.state === "fail") lines.push(`- check failed: ${v.text}`);
    else if (validationFreshness(v, workpad.head) === "stale")
      lines.push(`- check out of date (ran on ${v.sha}, HEAD is now ${workpad.head?.sha}): ${v.text}`);
  }
  return lines;
}

export const workpadFailingMessage = (lines: readonly string[]) =>
  `Auto review is on for this project: ${lines.length} workpad check${lines.length === 1 ? "" : "s"} failed or ${lines.length === 1 ? "is" : "are"} out of date:\n${lines.join("\n")}\nFix them and rerun the checks on the current code before delivering. acknowledgeOpen does not apply.`;

/**
 * Where a failed review sends the card (R1): the work stage it was delivered from when that lane is on,
 * else the latest work stage it was in, else the first enabled one; null when the workflow has none.
 */
export function reworkStage(events: readonly BoardEvent[], task: Pick<Task, "id">, project: Pick<Project, "lanes">, from: HistoryStatus): Status | null {
  const stage = from === legacyStatus ? "development" : from;
  if (isWorkStatus(stage) && laneEnabled(project, stage)) return stage;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.taskId !== task.id || e.action !== "status_changed" || !e.to) continue;
    const to = e.to === legacyStatus ? "development" : e.to;
    if (isWorkStatus(to) && laneEnabled(project, to)) return to;
  }
  return enabledStatuses(project).find((s) => (workStatuses as readonly Status[]).includes(s)) ?? null;
}

/**
 * Whether a new delivery continues the previous review's rework round (§3.3): it asked for rework, and since then no
 * person moved the card and no turn other than the rework one started on the card.
 */
export function continuesRound(events: readonly BoardEvent[], taskId: string, previous: Review | undefined): boolean {
  if (previous?.state !== "rework" || !previous.finishedAt) return false;
  const since = events.filter((e) => e.taskId === taskId && e.at > previous.finishedAt!);
  if (since.some((e) => e.actor === "human" && e.action === "status_changed")) return false;
  return since.filter((e) => e.action === "agent.turn_started").length <= 1;
}

/** The review the card face and Attention show: only while the card is still where that review left it (§7). */
export function visibleReview(task: Pick<Task, "status" | "review" | "archivedAt">): Review | null {
  const review = task.review;
  if (!review || task.archivedAt) return null;
  const status = task.status;
  switch (review.state) {
    case "running":
    case "passed":
      return status === "in_review" ? review : null;
    case "rework":
      return isWorkStatus(status) ? review : null;
    case "failed":
      return status === "blocked" || status === "in_review" ? review : null;
    case "unavailable":
      return status === "in_review" || isWorkStatus(status) ? review : null;
    case "cancelled":
      // Never silent: the card shows it was not reviewed, and Rerun is one tap away.
      return status === "in_review" ? review : null;
    default:
      return null;
  }
}

/**
 * A finished review that needs a person (§7): its Attention signal key, else null. A pass is not one: it only releases
 * the unread sessions the running review held back, which Mark as read clears as usual.
 */
export function reviewSignal(task: Pick<Task, "status" | "review" | "archivedAt">): { state: "failed" | "unavailable"; key: string } | null {
  const review = visibleReview(task);
  if (!review || (review.state !== "failed" && review.state !== "unavailable")) return null;
  return { state: review.state, key: `review:${review.state}:${review.startedAt}` };
}

/** While a review runs, the card's unread sessions are not counted (§3.2). */
export const reviewing = (task: Pick<Task, "status" | "review" | "archivedAt">) => visibleReview(task)?.state === "running";

const ansi = /\u001b\[[0-?]*[ -/]*[@-~]/g;
/** The end of a check's output, without colour codes, at most `max` characters. */
export function outputTail(text: string, max: number) {
  const clean = text.replace(ansi, "").replace(/\r\n?/g, "\n").trimEnd();
  return clean.length > max ? clean.slice(clean.length - max) : clean;
}

/** Rules that ended (not queued or running) and all rules, for "Reviewing n/N" (§12.6). */
export function reviewProgress(review: Pick<Review, "rules">) {
  return { done: review.rules.filter((r) => r.state !== "queued" && r.state !== "running").length, total: review.rules.length };
}

/** A rule's result counts as passing: passed, or not applicable to this change. */
export const rulePassed = (r: Pick<RuleResult, "state">) => r.state === "passed" || r.state === "na";

/** One line for a rule that did not pass, for the rework message and the review_finished note. */
export function ruleFailureLine(r: RuleResult): string {
  if (r.kind === "command") {
    const command = (r.argv || []).join(" ");
    if (r.timedOut) return `✗ ${r.name} (${command}) timed out.`;
    return `✗ ${r.name} (${command}) ${r.exitCode === null || r.exitCode === undefined ? "did not finish" : `exited ${r.exitCode}`}.`;
  }
  const where = r.file ? ` (${r.file}${r.line ? `:${r.line}` : ""})` : "";
  return `✗ ${r.name}: ${r.detail || r.reason || "not met"}${where}`;
}

/** The failed rules as one short note. */
export const failureSummary = (review: Pick<Review, "rules">) =>
  review.rules.filter((r) => r.state === "failed").map((r) => r.name).join(", ");

/** The marked rework message sent to the delivering session (§5, §12.6). Agent-facing English. */
export function reworkMessage(review: Review): string {
  const lines = [`[Flowly auto review · rework ${review.round}/${review.maxRounds}]`];
  const commands = review.rules.filter((r) => r.kind === "command");
  const llm = review.rules.filter((r) => r.kind === "llm");
  if (commands.length) {
    lines.push(`Commands: ${commands.filter(rulePassed).length}/${commands.length} passed`);
    for (const r of commands.filter((x) => x.state === "failed")) {
      lines.push(ruleFailureLine(r));
      if (r.tail) lines.push(...outputTail(r.tail, 2000).split("\n").map((l) => `    ${l}`));
    }
  }
  if (llm.length) {
    if (llm.every((r) => r.state === "skipped")) lines.push("LLM review: skipped (command rules failed)");
    else {
      lines.push(`LLM review: ${llm.filter(rulePassed).length}/${llm.length} passed`);
      for (const r of llm.filter((x) => x.state === "failed")) lines.push(ruleFailureLine(r));
    }
  }
  lines.push("Fix these, rerun the affected checks, update the workpad and deliver to In review again.");
  return lines.join("\n");
}

/** What flowly_get_task shows of the card's review (§5, §12.5): no fingerprint. */
export function reviewContext(review: Review | undefined) {
  if (!review) return undefined;
  return {
    state: review.state,
    round: review.round,
    maxRounds: review.maxRounds,
    ...(review.reason ? { reason: review.reason } : {}),
    rules: review.rules.map((r) => ({
      id: r.id,
      kind: r.kind,
      name: r.name,
      state: r.state,
      ...(r.argv ? { command: r.argv.join(" ") } : {}),
      ...(r.exitCode !== undefined ? { exitCode: r.exitCode } : {}),
      ...(r.timedOut ? { timedOut: true } : {}),
      ...(r.tail ? { tail: outputTail(r.tail, 2000) } : {}),
      ...(r.detail ? { detail: r.detail } : {}),
      ...(r.file ? { file: r.file } : {}),
      ...(r.line ? { line: r.line } : {}),
      ...(r.reason ? { reason: r.reason } : {}),
    })),
    startedAt: review.startedAt,
    ...(review.finishedAt ? { finishedAt: review.finishedAt } : {}),
  };
}

/**
 * Turns a command line typed in project settings into an argument array: split on spaces, with "double" or 'single'
 * quotes keeping spaces inside one argument. No other shell syntax is interpreted; the result never runs in a shell.
 */
export function splitCommand(line: string): string[] {
  const out: string[] = [];
  let current = "",
    quote: string | null = null,
    has = false;
  for (const ch of line.trim()) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
    } else if (/\s/.test(ch)) {
      if (has || current) out.push(current);
      current = "";
      has = false;
    } else current += ch;
  }
  if (has || current) out.push(current);
  return out.filter((a) => a.length);
}

/** An argument array as one line for the settings field: quoted when it has spaces. */
export const joinCommand = (argv: readonly string[]) => argv.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ");

/** The setup card's first message (AUTO-REVIEW-SPEC §12.3). Agent-facing English. */
export const reviewSetupTitle = "Auto review setup";
export function reviewSetupInstructions(): string {
  return [
    "Adjust this project's auto review checks with me. When an agent delivers a card to In review, Flowly runs these checks: command rules run a command in the card's workspace (exit code 0 passes), LLM rules are judged by a review session from the diff and the card. A failure sends the card back to its agent for rework.",
    "",
    "1. Read the repository first: package scripts and build files (package.json, Makefile, justfile, pyproject.toml, …), CI configuration (.github/workflows, …), AGENTS.md / CLAUDE.md / CONTRIBUTING.md, the README, and the current rules in get_task reviewRules.",
    "2. Ask me what deliveries must get right, one group of questions at a time, with the options you suggest from the repository. Use your own question tool.",
    "3. Sort what I want: anything an exit code can decide becomes a command rule, reusing the repository's own scripts. Only what needs judgement becomes an LLM rule; each one checks one thing and says what passing and failing look like, judged from the diff, workpad and delivery note.",
    "4. Run every command rule once in the workspace. Note in your proposal whether it exists, its result on the current code and how long it took. Leave out commands that do not work and tell me why.",
    "5. Suggest card types for each rule where it matters (for example no full test run for docs cards, \"has a regression test\" only for bugfix cards).",
    "6. The built-in check \"Does what you asked\" already judges every delivery against the card and what the user said in its sessions; do not add a rule that repeats it. Leave it on unless I ask to pause it (goal: false).",
    "7. Submit the complete rule set with flowly_propose_review_rules (CLI: review-rules). When I want changes, change them and submit the complete set again; the newer draft replaces the older one. I apply or discard it in the project settings.",
    "8. Do not change repository files. If a check needs a script the repository does not have, ask me first; once I agree, add it as normal work on this card.",
  ].join("\n");
}

/** The user's messages the built-in check reads (§4.2): newest 30, at most 12 000 characters, each at most 1 500. */
export const conversationLimits = { perSession: 200, messages: 30, total: 12_000, each: 1_500 } as const;
const reworkMark = "[Flowly auto review";
// Provider injections, and messages one agent sends another (their full report, not the user's request).
const injectedMessage = /^(<task-notification|<system-reminder|<command-|<local-command|<paseo-system)/;
/** The card's user messages across its sessions, oldest first, without rework messages and injections. */
export function conversationForReview(messages: readonly { at: string; text: string }[]): string[] {
  const kept = messages
    .map((m) => ({ at: m.at, text: m.text.trim() }))
    .filter((m) => m.text && !m.text.startsWith(reworkMark) && !injectedMessage.test(m.text))
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(-conversationLimits.messages)
    .map((m) => (m.text.length > conversationLimits.each ? `${m.text.slice(0, conversationLimits.each)}…` : m.text));
  // Keep the newest within the total; the earliest go first.
  let total = 0;
  const out: string[] = [];
  for (let i = kept.length - 1; i >= 0; i--) {
    if (total + kept[i].length > conversationLimits.total) break;
    total += kept[i].length;
    out.unshift(kept[i]);
  }
  return out;
}
