import { afterEach, describe, expect, test, vi } from "vitest";
import type { PaseoApi } from "@getpaseo/client";
import { mkdtemp, mkdir, readFile, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JiraClient, contentFingerprint, ticketMarkdown, wikiToMarkdown } from "./jira";
import { ExternalError } from "./http";
import { ConnectorService } from "./service";
import { BoardStore } from "../store";
import { BoardService } from "../service";
import { ArtifactService } from "../artifacts";
import { artifactContextLines } from "../../shared/artifacts";
import { agentFixture } from "../agent-fixture";

const roots: string[] = [];
const services: ConnectorService[] = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map((s) => s.flush()));
  await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
/** A service whose background cache writes finish before the test's directory is removed. */
function tracked(service: ConnectorService) {
  services.push(service);
  return service;
}
async function temp() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "flowly-tickets-")));
  roots.push(root);
  return root;
}

type Issue = { id: string; key: string; fields: Record<string, unknown> };
const issue = (key: string, summary: string, extra: Record<string, unknown> = {}): Issue => ({
  id: String(10000 + Number(key.split("-")[1])),
  key,
  fields: {
    summary,
    status: { name: "In Progress", statusCategory: { key: "indeterminate" } },
    issuetype: { name: "Bug" },
    priority: { name: "High" },
    assignee: { displayName: "Ada" },
    updated: "2026-10-18T10:00:00.000+0800",
    description: "h3. Repro\n* open *search*",
    comment: { comments: [{ id: "1", author: { displayName: "Bob" }, body: "Seen on {{prod}}", created: "2026-10-18T09:00:00.000+0800" }], total: 1 },
    ...extra,
  },
});

/** A fake Jira that records every request; `status` forces a response code. */
function fakeJira(issues: Issue[], options: { status?: number; headers?: Record<string, string>; picker?: string[] } = {}) {
  const calls: { method: string; url: URL; auth: string }[] = [];
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...(options.headers || {}) } });
  const fetchImpl = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = (init?.headers || {}) as Record<string, string>;
    calls.push({ method: init?.method || "GET", url, auth: headers.Authorization || "" });
    if (options.status) return json({ errorMessages: ["nope"] }, options.status);
    const path = url.pathname;
    if (path.endsWith("/rest/api/2/myself")) return json({ displayName: "Ada Lovelace" });
    if (path.endsWith("/rest/api/2/issue/picker")) return json({ sections: [{ issues: (options.picker || []).map((key) => ({ key })) }] });
    const one = /\/rest\/api\/2\/issue\/([A-Z0-9_]+-\d+)$/.exec(path);
    if (one) {
      const found = issues.find((i) => i.key === one[1]);
      return found ? json(found) : json({ errorMessages: ["Issue does not exist"] }, 404);
    }
    if (path.endsWith("/rest/api/2/search") || path.endsWith("/rest/api/3/search/jql")) {
      const jql = url.searchParams.get("jql") || "";
      const keys = /key in \(([^)]*)\)/.exec(jql)?.[1]?.split(",").map((k) => k.trim());
      const list = keys ? issues.filter((i) => keys.includes(i.key)) : jql.startsWith("summary ~") ? issues.filter((i) => String(i.fields.summary).toLowerCase().includes("empty")) : issues;
      return json({ issues: list });
    }
    return json({}, 404);
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

async function connected(issues: Issue[], options: Parameters<typeof fakeJira>[1] = {}, provider: "jira-dc" | "jira-cloud" = "jira-dc") {
  const dir = await temp();
  const jira = fakeJira(issues, options);
  const service = tracked(new ConnectorService(join(dir, "connectors"), jira.fetchImpl));
  const connection = await service.save({
    provider,
    baseUrl: "https://jira.example.com/",
    secret: "secret-token",
    email: provider === "jira-cloud" ? "ada@example.com" : "",
  });
  return { dir, service, connection, ...jira };
}

