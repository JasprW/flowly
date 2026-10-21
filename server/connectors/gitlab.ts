import { createHash } from "node:crypto";
import { classifyQuery, connectorLimits, gitlabFromUrl, gitlabItemUrl, splitRepoKey, type ExternalSummary, type ItemType } from "../../shared/connectors";
import { ExternalError, ReadOnlyHttp, cut, mapLimit, retryAfter, type Fetch, type StoredConnection } from "./http";
import type { ConnectorAdapter, Fetched, ItemRef } from "./types";

/** GitLab issues and merge requests (CONNECTORS-SPEC §5), gitlab.com and self-managed, REST v4. */

const project = "[^/]+";
const readEndpoints = [
  /^\/user$/,
  /^\/issues$/,
  /^\/merge_requests$/,
  new RegExp(`^/projects/${project}/(issues|merge_requests)$`),
  new RegExp(`^/projects/${project}/(issues|merge_requests)/\\d+(/notes)?$`),
  new RegExp(`^/projects/${project}/merge_requests/\\d+/(diffs|changes)$`),
];

type User = { name?: string; username?: string };
export type GitlabItem = {
  id?: number;
  iid?: number;
  title?: string;
  description?: string | null;
  state?: string;
  draft?: boolean;
  work_in_progress?: boolean;
  merged_at?: string | null;
  labels?: string[];
  author?: User;
  assignees?: User[];
  reviewers?: User[];
  milestone?: { title?: string } | null;
  updated_at?: string;
  web_url?: string;
  references?: { full?: string };
  source_branch?: string;
  target_branch?: string;
  sha?: string;
  changes_count?: string | null;
};
type Note = { id?: number; body?: string; system?: boolean; author?: User; created_at?: string; updated_at?: string; position?: { new_path?: string; new_line?: number | null } };
type Full = { item: GitlabItem; notes: Note[]; files: { path: string; change: string }[] | null };

function http(connection: StoredConnection, fetchImpl: Fetch) {
  return new ReadOnlyHttp({
    root: `${connection.baseUrl}/api/v4`,
    endpoints: readEndpoints,
    headers: { "PRIVATE-TOKEN": connection.secret },
    label: "GitLab",
    fetchImpl,
    failure(response, _body, path) {
      // A project or item this account can't see answers 403; only /user says the token is refused.
      if (response.status === 403 && path !== "/user") return new ExternalError("EXTERNAL_NOT_FOUND", "Not found, or this account can't see it.");
      if (response.status === 429) return new ExternalError("EXTERNAL_UNAVAILABLE", "GitLab asked Flowly to slow down (HTTP 429).", retryAfter(response.headers) ?? resetIn(response.headers));
      return undefined;
    },
  });
}

const resetIn = (headers: Headers) => {
  const reset = Number(headers.get("ratelimit-reset"));
  return Number.isFinite(reset) && reset > 0 ? Math.max(1, Math.ceil(reset - Date.now() / 1000)) : undefined;
};

const kindPath = (itemType: ItemType) => (itemType === "merge_request" ? "merge_requests" : "issues");
const encoded = (repo: string) => encodeURIComponent(repo);

function statusOf(item: GitlabItem, mr: boolean) {
  if (mr && item.merged_at) return "Merged";
  if (item.state === "merged") return "Merged";
  if (item.state === "closed") return "Closed";
  if (mr && (item.draft || item.work_in_progress)) return "Draft";
  return "Open";
}

export function gitlabSummary(connection: Pick<StoredConnection, "id" | "baseUrl">, item: GitlabItem, itemType: ItemType): ExternalSummary {
  const mr = itemType === "merge_request";
  const parsed = item.web_url ? gitlabFromUrl(item.web_url, connection.baseUrl) : null;
  const key = parsed?.key || item.references?.full || "";
  const status = statusOf(item, mr);
  return {
    connectionId: connection.id,
    itemType,
    key,
    remoteId: item.id ? String(item.id) : "",
    url: item.web_url || gitlabItemUrl(connection.baseUrl, key, itemType),
    summary: item.title || "",
    status,
    statusCategory: status === "Open" || status === "Draft" ? "indeterminate" : "done",
    type: mr ? "Merge request" : "Issue",
    priority: "",
    assignee: (item.assignees || []).map((a) => a.name || a.username).filter(Boolean).join(", "),
    container: splitRepoKey(key)?.repo || "",
    updated: item.updated_at || "",
  };
}

