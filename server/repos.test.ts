import { afterEach, expect, test } from "vitest";
import { mkdtemp, mkdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { repoMatcher } from "./repos";
import { effectiveRepos, includesRepo } from "../shared/scope";

const run = promisify(execFile),
  roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
test("matches canonical subdirectories and external Git worktrees without path-prefix false positives", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "ultra-repos-")));
  roots.push(root);
  const repo = join(root, "repo"),
    other = join(root, "repo-other"),
    worktree = join(root, "external-checkout");
  await mkdir(repo);
  await mkdir(other);
  await mkdir(join(repo, "subdir"));
  await run("git", ["-C", repo, "init", "-b", "main"]);
  await run("git", [
    "-C",
    repo,
    "-c",
    "user.name=Ultra Test",
    "-c",
    "user.email=ultra@example.invalid",
    "commit",
    "--allow-empty",
    "-m",
    "fixture",
  ]);
  await run("git", ["-C", repo, "worktree", "add", "-b", "fixture", worktree]);
  const match = repoMatcher([repo]);
  expect(await match(worktree)).toEqual([repo]);
  expect(await match(join(repo, "subdir"))).toEqual([repo]);
  expect(await match(other)).toEqual([]);
  expect(await match(join(root, "missing"))).toEqual([]);
  expect(await repoMatcher([])(worktree)).toEqual([]);
});
test("repo filters include unrestricted tasks and selected memberships, independent of startup source", () => {
  const project = { repos: ["a", "b", "c"] };
  expect(effectiveRepos({ repoPaths: [] }, project)).toEqual(["a", "b", "c"]);
  expect(includesRepo({ repoPaths: [] }, "b")).toBe(true);
  expect(includesRepo({ repoPaths: ["a", "c"] }, "c")).toBe(true);
  expect(includesRepo({ repoPaths: ["a", "c"] }, "b")).toBe(false);
});