describe("connections (EXTERNAL-TRACKER-SPEC §2)", () => {
  test("saving tests the token; the stored file is private and the client never sees the secret", async () => {
    const x = await connected([]);
    expect(x.connection).toMatchObject({ provider: "jira-dc", baseUrl: "https://jira.example.com", account: "Ada Lovelace", authFailed: false });
    expect(JSON.stringify(x.connection)).not.toContain("secret-token");
    expect(JSON.stringify(await x.service.list())).not.toContain("secret-token");
    expect(x.calls[0]!.auth).toBe("Bearer secret-token");
    const file = join(x.dir, "connectors", "connections.json");
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(await readFile(file, "utf8")).toContain("secret-token");
  });

  test("Jira Cloud uses email + API token; a refused token is not saved", async () => {
    const cloud = await connected([], {}, "jira-cloud");
    expect(cloud.calls[0]!.auth).toBe(`Basic ${Buffer.from("ada@example.com:secret-token").toString("base64")}`);
    const dir = await temp();
    const refused = tracked(new ConnectorService(join(dir, "connectors"), fakeJira([], { status: 401 }).fetchImpl));
    await expect(refused.save({ provider: "jira-dc", baseUrl: "https://jira.example.com", secret: "bad" })).rejects.toThrow(/refused the token/);
    expect(await refused.list()).toEqual([]);
  });

  test("Test connection checks with Jira without saving; editing tests with the stored token", async () => {
    const dir = await temp();
    const jira = fakeJira([]);
    const service = tracked(new ConnectorService(join(dir, "connectors"), jira.fetchImpl));
    expect(await service.test({ provider: "jira-dc", baseUrl: "https://jira.example.com/", secret: "t1" })).toEqual({ account: "Ada Lovelace", baseUrl: "https://jira.example.com" });
    expect(jira.calls.at(-1)).toMatchObject({ method: "GET", auth: "Bearer t1" });
    expect(await service.list()).toEqual([]);
    const saved = await service.save({ provider: "jira-dc", baseUrl: "https://jira.example.com", secret: "t1" });
    await service.test({ id: saved.id, provider: "jira-dc", baseUrl: "https://jira.example.com" });
    expect(jira.calls.at(-1)!.auth).toBe("Bearer t1");
    await expect(service.test({ provider: "jira-dc", baseUrl: "not a url", secret: "t" })).rejects.toThrow(/Jira address/);
    const refused = tracked(new ConnectorService(join(dir, "other"), fakeJira([], { status: 401 }).fetchImpl));
    await expect(refused.test({ provider: "jira-dc", baseUrl: "https://jira.example.com", secret: "bad" })).rejects.toThrow(/refused the token/);
  });

  test("editing keeps the stored token when none is entered", async () => {
    const x = await connected([]);
    await x.service.save({ id: x.connection.id, provider: "jira-dc", baseUrl: "https://jira.example.com", name: "Work" });
    expect(x.calls.at(-1)!.auth).toBe("Bearer secret-token");
    expect((await x.service.list())[0]).toMatchObject({ id: x.connection.id, name: "Work" });
  });
});

