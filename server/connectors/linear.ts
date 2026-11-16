import { createHash } from "node:crypto";
import { classifyQuery, connectorLimits, linearItemUrl, linearKey, type ExternalSummary } from "../../shared/connectors";
import { ExternalError, ReadOnlyHttp, cut, mapLimit, retryAfter, type Fetch, type StoredConnection } from "./http";
import type { ConnectorAdapter, Fetched, ItemRef } from "./types";
import { withDiscussion } from "./fingerprint";

/** Linear issues (CONNECTORS-SPEC §15), cloud only, GraphQL. */

/** Links live on linear.app/<workspace>; the API is a separate host, so baseUrl never reaches it. */
const API_ROOT = "https://api.linear.app";

/** GraphQL has one endpoint and every request is a POST; `gql` only ever sends the queries below. */
const queryEndpoints = [/^\/graphql$/];

const SUMMARY_FIELDS = `id identifier title url updatedAt priorityLabel state { name type } assignee { name displayName } team { key name }`;

const FULL_FIELDS = `${SUMMARY_FIELDS} description branchName dueDate estimate
  labels(first: 50) { nodes { name } }
  project { name }
  cycle { number name }
  parent { identifier title }
  children(first: 50) { nodes { identifier title state { name } } }
  comments(first: 20, orderBy: createdAt) { nodes { id body createdAt updatedAt user { name displayName } } }`;

const VIEWER = `query FlowlyViewer { viewer { name displayName } organization { urlKey } }`;
const ISSUE = `query FlowlyIssue($id: String!) { issue(id: $id) { ${SUMMARY_FIELDS} } }`;
const ISSUE_FULL = `query FlowlyIssueFull($id: String!) { issue(id: $id) { ${FULL_FIELDS} } }`;
// orderBy updatedAt is newest first; the adapter sorts again so the order never depends on it.
const RECENT = `query FlowlyRecent($first: Int!) { viewer { assignedIssues(first: $first, orderBy: updatedAt, filter: { state: { type: { nin: ["completed", "canceled"] } } }) { nodes { ${SUMMARY_FIELDS} } } } }`;
// The user's words travel as a variable, so nothing they type becomes part of the query.
const TEXT = `query FlowlySearch($term: String!, $first: Int!) { issues(first: $first, orderBy: updatedAt, filter: { title: { containsIgnoreCase: $term } }) { nodes { ${SUMMARY_FIELDS} } } }`;

type Person = { name?: string; displayName?: string };
type State = { name?: string; type?: string };
type Comment = { id?: string; body?: string; createdAt?: string; updatedAt?: string; user?: Person | null };
export type Issue = {
  id?: string;
  identifier?: string;
  title?: string;
  url?: string;
  updatedAt?: string;
  priorityLabel?: string;
  state?: State | null;
  assignee?: Person | null;
  team?: { key?: string; name?: string } | null;
  description?: string | null;
  branchName?: string;
  dueDate?: string | null;
  estimate?: number | null;
  labels?: { nodes?: { name?: string }[] };
  project?: { name?: string } | null;
  cycle?: { number?: number; name?: string | null } | null;
  parent?: { identifier?: string; title?: string } | null;
  children?: { nodes?: { identifier?: string; title?: string; state?: State | null }[] };
  comments?: { nodes?: Comment[] };
};
type Full = { issue: Issue; comments: Comment[] };

type GqlError = { message?: string; extensions?: { code?: string; type?: string } };
type GqlBody<T> = { data?: T | null; errors?: GqlError[] };

const codeOf = (e: GqlError) => `${e.extensions?.code || ""} ${e.extensions?.type || ""}`.toUpperCase();
const isAuth = (e: GqlError) => /AUTHENTICATION|FORBIDDEN/.test(codeOf(e)) || /not authenticated|authentication required/i.test(e.message || "");
const isRateLimit = (e: GqlError) => /RATELIMITED/.test(codeOf(e));
const isNotFound = (e: GqlError) => /entity not found|could not find/i.test(e.message || "");

function errorsOf(body: string): GqlError[] {
  try {
    const parsed = JSON.parse(body) as GqlBody<unknown>;
    return Array.isArray(parsed.errors) ? parsed.errors : [];
  } catch {
    return [];
  }
}

