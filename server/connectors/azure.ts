import { createHash } from "node:crypto";
import { azureItemUrl, azureKey, classifyQuery, connectorLimits, type ExternalSummary } from "../../shared/connectors";
import { ExternalError, ReadOnlyHttp, cut, type Fetch, type StoredConnection } from "./http";
import { storageToMarkdown } from "./storage-markdown";
import { withDiscussion } from "./fingerprint";
import type { ConnectorAdapter, Fetched, ItemRef } from "./types";

/** Azure DevOps work items (CONNECTORS-SPEC §13): Azure DevOps Services and Server, REST, personal access token. */

const readEndpoints = [/^\/_apis\/connectionData$/, /^\/_apis\/wit\/workitems$/, /^\/_apis\/wit\/workitems\/\d+$/, /^\/[^/]+\/_apis\/wit\/workitems\/\d+\/comments$/i];
/** WIQL takes its (read-only) query in a POST body. */
const queryEndpoints = [/^\/_apis\/wit\/wiql$/];

const summaryFields = ["System.Title", "System.State", "System.WorkItemType", "System.AssignedTo", "System.TeamProject", "System.ChangedDate", "Microsoft.VSTS.Common.Priority"].join(",");
/** Where work items end: not shown in "my recent". */
const closedStates = ["Closed", "Done", "Removed", "Completed", "Resolved"];

type Person = string | { displayName?: string; uniqueName?: string } | null | undefined;
type Fields = Record<string, unknown>;
export type AzureItem = { id?: number; rev?: number; fields?: Fields; _links?: { html?: { href?: string } } };
type Comment = { id?: number; text?: string; createdBy?: { displayName?: string }; createdDate?: string; modifiedDate?: string };
type Full = { item: AzureItem; comments: Comment[] };

/** Azure DevOps Services (the cloud) takes the current API; Server editions get the oldest version they all know. */
const hosted = (baseUrl: string) => {
  const host = new URL(baseUrl).hostname.toLowerCase();
  return host === "dev.azure.com" || host.endsWith(".visualstudio.com");
};
const apiVersion = (baseUrl: string) => (hosted(baseUrl) ? "7.1" : "5.0");

function http(connection: StoredConnection, fetchImpl: Fetch) {
  return new ReadOnlyHttp({
    root: connection.baseUrl,
    endpoints: readEndpoints,
    queryEndpoints,
    // A personal access token is the password of a Basic login with an empty user name.
    headers: { Authorization: `Basic ${Buffer.from(`:${connection.secret}`).toString("base64")}` },
    label: "Azure DevOps",
    fetchImpl,
    failure(response, _body, path) {
      // A work item or project this account can't see answers 403 (or 404); only connectionData says the token is refused.
      if (response.status === 403 && path !== "/_apis/connectionData") return new ExternalError("EXTERNAL_NOT_FOUND", "Not found, or this account can't see it.");
      return undefined;
    },
  });
}

const text = (value: unknown) => (typeof value === "string" ? value : "");
const personName = (person: Person) => (typeof person === "string" ? person.replace(/\s*<[^>]*>\s*$/, "") : person?.displayName || person?.uniqueName || "");

const category = (state: string) => {
  if (/^(new|to ?do|proposed|open|approved)$/i.test(state)) return "new";
  if (/^(closed|done|removed|completed|resolved|cut)$/i.test(state)) return "done";
  return state ? "indeterminate" : "";
};

export function azureSummary(connection: Pick<StoredConnection, "id" | "baseUrl">, item: AzureItem): ExternalSummary {
  const f = item.fields || {};
  const key = azureKey(String(item.id ?? ""));
  const state = text(f["System.State"]);
  const priority = f["Microsoft.VSTS.Common.Priority"];
  return {
    connectionId: connection.id,
    itemType: "issue",
    key,
    remoteId: String(item.id ?? ""),
    url: item._links?.html?.href || azureItemUrl(connection.baseUrl, key),
    summary: text(f["System.Title"]),
    status: state,
    statusCategory: category(state),
    type: text(f["System.WorkItemType"]),
    priority: typeof priority === "number" ? String(priority) : "",
    assignee: personName(f["System.AssignedTo"] as Person),
    container: text(f["System.TeamProject"]),
    updated: text(f["System.ChangedDate"]),
  };
}

const idOf = (key: string) => /^AB#(\d+)$/i.exec(key)?.[1];
const notFound = (error: unknown) => error instanceof ExternalError && error.code === "EXTERNAL_NOT_FOUND";

async function item(connection: StoredConnection, fetchImpl: Fetch, ref: ItemRef, full: boolean): Promise<Fetched> {
  const id = idOf(ref.key);
  if (!id) throw new ExternalError("EXTERNAL_INVALID", `"${ref.key}" is not an Azure DevOps work item key (AB#123).`);
  const client = http(connection, fetchImpl);
  const version = apiVersion(connection.baseUrl);
  const { data } = await client.get<AzureItem>(`/_apis/wit/workitems/${id}`, { "api-version": version });
  const summary = azureSummary(connection, data);
  if (!full) return { summary };
  const project = text(data.fields?.["System.TeamProject"]);
  const comments = project
    ? await client
        .get<{ comments?: Comment[] }>(`/${encodeURIComponent(project)}/_apis/wit/workItems/${id}/comments`, {
          "api-version": hosted(connection.baseUrl) ? "7.1-preview.4" : "5.1-preview.3",
          ...(hosted(connection.baseUrl) ? { order: "desc", $top: connectorLimits.comments } : {}),
        })
        .then((r) => r.data.comments || [])
    : [];
  const latest = comments
    .sort((a, b) => (a.createdDate || "").localeCompare(b.createdDate || ""))
    .slice(-connectorLimits.comments);
  return { summary, full: { item: data, comments: latest } satisfies Full };
}

