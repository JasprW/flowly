import { afterEach, describe, expect, test } from "vitest";
import { fakeService, fixtures, type Route } from "./fake";
import { storageToMarkdown } from "./storage-markdown";

const env = fixtures();
afterEach(() => env.cleanup());

const base = "https://confluence.example.com";
type Page = { id: string; title: string; version: number; body?: string; space?: string; when?: string };

function confluence(
  pages: Page[],
  comments: Record<string, { id: string; version: number; body: string; by: string }[]> = {},
  options: { anonymous?: boolean; viewed?: { id: string; lastSeen: number }[]; edited?: string[] } = {},
) {
  const json = (p: Page) => ({
    id: p.id,
    type: "page",
    title: p.title,
    space: { key: p.space || "ENG", name: "Engineering" },
    version: { number: p.version, when: p.when || "2026-10-19T08:00:00.000Z", by: { displayName: "Ada" } },
    ancestors: [{ id: "1", title: "Home" }, { id: "2", title: "Search" }],
    body: { storage: { value: p.body || "<p>Hello</p>" } },
  });
  const route: Route = (url) => {
    const path = url.pathname.replace(/^\/wiki/, "");
    if (path === "/rest/api/user/current") return { body: options.anonymous ? { type: "anonymous" } : { type: "known", displayName: "Ada Lovelace", username: "ada" } };
    if (path === "/rest/recentlyviewed/1.0/recent")
      return { body: (options.viewed || []).map((v) => ({ id: Number(v.id), lastSeen: v.lastSeen, type: "page", title: "x" })) };
    if (path === "/rest/api/content/search") {
      const cql = url.searchParams.get("cql") || "";
      const ids = /id in \(([^)]*)\)/.exec(cql)?.[1]?.split(",").map((x) => x.trim());
      const title = /title ~ "([^"]*)"/.exec(cql)?.[1];
      const recentlyViewed = /recentlyViewedContent/.test(cql);
      const contributor = /contributor = currentUser\(\)/.test(cql);
      const list = ids
        ? pages.filter((p) => ids.includes(p.id))
        : title
          ? pages.filter((p) => p.title.toLowerCase().includes(title.toLowerCase()))
          : /text ~/.test(cql)
            ? []
            : recentlyViewed
              ? pages.filter((p) => (options.viewed || []).some((v) => v.id === p.id))
              : contributor && options.edited
                ? pages.filter((p) => options.edited!.includes(p.id))
                : pages;
      return { body: { results: list.map(json) } };
    }
    if (path === "/rest/api/content") {
      const found = pages.find((p) => p.title === url.searchParams.get("title") && (p.space || "ENG") === url.searchParams.get("spaceKey"));
      return { body: { results: found ? [json(found)] : [] } };
    }
    const one = /^\/rest\/api\/content\/(\d+)(\/child\/comment)?$/.exec(path);
    if (one) {
      const page = pages.find((p) => p.id === one[1]);
      if (!page) return { status: 404, body: { message: "No content" } };
      if (one[2])
        return {
          body: {
            results: (comments[page.id] || []).map((c) => ({ id: c.id, version: { number: c.version, by: { displayName: c.by }, when: "2026-10-19T09:00:00.000Z" }, body: { storage: { value: c.body } } })),
            size: (comments[page.id] || []).length,
          },
        };
      return { body: json(page) };
    }
    return undefined;
  };
  return fakeService(route);
}

async function connected(pages: Page[], comments?: Parameters<typeof confluence>[1]) {
  const fake = confluence(pages, comments);
  const service = await env.service(fake.fetchImpl);
  const connection = await service.save({ provider: "confluence-dc", baseUrl: `${base}/`, secret: "pat-secret" });
  return { service, connection, ...fake };
}