function http(connection: StoredConnection, fetchImpl: Fetch) {
  return new ReadOnlyHttp({
    root: API_ROOT,
    endpoints: [],
    queryEndpoints,
    // A personal API key goes in as is; OAuth tokens would need "Bearer", which Flowly does not use.
    headers: { Authorization: connection.secret },
    label: "Linear",
    fetchImpl,
    failure(response, body) {
      // Linear answers GraphQL problems, a refused key and rate limits included, with HTTP 400 and an errors list.
      const errors = errorsOf(body);
      if (response.status === 429 || errors.some(isRateLimit))
        return new ExternalError("EXTERNAL_UNAVAILABLE", "Linear asked Flowly to slow down (rate limited).", retryAfter(response.headers));
      if (errors.some(isAuth)) return new ExternalError("EXTERNAL_AUTH", "Linear refused the API key. Update the connection in Flowly settings.");
      if (errors.some(isNotFound)) return new ExternalError("EXTERNAL_NOT_FOUND", "Not found, or this account can't see it.");
      const first = errors[0]?.message;
      if (response.status === 400 && first) return new ExternalError("EXTERNAL_INVALID", `Linear rejected the request: ${first.slice(0, 200)}.`);
      return undefined;
    },
  });
}

/** Sends one of this file's read queries; a body that is not a query is refused before it leaves. */
async function gql<T>(connection: StoredConnection, fetchImpl: Fetch, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  if (!/^\s*query\b/.test(query)) throw new ExternalError("EXTERNAL_INVALID", "Refused a Linear request that is not a read-only query.");
  const { data, headers } = await http(connection, fetchImpl).query<GqlBody<T>>("/graphql", { query, variables });
  const errors = data.errors || [];
  // Partial GraphQL failures must not overwrite complete cached content.
  if (errors.length) {
    if (errors.some(isAuth)) throw new ExternalError("EXTERNAL_AUTH", "Linear refused the API key. Update the connection in Flowly settings.");
    if (errors.some(isRateLimit)) throw new ExternalError("EXTERNAL_UNAVAILABLE", "Linear asked Flowly to slow down (rate limited).", retryAfter(headers));
    if (errors.some(isNotFound)) throw new ExternalError("EXTERNAL_NOT_FOUND", "Not found, or this account can't see it.");
    throw new ExternalError("EXTERNAL_INVALID", `Linear rejected the request: ${(errors[0]?.message || "unknown error").slice(0, 200)}.`);
  }
  if (!data.data) throw new ExternalError("EXTERNAL_INVALID", "Linear sent a response Flowly could not read.");
  return data.data;
}

const personName = (p: Person | null | undefined) => p?.displayName || p?.name || "";

/** Linear's workflow state types; triage and backlog have not started. */
function categoryOf(type: string | undefined) {
  if (type === "completed" || type === "canceled") return "done";
  if (type === "started") return "indeterminate";
  return type ? "new" : "";
}

export function linearSummary(connection: Pick<StoredConnection, "id" | "baseUrl">, issue: Issue): ExternalSummary {
  const key = linearKey(issue.identifier || "") || issue.identifier || "";
  return {
    connectionId: connection.id,
    itemType: "issue",
    key,
    remoteId: issue.id || "",
    url: issue.url || linearItemUrl(connection.baseUrl, key),
    summary: issue.title || "",
    status: issue.state?.name || "",
    statusCategory: categoryOf(issue.state?.type),
    type: "Issue",
    priority: issue.priorityLabel && issue.priorityLabel !== "No priority" ? issue.priorityLabel : "",
    assignee: personName(issue.assignee),
    container: issue.team?.name || issue.team?.key || "",
    updated: issue.updatedAt || "",
  };
}

const notFound = (error: unknown) => error instanceof ExternalError && error.code === "EXTERNAL_NOT_FOUND";

async function item(connection: StoredConnection, fetchImpl: Fetch, ref: ItemRef, full: boolean): Promise<Fetched> {
  const key = linearKey(ref.key);
  if (!key) throw new ExternalError("EXTERNAL_INVALID", `"${ref.key}" is not a Linear issue key.`);
  // issue(id:) takes the TEAM-123 identifier as well as the UUID.
  const data = await gql<{ issue: Issue | null }>(connection, fetchImpl, full ? ISSUE_FULL : ISSUE, { id: key });
  if (!data.issue) throw new ExternalError("EXTERNAL_NOT_FOUND", "Not found, or this account can't see it.");
  const summary = linearSummary(connection, data.issue);
  if (!full) return { summary };
  const comments = [...(data.issue.comments?.nodes || [])]
    .sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""))
    .slice(-connectorLimits.comments);
  return { summary, full: { issue: data.issue, comments } satisfies Full };
}

const byUpdated = (a: Issue, b: Issue) => (b.updatedAt || "").localeCompare(a.updatedAt || "");