/** Work item summaries for ids, in the order given; invisible items are left out. */
async function byIds(connection: StoredConnection, fetchImpl: Fetch, ids: readonly string[]): Promise<Fetched[]> {
  if (!ids.length) return [];
  const { data } = await http(connection, fetchImpl).get<{ value?: AzureItem[] }>("/_apis/wit/workitems", {
    ids: ids.slice(0, 200).join(","),
    fields: summaryFields,
    errorPolicy: "omit",
    "api-version": apiVersion(connection.baseUrl),
  });
  const found = new Map((data.value || []).filter((i) => i && i.id).map((i) => [String(i.id), i]));
  return ids.flatMap((id) => (found.has(id) ? [{ summary: azureSummary(connection, found.get(id)!) }] : []));
}

/** A WIQL string literal holding user text: quotes doubled, control characters dropped. */
const literal = (value: string) => `'${value.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, connectorLimits.query).replace(/'/g, "''")}'`;

async function wiql(connection: StoredConnection, fetchImpl: Fetch, query: string, top: number): Promise<Fetched[]> {
  const { data } = await http(connection, fetchImpl).query<{ workItems?: { id?: number }[] }>(
    "/_apis/wit/wiql",
    { query },
    { $top: top, "api-version": apiVersion(connection.baseUrl) },
  );
  return byIds(
    connection,
    fetchImpl,
    (data.workItems || []).flatMap((w) => (w.id ? [String(w.id)] : [])),
  );
}

const recentQuery = `SELECT [System.Id] FROM WorkItems WHERE [System.AssignedTo] = @Me AND [System.State] NOT IN (${closedStates.map(literal).join(", ")}) ORDER BY [System.ChangedDate] DESC`;
const textQuery = (words: string) => `SELECT [System.Id] FROM WorkItems WHERE [System.Title] CONTAINS ${literal(words)} ORDER BY [System.ChangedDate] DESC`;

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);

export const azureAdapter: ConnectorAdapter = {
  label: "Azure DevOps",
  readBytes: connectorLimits.readBytes,
  // Adding a comment does not always move ChangedDate; read the comments again for fingerprints.
  updatedCoversContent: false,
  async verify(connection, fetchImpl) {
    const { data } = await http(connection, fetchImpl).get<{ authenticatedUser?: { providerDisplayName?: string; properties?: { Account?: { $value?: string } } } }>("/_apis/connectionData", {
      "api-version": "5.0-preview",
    });
    const user = data.authenticatedUser;
    const login = user?.properties?.Account?.$value || "";
    const name = user?.providerDisplayName || "";
    return { account: name && login && name !== login ? `${name} (${login})` : name || login, login };
  },
  async search(connection, fetchImpl, raw) {
    const query = classifyQuery(raw, connection);
    if (query.kind === "recent") return wiql(connection, fetchImpl, recentQuery, connectorLimits.recent);
    if (query.kind === "key")
      return item(connection, fetchImpl, query, false).then(
        (f) => [f],
        (error) => {
          if (notFound(error)) return [];
          throw error;
        },
      );
    if (query.kind !== "text") return [];
    return wiql(connection, fetchImpl, textQuery(query.text), connectorLimits.search);
  },
  get: item,
  async getMany(connection, fetchImpl, refs) {
    return byIds(
      connection,
      fetchImpl,
      refs.flatMap((r) => idOf(r.key) || []),
    );
  },
  fingerprint(full) {
    const { item: x, comments } = full as Full;
    const f = x.fields || {};
    const discussion = comments.map((c) => `${c.id}:${c.modifiedDate || c.createdDate}`);
    return withDiscussion(hash([text(f["System.Title"]), text(f["System.Description"]), text(f["Microsoft.VSTS.TCM.ReproSteps"]), text(f["Microsoft.VSTS.Common.AcceptanceCriteria"]), discussion]), hash(discussion));
  },
  markdown(summary, full, limit) {
    const { item: x, comments } = full as Full;
    const f = x.fields || {};
    const meta = [
      ["State", summary.status],
      ["Type", summary.type],
      ["Assigned to", personName(f["System.AssignedTo"] as Person) || "Unassigned"],
      ["Created by", personName(f["System.CreatedBy"] as Person)],
      ["Priority", summary.priority],
      ["Project", summary.container],
      ["Area", text(f["System.AreaPath"])],
      ["Iteration", text(f["System.IterationPath"])],
      ["Tags", text(f["System.Tags"])],
      ["Parent", f["System.Parent"] ? azureKey(String(f["System.Parent"])) : ""],
      ["Updated", summary.updated],
    ]
      .filter(([, value]) => value)
      .map(([label, value]) => `- ${label}: ${value}`);
    const sections = [`# ${summary.key} ${summary.summary}`, summary.url, "", ...meta];
    const body = (title: string, html: string) => {
      const markdown = storageToMarkdown(html);
      if (markdown) sections.push("", `## ${title}`, "", markdown);
    };
    body("Description", text(f["System.Description"]));
    body("Repro steps", text(f["Microsoft.VSTS.TCM.ReproSteps"]));
    body("Acceptance criteria", text(f["Microsoft.VSTS.Common.AcceptanceCriteria"]));
    if (sections.length === 3 + meta.length) sections.push("", "## Description", "", "(empty)");
    if (comments.length) {
      sections.push("", `## Comments (latest ${comments.length})`);
      for (const c of comments) sections.push("", `### ${c.createdBy?.displayName || "Someone"} · ${c.createdDate || ""}`, "", storageToMarkdown(c.text || ""));
    }
    return cut(sections.join("\n"), summary.url, limit);
  },
};
