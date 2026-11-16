import { afterEach, expect, test, vi } from "vitest";
import { readFile, rm, stat } from "node:fs/promises";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { agentFixture } from "./agent-fixture";
import { ToolServer } from "./tool-server";
import { putArtifact } from "./artifacts";
import { agentReadSchema, agentWriteSchema, compactRead } from "../shared/agent-output";
import type { ConnectorService } from "./connectors/service";
import type { ToolContext } from "../shared/tools";

const run = promisify(execFile);
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function setup(seed?: Parameters<typeof agentFixture>[0]) {
  const x = await agentFixture(seed);
  cleanups.push(() => rm(x.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
  return x;
}
const next = (c: { revision: unknown; request: unknown }) => ({ expectedRevision: c.revision, request: c.request });
async function transport() {
  const x = await setup();
  const server = new ToolServer(x.store);
  cleanups.push(() => server.stop());
  const prepared = await server.prepareExisting("t", "actor", x.paseo);
  const { url } = JSON.parse(await readFile(x.store.directory + "/tool-endpoint.json", "utf8"));
  const authorization = "Bearer " + server.secrets.credential(x.identity);
  const api = async (action: string, input: unknown = {}) => {
    const response = await fetch(url + "api", { method: "POST", headers: { Authorization: authorization, "Content-Type": "application/json" }, body: JSON.stringify({ action, input }) });
    return response.json();
  };
  const cli = (...args: string[]) => run(process.execPath, [prepared.cliPath, "--context-file", prepared.contextFile, ...args], {
    env: { ...process.env, PASEO_AGENT_ID: "actor", NODE_ENV: "test", FLOWLY_TELEMETRY: "0" },
  });
  return { ...x, server, url, authorization, prepared, api, cli };
}

test("compact writes chain without full reads or session/connector scans; workpad returns generated IDs", async () => {
  const x = await setup();
  const current = await x.service.readAgent(x.identity);
  const get = vi.spyOn(x.service, "get");
  const list = vi.spyOn(x.paseo.agents, "list");
  const summaries = vi.fn();
  x.service.connectors = { summaries } as unknown as ConnectorService;
  const status = await x.service.writeAgent(x.identity, "status", { ...next(current), status: "development", note: "start" });
  expect(status.current).toMatchObject({ toolVersion: 2, task: { id: "t", status: "development" }, workpad: { revision: 1 } });
  expect(status.current).not.toHaveProperty("sessions");
  expect(status.current).not.toHaveProperty("activity");
  const pad = await x.service.writeAgent(x.identity, "workpad", {
    ...next(status.current!), workpadRevision: 1, acceptance: [{ text: "Preserve request identity", done: false }],
  });
  expect(pad.current?.workpad?.acceptance).toEqual([{ id: "preserve-request-identit", text: "Preserve request identity", done: false }]);
  const checked = await x.service.writeAgent(x.identity, "workpad", {
    ...next(pad.current!), workpadRevision: pad.current!.workpad!.revision,
    acceptance: pad.current!.workpad!.acceptance!.map(item => ({ ...item, done: true })),
  });
  expect(checked.current?.workpad?.acceptance?.[0]).toMatchObject({ id: pad.current!.workpad!.acceptance![0].id, done: true });
  const progress = await x.service.writeAgent(x.identity, "progress", { ...next(checked.current!), note: "continued" });
  expect(progress.receipt.action).toBe("progress");
  expect(agentWriteSchema.safeParse(progress).success).toBe(true);
  expect(progress.current?.request.id).not.toBe(status.current?.request.id);
  expect(get).not.toHaveBeenCalled();
  expect(list).not.toHaveBeenCalled();
  expect(summaries).not.toHaveBeenCalled();
});

test("compact setup reminders and workpad conflicts survive consecutive writes", async () => {
  const x = await setup({ type: false, tags: false, workpad: false });
  const ctx = await x.service.readAgent(x.identity);
  const typed = await x.service.writeAgent(x.identity, "type", { ...next(ctx), type: "bugfix" });
  expect(typed.current?.setup).toMatchObject({ typeMissing: false, tagsMissing: true, workpadMissing: true });
  expect(typed.reminders?.join(" ")).toContain("flowly_set_tags");
  const pad = await x.service.writeAgent(x.identity, "workpad", { ...next(typed.current!), workpadRevision: 0, acceptance: [{ text: "check", done: false }] });
  await expect(x.service.writeAgent(x.identity, "workpad", { ...next(pad.current!), workpadRevision: 0, acceptance: [] })).rejects.toMatchObject({ code: "WORKPAD_CONFLICT" });
  await x.store.editTask({ id: "t", revision: pad.current!.revision.task, title: "Human edit", actor: "human" });
  await expect(x.service.writeAgent(x.identity, "progress", { ...next(pad.current!), note: "stale" })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
});

test("a fresh workpad revision always carries the matching human acceptance edits", async () => {
  const x = await setup();
  await x.store.mutate(board => {
    board.workpads[0].acceptance[0].done = false;
    return { value: undefined, changed: true };
  });
  const old = await x.service.readAgent(x.identity);
  await x.store.mutate(board => {
    board.workpads[0].acceptance[0].done = true;
    board.workpads[0].revision++;
    return { value: undefined, changed: true };
  });
  const result = await x.service.writeAgent(x.identity, "progress", { ...next(old), note: "checkpoint after a human tick" });
  expect(old.workpad?.acceptance[0].done).toBe(false);
  expect(result.current?.workpad).toMatchObject({ revision: 2, acceptance: [{ id: "seeded", done: true }] });
  await x.service.writeAgent(x.identity, "workpad", {
    ...next(result.current!), workpadRevision: result.current!.workpad!.revision,
    acceptance: result.current!.workpad!.acceptance!,
  });
  expect((await x.store.read()).workpads[0].acceptance[0].done).toBe(true);
});

test("detail is presentation only: replay retains original receipt and reports current human completion", async () => {
  const x = await setup();
  const ctx = await x.service.readAgent(x.identity);
  const input = { ...next(ctx), status: "development", note: "start" };
  const first = await x.service.writeAgent(x.identity, "status", input);
  await x.store.editTask({ id: "t", revision: first.receipt.taskRevision, status: "done", actor: "human" });
  x.advance(16 * 60 * 1000);
  const replay = await x.service.writeAgent(x.identity, "status", { ...input, responseDetail: "full" });
  expect(replay).toMatchObject({ receipt: first.receipt, replayed: true, current: { toolVersion: 1, task: { status: "done" }, writable: false } });
  expect(replay.receipt.status).toBe("development");
  const compactReplay = await x.service.writeAgent(x.identity, "status", input);
  expect(compactReplay).toMatchObject({ receipt: first.receipt, replayed: true, current: null });
  expect(compactReplay.contextError).toContain("Re-read the task");
  await expect(x.service.writeAgent(x.identity, "status", { ...input, responseDetail: "compact", note: "different" })).rejects.toMatchObject({ code: "REQUEST_REUSED" });
});

test.each(["task", "project"])("an intervening %s edit cannot authorize unseen revisions in compact continuation", async (changed) => {
  const x = await setup();
  const ctx = await x.service.readAgent(x.identity);
  const stale = await x.service.readAgent(x.identity);
  const original = x.store.transaction.bind(x.store);
  const mutation = vi.spyOn(x.store, "transaction").mockImplementation(async (...args) => {
    const value = await original(...args);
    await original(board => {
      if (changed === "task") {
        board.tasks[0].description = "New human instruction";
        board.tasks[0].revision++;
      } else {
        board.projects[0].description = "New project instruction";
        board.projects[0].revision++;
      }
      return { value: undefined, changed: true };
    });
    return value;
  });
  const input = { ...next(ctx), status: "development", note: "committed before edit" };
  const result = await x.service.writeAgent(x.identity, "status", input);
  expect(result).toMatchObject({ current: null, replayed: false, receipt: { action: "status", taskRevision: 2, projectRevision: 1 } });
  expect(result.contextError).toContain("Re-read the task");
  mutation.mockRestore();
  const fresh = await x.service.readAgent(x.identity);
  expect(changed === "task" ? fresh.task.description : fresh.project.description).toContain("New");
  await expect(x.service.writeAgent(x.identity, "progress", { ...next(stale), note: "old revision" })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
});

test("a committed compact write still returns its receipt when continuation fails", async () => {
  const x = await setup();
  const ctx = await x.service.readAgent(x.identity);
  const original = x.store.transaction.bind(x.store);
  vi.spyOn(x.store, "transaction").mockImplementation(async (...args) => {
    const value = await original(...args);
    x.setWorkspace(null);
    return value;
  });
  const result = await x.service.writeAgent(x.identity, "progress", { ...next(ctx), note: "committed" });
  expect(result).toMatchObject({ current: null, replayed: false, receipt: { action: "progress" } });
  expect(result.contextError).toContain("Workspace");
  expect((await x.store.read()).events.some(e => e.id === result.receipt.eventId)).toBe(true);
});

test("compact reads filter before limiting, strip bookkeeping and false flags, and writes do not read inputs", async () => {
  const x = await setup();
  await x.store.mutate(board => {
    const stamp = new Date().toISOString();
    for (let i = 0; i < 12; i++) board.events.push({ id: "human-" + i, taskId: "t", actor: "human", action: "edited", note: "instruction-" + i, at: stamp });
    for (let i = 0; i < 25; i++) board.events.push({ id: "life-" + i, taskId: "t", actor: "system", action: "agent.turn_ended", at: stamp });
    board.events.push({ id: "moves", taskId: "t", actor: "agent", action: "next_moves_suggested", at: stamp, moves: [{ label: "Again", prompt: "x".repeat(1000) }] });
    return { value: undefined, changed: true };
  });
  const ctx = await x.service.readAgent(x.identity);
  expect(ctx.activity.map(e => e.note)).toEqual(Array.from({ length: 10 }, (_, i) => "instruction-" + (i + 2)));
  expect(ctx.activity[0]).not.toHaveProperty("id");
  expect(ctx.task).not.toHaveProperty("operationId");
  expect(ctx.project).not.toHaveProperty("createdAt");
  expect(ctx.workpad?.acceptance[0]).toEqual({ id: "seeded", text: "Seeded criterion", done: true });
  expect(agentReadSchema.safeParse(ctx).success).toBe(true);
  await x.store.mutate(board => putArtifact(x.store, board, { taskId: "t", createdBy: "human", role: "input", kind: "url", target: "https://example.com/new", title: "New input" }));
  await x.service.writeAgent(x.identity, "progress", { ...next(ctx), note: "does not mark inputs read" });
  const unread = await x.service.readAgent(x.identity);
  expect(unread.artifacts[0]).toMatchObject({ unread: true });
  expect(unread.artifacts[0]).not.toHaveProperty("missing");
  const read = await x.service.readAgent(x.identity);
  expect(read.artifacts[0]).not.toHaveProperty("unread");
  const full = await x.service.readAgent(x.identity, { responseDetail: "full" });
  expect(full).toMatchObject({ toolVersion: 1, task: { operationId: "create" } });
  expect(full.artifacts[0]).toMatchObject({ unread: false, missing: false });
});

test("Jira's deprecated ticket alias stays in full output only", async () => {
  const x = await setup();
  const full = await x.service.get(x.identity);
  const external = { provider: "jira-cloud", itemType: "issue", key: "TEST-1", summary: "Input", status: "Open", type: "Bug", priority: "", assignee: "", container: "TEST", updated: "", stale: false, connection: "ok" } as const;
  const context = { ...full, artifacts: [{ id: "a", role: "input", kind: "url", target: "https://example.com/TEST-1", title: "Input", note: "", createdBy: "human", missing: false, unread: true, external, ticket: external }] } as ToolContext;
  const compact = compactRead(context);
  expect(compact.artifacts[0]).toHaveProperty("external");
  expect(compact.artifacts[0]).not.toHaveProperty("ticket");
  expect(agentReadSchema.parse(context).artifacts[0]).toHaveProperty("ticket");
});

test("busy-card fixture measures read/write reduction without counting duplicate MCP envelopes", async () => {
  const x = await setup();
  await x.store.mutate(board => {
    const stamp = new Date().toISOString();
    for (let i = 0; i < 20; i++) board.events.push({ id: "moves-" + i, taskId: "t", actor: "agent", action: "next_moves_suggested", at: stamp, moves: [{ label: "Continue", prompt: "Repeated next instruction ".repeat(40) }] });
    return { value: undefined, changed: true };
  });
  const full = await x.service.get(x.identity);
  const read = await x.service.readAgent(x.identity);
  const input = { ...next(read), note: "checkpoint" };
  const compact = await x.service.writeAgent(x.identity, "progress", input);
  const legacy = await x.service.writeAgent(x.identity, "progress", { ...input, responseDetail: "full" });
  const sizes = { fullRead: JSON.stringify(full).length, compactRead: JSON.stringify(read).length, fullWrite: JSON.stringify(legacy).length, compactWrite: JSON.stringify(compact).length };
  expect(sizes.compactWrite).toBeLessThan(sizes.fullWrite * 0.2);
  expect(sizes.compactRead).toBeLessThan(sizes.fullRead * 0.75);
  process.stdout.write("AGENT_OUTPUT_CHARACTERS " + JSON.stringify(sizes) + "\n");
});

test("real MCP default outputs validate and chain get → workpad → progress", async () => {
  const x = await transport();
  let id = 0;
  const mcp = async (method: string, params: unknown) => {
    const response = await fetch(x.url + "mcp", { method: "POST", headers: { Authorization: x.authorization, "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) });
    const body = await response.text();
    return JSON.parse(response.headers.get("content-type")?.includes("text/event-stream") ? body.split("\n").filter(l => l.startsWith("data: ")).at(-1)!.slice(6) : body);
  };
  await mcp("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "issue-109-test", version: "1" } });
  const call = async (name: string, args: unknown) => {
    const response = await mcp("tools/call", { name, arguments: args });
    expect(response.result.isError).not.toBe(true);
    expect(JSON.parse(response.result.content[0].text)).toEqual(response.result.structuredContent);
    return response.result.structuredContent;
  };
  const ctx = await call("flowly_get_task", {});
  expect(ctx.toolVersion).toBe(2);
  const pad = await call("flowly_update_workpad", { ...next(ctx), workpadRevision: ctx.workpad.revision, acceptance: [{ text: "MCP chain", done: true }] });
  expect(pad.current.workpad.acceptance[0].id).toBeTruthy();
  const result = await call("flowly_report_progress", { ...next(pad.current), note: "MCP continued" });
  expect(result.current).not.toHaveProperty("activity");
  expect(agentWriteSchema.safeParse(result).success).toBe(true);
});

test("real CLI saves write continuation, preserves snapshot on refusal, and retains --full", async () => {
  const x = await transport();
  const snapshot = x.root + "/request.json";
  const first = JSON.parse((await x.cli("current", "--save-request", snapshot)).stdout);
  expect(first.toolVersion).toBe(2);
  await x.cli("status", "development", "--request-file", snapshot, "--save-request", snapshot, "--note", "start");
  const saved = JSON.parse(await readFile(snapshot, "utf8"));
  expect(saved.request.id).not.toBe(first.request.id);
  expect((await stat(snapshot)).mode & 0o777).toBe(0o600);
  const pad = JSON.parse((await x.cli("workpad", "--request-file", snapshot, "--save-request", snapshot, "--workpad-revision", "1", "--workpad", JSON.stringify({ acceptance: [{ text: "CLI chain", done: true }] }))).stdout);
  expect(pad.current.workpad.acceptance[0].id).toBe("cli-chain");
  expect(JSON.parse(await readFile(snapshot, "utf8")).workpad).toEqual(pad.current.workpad);
  const before = await readFile(snapshot, "utf8");
  await expect(x.cli("status", "done", "--request-file", snapshot, "--save-request", snapshot, "--note", "forbidden")).rejects.toMatchObject({ code: 1 });
  expect(await readFile(snapshot, "utf8")).toBe(before);
  const full = JSON.parse((await x.cli("current", "--full")).stdout);
  expect(full.task.operationId).toBe("create");
  const result = JSON.parse((await x.cli("note", "--full", "--request-file", snapshot, "--note", "legacy full" )).stdout);
  expect(result.current.activity.at(-1).note).toBe("legacy full");
});

test("CLI reports a committed write when continuation/save fails and keeps the retry snapshot", async () => {
  const x = await transport();
  const snapshot = x.root + "/request.json";
  await x.cli("current", "--save-request", snapshot);
  const before = await readFile(snapshot, "utf8");
  const workspace = x.workspace();
  const original = x.store.transaction.bind(x.store);
  const mutation = vi.spyOn(x.store, "transaction").mockImplementation(async (...args) => {
    const value = await original(...args);
    x.setWorkspace(null);
    return value;
  });
  const args = ["note", "--request-file", snapshot, "--save-request", snapshot, "--note", "saved on server"];
  const failure = await x.cli(...args).catch(e => e);
  expect(JSON.parse(failure.stdout)).toMatchObject({ current: null, receipt: { action: "progress" } });
  expect(failure.stderr).toContain("Write committed");
  expect(await readFile(snapshot, "utf8")).toBe(before);
  mutation.mockRestore();
  x.setWorkspace(workspace);
  const replay = JSON.parse((await x.cli(...args)).stdout);
  expect(replay.replayed).toBe(true);
  // A local save failure must also keep the successful receipt visible on stdout.
  const beforeSaveFailure = await readFile(snapshot, "utf8");
  const failure2 = await x.cli("note", "--request-file", snapshot, "--save-request", x.root + "/absent/request.json", "--note", "second server write").catch(e => e);
  expect(JSON.parse(failure2.stdout).receipt.action).toBe("progress");
  expect(failure2.stderr).toContain("Write committed");
  expect(await readFile(snapshot, "utf8")).toBe(beforeSaveFailure);
});