describe("Confluence (CONNECTORS-SPEC §7)", () => {
  test("connecting checks the token; the anonymous user means a refused token; Cloud uses email + API token", async () => {
    const x = await connected([]);
    expect(x.connection).toMatchObject({ provider: "confluence-dc", baseUrl: base, account: "Ada Lovelace" });
    expect(x.calls[0]!.headers.Authorization).toBe("Bearer pat-secret");
    const anonymous = await env.service(confluence([], {}, { anonymous: true }).fetchImpl);
    await expect(anonymous.save({ provider: "confluence-dc", baseUrl: base, secret: "bad" })).rejects.toThrow(/refused the token/);
    const cloud = confluence([]);
    const service = await env.service(cloud.fetchImpl);
    await service.save({ provider: "confluence-cloud", baseUrl: "https://team.atlassian.net/wiki", email: "ada@example.com", secret: "api" });
    expect(cloud.calls[0]!.url.href).toBe("https://team.atlassian.net/wiki/rest/api/user/current");
    expect(cloud.calls[0]!.headers.Authorization).toBe(`Basic ${Buffer.from("ada@example.com:api").toString("base64")}`);
  });

  test("links by id, tiny link and /display/ title all become the same page input; the stored link is canonical", async () => {
    const x = await connected([{ id: "5636107", title: "Search Design", version: 3 }]);
    for (const link of [`${base}/pages/viewpage.action?pageId=5636107`, `${base}/x/CwBW`, `${base}/display/ENG/Search+Design`, "5636107"]) {
      const found = await x.service.recognize(link);
      expect(found).toEqual({
        external: { connectionId: x.connection.id, provider: "confluence-dc", itemType: "page", key: "5636107", remoteId: "5636107" },
        url: `${base}/pages/viewpage.action?pageId=5636107`,
        title: "Search Design",
      });
    }
    expect(await x.service.recognize("https://example.com/doc")).toBeNull();
  });

  test("picker: recent = pages I viewed or edited, newest activity first; title search with a text fallback", async () => {
    const now = Date.parse("2026-10-20T10:00:00.000Z");
    const pages: Page[] = [
      { id: "10", title: "Search Design", version: 1, when: "2026-10-01T00:00:00.000Z" },
      { id: "11", title: "Ranking notes", version: 1, when: "2026-10-19T00:00:00.000Z" },
      { id: "12", title: "Viewed only", version: 1, when: "2026-09-01T00:00:00.000Z" },
      { id: "13", title: "Untouched", version: 1 },
    ];
    // 12 viewed an hour ago, 10 viewed yesterday (its last change is older), 11 edited on Oct 19.
    const fake = confluence(pages, {}, { viewed: [{ id: "12", lastSeen: now - 3_600_000 }, { id: "10", lastSeen: now - 86_400_000 }], edited: ["10", "11"] });
    const service = await env.service(fake.fetchImpl);
    const c = await service.save({ provider: "confluence-dc", baseUrl: base, secret: "pat" });
    const recent = await service.search({ connectionId: c.id, query: "" });
    expect(recent.results.map((r) => r.key)).toEqual(["12", "10", "11"]);
    expect(fake.calls.some((x) => x.url.pathname === "/rest/recentlyviewed/1.0/recent")).toBe(true);
    expect(fake.calls.map((x) => x.url.searchParams.get("cql")).filter(Boolean)).toContain("type = page AND contributor = currentUser() ORDER BY lastmodified DESC");
    expect(recent.results[0]).toMatchObject({ itemType: "page", summary: "Viewed only", status: "", container: "Engineering", type: "Page" });
    expect((await service.search({ connectionId: c.id, query: 'ranking "notes' })).results.map((r) => r.key)).toEqual(["11"]);
    expect(fake.calls.at(-1)!.url.searchParams.get("cql")).toBe('type = page AND title ~ "ranking notes" ORDER BY lastmodified DESC');
    expect((await service.search({ connectionId: c.id, query: "nothing here" })).results).toEqual([]);
    expect(fake.calls.at(-1)!.url.searchParams.get("cql")).toBe('type = page AND text ~ "nothing here" ORDER BY lastmodified DESC');
  });

  test("Confluence Cloud uses the CQL recently-viewed function, never the DC-only endpoint", async () => {
    const pages: Page[] = [{ id: "20", title: "Viewed on Cloud", version: 1 }];
    const fake = confluence(pages, {}, { viewed: [{ id: "20", lastSeen: 1 }], edited: [] });
    const service = await env.service(fake.fetchImpl);
    const c = await service.save({ provider: "confluence-cloud", baseUrl: "https://team.atlassian.net/wiki", email: "a@example.com", secret: "t" });
    expect((await service.search({ connectionId: c.id, query: "" })).results.map((r) => r.key)).toEqual(["20"]);
    expect(fake.calls.some((x) => x.url.pathname.endsWith("/rest/recentlyviewed/1.0/recent"))).toBe(false);
    expect(fake.calls.map((x) => x.url.searchParams.get("cql")).filter(Boolean)).toContain("type = page AND id in recentlyViewedContent(10)");
  });

  test("full page as Markdown; the fingerprint follows the version and comments, not the editor's name", async () => {
    const pages = [{ id: "10", title: "Search Design", version: 3, body: '<h2>Goals</h2><ul><li>Fast</li></ul><ac:structured-macro ac:name="info"><ac:rich-text-body><p>Read me</p></ac:rich-text-body></ac:structured-macro>' }];
    const comments = { "10": [{ id: "c1", version: 1, body: "<p>Looks good</p>", by: "Bob" }] };
    const x = await connected(pages, comments);
    const ref = { connectionId: x.connection.id, provider: "confluence-dc" as const, itemType: "page" as const, key: "10", remoteId: "10" };
    const first = await x.service.detail(ref);
    for (const part of ["# Search Design", "- Space: Engineering", "- Path: Home / Search", "- Version: 3 by Ada", "## Goals", "- Fast", "> **Info:** Read me", "### Bob", "Looks good"])
      expect(first.markdown).toContain(part);
    pages[0]!.version = 4;
    const edited = await x.service.detail(ref, true);
    expect(edited.fingerprint).not.toBe(first.fingerprint);
    const again = await x.service.detail(ref, true);
    expect(again.fingerprint).toBe(edited.fingerprint);
    // Batched summaries use one CQL id list.
    await x.service.summaries([ref], 0, false);
    expect(x.calls.at(-1)!.url.searchParams.get("cql")).toBe("id in (10)");
  });

  test("only GETs to the read endpoints", async () => {
    const x = await connected([{ id: "10", title: "A", version: 1 }]);
    await x.service.search({ connectionId: x.connection.id, query: "" });
    await x.service.recognize(`${base}/display/ENG/A`);
    await x.service.detail({ connectionId: x.connection.id, itemType: "page", key: "10" });
    expect(new Set(x.calls.map((c) => c.method))).toEqual(new Set(["GET"]));
    expect(x.calls.every((c) => /^\/rest\/(recentlyviewed\/1\.0\/recent|api\/(user\/current|content(\/search|\/\d+(\/child\/comment)?)?))$/.test(c.url.pathname))).toBe(true);
  });
});

