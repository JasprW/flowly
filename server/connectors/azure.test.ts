import { afterEach, describe, expect, test } from "vitest";
import { fakeService, fixtures, type Route } from "./fake";
import { fingerprintChanged } from "./fingerprint";

const env = fixtures();
afterEach(() => env.cleanup());

const base = "https://dev.azure.com/acme";
type Item = { id: number; title: string; state?: string; type?: string; assignee?: string; description?: string; updated?: string; project?: string };
type Comment = { id: number; text: string; modified?: string };

function azure(items: Item[], comments: Record<number, Comment[]> = {}, options: { status?: number; html?: boolean } = {}) {
  const json = (x: Item) => ({
    id: x.id,
    rev: 3,
    fields: {
      "System.Title": x.title,
      "System.State": x.state || "Active",
      "System.WorkItemType": x.type || "Bug",
      "System.AssignedTo": x.assignee === undefined ? { displayName: "Bob", uniqueName: "bob@acme.test" } : x.assignee,
      "System.TeamProject": x.project || "Search App",
      "System.ChangedDate": x.updated || "2026-10-19T08:00:00Z",
      "System.Description": x.description ?? "<div>Steps:<ul><li>open the app</li></ul></div>",
      "System.CreatedBy": { displayName: "Ada" },
      "System.Tags": "search; ranking",
      "Microsoft.VSTS.Common.Priority": 2,
    },
    _links: { html: { href: `${base}/${encodeURIComponent(x.project || "Search App")}/_workitems/edit/${x.id}` } },
  });
  const route: Route = (url) => {
    if (options.status) return { status: options.status, body: { message: "nope" } };
    if (options.html) return { html: true };
    const path = url.pathname.replace("/acme", "");
    if (path === "/_apis/connectionData") return { body: { authenticatedUser: { providerDisplayName: "Ada Lovelace", properties: { Account: { $value: "ada@acme.test" } } } } };
    if (path === "/_apis/wit/wiql") return { body: { workItems: items.map((x) => ({ id: x.id })) } };
    if (path === "/_apis/wit/workitems") {
      const ids = (url.searchParams.get("ids") || "").split(",").map(Number);
      return { body: { value: items.filter((x) => ids.includes(x.id)).map(json) } };
    }
    const one = /^\/_apis\/wit\/workitems\/(\d+)$/.exec(path);
    if (one) {
      const found = items.find((x) => x.id === Number(one[1]));
      return found ? { body: json(found) } : { status: 404, body: { message: "TF401232" } };
    }
    const talk = /^\/[^/]+\/_apis\/wit\/workItems\/(\d+)\/comments$/.exec(path);
    if (talk)
      return {
        body: {
          comments: [...(comments[Number(talk[1])] || [])].reverse().map((c) => ({ id: c.id, text: c.text, createdBy: { displayName: "Reviewer" }, createdDate: "2026-10-19T09:00:00Z", modifiedDate: c.modified || "2026-10-19T09:00:00Z" })),
        },
      };
    return undefined;
  };
  return fakeService(route);
}

async function connected(items: Item[], comments?: Record<number, Comment[]>) {
  const fake = azure(items, comments);
  const service = await env.service(fake.fetchImpl);
  const connection = await service.save({ provider: "azure-devops", baseUrl: base, secret: "pat-secret" });
  return { service, connection, ...fake };
}

