import { createHash } from "node:crypto";
import { classifyQuery, connectorLimits, isNotionHost, notionPageId, notionPageUrl, type ExternalSummary } from "../../shared/connectors";
import { ExternalError, ReadOnlyHttp, cut, mapLimit, retryAfter, type Fetch, type StoredConnection } from "./http";
import type { ConnectorAdapter, Fetched, ItemRef } from "./types";
import { withDiscussion } from "./fingerprint";

/** Notion pages (CONNECTORS-SPEC §16), cloud only, REST API v1. */

const API_ROOT = "https://api.notion.com";
const NOTION_VERSION = "2022-06-28";
const UUID_SEGMENT = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

const readEndpoints = [
  /^\/v1\/users\/me$/,
  new RegExp(`^/v1/pages/${UUID_SEGMENT}$`),
  new RegExp(`^/v1/blocks/${UUID_SEGMENT}/children$`),
  new RegExp(`^/v1/databases/${UUID_SEGMENT}$`),
  /^\/v1\/comments$/,
];

/** Notion search requires POST /v1/search; every other path is GET-only and mutating paths are refused. */
const queryEndpoints = [/^\/v1\/search$/];

const MAX_BLOCK_DEPTH = 2;
const MAX_BLOCKS = 200;
const MAX_BLOCK_PAGES = 5;
const MAX_SEARCH_PAGES = 3;
const MAX_COMMENT_PAGES = 5;
const CONTAINER_TTL_MS = 10 * 60_000;

type RichText = {
  plain_text?: string;
  href?: string | null;
  annotations?: {
    bold?: boolean;
    italic?: boolean;
    strikethrough?: boolean;
    code?: boolean;
  };
};

type NotionUser = {
  id?: string;
  type?: string;
  name?: string | null;
  bot?: { workspace_name?: string | null; workspace_id?: string | null };
};

type NotionProperty = {
  id?: string;
  type?: string;
  title?: RichText[];
  rich_text?: RichText[];
  status?: { name?: string | null } | null;
  select?: { name?: string | null } | null;
  multi_select?: { name?: string | null }[];
  people?: { name?: string | null }[];
  date?: { start?: string | null; end?: string | null } | null;
  number?: number | null;
  checkbox?: boolean;
  url?: string | null;
  email?: string | null;
  phone_number?: string | null;
  unique_id?: { prefix?: string | null; number?: number | null } | null;
  formula?: { type?: string; string?: string | null; number?: number | null; boolean?: boolean | null; date?: { start?: string | null } | null };
};

export type NotionPage = {
  object?: string;
  id?: string;
  url?: string;
  archived?: boolean;
  in_trash?: boolean;
  created_time?: string;
  last_edited_time?: string;
  parent?: { type?: string; database_id?: string; data_source_id?: string; page_id?: string; workspace?: boolean };
  properties?: Record<string, NotionProperty>;
};

export type NotionBlock = {
  id?: string;
  type?: string;
  has_children?: boolean;
  archived?: boolean;
  in_trash?: boolean;
  children?: NotionBlock[];
  [key: string]: unknown;
};

type NotionComment = {
  id?: string;
  created_time?: string;
  rich_text?: RichText[];
  created_by?: { id?: string; name?: string | null };
};

type Paged<T> = { results?: T[]; has_more?: boolean; next_cursor?: string | null };
type Full = { page: NotionPage; blocks: NotionBlock[]; comments: NotionComment[]; totalComments: number; truncatedBlocks: boolean };

/** Database titles cached per connection + database id for 10 minutes; misses never fail a read. */
const databaseNames = new Map<string, { name: string; at: number }>();

