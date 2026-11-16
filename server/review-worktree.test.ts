import { afterEach, expect, test } from "vitest";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultGit } from "./auto-review";
import { resolveWorktree, worktreeBase } from "./review-worktree";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});
const git = (cwd: string, ...args: string[]) => defaultGit(cwd, ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...args]);

/** A repository on main with a worktree on feat/wt and a second, unrelated repository. */
async function repos() {
  const base = await realpath(await mkdtemp(join(tmpdir(), "flowly-wt-")));
  roots.push(base);
  const repo = join(base, "repo");
  await mkdir(join(repo, "src"), { recursive: true });
  await git(repo, "init", "-q", "-b", "main");
  await writeFile(join(repo, "src/a.ts"), "1\n");
  await git(repo, "add", ".");
  await git(repo, "commit", "-q", "-m", "init");
  const worktree = join(repo, ".worktrees/wt");
  await git(repo, "worktree", "add", "-q", "-b", "feat/wt", worktree);
  const other = join(base, "other");
  await mkdir(other);
  await git(other, "init", "-q", "-b", "main");
  return { base, repo, worktree, other };
}

test("resolves a worktree by its path, a folder inside it, or its branch; a linked root finds its repository's worktree", async () => {
  const { base, repo, worktree } = await repos();
  expect(await resolveWorktree(worktree, repo)).toEqual({ directory: worktree, home: repo });
  expect(await resolveWorktree(join(worktree, "src"), repo)).toEqual({ directory: worktree, home: repo });
  expect(await resolveWorktree("feat/wt", repo)).toEqual({ directory: worktree, home: repo });
  expect(await resolveWorktree(" refs/heads/feat/wt ", repo)).toEqual({ directory: worktree, home: repo });
  const root = join(base, "root");
  await mkdir(root);
  await symlink(repo, join(root, "Repo"), "dir");
  expect((await resolveWorktree("feat/wt", root)).directory).toBe(worktree);
  expect((await resolveWorktree(worktree, root)).directory).toBe(worktree);
  // The same branch in a second linked repository: ambiguous by name, the path still works.
  const second = join(base, "second");
  await mkdir(second);
  await git(second, "init", "-q", "-b", "main");
  await writeFile(join(second, "x"), "x\n");
  await git(second, "add", ".");
  await git(second, "commit", "-q", "-m", "init");
  await git(second, "worktree", "add", "-q", "-b", "feat/wt", join(second, ".worktrees/wt"));
  await symlink(second, join(root, "Second"), "dir");
  await expect(resolveWorktree("feat/wt", root)).rejects.toThrow("more than one repository");
  expect((await resolveWorktree(worktree, root)).directory).toBe(worktree);
});

test("refuses a missing path, another repository, the workspace itself, an unknown branch and a workspace without git", async () => {
  const { base, repo, other } = await repos();
  await expect(resolveWorktree(join(base, "nope"), repo)).rejects.toThrow("does not exist");
  await expect(resolveWorktree(other, repo)).rejects.toThrow("not a worktree of this card's repository");
  await expect(resolveWorktree(repo, repo)).rejects.toThrow("the card's own workspace");
  await expect(resolveWorktree("main", repo)).rejects.toThrow("the card's own workspace");
  await expect(resolveWorktree("feat/none", repo)).rejects.toThrow("No worktree of this card's repository has branch feat/none");
  const plain = join(base, "plain");
  await mkdir(plain);
  await expect(resolveWorktree("feat/wt", plain)).rejects.toThrow("not a git repository");
});

test("the branch point: the nearer merge-base of the home's HEAD and its upstream, so main moving on adds nothing", async () => {
  const { repo, worktree } = await repos();
  const start = (await git(repo, "rev-parse", "HEAD")).trim();
  await writeFile(join(worktree, "src/a.ts"), "2\n");
  await git(worktree, "commit", "-q", "-am", "feature");
  const wt = { directory: worktree, home: repo };
  // No upstream: the home's HEAD.
  expect(await worktreeBase(wt)).toBe(start);
  // main moves on; the merge-base is still the branch point.
  await writeFile(join(repo, "b.ts"), "b\n");
  await git(repo, "add", ".");
  await git(repo, "commit", "-q", "-m", "later");
  const later = (await git(repo, "rev-parse", "HEAD")).trim();
  expect(await worktreeBase(wt)).toBe(later);
  expect((await git(worktree, "merge-base", later, "HEAD")).trim()).toBe(start);
});

test("PR links and remote URLs: GitHub and GitLab links, scp, ssh and https remotes", async () => {
  const { parsePrLink, remoteRepo } = await import("./review-worktree");
  expect(parsePrLink("https://github.com/JasprW/Flowly/pull/105")).toMatchObject({ host: "github.com", path: "jasprw/flowly", ref: "refs/pull/105/head" });
  expect(parsePrLink("https://git.garena.com/a/b/c/-/merge_requests/9/diffs")).toMatchObject({ host: "git.garena.com", path: "a/b/c", ref: "refs/merge-requests/9/head" });
  expect(parsePrLink("https://github.com/a/b/issues/3")).toBeNull();
  expect(parsePrLink("not a url")).toBeNull();
  expect(remoteRepo("git@github.com:JasprW/flowly.git")).toEqual({ host: "github.com", path: "jasprw/flowly" });
  expect(remoteRepo("ssh://git@git.garena.com:2222/a/b/c.git")).toEqual({ host: "git.garena.com", path: "a/b/c" });
  expect(remoteRepo("https://github.com/JasprW/flowly")).toEqual({ host: "github.com", path: "jasprw/flowly" });
});
