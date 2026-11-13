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
  for (const repo of repos) {
    const list = await git(repo, ["worktree", "list", "--porcelain"]).catch(() => "");
    let path = "";
    for (const line of list.split("\n")) {
      if (line.startsWith("worktree ")) path = line.slice("worktree ".length);
      else if (line === `branch ${ref}` && path) return realpath(path).catch(() => null);
    }
  }
  return null;
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
