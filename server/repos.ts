import { realpath } from "node:fs/promises";
import { relative, isAbsolute, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);
function contains(root: string, path: string) {
  const suffix = relative(root, path);
  return (
    !suffix ||
    (!isAbsolute(suffix) && suffix !== ".." && !suffix.startsWith("../"))
  );
}
// A per-operation cache avoids repeated Git probes, while subsequent reads see repository changes.
export function repoMatcher(repos: string[]) {
  const paths = new Map<string, Promise<string | null>>();
  const git = new Map<string, Promise<string | null>>();
  const canonical = (path: string) => {
    if (!paths.has(path))
      paths.set(
        path,
        realpath(path).catch(() => null),
      );
    return paths.get(path)!;
  };
  const common = (path: string) => {
    if (!git.has(path))
      git.set(
        path,
        execute(
          "git",
          [
            "-C",
            path,
            "rev-parse",
            "--path-format=absolute",
            "--git-common-dir",
          ],
          { timeout: 5000, maxBuffer: 65536 },
        )
          .then(({ stdout }) => canonical(resolve(path, stdout.trim())))
          .catch(() => null),
      );
    return git.get(path)!;
  };
  return async (workspacePath: string): Promise<string[]> => {
    if (!repos.length) return [];
    const path = await canonical(workspacePath);
    if (!path) return [];
    const matches: string[] = [];
    const unmatched: { repo: string; root: string }[] = [];
    for (const repo of repos) {
      const root = await canonical(repo);
      if (!root) continue;
      if (contains(root, path)) matches.push(repo);
      else unmatched.push({ repo, root });
    }
    if (unmatched.length) {
      const repoCommons: { repo: string; commonDir: string }[] = [];
      for (const item of unmatched) {
        const commonDir = await common(item.root);
        if (commonDir) repoCommons.push({ repo: item.repo, commonDir });
      }
      if (repoCommons.length) {
        const identity = await common(path);
        if (identity) {
          for (const item of repoCommons) {
            if (identity === item.commonDir) matches.push(item.repo);
          }
        }
      }
    }
    return matches.sort((a, b) => b.length - a.length);
  };
}
