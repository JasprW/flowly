import { afterEach, expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { AgentService } from "./agent-service";
import { BoardStore } from "./store";
import { ToolSecrets } from "./tool-context";
import { agentFixture } from "./agent-fixture";
import { ToolServer } from "./tool-server";
import { readFile } from "node:fs/promises";

const roots: string[] = [];
async function setup(seed?: Parameters<typeof agentFixture>[0]) {
  const f = await agentFixture(seed);
  roots.push(f.root);
  return f;
}
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((p) => rm(p, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })),
  );
});
const input = (
  ctx: Awaited<ReturnType<AgentService["get"]>>,
  fields: Record<string, unknown> = {},
) => ({ expectedRevision: ctx.revision, request: ctx.request, ...fields });

test("flowly_update_project changes the card's own project's title, description and agentModel through store.updateProject's edit", async () => {
  const x = await setup(),
    ctx = await x.service.get(x.identity);
  const call = input(ctx, {
    title: "Renamed",
    description: "Set by an agent",
    agentModel: { provider: "dsh-web", model: "homelab/glm-5.3-flash", mode: "standard" },
  });
  const result = await x.service.write(x.identity, "update_project", call);
  let project = (await x.store.read()).projects[0];
  expect(project.title).toBe("Renamed");
  expect(project.description).toBe("Set by an agent");
  expect(project.agentModel).toEqual({ provider: "dsh-web", model: "homelab/glm-5.3-flash", mode: "standard" });
  expect(project.revision).toBe(ctx.revision.project + 1);
  expect(result.receipt.action).toBe("update_project");
  expect(result.receipt.projectRevision).toBe(project.revision);
  // The card is untouched: no task revision bump, no status change.
  expect(result.receipt.taskRevision).toBe(ctx.revision.task);
  expect(result.receipt.status).toBe(ctx.task.status ?? "todo");
  expect((await x.store.read()).events.at(-1)).toMatchObject({
    action: "project_updated",
    actor: "agent",
    note: "Updated project title, description, agentModel.",
  });
  // A replay acknowledges the original write without another change.
  expect((await x.service.write(x.identity, "update_project", call)).replayed).toBe(true);
  expect((await x.store.read()).projects[0].revision).toBe(project.revision);
});

test("agentModel=null removes the project default so the global one applies again", async () => {
  const x = await setup(),
    ctx = await x.service.get(x.identity);
  await x.service.write(x.identity, "update_project", input(ctx, { agentModel: { provider: "p", model: "m" } }));
  let ctx2 = await x.service.get(x.identity);
  await x.service.write(x.identity, "update_project", input(ctx2, { agentModel: null }));
  const project = (await x.store.read()).projects[0];
  expect("agentModel" in project).toBe(false);
});

test("scoped: only title, description and agentModel are accepted, and only the card's own project changes", async () => {
  const x = await setup(),
    ctx = await x.service.get(x.identity);
  // A second project exists but belongs to no card of this session.
  const stamp = new Date().toISOString();
  await x.store.mutate((board) => {
    board.projects.push({
      id: "other",
      paseoProjectId: "other",
      title: "Other",
      description: "",
      primaryPath: x.a,
      repos: [x.a],
      revision: 1,
      createdAt: stamp,
      updatedAt: stamp,
      archivedAt: null,
    });
  });
  // UI-only fields are refused (strictObject), and so is a call that changes nothing.
  await expect(
    x.service.write(x.identity, "update_project", input(ctx, { lanes: [{ status: "done", enabled: false }] })),
  ).rejects.toThrow(/Unrecognized key/);
  await expect(
    x.service.write(x.identity, "update_project", input(ctx, { archived: true })),
  ).rejects.toThrow(/Unrecognized key/);
  await expect(x.service.write(x.identity, "update_project", input(ctx))).rejects.toMatchObject({ code: "INVALID_INPUT" });
  // The write lands on the session's own project only.
  await x.service.write(x.identity, "update_project", input(ctx, { title: "Renamed" }));
  const projects = (await x.store.read()).projects;
  expect(projects.find((p) => p.id === "p")!.title).toBe("Renamed");
  expect(projects.find((p) => p.id === "other")).toMatchObject({ title: "Other", revision: 1 });
});

test("revision discipline: a stale project revision is REVISION_CONFLICT, an expired request is REQUEST_EXPIRED, and nothing is written", async () => {
  const x = await setup(),
    ctx = await x.service.get(x.identity);
  // A human edit makes the signed project revision stale; the request itself still matches it.
  await x.store.updateProject({ id: "p", revision: ctx.revision.project, title: "Human rename" });
  await expect(
    x.service.write(x.identity, "update_project", input(ctx, { title: "Renamed" })),
  ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
  expect((await x.store.read()).agentReceipts).toHaveLength(0);
  const fresh = await x.service.get(x.identity);
  x.advance(15 * 60 * 1000 + 1);
  await expect(
    x.service.write(x.identity, "update_project", input(fresh, { title: "Renamed" })),
  ).rejects.toMatchObject({ code: "REQUEST_EXPIRED" });
  const board = await x.store.read();
  expect(board.projects[0]).toMatchObject({ title: "Human rename", revision: 2 });
  expect(board.agentReceipts).toHaveLength(0);
});

test("/api update_project and the flowly_update_project MCP tool reach the same write", async () => {
  const fixture = await agentFixture(),
    server = new ToolServer(fixture.store);
  roots.push(fixture.root);
  server.attach(fixture.paseo);
  await server.start();
  const { url } = JSON.parse(
    await readFile(fixture.store.directory + "/tool-endpoint.json", "utf8"),
  );
  const authorization = "Bearer " + server.secrets.credential(fixture.identity);
  const api = async (action: string, input: unknown) => {
    const response = await fetch(url + "api", {
      method: "POST",
      headers: { Authorization: authorization, "Content-Type": "application/json" },
      body: JSON.stringify({ action, input }),
    });
    return { status: response.status, ...(await response.json()) };
  };
  const mcp = async (method: string, params: unknown, id = 1) => {
    const response = await fetch(url + "mcp", {
      method: "POST",
      headers: {
        Authorization: authorization,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });
    expect(response.status).toBe(200);
    const body = await response.text();
    return JSON.parse(
      response.headers.get("content-type")?.includes("text/event-stream")
        ? body.split("\n").find((line) => line.startsWith("data:"))!.slice(5)
        : body,
    );
  };
  const listed = await mcp("tools/list", {});
  expect(listed.result.tools.map((t: { name: string }) => t.name)).toContain("flowly_update_project");
  const ctx = (await api("get", {})).result;
  const write = await api("update_project", input(ctx, { description: "Via /api" }));
  expect(write.status).toBe(200);
  expect(write.result.receipt.action).toBe("update_project");
  expect((await fixture.store.read()).projects[0].description).toBe("Via /api");
  const ctx2 = (await api("get", {})).result;
  const tool = await mcp("tools/call", {
    name: "flowly_update_project",
    arguments: input(ctx2, { description: "Via MCP" }),
  });
  expect(tool.result.structuredContent.receipt.action).toBe("update_project");
  expect((await fixture.store.read()).projects[0].description).toBe("Via MCP");
  await server.stop();
});