export const linearAdapter: ConnectorAdapter = {
  label: "Linear",
  readBytes: connectorLimits.readBytes,
  // Whether a new comment advances the issue's own updatedAt is unconfirmed, so full reads decide.
  updatedCoversContent: false,
  async verify(connection, fetchImpl) {
    const address = new URL(connection.baseUrl);
    if (address.origin !== "https://linear.app" || !/^\/[A-Za-z0-9_-]+$/.test(address.pathname))
      throw new ExternalError("EXTERNAL_INVALID", "Enter the Linear workspace address, e.g. https://linear.app/your-workspace.");
    const data = await gql<{ viewer?: Person; organization?: { urlKey?: string } }>(connection, fetchImpl, VIEWER);
    const slug = data.organization?.urlKey || "";
    if (!slug || !(data.viewer?.name || data.viewer?.displayName))
      throw new ExternalError("EXTERNAL_INVALID", "Linear did not return an account and workspace Flowly could verify.");
    const configured = address.pathname.slice(1);
    if (slug !== configured)
      throw new ExternalError("EXTERNAL_INVALID", `This API key belongs to the "${slug}" workspace, but the address says "${configured}". Use https://linear.app/${slug}.`);
    const name = data.viewer?.name || "";
    const login = data.viewer?.displayName || "";
    return { account: name && login && name !== login ? `${name} (@${login})` : name || login, login };
  },
  async search(connection, fetchImpl, raw) {
    const query = classifyQuery(raw, connection);
    if (query.kind === "key")
      return item(connection, fetchImpl, query, false).then(
        (f) => [f],
        (error) => {
          if (notFound(error)) return [];
          throw error;
        },
      );
    if (query.kind === "recent") {
      const data = await gql<{ viewer?: { assignedIssues?: { nodes?: Issue[] } } }>(connection, fetchImpl, RECENT, { first: connectorLimits.search });
      const issues = data.viewer?.assignedIssues?.nodes || [];
      return issues.sort(byUpdated).slice(0, connectorLimits.recent).map((i) => ({ summary: linearSummary(connection, i) }));
    }
    if (query.kind !== "text") return [];
    const data = await gql<{ issues?: { nodes?: Issue[] } }>(connection, fetchImpl, TEXT, { term: query.text, first: connectorLimits.search });
    return (data.issues?.nodes || []).sort(byUpdated).map((i) => ({ summary: linearSummary(connection, i) }));
  },
  get: item,
  async getMany(connection, fetchImpl, refs) {
    // Identifiers cannot be filtered in one query (the id filter takes UUIDs), so one query each, at §5's concurrency.
    const found = await mapLimit(refs, 4, (ref) =>
      item(connection, fetchImpl, ref, false).catch((error) => {
        if (notFound(error)) return null;
        throw error;
      }),
    );
    return found.filter((f): f is Fetched => !!f);
  },
  fingerprint(full) {
    const { issue, comments } = full as Full;
    const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
    const discussion = comments.map((c) => `${c.id}:${c.updatedAt || c.createdAt}`);
    // Sub-issues appear in the Markdown, so adding or renaming one is new content; their status is not.
    const children = (issue.children?.nodes || []).map((c) => `${c.identifier || ""}:${c.title || ""}`);
    return withDiscussion(hash([issue.title || "", issue.description || "", children, discussion]), hash(discussion));
  },
  markdown(summary, full, limit) {
    const { issue, comments } = full as Full;
    const meta = [
      ["Status", summary.status],
      ["Team", summary.container],
      ["Priority", summary.priority],
      ["Assignee", summary.assignee || "Unassigned"],
      ["Labels", (issue.labels?.nodes || []).map((l) => l.name).filter(Boolean).join(", ")],
      ["Project", issue.project?.name || ""],
      ["Cycle", issue.cycle ? issue.cycle.name || (issue.cycle.number != null ? `Cycle ${issue.cycle.number}` : "") : ""],
      ["Parent", issue.parent?.identifier ? `${issue.parent.identifier} ${issue.parent.title || ""}`.trim() : ""],
      ["Estimate", issue.estimate != null ? String(issue.estimate) : ""],
      ["Due", issue.dueDate || ""],
      ["Branch", issue.branchName || ""],
      ["Updated", summary.updated],
    ]
      .filter(([, value]) => value)
      .map(([label, value]) => `- ${label}: ${value}`);
    // Linear descriptions and comments are Markdown already, so nothing is converted.
    const sections = [`# ${summary.key} ${summary.summary}`, summary.url, "", ...meta, "", "## Description", "", (issue.description || "").trim() || "(empty)"];
    const children = issue.children?.nodes || [];
    if (children.length) {
      sections.push("", `## Sub-issues (${children.length})`, "");
      for (const c of children) sections.push(`- ${c.identifier || ""} ${c.title || ""}${c.state?.name ? ` (${c.state.name})` : ""}`);
    }
    if (comments.length) {
      sections.push("", `## Comments (latest ${comments.length})`);
      for (const c of comments) sections.push("", `### ${personName(c.user) || "Someone"} · ${c.createdAt || ""}`, "", (c.body || "").trim());
    }
    return cut(sections.join("\n"), summary.url, limit);
  },
};
