import { execFile, spawn } from "node:child_process";
import { deliveringBackgroundWork } from "./background-work";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, lstat, readdir, readFile, readlink, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { cardImagePath } from "./card-images";
import { promisify } from "node:util";
import type { PaseoApi } from "@getpaseo/client";
import { laneEnabled, laneProblem } from "../shared/lanes";
import {
  autoReviewLimits,
  type AcceptanceItem,
  type Board,
  type ChangeShape,
  type GitHead,
  type HistoryStatus,
  type Project,
  type ReviewItem,
  type Task,
  type TaskType,
} from "../shared/model";
import {
  GOAL_ID,
  GOAL_NAME,
  autoReviewOf,
  autoReviewRuns,
  continuesRound,
  countsTowardCap,
  conversationForReview,
  userWords,
  type ConversationEntry,
  conversationLimits,
  defaultCheckTimeoutSec,
  demotedReason,
  diffPaths,
  unquoteGitPath,
  failureSummary,
  demotionFinding,
  sameFinding,
  goalPrompt,
  hasEvidence,
  isMinor,
  decisive,
  itemPassed,
  needsUserReason,
  notThisRoundReason,
  outputTail,
  reviewCapPerCard,
  reviewCapReached,
  reviewFailedRule,
  reviewFinishedAction,
  reviewStartedAction,
  reviewVerdict,
  reworkMessage,
  reworkRule,
  reworkStage,
  rerunnablePlace,
  roundAwaitsTurnEnd,
  shouldDemote,
} from "../shared/auto-review";
import { sizeOf, type CardItem, type GuardrailEntry } from "../shared/guardrails";
import type { BoardStore } from "./store";
import { isSummarizer } from "../shared/summary";
import { CODEX_ANSWERS_PREFIX, questionAnswers, type TurnItem } from "../shared/memory";
import type { AnsweredQuestions, SessionQuestions } from "./async-questions";
import { logFailure } from "./error-report";
import { resolveWorktree, worktreeBase } from "./review-worktree";
import { ReviewSnapshots } from "./review-snapshots";

/** The waiting marker of a person's Rerun (§3.5) carries this id prefix instead of a delivery event id. */
const rerunWaitPrefix = "rerun:";

/** An agent delivery to In review that starts a review (AUTO-REVIEW-SPEC §3.1). */
export type DeliveredReview = {
  taskId: string;
  projectId: string;
  eventId: string;
  agentId: string;
  from: HistoryStatus;
  /** The git worktree the delivery named (§3.4): the review runs and reads there instead of the workspace. */
  worktree?: string;
};

/** One check the review session judges (GUARDRAILS-SPEC §6.3): the built-in goal, a guideline or a card item. */
export type JudgedCheck = {
  id: string;
  kind: "goal" | "guideline" | "item";
  /** What to judge: the built-in check's rule, the guideline's sentence, the card item's text. */
  text: string;
  /** The user's own words it came from. */
  quote?: string;
  /** Round ≥ 2: its result in the previous round. */
  previous?: { state: string; severity?: string; detail?: string };
  /** The agent disputed an earlier finding of this check (§6.3 step 2, E1): judge it, but not on that finding again without new evidence. */
  dispute?: { finding?: string; reason: string; round: number };
};
/** What the review session reads (GUARDRAILS-SPEC §6.3). */
export type LlmReviewInput = {
  task: { id: string; title: string; description: string; type?: TaskType; workspaceId: string; /** Absolute paths of the card's images (CARD-IMAGES-SPEC §5). */ images?: string[] };
  checks: JudgedCheck[];
  /** What the user said in the card's sessions, oldest first: messages and answers to question tools (§4.2); null when they could not be read. */
  conversation?: ConversationEntry[] | null;
  /** The workspace is not a worktree: the diff may hold other cards' uncommitted changes (§2 limit 3), and commands do not decide (§6.3 step 1). */
  shared?: boolean;
  /** The card's acceptance list: the agent's own claim, context only. */
  acceptance: AcceptanceItem[];
  deliveryNote: string;
  outputs: string[];
  commands: string[];
  diff: string;
  /** Round ≥ 2 of a rework: `diff` holds only what changed since the previous delivery (§6.3). */
  incremental?: boolean;
  /** Rework round with the previous review's snapshot (§3.6): the paths this round actually changed, at most 200. */
  changedThisRound?: string[];
  /** How many paths this round changed in all; more than `changedThisRound` holds when the list was cut. */
  changedThisRoundTotal?: number;
  /** The git worktree the delivery named (§3.4): where the delivered code is, outside the session's working directory. */
  worktree?: string;
  /** The delivering session, as the review session's parent. */
  parentAgentId: string;
  /**
   * Background tasks (Paseo 0.16) still running in the delivering session when the review starts (§4.4):
   * one line each. Absent when the host has none or they could not be read.
   */
  backgroundWork?: string[];
};
export type LlmVerdict = {
  id: string;
  verdict: "pass" | "fail" | "na" | "needs_user";
  /** For fail and needs_user (AUTO-REVIEW-SPEC §3.6); absent means major. */
  severity?: "blocker" | "major" | "minor";
  detail: string;
  file?: string;
  line?: number;
  quote?: string;
};
/** `signal` aborts when a person moves the card during the review (§3.2): stop waiting and remove the session. */
export type LlmReview = (input: LlmReviewInput, paseo: PaseoApi, signal?: AbortSignal) => Promise<{ model: string; verdicts: LlmVerdict[] }>;

const execute = promisify(execFile);
export type Git = (cwd: string, args: string[]) => Promise<string>;
export const defaultGit: Git = async (cwd, args) =>
  (await execute("git", ["-C", cwd, ...args], { timeout: 20_000, maxBuffer: 16 << 20, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } })).stdout;

const shaPattern = /^[0-9a-f]{4,40}$/;
/** HEAD, branch and dirty state of a workspace, for the review's fingerprint; null when git fails. */
export async function readHead(dir: string, git: Git, now = new Date().toISOString()): Promise<GitHead | null> {
  try {
    const sha = (await git(dir, ["rev-parse", "--short=12", "HEAD"])).trim();
    if (!shaPattern.test(sha)) return null;
    const [branch, status] = await Promise.all([
      git(dir, ["rev-parse", "--abbrev-ref", "HEAD"]).then(
        (s) => s.trim(),
        () => "",
      ),
      git(dir, ["status", "--porcelain"]).then(
        (s) => s,
        () => "",
      ),
    ]);
    return { sha, ...(branch && branch !== "HEAD" ? { branch } : {}), dirty: !!status.trim(), at: now };
  } catch {
    return null;
  }
}

const diffLimit = 64 * 1024;
/**
 * Where a worktree card's own change starts (GUARDRAILS-SPEC §6.2): `git merge-base <baseRef> HEAD`. null for a card
 * without a base ref (directory, linked or older cards) or when git cannot resolve it: the caller falls back.
 */
export async function changeBase(directory: string, baseRef: string | undefined, git: Git = defaultGit): Promise<string | null> {
  const ref = baseRef?.trim();
  if (!ref || ref.startsWith("-")) return null;
  const sha = await git(directory, ["merge-base", ref, "HEAD"]).then(
    (s) => s.trim(),
    () => "",
  );
  return shaPattern.test(sha) ? sha : null;
}

/** Files git does not track and does not ignore (§6.2); `git add -N` is never used, so the index stays as it is. */
async function untrackedFiles(directory: string, git: Git): Promise<string[]> {
  return (await git(directory, ["ls-files", "--others", "--exclude-standard", "-z"])).split("\0").filter((f) => f && !f.endsWith("/"));
}
const newFileLimit = 1 << 20;
/** A new file over 1 MiB is not read, like a binary one (§6.2); an unreadable one neither. */
const readable = (path: string) =>
  stat(path).then(
    (s) => s.isFile() && s.size <= newFileLimit,
    () => false,
  );
/** A new file's lines as `git diff` would count them; a binary file (a NUL byte in the first 8 KiB), one over 1 MiB or an unreadable one counts 0. */
async function fileLines(path: string): Promise<number> {
  if (!(await readable(path))) return 0;
  const data = await readFile(path).catch(() => null);
  if (!data?.length || data.subarray(0, 8192).includes(0)) return 0;
  let lines = 0;
  for (const byte of data) if (byte === 10) lines++;
  return data[data.length - 1] === 10 ? lines : lines + 1;
}
/** `git diff --no-index` exits 1 when the files differ, which for a new file is always: that output is the diff. */
async function newFileDiff(directory: string, file: string, git: Git, shown: string[] = []): Promise<string> {
  return git(directory, ["diff", "--no-index", "--no-color", ...shown, "--", "/dev/null", file]).catch((e: unknown) => {
    const failure = e as { code?: unknown; stdout?: unknown } | null;
    return failure?.code === 1 && typeof failure.stdout === "string" ? failure.stdout : "";
  });
}

/** `git diff` / `git log -p` flags that show each path under the repository's folder name in a linked root (§6.2). */
const prefixArgs = (prefix: string) => (prefix ? [`--src-prefix=a/${prefix}`, `--dst-prefix=b/${prefix}`] : []);

/**
 * What the review session reads, cut at 64 KiB: a worktree card's change since it branched off `baseRef` (or, without
 * one, uncommitted changes plus the last few commits); with `since` (round ≥ 2, §6.3) only what changed since that
 * commit. Untracked new files follow in every mode. Never fails: an empty diff when git does.
 */
export async function reviewDiff(directory: string, options: { since?: string; baseRef?: string } = {}, git: Git = defaultGit): Promise<string> {
  return cut(await repoDiff(directory, options, git, ""));
}
const cut = (text: string) => (text.length > diffLimit ? `${text.slice(0, diffLimit)}\n[diff truncated at 64 KiB]` : text);

