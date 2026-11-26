import { enabledStatuses, laneEnabled } from "./lanes";
import {
  isWorkStatus,
  legacyStatus,
  workStatuses,
  type BoardEvent,
  type HistoryStatus,
  type Project,
  type Review,
  type ReviewItem,
  type Status,
  type Task,
} from "./model";

/** Rule ids on the status changes an automatic review makes (AUTO-REVIEW-SPEC §3.2). */
export const reworkRule = "R1";
export const reviewFailedRule = "R2";
export const reviewStartedAction = "review_started";
export const reviewFinishedAction = "review_finished";
export const defaultCheckTimeoutSec = 600;

/** A project's review settings (GUARDRAILS-SPEC §8): the switch and the rework rounds. What is checked lives in its guardrails. */
export type ReviewConfig = { enabled: boolean; maxRounds: number };
export const defaultAutoReview: ReviewConfig = { enabled: false, maxRounds: 2 };

/**
 * The built-in check "Does what you asked" (AUTO-REVIEW-SPEC §4.2, D12): judged by the review session against the
 * card and what the user said in its sessions. Stored by id only; its name is translated where it is shown.
 */
export const GOAL_ID = "goal";
export const GOAL_NAME = "Does what you asked";
export const goalPrompt =
  "The change does what the user asked for this card: its title and description, and what the user said in the card's conversation. A later instruction replaces an earlier one; something the user said to leave for later is not missing. Judge na when the request is too vague to judge. The acceptance list is the agent's own claim: read it as context, not as proof.";

export function autoReviewOf(project: Pick<Project, "autoReview"> | null | undefined): ReviewConfig {
  const stored = project?.autoReview;
  return stored ? { enabled: stored.enabled, maxRounds: stored.maxRounds } : defaultAutoReview;
}
export const autoReviewEnabled = (project: Pick<Project, "autoReview"> | null | undefined) => !!project?.autoReview?.enabled;
/** A delivery starts a review whenever the switch is on: the built-in check always runs (GUARDRAILS-SPEC §6.1). */
export const autoReviewRuns = autoReviewEnabled;

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
 * The turns on the card since the previous rework review finished (§3.3, 2026-11-26): whether one a person started has
 * ended (`reset`), and whether one that is not the rework turn is still open, its starter unknown (`open`). A turn
 * counts as a person's unless its `agent.turn_ended` says `byUser: false` (a background wake-up); the rework turn (the
 * delivering session's first turn after the review) never counts. Only turns that started after the review count.
 */
function turnsSinceRework(events: readonly BoardEvent[], taskId: string, previous: Review & { finishedAt: string }) {
  const open = new Map<string, "rework" | "other">();
  let reworkStarted = false;
  let reset = false;
  for (const e of events) {
    if (e.taskId !== taskId || e.at <= previous.finishedAt || !e.agentId) continue;
    if (e.action === "agent.turn_started") {
      const rework = !reworkStarted && e.agentId === previous.trigger.agentId;
      if (rework) reworkStarted = true;
      open.set(e.agentId, rework ? "rework" : "other");
    } else if (e.action === "agent.turn_ended") {
      const kind = open.get(e.agentId);
      open.delete(e.agentId);
      if (kind === "other" && e.byUser !== false) reset = true;
    }
  }
  return { reset, open: [...open.values()].includes("other") };
}

/**
 * Whether a new delivery continues the previous review's rework round (§3.3): it asked for rework, and since then no
 * person changed the card's status and no turn a person started ended on the card (`turnsSinceRework`).
 */
export function continuesRound(events: readonly BoardEvent[], taskId: string, previous: Review | undefined): boolean {
  if (previous?.state !== "rework" || !previous.finishedAt) return false;
  const at = previous.finishedAt;
  if (events.some((e) => e.taskId === taskId && e.at > at && e.actor === "human" && e.action === "status_changed")) return false;
  return !turnsSinceRework(events, taskId, { ...previous, finishedAt: at }).reset;
}

/**
 * The round depends on a turn whose end is not recorded yet (§3.3): its `byUser` decides it, so the review waits for
 * the delivering turn's end to be recorded before it counts.
 */
export function roundAwaitsTurnEnd(events: readonly BoardEvent[], taskId: string, previous: Review | undefined): boolean {
  if (previous?.state !== "rework" || !previous.finishedAt) return false;
  const scan = turnsSinceRework(events, taskId, { ...previous, finishedAt: previous.finishedAt });
  return !scan.reset && scan.open;
}