describe("read-only client", () => {
  test("only GETs to the read endpoints; anything else is refused before a request", async () => {
    const x = await connected([issue("AB-1", "Empty result page"), issue("AB-2", "Other")], { picker: ["AB-1"] });
    await x.service.search({ connectionId: x.connection.id, query: "" });
    await x.service.search({ connectionId: x.connection.id, query: "ab-2" });
    await x.service.search({ connectionId: x.connection.id, query: "1" });
    await x.service.search({ connectionId: x.connection.id, query: "empty result" });
    await x.service.detail({ connectionId: x.connection.id, key: "AB-1" });
    await x.service.summaries([{ connectionId: x.connection.id, provider: "jira-dc", itemType: "issue", key: "AB-2", remoteId: "" }], 0);
    expect(new Set(x.calls.map((c) => c.method))).toEqual(new Set(["GET"]));
    expect(x.calls.every((c) => /^\/rest\/api\/(2\/(myself|search|issue\/picker|issue\/[A-Z]+-\d+)|3\/search\/jql)$/.test(c.url.pathname))).toBe(true);
    const client = new JiraClient(
      { id: "c", provider: "jira-dc", name: "", baseUrl: "https://jira.example.com", email: "", secret: "s", account: "", login: "", verifiedAt: "", authFailed: false },
      x.fetchImpl,
    );
    const before = x.calls.length;
    await expect(client.get("/rest/api/2/issue/AB-1/transitions")).rejects.toThrow(/outside the read-only endpoints/);
    await expect(client.get("/rest/api/2/issue/AB-1/comment")).rejects.toThrow(/outside the read-only endpoints/);
    expect(x.calls.length).toBe(before);
  });

  test("searches: recent JQL, key, number in recent projects, text through the issue picker", async () => {
    const x = await connected([issue("AB-1", "Empty result page"), issue("CD-1", "Login")], { picker: ["AB-1"] });
    const recent = await x.service.search({ connectionId: x.connection.id, query: "" });
    expect(recent.results.map((r) => r.key)).toEqual(["AB-1", "CD-1"]);
    expect(x.calls.at(-1)!.url.searchParams.get("jql")).toBe("assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC");
    expect(recent.results[0]).toMatchObject({ url: "https://jira.example.com/browse/AB-1", status: "In Progress", statusCategory: "indeterminate", type: "Bug" });
    expect((await x.service.search({ connectionId: x.connection.id, query: "https://jira.example.com/browse/cd-1" })).results.map((r) => r.key)).toEqual(["CD-1"]);
    expect((await x.service.search({ connectionId: x.connection.id, query: "ZZ-9" })).results).toEqual([]);
    expect((await x.service.search({ connectionId: x.connection.id, query: "1" })).results.map((r) => r.key).sort()).toEqual(["AB-1", "CD-1"]);
    expect((await x.service.search({ connectionId: x.connection.id, query: "empty" })).results.map((r) => r.key)).toEqual(["AB-1"]);
  });

  test("text search falls back to a summary JQL when the issue picker finds nothing", async () => {
    const x = await connected([issue("AB-1", "Empty result page")], { picker: [] });
    expect((await x.service.search({ connectionId: x.connection.id, query: 'empty "page' })).results.map((r) => r.key)).toEqual(["AB-1"]);
    expect(x.calls.at(-1)!.url.searchParams.get("jql")).toBe('summary ~ "empty page" ORDER BY updated DESC');
  });

  test("Jira Cloud searches through /rest/api/3/search/jql", async () => {
    const x = await connected([issue("AB-1", "A")], {}, "jira-cloud");
    await x.service.search({ connectionId: x.connection.id, query: "" });
    expect(x.calls.at(-1)!.url.pathname).toBe("/rest/api/3/search/jql");
  });
});

