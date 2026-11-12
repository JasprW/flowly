import { afterEach, describe, expect, test, vi } from "vitest";
import { rm } from "node:fs/promises";
import type { PaseoApi } from "@getpaseo/client";
import { artifactContextLines } from "../../shared/artifacts";
import { agentFixture } from "../agent-fixture";
import { ArtifactService } from "../artifacts";
import { BoardService } from "../service";
import { fakeService, fixtures, type Route } from "./fake";
import { fingerprintChanged } from "./fingerprint";

const env = fixtures();
afterEach(() => env.cleanup());

const base = "https://linear.app/acme";

type Issue = { key: string; title: string; description?: string; state?: string; stateType?: string; assignee?: string; updated?: string; children?: string[] };
type Comment = { id: string; body: string; created?: string; updated?: string };

const STATE_TYPES: Record<string, string> = { Backlog: "backlog", Todo: "unstarted", "In Progress": "started", Done: "completed", Canceled: "canceled" };

type Options = { status?: number; errors?: unknown[]; headers?: Record<string, string>; urlKey?: string; body?: unknown };

function linear(issues: Issue[], comments: Record<string, Comment[]> = {}, options: Options = {}) {
  const summary = (i: Issue) => ({
    id: `uuid-${i.key}`,
    identifier: i.key,
    title: i.title,
    url: `${base}/issue/${i.key}/${i.title.toLowerCase().replace(/\W+/g, "-")}`,
    updatedAt: i.updated || "2026-10-19T08:00:00.000Z",
    priorityLabel: "High",
    state: { name: i.state || "In Progress", type: i.stateType || STATE_TYPES[i.state || "In Progress"] },
    assignee: i.assignee ? { name: i.assignee, displayName: i.assignee.split(" ")[0]!.toLowerCase() } : null,
    team: { key: i.key.split("-")[0], name: "Engineering" },
  });
  const full = (i: Issue) => ({
    ...summary(i),
    description: i.description ?? "Steps:\n- open",
    branchName: `ada/${i.key.toLowerCase()}-fix`,
    dueDate: null,
    estimate: 3,
    labels: { nodes: [{ name: "backend" }] },
    project: { name: "Reliability" },
    cycle: { number: 7, name: null },
    parent: null,
    children: { nodes: (i.children || []).flatMap((k) => issues.filter((x) => x.key === k)).map((c) => ({ identifier: c.key, title: c.title, state: { name: c.state || "In Progress" } })) },
    comments: {
      nodes: (comments[i.key] || []).map((c) => ({ id: c.id, body: c.body, createdAt: c.created || "2026-10-19T09:00:00.000Z", updatedAt: c.updated || c.created || "2026-10-19T09:00:00.000Z", user: { name: "Ada Lovelace", displayName: "ada" } })),
    },
  });
  const route: Route = (url, raw) => {
    if (options.status) return { status: options.status, headers: options.headers, body: { errors: options.errors || [{ message: "nope" }] } };
    if (options.body) return { body: options.body, headers: options.headers };
    if (url.pathname !== "/graphql" || !raw) return undefined;
    const { query, variables } = JSON.parse(raw) as { query: string; variables: Record<string, unknown> };
    if (query.includes("FlowlyViewer"))
      return { body: { data: { viewer: { id: "u1", name: "Ada Lovelace", displayName: "ada", email: "ada@example.com" }, organization: { name: "Acme", urlKey: options.urlKey ?? "acme" } } } };
    if (query.includes("FlowlyIssue")) {
      const found = issues.find((i) => i.key === variables.id);
      if (!found) return { body: { data: null, errors: [{ message: "Entity not found: Issue", extensions: { type: "invalid input", code: "INVALID_INPUT" } }] } };
      if (!query.includes("FlowlyIssueFull")) return { body: { data: { issue: summary(found) } } };
      const issue = full(found);
      // Linear's first page is newest first (public schema, Issue.comments.orderBy).
      const first = Number(/comments\(first: (\d+)/.exec(query)?.[1] || 50);
      issue.comments.nodes.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      issue.comments.nodes = issue.comments.nodes.slice(0, first);
      return { body: { data: { issue } } };
    }
    if (query.includes("FlowlyRecent")) {
      const open = issues.filter((i) => i.assignee && !["completed", "canceled"].includes(STATE_TYPES[i.state || "In Progress"]!));
      return { body: { data: { viewer: { assignedIssues: { nodes: open.map(summary) } } } } };
    }
    if (query.includes("FlowlySearch")) {
      const term = String(variables.term).toLowerCase();
      return { body: { data: { issues: { nodes: issues.filter((i) => i.title.toLowerCase().includes(term)).map(summary) } } } };
    }
    return { status: 400, body: { errors: [{ message: "Unknown query" }] } };
  };
  return fakeService(route);
}

async function connected(issues: Issue[], comments: Record<string, Comment[]> = {}) {
  const fake = linear(issues, comments);
  const service = await env.service(fake.fetchImpl);
  const connection = await service.save({ provider: "linear", baseUrl: base, secret: "lin_api_secret" });
  return { service, connection, ...fake };
}

const refOf = (connectionId: string, key: string) => ({ connectionId, provider: "linear" as const, itemType: "issue" as const, key, remoteId: `uuid-${key}` });

describe("Linear (CONNECTORS-SPEC §15)", () => {
  test("connecting sends the API key to the GraphQL host; a refused key and a foreign workspace are not saved", async () => {
    const x = await connected([]);
    expect(x.connection).toMatchObject({ provider: "linear", baseUrl: base, account: "Ada Lovelace (@ada)" });
    expect(x.calls[0]!.url.href).toBe("https://api.linear.app/graphql");
    expect(x.calls[0]!.headers.Authorization).toBe("lin_api_secret");
    expect(JSON.stringify(await x.service.list())).not.toContain("lin_api_secret");

    const refused = await env.service(linear([], {}, { status: 400, errors: [{ message: "Authentication required, not authenticated", extensions: { code: "AUTHENTICATION_ERROR" } }] }).fetchImpl);
    await expect(refused.save({ provider: "linear", baseUrl: base, secret: "bad" })).rejects.toThrow(/refused the API key/);

    const elsewhere = await env.service(linear([], {}, { urlKey: "other-org" }).fetchImpl);
    await expect(elsewhere.save({ provider: "linear", baseUrl: base, secret: "lin_api_secret" })).rejects.toThrow(/"other-org" workspace/);
  });

  test("an issue link and a bare TEAM-123 key become inputs; a missing issue is not found", async () => {
    const x = await connected([{ key: "ENG-123", title: "Fix the retry backoff" }]);
    expect(await x.service.recognize(`${base}/issue/ENG-123/fix-the-retry-backoff`)).toMatchObject({
      external: { provider: "linear", itemType: "issue", key: "ENG-123", remoteId: "uuid-ENG-123" },
      title: "ENG-123 Fix the retry backoff",
    });
    expect(await x.service.recognize("eng-123")).toMatchObject({ external: { key: "ENG-123" } });
    await expect(x.service.recognize(`${base}/issue/ENG-999`)).rejects.toMatchObject({ code: "EXTERNAL_NOT_FOUND" });
  });

  test("picker: my open issues newest first, and title words as a variable", async () => {
    const x = await connected([
      { key: "ENG-1", title: "Retry backoff wrong", assignee: "Ada Lovelace", updated: "2026-10-19T10:00:00.000Z" },
      { key: "ENG-2", title: "Counters reset", assignee: "Ada Lovelace", updated: "2026-10-19T11:00:00.000Z", state: "Todo" },
      { key: "ENG-3", title: "Shipped already", assignee: "Ada Lovelace", state: "Done" },
    ]);
    const recent = await x.service.search({ connectionId: x.connection.id, query: "" });
    expect(recent.results.map((r) => r.key)).toEqual(["ENG-2", "ENG-1"]);
    expect(recent.results[0]).toMatchObject({ status: "Todo", statusCategory: "new", priority: "High", assignee: "ada", container: "Engineering" });
    expect(recent.results[1]).toMatchObject({ statusCategory: "indeterminate" });

    const text = await x.service.search({ connectionId: x.connection.id, query: 'counters" } mutation {' });
    expect(text.results).toEqual([]);
    const sent = JSON.parse(x.calls.at(-1)!.body!) as { query: string; variables: { term: string } };
    expect(sent.variables.term).toBe('counters" } mutation {');
    expect(sent.query).not.toContain("counters");
    expect((await x.service.search({ connectionId: x.connection.id, query: "counters" })).results.map((r) => r.key)).toEqual(["ENG-2"]);
  });

  test("a full read carries description, metadata, sub-issues and comments; the description moves the fingerprint, the status does not", async () => {
    const issues: Issue[] = [
      { key: "ENG-123", title: "Fix the retry backoff", assignee: "Ada Lovelace", description: "The client retries too aggressively.", children: ["ENG-124"] },
      { key: "ENG-124", title: "Add jitter", state: "Done" },
    ];
    const comments = { "ENG-123": [{ id: "c2", body: "Merged.", created: "2026-10-19T10:00:00.000Z" }, { id: "c1", body: "Branch is up." }] };
    const x = await connected(issues, comments);
    const ref = refOf(x.connection.id, "ENG-123");

    const first = await x.service.detail(ref);
    for (const part of ["# ENG-123 Fix the retry backoff", "- Status: In Progress", "- Team: Engineering", "- Priority: High", "- Assignee: ada", "- Labels: backend", "- Project: Reliability", "- Cycle: Cycle 7", "- Branch: ada/eng-123-fix", "The client retries too aggressively.", "## Sub-issues (1)", "- ENG-124 Add jitter (Done)", "### ada · 2026-10-19T09:00:00.000Z"])
      expect(first.markdown).toContain(part);
    // Comments read oldest first whatever order the API sends them in.
    expect(first.markdown.indexOf("Branch is up.")).toBeLessThan(first.markdown.indexOf("Merged."));

    issues[0]!.state = "Done";
    expect((await x.service.detail(ref, true)).fingerprint).toBe(first.fingerprint);

    issues[0]!.description = "Rewritten.";
    const edited = await x.service.detail(ref, true);
    expect(edited.fingerprint).not.toBe(first.fingerprint);
    expect(fingerprintChanged("output", first.fingerprint, edited.fingerprint)).toBe(false);

    comments["ENG-123"].push({ id: "c3", body: "Reopened.", created: "2026-10-20T09:00:00.000Z" });
    expect(fingerprintChanged("output", edited.fingerprint, (await x.service.detail(ref, true)).fingerprint)).toBe(true);
  });

  test("every request is a read-only GraphQL query POSTed to the API host", async () => {
    const x = await connected([{ key: "ENG-1", title: "One", assignee: "Ada Lovelace" }]);
    await x.service.search({ connectionId: x.connection.id, query: "" });
    await x.service.search({ connectionId: x.connection.id, query: "one" });
    await x.service.detail(refOf(x.connection.id, "ENG-1"));
    expect(x.calls.length).toBeGreaterThan(3);
    for (const call of x.calls) {
      expect(call.method).toBe("POST");
      expect(call.url.href).toBe("https://api.linear.app/graphql");
      const { query } = JSON.parse(call.body!) as { query: string };
      expect(query).toMatch(/^query /);
      expect(query).not.toMatch(/mutation/i);
    }
  });

  test("rate limiting reports how long to wait", async () => {
    const options: { status?: number; errors?: unknown[]; headers?: Record<string, string> } = {};
    const fake = linear([{ key: "ENG-1", title: "One" }], {}, options);
    const service = await env.service(fake.fetchImpl);
    const connection = await service.save({ provider: "linear", baseUrl: base, secret: "t" });
    options.status = 400;
    options.errors = [{ message: "Rate limit exceeded", extensions: { code: "RATELIMITED" } }];
    options.headers = { "retry-after": "30" };
    await expect(service.search({ connectionId: connection.id, query: "one" })).rejects.toMatchObject({ code: "EXTERNAL_UNAVAILABLE", retryAfter: 30 });
  });

  test("only a Linear workspace URL can be connected, and verification requires an account and workspace", async () => {
    const fake = linear([]);
    const service = await env.service(fake.fetchImpl);
    for (const baseUrl of ["https://example.com/acme", "https://linear.app", "https://linear.app/acme/settings", "https://linear.app:444/acme"]) {
      await expect(service.save({ provider: "linear", baseUrl, secret: "t" })).rejects.toThrow(/workspace address/);
    }
    expect(fake.calls).toHaveLength(0);
    const malformed = await env.service(linear([], {}, { body: { data: { viewer: null, organization: null } } }).fetchImpl);
    await expect(malformed.save({ provider: "linear", baseUrl: base, secret: "t" })).rejects.toThrow(/account and workspace/);
  });

  test("GraphQL errors with partial data never replace a cached issue or silently return an empty search", async () => {
    const options: Options = {};
    const fake = linear([{ key: "ENG-1", title: "Keep this cached" }], {}, options);
    const service = await env.service(fake.fetchImpl);
    const connection = await service.save({ provider: "linear", baseUrl: base, secret: "t" });
    const ref = refOf(connection.id, "ENG-1");
    const before = await service.detail(ref);
    options.body = { data: { issue: { id: "uuid-ENG-1", identifier: "ENG-1", title: "Incomplete" } }, errors: [{ message: "Comments unavailable" }] };
    await expect(service.detail(ref, true)).rejects.toMatchObject({ code: "EXTERNAL_INVALID" });
    expect(await service.detail(ref)).toEqual(before);
    options.body = { data: { issues: null }, errors: [{ message: "Rate limit exceeded", extensions: { code: "RATELIMITED" } }] };
    options.headers = { "retry-after": "30" };
    await expect(service.search({ connectionId: connection.id, query: "keep" })).rejects.toMatchObject({ code: "EXTERNAL_UNAVAILABLE", retryAfter: 30 });
  });

  test("a revoked key marks the connection authFailed and keeps its cached issue", async () => {
    const options: Options = {};
    const fake = linear([{ key: "ENG-1", title: "Cached" }], {}, options);
    const service = await env.service(fake.fetchImpl);
    const connection = await service.save({ provider: "linear", baseUrl: base, secret: "t" });
    const ref = refOf(connection.id, "ENG-1");
    const before = await service.detail(ref);
    options.body = { data: { issue: null }, errors: [{ message: "Not authenticated", extensions: { code: "AUTHENTICATION_ERROR" } }] };
    await expect(service.detail(ref, true)).rejects.toMatchObject({ code: "EXTERNAL_AUTH" });
    expect((await service.list())[0].authFailed).toBe(true);
    expect(await service.detail(ref)).toEqual(before);
  });

  test("full reads keep the latest 20 comments even when an issue has more than 100", async () => {
    const comments = Array.from({ length: 120 }, (_, i) => ({ id: `c${i}`, body: `Comment #${i}.`, created: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString() }));
    const x = await connected([{ key: "ENG-1", title: "Long discussion" }], { "ENG-1": comments });
    const detail = await x.service.detail(refOf(x.connection.id, "ENG-1"));
    expect(detail.markdown).toContain("## Comments (latest 20)");
    expect(detail.markdown).toContain("Comment #119.");
    expect(detail.markdown).not.toContain("Comment #99.");
    expect(detail.markdown.indexOf("Comment #100.")).toBeLessThan(detail.markdown.indexOf("Comment #119."));
  });

  test("Linear inputs create with a card, link to an existing card and remain scoped to that card for agents", async () => {
    const x = await agentFixture();
    try {
      const issues: Issue[] = [{ key: "ENG-1", title: "First", description: "Reproduce the retry." }, { key: "ENG-2", title: "Second" }];
      const connector = await connected(issues);
      const service = new BoardService(x.store);
      service.connectors = connector.service;
      const create = vi.fn(async () => ({ id: "w2" }));
      const paseo = { workspaces: { create, ref: () => ({ refresh: async () => ({ id: "w2", projectId: "native", workspaceDirectory: x.a, workspaceKind: "directory", status: "done" }) }) } } as unknown as PaseoApi;
      const input = { projectId: "p", operationId: "linear-create", title: "From Linear", description: "", status: "todo" as const, priority: "normal" as const, mode: "directory" as const, baseRef: "", externals: [{ connectionId: connector.connection.id, key: "ENG-2", itemType: "issue" as const }] };
      const card = await service.createTask(input, paseo);
      const saved = await x.store.read();
      const created = saved.artifacts.find((a) => a.taskId === card.id)!;
      expect(created).toMatchObject({ role: "input", createdBy: "human", external: { provider: "linear", key: "ENG-2" } });
      expect(artifactContextLines([created]).join("\n")).toContain("Linear issue; read it with flowly_read_external");

      // An unreadable input must fail before provisioning another workspace.
      await expect(service.createTask({ ...input, operationId: "missing", externals: [{ connectionId: connector.connection.id, key: "ENG-404" }] }, paseo)).rejects.toThrow(/not found/i);
      expect(create).toHaveBeenCalledTimes(1);

      const artifacts = new ArtifactService(x.store, connector.service);
      const before = saved.tasks.find((t) => t.id === "t");
      const linked = await artifacts.create({ taskId: "t", role: "input", target: `${base}/issue/ENG-1/first` }, x.paseo);
      await artifacts.create({ taskId: "t", role: "input", target: "eng-1" }, x.paseo);
      expect((await x.store.read()).artifacts.filter((a) => a.taskId === "t")).toHaveLength(1);
      expect((await x.store.read()).tasks.find((t) => t.id === "t")).toEqual(before);

      x.service.connectors = connector.service;
      const context = await x.service.get(x.identity);
      expect(context.artifacts[0]).toMatchObject({ external: { provider: "linear", key: "ENG-1" } });
      expect(await x.service.readExternal(x.identity, { artifactId: linked.id })).toMatchObject({ key: "ENG-1", markdown: expect.stringContaining("Reproduce the retry.") });
      const requests = connector.calls.length;
      await expect(x.service.readExternal(x.identity, { artifactId: created.id })).rejects.toMatchObject({ code: "EXTERNAL_NOT_FOUND" });
      expect(connector.calls).toHaveLength(requests);
      issues[0].description = "The requirements changed.";
      await connector.service.detail(linked.external!, true);
      expect((await x.service.get(x.identity)).artifacts[0]).toMatchObject({ unread: true });
    } finally {
      await x.store.close();
      await rm(x.root, { recursive: true, force: true });
    }
  });
});