/** Reviews of one card that judged something before automatic rework stops (§3.3). */
export const reviewCapPerCard = 10;
/** The review counts toward the card's cap (§3.3): it judged something. Cancelled and unavailable do not. */
export const countsTowardCap = (state: Review["state"]) => state === "passed" || state === "rework" || state === "failed" || state === "needs_user";

/** An agent delivered the card and its review has not started yet (§3.1): the previous review is out of date. */
export const reviewWaiting = (task: Pick<Task, "status" | "reviewWaiting" | "archivedAt">) =>
  !!task.reviewWaiting && !task.archivedAt && task.status === "in_review";

/** The review the card face and Attention show: only while the card is still where that review left it (§7). */
export function visibleReview(task: Pick<Task, "status" | "review" | "reviewWaiting" | "archivedAt">): Review | null {
  const review = task.review;
  if (!review || task.archivedAt || reviewWaiting(task)) return null;
  const status = task.status;
  switch (review.state) {
    case "running":
    case "passed":
    case "needs_user":
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
export function reviewSignal(task: Pick<Task, "status" | "review" | "reviewWaiting" | "archivedAt">): { state: "failed" | "unavailable" | "needs_user"; key: string } | null {
  const review = visibleReview(task);
  // Once a person acted on the card after the review, the card face still shows the result but it no longer calls (§3.5).
  if (!review || !calls(review.state) || review.handledAt) return null;
  return { state: review.state as "failed" | "unavailable" | "needs_user", key: `review:${review.state}:${review.startedAt}` };
}
/** A finished review state that calls a person through Attention (§3.2). */
const calls = (state: Review["state"]) => state === "failed" || state === "unavailable" || state === "needs_user";

/**
 * A person acted on the card (§3.5, D18): a turn started in one of its sessions (a failed or unavailable review sends
 * no rework message, so such a turn comes from a person) or a person changed its status. Marks the finished failed or
 * unavailable review handled, once; true when it changed. Opening the card or Mark as read is not an action.
 */
export function markReviewHandled(task: Pick<Task, "review">, event: Pick<BoardEvent, "actor" | "action" | "byUser">, at: string): boolean {
  const review = task.review;
  if (!review || review.handledAt || !review.finishedAt || !calls(review.state)) return false;
  const person = event.actor === "human" && event.action === "status_changed";
  // needs_user asks a person to act: only a person's status change or a turn a person's message started (known when it
  // ends) handles it, never a background wake. Failed and unavailable end at any turn start.
  const turn = review.state === "needs_user" ? event.action === "agent.turn_ended" && event.byUser === true : event.action === "agent.turn_started";
  if (!person && !turn) return false;
  review.handledAt = at;
  return true;
}

/**
 * A person moved the card out of In review or archived it (§3.2, 2026-11-26): its running review is cancelled now, in
 * the same write; a held result is dropped. True when a running review was stopped, so its work can be stopped too.
 */
export function stopReviewForPerson(task: Pick<Task, "review" | "status" | "archivedAt">, event: Pick<BoardEvent, "actor" | "action" | "to">, at: string): boolean {
  const review = task.review;
  if (!review || event.actor !== "human") return false;
  if ((event.action === "status_changed" || event.action === "archive_changed") && review.held) delete review.held;
  const away = (event.action === "status_changed" && event.to !== "in_review") || (event.action === "archive_changed" && !!task.archivedAt);
  if (!away || review.state !== "running") return false;
  task.review = { ...review, state: "cancelled", reason: "A person moved the card during the review.", finishedAt: at };
  return true;
}

/** Where a person's Rerun may start (§3.5): In review, or Blocked after the review failed (it moves to In review first). */
export const rerunnablePlace = (task: Pick<Task, "status" | "review">) =>
  task.status === "in_review" || (task.status === "blocked" && task.review?.state === "failed");

/** While a review waits to start or runs, the card's unread sessions are not counted (§3.2). */
export const reviewing = (task: Pick<Task, "status" | "review" | "reviewWaiting" | "archivedAt">) =>
  reviewWaiting(task) || visibleReview(task)?.state === "running";

const ansi = /\u001b\[[0-?]*[ -/]*[@-~]/g;
/** The end of a check's output, without colour codes, at most `max` characters. */
export function outputTail(text: string, max: number) {
  const clean = text.replace(ansi, "").replace(/\r\n?/g, "\n").trimEnd();
  return clean.length > max ? clean.slice(clean.length - max) : clean;
}

/** An item's result counts as passing: passed, or not applicable to this change. */
export const itemPassed = (i: Pick<ReviewItem, "state">) => i.state === "passed" || i.state === "na";
/** For the strip and the counts: passing, or a minor fail, which never decides the review (§3.6). */
const countsAsPassed = (i: Pick<ReviewItem, "state" | "severity">) => itemPassed(i) || (i.state === "failed" && isMinor(i));

/** A minor finding is shown but never decides the review (AUTO-REVIEW-SPEC §3.6); a missing severity is major. */
export const isMinor = (i: Pick<ReviewItem, "severity">) => i.severity === "minor";
/** An item that decides the review (§3.6): gating and not minor. */
export const decisive = (i: Pick<ReviewItem, "gating" | "severity">) => i.gating && !isMinor(i);

/**
 * The overall result (GUARDRAILS-SPEC §6.3 step 3, AUTO-REVIEW-SPEC §4.5), from the gating items only (an observing
 * command or a demoted card item never counts): a decisive failed → failed; else any that could not finish →
 * unavailable; else a decisive needs_user → needs_user; else passed. Disputed items and minor findings are not failures.
 */
export function reviewVerdict(items: readonly Pick<ReviewItem, "gating" | "state" | "severity">[]): "passed" | "failed" | "unavailable" | "needs_user" {
  const gating = items.filter((i) => i.gating);
  if (gating.some((i) => i.state === "failed" && decisive(i))) return "failed";
  if (gating.some((i) => i.state === "unavailable" || i.state === "queued" || i.state === "running")) return "unavailable";
  if (gating.some((i) => i.state === "needs_user" && decisive(i))) return "needs_user";
  return "passed";
}

/** What a Needs you review asks the person to do (§9.4): each decisive needs_user item's "name: detail", at most 500 characters. */
export function needsUserReason(items: readonly ReviewItem[]): string {
  const text = items
    .filter((i) => i.state === "needs_user" && decisive(i))
    .map((i) => `${i.kind === "goal" ? GOAL_NAME : i.name}: ${(i.detail || "").replace(/\s+/g, " ").trim()}`)
    .join("; ");
  return text.length > 500 ? `${text.slice(0, 499)}…` : text;
}

/** The reason on a card item that no longer decides the review (§3.6). */
export const demotedReason = "Failed 3 times in a row with a different finding each time, so it no longer decides the review.";
/** The reason on a rework-round finding that is not this round's regression (§3.6). */
export const notThisRoundReason = "Not caused by this round's changes.";
/** Decisive fails in a row, each different from the others, after which a card item is demoted (§3.6). */
export const demoteAfter = 3;

/** A review finding as the card item's history keeps it (GUARDRAILS-SPEC §3.3): `file:line — detail`, at most 200 characters. */
export function findingText(i: Pick<ReviewItem, "detail" | "file" | "line" | "reason">): string {
  const where = i.file ? `${i.file}${i.line ? `:${i.line}` : ""} — ` : "";
  const text = `${where}${(i.detail || i.reason || "").replace(/\s+/g, " ").trim()}`;
  return text.length > 200 ? text.slice(0, 200) : text;
}
const placeOf = (finding: string) => /^(\S+:\d+) — /.exec(finding)?.[1] ?? null;
/** Words of a finding for comparison: English by word, Chinese, Japanese and Korean by character, lowercase. */
function wordsOf(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.toLowerCase().matchAll(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[\p{L}\p{N}_]+/gu)) out.add(m[0]);
  return out;
}
/**
 * Two findings say the same thing (§3.6): they cite the same file and line, or their word sets overlap by a Jaccard
 * index of at least 0.5.
 */
export function sameFinding(a: string, b: string): boolean {
  const pa = placeOf(a);
  if (pa && pa === placeOf(b)) return true;
  const wa = wordsOf(a),
    wb = wordsOf(b);
  if (!wa.size && !wb.size) return true;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / (wa.size + wb.size - shared) >= 0.5;
}
/** The card item's earlier decisive fails plus this one are `demoteAfter` findings that all differ from each other (§3.6). */
export function shouldDemote(earlier: readonly string[], finding: string): boolean {
  const all = [...earlier.slice(-(demoteAfter - 1)), finding];
  if (all.length < demoteAfter) return false;
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) if (sameFinding(all[i]!, all[j]!)) return false;
  return true;
}

/**
 * A card item's fail history after a review (§3.6): a decisive fail adds its finding (the last `demoteAfter` kept);
 * passed, na and a minor fail clear it; needs_user, disputed, skipped and unavailable leave it as it is (undefined).
 */
export function nextFails(earlier: readonly string[] | undefined, item: ReviewItem): string[] | undefined {
  if (item.state === "failed" && !isMinor(item)) return [...(earlier || []), findingText(item)].slice(-demoteAfter);
  if (item.state === "passed" || item.state === "na" || item.state === "failed") return [];
  return undefined;
}

/** Files a `git diff` text touches: the new path of each `diff --git a/… b/…` header. */
export function diffPaths(diff: string): Set<string> {
  const out = new Set<string>();
  // Either side may be C-quoted by Git (a non-ASCII byte, a tab, a quote…); the new path is the b side.
  for (const m of diff.matchAll(/^diff --git (?:"a\/(?:[^"\\]|\\.)*"|a\/.+?) (?:"b\/((?:[^"\\]|\\.)*)"|b\/(.+))$/gm))
    out.add(m[1] !== undefined ? unquoteGitPath(`"${m[1]}"`) : m[2]!.trim());
  return out;
}

const gitEscapes: Record<string, string> = { a: "\x07", b: "\b", t: "\t", n: "\n", v: "\v", f: "\f", r: "\r", '"': '"', "\\": "\\" };
/**
 * A path as Git prints it without `-z`: one with a non-ASCII byte, a tab, a quote, a backslash or another control
 * character is C-quoted ("\346\226\207.ts"); octal escapes are UTF-8 bytes. Any other text is returned as it is.
 */
export function unquoteGitPath(path: string): string {
  if (path.length < 2 || !path.startsWith('"') || !path.endsWith('"')) return path;
  // The quoted body is ASCII: each escape becomes its byte as %XX, so one decode rebuilds the UTF-8 name.
  const encoded = path.slice(1, -1).replace(/\\([0-7]{3}|.)|[^\\]/g, (all: string, escape?: string) => {
    if (escape === undefined) return encodeURIComponent(all);
    if (/^[0-7]{3}$/.test(escape)) return `%${parseInt(escape, 8).toString(16).padStart(2, "0")}`;
    return encodeURIComponent(gitEscapes[escape] ?? escape);
  });
  try {
    return decodeURIComponent(encoded);
  } catch {
    return path;
  }
}

const normalizedQuote = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * B1 (§6.3): a `fail` stands only with evidence: a file in the diff, an existing repository file, or a quote of the
 * card or the user's words. `existing` holds the cited files the daemon found in the repository; `sources` is the text
 * the reviewer was given that a quote may come from (card title and description, the filtered conversation, the
 * check's own user words). A quote counts only when it appears in one of them, ignoring case and runs of whitespace.
 */
export function hasEvidence(
  v: { file?: string; quote?: string },
  diffFiles: ReadonlySet<string>,
  existing: ReadonlySet<string>,
  sources: readonly (string | null | undefined)[],
): boolean {
  const quote = normalizedQuote(v.quote ?? "");
  if (quote && sources.some((s) => !!s && normalizedQuote(s).includes(quote))) return true;
  return !!v.file && (diffFiles.has(v.file) || existing.has(v.file));
}

export type ReviewProgress = {
  passed: number;
  failed: number;
  total: number;
  phase: "starting" | "running" | "judging" | "done";
  /** The command running now. */
  current?: string;
  /** How many checks the review session is judging now. */
  judging?: number;
};
/**
 * The card's review strip (GUARDRAILS-SPEC §7.1.1): passed (na included) and failed among the gating items, which
 * are the total (observing commands and disputed findings are not); what runs now. Clients only render it.
 */
export function reviewProgress(review: Pick<Review, "items" | "state">): ReviewProgress {
  const counted = review.items.filter((i) => i.gating && i.state !== "disputed");
  const out: ReviewProgress = {
    passed: counted.filter(countsAsPassed).length,
    failed: counted.filter((i) => i.state === "failed" && !isMinor(i)).length,
    total: counted.length,
    phase: "done",
  };
  if (review.state !== "running") return out;
  const command = review.items.find((i) => i.kind === "command" && i.state === "running");
  const judging = review.items.filter((i) => i.kind !== "command" && i.state === "running").length;
  if (command) return { ...out, phase: "running", current: command.name };
  if (judging) return { ...out, phase: "judging", judging };
  const ended = review.items.some((i) => i.state !== "queued" && i.state !== "running" && i.state !== "disputed");
  return { ...out, phase: ended ? "running" : "starting" };
}

/** The item's label in agent-facing text: the built-in check's name, or the user's words for a guideline or card item. */
function itemLabel(item: ReviewItem, words: ReadonlyMap<string, string>) {
  if (item.kind === "goal") return GOAL_NAME;
  if (item.kind === "command") return item.name;
  return `"${(words.get(item.id) || item.name).replace(/\s+/g, " ").trim()}"`;
}

/** One line for an item that did not pass, for the rework message. Its id, so the agent can dispute it. */
export function failureLine(item: ReviewItem, words: ReadonlyMap<string, string> = new Map()): string {
  const id = ` [id: ${item.id}]`;
  if (item.state === "needs_user") return `? ${itemLabel(item, words)} — ${item.detail || "needs the user"}${id}`;
  if (item.kind === "command") {
    const command = (item.argv || []).join(" ");
    if (item.timedOut) return `✗ ${item.name} (${command}) timed out.${id}`;
    return `✗ ${item.name} (${command}) ${item.exitCode === null || item.exitCode === undefined ? "did not finish" : `exited ${item.exitCode}`}.${id}`;
  }
  const where = item.file ? ` (${item.file}${item.line ? `:${item.line}` : ""})` : "";
  return `✗ [${item.severity ?? "major"}] ${itemLabel(item, words)} — ${item.detail || item.reason || "not met"}${where}${id}`;
}

/** The decisive failed items as one short note. */
export const failureSummary = (review: Pick<Review, "items">) =>
  review.items.filter((i) => i.state === "failed" && decisive(i)).map((i) => (i.kind === "goal" ? GOAL_NAME : i.name)).join(", ");

/**
 * The marked rework message sent to the delivering session (GUARDRAILS-SPEC §6.5). `words`: the user's own words for
 * a guideline or card item, by item id. Agent-facing English.
 */
export function reworkMessage(review: Review, words: ReadonlyMap<string, string> = new Map()): string {
  const lines = [`[Flowly auto review · rework ${review.round}/${review.maxRounds}]`];
  const commands = review.items.filter((i) => i.kind === "command" && i.gating);
  const judged = review.items.filter((i) => i.kind !== "command");
  if (commands.length) {
    lines.push(`Commands: ${commands.filter(itemPassed).length}/${commands.length} passed`);
    for (const c of commands.filter((x) => x.state === "failed")) {
      lines.push(failureLine(c));
      if (c.tail) lines.push(...outputTail(c.tail, 2000).split("\n").map((l) => `    ${l}`));
    }
  }
  if (judged.length && judged.every((i) => i.state === "skipped" || i.state === "disputed")) lines.push("Review: skipped (a command failed)");
  else for (const i of judged.filter((x) => x.state === "failed" && decisive(x))) lines.push(failureLine(i, words));
  // What only the user can do (§3.6): the agent must not work around it.
  const asks = judged.filter((x) => x.state === "needs_user" && decisive(x));
  if (asks.length) {
    lines.push("Needs the user (do not work around these; mention them in your delivery note):");
    for (const i of asks) lines.push(failureLine(i, words));
  }
  lines.push("Fix these, rerun the checks, update the acceptance list and deliver to In review again. If a finding is wrong, deliver with disputes=[{id, reason}].");
  return lines.join("\n");
}

/** What flowly_get_task shows of the card's review (§5.2): no fingerprint. */
export function reviewContext(review: Review | undefined) {
  if (!review) return undefined;
  return {
    state: review.state,
    round: review.round,
    maxRounds: review.maxRounds,
    ...(review.reason ? { reason: review.reason } : {}),
    items: review.items.map((i) => ({
      id: i.id,
      kind: i.kind,
      name: i.kind === "goal" ? GOAL_NAME : i.name,
      gating: i.gating,
      state: i.state,
      ...(i.severity ? { severity: i.severity } : {}),
      ...(i.argv ? { command: i.argv.join(" ") } : {}),
      ...(i.exitCode !== undefined ? { exitCode: i.exitCode } : {}),
      ...(i.timedOut ? { timedOut: true } : {}),
      ...(i.tail ? { tail: outputTail(i.tail, 2000) } : {}),
      ...(i.detail ? { detail: i.detail } : {}),
      ...(i.file ? { file: i.file } : {}),
      ...(i.line ? { line: i.line } : {}),
      ...(i.quote ? { quote: i.quote } : {}),
      ...(i.reason ? { reason: i.reason } : {}),
      ...(i.disputeReason ? { disputeReason: i.disputeReason } : {}),
    })),
    ...(review.shape ? { shape: review.shape } : {}),
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
