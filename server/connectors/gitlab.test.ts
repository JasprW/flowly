import { afterEach, describe, expect, test } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fakeService, fixtures, type Route } from "./fake";
import { fingerprintChanged } from "./fingerprint";
import { ConnectorService } from "./service";

const env = fixtures();
afterEach(() => env.cleanup());

const base = "https://git.example.com";
type Item = { repo: string; iid: number; mr?: boolean; title: string; state?: string; draft?: boolean; sha?: string; updated?: string; description?: string };
type Note = { id: number; body: string; system?: boolean; updated?: string; path?: string };

function gitlab(items: Item[], notes: Record<string, Note[]> = {}, options: { status?: number; headers?: Record<string, string> } = {}) {
  const json = (x: Item) => ({
    id: 1000 + x.iid,
    iid: x.iid,
    title: x.title,
    description: x.description ?? "Steps:\n- open",
    state: x.state || "opened",
    draft: !!x.draft,
    labels: ["search"],
    author: { name: "Ada", username: "ada" },
    assignees: [{ name: "Bob", username: "bob" }],
    reviewers: [{ name: "Cy", username: "cy" }],
    updated_at: x.updated || "2026-10-19T08:00:00.000Z",
    web_url: `${base}/${x.repo}/-/${x.mr ? "merge_requests" : "issues"}/${x.iid}`,
    ...(x.mr ? { source_branch: "feature/x", target_branch: "main", sha: x.sha || "abc123", changes_count: "2" } : {}),
  });
  const route: Route = (url) => {
    if (options.status) return { status: options.status, headers: options.headers, body: { message: "nope" } };
    const path = url.pathname.replace(/^\/api\/v4/, "");
    if (path === "/user") return { body: { name: "Ada Lovelace", username: "ada" } };
    const scoped = /^\/projects\/([^/]+)\/(issues|merge_requests)(?:\/(\d+)(\/notes|\/diffs)?)?$/.exec(path);
    if (scoped) {
      const repo = decodeURIComponent(scoped[1]!);
      const mr = scoped[2] === "merge_requests";
      if (!scoped[3]) {
        const search = (url.searchParams.get("search") || "").toLowerCase();
        return { body: items.filter((x) => x.repo === repo && !!x.mr === mr && x.title.toLowerCase().includes(search)).map(json) };
      }
      const found = items.find((x) => x.repo === repo && !!x.mr === mr && x.iid === Number(scoped[3]));
      if (!found) return { status: 404, body: { message: "404 Not found" } };
      if (scoped[4] === "/notes")
        return {
          body: [...(notes[`${repo}${mr ? "!" : "#"}${found.iid}`] || [])].reverse().map((n) => ({
            id: n.id,
            body: n.body,
            system: !!n.system,
            author: { name: "Reviewer" },
            created_at: "2026-10-19T09:00:00.000Z",
            updated_at: n.updated || "2026-10-19T09:00:00.000Z",
            ...(n.path ? { position: { new_path: n.path, new_line: 4 } } : {}),
          })),
        };
      if (scoped[4] === "/diffs") return { body: [{ new_path: "src/a.ts", old_path: "src/a.ts" }, { new_path: "src/b.ts", old_path: "src/b.ts", new_file: true }] };
      return { body: json(found) };
    }
    if (path === "/issues" || path === "/merge_requests") {
      const mr = path === "/merge_requests";
      const search = (url.searchParams.get("search") || "").toLowerCase();
      return { body: items.filter((x) => !!x.mr === mr && (x.state || "opened") === "opened" && x.title.toLowerCase().includes(search)).map(json) };
    }
    return undefined;
  };
  return fakeService(route);
}

async function connected(items: Item[], notes?: Record<string, Note[]>, repos: string[] = []) {
  const fake = gitlab(items, notes);
  const service = await env.service(fake.fetchImpl);
  service.projectRepos = async () => repos;
  const connection = await service.save({ provider: "gitlab", baseUrl: base, secret: "glpat-secret" });
  return { service, connection, ...fake };
}