/** One repository's part of the review diff; `prefix` (`name/`, or empty) goes before every path it shows. */
async function repoDiff(directory: string, options: { since?: string; baseRef?: string }, git: Git, prefix: string): Promise<string> {
  const run = (args: string[]) => git(directory, args).catch(() => "");
  const shown = prefixArgs(prefix);
  const { since } = options;
  let text: string;
  if (since && shaPattern.test(since)) text = `# Changes since the previous delivery (git diff ${since})\n${(await run(["diff", since, "--no-color", ...shown])) || "(none)\n"}`;
  else {
    const base = await changeBase(directory, options.baseRef, git);
    if (base) text = `# Changes on this card's branch (git diff ${base})\n${(await run(["diff", base, "--no-color", ...shown])) || "(none)\n"}`;
    else {
      const [uncommitted, recent] = await Promise.all([run(["diff", "HEAD", "--no-color", ...shown]), run(["log", "-5", "-p", "--no-color", ...shown, "--format=commit %h %s"])]);
      text = `# Uncommitted changes (git diff HEAD)\n${uncommitted || "(none)\n"}\n# Recent commits\n${recent}`;
    }
  }
  const added = await untrackedFiles(directory, git).catch(() => []);
  if (added.length) {
    text += "\n# New files (untracked)\n";
    for (const file of added) {
      if (text.length > diffLimit) break;
      text += (await readable(join(directory, file))) ? await newFileDiff(directory, file, git, shown) : `new file ${prefix}${file} (over 1 MiB or unreadable, not shown)\n`;
    }
  }
  return text;
}

/**
 * Every path changed since the previous delivery's commit (§3.6, the rework round's regression backstop), with
 * `prefix` before each: the whole list, NUL-separated so Git does not quote it, where the review's diff is cut at
 * 64 KiB. Untracked new files count too. Empty when git fails.
 */
export async function pathsChangedSince(directory: string, since: string, git: Git = defaultGit, prefix = ""): Promise<Set<string>> {
  if (!shaPattern.test(since)) return new Set();
  const [tracked, added] = await Promise.all([git(directory, ["diff", since, "--name-only", "-z"]).catch(() => ""), untrackedFiles(directory, git).catch(() => [])]);
  return new Set([...tracked.split("\0"), ...added].filter(Boolean).map((p) => `${prefix}${p}`));
}

/** A Git repository inside a workspace directory that is not one itself (a linked root, GUARDRAILS-SPEC §6.2). */
export type LinkedRepo = { name: string; directory: string };
const linkedRepoLimit = 20;
/**
 * The repositories a review reads when the workspace directory is not a Git repository (a linked root or a common
 * folder, §6.2): every non-hidden child, link or folder, that holds `.git`, by name, at most 20. Empty when none.
 */
export async function linkedRepos(directory: string): Promise<LinkedRepo[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const repos: LinkedRepo[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith(".") || !(entry.isDirectory() || entry.isSymbolicLink())) continue;
    const path = join(directory, entry.name);
    if (await fileExists(join(path, ".git"))) repos.push({ name: entry.name, directory: path });
    if (repos.length >= linkedRepoLimit) break;
  }
  return repos;
}

/**
 * The review diff of a linked root (§6.2): each repository's part, as `reviewDiff` takes it, under its own heading and
 * with its paths under the repository's name, cut to an equal share of the 64 KiB so one large change cannot hide the
 * other repositories; `since` holds each repository's commit of the previous delivery.
 */
export async function linkedReviewDiff(repos: readonly LinkedRepo[], options: { since?: Readonly<Record<string, string>>; baseRef?: string } = {}, git: Git = defaultGit): Promise<string> {
  const share = Math.floor(diffLimit / Math.max(1, repos.length)) - 200;
  const parts: string[] = [];
  for (const repo of repos) {
    const part = await repoDiff(repo.directory, { since: options.since?.[repo.name], baseRef: options.baseRef }, git, `${repo.name}/`);
    const shown = part.length > share ? `${part.slice(0, share)}\n[${repo.name}: diff truncated]\n` : part;
    parts.push(`## Repository ${repo.name} (its paths start with ${repo.name}/)\n${shown}`);
  }
  return cut(parts.join("\n"));
}

/**
 * HEAD of a linked root (§6.2): each repository's commit by name, and one 12-character digest of them as the review's
 * `sha`, so the fingerprint notices a commit in any of them; dirty when any is. null head when git fails in all.
 */
export async function linkedHead(repos: readonly LinkedRepo[], git: Git, now = new Date().toISOString()): Promise<{ head: GitHead | null; repos: Record<string, string> }> {
  const heads = await Promise.all(repos.map((r) => readHead(r.directory, git, now)));
  const shas: Record<string, string> = {};
  let dirty = false;
  heads.forEach((h, i) => {
    if (!h?.sha) return;
    shas[repos[i]!.name] = h.sha;
    dirty ||= h.dirty;
  });
  const names = Object.keys(shas).sort();
  if (!names.length) return { head: null, repos: shas };
  const sha = createHash("sha1").update(names.map((n) => `${n} ${shas[n]}`).join("\n")).digest("hex").slice(0, 12);
  return { head: { sha, dirty, at: now }, repos: shas };
}

