import { afterEach, expect, test } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocketServer } from "ws";
import { daemonTarget, LocalDaemonUnavailable, openLocalDaemon } from "./local-daemon";

const dirs: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

test("every listen form Paseo writes resolves to a WebSocket target", () => {
  expect(daemonTarget("127.0.0.1:6767")).toEqual({ url: "ws://127.0.0.1:6767/ws" });
  expect(daemonTarget("localhost:6767")).toEqual({ url: "ws://localhost:6767/ws" });
  expect(daemonTarget("[::1]:6767")).toEqual({ url: "ws://[::1]:6767/ws" });
  expect(daemonTarget("6767")).toEqual({ url: "ws://127.0.0.1:6767/ws" });
  expect(daemonTarget("tcp://127.0.0.1:6767?ssl=false")).toEqual({ url: "ws://127.0.0.1:6767/ws" });
  expect(daemonTarget("/run/user/1000/paseo.sock")).toEqual({ url: "ws://localhost/ws", socketPath: "/run/user/1000/paseo.sock" });
  expect(daemonTarget("unix:///tmp/paseo.sock")).toEqual({ url: "ws://localhost/ws", socketPath: "/tmp/paseo.sock" });
  expect(daemonTarget("~/.paseo/paseo.sock")).toEqual({ url: "ws://localhost/ws", socketPath: join(homedir(), ".paseo/paseo.sock") });
  expect(daemonTarget("\\\\.\\pipe\\paseo")).toEqual({ url: "ws://localhost/ws", socketPath: "\\\\.\\pipe\\paseo" });
  expect(daemonTarget("pipe://\\\\.\\pipe\\paseo")).toEqual({ url: "ws://localhost/ws", socketPath: "\\\\.\\pipe\\paseo" });
});

test("no address (the supervisor is restarting the worker) is a distinct, unavailable state", () => {
  for (const listen of [null, undefined, "", "  "]) expect(() => daemonTarget(listen)).toThrow(LocalDaemonUnavailable);
  expect(() => daemonTarget("not an address")).toThrow(/not a local endpoint/);
  expect(() => daemonTarget("unix://")).toThrow(/no socket path/);
});

test("a daemon on a Unix socket is reached through that socket with the local credential", async () => {
  const home = await mkdtemp(join(tmpdir(), "flowly-ld-"));
  dirs.push(home);
  const socketPath = join(home, "d.sock");
  const token = "a".repeat(43);
  await writeFile(join(home, "paseo.pid"), JSON.stringify({ pid: 1, listen: socketPath }));
  await writeFile(join(home, "local-credential"), `${token}\n`);
  const server = createServer();
  servers.push(server);
  const wss = new WebSocketServer({ server, path: "/ws" });
  const hello = new Promise<string>((resolve) =>
    wss.on("connection", (socket) =>
      socket.once("message", (data) => {
        resolve(String(data));
        socket.close();
      }),
    ),
  );
  await new Promise<void>((r) => server.listen(socketPath, r));
  // The fake daemon closes after the hello, so the connection itself fails.
  const opened = openLocalDaemon(home, "flowly-test", [], "").catch((e: unknown) => e);
  expect(await hello).toContain(token);
  expect(await opened).toBeInstanceOf(Error);
});