describe("GitLab (CONNECTORS-SPEC §5)", () => {
  test("connecting uses PRIVATE-TOKEN and shows the account; a refused token is not saved", async () => {
    const x = await connected([]);
    expect(x.connection).toMatchObject({ provider: "gitlab", baseUrl: base, account: "Ada Lovelace (@ada)" });
    expect(x.calls[0]!.url.href).toBe(`${base}/api/v4/user`);
    expect(x.calls[0]!.headers["PRIVATE-TOKEN"]).toBe("glpat-secret");
    expect(JSON.stringify(await x.service.list())).not.toContain("glpat-secret");
    const refused = await env.service(gitlab([], {}, { status: 401 }).fetchImpl);
    await expect(refused.save({ provider: "gitlab", baseUrl: base, secret: "bad" })).rejects.toThrow(/refused the token/);
  });

  test("merge request and issue links (nested groups) become inputs with their kind", async () => {
    const x = await connected([
      { repo: "shopee/search/bff", iid: 345, mr: true, title: "Fix ranking" },
      { repo: "team/app", iid: 7, title: "Crash on start" },
    ]);
    expect(await x.service.recognize(`${base}/shopee/search/bff/-/merge_requests/345/diffs`)).toMatchObject({
      external: { provider: "gitlab", itemType: "merge_request", key: "shopee/search/bff!345", remoteId: "1345" },
      url: `${base}/shopee/search/bff/-/merge_requests/345`,
      title: "shopee/search/bff!345 Fix ranking",
    });
    expect(x.calls.at(-1)!.url.pathname).toBe("/api/v4/projects/shopee%2Fsearch%2Fbff/merge_requests/345");
    expect(await x.service.recognize("team/app#7")).toMatchObject({ external: { itemType: "issue", key: "team/app#7" } });
    await expect(x.service.recognize(`${base}/team/app/-/issues/99`)).rejects.toMatchObject({ code: "EXTERNAL_NOT_FOUND" });
  });

  test("picker: recent assigned issues and MRs plus MRs awaiting my review; numbers and text in the project's repositories", async () => {
    const x = await connected(
      [
        { repo: "team/app", iid: 7, title: "Crash on start", updated: "2026-10-19T10:00:00.000Z" },
        { repo: "team/app", iid: 8, mr: true, title: "Fix crash", updated: "2026-10-19T11:00:00.000Z" },
        { repo: "other/lib", iid: 9, title: "Crash elsewhere" },
      ],
      {},
      ["team/app"],
    );
    const recent = await x.service.search({ connectionId: x.connection.id, query: "", projectId: "p" });
    expect(recent.results.map((r) => r.key)).toEqual(["team/app!8", "team/app#7", "other/lib#9"]);
    const scopes = x.calls.filter((c) => /\/(issues|merge_requests)$/.test(c.url.pathname)).map((c) => `${c.url.pathname}?${c.url.searchParams.get("scope")}:${c.url.searchParams.get("reviewer_username") || ""}`);
    expect(scopes).toEqual(["/api/v4/issues?assigned_to_me:", "/api/v4/merge_requests?assigned_to_me:", "/api/v4/merge_requests?all:ada"]);
    expect(recent.results[0]).toMatchObject({ itemType: "merge_request", status: "Open", type: "Merge request", container: "team/app", assignee: "Bob" });
    expect((await x.service.search({ connectionId: x.connection.id, query: "!8", projectId: "p" })).results.map((r) => r.key)).toEqual(["team/app!8"]);
    expect((await x.service.search({ connectionId: x.connection.id, query: "7", projectId: "p" })).results.map((r) => r.key)).toEqual(["team/app#7"]);
    expect((await x.service.search({ connectionId: x.connection.id, query: "crash", projectId: "p" })).results.map((r) => r.key).sort()).toEqual(["team/app!8", "team/app#7"]);
    expect((await x.service.search({ connectionId: x.connection.id, query: "crash", projectId: "p", all: true })).results.map((r) => r.key)).toContain("other/lib#9");
    expect(x.calls.at(-1)!.url.searchParams.get("scope")).toBe("all");
  });

  test("full merge request: branches, head, changed files, human comments only; new commits change the fingerprint, labels don't", async () => {
    const items: Item[] = [{ repo: "team/app", iid: 8, mr: true, title: "Fix crash", sha: "abc123" }];
    const notes = { "team/app!8": [{ id: 1, body: "assigned to @bob", system: true }, { id: 2, body: "Please rename", path: "src/a.ts" }] };
    const x = await connected(items, notes);
    const ref = { connectionId: x.connection.id, provider: "gitlab" as const, itemType: "merge_request" as const, key: "team/app!8", remoteId: "1008" };
    const first = await x.service.detail(ref);
    for (const part of ["# team/app!8 Fix crash", "- Status: Open", "- Branches: feature/x → main", "- Head: abc123", "- Reviewers: Cy", "## Changed files (2)", "- src/a.ts", "- src/b.ts (added)", "fetch the source branch with git", "### Reviewer · 2026-10-19T09:00:00.000Z · on src/a.ts:4", "Please rename"])
      expect(first.markdown).toContain(part);
    expect(first.markdown).not.toContain("assigned to @bob");
    items[0]!.sha = "def456";
    const pushed = await x.service.detail(ref, true);
    expect(pushed.fingerprint).not.toBe(first.fingerprint);
    expect(fingerprintChanged("output", first.fingerprint, pushed.fingerprint)).toBe(false);
    notes["team/app!8"].push({ id: 3, body: "Looks good" } as never);
    expect(fingerprintChanged("output", pushed.fingerprint, (await x.service.detail(ref, true)).fingerprint)).toBe(true);
    items[0]!.state = "merged";
    const merged = await x.service.detail(ref, true);
    expect(merged.summary.status).toBe("Merged");
    expect(merged.summary.statusCategory).toBe("done");
  });

  test("403 on an item is not found (no access), not a refused token; only GETs to read endpoints", async () => {
    let forbid = false;
    const fake = gitlab([{ repo: "team/app", iid: 7, title: "A" }]);
    const fetchImpl = (async (input: URL | RequestInfo, init?: RequestInit) =>
      forbid && !String(input).endsWith("/user") ? new Response("{}", { status: 403, headers: { "content-type": "application/json" } }) : fake.fetchImpl(input, init)) as typeof fetch;
    const service = await env.service(fetchImpl);
    const c = await service.save({ provider: "gitlab", baseUrl: base, secret: "t" });
    forbid = true;
    await expect(service.recognize(`${base}/team/app/-/issues/7`)).rejects.toMatchObject({ code: "EXTERNAL_NOT_FOUND" });
    expect((await service.list())[0]!.authFailed).toBe(false);
    forbid = false;
    await service.search({ connectionId: c.id, query: "" });
    await service.detail({ connectionId: c.id, itemType: "issue", key: "team/app#7" });
    expect(new Set(fake.calls.map((x) => x.method))).toEqual(new Set(["GET"]));
    expect(fake.calls.every((x) => /^\/api\/v4\/(user|issues|merge_requests|projects\/[^/]+\/(issues|merge_requests)(\/\d+(\/notes|\/diffs)?)?)$/.test(x.url.pathname))).toBe(true);
  });

  test("a stored token only goes back to its own address; plain http is refused except on this machine", async () => {
    const x = await connected([]);
    const before = x.calls.length;
    await expect(x.service.test({ id: x.connection.id, provider: "gitlab", baseUrl: "https://evil.example.com" })).rejects.toThrow(/enter the token again/);
    await expect(x.service.save({ id: x.connection.id, provider: "github", baseUrl: base })).rejects.toThrow(/enter the token again/);
    expect(x.calls.length).toBe(before);
    // The same address keeps the stored token.
    await x.service.test({ id: x.connection.id, provider: "gitlab", baseUrl: `${base}/` });
    expect(x.calls.at(-1)!.headers["PRIVATE-TOKEN"]).toBe("glpat-secret");
    await expect(x.service.save({ provider: "gitlab", baseUrl: "http://git.example.com", secret: "t" })).rejects.toThrow(/https address/);
    expect(x.calls.length).toBe(before + 1);
  });

  test("a bare key that isn't an item stays a file path; a link that isn't found is an error", async () => {
    const x = await connected([{ repo: "team/app", iid: 7, title: "A" }]);
    expect(await x.service.recognize("docs/spec.md#3")).toBeNull();
    await expect(x.service.recognize(`${base}/team/app/-/issues/99`)).rejects.toMatchObject({ code: "EXTERNAL_NOT_FOUND" });
  });

  test("removing a connection also removes its cached items from disk", async () => {
    const x = await connected([{ repo: "team/app", iid: 7, title: "Secret title" }]);
    await x.service.search({ connectionId: x.connection.id, query: "" });
    await x.service.flush();
    const file = join(x.service.directory, "cache.json");
    expect(await readFile(file, "utf8")).toContain("Secret title");
    await x.service.remove(x.connection.id);
    await x.service.flush();
    expect(await readFile(file, "utf8")).not.toContain("Secret title");
    // A cache left by an older build is cleaned when it loads.
    await writeFile(file, JSON.stringify({ version: 2, entries: { "gone:issue:a/b#1": { provider: "gitlab", summary: { connectionId: "gone", summary: "Old" }, fingerprint: "", fetchedAt: 1 } } }));
    const fresh = new ConnectorService(x.service.directory, x.fetchImpl);
    await fresh.cached({ connectionId: "gone", itemType: "issue", key: "a/b#1" });
    await fresh.flush();
    expect(await readFile(file, "utf8")).not.toContain("Old");
  });

  test("GitLab before 15.7 has no /diffs: changed files come from /changes (names only)", async () => {
    const fake = gitlab([{ repo: "team/app", iid: 8, mr: true, title: "Fix crash" }]);
    const fetchImpl = (async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/diffs")) return new Response(JSON.stringify({ message: "404 Not found" }), { status: 404, headers: { "content-type": "application/json" } });
      if (url.pathname.endsWith("/changes"))
        return new Response(JSON.stringify({ changes: [{ new_path: "src/old.ts", old_path: "src/old.ts", diff: "@@ secret patch @@" }, { new_path: "src/new.ts", new_file: true, diff: "+x" }] }), { status: 200, headers: { "content-type": "application/json" } });
      return fake.fetchImpl(input, init);
    }) as typeof fetch;
    const service = await env.service(fetchImpl);
    const c = await service.save({ provider: "gitlab", baseUrl: base, secret: "t" });
    const detail = await service.detail({ connectionId: c.id, itemType: "merge_request", key: "team/app!8" });
    expect(detail.markdown).toContain("## Changed files (2)");
    expect(detail.markdown).toContain("- src/new.ts (added)");
    expect(detail.markdown).not.toContain("secret patch");
  });
});