const notFound = (error: unknown) => error instanceof ExternalError && error.code === "EXTERNAL_NOT_FOUND";

async function item(connection: StoredConnection, fetchImpl: Fetch, ref: ItemRef, full: boolean): Promise<Fetched> {
  const parts = splitRepoKey(ref.key);
  if (!parts) throw new ExternalError("EXTERNAL_INVALID", `"${ref.key}" is not a GitLab issue or merge request key.`);
  const itemType: ItemType = parts.sep === "!" ? "merge_request" : "issue";
  const client = http(connection, fetchImpl);
  const base = `/projects/${encoded(parts.repo)}/${kindPath(itemType)}/${parts.number}`;
  const { data } = await client.get<GitlabItem>(base);
  const summary = gitlabSummary(connection, data, itemType);
  if (!full) return { summary };
  const [notes, files] = await Promise.all([
    client.get<Note[]>(`${base}/notes`, { sort: "desc", order_by: "created_at", per_page: 50 }).then((r) => r.data),
    itemType === "merge_request" ? changedFiles(client, base) : Promise.resolve(null),
  ]);
  const human = notes.filter((n) => !n.system).slice(0, connectorLimits.comments).reverse();
  return { summary, full: { item: data, notes: human, files } satisfies Full };
}

type Diff = { new_path?: string; old_path?: string; new_file?: boolean; deleted_file?: boolean; renamed_file?: boolean };
const fileOf = (d: Diff) => ({
  path: d.new_path || d.old_path || "",
  change: d.new_file ? "added" : d.deleted_file ? "deleted" : d.renamed_file ? `renamed from ${d.old_path}` : "modified",
});

/**
 * The merge request's changed file names: /diffs (GitLab 15.7+), else /changes
 * (older instances such as 14.x). Only names are kept, never the patches.
 */
async function changedFiles(client: ReturnType<typeof http>, base: string) {
  try {
    return (await client.get<Diff[]>(`${base}/diffs`, { per_page: connectorLimits.files })).data.map(fileOf);
  } catch (error) {
    if (!notFound(error)) throw error;
  }
  try {
    const { data } = await client.get<{ changes?: Diff[] }>(`${base}/changes`);
    return (data.changes || []).slice(0, connectorLimits.files).map(fileOf);
  } catch (error) {
    if (notFound(error)) return null;
    throw error;
  }
}

type Listed = { item: GitlabItem; itemType: ItemType };

async function list(connection: StoredConnection, fetchImpl: Fetch, path: string, itemType: ItemType, params: Record<string, string | number | undefined>): Promise<Listed[]> {
  const { data } = await http(connection, fetchImpl).get<GitlabItem[]>(path, { per_page: connectorLimits.recent, order_by: "updated_at", sort: "desc", ...params });
  return data.map((x) => ({ item: x, itemType }));
}

function rows(connection: StoredConnection, listed: Listed[], limit: number): Fetched[] {
  const seen = new Set<string>();
  return listed
    .sort((a, b) => (b.item.updated_at || "").localeCompare(a.item.updated_at || ""))
    .map((x) => ({ summary: gitlabSummary(connection, x.item, x.itemType) }))
    .filter((f) => f.summary.key && !seen.has(f.summary.key) && !!seen.add(f.summary.key))
    .slice(0, limit);
}