describe("storage format to Markdown", () => {
  test("headings, marks, links, lists, tables, code, panels, tasks and images", () => {
    const source = [
      "<h1>Plan</h1>",
      "<p>Some <strong>bold</strong>, <em>italic</em> and <code>code</code> &amp; a <a href=\"https://example.com\">link</a>.</p>",
      '<p>See <ac:link><ri:page ri:content-title="Other page" /></ac:link> and <ac:link><ri:user ri:username="bob" /></ac:link>.</p>',
      "<ul><li>One<ul><li>Nested</li></ul></li><li>Two</li></ul>",
      "<ol><li>First</li></ol>",
      "<table><tbody><tr><th>Name</th><th>Value</th></tr><tr><td>a|b</td><td>1</td></tr></tbody></table>",
      '<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">java</ac:parameter><ac:plain-text-body><![CDATA[int a = 1 < 2;]]></ac:plain-text-body></ac:structured-macro>',
      '<ac:structured-macro ac:name="warning"><ac:parameter ac:name="title">Careful</ac:parameter><ac:rich-text-body><p>Hot</p></ac:rich-text-body></ac:structured-macro>',
      '<ac:task-list><ac:task><ac:task-status>complete</ac:task-status><ac:task-body>Done thing</ac:task-body></ac:task><ac:task><ac:task-status>incomplete</ac:task-status><ac:task-body>Open thing</ac:task-body></ac:task></ac:task-list>',
      '<p><ac:image><ri:attachment ri:filename="flow.png" /></ac:image></p>',
      '<p><ac:structured-macro ac:name="jira"><ac:parameter ac:name="key">AB-1</ac:parameter></ac:structured-macro></p>',
      '<ac:structured-macro ac:name="toc" />',
      "<hr/><blockquote><p>Quoted</p></blockquote>",
    ].join("");
    expect(storageToMarkdown(source)).toBe(
      [
        "# Plan",
        "",
        "Some **bold**, *italic* and `code` & a [link](https://example.com).",
        "",
        "See Other page and @bob.",
        "",
        "- One\n  - Nested\n- Two",
        "",
        "1. First",
        "",
        "| Name | Value |\n| --- | --- |\n| a\\|b | 1 |",
        "",
        "```java\nint a = 1 < 2;\n```",
        "",
        "> **Warning:** **Careful** Hot",
        "",
        "- [x] Done thing\n- [ ] Open thing",
        "",
        "[image: flow.png]",
        "",
        "[Jira: AB-1]",
        "",
        "---",
        "",
        "> Quoted",
      ].join("\n"),
    );
  });

  test("unknown tags keep their text; broken markup does not throw", () => {
    expect(storageToMarkdown("<custom>kept</custom><p>open")).toBe("kept\n\nopen");
    expect(storageToMarkdown("a < b &unknown; &#169;")).toBe("a < b &unknown; ©");
    expect(storageToMarkdown("")).toBe("");
  });

  test("a new comment changes the fingerprint even though the page version stays (CONNECTORS-SPEC §3.2)", async () => {
    let now = 1_000_000;
    const pages = [{ id: "10", title: "A", version: 1 }];
    const comments: Record<string, { id: string; version: number; body: string; by: string }[]> = { "10": [] };
    const fake = confluence(pages, comments);
    const service = await env.service(fake.fetchImpl, () => now);
    const c = await service.save({ provider: "confluence-dc", baseUrl: base, secret: "t" });
    const ref = { connectionId: c.id, provider: "confluence-dc" as const, itemType: "page" as const, key: "10", remoteId: "10" };
    const first = (await service.summaries([ref])).get(`${c.id}:page:10`)!.fingerprint;
    expect(first).toBeTruthy();
    comments["10"]!.push({ id: "c9", version: 1, body: "<p>New</p>", by: "Bob" });
    now += 61_000;
    const second = (await service.summaries([ref])).get(`${c.id}:page:10`)!.fingerprint;
    expect(second).not.toBe(first);
  });
});