function http(connection: StoredConnection, fetchImpl: Fetch) {
  return new ReadOnlyHttp({
    root: API_ROOT,
    endpoints: readEndpoints,
    queryEndpoints,
    headers: {
      Authorization: `Bearer ${connection.secret}`,
      "Notion-Version": NOTION_VERSION,
    },
    label: "Notion",
    fetchImpl,
    failure(response, body, path) {
      if (response.status === 401)
        return new ExternalError("EXTERNAL_AUTH", "Notion refused the token. Update the connection in Flowly settings.");
      // 403 on an individual page/block/database/comments means the integration was not shared with that resource or lacks comments capability.
      if (response.status === 403 && path !== "/v1/users/me" && path !== "/v1/search")
        return new ExternalError("EXTERNAL_NOT_FOUND", "Not found, or this integration does not have access to it.");
      if (response.status === 403)
        return new ExternalError("EXTERNAL_AUTH", "Notion refused the token. Update the connection in Flowly settings.");
      if (response.status === 429)
        return new ExternalError("EXTERNAL_UNAVAILABLE", "Notion asked Flowly to slow down (rate limited).", retryAfter(response.headers));
      if (response.status === 404)
        return new ExternalError("EXTERNAL_NOT_FOUND", "Not found, or this integration does not have access to it.");
      if (response.status >= 500)
        return new ExternalError("EXTERNAL_UNAVAILABLE", `Notion is busy or unavailable (HTTP ${response.status}).`, retryAfter(response.headers));
      try {
        const parsed = JSON.parse(body) as { message?: string };
        if (parsed.message) return new ExternalError("EXTERNAL_INVALID", `Notion rejected the request: ${parsed.message.slice(0, 200)}.`);
      } catch {
        // fall through to default mapping
      }
      return undefined;
    },
  });
}

const plainText = (items: readonly RichText[] | undefined) => (items || []).map((r) => r.plain_text || "").join("");

function richTextToMarkdown(items: readonly RichText[] | undefined): string {
  return (items || [])
    .map((item) => {
      let text = item.plain_text || "";
      if (!text) return "";
      const ann = item.annotations;
      if (ann?.code) {
        const ticks = text.includes("`") ? "``" : "`";
        text = `${ticks}${text}${ticks}`;
      } else {
        if (ann?.bold) text = `**${text}**`;
        if (ann?.italic) text = `*${text}*`;
        if (ann?.strikethrough) text = `~~${text}~~`;
      }
      if (item.href) text = `[${text}](${item.href})`;
      return text;
    })
    .join("");
}

function pageTitle(page: NotionPage): string {
  const props = page.properties || {};
  for (const prop of Object.values(props)) {
    if (prop?.type === "title") {
      const text = plainText(prop.title).trim();
      if (text) return text;
    }
  }
  return "Untitled";
}

function propertyValue(prop: NotionProperty): string {
  switch (prop.type) {
    case "title":
      return plainText(prop.title).trim();
    case "rich_text":
      return plainText(prop.rich_text).trim();
    case "status":
      return prop.status?.name?.trim() || "";
    case "select":
      return prop.select?.name?.trim() || "";
    case "multi_select":
      return (prop.multi_select || []).map((o) => o.name || "").filter(Boolean).join(", ");
    case "people":
      return (prop.people || []).map((p) => p.name || "").filter(Boolean).join(", ");
    case "date":
      if (!prop.date?.start) return "";
      return prop.date.end ? `${prop.date.start} → ${prop.date.end}` : prop.date.start;
    case "number":
      return prop.number != null ? String(prop.number) : "";
    case "checkbox":
      return prop.checkbox ? "Yes" : "No";
    case "url":
      return prop.url || "";
    case "email":
      return prop.email || "";
    case "phone_number":
      return prop.phone_number || "";
    case "unique_id":
      return prop.unique_id?.number != null ? `${prop.unique_id.prefix ? `${prop.unique_id.prefix}-` : ""}${prop.unique_id.number}` : "";
    case "formula":
      if (!prop.formula) return "";
      if (prop.formula.type === "string") return prop.formula.string || "";
      if (prop.formula.type === "number") return prop.formula.number != null ? String(prop.formula.number) : "";
      if (prop.formula.type === "boolean") return prop.formula.boolean ? "Yes" : "No";
      if (prop.formula.type === "date") return prop.formula.date?.start || "";
      return "";
    default:
      return "";
  }
}

function statusCategoryOf(name: string): string {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return "";
  if (/(done|complete|completed|closed|cancel|cancelled|canceled|archived|shipped|resolved)/.test(normalized)) return "done";
  if (/(progress|doing|review|active|working|testing|blocked)/.test(normalized)) return "indeterminate";
  return "new";
}

