import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { defaultGit, linkedRepos, type Git } from "./auto-review";

/**
 * The git worktree a delivery names (AUTO-REVIEW-SPEC §3.4): when the card's workspace is a shared directory, an agent
 * may put its change in a worktree of the same repository (e.g. `.worktrees/<name>`) and deliver with its path or the
 * branch checked out in it; the review then runs its commands and reads its diff there.
 */
export type DeliveredWorktree = {
  /** The worktree's top-level directory, real path. */
  directory: string;
  /** The card's repository it belongs to: the workspace directory, or one repository of a linked root. */
  home: string;
};

const gitText = (git: Git, dir: string, args: string[]) => git(dir, args).then((s) => s.trim());
const commonDir = async (git: Git, dir: string) => realpath(await gitText(git, dir, ["rev-parse", "--path-format=absolute", "--git-common-dir"]));

/** The card's repositories: the workspace directory when it is one, otherwise the repositories of a linked root. */
async function homes(workspace: string, git: Git): Promise<string[]> {
  const top = await gitText(git, workspace, ["rev-parse", "--show-toplevel"]).catch(() => "");
  if (top) return [top];
  return (await linkedRepos(workspace)).map((r) => r.directory);
}

/**
 * Resolves what a delivery named (an absolute path, or a branch name) to a worktree of the card's repository. Throws an
 * Error whose message tells the agent what to fix: a missing path, another repository, the workspace itself, or a
 * branch that no worktree has checked out.
 */
export async function resolveWorktree(value: string, workspace: string, git: Git = defaultGit): Promise<DeliveredWorktree> {
  const named = value.trim();
  const repos = await homes(workspace, git);
  if (!repos.length) throw new Error("The card's workspace is not a git repository, so it has no worktrees.");
  const commons = new Map<string, string>();
  for (const home of repos) {
    const common = await commonDir(git, home).catch(() => "");
    if (common) commons.set(common, home);
  }
  let directory: string;
  if (isAbsolute(named)) {
    const real = await realpath(named).catch(() => "");
    if (!real) throw new Error(`worktree ${named} does not exist.`);
    directory = await gitText(git, real, ["rev-parse", "--show-toplevel"]).then((top) => realpath(top), () => "");
    if (!directory) throw new Error(`worktree ${named} is not inside a git worktree.`);
  } else {
    const found = await branchWorktree(named, [...commons.values()], git);
    if (!found) throw new Error(`No worktree of this card's repository has branch ${named} checked out. Pass the worktree's absolute path, or check the branch out in a worktree first.`);
    directory = found;
  }
  const home = commons.get(await commonDir(git, directory).catch(() => ""));
  if (!home) throw new Error(`worktree ${named} is not a worktree of this card's repository.`);
  if (directory === (await realpath(home).catch(() => home)))
    throw new Error("worktree names the card's own workspace; leave it out when the change is there.");
  return { directory, home };
}

/** The worktree that has `branch` checked out, from `git worktree list --porcelain` of each repository. */
async function branchWorktree(branch: string, repos: readonly string[], git: Git): Promise<string | null> {
  const ref = `refs/heads/${branch.replace(/^refs\/heads\//, "")}`;
  const found: string[] = [];
  for (const repo of repos) {
    const list = await git(repo, ["worktree", "list", "--porcelain"]).catch(() => "");
    let path = "";
    for (const line of list.split("\n")) {
      if (line.startsWith("worktree ")) path = line.slice("worktree ".length);
      else if (line === `branch ${ref}` && path) {
        const real = await realpath(path).catch(() => null);
        if (real) found.push(real);
      }
    }
  }
  // A linked root can have the same branch checked out in two of its repositories: the path tells them apart.
  if (found.length > 1) throw new Error(`Branch ${branch} is checked out in more than one repository of this card (${found.join(", ")}); pass the worktree's absolute path instead.`);
  return found[0] ?? null;
}

/**
 * Where the delivered branch's own change starts (§3.4): of the home's upstream (e.g. `origin/main`) and the home's
 * HEAD, the one whose merge-base with the worktree's HEAD is nearest to it, so neither a local main that is behind nor
 * one that is ahead adds commits that are not the card's. null when git can resolve neither.
 */
export async function worktreeBase(worktree: DeliveredWorktree, git: Git = defaultGit): Promise<string | null> {
  const candidates = [
    await gitText(git, worktree.home, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]).catch(() => ""),
    await gitText(git, worktree.home, ["rev-parse", "HEAD"]).catch(() => ""),
  ].filter(Boolean);
  let best: { ref: string; ahead: number } | null = null;
  for (const ref of candidates) {
    const base = await gitText(git, worktree.directory, ["merge-base", ref, "HEAD"]).catch(() => "");
    if (!base) continue;
    const ahead = Number(await gitText(git, worktree.directory, ["rev-list", "--count", `${base}..HEAD`]).catch(() => "NaN"));
    if (Number.isFinite(ahead) && (!best || ahead < best.ahead)) best = { ref, ahead };
  }
  return best?.ref ?? null;
}

