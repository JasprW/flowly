import { afterEach, describe, expect, test, vi } from "vitest";
import { rm } from "node:fs/promises";
import type { PaseoApi } from "@getpaseo/client";
import { artifactContextLines } from "../../shared/artifacts";
import { agentFixture } from "../agent-fixture";
import { ArtifactService } from "../artifacts";
import { BoardService } from "../service";
import { fakeService, fixtures, type Route } from "./fake";
import { fingerprintChanged } from "./fingerprint";
import type { NotionBlock } from "./notion";

const env = fixtures();
afterEach(() => env.cleanup());

const base = "https://www.notion.so";
const DB_ID = "11111111-2222-3333-4444-555555555555";
const PAGE_1 = "aaaaaaaa-1111-2222-3333-444444444444";
const PAGE_2 = "bbbbbbbb-1111-2222-3333-444444444444";
const PAGE_3 = "cccccccc-1111-2222-3333-444444444444";

type FakePage = {
  id: string;
  title: string;
  status?: string;
  priority?: string;
  assignee?: string;
  summaryText?: string;
  updated?: string;
  archived?: boolean;
  databaseId?: string;
  url?: string;
  blocks?: NotionBlock[];
  childBlocks?: Record<string, NotionBlock[]>;
};

type FakeComment = { id: string; text: string; created: string; author?: string };
type Options = {
  authStatus?: number;
  searchStatus?: number;
  pageStatus?: Record<string, number>;
  commentsStatus?: number;
  headers?: Record<string, string>;
  blockPageSize?: number;
  searchPageSize?: number;
};

const rt = (text: string, opts?: { bold?: boolean; code?: boolean; href?: string }) => [
  {
    plain_text: text,
    ...(opts?.href ? { href: opts.href } : {}),
    annotations: { bold: !!opts?.bold, code: !!opts?.code },
  },
];

function notion(pages: FakePage[], comments: Record<string, FakeComment[]> = {}, options: Options = {}) {
  const toPage = (p: FakePage) => ({
    object: "page",
    id: p.id,
    url: p.url || `https://app.notion.com/${p.title.replace(/\s+/g, "-")}-${p.id.replace(/-/g, "")}`,
    archived: !!p.archived,
    in_trash: false,
    last_edited_time: p.updated || "2026-11-20T09:00:00.000Z",
    parent: p.databaseId ? { type: "database_id", database_id: p.databaseId } : { type: "workspace", workspace: true },
    properties: {
      Name: { id: "title", type: "title", title: rt(p.title) },
      ...(p.status !== undefined ? { Status: { id: "st", type: "status", status: { name: p.status } } } : {}),
      ...(p.priority !== undefined ? { Priority: { id: "pr", type: "select", select: { name: p.priority } } } : {}),
      ...(p.assignee !== undefined ? { Assignee: { id: "as", type: "people", people: [{ name: p.assignee }] } } : {}),
      ...(p.summaryText !== undefined ? { Notes: { id: "nt", type: "rich_text", rich_text: rt(p.summaryText) } } : {}),
    },
  });

  const route: Route = (url, raw) => {
    if (url.pathname === "/v1/users/me") {
      if (options.authStatus) return { status: options.authStatus, headers: options.headers, body: { message: "API token is invalid." } };
      return { body: { object: "user", id: "bot-1", type: "bot", name: "Flowly Bot", bot: { workspace_name: "Acme Workspace" } } };
    }
    if (url.pathname === "/v1/search") {
      if (options.searchStatus) return { status: options.searchStatus, headers: options.headers, body: { message: "Rate limited" } };
      const body = raw ? (JSON.parse(raw) as { query?: string; start_cursor?: string }) : {};
      const term = (body.query || "").toLowerCase();
      const matched = pages
        .filter((p) => !term || p.title.toLowerCase().includes(term))
        .sort((a, b) => (b.updated || "").localeCompare(a.updated || ""));
      const pageSize = options.searchPageSize || 100;
      const offset = body.start_cursor ? Number(body.start_cursor) : 0;
      const slice = matched.slice(offset, offset + pageSize);
      const next = offset + pageSize < matched.length ? String(offset + pageSize) : null;
      return { body: { object: "list", results: slice.map(toPage), has_more: !!next, next_cursor: next } };
    }
    const pageMatch = /^\/v1\/pages\/([0-9a-f-]+)$/.exec(url.pathname);
    if (pageMatch) {
      const id = pageMatch[1]!;
      const forced = options.pageStatus?.[id];
      if (forced) return { status: forced, headers: options.headers, body: { message: "Restricted or missing" } };
      const found = pages.find((p) => p.id === id);
      if (!found) return { status: 404, body: { message: "Could not find page" } };
      return { body: toPage(found) };
    }
    const dbMatch = /^\/v1\/databases\/([0-9a-f-]+)$/.exec(url.pathname);
    if (dbMatch) {
      if (dbMatch[1] === DB_ID) return { body: { object: "database", id: DB_ID, title: rt("Product Specs") } };
      return { status: 404, body: { message: "Not found" } };
    }
    const blockMatch = /^\/v1\/blocks\/([0-9a-f-]+)\/children$/.exec(url.pathname);
    if (blockMatch) {
      const blockId = blockMatch[1]!;
      let list: NotionBlock[] = [];
      const owner = pages.find((p) => p.id === blockId);
      if (owner) list = owner.blocks || [];
      else {
        for (const p of pages) {
          if (p.childBlocks?.[blockId]) {
            list = p.childBlocks[blockId]!;
            break;
          }
        }
      }
      const pageSize = options.blockPageSize || 100;
      const offset = Number(url.searchParams.get("start_cursor") || "0");
      const slice = list.slice(offset, offset + pageSize);
      const next = offset + pageSize < list.length ? String(offset + pageSize) : null;
      return { body: { object: "list", results: slice, has_more: !!next, next_cursor: next } };
    }
    if (url.pathname === "/v1/comments") {
      if (options.commentsStatus) return { status: options.commentsStatus, body: { message: "Integration lacks Read comments capability" } };
      const id = url.searchParams.get("block_id") || "";
      const list = (comments[id] || []).map((c) => ({
        id: c.id,
        created_time: c.created,
        rich_text: rt(c.text),
        created_by: { id: "u1", name: c.author || "Ada" },
      }));
      return { body: { object: "list", results: list, has_more: false, next_cursor: null } };
    }
    return undefined;
  };
  return fakeService(route);
}