function findProperty(page: NotionPage, predicate: (name: string, prop: NotionProperty) => boolean): [string, NotionProperty] | undefined {
  return Object.entries(page.properties || {}).find(([name, prop]) => prop && predicate(name, prop));
}

export function notionSummary(connection: Pick<StoredConnection, "id" | "baseUrl">, page: NotionPage, container = ""): ExternalSummary {
  const id = notionPageId(page.id) || page.id || "";
  const statusProp =
    findProperty(page, (_, p) => p.type === "status") ||
    findProperty(page, (name, p) => p.type === "select" && /^status$/i.test(name.trim()));
  const status = statusProp ? propertyValue(statusProp[1]) : "";
  const priorityProp = findProperty(page, (name, p) => (p.type === "select" || p.type === "status") && /^priority$/i.test(name.trim()));
  const assigneeProp =
    findProperty(page, (name, p) => p.type === "people" && /(assignee|owner|负责人)/i.test(name)) ||
    findProperty(page, (_, p) => p.type === "people");
  return {
    connectionId: connection.id,
    itemType: "page",
    key: id,
    remoteId: id,
    url: page.url || notionPageUrl(connection.baseUrl, id),
    summary: pageTitle(page),
    status,
    statusCategory: statusCategoryOf(status),
    type: "Page",
    priority: priorityProp ? propertyValue(priorityProp[1]) : "",
    assignee: assigneeProp ? propertyValue(assigneeProp[1]) : "",
    container,
    updated: page.last_edited_time || "",
  };
}

async function databaseTitle(connection: StoredConnection, client: ReadOnlyHttp, databaseId: string | undefined): Promise<string> {
  const id = notionPageId(databaseId);
  if (!id) return "";
  const cacheKey = `${connection.id}:${id}`;
  const cached = databaseNames.get(cacheKey);
  if (cached && Date.now() - cached.at < CONTAINER_TTL_MS) return cached.name;
  try {
    const { data } = await client.get<{ title?: RichText[] }>(`/v1/databases/${id}`);
    const name = plainText(data.title).trim();
    databaseNames.set(cacheKey, { name, at: Date.now() });
    return name;
  } catch {
    databaseNames.set(cacheKey, { name: "", at: Date.now() });
    return "";
  }
}