describe("failures", () => {
  test("a refused token marks the connection and later calls fail without a request", async () => {
    const dir = await temp();
    let status = 0;
    const jira = fakeJira([issue("AB-1", "A")]);
    const fetchImpl = (async (input: URL | RequestInfo, init?: RequestInit) =>
      status ? new Response("{}", { status, headers: { "content-type": "application/json" } }) : jira.fetchImpl(input, init)) as typeof fetch;
    const service = tracked(new ConnectorService(join(dir, "connectors"), fetchImpl));
    const c = await service.save({ provider: "jira-dc", baseUrl: "https://jira.example.com", secret: "s" });
    status = 401;
    await expect(service.search({ connectionId: c.id, query: "" })).rejects.toMatchObject({ code: "EXTERNAL_AUTH" });
    expect((await service.list())[0]!.authFailed).toBe(true);
    status = 0;
    const before = jira.calls.length;
    await expect(service.search({ connectionId: c.id, query: "" })).rejects.toMatchObject({ code: "EXTERNAL_AUTH" });
    expect(jira.calls.length).toBe(before);
    // Saving a new token clears it.
    await service.save({ id: c.id, provider: "jira-dc", baseUrl: "https://jira.example.com", secret: "new" });
    expect((await service.search({ connectionId: c.id, query: "" })).results).toHaveLength(1);
  });

  test("429 waits at least Retry-After; a login page counts as a refused token", async () => {
    let now = 1_000_000;
    const dir = await temp();
    let mode: "ok" | "busy" | "html" = "ok";
    const jira = fakeJira([issue("AB-1", "A")]);
    const fetchImpl = (async (input: URL | RequestInfo, init?: RequestInit) =>
      mode === "busy"
        ? new Response("{}", { status: 429, headers: { "retry-after": "30", "content-type": "application/json" } })
        : mode === "html"
          ? new Response("<html>login</html>", { status: 200, headers: { "content-type": "text/html" } })
          : jira.fetchImpl(input, init)) as typeof fetch;
    const service = tracked(new ConnectorService(join(dir, "connectors"), fetchImpl, () => now));
    const c = await service.save({ provider: "jira-dc", baseUrl: "https://jira.example.com", secret: "s" });
    mode = "busy";
    await expect(service.search({ connectionId: c.id, query: "" })).rejects.toMatchObject({ code: "EXTERNAL_UNAVAILABLE" });
    mode = "ok";
    await expect(service.search({ connectionId: c.id, query: "" })).rejects.toThrow(/wait/);
    now += 31_000;
    expect((await service.search({ connectionId: c.id, query: "" })).results).toHaveLength(1);
    mode = "html";
    await expect(service.search({ connectionId: c.id, query: "" })).rejects.toBeInstanceOf(ExternalError);
    expect((await service.list())[0]!.authFailed).toBe(true);
  });

  test("an unreachable Jira returns the cached ticket marked stale", async () => {
    const dir = await temp();
    let down = false;
    const jira = fakeJira([issue("AB-1", "A")]);
    const fetchImpl = (async (input: URL | RequestInfo, init?: RequestInit) => {
      if (down) throw new TypeError("fetch failed");
      return jira.fetchImpl(input, init);
    }) as typeof fetch;
    let now = 0;
    const service = tracked(new ConnectorService(join(dir, "connectors"), fetchImpl, () => now));
    const c = await service.save({ provider: "jira-dc", baseUrl: "https://jira.example.com", secret: "s" });
    const ref = { connectionId: c.id, provider: "jira-dc" as const, itemType: "issue" as const, key: "AB-1", remoteId: "" };
    await service.detail(ref);
    down = true;
    now += 120_000;
    const detail = await service.detail(ref);
    expect(detail.stale).toBe(true);
    expect(detail.markdown).toContain("# AB-1 A");
    const summaries = await service.summaries([ref]);
    expect(summaries.get(`${c.id}:issue:AB-1`)).toMatchObject({ stale: true, summary: { summary: "A" } });
  });
});

describe("content for agents (EXTERNAL-TRACKER-SPEC §4)", () => {
  test("the fingerprint ignores status and assignee, and follows description and comments", () => {
    const base = issue("AB-1", "A");
    const moved = issue("AB-1", "A", { status: { name: "Done" }, assignee: { displayName: "Bob" } });
    const edited = issue("AB-1", "A", { description: "new" });
    const commented = issue("AB-1", "A", { comment: { comments: [{ id: "2", body: "x", created: "t" }] } });
    expect(contentFingerprint(moved)).toBe(contentFingerprint(base));
    expect(contentFingerprint(edited)).not.toBe(contentFingerprint(base));
    expect(contentFingerprint(commented)).not.toBe(contentFingerprint(base));
  });

  test("Markdown has metadata, the converted description, subtasks, links, attachment names and comments; long tickets are cut", () => {
    const full = issue("AB-1", "Empty result page", {
      subtasks: [{ key: "AB-2", fields: { summary: "Sub", status: { name: "To Do" } } }],
      issuelinks: [{ type: { outward: "blocks" }, outwardIssue: { key: "CD-1", fields: { summary: "Other", status: { name: "Open" } } } }],
      attachment: [{ filename: "screen.png" }],
    });
    const summary = { connectionId: "c", itemType: "issue" as const, key: "AB-1", remoteId: "1", url: "https://jira.example.com/browse/AB-1", summary: "Empty result page", status: "In Progress", statusCategory: "indeterminate", type: "Bug", priority: "High", assignee: "Ada", container: "AB", updated: "u" };
    const { markdown, truncated } = ticketMarkdown(summary, full);
    expect(truncated).toBe(false);
    for (const part of ["# AB-1 Empty result page", "- Status: In Progress", "### Repro", "- open **search**", "- AB-2 Sub (To Do)", "- blocks CD-1 Other (Open)", "- screen.png", "### Bob", "Seen on `prod`"])
      expect(markdown).toContain(part);
    const long = ticketMarkdown(summary, issue("AB-1", "x", { description: "y".repeat(50_000) }), 2000);
    expect(long.truncated).toBe(true);
    expect(Buffer.byteLength(long.markdown)).toBeLessThan(2200);
    expect(long.markdown).toContain("read the rest at https://jira.example.com/browse/AB-1");
  });
});