/** A pull or merge request link of a repository: its host, repository path, and the ref its head is published under. */
type PrLink = { url: string; host: string; path: string; ref: string };
/** GitHub `…/owner/repo/pull/N` and GitLab `…/group/repo/-/merge_requests/N` links; null for anything else. */
export function parsePrLink(url: string): PrLink | null {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol)) return null;
  const parts = u.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
  const host = u.host.toLowerCase();
  const gitlab = parts.indexOf("-");
  if (gitlab >= 2 && parts[gitlab + 1] === "merge_requests" && /^\d+$/.test(parts[gitlab + 2] || ""))
    return { url, host, path: parts.slice(0, gitlab).join("/").toLowerCase(), ref: `refs/merge-requests/${parts[gitlab + 2]}/head` };
  if (parts.length >= 4 && parts[2] === "pull" && /^\d+$/.test(parts[3]!))
    return { url, host, path: parts.slice(0, 2).join("/").toLowerCase(), ref: `refs/pull/${parts[3]}/head` };
  return null;
}

/** host and repository path of a remote URL: `git@host:a/b.git`, `ssh://git@host:22/a/b`, `https://host/a/b.git`. */
export function remoteRepo(remote: string): { host: string; path: string } | null {
  const value = remote.trim();
  const scp = /^[^/@\s]+@([^:/\s]+):(.+)$/.exec(value);
  let host: string, path: string;
  if (scp && !value.includes("://")) [host, path] = [scp[1]!, scp[2]!];
  else {
    try {
      const u = new URL(value);
      [host, path] = [u.hostname, u.pathname];
    } catch {
      return null;
    }
  }
  path = path.replace(/^\/+|\/+$/g, "").replace(/\.git$/, "").toLowerCase();
  return host && path ? { host: host.toLowerCase(), path } : null;
}

const quickGit: Git = (cwd, args) =>
  new Promise((resolve, reject) =>
    execFile("git", ["-C", cwd, ...args], { timeout: 5_000, maxBuffer: 1 << 20, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND || "ssh -o BatchMode=yes" } }, (e, stdout) =>
      e ? reject(e) : resolve(stdout),
    ),
  );

/**
 * The worktree behind a delivery's pull or merge request when it named none (§3.4): for each PR link of a remote of
 * the card's repository, its head commit (`git ls-remote`, 5 s), then every worktree other than the repository's own
 * directory whose HEAD contains that commit. Only one worktree in all: it, with the link; otherwise (none, several, a
 * link of another repository, git or network failure) null, and the delivery is reviewed as before.
 */
export async function prWorktree(links: readonly string[], workspace: string, git: Git = defaultGit, remote: Git = quickGit): Promise<{ directory: string; url: string } | null> {
  const prs = [...new Set(links)].map(parsePrLink).filter((p): p is PrLink => !!p);
  if (!prs.length) return null;
  const found = new Map<string, string>();
  for (const home of await homes(workspace, git).catch(() => [] as string[])) {
    const config = await git(home, ["config", "--get-regexp", "^remote\\..*\\.url$"]).catch(() => "");
    const remotes = config
      .split("\n")
      .map((line) => /^remote\.(.+)\.url\s+(.+)$/.exec(line.trim()))
      .filter((m): m is RegExpExecArray => !!m)
      .map((m) => ({ name: m[1]!, repo: remoteRepo(m[2]!) }));
    const self = await realpath(home).catch(() => home);
    let worktrees: { path: string; head: string }[] | null = null;
    for (const pr of prs) {
      const match = remotes.find((r) => r.repo?.host === pr.host && r.repo.path === pr.path);
      if (!match) continue;
      const sha = (await remote(home, ["ls-remote", match.name, pr.ref]).catch(() => "")).split(/\s/)[0] ?? "";
      if (!/^[0-9a-f]{40,64}$/.test(sha)) continue;
      worktrees ??= await listWorktrees(home, git);
      for (const w of worktrees) {
        if (w.path === self) continue;
        const contains = await git(w.path, ["merge-base", "--is-ancestor", sha, w.head]).then(
          () => true,
          () => false,
        );
        if (contains && !found.has(w.path)) found.set(w.path, pr.url);
      }
    }
  }
  if (found.size !== 1) return null;
  const [[directory, url]] = [...found];
  return { directory: directory!, url: url! };
}

/** Every worktree of a repository with its HEAD, real paths; bare and prunable entries left out. */
async function listWorktrees(repo: string, git: Git): Promise<{ path: string; head: string }[]> {
  const list = await git(repo, ["worktree", "list", "--porcelain"]).catch(() => "");
  const out: { path: string; head: string }[] = [];
  for (const block of list.split("\n\n")) {
    const lines = block.split("\n");
    const path = lines.find((l) => l.startsWith("worktree "))?.slice("worktree ".length);
    const head = lines.find((l) => l.startsWith("HEAD "))?.slice("HEAD ".length);
    if (!path || !head || lines.includes("bare") || lines.some((l) => l.startsWith("prunable"))) continue;
    const real = await realpath(path).catch(() => "");
    if (real) out.push({ path: real, head });
  }
  return out;
}