/** Changed files and lines from `git --numstat` lines; a binary file counts 0 lines. */
export function numstatShape(...outputs: string[]): { shape: ChangeShape; paths: Set<string> } {
  const paths = new Set<string>();
  let lines = 0;
  for (const output of outputs)
    for (const line of output.split("\n")) {
      const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line.trim());
      if (!m) continue;
      lines += (m[1] === "-" ? 0 : Number(m[1])) + (m[2] === "-" ? 0 : Number(m[2]));
      // Decode Git's quoting exactly once: the whole record when Git quoted all of it, else the renamed-to part.
      const raw = m[3]!;
      paths.add(/^"(?:[^"\\]|\\.)*"$/.test(raw) ? renamedTo(unquoteGitPath(raw)) : unquoteGitPath(renamedTo(raw)));
    }
  return { shape: { files: paths.size, lines, size: sizeOf(lines) }, paths };
}
/** `a => b` and `dir/{a => b}/f` are the renamed file's new path. */
function renamedTo(path: string) {
  const brace = /^(.*)\{(.*) => (.*)\}(.*)$/.exec(path);
  if (brace) return `${brace[1]}${brace[3]}${brace[4]}`.replace(/\/\//g, "/");
  const plain = /^(.*) => (.*)$/.exec(path);
  return plain ? plain[2] : path;
}

/**
 * The delivery's shape (GUARDRAILS-SPEC §6.2): a worktree card's `git diff <merge-base> --numstat`, otherwise
 * `git diff HEAD --numstat` plus the same last five commits the review's diff reads; untracked new files count too,
 * one file each with their lines. null when git fails.
 */
export async function reviewShape(directory: string, baseRef?: string, git: Git = defaultGit, prefix = ""): Promise<{ shape: ChangeShape; paths: Set<string> } | null> {
  try {
    const base = await changeBase(directory, baseRef, git);
    const tracked = base
      ? [git(directory, ["diff", base, "--numstat"])]
      : [git(directory, ["diff", "HEAD", "--numstat"]), git(directory, ["log", "-5", "--numstat", "--format="])];
    const [outputs, added] = await Promise.all([Promise.all(tracked), untrackedFiles(directory, git)]);
    const { shape, paths } = numstatShape(...outputs);
    let lines = shape.lines;
    for (const file of added) {
      if (paths.has(file)) continue;
      paths.add(file);
      lines += await fileLines(join(directory, file));
    }
    return { shape: { files: paths.size, lines, size: sizeOf(lines) }, paths: prefix ? new Set([...paths].map((p) => `${prefix}${p}`)) : paths };
  } catch {
    return null;
  }
}

/** A linked root's shape (§6.2): the sum of its repositories', paths under each repository's name; null when git fails in all. */
export async function linkedShape(repos: readonly LinkedRepo[], baseRef?: string, git: Git = defaultGit): Promise<{ shape: ChangeShape; paths: Set<string> } | null> {
  const parts = (await Promise.all(repos.map((r) => reviewShape(r.directory, baseRef, git, `${r.name}/`)))).filter((p) => p !== null);
  if (!parts.length) return null;
  const paths = new Set(parts.flatMap((p) => [...p.paths]));
  const lines = parts.reduce((sum, p) => sum + p.shape.lines, 0);
  return { shape: { files: paths.size, lines, size: sizeOf(lines) }, paths };
}

/** Lines apart within which two fails in the same file count as the same finding (§3.6). */
const sameFindingLines = 20;
/** Two fails in the same file, near each other or either without a line: taken as the same finding (§3.6). */
function nearPlace(a: { file?: string; line?: number }, b: { file?: string; line?: number }): boolean {
  if (!a.file || a.file !== b.file) return false;
  return !a.line || !b.line || Math.abs(a.line - b.line) <= sameFindingLines;
}

/** A directory's digest (a Git submodule): its commit is not read, so the regression backstop always counts it (§3.6). */
const directoryDigest = "dir";
/**
 * One path's content as a digest: a file's bytes, read as a stream, and whether it is executable; a symbolic link's
 * target path, never followed; "dir" for a directory (a submodule); "-" when it is gone (deleted) or cannot be read.
 */
async function fileDigest(path: string): Promise<string> {
  const info = await lstat(path).catch(() => null);
  if (!info) return "-";
  if (info.isDirectory()) return directoryDigest;
  if (info.isSymbolicLink()) {
    const target = await readlink(path).catch(() => null);
    // The marker stays outside the hash, so a file whose text equals the target never matches a link.
    return target === null ? "-" : `link:${createHash("sha1").update(target).digest("hex")}`;
  }
  const hash = createHash("sha1");
  // Git tracks the executable bit: a mode change alone is a change. Other files keep their earlier digest.
  if (info.mode & 0o111) hash.update("exec:");
  try {
    for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  } catch {
    return "-";
  }
  return hash.digest("hex");
}
/**
 * The review fingerprint's content digest (AUTO-REVIEW-SPEC §3.6): the working-tree content of each path this
 * delivery changed, under `directory` (a linked root's paths carry the repository's name), as one 16-character digest
 * over the sorted "path digest" lines. A commit or push leaves it as it is; editing one of these files changes it.
 */
export async function contentDigest(directory: string, paths: Iterable<string>): Promise<string> {
  return (await contentSnapshot(directory, paths)).digest;
}
/** The content digest with each path's own digest, kept for the next rework round's regression backstop (§3.6). */
export async function contentSnapshot(directory: string, paths: Iterable<string>): Promise<{ digest: string; files: Map<string, string> }> {
  const sorted = [...new Set(paths)].sort();
  // One file at a time, so memory stays at one read chunk however large the delivery's files are.
  const files = new Map<string, string>();
  for (const p of sorted) files.set(p, await fileDigest(join(directory, p)));
  const digest = createHash("sha1").update(sorted.map((p) => `${p} ${files.get(p)}`).join("\n")).digest("hex").slice(0, 16);
  return { digest, files };
}
/**
 * The paths whose content differs from `before` (path → digest at the previous review's start, §3.6): of `candidates`
 * and of `before`'s own paths. A path `before` does not hold had the previous commit's content then, so it differs; a
 * directory (a submodule, whose commit is not read) always counts.
 */
export async function changedFrom(directory: string, before: ReadonlyMap<string, string>, candidates: Iterable<string>): Promise<Set<string>> {
  const out = new Set<string>();
  for (const p of new Set([...candidates, ...before.keys()])) {
    const now = await fileDigest(join(directory, p));
    if (now === directoryDigest || now !== before.get(p)) out.add(p);
  }
  return out;
}

/** A file the model cited, as a repository-relative path; null when it points outside the workspace. */
export function repoPath(directory: string, file: string): string | null {
  const trimmed = file.trim().replace(/^\.\//, "");
  if (!trimmed) return null;
  const full = resolve(directory, trimmed);
  const rel = relative(directory, full);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return null;
  return rel.split(sep).join("/");
}

/**
 * What the user said in the card's sessions (§4.2): their messages and their answers in a question tool (as
 * "question → answer", E2), from the projected tail of each session in its workspace, Flowly's own temporary sessions
 * left out. null when Paseo could not list them; one unreadable session is skipped.
 */
export async function readConversation(
  task: Pick<Task, "workspaceId">,
  paseo: PaseoApi,
  questions: (agentId: string) => SessionQuestions = () => ({ answered: [], known: () => false }),
): Promise<ConversationEntry[] | null> {
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
  const messages: { at: string; text: string; ask?: string }[] = [];
  for (const id of ids) {
    const handle = paseo.agents.ref(id);
    const res = await handle.timeline.refetch({ direction: "tail", limit: conversationLimits.perSession, projection: "projected" }).catch(() => null);
    const entries = ((res?.entries || []) as { timestamp?: string; item?: TurnItem }[]).filter((e) => e.item);
    const asked = questions(id);
    // Pairing a Codex answers message needs every question call of the session; read back to its start only then.
    const before = res && res.hasOlder !== false && entries.some((e) => answersText(e.item!, asked.answered) !== null) ? await olderEntries(handle, res) : res ? [] : null;
    const calls = before ? answeredCalls([...before, ...entries], asked, before.length, (res as TimelinePage | null)?.epoch) : new Map<number, AnsweredQuestions>();
    for (const [index, entry] of entries.entries()) {
      const at = entry.timestamp || "";
      const item = entry.item!;
      if (item.type === "user_message" && typeof item.text === "string") {
        const call = calls.get(index);
        if (call) for (const qa of call.pairs) messages.push({ at, text: qa.text, ask: qa.ask });
        else messages.push({ at, text: item.text });
        continue;
      }
      // Answers given in AskUserQuestion or Codex request_user_input (tool calls with structured questions).
      for (const qa of questionAnswers([item])) messages.push({ at, text: qa.text, ask: qa.ask });
    }
  }
  return conversationForReview(messages);
}


/** How far back the review reads a session to find all its question calls before pairing (§4.2, E2). */
export const pairingHistoryLimit = 2000;
/**
 * How far apart a Codex answers message and its call's answer may be (§4.2 ⑤): Paseo sends the message when the user
 * submits the answer, seconds from the hook; the same text typed by hand after a rewind comes much later.
 */
export const answerMessageWindowMs = 60_000;

type TimelineEntry = { timestamp?: string; item?: TurnItem };
type TimelinePage = { entries: unknown[]; hasOlder: boolean; startCursor: { epoch: string; seq: number } | null; epoch: string; reset?: boolean; staleCursor?: boolean; error?: string | null };

/** A Codex answers message that some answered call of the session built, character for character; null otherwise. */
function answersText(item: TurnItem, answered: readonly AnsweredQuestions[]): string | null {
  if (item.type !== "user_message" || typeof item.text !== "string") return null;
  const text = item.text;
  return text.startsWith(CODEX_ANSWERS_PREFIX) && answered.some((a) => a.message === text) ? text : null;
}

/**
 * Whether a message at this timeline time, read in this timeline epoch, is certainly the one Paseo sent for this answered
 * call: within the window of the answer (§4.2 ⑤), and the epoch read when the call was asked, before the message, is
 * still the timeline's, so no rewind came since (§4.2 ⑥). An unreadable time is not.
 */
function sentFor(call: AnsweredQuestions, timestamp: string | undefined, epoch: string | undefined): boolean {
  const at = timestamp ? Date.parse(timestamp) : NaN;
  return Number.isFinite(at) && Math.abs(at - call.answeredAt) <= answerMessageWindowMs && !!epoch && call.asked?.epoch === epoch && call.asked.at < at;
}

/** The session's entries before `first`, back to its start; null when the start is out of reach or the timeline changed. */
async function olderEntries(handle: { timeline: { refetch: (options: never) => Promise<unknown> } }, first: TimelinePage): Promise<TimelineEntry[] | null> {
  let out: TimelineEntry[] = [];
  let last = first;
  // Every entry read counts toward the limit, with or without an item; reaching the start at exactly the limit is fine.
  let read = 0;
  while (last.hasOlder !== false) {
    const room = pairingHistoryLimit - read;
    if (!last.startCursor || room <= 0) return null;
    const options = { direction: "before", cursor: last.startCursor, limit: Math.min(conversationLimits.perSession, room), projection: "projected" };
    const next = (await handle.timeline.refetch(options as never).catch(() => null)) as TimelinePage | null;
    if (!next || next.error || next.reset || next.staleCursor || next.epoch !== first.epoch || !next.entries.length || next.entries.length > room) return null;
    read += next.entries.length;
    out = [...(next.entries as TimelineEntry[]).filter((e) => e.item), ...out];
    last = next;
  }
  return out;
}

/**
 * Which Codex async answers message of a session was sent for which answered call (§4.2, E2), from the session's whole
 * timeline (`entries`; the review's own window starts at `offset`, and the map is keyed by window index). A message is
 * read as a call's answers only when its owner is certain:
 * - it is the message Paseo built from that call's titles and answers, character for character;
 * - the call's own `request_user_input_async` tool call (its first one: Paseo may add the answered one later) is in
 *   the timeline and comes before the message. A call the hooks answered that is not in the timeline was removed by a
 *   rewind (Paseo keeps the calls it finds there, `reconcileAsyncQuestionsAfterRewind`) and is left out;
 * - no call whose outcome the hooks do not know (asked before a plugin reload, for one) comes before the message: it
 *   may have sent the same text;
 * - two calls can build the same text, so the messages of one text are paired with the calls of that text only when
 *   there are as many of each, in order (the timeline shows the answers messages in the order the user answered, and
 *   the calls are kept in that order too), each call asked before its message;
 * - each message is in the timeline within a minute of its call's answer: Paseo sends it when the user submits the
 *   answer;
 * - the timeline has not been rewound since the call was answered: the epoch the hook read when the call was asked is
 *   the one this read has (an epoch never comes back), and that read finished before the message. A rewind may have
 *   removed the real message, and the same text typed by hand afterwards, however soon, cannot be told from it.
 * Anything else (a rewind that removed an answer but kept its question, the same text typed again after a rewind, a
 * timeline whose start is out of reach) leaves every message of that text whole.
 */
function answeredCalls(entries: readonly TimelineEntry[], questions: SessionQuestions, offset: number, epoch: string | undefined): Map<number, AnsweredQuestions> {
  const out = new Map<number, AnsweredQuestions>();
  const askedAt = new Map<string, number>();
  const byText = new Map<string, number[]>();
  for (const [i, { item }] of entries.entries()) {
    if (item?.type === "tool_call" && item.name === "request_user_input_async" && typeof item.callId === "string" && !askedAt.has(item.callId)) askedAt.set(item.callId, i);
    const text = item ? answersText(item, questions.answered) : null;
    if (text) byText.set(text, [...(byText.get(text) ?? []), i]);
  }
  const inAnswerOrder = [...questions.answered].reverse();
  for (const [text, at] of byText) {
    const kept = inAnswerOrder.filter((a) => a.message === text && askedAt.has(a.callId));
    if (kept.length !== at.length) continue;
    const last = at[at.length - 1]!;
    if ([...askedAt].some(([callId, i]) => i < last && !questions.known(callId))) continue;
    if (kept.some((a, n) => askedAt.get(a.callId)! > at[n]!)) continue;
    if (kept.some((a, n) => !sentFor(a, entries[at[n]!]!.timestamp, epoch))) continue;
    at.forEach((index, n) => {
      if (index >= offset) out.set(index - offset, kept[n]!);
    });
  }
  return out;
}

export type CheckRun = { exitCode: number | null; timedOut: boolean; spawnError?: string; ms: number; output: string };
/** Runs one check as an argument array in `cwd`, never through a shell; `signal` stops it and its children at once. */
export type RunCheck = (argv: readonly string[], cwd: string, timeoutMs: number, signal?: AbortSignal) => Promise<CheckRun>;

export const runCheck: RunCheck = (argv, cwd, timeoutMs, signal) =>
  new Promise((resolve) => {
    const started = Date.now();
    let output = "",
      timedOut = false,
      settled = false;
    const keep = (chunk: Buffer) => {
      output = (output + chunk.toString("utf8")).slice(-autoReviewLimits.tail * 2);
    };
    // A person moved the card before the command started (§3.2): it does not start.
    if (signal?.aborted) {
      resolve({ exitCode: null, timedOut: false, spawnError: "Stopped.", ms: 0, output: "" });
      return;
    }
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
    const stop = () => {
      kill("SIGTERM");
      setTimeout(() => kill("SIGKILL"), 5000).unref();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, timeoutMs);
    // A person moved the card (§3.2): the whole process group goes now, not at the timeout.
    signal?.addEventListener("abort", stop, { once: true });
    const finish = (run: Omit<CheckRun, "ms" | "output" | "timedOut">) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", stop);
      resolve({ ...run, timedOut, ms: Date.now() - started, output });
    };
    child.stdout?.on("data", keep);
    child.stderr?.on("data", keep);
    child.on("error", (e) => finish({ exitCode: null, spawnError: e.message }));
    child.on("close", (code) => finish({ exitCode: code }));
  });

const packageRunners = new Set(["npm", "pnpm", "yarn", "bun", "npx", "pnpx", "bunx"]);
const npmScriptAliases: Record<string, string> = { test: "test", t: "test", tst: "test", start: "start", stop: "stop", restart: "restart" };
const makefiles = ["GNUmakefile", "makefile", "Makefile"];
const projectFiles: Record<string, string> = { go: "go.mod", cargo: "Cargo.toml" };
/**
 * Whether a project command belongs in this repository of a linked root (GUARDRAILS-SPEC §6.3): an npm, pnpm, yarn or
 * bun script when its `package.json` has that script (any other package command when it has a `package.json`); `make
 * <target>` when a makefile there names the target (bare `make` when it has one); `go` and `cargo` when `go.mod` /
 * `Cargo.toml` is there. Any other command runs in every repository.
 */
export async function commandApplies(argv: readonly string[], directory: string): Promise<boolean> {
  const [tool, ...args] = argv;
  const base = tool ? tool.split(/[\\/]/).pop()! : "";
  if (packageRunners.has(base)) {
    const pkg = await readFile(join(directory, "package.json"), "utf8").then(
      (t) => JSON.parse(t) as { scripts?: Record<string, unknown> },
      () => null,
    );
    if (!pkg) return false;
    const first = args.find((a) => !a.startsWith("-"));
    const script = first === "run" || first === "run-script" ? args[args.indexOf(first) + 1] : first && npmScriptAliases[first];
    return !script || typeof pkg.scripts?.[script] === "string";
  }
  if (base === "make") {
    const file = (await Promise.all(makefiles.map((m) => readFile(join(directory, m), "utf8").catch(() => null)))).find((t) => t !== null);
    if (file === undefined || file === null) return false;
    const targets = args.filter((a, i) => !a.startsWith("-") && !a.includes("=") && !["-C", "-f", "-j"].includes(args[i - 1] ?? ""));
    return targets.every((t) => new RegExp(`^${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:`, "m").test(file));
  }
  if (projectFiles[base]) return fileExists(join(directory, projectFiles[base]));
  return true;
}

/**
 * The repositories of a linked root this delivery touched (§6.3): uncommitted or untracked changes, or a commit after
 * the card was created. All of them when none did; a repository git cannot read counts as touched.
 */
export async function changedRepos(repos: readonly LinkedRepo[], since: string | undefined, git: Git = defaultGit): Promise<LinkedRepo[]> {
  const after = since ? Date.parse(since) : NaN;
  const touched = await Promise.all(
    repos.map(async (repo) => {
      try {
        const [status, last] = await Promise.all([
          git(repo.directory, ["status", "--porcelain", "--untracked-files=normal"]),
          Number.isFinite(after) ? git(repo.directory, ["log", "-1", "--format=%ct"]) : Promise.resolve(""),
        ]);
        return status.trim() !== "" || Number(last.trim()) * 1000 > after;
      } catch {
        return true;
      }
    }),
  );
  const changed = repos.filter((_, i) => touched[i]);
  return changed.length ? changed : [...repos];
}

/**
 * Runs one project command in a linked root (§6.3): in each repository where it applies, in order, until one fails.
 * null when it applies in none. The failing run's output names its repository; the time is the sum; `ran` lists the
 * repositories it ran in, the failing one last.
 */
export async function runInRepos(run: RunCheck, argv: readonly string[], repos: readonly LinkedRepo[], timeoutMs: number, signal?: AbortSignal): Promise<(CheckRun & { ran: string[] }) | null> {
  let ms = 0;
  const ran: string[] = [];
  for (const repo of repos) {
    if (signal?.aborted) break;
    if (!(await commandApplies(argv, repo.directory))) continue;
    ran.push(repo.name);
    const result = await run(argv, repo.directory, timeoutMs, signal);
    ms += result.ms;
    if (result.exitCode !== 0 || result.timedOut || result.spawnError) return { ...result, ms, ran, output: `[${repo.name}]\n${result.output}` };
  }
  return ran.length ? { exitCode: 0, timedOut: false, ms, ran, output: "" } : null;
}

/** What a review reads of the project's guardrails (GUARDRAILS-SPEC §6.3) and reports back at its end (§6.6). */
export type ReviewGuardrails = {
  /**
   * The project's active and observing commands; with Guardrails on (B4) also the active guidelines in scope for this
   * shape and the card's open items, and the user's words for each by id.
   */
  reviewInput(task: Task, project: Project, size: ChangeShape["size"] | undefined): Promise<{ commands: GuardrailEntry[]; guidelines: GuardrailEntry[]; items: CardItem[]; words: Map<string, string> }>;
  /** The three signals and automatic retirement at the end of a review that judged something (§6.6, §6.7). */
  reviewed(input: { projectId: string; taskId: string; items: readonly ReviewItem[]; previous?: readonly ReviewItem[]; disputed: readonly string[] }): Promise<void>;
};

export type AutoReviewDeps = {
  /** The card workspace's directory and whether it is a worktree; null when Paseo has none. */
  workspace: (task: Task, paseo: PaseoApi) => Promise<{ directory: string; worktree: boolean } | null>;
  /** The session is in a turn now (running or starting). */
  sessionBusy: (agentId: string, paseo: PaseoApi) => Promise<boolean>;
  /** The delivering session still exists and is not archived. */
  sessionLive: (agentId: string, task: Task, paseo: PaseoApi) => Promise<boolean>;
  /** Queues a message for a session; it goes out when the session's turn ends (the composer queue). */
  send: (input: { taskId: string; agentId: string; text: string }, paseo: PaseoApi) => Promise<unknown>;
  /** Judges the built-in check, guidelines and card items in a temporary review session; absent makes them unavailable. */
  llm?: LlmReview;
  /** The project's guardrails; absent: only the built-in check runs. */
  guardrails?: ReviewGuardrails;
  /** The user's messages in the card's sessions (§4.2), for the built-in check; null when unreadable. */
  conversation?: (task: Task, paseo: PaseoApi) => Promise<ConversationEntry[] | null>;
  /** The diff the review session reads; `reviewDiff` by default. */
  diff?: (directory: string, since?: string, baseRef?: string) => Promise<string>;
  /** The delivery's shape; `reviewShape` by default. */
  shape?: (directory: string, baseRef?: string) => Promise<{ shape: ChangeShape; paths: Set<string> } | null>;
  /** Whether a cited file exists in the workspace (B1); a file check by default. */
  exists?: (path: string) => Promise<boolean>;
  run?: RunCheck;
  git?: Git;
  clock?: () => number;
  /** Where review snapshots persist (§3.6); `<plugin data>/review-snapshots` by default. */
  snapshots?: ReviewSnapshots;
};

const fileExists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** How long a review waits for its delivering turn's `agent.turn_ended` (with `byUser`) before it counts the round (§3.3). */
const lifecycleWaitMs = 15_000;
/** What the fingerprint compares at the end (§3.6): the content digest, else HEAD and dirty when git could not tell. */
type Measured = { content?: string; head?: GitHead | null };
type Outcome = { task: Task; review: NonNullable<Task["review"]>; rework: boolean };
/** A result held while A1 has the card out of In review (§3.2), applied when A1r brings it back unchanged. In memory only. */
type HeldReview = {
  startedAt: string;
  measure: () => Promise<Measured>;
  previous?: readonly ReviewItem[];
  words: ReadonlyMap<string, string>;
};

/**
 * The automatic review of agent deliveries (AUTO-REVIEW-SPEC, GUARDRAILS-SPEC §6): runs the project's commands in the
 * card workspace, then one review session judges the built-in check, the guidelines in scope and the card's own
 * items; a passed card stays in In review, a failed one goes back to rework (R1) or, past the limit, to Blocked (R2).
 * The review record lives on the task and never changes its revision.
 */
export class AutoReviewService {
  private chains = new Map<string, Promise<void>>();
  /** Deliveries waiting for their session's turn to end, by session. */
  private pending = new Map<string, DeliveredReview>();
  /** The running review of each card, so a person's move can stop it at once (§3.2). */
  private active = new Map<string, { startedAt: string; abort: AbortController }>();
  /** Results held while the card was out of In review (§3.2), by card. */
  private held = new Map<string, HeldReview>();
  /** Each card's latest review start: its per-file content digests (§3.6), kept on disk across restarts. */
  readonly snapshots: ReviewSnapshots;
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
    this.snapshots = deps.snapshots ?? new ReviewSnapshots(store.directory);
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
  turnEnded(agentId: string, paseo: PaseoApi, lifecycleRecorded?: Promise<boolean>) {
    const delivery = this.pending.get(agentId);
    if (!delivery) return Promise.resolve();
    this.pending.delete(agentId);
    return this.enqueue(delivery.projectId, delivery.taskId, async () => {
      try {
        await this.review(delivery, false, paseo, lifecycleRecorded);
      } finally {
        // A review that started cleared it already; one that was skipped or failed early must not leave the card waiting.
        await this.clearWaiting(delivery.taskId, delivery.eventId);
      }
    });
  }

  /**
   * A person moved the card out of In review or archived it while its review ran (§3.2): the store already recorded
   * the review as cancelled in that write; this stops its commands and its review session now.
   */
  stop(taskId: string) {
    this.held.delete(taskId);
    const running = this.active.get(taskId);
    if (!running) return;
    this.active.delete(taskId);
    running.abort.abort();
  }

  /**
   * The card came back to In review (A1r, §3.2) while a result of it was held: apply that result when the delivery's
   * content and workpad are unchanged, else drop it (Cancelled). Never throws.
   */
  restored(taskId: string, paseo: PaseoApi) {
    const held = this.held.get(taskId);
    if (!held) return Promise.resolve();
    return this.store.read().then((board) => {
      const task = board.tasks.find((t) => t.id === taskId);
      if (!task || task.review?.startedAt !== held.startedAt || !task.review.held) {
        this.held.delete(taskId);
        return;
      }
      if (task.status !== "in_review" || task.reviewWaiting) return;
      return this.enqueue(task.projectId, taskId, () => this.resume(taskId, held, paseo));
    });
  }

  private async resume(taskId: string, held: HeldReview, paseo: PaseoApi) {
    if (this.held.get(taskId) !== held) return;
    this.held.delete(taskId);
    const after = await held.measure();
    const outcome = await this.store.transaction<Outcome | null>((b) => {
      const t = b.tasks.find((x) => x.id === taskId);
      const project = t && b.projects.find((p) => p.id === t.projectId);
      const r = t?.review;
      if (!t || !project || !r || r.startedAt !== held.startedAt || !r.held || t.archivedAt || t.status !== "in_review" || t.reviewWaiting) return { value: null, changed: false };
      const finishedAt = this.now();
      const { held: _held, reason: _reason, ...rest } = r;
      if (this.changedSince(b, t, rest, after)) {
        t.review = { ...rest, state: "cancelled", reason: "The card, its workpad or its code changed during the review.", finishedAt };
        this.store.event(b, { taskId: t.id, actor: "system", action: reviewFinishedAction, agentId: r.trigger.agentId, note: "Auto review cancelled: the card changed during the review" });
        return { value: null, changed: true };
      }
      return this.conclude(b, t, project, { ...rest, state: "running" }, finishedAt);
    });
    if (outcome) await this.afterFinish(outcome, held.previous, held.words, undefined, paseo);
  }

  /** Clears the card's waiting marker (§3.1) if it is still the one this delivery set. */
  private clearWaiting(taskId: string, eventId: string) {
    return this.store.transaction((b) => {
      const t = b.tasks.find((x) => x.id === taskId);
      if (t?.reviewWaiting?.eventId !== eventId) return { value: false, changed: false };
      delete t.reviewWaiting;
      return { value: true, changed: true };
    });
  }

  /**
   * A person's Rerun from the drawer (§3.5): the card is in In review, or in Blocked after its review failed, which
   * first moves it to In review in the same write. Round starts at 1; the card waits for the review like a delivery.
   */
  async rerun(taskId: string, paseo: PaseoApi) {
    const waitId = `${rerunWaitPrefix}${randomUUID()}`;
    const delivery = await this.store.transaction<DeliveredReview>((b) => {
      const task = b.tasks.find((t) => t.id === taskId);
      const project = task && b.projects.find((p) => p.id === task.projectId);
      if (!task || !project || task.archivedAt || project.archivedAt) throw new Error("Task is unavailable or archived.");
      if (!rerunnablePlace(task)) throw new Error("Only a card in In review, or in Blocked after its review failed, can be reviewed again.");
      if (!autoReviewRuns(project)) throw new Error("Turn on Auto review in the project settings first.");
      if (task.review?.state === "running") throw new Error("A review of this card is already running.");
      if (task.reviewWaiting) throw new Error("A review of this card is waiting to start.");
      const found = latestDelivery(b, task);
      if (!found) throw new Error("No agent delivered this card to In review, so there is no session to send rework to.");
      const now = this.now();
      if (task.status !== "in_review") {
        const lane = laneProblem(project, "in_review");
        if (lane) throw new Error(lane);
        const from = task.status;
        task.status = "in_review";
        task.revision++;
        task.updatedAt = now;
        this.store.event(b, { taskId: task.id, actor: "human", action: "status_changed", from, to: "in_review", note: "Rerun auto review" });
      }
      task.reviewWaiting = { eventId: waitId, agentId: found.agentId, from: found.from, since: now, ...(found.worktree ? { worktree: found.worktree } : {}) };
      return { value: found, changed: true };
    });
    void this.enqueue(delivery.projectId, taskId, async () => {
      try {
        await this.review(delivery, true, paseo, undefined, waitId);
      } finally {
        await this.clearWaiting(taskId, waitId);
      }
    });
    return { ok: true as const };
  }

  /**
   * At plugin start: a review that was running when Flowly stopped never finishes, so it becomes Unavailable (§3.2);
   * a delivery still waiting for its review is never reviewed (the wait is only in memory), so it becomes Unavailable too.
   */
  recover() {
    return this.store.transaction((b) => {
      let changed = false;
      for (const t of b.tasks) {
        const waiting = t.reviewWaiting;
        if (waiting) {
          delete t.reviewWaiting;
          changed = true;
          const project = b.projects.find((p) => p.id === t.projectId);
          if (t.status === "in_review" && !t.archivedAt && project && t.review?.state !== "running") {
            const reason = "Flowly restarted before the review started.";
            const now = this.now();
            t.review = {
              // A person's Rerun has no delivery event of its own (§8.2).
              trigger: { eventId: waiting.eventId.startsWith(rerunWaitPrefix) ? "" : waiting.eventId, agentId: waiting.agentId, from: waiting.from },
              ...(waiting.worktree ? { worktree: waiting.worktree } : {}),
              round: 1,
              maxRounds: autoReviewOf(project).maxRounds,
              state: "unavailable",
              reason,
              fingerprint: { taskRevision: t.revision, workpadRevision: b.workpads.find((w) => w.taskId === t.id)?.revision ?? 0, dirty: false },
              shared: true,
              items: [],
              startedAt: now,
              finishedAt: now,
            };
            this.store.event(b, { taskId: t.id, actor: "system", action: reviewFinishedAction, agentId: waiting.agentId, note: `Auto review unavailable: ${reason}` });
          }
        }
        if (t.review?.state !== "running") continue;
        const reason = "Flowly restarted during the review.";
        t.review = {
          ...t.review,
          state: "unavailable",
          reason,
          finishedAt: this.now(),
          items: t.review.items.map((r) => (r.state === "queued" || r.state === "running" ? { ...r, state: "unavailable" as const, reason } : r)),
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

  private async review(delivery: DeliveredReview, manual: boolean, paseo: PaseoApi, lifecycleRecorded?: Promise<boolean>, waitId?: string) {
    const board = await this.store.read();
    const task = board.tasks.find((t) => t.id === delivery.taskId);
    const project = task && board.projects.find((p) => p.id === task.projectId);
    if (!task || !project || task.archivedAt || project.archivedAt || task.status !== "in_review" || !autoReviewRuns(project)) return;
    // Past the per-card cap only a person's Rerun reviews (§3.3).
    if (!manual && reviewCapReached(task)) return;
    const workspace = await this.deps.workspace(task, paseo).catch(() => null);
    let where = workspace;
    let baseRef = task.baseRef;
    let whereUnavailable = "The card's workspace directory is unavailable.";
    // A delivery that named a worktree is reviewed there (§3.4); one that is gone is not replaced by the workspace.
    if (workspace && delivery.worktree) {
      try {
        const worktree = await resolveWorktree(delivery.worktree, workspace.directory, this.git);
        where = { directory: worktree.directory, worktree: true };
        baseRef = task.baseRef ?? (await worktreeBase(worktree, this.git)) ?? undefined;
      } catch (e) {
        where = null;
        whereUnavailable = `The delivered worktree is unavailable: ${e instanceof Error ? e.message : String(e)}`.slice(0, autoReviewLimits.reason);
      }
    }
    let head = where ? await readHead(where.directory, this.git, this.now()) : null;
    // A workspace that is not a Git repository itself reads the repositories in it (a linked root, §6.2).
    const linked = where && !head && !delivery.worktree ? await linkedRepos(where.directory) : [];
    let repoShas: Record<string, string> | undefined;
    if (linked.length) ({ head, repos: repoShas } = await linkedHead(linked, this.git, this.now()));
    const measured = !where
      ? null
      : linked.length
        ? await linkedShape(linked, baseRef, this.git).catch(() => null)
        : await (this.deps.shape ?? ((d: string, base?: string) => reviewShape(d, base, this.git)))(where.directory, baseRef).catch(() => null);
    const config = autoReviewOf(project);
    // What is checked is fixed when it starts; editing the guardrails meanwhile does not change this review (§4.3).
    const guard = this.deps.guardrails
      ? await this.deps.guardrails.reviewInput(task, project, measured?.shape.size).catch((e) => {
          logFailure("Flowly auto review could not read the guardrails:", e, task.id);
          return null;
        })
      : null;
    const words = guard?.words ?? new Map<string, string>();
    // The round counts turns a person started (§3.3): when it depends on a turn whose end is not recorded yet (the
    // delivering one), wait for that end, with its byUser, at most 15 s.
    if (lifecycleRecorded && !manual) {
      const fresh = await this.store.read();
      const t = fresh.tasks.find((x) => x.id === delivery.taskId);
      if (t && roundAwaitsTurnEnd(fresh.events, t.id, t.review)) await Promise.race([lifecycleRecorded, new Promise((resolve) => setTimeout(resolve, lifecycleWaitMs).unref())]);
    }
    // The content digest (§3.6): the paths this delivery changed, under the directory they are relative to, and, in the
    // card's own worktree, every path that differs from the start's commit (so an edit or new file outside that set
    // after the start changes it; a commit of the same content leaves it as it was). A shared directory leaves those
    // out: other sessions' edits there would cancel every review (D6).
    const contentPaths = measured ? [...measured.paths] : null;
    const startSha = head?.sha;
    const startRepos = repoShas;
    const changedAfter = async (): Promise<string[]> => {
      if (!where?.worktree) return [];
      const sets = linked.length
        ? await Promise.all(linked.map((r) => (startRepos?.[r.name] ? pathsChangedSince(r.directory, startRepos[r.name]!, this.git, `${r.name}/`) : new Set<string>())))
        : [startSha ? await pathsChangedSince(where.directory, startSha, this.git) : new Set<string>()];
      return sets.flatMap((set) => [...set]);
    };
    const snapshotNow = async () => (where && contentPaths ? await contentSnapshot(where.directory, [...contentPaths, ...(await changedAfter())]).catch(() => undefined) : undefined);
    const digestNow = async () => (await snapshotNow())?.digest;
    const snapshot = await snapshotNow();
    const content = snapshot?.digest;
    const measure = async (): Promise<Measured> => {
      if (!where) return {};
      if (content !== undefined) return { content: await digestNow() };
      return { head: linked.length ? (await linkedHead(linked, this.git, this.now())).head : await readHead(where.directory, this.git, this.now()) };
    };
    const startedAt = this.now();
    const started = await this.store.transaction<{ previous?: Task["review"]; round: number } | null>((b) => {
      const t = b.tasks.find((x) => x.id === delivery.taskId);
      if (!t || t.archivedAt || t.status !== "in_review") return { value: null, changed: false };
      // Waiting ends in the same write the review starts in, so the card never shows the previous result meanwhile.
      if (t.reviewWaiting?.eventId === (manual ? waitId : delivery.eventId)) delete t.reviewWaiting;
      const previous = t.review;
      const round = !manual && continuesRound(b.events, t.id, previous) ? previous!.round + 1 : 1;
      const disputes = new Map((t.disputes || []).map((d) => [d.id, d]));
      // A dispute is about one finding, not the whole check (E1): a judged check is judged again with the dispute in its
      // input; a deciding command is skipped as disputed only at the commit it failed on, and only while it is the command
      // that failed (an edited command runs). A command that does not decide (observing, or in a shared directory) always
      // runs, so its result stays visible.
      const queued = (id: string, gating: boolean, argv: readonly string[]) => {
        const d = disputes.get(id);
        const same = !!d?.argv && d.argv.length === argv.length && d.argv.every((a, n) => a === argv[n]);
        return gating && same && d?.sha && d.sha === head?.sha ? { state: "disputed" as const, disputeReason: clip(d.reason, 300) } : { state: "queued" as const };
      };
      const judgedState = (id: string) => ({ state: "queued" as const, ...(disputes.has(id) ? { disputeReason: clip(disputes.get(id)!.reason, 300) } : {}) });
      // In a shared directory commands run and show their result but do not decide (§6.3 step 1, E3).
      const shared = !where?.worktree;
      const items: ReviewItem[] = [
        ...(guard?.commands || []).map((c) => ({
          id: c.id,
          kind: "command" as const,
          name: clip(c.text, 200),
          // An observing command runs and shows its result but never decides the review (§4.5).
          gating: c.state === "active" && !shared,
          argv: [...(c.argv || [])],
          ...queued(c.id, c.state === "active" && !shared, c.argv || []),
        })),
        { id: GOAL_ID, kind: "goal" as const, name: GOAL_NAME, gating: true, ...judgedState(GOAL_ID) },
        ...(guard?.guidelines || []).map((g) => ({ id: g.id, kind: "guideline" as const, name: clip(g.text, 200), gating: true, ...judgedState(g.id) })),
        // A demoted card item is judged and shown but never decides (§3.6).
        ...(guard?.items || []).map((i) => ({ id: i.id, kind: "item" as const, name: clip(i.text, 200), gating: !i.observing, ...(i.observing ? { reason: demotedReason } : {}), ...judgedState(i.id) })),
      ].slice(0, 40);
      t.review = {
        trigger: { eventId: manual ? "" : delivery.eventId, agentId: delivery.agentId, from: delivery.from },
        round,
        maxRounds: config.maxRounds,
        state: "running",
        fingerprint: {
          taskRevision: t.revision,
          workpadRevision: b.workpads.find((w) => w.taskId === t.id)?.revision ?? 0,
          ...(head?.sha ? { sha: head.sha } : {}),
          ...(repoShas && Object.keys(repoShas).length ? { repos: repoShas } : {}),
          dirty: !!head?.dirty,
          ...(content ? { content } : {}),
        },
        shared,
        ...(delivery.worktree ? { worktree: delivery.worktree } : {}),
        ...(measured ? { shape: measured.shape } : {}),
        items,
        startedAt,
      };
      this.store.event(b, { taskId: t.id, actor: "system", action: reviewStartedAction, agentId: delivery.agentId, note: `Auto review started (round ${round})` });
      return { value: { previous, round }, changed: true };
    });
    if (!started) return;
    // A new review replaces a held one (§3.2).
    this.held.delete(delivery.taskId);
    // Registered before any further wait, so a person's move stops it from here on (§3.2).
    const abort = new AbortController();
    this.active.set(delivery.taskId, { startedAt, abort });
    try {
      // The previous review's per-file snapshot (§3.6), when it is the one this round continues; this review's replaces it.
      const kept = await this.snapshots.get(delivery.taskId).catch(() => undefined);
      const previousFiles = kept && kept.startedAt === started.previous?.startedAt ? kept.files : undefined;
      await this.snapshots
        .set(delivery.taskId, snapshot ? { startedAt, files: snapshot.files } : undefined)
        .catch((e) => logFailure("Auto review snapshot not saved:", e, delivery.taskId));
      await this.conduct(delivery, manual, paseo, lifecycleRecorded, { task, baseRef, where, whereUnavailable, linked, measured, guard, words, startedAt, started, measure, signal: abort.signal, head, previousFiles });
    } finally {
      if (this.active.get(delivery.taskId)?.abort === abort) this.active.delete(delivery.taskId);
    }
  }

  /** The review after it started: commands, the review session, the result and what follows from it. */
  private async conduct(
    delivery: DeliveredReview,
    manual: boolean,
    paseo: PaseoApi,
    lifecycleRecorded: Promise<boolean> | undefined,
    ctx: {
      task: Task;
      baseRef: string | undefined;
      where: { directory: string; worktree: boolean } | null;
      whereUnavailable: string;
      linked: LinkedRepo[];
      measured: { shape: ChangeShape; paths: Set<string> } | null;
      guard: Awaited<ReturnType<ReviewGuardrails["reviewInput"]>> | null;
      words: Map<string, string>;
      startedAt: string;
      started: { previous?: Task["review"]; round: number };
      measure: () => Promise<Measured>;
      signal: AbortSignal;
      /** HEAD when the review started: a failed command is rerun only at this commit (flaky, §6.3 step 1). */
      head: { sha?: string } | null;
      /** Each path's digest at the previous review's start (§3.6); absent after a plugin restart. */
      previousFiles?: ReadonlyMap<string, string>;
    },
  ) {
    const { task, baseRef, where, whereUnavailable, linked, measured, guard, words, startedAt, started, measure, signal, head, previousFiles } = ctx;
    const items = (await this.current(delivery.taskId, startedAt))?.items ?? [];
    const set = (id: string, patch: Partial<ReviewItem>) => this.updateItems(delivery.taskId, startedAt, [id], patch);
    if (!where) {
      await this.updateItems(delivery.taskId, startedAt, items.filter((i) => i.state === "queued").map((i) => i.id), { state: "unavailable", reason: whereUnavailable });
    } else {
      // Every active and observing command runs, in list order; each result shows as soon as it is in (§6.3 step 1).
      const runIn = linked.length ? await changedRepos(linked, task.createdAt, this.git) : [];
      for (const item of items) {
        if (signal.aborted) return;
        if (item.kind !== "command" || item.state !== "queued") continue;
        const entry = guard?.commands.find((c) => c.id === item.id);
        await set(item.id, { state: "running" });
        const timeout = (entry?.timeoutSec ?? defaultCheckTimeoutSec) * 1000;
        const once = () => (linked.length ? runInRepos(this.run, item.argv || [], runIn, timeout, signal) : this.run(item.argv || [], where.directory, timeout, signal));
        let run: (CheckRun & { ran?: string[] }) | null = await once();
        if (signal.aborted) return;
        if (!run) {
          await set(item.id, { state: "skipped", reason: runIn.length < linked.length ? "No repository this delivery changed has this command." : "No repository in this workspace has this command." });
          continue;
        }
        let flaky: { ms: number; output: string } | undefined;
        // A gating command that failed runs once more at the same commit; passing then is flaky, not a failure (§6.3 step 1, E3).
        if (item.gating && run.exitCode !== 0 && !run.timedOut && !run.spawnError && head?.sha) {
          const now = linked.length ? (await linkedHead(linked, this.git, this.now())).head : await readHead(where.directory, this.git, this.now());
          const again = now?.sha === head.sha ? await once() : null;
          // A rerun that cannot start or times out says nothing about the code: the first failure stands.
          if (again && !again.timedOut && !again.spawnError) {
            if (again.exitCode === 0) flaky = { ms: run.ms, output: run.output };
            run = { ...again, ms: run.ms + again.ms };
          } else if (again) run = { ...run, ms: run.ms + again.ms };
        }
        const tail = outputTail(flaky ? flaky.output : run.output, autoReviewLimits.tail);
        const passed = run.exitCode === 0 && !run.timedOut && !run.spawnError;
        // A command that cannot start or times out is the review's problem, not the agent's (§3.2 Unavailable).
        const state = passed ? "passed" : run.spawnError || run.timedOut ? "unavailable" : "failed";
        await set(item.id, {
          state,
          exitCode: run.exitCode,
          ...(run.timedOut ? { timedOut: true } : {}),
          ms: Math.max(0, Math.round(run.ms)),
          ...((!passed || flaky) && tail ? { tail } : {}),
          ...(flaky ? { flaky: true, reason: "Failed once and passed when run again at the same commit." } : {}),
          ...(run.ran ? { detail: `Ran in ${run.ran.join(", ")}.`.slice(0, autoReviewLimits.detail) } : {}),
          ...(run.spawnError ? { reason: `Could not start: ${run.spawnError}`.slice(0, autoReviewLimits.reason) } : {}),
          ...(run.timedOut ? { reason: `Timed out after ${timeout / 1000} s.` } : {}),
        });
      }
      await this.judge(delivery, startedAt, baseRef === task.baseRef ? task : { ...task, baseRef }, started.round > 1 && !manual && started.previous?.worktree === delivery.worktree ? started.previous : undefined, guard, where, linked, measured?.paths ?? new Set(), paseo, signal, previousFiles);
      if (signal.aborted) return;
    }
    const after = await measure();
    const outcome = await this.finish(delivery.taskId, startedAt, after);
    if (outcome === "held") {
      this.held.set(delivery.taskId, { startedAt, measure, previous: started.previous?.items, words });
      return;
    }
    if (!outcome) return;
    await this.afterFinish(outcome, started.previous?.items, words, lifecycleRecorded, paseo);
  }

  /** What follows a finished review: guardrail counts, then the rework message when it asked for rework. */
  private async afterFinish(outcome: Outcome, previous: readonly ReviewItem[] | undefined, words: ReadonlyMap<string, string>, lifecycleRecorded: Promise<boolean> | undefined, paseo: PaseoApi) {
    const startedAt = outcome.review.startedAt;
    const taskId = outcome.task.id;
    // The three signals and retirement (§6.6, §6.7); a minor finding counts as na. A failure here never changes the review.
    const counted = (list: readonly ReviewItem[]) => list.map((i) => (i.state === "failed" && isMinor(i) ? { ...i, state: "na" as const } : i));
    if (this.deps.guardrails)
      await this.deps.guardrails
        .reviewed({
          projectId: outcome.task.projectId,
          taskId,
          // A minor failure sent nothing back, so it counts as na (§3.6).
          items: counted(outcome.review.items),
          // Only a decisive failure was sent back, so only it can be caught (§6.6).
          previous: previous && counted(previous.filter((i) => i.gating)),
          disputed: (outcome.task.disputes || []).map((d) => d.id),
        })
        .catch((e) => logFailure("Flowly guardrail counts not updated:", e, taskId));
    if (!outcome.rework) return;
    // Compute the review immediately, but never start a rework turn before its predecessor is recorded.
    if (lifecycleRecorded && !(await lifecycleRecorded)) {
      await this.markUnavailable(taskId, startedAt, "The delivering turn could not be recorded, so the rework message was not sent.");
      return;
    }
    const live = await this.deps.sessionLive(outcome.review.trigger.agentId, outcome.task, paseo).catch(() => false);
    const sent = live
      ? await this.deps.send({ taskId: outcome.task.id, agentId: outcome.review.trigger.agentId, text: reworkMessage(outcome.review, words) }, paseo).then(
          () => true,
          (e) => {
            logFailure("Flowly auto review rework not sent:", e, outcome.task.id);
            return false;
          },
        )
      : false;
    if (!sent) await this.markUnavailable(taskId, startedAt, "The delivering session is no longer available, so the rework message was not sent.");
  }

  private async current(taskId: string, startedAt: string) {
    const review = (await this.store.read()).tasks.find((t) => t.id === taskId)?.review;
    return review?.startedAt === startedAt ? review : null;
  }

  /**
   * The review session (§6.3 step 2): one session judges the built-in check, the guidelines and the card's items,
   * only when every gating command passed (D9). A `fail` without evidence becomes `na` (B1). From round 2 it reads
   * only the changes since the previous delivery and the previous results.
   */
  private async judge(
    delivery: DeliveredReview,
    startedAt: string,
    task: Task,
    previous: Task["review"] | undefined,
    guard: Awaited<ReturnType<ReviewGuardrails["reviewInput"]>> | null,
    where: { directory: string; worktree: boolean },
    linked: readonly LinkedRepo[],
    diffFiles: ReadonlySet<string>,
    paseo: PaseoApi,
    signal?: AbortSignal,
    previousFiles?: ReadonlyMap<string, string>,
  ) {
    const now = await this.current(delivery.taskId, startedAt);
    if (!now) return;
    const judged = now.items.filter((i) => i.kind !== "command" && i.state === "queued");
    if (!judged.length) return;
    const ids = judged.map((i) => i.id);
    const gating = now.items.filter((i) => i.kind === "command" && i.gating);
    if (gating.some((r) => r.state === "failed")) {
      await this.updateItems(delivery.taskId, startedAt, ids, { state: "skipped", reason: "A command failed." });
      return;
    }
    if (gating.some((r) => r.state === "unavailable")) {
      await this.updateItems(delivery.taskId, startedAt, ids, { state: "skipped", reason: "A command could not run." });
      return;
    }
    if (!this.deps.llm) {
      await this.updateItems(delivery.taskId, startedAt, ids, { state: "unavailable", reason: "The review session is unavailable in this Flowly build." });
      return;
    }
    await this.updateItems(delivery.taskId, startedAt, ids, { state: "running" });
    const board = await this.store.read();
    const deliveryEvent = board.events.find((e) => e.id === delivery.eventId);
    const before = new Map((previous?.items || []).map((i) => [i.id, i]));
    const incremental = !!previous?.fingerprint.sha;
    const text = (i: ReviewItem) =>
      i.kind === "goal" ? goalPrompt : i.kind === "guideline" ? [guard?.guidelines.find((g) => g.id === i.id)?.text ?? i.name, guard?.guidelines.find((g) => g.id === i.id)?.body].filter(Boolean).join("\n") : i.name;
    const input: LlmReviewInput = {
      task: {
        id: task.id,
        title: task.title,
        description: task.description,
        type: task.type,
        workspaceId: task.workspaceId,
        ...(task.images?.length ? { images: task.images.map((image) => cardImagePath(this.store.directory, task.id, image)) } : {}),
      },
      checks: judged.map((i) => {
        const quote = guard?.words.get(i.id);
        const prior = incremental ? before.get(i.id) : undefined;
        const dispute = task.disputes?.find((d) => d.id === i.id);
        return {
          id: i.id,
          kind: i.kind as JudgedCheck["kind"],
          text: text(i),
          ...(quote ? { quote } : {}),
          ...(prior ? { previous: { state: prior.state, ...(prior.severity ? { severity: prior.severity } : {}), ...(prior.detail ? { detail: prior.detail } : {}) } } : {}),
          ...(dispute ? { dispute: { reason: dispute.reason, round: dispute.round, ...(dispute.finding ? { finding: dispute.finding } : {}) } } : {}),
        };
      }),
      ...(ids.includes(GOAL_ID) ? { conversation: this.deps.conversation ? await this.deps.conversation(task, paseo).catch(() => null) : null } : {}),
      ...(where.worktree ? {} : { shared: true }),
      acceptance: board.workpads.find((w) => w.taskId === task.id)?.acceptance ?? [],
      deliveryNote: deliveryEvent?.note ?? "",
      outputs: board.artifacts.filter((a) => a.taskId === task.id && a.role === "output").map((a) => a.target),
      commands: now.items
        .filter((r) => r.kind === "command")
        .map((r) => `${r.name}: ${r.state}${r.flaky ? " (failed once, passed when run again)" : ""}${r.gating ? "" : now.shared ? " (ran in a shared directory; does not decide)" : " (observing)"}`),
      diff: linked.length
        ? await linkedReviewDiff(linked, { since: incremental ? previous!.fingerprint.repos : undefined, baseRef: task.baseRef }, this.git)
        : await (this.deps.diff ?? ((d: string, since?: string, baseRef?: string) => reviewDiff(d, { since, baseRef }, this.git)))(
            where.directory,
            incremental ? previous!.fingerprint.sha : undefined,
            task.baseRef,
          ),
      ...(incremental ? { incremental: true } : {}),
      ...(delivery.worktree ? { worktree: where.directory } : {}),
      parentAgentId: delivery.agentId,
    };
    const running = await deliveringBackgroundWork(paseo, delivery.agentId);
    if (running) input.backgroundWork = running;
    // Rework round (§3.6): what this round changed, for the reviewer and the regression backstop.
    const changedNow = new Set<string>();
    if (incremental) {
      const parts = linked.length
        ? await Promise.all(
            linked.map((r) =>
              previous!.fingerprint.repos?.[r.name]
                ? pathsChangedSince(r.directory, previous!.fingerprint.repos[r.name]!, this.git, `${r.name}/`)
                : // Linked after the previous review: its whole change is this round's, from the uncut path list.
                  new Set([...diffFiles].filter((p) => p.startsWith(`${r.name}/`))),
            ),
          )
        : [await pathsChangedSince(where.directory, previous!.fingerprint.sha!, this.git)];
      // The shown diff too, in case git could not list them.
      const candidates = [...parts.flatMap((x) => [...x]), ...diffPaths(input.diff)];
      // A file that was already changed at the previous delivery and is unchanged since is not this round's (§3.6):
      // compare with the previous review's per-file snapshot; without one, every path counts.
      for (const p of previousFiles ? await changedFrom(where.directory, previousFiles, candidates) : candidates) changedNow.add(p);
      // Only a snapshot tells the reviewer more than the diff already does.
      if (previousFiles) {
        input.changedThisRound = [...changedNow].sort().slice(0, 200);
        input.changedThisRoundTotal = changedNow.size;
      }
    }
    const started = this.clock();
    let result: Awaited<ReturnType<LlmReview>>;
    try {
      result = await this.deps.llm(input, paseo, signal);
    } catch (e) {
      if (signal?.aborted) return;
      const reason = `The review session failed: ${e instanceof Error ? e.message : String(e)}`.slice(0, autoReviewLimits.reason);
      await this.updateItems(delivery.taskId, startedAt, ids, { state: "unavailable", reason });
      return;
    }
    const ms = Math.max(0, Math.round(this.clock() - started));
    const cardItems = new Map((guard?.items || []).map((i) => [i.id, i]));
    // B1: a cited file outside the diff counts when it exists in the repository (a missing entry, say).
    const exists = this.deps.exists ?? fileExists;
    const verdicts = new Map<string, LlmVerdict & { file?: string }>();
    const existing = new Set<string>();
    for (const v of result.verdicts) {
      const file = v.file ? repoPath(where.directory, v.file) ?? undefined : undefined;
      verdicts.set(v.id, { ...v, ...(file ? { file } : { file: undefined }) });
      if (v.verdict === "fail" && file && !diffFiles.has(file) && (await exists(resolve(where.directory, file)))) existing.add(file);
    }
    await this.store.transaction((b) => {
      const t = b.tasks.find((x) => x.id === delivery.taskId);
      if (!t?.review || t.review.startedAt !== startedAt || t.review.state !== "running") return { value: null, changed: false };
      t.review = {
        ...t.review,
        model: result.model.slice(0, 200),
        items: t.review.items.map((r) => {
          if (!ids.includes(r.id)) return r;
          const v = verdicts.get(r.id);
          if (!v) {
            // Round ≥ 2 re-checks only what failed; a check that passed before and was not judged again keeps its pass,
            // unless it is still disputed: a disputed check always needs a verdict of its own (§6.3 step 2, E1).
            const prior = incremental ? before.get(r.id) : undefined;
            if (prior && itemPassed(prior) && !r.disputeReason) return { ...r, state: prior.state, ms, ...(prior.detail ? { detail: prior.detail } : {}), reason: "Passed in the previous round; not judged again." };
            return { ...r, state: "unavailable" as const, ms, reason: "The review session gave no verdict for this check." };
          }
          // An answer in a question tool counts by the user's answer only; the agent's question is context (§4.2, E2).
          const quoteSources = [task.title, task.description, ...(input.conversation ?? []).map(userWords), guard?.words.get(r.id)];
          const evidence = v.verdict !== "fail" || hasEvidence(v, diffFiles, existing, quoteSources);
          // needs_user needs no evidence, but must say what the person has to do (§3.6).
          const asks = v.verdict === "needs_user" && !!v.detail.trim();
          const state: ReviewItem["state"] =
            v.verdict === "pass" ? "passed" : v.verdict === "fail" && evidence ? "failed" : asks ? "needs_user" : "na";
          const reason = v.verdict === "fail" && !evidence ? "no evidence" : v.verdict === "needs_user" && !asks ? "no detail" : undefined;
          let severity = state === "failed" || state === "needs_user" ? v.severity : undefined;
          let gating = r.gating;
          let why = reason;
          const prior = incremental ? before.get(r.id) : undefined;
          // A rework round re-checks what failed and looks for regressions (§3.6): a fail of what passed before, or of what
          // was only a minor finding (it did not decide either), must cite a file this round changed.
          const settled = !!prior && (itemPassed(prior) || ((prior.state === "failed" || prior.state === "needs_user") && isMinor(prior)));
          if (state === "failed" && severity !== "minor" && settled && !(v.file && changedNow.has(v.file))) {
            severity = "minor";
            why = notThisRoundReason;
          }
          // A check that failed before and now fails for something new, in a file this round did not change, is not this
          // round's either, in the earlier fail's file too (§3.6, user decision 2026-11-27). Without an earlier file, or
          // for the same finding, it keeps its severity: an unfixed problem must not pass by being worded differently.
          const finding = demotionFinding({ detail: v.detail, file: v.file, line: v.line });
          if (
            state === "failed" &&
            severity !== "minor" &&
            prior?.state === "failed" &&
            !isMinor(prior) &&
            prior.file &&
            v.file &&
            !changedNow.has(v.file) &&
            !nearPlace(prior, v) &&
            !sameFinding(demotionFinding(prior), finding)
          ) {
            severity = "minor";
            why = notThisRoundReason;
          }
          // A card item failing a third time in a row, each time for something else, stops deciding the review (§3.6).
          const card = r.kind === "item" ? cardItems.get(r.id) : undefined;
          if (card && gating && state === "failed" && severity !== "minor" && shouldDemote(card.fails || [], demotionFinding({ detail: v.detail, file: v.file, line: v.line }))) {
            gating = false;
            why = demotedReason;
          }
          const { reason: _old, severity: _oldSeverity, ...base } = r;
          return {
            ...base,
            ...(r.reason === demotedReason ? { reason: r.reason } : {}),
            gating,
            state,
            ...(severity ? { severity } : {}),
            ms,
            detail: v.detail.slice(0, autoReviewLimits.detail),
            ...(v.file ? { file: v.file.slice(0, 300) } : {}),
            ...(v.line ? { line: v.line } : {}),
            ...(v.quote ? { quote: clip(v.quote, 300) } : {}),
            ...(why ? { reason: why } : {}),
          };
        }),
      };
      return { value: null, changed: true };
    });
  }

  /** Writes item results of the running review; no task revision, so the fingerprint is untouched (§12.5). */
  private updateItems(taskId: string, startedAt: string, ids: readonly string[], patch: Partial<ReviewItem>) {
    if (!ids.length) return Promise.resolve(null);
    return this.store.transaction((b) => {
      const t = b.tasks.find((x) => x.id === taskId);
      if (!t?.review || t.review.startedAt !== startedAt || t.review.state !== "running") return { value: null, changed: false };
      t.review = { ...t.review, items: t.review.items.map((r) => (ids.includes(r.id) ? { ...r, ...patch } : r)) };
      return { value: null, changed: true };
    });
  }

  /** The delivery's content or the workpad changed since the review started (§3.2, §3.6). */
  private changedSince(b: Board, t: Task, r: NonNullable<Task["review"]>, after: Measured) {
    const pad = b.workpads.find((w) => w.taskId === t.id);
    if ((pad?.revision ?? 0) !== r.fingerprint.workpadRevision) return true;
    if (r.fingerprint.content !== undefined) return after.content !== r.fingerprint.content;
    if (after.head === undefined) return false;
    return (after.head?.sha || undefined) !== r.fingerprint.sha || !!after.head?.dirty !== r.fingerprint.dirty;
  }

  /**
   * Writes the result (§3.2): a changed delivery drops it (Cancelled); a card A1 took out of In review holds it
   * ("held"); otherwise the verdict applies. Returns the finished review and whether rework goes out, else null.
   */
  private async finish(taskId: string, startedAt: string, after: Measured) {
    return this.store.transaction<Outcome | "held" | null>((b) => {
      const t = b.tasks.find((x) => x.id === taskId);
      const project = t && b.projects.find((p) => p.id === t.projectId);
      const r = t?.review;
      if (!t || !project || !r || r.startedAt !== startedAt || r.state !== "running") return { value: null, changed: false };
      const finishedAt = this.now();
      if (t.archivedAt || this.changedSince(b, t, r, after)) {
        t.review = { ...r, state: "cancelled", reason: "The card, its workpad or its code changed during the review.", finishedAt };
        // No results: a cancelled review judged nothing.
        this.store.event(b, { taskId: t.id, actor: "system", action: reviewFinishedAction, agentId: r.trigger.agentId, note: "Auto review cancelled: the card changed during the review" });
        return { value: null, changed: true };
      }
      // A person's move stops the review at once (store); what is left is A1: a message in the card's session.
      if (t.status !== "in_review") {
        t.review = { ...r, state: "cancelled", held: true, reason: "The card left In review during the review.", finishedAt };
        this.store.event(b, { taskId: t.id, actor: "system", action: reviewFinishedAction, agentId: r.trigger.agentId, note: "Auto review held: the card left In review during the review" });
        return { value: "held", changed: true };
      }
      return this.conclude(b, t, project, r, finishedAt);
    });
  }

  /** Applies the verdict of a review whose result stands (§3.2, §3.3, §4.5), in the caller's write. */
  private conclude(b: Board, t: Task, project: Project, r: NonNullable<Task["review"]>, finishedAt: string): { value: Outcome; changed: true } {
    // A disputed finding that failed again decisively (judged with the dispute, or a command on new code) ends that dispute (§6.1, E1).
    if (t.disputes?.length) {
      const kept = t.disputes.filter((d) => !r.items.some((i) => i.id === d.id && i.state === "failed" && decisive(i)));
      if (kept.length !== t.disputes.length) {
        if (kept.length) t.disputes = kept;
        else delete t.disputes;
      }
    }
    // Each item's result and kind go with the event, for Insights (§6.4, §7.5).
    const event = (note: string) =>
      this.store.event(b, {
        taskId: t.id,
        actor: "system",
        action: reviewFinishedAction,
        agentId: r.trigger.agentId,
        note,
        results: r.items.map((x) => ({ id: x.id, state: x.state, kind: x.kind, ...(x.gating ? {} : { gating: false as const }), ...((x.state === "failed" || x.state === "needs_user") && isMinor(x) ? { severity: "minor" as const } : {}) })),
      });
    const verdict = reviewVerdict(r.items);
    const reviews = t.reviewCount ?? 0;
    const done = (review: NonNullable<Task["review"]>, rework = false) => {
      // Reviews that judged something count toward the card's cap (§3.3).
      if (countsTowardCap(review.state)) t.reviewCount = reviews + 1;
      return { value: { task: { ...t, review }, review, rework }, changed: true as const };
    };
    if (verdict === "passed") {
      t.review = { ...r, state: "passed", finishedAt };
      const n = r.items.filter((x) => x.gating).length;
      event(`Auto review passed (${n} check${n === 1 ? "" : "s"})`);
      return done(t.review);
    }
    if (verdict === "unavailable") {
      const unavailable = r.items.find((x) => x.gating && (x.state === "unavailable" || x.state === "queued" || x.state === "running"))!;
      const reason = `${unavailable.kind === "goal" ? GOAL_NAME : unavailable.name}: ${unavailable.reason || "could not run"}`.slice(0, autoReviewLimits.reason);
      t.review = { ...r, state: "unavailable", reason, finishedAt };
      event(`Auto review unavailable: ${reason}`);
      return done(t.review);
    }
    if (verdict === "needs_user") {
      // Only a person can do it (§3.6): no rework, the card stays in In review and Attention says what to do.
      const reason = needsUserReason(r.items);
      t.review = { ...r, state: "needs_user", reason, finishedAt };
      event(`Auto review needs you: ${reason}`);
      return done(t.review);
    }
    const findings = failureSummary(r);
    const move = (to: Task["status"], rule: string, note: string) => {
      t.status = to;
      t.revision++;
      t.updatedAt = finishedAt;
      this.store.event(b, { taskId: t.id, actor: "system", action: "status_changed", agentId: r.trigger.agentId, rule, from: "in_review", to, note });
    };
    // The card's cap (§3.3): from its 10th review on, a failure goes to Blocked instead of rework.
    const capped = reviews + 1 >= reviewCapPerCard;
    // Status first, then the message (§3.2): the rework turn then starts on a work stage, so A1 leaves it alone.
    const stage = !capped && r.round - 1 < r.maxRounds ? reworkStage(b.events, t, project, r.trigger.from) : null;
    if (stage) {
      t.review = { ...r, state: "rework", finishedAt };
      event(`Auto review failed: ${findings}`);
      move(stage, reworkRule, `Auto review failed; back to rework (${r.round}/${r.maxRounds})`);
      return done(t.review, true);
    }
    t.review = { ...r, state: "failed", ...(capped ? { reason: `This card reached ${reviewCapPerCard} reviews, so no more automatic rework.` } : {}), finishedAt };
    event(`Auto review failed: ${findings}`);
    if (laneEnabled(project, "blocked"))
      move(
        "blocked",
        reviewFailedRule,
        capped ? `Auto review stopped after ${reviewCapPerCard} reviews of this card` : `Auto review failed after ${r.round - 1} rework round${r.round - 1 === 1 ? "" : "s"}`,
      );
    return done(t.review);
  }

  private markUnavailable(taskId: string, startedAt: string, reason: string) {
    return this.store.transaction((b) => {
      const t = b.tasks.find((x) => x.id === taskId);
      if (!t?.review || t.review.startedAt !== startedAt) return { value: null, changed: false };
      // The rework could not be sent, so this review no longer counts toward the card's cap (§3.3).
      if (countsTowardCap(t.review.state) && t.reviewCount) t.reviewCount -= 1;
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
      return { taskId: task.id, projectId: task.projectId, eventId: e.id, agentId: e.agentId, from: e.from, ...(e.worktree ? { worktree: e.worktree } : {}) };
  }
  if (task.review)
    return {
      taskId: task.id,
      projectId: task.projectId,
      eventId: task.review.trigger.eventId,
      agentId: task.review.trigger.agentId,
      from: task.review.trigger.from,
      ...(task.review.worktree ? { worktree: task.review.worktree } : {}),
    };
  return null;
}