async function connected(pages: FakePage[], comments: Record<string, FakeComment[]> = {}, options: Options = {}) {
  const fake = notion(pages, comments, options);
  const service = await env.service(fake.fetchImpl);
  const connection = await service.save({ provider: "notion", baseUrl: base, secret: "ntn_secret_token" });
  return { service, connection, ...fake };
}

const refOf = (connectionId: string, key: string) => ({ connectionId, provider: "notion" as const, itemType: "page" as const, key, remoteId: key });

describe("Notion (CONNECTORS-SPEC §16)", () => {
  test("connecting verifies via /v1/users/me with Bearer + Notion-Version; invalid tokens and non-Notion hosts fail", async () => {
    const x = await connected([]);
    expect(x.connection).toMatchObject({ provider: "notion", baseUrl: base, account: "Acme Workspace (Flowly Bot)" });
    expect(x.calls[0]!.url.href).toBe("https://api.notion.com/v1/users/me");
    expect(x.calls[0]!.headers.Authorization).toBe("Bearer ntn_secret_token");
    expect(x.calls[0]!.headers["Notion-Version"]).toBe("2022-06-28");
    expect(JSON.stringify(await x.service.list())).not.toContain("ntn_secret_token");

    const refused = await env.service(notion([], {}, { authStatus: 401 }).fetchImpl);
    await expect(refused.save({ provider: "notion", baseUrl: base, secret: "bad" })).rejects.toThrow(/refused the token/);

    const fake = notion([]);
    const service = await env.service(fake.fetchImpl);
    await expect(service.save({ provider: "notion", baseUrl: "https://example.com", secret: "ntn_secret" })).rejects.toThrow(/Notion address/);
    expect(fake.calls).toHaveLength(0);
  });

  test("recognizes Notion URLs across hosts, database ?p= peeks, and bare compact/dashed UUID keys", async () => {
    const x = await connected([{ id: PAGE_1, title: "Launch Plan", databaseId: DB_ID }]);
    expect(await x.service.recognize(`https://app.notion.com/Launch-Plan-${PAGE_1.replace(/-/g, "")}`)).toMatchObject({
      external: { provider: "notion", itemType: "page", key: PAGE_1, remoteId: PAGE_1 },
      title: "Launch Plan",
    });
    expect(await x.service.recognize(`https://www.notion.so/acme/00000000000000000000000000000000?v=1&p=${PAGE_1.replace(/-/g, "")}`)).toMatchObject({
      external: { key: PAGE_1 },
    });
    expect(await x.service.recognize(PAGE_1.replace(/-/g, ""))).toMatchObject({ external: { key: PAGE_1 } });
    await expect(x.service.recognize(`https://www.notion.so/${PAGE_2.replace(/-/g, "")}`)).rejects.toMatchObject({ code: "EXTERNAL_NOT_FOUND" });
  });

  test("picker paginates search results, skips archived pages, and resolves database containers", async () => {
    const x = await connected(
      [
        { id: PAGE_1, title: "Archived Draft", updated: "2026-11-22T10:00:00.000Z", archived: true },
        { id: PAGE_2, title: "API Spec", updated: "2026-11-21T10:00:00.000Z", status: "In Progress", priority: "High", assignee: "Ada", databaseId: DB_ID },
        { id: PAGE_3, title: "Release Notes", updated: "2026-11-20T10:00:00.000Z", status: "Done" },
      ],
      {},
      { searchPageSize: 1 },
    );
    const recent = await x.service.search({ connectionId: x.connection.id, query: "" });
    expect(recent.results.map((r) => r.key)).toEqual([PAGE_2, PAGE_3]);
    expect(recent.results[0]).toMatchObject({
      summary: "API Spec",
      status: "In Progress",
      statusCategory: "indeterminate",
      priority: "High",
      assignee: "Ada",
      container: "Product Specs",
    });
    expect(recent.results[1]).toMatchObject({ statusCategory: "done" });

    const byTitle = await x.service.search({ connectionId: x.connection.id, query: "release" });
    expect(byTitle.results.map((r) => r.key)).toEqual([PAGE_3]);
  });

  test("full read paginates nested blocks, renders Markdown + tables + comments, and handles comment 403 gracefully", async () => {
    const toggleId = "dddddddd-1111-2222-3333-444444444444";
    const tableId = "eeeeeeee-1111-2222-3333-444444444444";
    const pages: FakePage[] = [
      {
        id: PAGE_1,
        title: "Search Architecture",
        status: "In Progress",
        priority: "P1",
        assignee: "Ada",
        summaryText: "Target latency < 50ms",
        databaseId: DB_ID,
        blocks: [
          { id: "b1", type: "heading_1", heading_1: { rich_text: rt("Overview") } },
          { id: "b2", type: "paragraph", paragraph: { rich_text: rt("Use cursor pagination.", { bold: true }) } },
          { id: "b3", type: "to_do", to_do: { checked: true, rich_text: rt("Paginate children") } },
          { id: "b4", type: "code", code: { language: "typescript", rich_text: rt("const ok = true;") } },
          { id: toggleId, type: "toggle", has_children: true, toggle: { rich_text: rt("Details") } },
          { id: tableId, type: "table", has_children: true, table: { table_width: 2 } },
        ],
        childBlocks: {
          [toggleId]: [{ id: "c1", type: "bulleted_list_item", bulleted_list_item: { rich_text: rt("Nested note") } }],
          [tableId]: [
            { id: "r1", type: "table_row", table_row: { cells: [rt("Key"), rt("Value")] } },
            { id: "r2", type: "table_row", table_row: { cells: [rt("Limit"), rt("64 KB")] } },
          ],
        },
      },
    ];
    const comments: Record<string, FakeComment[]> = {
      [PAGE_1]: [
        { id: "cm2", text: "Looks good.", created: "2026-11-21T10:00:00.000Z" },
        { id: "cm1", text: "Please check pagination.", created: "2026-11-20T10:00:00.000Z" },
      ],
    };
    const x = await connected(pages, comments, { blockPageSize: 2 });
    const ref = refOf(x.connection.id, PAGE_1);
    const first = await x.service.detail(ref);
    for (const part of [
      "# Search Architecture",
      "- Database: Product Specs",
      "- Status: In Progress",
      "- Priority: P1",
      "- Assignee: Ada",
      "- Notes: Target latency < 50ms",
      "## Overview",
      "**Use cursor pagination.**",
      "- [x] Paginate children",
      "```typescript",
      "- **Details**",
      "  - Nested note",
      "| Key | Value |",
      "| Limit | 64 KB |",
      "## Comments (latest 2 of 2)",
    ]) {
      expect(first.markdown).toContain(part);
    }
    expect(first.markdown.indexOf("Please check pagination.")).toBeLessThan(first.markdown.indexOf("Looks good."));

    // Status or assignee changes do not alter the content fingerprint; body and comment changes do.
    pages[0]!.status = "Done";
    pages[0]!.assignee = "Grace";
    expect((await x.service.detail(ref, true)).fingerprint).toBe(first.fingerprint);

    pages[0]!.blocks![1] = { id: "b2", type: "paragraph", paragraph: { rich_text: rt("Updated body.") } };
    const edited = await x.service.detail(ref, true);
    expect(edited.fingerprint).not.toBe(first.fingerprint);
    expect(fingerprintChanged("output", first.fingerprint, edited.fingerprint)).toBe(false);

    comments[PAGE_1]!.push({ id: "cm3", text: "Ship it.", created: "2026-11-22T10:00:00.000Z" });
    expect(fingerprintChanged("output", edited.fingerprint, (await x.service.detail(ref, true)).fingerprint)).toBe(true);

    // 403 on comments (integration lacks Read comments) still returns the page without marking authFailed.
    const noComments = await connected(pages, {}, { commentsStatus: 403 });
    const readable = await noComments.service.detail(refOf(noComments.connection.id, PAGE_1));
    expect(readable.markdown).toContain("# Search Architecture");
    expect((await noComments.service.list())[0]!.authFailed).toBe(false);
  });

  test("only allowlisted read endpoints are called; 403 on a single page does not brick the connection; 429 carries Retry-After", async () => {
    const options: Options = { pageStatus: { [PAGE_2]: 403 } };
    const x = await connected([{ id: PAGE_1, title: "Visible" }], {}, options);
    await x.service.search({ connectionId: x.connection.id, query: "" });
    await x.service.detail(refOf(x.connection.id, PAGE_1));
    for (const call of x.calls) {
      expect(call.url.origin).toBe("https://api.notion.com");
      if (call.method === "POST") expect(call.url.pathname).toBe("/v1/search");
      else expect(call.method).toBe("GET");
    }

    await expect(x.service.detail(refOf(x.connection.id, PAGE_2))).rejects.toMatchObject({ code: "EXTERNAL_NOT_FOUND" });
    expect((await x.service.list())[0]!.authFailed).toBe(false);

    options.searchStatus = 429;
    options.headers = { "retry-after": "15" };
    await expect(x.service.search({ connectionId: x.connection.id, query: "visible" })).rejects.toMatchObject({
      code: "EXTERNAL_UNAVAILABLE",
      retryAfter: 15,
    });
  });

  test("Notion inputs create with a card, link to an existing card, and remain scoped to that card for agents", async () => {
    const x = await agentFixture();
    try {
      const pages: FakePage[] = [
        { id: PAGE_1, title: "Feature Brief", blocks: [{ id: "b1", type: "paragraph", paragraph: { rich_text: rt("Build the parser.") } }] },
        { id: PAGE_2, title: "Follow-up Doc" },
      ];
      const connector = await connected(pages);
      const service = new BoardService(x.store);
      service.connectors = connector.service;
      const create = vi.fn(async () => ({ id: "w2" }));
      const paseo = {
        workspaces: {
          create,
          ref: () => ({ refresh: async () => ({ id: "w2", projectId: "native", workspaceDirectory: x.a, workspaceKind: "directory", status: "done" }) }),
        },
      } as unknown as PaseoApi;
      const card = await service.createTask(
        {
          projectId: "p",
          operationId: "notion-create",
          title: "From Notion",
          description: "",
          status: "todo",
          priority: "normal",
          mode: "directory",
          baseRef: "",
          externals: [{ connectionId: connector.connection.id, key: PAGE_2, itemType: "page" }],
        },
        paseo,
      );
      const saved = await x.store.read();
      const created = saved.artifacts.find((a) => a.taskId === card.id)!;
      expect(created).toMatchObject({ role: "input", createdBy: "human", external: { provider: "notion", itemType: "page", key: PAGE_2 } });
      expect(artifactContextLines([created]).join("\n")).toContain("Notion page; read it with flowly_read_external");

      const artifacts = new ArtifactService(x.store, connector.service);
      const linked = await artifacts.create({ taskId: "t", role: "input", target: `https://www.notion.so/Feature-Brief-${PAGE_1.replace(/-/g, "")}` }, x.paseo);
      x.service.connectors = connector.service;
      const context = await x.service.get(x.identity);
      expect(context.artifacts[0]).toMatchObject({ external: { provider: "notion", key: PAGE_1 } });
      expect(await x.service.readExternal(x.identity, { artifactId: linked.id })).toMatchObject({
        key: PAGE_1,
        markdown: expect.stringContaining("Build the parser."),
      });
      await expect(x.service.readExternal(x.identity, { artifactId: created.id })).rejects.toMatchObject({ code: "EXTERNAL_NOT_FOUND" });
    } finally {
      await x.store.close();
      await rm(x.root, { recursive: true, force: true });
    }
  });
});
