import { execFile } from "node:child_process";
import { remoteRepo } from "../../shared/connectors";
import { findRepos } from "../git-stats";

/**
 * Repositories of a project on a connection's host (CONNECTORS-SPEC §4.3):
 * the git remotes of the project root and its first-level child
 * repositories. Cached per root for five minutes.
 */
const CACHE_MS = 5 * 60_000;
const cache = new Map<string, { at: number; remotes: Promise<string[]> }>();

function remotes(dir: string): Promise<string[]> {
  return new Promise((resolve) => {
    execFile("git", ["-C", dir, "remote", "-v"], { timeout: 5_000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }, (error, stdout) =>
      resolve(error ? [] : stdout.split("\n").map((line) => line.split(/\s+/)[1] || "").filter(Boolean)),
    );
  });
}

async function allRemotes(root: string) {
  const repos = await findRepos(root).catch(() => [] as string[]);
  return (await Promise.all(repos.map(remotes))).flat();
}

export async function projectRepos(root: string, baseUrl: string, clock = () => Date.now()): Promise<string[]> {
  let hit = cache.get(root);
  if (!hit || clock() - hit.at > CACHE_MS) {
    hit = { at: clock(), remotes: allRemotes(root) };
    cache.set(root, hit);
  }
  const out: string[] = [];
  for (const remote of await hit.remotes) {
    const repo = remoteRepo(remote, baseUrl);
    if (repo && !out.includes(repo)) out.push(repo);
  }
  return out;
}