describe("Azure DevOps (CONNECTORS-SPEC §13)", () => {
  test("connecting sends the token as a Basic login with an empty user and shows the account; a refused token is not saved", async () => {
    const x = await connected([]);
    expect(x.connection).toMatchObject({ provider: "azure-devops", baseUrl: base, account: "Ada Lovelace (ada@acme.test)" });
    expect(x.calls[0]!.url.pathname).toBe("/acme/_apis/connectionData");
    expect(x.calls[0]!.headers.Authorization).toBe(`Basic ${Buffer.from(":pat-secret").toString("base64")}`);
    expect(JSON.stringify(await x.service.list())).not.toContain("pat-secret");
    await expect((await env.service(azure([], {}, { status: 401 }).fetchImpl)).save({ provider: "azure-devops", baseUrl: base, secret: "bad" })).rejects.toThrow(/refused the token/);
    // A sign-in page instead of JSON (what Azure DevOps answers to an unknown token) is a refused token too.
    await expect((await env.service(azure([], {}, { html: true }).fetchImpl)).save({ provider: "azure-devops", baseUrl: base, secret: "bad" })).rejects.toThrow(/login page/);
  });

  test("work item links and AB# keys become inputs", async () => {
    const x = await connected([{ id: 4821, title: "Search crashes on empty query" }]);
    expect(await x.service.recognize(`${base}/Search%20App/_workitems/edit/4821`)).toMatchObject({
      external: { provider: "azure-devops", itemType: "issue", key: "AB#4821", remoteId: "4821" },
      url: `${base}/Search%20App/_workitems/edit/4821`,
      title: "AB#4821 Search crashes on empty query",
    });
    expect((await x.service.recognize(`${base}/Search%20App/_boards/board/t/Team/Stories?workitem=4821`))!.external.key).toBe("AB#4821");
    expect((await x.service.recognize("ab#4821"))!.external.key).toBe("AB#4821");
    expect(x.calls.at(-1)!.url.pathname).toBe("/acme/_apis/wit/workitems/4821");
    await expect(x.service.recognize(`${base}/Search%20App/_workitems/edit/99`)).rejects.toMatchObject({ code: "EXTERNAL_NOT_FOUND" });
  });

  test("picker: my open work items by WIQL, an id, and words from the title", async () => {
    const x = await connected([
      { id: 1, title: "Fix ranking", state: "Active" },
      { id: 2, title: "Search crash", state: "New", assignee: "Cy <cy@acme.test>" },
    ]);
    const recent = await x.service.search({ connectionId: x.connection.id, query: "" });
    expect(recent.results.map((r) => r.key)).toEqual(["AB#1", "AB#2"]);
    expect(recent.results[0]).toMatchObject({ itemType: "issue", status: "Active", statusCategory: "indeterminate", type: "Bug", container: "Search App", assignee: "Bob", priority: "2" });
    expect(recent.results[1]).toMatchObject({ statusCategory: "new", assignee: "Cy" });
    const wiql = x.calls.find((c) => c.method === "POST")!;
    expect(wiql.url.pathname).toBe("/acme/_apis/wit/wiql");
    expect(JSON.parse(wiql.body!).query).toContain("[System.AssignedTo] = @Me");
    expect((await x.service.search({ connectionId: x.connection.id, query: "#2" })).results.map((r) => r.key)).toEqual(["AB#2"]);
    expect((await x.service.search({ connectionId: x.connection.id, query: "2" })).results.map((r) => r.key)).toEqual(["AB#2"]);
    await x.service.search({ connectionId: x.connection.id, query: "it's a 'test'" });
    expect(JSON.parse(x.calls.filter((c) => c.method === "POST").at(-1)!.body!).query).toContain("CONTAINS 'it''s a ''test'''");
  });

  test("full work item: fields, description and comments as Markdown; description or comments change the fingerprint, state and assignee don't", async () => {
    const items: Item[] = [{ id: 4821, title: "Search crashes", description: "<p>Open the app</p><pre>boom()</pre>" }];
    const comments = { 4821: [{ id: 1, text: "<div>Can reproduce</div>" }] };
    const x = await connected(items, comments);
    const ref = { connectionId: x.connection.id, provider: "azure-devops" as const, itemType: "issue" as const, key: "AB#4821", remoteId: "4821" };
    const first = await x.service.detail(ref);
    for (const part of ["# AB#4821 Search crashes", "- State: Active", "- Type: Bug", "- Assigned to: Bob", "- Created by: Ada", "- Tags: search; ranking", "## Description", "Open the app", "boom()", "### Reviewer · 2026-10-19T09:00:00Z", "Can reproduce"])
      expect(first.markdown).toContain(part);
    items[0]!.state = "Resolved";
    items[0]!.assignee = "Cy";
    const moved = await x.service.detail(ref, true);
    expect(moved.summary.statusCategory).toBe("done");
    expect(moved.fingerprint).toBe(first.fingerprint);
    items[0]!.description = "<p>Open the app twice</p>";
    const edited = await x.service.detail(ref, true);
    expect(fingerprintChanged("input", first.fingerprint, edited.fingerprint)).toBe(true);
    comments[4821].push({ id: 2, text: "<div>Fixed in 1.2</div>" });
    expect(fingerprintChanged("output", edited.fingerprint, (await x.service.detail(ref, true)).fingerprint)).toBe(true);
  });

  test("a 403 on an item is not found (no access); only GETs to read endpoints plus the WIQL query", async () => {
    let forbid = false;
    const fake = azure([{ id: 7, title: "A" }]);
    const fetchImpl = (async (input: URL | RequestInfo, init?: RequestInit) =>
      forbid && !String(input).includes("connectionData") ? new Response("{}", { status: 403, headers: { "content-type": "application/json" } }) : fake.fetchImpl(input, init)) as typeof fetch;
    const service = await env.service(fetchImpl);
    const c = await service.save({ provider: "azure-devops", baseUrl: base, secret: "t" });
    forbid = true;
    await expect(service.recognize(`${base}/p/_workitems/edit/7`)).rejects.toMatchObject({ code: "EXTERNAL_NOT_FOUND" });
    expect((await service.list())[0]!.authFailed).toBe(false);
    forbid = false;
    await service.search({ connectionId: c.id, query: "" });
    await service.detail({ connectionId: c.id, itemType: "issue", key: "AB#7" });
    expect(fake.calls.filter((x) => x.method !== "GET").map((x) => `${x.method} ${x.url.pathname}`)).toEqual(["POST /acme/_apis/wit/wiql"]);
    expect(fake.calls.every((x) => /^\/acme\/(_apis\/(connectionData|wit\/(wiql|workitems(\/\d+)?))|[^/]+\/_apis\/wit\/workItems\/\d+\/comments)$/.test(x.url.pathname))).toBe(true);
  });
});
