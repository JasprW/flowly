import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join, win32 } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);

/**
 * The official Paseo CLI ships inside the app bundle next to the daemon; the
 * desktop app also hands its path to the daemon as `PASEO_CLI`. The plugin SDK
 * has no API for session settings or native project create/delete, so those go
 * through the CLI (argument arrays only), which talks to the same daemon.
 */
export async function resolvePaseoCli(execPath = process.execPath, env = process.env) {
  const candidates = [
    env.PASEO_CLI,
    // .../Paseo.app/Contents/Frameworks/Paseo Helper.app/Contents/MacOS/Paseo Helper
    join(dirname(execPath), "..", "..", "..", "..", "Resources", "bin", "paseo"),
    "/Applications/Paseo.app/Contents/Resources/bin/paseo",
  ].filter((p): p is string => !!p);
  for (const path of candidates) {
    try {
      await access(path, constants.X_OK);
      return path;
    } catch {
      /* try next */
    }
  }
  return "paseo";
}

export type Invocation = { file: string; args: string[]; env?: NodeJS.ProcessEnv };
const exists = (path: string) => access(path).then(() => true, () => false);

/**
 * How to start the CLI at `cli` without a shell. On Windows the CLI is a
 * `paseo.cmd` shim, which Node refuses to run without a shell (EINVAL), and a
 * shell would re-parse the arguments (titles are user text). So a shim is
 * replaced by the command it runs: the desktop app's `bin\paseo.cmd` starts
 * `Paseo.exe` with the bundled runner and CLI entry (Paseo's
 * packages/desktop/bin/paseo.cmd), and npm's `paseo.cmd` starts Node with the
 * package's `bin/paseo`.
 */
export async function paseoInvocation(
  cli: string,
  args: string[],
  platform = process.platform,
  env = process.env,
  execPath = process.execPath,
  found: (path: string) => Promise<boolean> = exists,
): Promise<Invocation> {
  if (platform !== "win32" || !/\.(cmd|bat)$/i.test(cli)) return { file: cli, args };
  const bin = win32.dirname(cli);
  const resources = win32.dirname(bin);
  const app = win32.join(resources, "..", "Paseo.exe");
  const runner = win32.join(resources, "app.asar.unpacked", "dist", "daemon", "node-entrypoint-runner.js");
  if ((await found(app)) && (await found(runner)))
    return {
      file: app,
      args: ["--disable-warning=DEP0040", runner, "node-script", win32.join(resources, "app.asar", "node_modules", "@getpaseo", "cli", "dist", "index.js"), ...args],
      env: { ...env, ELECTRON_RUN_AS_NODE: "1", PASEO_NODE_ENV: "production", PASEO_DESKTOP_MANAGED: "1", PASEO_CLI: cli },
    };
  const script = win32.join(bin, "node_modules", "@getpaseo", "cli", "bin", "paseo");
  // The daemon's own runtime is Node (or Electron as Node, which needs the flag).
  if (await found(script)) return { file: execPath, args: [script, ...args], env: { ...env, ELECTRON_RUN_AS_NODE: "1" } };
  throw new Error(`Cannot start the Paseo CLI from ${win32.basename(cli)}: its program files were not found next to it.`);
}

/** Runs the Paseo CLI with an argument array and returns its stdout. */
export async function runPaseo(args: string[], options: { timeout: number; maxBuffer: number }, cli?: string) {
  const run = await paseoInvocation(cli ?? (await resolvePaseoCli()), args);
  return (await execute(run.file, run.args, { ...options, ...(run.env ? { env: run.env } : {}) })).stdout;
}