describe("cards and external inputs (EXTERNAL-TRACKER-SPEC §5.4)", () => {
  async function board(issues: Issue[]) {
    const x = await connected(issues);
    const root = join(x.dir, "project");
    await mkdir(root);
    const store = new BoardStore(join(x.dir, "data"));
    const now = new Date().toISOString();
    await store.mutate((b) =>
      b.projects.push({ id: "p", paseoProjectId: "native", title: "P", description: "", primaryPath: root, repos: [root], revision: 1, createdAt: now, updatedAt: now, archivedAt: null }),
    );
    const service = new BoardService(store);
    service.connectors = x.service;
    const create = vi.fn(async () => ({ id: "workspace" }));
    const refresh = vi.fn(async () => ({ id: "workspace", projectId: "native", workspaceDirectory: root, workspaceKind: "directory", status: "done" }));
    const paseo = { workspaces: { create, ref: () => ({ refresh }) } } as unknown as PaseoApi;
    const input = { projectId: "p", operationId: "op", title: "Card", description: "", status: "todo" as const, priority: "normal" as const, mode: "directory" as const, baseRef: "" };
    return { ...x, store, service: service, tickets: x.service, paseo, create, input };
  }

  test("a new card and its ticket inputs are written together, and the first session context lists them", async () => {
    const x = await board([issue("AB-1", "Empty result page")]);
    const card = await x.service.createTask({ ...x.input, externals: [{ connectionId: x.connection.id, key: "ab-1" }, { connectionId: x.connection.id, key: "AB-1" }] }, x.paseo);
    const saved = await x.store.read();
    const inputs = saved.artifacts.filter((a) => a.taskId === card.id);
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toMatchObject({
      role: "input",
      kind: "url",
      target: "https://jira.example.com/browse/AB-1",
      title: "AB-1 Empty result page",
      createdBy: "human",
      external: { connectionId: x.connection.id, provider: "jira-dc", itemType: "issue", key: "AB-1", remoteId: "10001" },
    });
    expect(saved.events.filter((e) => e.taskId === card.id).map((e) => e.action)).toEqual(["created", "artifact_added"]);
    expect(artifactContextLines(inputs).join("\n")).toContain(`AB-1 Empty result page (Jira ticket; read it with flowly_read_external artifactId=${inputs[0]!.id})`);
  });

  test("a ticket that can't be read refuses the card before any workspace exists", async () => {
    const x = await board([]);
    await expect(x.service.createTask({ ...x.input, externals: [{ connectionId: x.connection.id, key: "AB-404" }] }, x.paseo)).rejects.toThrow(/not found/i);
    expect(x.create).not.toHaveBeenCalled();
    expect((await x.store.read()).tasks).toHaveLength(0);
  });

  test("linking a ticket to an existing card by link or bare key; the role is always input and the card is unchanged", async () => {
    const x = await board([issue("AB-1", "Empty result page"), issue("AB-2", "Second")]);
    const card = await x.service.createTask(x.input, x.paseo);
    const artifacts = new ArtifactService(x.store, x.tickets);
    const byLink = await artifacts.create({ taskId: card.id, role: "output", target: "https://jira.example.com/browse/AB-1" }, x.paseo);
    expect(byLink).toMatchObject({ role: "input", title: "AB-1 Empty result page", external: { key: "AB-1" } });
    const byKey = await artifacts.create({ taskId: card.id, role: "input", target: "ab-2" }, x.paseo);
    expect(byKey).toMatchObject({ target: "https://jira.example.com/browse/AB-2", external: { key: "AB-2" } });
    // The same ticket again updates nothing new.
    await artifacts.create({ taskId: card.id, role: "input", target: "AB-1" }, x.paseo);
    const saved = await x.store.read();
    expect(saved.artifacts.filter((a) => a.taskId === card.id)).toHaveLength(2);
    expect(saved.tasks[0]).toMatchObject({ title: "Card", revision: 1 });
    // Other links stay ordinary links.
    const plain = await artifacts.create({ taskId: card.id, role: "input", target: "https://example.com/doc" }, x.paseo);
    expect(plain.external).toBeUndefined();
  });
});