export const gitlabAdapter: ConnectorAdapter = {
  label: "GitLab",
  readBytes: connectorLimits.readBytes,
  async verify(connection, fetchImpl) {
    const { data } = await http(connection, fetchImpl).get<User>("/user");
    return { account: data.name && data.username ? `${data.name} (@${data.username})` : data.name || data.username || "", login: data.username || "" };
  },
  async search(connection, fetchImpl, raw, scope) {
    const query = classifyQuery(raw, connection);
    if (query.kind === "recent") {
      const all = await Promise.all([
        list(connection, fetchImpl, "/issues", "issue", { scope: "assigned_to_me", state: "opened" }),
        list(connection, fetchImpl, "/merge_requests", "merge_request", { scope: "assigned_to_me", state: "opened" }),
        connection.login
          ? list(connection, fetchImpl, "/merge_requests", "merge_request", { scope: "all", state: "opened", reviewer_username: connection.login })
          : Promise.resolve([]),
      ]);
      return rows(connection, all.flat(), connectorLimits.recent);
    }
    if (query.kind === "key")
      return item(connection, fetchImpl, query, false).then(
        (f) => [f],
        (error) => {
          if (notFound(error)) return [];
          throw error;
        },
      );
    const repos = scope.repos.slice(0, 5);
    if (query.kind === "number") {
      const kinds: ItemType[] = query.sep === "!" ? ["merge_request"] : query.sep === "#" ? ["issue"] : ["issue", "merge_request"];
      const refs = repos.flatMap((repo) => kinds.map((k) => ({ itemType: k, key: `${repo}${k === "merge_request" ? "!" : "#"}${query.number}` })));
      return gitlabAdapter.getMany(connection, fetchImpl, refs);
    }
    if (query.kind !== "text") return [];
    const params = { search: query.text, in: "title", per_page: connectorLimits.search };
    const listed =
      repos.length && !scope.all
        ? await mapLimit(repos, 4, (repo) =>
            Promise.all([
              list(connection, fetchImpl, `/projects/${encoded(repo)}/issues`, "issue", params),
              list(connection, fetchImpl, `/projects/${encoded(repo)}/merge_requests`, "merge_request", params),
            ]).then((x) => x.flat()),
          )
        : [
            await Promise.all([
              list(connection, fetchImpl, "/issues", "issue", { ...params, scope: "all" }),
              list(connection, fetchImpl, "/merge_requests", "merge_request", { ...params, scope: "all" }),
            ]).then((x) => x.flat()),
          ];
    return rows(connection, listed.flat(), connectorLimits.search);
  },
  get: item,
  async getMany(connection, fetchImpl, refs) {
    const found = await mapLimit(refs, 4, (ref) =>
      item(connection, fetchImpl, ref, false).catch((error) => {
        if (notFound(error)) return null;
        throw error;
      }),
    );
    return found.filter((f): f is Fetched => !!f);
  },
  fingerprint(full) {
    const { item: x, notes } = full as Full;
    return createHash("sha256")
      .update(JSON.stringify([x.title || "", x.description || "", notes.map((n) => `${n.id}:${n.updated_at || n.created_at}`), x.sha || ""]))
      .digest("hex")
      .slice(0, 16);
  },
  markdown(summary, full, limit) {
    const { item: x, notes, files } = full as Full;
    const names = (users?: User[]) => (users || []).map((u) => u.name || u.username).filter(Boolean).join(", ");
    const mr = summary.itemType === "merge_request";
    const meta = [
      ["Status", summary.status],
      ["Type", summary.type],
      ["Author", x.author?.name || x.author?.username || ""],
      ["Assignees", names(x.assignees) || "Unassigned"],
      ["Reviewers", mr ? names(x.reviewers) : ""],
      ["Labels", (x.labels || []).join(", ")],
      ["Milestone", x.milestone?.title || ""],
      ["Branches", mr && x.source_branch ? `${x.source_branch} → ${x.target_branch || ""}` : ""],
      ["Head", mr ? x.sha || "" : ""],
      ["Changes", mr && x.changes_count ? `${x.changes_count} files` : ""],
      ["Updated", summary.updated],
    ]
      .filter(([, value]) => value)
      .map(([label, value]) => `- ${label}: ${value}`);
    const sections = [`# ${summary.key} ${summary.summary}`, summary.url, "", ...meta, "", "## Description", "", (x.description || "").trim() || "(empty)"];
    if (mr) sections.push("", "To review or continue the code, fetch the source branch with git; Flowly does not include the diff.");
    if (files?.length) sections.push("", `## Changed files (${files.length}${files.length >= connectorLimits.files ? "+" : ""})`, "", ...files.map((f) => `- ${f.path}${f.change === "modified" ? "" : ` (${f.change})`}`));
    if (notes.length) {
      sections.push("", `## Comments (latest ${notes.length})`);
      for (const n of notes) {
        const where = n.position?.new_path ? ` · on ${n.position.new_path}${n.position.new_line ? `:${n.position.new_line}` : ""}` : "";
        sections.push("", `### ${n.author?.name || n.author?.username || "Someone"} · ${n.created_at || ""}${where}`, "", (n.body || "").trim());
      }
    }
    return cut(sections.join("\n"), summary.url, limit);
  },
};
