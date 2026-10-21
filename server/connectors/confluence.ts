import { createHash } from "node:crypto";
import { classifyQuery, connectorLimits, pageUrl, quotedText, type ExternalSummary } from "../../shared/connectors";
import { ExternalError, ReadOnlyHttp, cut, type Fetch, type StoredConnection } from "./http";
import { storageToMarkdown } from "./storage-markdown";
import type { ConnectorAdapter, Fetched } from "./types";

/** Confluence DC and Cloud pages (CONNECTORS-SPEC §7), through the REST v1 content API. */

const readEndpoints = [
  /^\/rest\/api\/user\/current$/,
  /^\/rest\/recentlyviewed\/1\.0\/recent$/,
  /^\/rest\/api\/content\/search$/,
  /^\/rest\/api\/content$/,
  /^\/rest\/api\/content\/\d{1,19}$/,
  /^\/rest\/api\/content\/\d{1,19}\/child\/comment$/,
];

type Version = { number?: number; when?: string; by?: { displayName?: string } };
export type ConfluencePage = {
  id?: string;
  type?: string;
  title?: string;
  space?: { key?: string; name?: string };
  version?: Version;
  ancestors?: { id?: string; title?: string }[];
  body?: { storage?: { value?: string } };
  _links?: { webui?: string };
};
type Comment = { id?: string; version?: Version; body?: { storage?: { value?: string } } };
type Full = { page: ConfluencePage; comments: Comment[]; totalComments: number };

function http(connection: StoredConnection, fetchImpl: Fetch) {
  const auth =
    connection.provider === "confluence-cloud"
      ? `Basic ${Buffer.from(`${connection.email}:${connection.secret}`).toString("base64")}`
      : `Bearer ${connection.secret}`;
  return new ReadOnlyHttp({ root: connection.baseUrl, endpoints: readEndpoints, headers: { Authorization: auth }, label: "Confluence", fetchImpl });
}

export function pageSummary(connection: Pick<StoredConnection, "id" | "baseUrl">, page: ConfluencePage): ExternalSummary {
  const id = page.id || "";
  return {
    connectionId: connection.id,
    itemType: "page",
    key: id,
    remoteId: id,
    url: pageUrl(connection.baseUrl, id),
    summary: page.title || "",
    status: "",
    statusCategory: "",
    type: page.type === "blogpost" ? "Blog post" : "Page",
    priority: "",
    assignee: page.version?.by?.displayName || "",
    container: page.space?.name || page.space?.key || "",
    updated: page.version?.when || "",
  };
}

const listExpand = "space,version";
const isPage = (p: ConfluencePage) => !p.type || p.type === "page" || p.type === "blogpost";

async function cql(connection: StoredConnection, fetchImpl: Fetch, query: string, limit: number) {
  const { data } = await http(connection, fetchImpl).get<{ results?: ConfluencePage[] }>("/rest/api/content/search", { cql: query, limit, expand: listExpand });
  return (data.results || []).filter((p) => p.id && isPage(p));
}

async function page(connection: StoredConnection, fetchImpl: Fetch, id: string, full: boolean): Promise<Fetched> {
  const client = http(connection, fetchImpl);
  const { data } = await client.get<ConfluencePage>(`/rest/api/content/${id}`, { expand: full ? "body.storage,version,space,ancestors" : listExpand });
  if (!isPage(data)) throw new ExternalError("EXTERNAL_NOT_FOUND", "That is not a Confluence page.");
  const summary = pageSummary(connection, data);
  if (!full) return { summary };
  const comments = await client.get<{ results?: Comment[]; size?: number; totalSize?: number }>(`/rest/api/content/${id}/child/comment`, {
    expand: "body.storage,version",
    limit: 25,
    depth: "all",
  });
  const list = comments.data.results || [];
  return { summary, full: { page: data, comments: list, totalComments: comments.data.totalSize ?? comments.data.size ?? list.length } satisfies Full };
}

type Viewed = { id?: number | string; lastSeen?: number; type?: string };

/**
 * Pages I viewed or edited recently, most recent first (CONNECTORS-SPEC §7).
 * Views come from Confluence DC's recently-viewed list (it has the view time);
 * Cloud has no such endpoint, so there the CQL function stands in and the
 * page's last change orders it. Edits come from `contributor = currentUser()`.
 */
async function recentPages(connection: StoredConnection, fetchImpl: Fetch, limit: number): Promise<Fetched[]> {
  const viewedPromise: Promise<{ id: string; at: number }[]> =
    connection.provider === "confluence-dc"
      ? http(connection, fetchImpl)
          .get<Viewed[]>("/rest/recentlyviewed/1.0/recent", { limit: limit * 2 })
          .then(({ data }) =>
            (Array.isArray(data) ? data : [])
              .filter((v) => v.id && (!v.type || v.type === "page" || v.type === "blogpost"))
              .map((v) => ({ id: String(v.id), at: Number(v.lastSeen) || 0 })),
          )
          .catch((error) => {
            // An older DC without the endpoint: fall back to CQL below.
            if (error instanceof ExternalError && (error.code === "EXTERNAL_NOT_FOUND" || error.code === "EXTERNAL_INVALID")) return [];
            throw error;
          })
      : Promise.resolve([]);
  const [viewed, edited] = await Promise.all([
    viewedPromise,
    cql(connection, fetchImpl, "type = page AND contributor = currentUser() ORDER BY lastmodified DESC", limit),
  ]);
  const pages = new Map(edited.map((p) => [p.id!, p]));
  const seen = new Map(viewed.map((v) => [v.id, v.at]));
  const missing = viewed.map((v) => v.id).filter((id) => /^\d{1,19}$/.test(id) && !pages.has(id));
  if (missing.length) for (const p of await cql(connection, fetchImpl, `id in (${missing.slice(0, 50).join(", ")})`, 50)) pages.set(p.id!, p);
  if (connection.provider === "confluence-cloud" || !viewed.length)
    for (const p of await cql(connection, fetchImpl, `type = page AND id in recentlyViewedContent(${limit})`, limit).catch(() => [] as ConfluencePage[]))
      if (!pages.has(p.id!)) pages.set(p.id!, p);
  const when = (p: ConfluencePage) => Math.max(seen.get(p.id!) || 0, Date.parse(p.version?.when || "") || 0);
  return [...pages.values()]
    .sort((a, b) => when(b) - when(a))
    .slice(0, limit)
    .map((p) => ({ summary: pageSummary(connection, p) }));
}

