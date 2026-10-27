import { readFile } from "node:fs/promises";
import { connect } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { DaemonClient } from "@getpaseo/client/internal/daemon-client";

/**
 * The local daemon cannot be reached right now for a reason outside Flowly: it
 * is restarting (no address yet) or this Paseo has no local credential. Logged,
 * not reported to telemetry (TELEMETRY-SPEC §11.2).
 */
export class LocalDaemonUnavailable extends Error {
  override name = "LocalDaemonUnavailable";
}

export type DaemonTarget = { url: string; socketPath?: string };

/**
 * Where the daemon listens, from `paseo.pid`'s `listen`, read the way the
 * `paseo` CLI reads it (Paseo 0.13 `resolveDaemonTarget`): `host:port`, a bare
 * port, `tcp://host:port`, a Unix socket (`/path`, `~/path`, `unix://path`) or
 * a Windows named pipe (`\\.\pipe\name`, `pipe://name`). For a socket or pipe the
 * URL is a placeholder; `openLocalDaemon` connects through `socketPath`.
 */
export function daemonTarget(listen: unknown): DaemonTarget {
  const value = typeof listen === "string" ? listen.trim() : "";
  if (!value) throw new LocalDaemonUnavailable("The Paseo daemon has no address yet; it may be restarting.");
  const ipc = /^unix:\/\//.test(value) ? value.slice(7)
    : /^pipe:\/\//.test(value) ? value.slice(7)
      : value.startsWith("\\\\.\\pipe\\") || value.startsWith("/") || value.startsWith("~") ? value
        : null;
  if (ipc !== null) {
    const socketPath = ipc.trim().replace(/^~(?=[/\\]|$)/, homedir());
    if (!socketPath) throw new Error("The Paseo daemon address has no socket path.");
    return { url: "ws://localhost/ws", socketPath };
  }
  const tcp = value.replace(/^tcp:\/\//, "").replace(/[/?].*$/, "");
  const endpoint = /^\d+$/.test(tcp) ? `127.0.0.1:${tcp}` : tcp;
  if (!/^[\w.-]+:\d+$|^\[[\da-f:]+\]:\d+$/i.test(endpoint))
    throw new Error("The Paseo daemon address is not a local endpoint.");
  return { url: `ws://${endpoint}/ws` };
}

/**
 * COMPAT(sdk-local-daemon): a short-lived local daemon connection for the few
 * daemon calls the plugin SDK (`PaseoApi`, @getpaseo/client 0.11.2) does not
 * expose yet: workspace restore, session unarchive (WORKSPACE-RESTORE-SPEC) and
 * clearing a session's native attention (SESSION-ATTENTION-SPEC). Connects the
 * way the `paseo` CLI does: the address from `paseo.pid` and the local
 * credential file. The token is never logged. `methods` must exist on this
 * Paseo version, otherwise `unsupported` is thrown. Callers close the client.
 */
export async function openLocalDaemon(
  home: string,
  clientId: string,
  methods: readonly (keyof DaemonClient)[],
  unsupported: string,
): Promise<DaemonClient> {
  const lock = JSON.parse(await readFile(join(home, "paseo.pid"), "utf8")) as { listen?: unknown };
  const target = daemonTarget(lock.listen);
  const token = (await readFile(join(home, "local-credential"), "utf8").catch(() => "")).trim();
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new LocalDaemonUnavailable("The Paseo local credential is unavailable.");
  const socketPath = target.socketPath;
  const client = new DaemonClient({
    url: target.url,
    clientId,
    clientType: "cli",
    localCredential: () => token,
    reconnect: { enabled: false },
    connectTimeoutMs: 5000,
    // Node's built-in WebSocket cannot use a socket; `ws` can, given the connection. `net`
    // opens Unix sockets and Windows named pipes alike.
    ...(socketPath
      ? { webSocketFactory: (url: string, options?: { headers?: Record<string, string>; protocols?: string[] }) =>
          new WebSocket(url, options?.protocols, { headers: options?.headers, createConnection: () => connect(socketPath) }) as never }
      : {}),
  });
  try {
    await client.connect();
    for (const method of methods)
      if (typeof client[method] !== "function") throw new Error(unsupported);
  } catch (e) {
    await client.close().catch(() => undefined);
    throw e;
  }
  return client;
}