async function fetchBlocks(client: ReadOnlyHttp, blockId: string, depth: number, budget: { count: number; truncated: boolean }): Promise<NotionBlock[]> {
  const blocks: NotionBlock[] = [];
  let cursor: string | undefined;
  let pages = 0;
  while (pages < MAX_BLOCK_PAGES && budget.count < MAX_BLOCKS) {
    pages += 1;
    const { data } = await client.get<Paged<NotionBlock>>(`/v1/blocks/${blockId}/children`, {
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    const batch = (data.results || []).filter((b) => !b.archived && !b.in_trash);
    for (const block of batch) {
      if (budget.count >= MAX_BLOCKS) {
        budget.truncated = true;
        return blocks;
      }
      budget.count += 1;
      blocks.push(block);
    }
    if (!data.has_more || !data.next_cursor) break;
    cursor = data.next_cursor;
  }
  if (cursor && pages >= MAX_BLOCK_PAGES) budget.truncated = true;
  if (depth < MAX_BLOCK_DEPTH && budget.count < MAX_BLOCKS) {
    const parents = blocks.filter((b) => b.has_children && b.id && b.type !== "child_page" && b.type !== "child_database");
    await mapLimit(parents, 3, async (parent) => {
      if (budget.count >= MAX_BLOCKS) {
        budget.truncated = true;
        return;
      }
      const childId = notionPageId(parent.id);
      if (!childId) return;
      parent.children = await fetchBlocks(client, childId, depth + 1, budget);
    });
  }
  return blocks;
}

async function fetchComments(client: ReadOnlyHttp, pageId: string): Promise<{ comments: NotionComment[]; total: number }> {
  const all: NotionComment[] = [];
  let cursor: string | undefined;
  let pages = 0;
  try {
    while (pages < MAX_COMMENT_PAGES) {
      pages += 1;
      const { data } = await client.get<Paged<NotionComment>>("/v1/comments", {
        block_id: pageId,
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
      });
      all.push(...(data.results || []));
      if (!data.has_more || !data.next_cursor) break;
      cursor = data.next_cursor;
    }
  } catch (error) {
    // Integrations without "Read comments" receive 403 (mapped to EXTERNAL_NOT_FOUND); keep the page readable.
    if (error instanceof ExternalError && error.code === "EXTERNAL_NOT_FOUND") return { comments: [], total: 0 };
    throw error;
  }
  all.sort((a, b) => (a.created_time || "").localeCompare(b.created_time || ""));
  return { comments: all.slice(-connectorLimits.comments), total: all.length };
}

function tableToMarkdown(rows: readonly NotionBlock[]): string[] {
  const matrix = rows
    .filter((r) => r.type === "table_row")
    .map((r) => {
      const data = r.table_row as { cells?: RichText[][] } | undefined;
      return (data?.cells || []).map((cell) => richTextToMarkdown(cell).replace(/\|/g, "\\|").replace(/\n+/g, " "));
    });
  if (!matrix.length) return [];
  const cols = Math.max(...matrix.map((row) => row.length), 1);
  const pad = (row: string[]) => Array.from({ length: cols }, (_, i) => row[i] || "");
  const header = `| ${pad(matrix[0]!).join(" | ")} |`;
  const sep = `| ${Array.from({ length: cols }, () => "---").join(" | ")} |`;
  const body = matrix.slice(1).map((row) => `| ${pad(row).join(" | ")} |`);
  return [header, sep, ...body];
}

function renderBlocks(blocks: readonly NotionBlock[], indent = ""): string[] {
  const lines: string[] = [];
  let numbered = 0;
  for (const block of blocks) {
    const type = block.type || "";
    if (type !== "numbered_list_item") numbered = 0;
    const payload = (block[type] || {}) as {
      rich_text?: RichText[];
      caption?: RichText[];
      checked?: boolean;
      language?: string;
      url?: string;
      title?: string;
      expression?: string;
      external?: { url?: string };
      file?: { url?: string };
    };
    const text = richTextToMarkdown(payload.rich_text).trim();
    const children = block.children || [];
    if (type === "paragraph") {
      if (text) lines.push(`${indent}${text}`);
      if (children.length) lines.push(...renderBlocks(children, `${indent}  `));
    } else if (type === "heading_1") {
      if (text) lines.push(`${indent}## ${text}`);
      if (children.length) lines.push(...renderBlocks(children, indent));
    } else if (type === "heading_2") {
      if (text) lines.push(`${indent}### ${text}`);
      if (children.length) lines.push(...renderBlocks(children, indent));
    } else if (type === "heading_3") {
      if (text) lines.push(`${indent}#### ${text}`);
      if (children.length) lines.push(...renderBlocks(children, indent));
    } else if (type === "bulleted_list_item") {
      lines.push(`${indent}- ${text}`);
      if (children.length) lines.push(...renderBlocks(children, `${indent}  `));
    } else if (type === "numbered_list_item") {
      numbered += 1;
      lines.push(`${indent}${numbered}. ${text}`);
      if (children.length) lines.push(...renderBlocks(children, `${indent}  `));
    } else if (type === "to_do") {
      lines.push(`${indent}- [${payload.checked ? "x" : " "}] ${text}`);
      if (children.length) lines.push(...renderBlocks(children, `${indent}  `));
    } else if (type === "quote" || type === "callout") {
      if (text) lines.push(...text.split("\n").map((l) => `${indent}> ${l}`));
      if (children.length) lines.push(...renderBlocks(children, `${indent}> `));
    } else if (type === "toggle") {
      if (text) lines.push(`${indent}- **${text}**`);
      if (children.length) lines.push(...renderBlocks(children, `${indent}  `));
    } else if (type === "code") {
      const lang = payload.language && payload.language !== "plain text" ? payload.language : "";
      const code = plainText(payload.rich_text);
      lines.push(`${indent}\`\`\`${lang}`, code, `${indent}\`\`\``);
    } else if (type === "divider") {
      lines.push(`${indent}---`);
    } else if (type === "equation") {
      if (payload.expression) lines.push(`${indent}$$${payload.expression}$$`);
    } else if (type === "table") {
      lines.push(...tableToMarkdown(children).map((l) => `${indent}${l}`));
    } else if (type === "bookmark" || type === "embed" || type === "link_preview") {
      const caption = richTextToMarkdown(payload.caption).trim();
      const target = payload.url || "";
      if (target) lines.push(`${indent}${caption ? `[${caption}](${target})` : target}`);
    } else if (type === "image" || type === "file" || type === "pdf" || type === "video") {
      const caption = richTextToMarkdown(payload.caption).trim();
      const target = payload.external?.url || payload.file?.url || "";
      if (target || caption) lines.push(`${indent}[${caption || type}](${target})`);
    } else if (type === "child_page") {
      if (payload.title) lines.push(`${indent}- Subpage: ${payload.title}`);
    } else if (type === "child_database") {
      if (payload.title) lines.push(`${indent}- Database: ${payload.title}`);
    } else if (children.length) {
      lines.push(...renderBlocks(children, indent));
    } else if (text) {
      lines.push(`${indent}${text}`);
    }
  }
  return lines;
}

const notFound = (error: unknown) => error instanceof ExternalError && error.code === "EXTERNAL_NOT_FOUND";

async function readPage(connection: StoredConnection, fetchImpl: Fetch, rawKey: string, full: boolean): Promise<Fetched> {
  const id = notionPageId(rawKey);
  if (!id) throw new ExternalError("EXTERNAL_INVALID", `"${rawKey}" is not a Notion page id.`);
  const client = http(connection, fetchImpl);
  const { data: page } = await client.get<NotionPage>(`/v1/pages/${id}`);
  const dbId = page.parent?.database_id;
  const container = dbId ? await databaseTitle(connection, client, dbId) : "";
  const summary = notionSummary(connection, page, container);
  if (!full) return { summary };
  const budget = { count: 0, truncated: false };
  const [blocks, commentsResult] = await Promise.all([
    fetchBlocks(client, id, 0, budget),
    fetchComments(client, id),
  ]);
  return {
    summary,
    full: {
      page,
      blocks,
      comments: commentsResult.comments,
      totalComments: commentsResult.total,
      truncatedBlocks: budget.truncated,
    } satisfies Full,
  };
}

async function searchPages(connection: StoredConnection, fetchImpl: Fetch, queryText: string | undefined, limit: number): Promise<Fetched[]> {
  const client = http(connection, fetchImpl);
  const pages: NotionPage[] = [];
  let cursor: string | undefined;
  let attempts = 0;
  while (attempts < MAX_SEARCH_PAGES && pages.length < limit) {
    attempts += 1;
    const body: Record<string, unknown> = {
      filter: { property: "object", value: "page" },
      sort: { direction: "descending", timestamp: "last_edited_time" },
      page_size: Math.min(100, Math.max(limit * 2, 20)),
      ...(queryText ? { query: queryText } : {}),
      ...(cursor ? { start_cursor: cursor } : {}),
    };
    const { data } = await client.query<Paged<NotionPage>>("/v1/search", body);
    for (const p of data.results || []) {
      if (p.object && p.object !== "page") continue;
      if (p.archived || p.in_trash || !p.id) continue;
      pages.push(p);
      if (pages.length >= limit) break;
    }
    if (!data.has_more || !data.next_cursor) break;
    cursor = data.next_cursor;
  }
  const uniqueDbs = [...new Set(pages.map((p) => p.parent?.database_id).filter((id): id is string => !!id))];
  const dbMap = new Map<string, string>();
  await mapLimit(uniqueDbs, 4, async (dbId) => {
    dbMap.set(dbId, await databaseTitle(connection, client, dbId));
  });
  return pages.slice(0, limit).map((p) => ({
    summary: notionSummary(connection, p, p.parent?.database_id ? dbMap.get(p.parent.database_id) || "" : ""),
  }));
}

function contentProperties(page: NotionPage): [string, string][] {
  const entries: [string, string][] = [];
  for (const [name, prop] of Object.entries(page.properties || {})) {
    if (!prop || prop.type === "title" || prop.type === "status" || prop.type === "people") continue;
    if (/^(status|priority|assignee|owner)$/i.test(name.trim())) continue;
    const value = propertyValue(prop);
    if (value) entries.push([name, value]);
  }
  entries.sort(([a], [b]) => a.localeCompare(b));
  return entries;
}

export const notionAdapter: ConnectorAdapter = {
  label: "Notion",
  readBytes: connectorLimits.pageBytes,
  // Comments in Notion do not always advance last_edited_time, so full reads decide the fingerprint.
  updatedCoversContent: false,
  async verify(connection, fetchImpl) {
    const address = new URL(connection.baseUrl);
    if (address.protocol !== "https:" || !isNotionHost(address.hostname))
      throw new ExternalError("EXTERNAL_INVALID", "Enter a Notion address, e.g. https://www.notion.so.");
    const { data } = await http(connection, fetchImpl).get<NotionUser>("/v1/users/me");
    const workspace = (data.bot?.workspace_name || "").trim();
    const name = (data.name || "").trim();
    if (!workspace && !name)
      throw new ExternalError("EXTERNAL_INVALID", "Notion did not return an integration account Flowly could verify.");
    return {
      account: workspace && name && workspace !== name ? `${workspace} (${name})` : workspace || name,
      login: name,
    };
  },
  async search(connection, fetchImpl, raw) {
    const query = classifyQuery(raw, connection);
    if (query.kind === "key") {
      return readPage(connection, fetchImpl, query.key, false).then(
        (f) => [f],
        (error) => {
          if (notFound(error)) return [];
          throw error;
        },
      );
    }
    if (query.kind === "recent") return searchPages(connection, fetchImpl, undefined, connectorLimits.recent);
    if (query.kind !== "text") return [];
    return searchPages(connection, fetchImpl, query.text, connectorLimits.search);
  },
  get: (connection, fetchImpl, ref, full) => readPage(connection, fetchImpl, ref.key, full),
  async getMany(connection, fetchImpl, refs) {
    const found = await mapLimit(refs, 4, (ref) =>
      readPage(connection, fetchImpl, ref.key, false).catch((error) => {
        if (notFound(error)) return null;
        throw error;
      }),
    );
    return found.filter((f): f is Fetched => !!f);
  },
  fingerprint(full) {
    const { page, blocks, comments } = full as Full;
    const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
    const discussion = comments.map((c) => `${c.id || ""}:${c.created_time || ""}:${plainText(c.rich_text)}`);
    const body = renderBlocks(blocks).join("\n");
    const props = contentProperties(page);
    return withDiscussion(hash([pageTitle(page), props, body, discussion]), hash(discussion));
  },
  markdown(summary, full, limit) {
    const { page, blocks, comments, totalComments, truncatedBlocks } = full as Full;
    const meta: [string, string][] = [
      ["Database", summary.container],
      ["Status", summary.status],
      ["Priority", summary.priority],
      ["Assignee", summary.assignee],
      ["Updated", summary.updated],
      ...contentProperties(page),
    ];
    const metaLines = meta.filter(([, value]) => value).map(([label, value]) => `- ${label}: ${value}`);
    const bodyLines = renderBlocks(blocks);
    const body = bodyLines.join("\n").trim() || "(empty)";
    const sections = [`# ${summary.summary}`, summary.url, "", ...metaLines, "", "## Content", "", body];
    if (truncatedBlocks) sections.push("", `…(more blocks on Notion; read the rest at ${summary.url})`);
    if (comments.length) {
      sections.push("", `## Comments (latest ${comments.length} of ${Math.max(totalComments, comments.length)})`);
      for (const c of comments) {
        const author = c.created_by?.name || "Someone";
        sections.push("", `### ${author} · ${c.created_time || ""}`, "", richTextToMarkdown(c.rich_text).trim());
      }
    }
    return cut(sections.join("\n"), summary.url, limit);
  },
};