const notFoundIsEmpty = (error: unknown): Fetched[] => {
  if (error instanceof ExternalError && error.code === "EXTERNAL_NOT_FOUND") return [];
  throw error;
};

export const confluenceAdapter: ConnectorAdapter = {
  label: "Confluence",
  readBytes: connectorLimits.pageBytes,
  // A new comment does not change the page version, so `updated` stays put.
  updatedCoversContent: false,
  async verify(connection, fetchImpl) {
    const { data } = await http(connection, fetchImpl).get<{ type?: string; displayName?: string; username?: string; publicName?: string; email?: string }>("/rest/api/user/current");
    // Confluence answers an unaccepted token as the anonymous user rather than with 401.
    if (data.type === "anonymous") throw new ExternalError("EXTERNAL_AUTH", "Confluence refused the token. Update the connection in Flowly settings.");
    return { account: data.displayName || data.publicName || data.username || data.email || "", login: data.username || "" };
  },
  async search(connection, fetchImpl, raw) {
    const query = classifyQuery(raw, connection);
    const done = (pages: ConfluencePage[]) => pages.map((p) => ({ summary: pageSummary(connection, p) }));
    if (query.kind === "recent") return recentPages(connection, fetchImpl, connectorLimits.recent);
    if (query.kind === "key") return page(connection, fetchImpl, query.key, false).then((f) => [f], notFoundIsEmpty);
    if (query.kind === "lookup") {
      const id = await confluenceAdapter.lookup!(connection, fetchImpl, query.space, query.title).catch((error) => {
        if (error instanceof ExternalError && error.code === "EXTERNAL_NOT_FOUND") return "";
        throw error;
      });
      return id ? page(connection, fetchImpl, id, false).then((f) => [f], notFoundIsEmpty) : [];
    }
    const text = query.kind === "text" ? query.text : query.kind === "number" ? query.number : "";
    const byTitle = await cql(connection, fetchImpl, `type = page AND title ~ ${quotedText(text)} ORDER BY lastmodified DESC`, connectorLimits.search);
    if (byTitle.length) return done(byTitle);
    return done(await cql(connection, fetchImpl, `type = page AND text ~ ${quotedText(text)} ORDER BY lastmodified DESC`, connectorLimits.search));
  },
  get: (connection, fetchImpl, ref, full) => page(connection, fetchImpl, ref.key, full),
  async getMany(connection, fetchImpl, refs) {
    const ids = refs.map((r) => r.key).filter((id) => /^\d{1,19}$/.test(id));
    if (!ids.length) return [];
    const pages = await cql(connection, fetchImpl, `id in (${ids.join(", ")})`, 50);
    return pages.map((p) => ({ summary: pageSummary(connection, p) }));
  },
  async lookup(connection, fetchImpl, space, title) {
    const { data } = await http(connection, fetchImpl).get<{ results?: ConfluencePage[] }>("/rest/api/content", { spaceKey: space, title, type: "page", limit: 1 });
    const id = data.results?.[0]?.id;
    if (!id) throw new ExternalError("EXTERNAL_NOT_FOUND", "Page not found, or this account can't see it.");
    return id;
  },
  fingerprint(full) {
    const { page: p, comments } = full as Full;
    return createHash("sha256")
      .update(JSON.stringify([p.title || "", p.version?.number ?? 0, comments.map((c) => `${c.id}:${c.version?.number ?? 0}`)]))
      .digest("hex")
      .slice(0, 16);
  },
  markdown(summary, full, limit) {
    const { page: p, comments, totalComments } = full as Full;
    const path = (p.ancestors || []).map((a) => a.title).filter(Boolean).join(" / ");
    const meta = [
      ["Space", summary.container],
      ["Path", path],
      ["Version", p.version?.number ? `${p.version.number}${p.version.by?.displayName ? ` by ${p.version.by.displayName}` : ""}${p.version.when ? ` · ${p.version.when}` : ""}` : ""],
    ]
      .filter(([, value]) => value)
      .map(([label, value]) => `- ${label}: ${value}`);
    const sections = [`# ${summary.summary}`, summary.url, "", ...meta, "", "## Content", "", storageToMarkdown(p.body?.storage?.value || "") || "(empty)"];
    const latest = comments.slice(-connectorLimits.comments);
    if (latest.length) {
      sections.push("", `## Comments (latest ${latest.length} of ${Math.max(totalComments, latest.length)})`);
      for (const c of latest)
        sections.push("", `### ${c.version?.by?.displayName || "Someone"} · ${c.version?.when || ""}`, "", storageToMarkdown(c.body?.storage?.value || ""));
    }
    return cut(sections.join("\n"), summary.url, limit);
  },
};