describe("agents (EXTERNAL-TRACKER-SPEC §4)", () => {
  async function agent(issues: Issue[]) {
    const f = await agentFixture();
    roots.push(f.root);
    const jira = fakeJira(issues);
    const tickets = tracked(new ConnectorService(join(f.root, "connectors"), jira.fetchImpl));
    const connection = await tickets.save({ provider: "jira-dc", baseUrl: "https://jira.example.com", secret: "secret-token" });
    f.service.connectors = tickets;
    const artifacts = new ArtifactService(f.store, tickets);
    return { ...f, jira, tickets, connection, artifacts };
  }

  test("get_task shows external inputs; content changes are unread, status changes are not; read_external marks it read", async () => {
    const issues = [issue("AB-1", "Empty result page")];
    const x = await agent(issues);
    const linked = await x.artifacts.create({ taskId: "t", role: "input", target: "AB-1" }, x.paseo);
    let ctx = await x.service.get(x.identity);
    const row = ctx.artifacts.find((a) => a.id === linked.id)!;
    expect(row).toMatchObject({ unread: true, external: { provider: "jira-dc", itemType: "issue", key: "AB-1", summary: "Empty result page", status: "In Progress", type: "Bug", stale: false } });
    expect((await x.service.get(x.identity)).artifacts[0]!.unread).toBe(false);
    // Only the status moved: not unread.
    issues[0] = issue("AB-1", "Empty result page", { status: { name: "Done" }, updated: "2026-10-19T10:00:00.000+0800" });
    await x.tickets.summaries([linked.external!], 0, false);
    ctx = await x.service.get(x.identity);
    expect(ctx.artifacts[0]).toMatchObject({ unread: false, external: { status: "Done" }, ticket: { status: "Done" } });
    // A new comment: unread until the session reads the ticket.
    issues[0] = issue("AB-1", "Empty result page", {
      updated: "2026-10-19T11:00:00.000+0800",
      comment: { comments: [{ id: "9", author: { displayName: "PM" }, body: "Also on mobile", created: "2026-10-19T11:00:00.000+0800" }], total: 1 },
    });
    await x.tickets.summaries([linked.external!], 0, false);
    expect((await x.service.get(x.identity, true, false)).artifacts[0]!.unread).toBe(true);
    const read = await x.service.readExternal(x.identity, { artifactId: linked.id, refresh: true });
    expect(read).toMatchObject({ key: "AB-1", url: "https://jira.example.com/browse/AB-1", stale: false });
    expect(read.markdown).toContain("Also on mobile");
    expect((await x.service.get(x.identity)).artifacts[0]!.unread).toBe(false);
    // Nothing in the agent's view carries the token.
    expect(JSON.stringify(ctx)).not.toContain("secret-token");
  });

  test("removing the connection keeps the ticket as a link the agent is told it can't read; adding the same Jira again restores it", async () => {
    const x = await agent([issue("AB-1", "Empty result page")]);
    const linked = await x.artifacts.create({ taskId: "t", role: "input", target: "AB-1" }, x.paseo);
    await x.service.get(x.identity);
    await x.tickets.remove(x.connection.id);
    // The card keeps the input, its link and key.
    expect((await x.store.read()).artifacts.find((a) => a.id === linked.id)).toMatchObject({ target: "https://jira.example.com/browse/AB-1", external: { key: "AB-1" } });
    const ctx = await x.service.get(x.identity);
    expect(ctx.artifacts[0]).toMatchObject({ unread: false, external: { key: "AB-1", summary: "AB-1 Empty result page", connection: "removed", stale: true } });
    await expect(x.service.readExternal(x.identity, { artifactId: linked.id })).rejects.toMatchObject({ code: "EXTERNAL_UNAVAILABLE", message: expect.stringMatching(/removed this Jira connection/) });
    const board = await x.store.read();
    const lines = artifactContextLines(board.artifacts, 10, (await x.tickets.locate(board.artifacts)).get(linked.id) ? new Set() : new Set([linked.id]));
    expect(lines.join("\n")).toContain("its connection was removed in Flowly, so it can't be read: ask the user");
    expect(lines.join("\n")).not.toContain("flowly_read_external");
    // A new connection to the same Jira (new id, address with a trailing slash) picks the ticket up again.
    const again = await x.tickets.save({ provider: "jira-dc", baseUrl: "https://jira.example.com/", secret: "new-token" });
    expect(again.id).not.toBe(x.connection.id);
    expect((await x.service.get(x.identity)).artifacts[0]!.external).toMatchObject({ connection: "ok", status: "In Progress", stale: false });
    const read = await x.service.readExternal(x.identity, { artifactId: linked.id });
    expect(read.markdown).toContain("# AB-1 Empty result page");
    expect(x.jira.calls.at(-1)!.auth).toBe("Bearer new-token");
  });

  test("read_external only reads this card's external inputs", async () => {
    const x = await agent([issue("AB-1", "A")]);
    const plain = await x.artifacts.create({ taskId: "t", role: "input", target: "https://example.com/doc" }, x.paseo);
    await expect(x.service.readExternal(x.identity, { artifactId: plain.id })).rejects.toMatchObject({ code: "EXTERNAL_NOT_FOUND" });
    await expect(x.service.readExternal(x.identity, { artifactId: "other-card-artifact" })).rejects.toMatchObject({ code: "EXTERNAL_NOT_FOUND" });
  });

  test("an agent adding a ticket link gets an external input", async () => {
    const x = await agent([issue("AB-1", "A")]);
    const ctx = await x.service.get(x.identity);
    const result = await x.service.write(x.identity, "artifact", { expectedRevision: ctx.revision, request: ctx.request, role: "output", target: "https://jira.example.com/browse/AB-1" });
    const added = (await x.store.read()).artifacts.find((a) => a.id === result.artifactId)!;
    expect(added).toMatchObject({ role: "input", createdBy: "agent", title: "AB-1 A", external: { key: "AB-1" } });
  });
});

describe("wiki markup to Markdown", () => {
  test("headings, lists, code, links, marks and tables", () => {
    const wiki = [
      "h2. Steps",
      "# open the page",
      "## scroll",
      "* *bold* and _italic_ and {{code}}",
      "See [the doc|https://example.com/doc] or [~alice]",
      "{code:java}",
      "int a = 1;",
      "{code}",
      "||Name||Value||",
      "|a|1|",
      "----",
      "bq. quoted",
    ].join("\n");
    expect(wikiToMarkdown(wiki)).toBe(
      [
        "## Steps",
        "1. open the page",
        "  1. scroll",
        "- **bold** and *italic* and `code`",
        "See [the doc](https://example.com/doc) or @alice",
        "```java",
        "int a = 1;",
        "```",
        "| Name | Value |",
        "| --- | --- |",
        "| a | 1 |",
        "---",
        "> quoted",
      ].join("\n"),
    );
  });

  test("single-line and unclosed code blocks, noformat", () => {
    expect(wikiToMarkdown("{noformat}raw *text*{noformat}")).toBe("```\nraw *text*\n```");
    expect(wikiToMarkdown("{code}\nunclosed")).toBe("```\nunclosed\n```");
  });
});
