import { createHash } from "node:crypto";
import {
  browseUrl,
  classifyQuery,
  connectorLimits,
  jqlKeys,
  numberCandidates,
  recentJql,
  textJql,
  type ExternalSummary,
} from "../../shared/connectors";
import { ExternalError, ReadOnlyHttp, cut, type Fetch, type StoredConnection } from "./http";
import type { ConnectorAdapter, Fetched } from "./types";

/** Jira DC and Cloud (EXTERNAL-TRACKER-SPEC): tickets read through the REST v2 API (Cloud searches use v3). */

/** The only endpoints the client may call, all GET (EXTERNAL-TRACKER-SPEC §9). */
const readEndpoints = [
  /^\/rest\/api\/2\/myself$/,
  /^\/rest\/api\/2\/search$/,
  /^\/rest\/api\/3\/search\/jql$/,
  /^\/rest\/api\/2\/issue\/picker$/,
  /^\/rest\/api\/2\/issue\/[A-Z][A-Z0-9_]*-\d+$/,
];

const summaryFields = "summary,status,issuetype,priority,assignee,updated";
const fullFields = `${summaryFields},reporter,created,description,components,fixVersions,labels,subtasks,issuelinks,attachment,parent,comment`;

type JiraFields = {
  summary?: string;
  status?: { name?: string; statusCategory?: { key?: string } };
  issuetype?: { name?: string };
  priority?: { name?: string } | null;
  assignee?: { displayName?: string } | null;
  reporter?: { displayName?: string } | null;
  updated?: string;
  created?: string;
  description?: string | null;
  components?: { name?: string }[];
  fixVersions?: { name?: string }[];
  labels?: string[];
  subtasks?: JiraIssue[];
  parent?: JiraIssue;
  issuelinks?: { type?: { inward?: string; outward?: string }; inwardIssue?: JiraIssue; outwardIssue?: JiraIssue }[];
  attachment?: { filename?: string; size?: number }[];
  comment?: { comments?: { id?: string; author?: { displayName?: string }; body?: string; created?: string; updated?: string }[]; total?: number };
};
export type JiraIssue = { id?: string; key?: string; fields?: JiraFields };

/** Read-only Jira REST client for one connection. */
export class JiraClient {
  readonly http: ReadOnlyHttp;
  constructor(
    readonly connection: StoredConnection,
    fetchImpl: Fetch = fetch,
  ) {
    const auth =
      connection.provider === "jira-cloud"
        ? `Basic ${Buffer.from(`${connection.email}:${connection.secret}`).toString("base64")}`
        : `Bearer ${connection.secret}`;
    this.http = new ReadOnlyHttp({ root: connection.baseUrl, endpoints: readEndpoints, headers: { Authorization: auth }, label: "Jira", fetchImpl });
  }
  async get<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
    return (await this.http.get<T>(path, params)).data;
  }
  myself() {
    return this.get<{ displayName?: string; name?: string; emailAddress?: string }>("/rest/api/2/myself");
  }
  async search(jql: string, max: number): Promise<JiraIssue[]> {
    const params = { jql, maxResults: max, fields: summaryFields };
    const result =
      this.connection.provider === "jira-cloud"
        ? await this.get<{ issues?: JiraIssue[] }>("/rest/api/3/search/jql", params)
        : await this.get<{ issues?: JiraIssue[] }>("/rest/api/2/search", params);
    return result.issues || [];
  }
  async picker(query: string): Promise<string[]> {
    const result = await this.get<{ sections?: { issues?: { key?: string }[] }[] }>("/rest/api/2/issue/picker", {
      query,
      showSubTasks: "true",
      showSubTaskParent: "true",
    });
    const keys: string[] = [];
    for (const section of result.sections || [])
      for (const issue of section.issues || []) if (issue.key && !keys.includes(issue.key)) keys.push(issue.key);
    return keys;
  }
  issue(key: string, full = false) {
    return this.get<JiraIssue>(`/rest/api/2/issue/${key}`, { fields: full ? fullFields : summaryFields });
  }
}

export function jiraSummary(connection: Pick<StoredConnection, "id" | "baseUrl">, issue: JiraIssue): ExternalSummary {
  const f = issue.fields || {};
  const key = issue.key || "";
  return {
    connectionId: connection.id,
    itemType: "issue",
    key,
    remoteId: issue.id || "",
    url: browseUrl(connection.baseUrl, key),
    summary: f.summary || "",
    status: f.status?.name || "",
    statusCategory: f.status?.statusCategory?.key || "",
    type: f.issuetype?.name || "",
    priority: f.priority?.name || "",
    assignee: f.assignee?.displayName || "",
    container: key.split("-")[0] || "",
    updated: f.updated || "",
  };
}

/** What makes a ticket's content change for an agent: not its status or assignee (spec §4.1). */
export function contentFingerprint(issue: JiraIssue) {
  const f = issue.fields || {};
  const comments = (f.comment?.comments || []).map((c) => `${c.id}:${c.updated || c.created}`);
  const subtasks = (f.subtasks || []).map((s) => `${s.key}:${s.fields?.summary || ""}`);
  return createHash("sha256")
    .update(JSON.stringify([f.summary || "", f.description || "", comments, subtasks]))
    .digest("hex")
    .slice(0, 16);
}

/** The ticket as Markdown for agents and the preview (spec §4.2), cut at `limit` bytes. */
export function ticketMarkdown(summary: ExternalSummary, issue: JiraIssue, limit: number = connectorLimits.readBytes) {
  const f = issue.fields || {};
  const names = (list?: { name?: string }[]) => (list || []).map((x) => x.name).filter(Boolean).join(", ");
  const meta = [
    ["Status", summary.status],
    ["Type", summary.type],
    ["Priority", summary.priority],
    ["Assignee", summary.assignee || "Unassigned"],
    ["Reporter", f.reporter?.displayName || ""],
    ["Components", names(f.components)],
    ["Fix versions", names(f.fixVersions)],
    ["Labels", (f.labels || []).join(", ")],
    ["Parent", f.parent?.key ? `${f.parent.key} ${f.parent.fields?.summary || ""}`.trim() : ""],
    ["Updated", summary.updated],
  ]
    .filter(([, value]) => value)
    .map(([label, value]) => `- ${label}: ${value}`);
  const sections = [`# ${summary.key} ${summary.summary}`, summary.url, "", ...meta, "", "## Description", "", wikiToMarkdown(f.description || "") || "(empty)"];
  const subtasks = f.subtasks || [];
  if (subtasks.length)
    sections.push("", "## Subtasks", "", ...subtasks.map((s) => `- ${s.key} ${s.fields?.summary || ""} (${s.fields?.status?.name || ""})`));
  const links = (f.issuelinks || []).flatMap((l) => {
    const other = l.outwardIssue || l.inwardIssue;
    if (!other?.key) return [];
    const relation = l.outwardIssue ? l.type?.outward : l.type?.inward;
    return [`- ${relation || "relates to"} ${other.key} ${other.fields?.summary || ""} (${other.fields?.status?.name || ""})`];
  });
  if (links.length) sections.push("", "## Linked tickets", "", ...links);
  const attachments = (f.attachment || []).map((a) => `- ${a.filename}`);
  if (attachments.length) sections.push("", "## Attachments (names only)", "", ...attachments);
  const all = f.comment?.comments || [];
  const comments = all.slice(-connectorLimits.comments);
  if (comments.length) {
    sections.push("", `## Comments (latest ${comments.length} of ${f.comment?.total ?? all.length})`);
    for (const c of comments) sections.push("", `### ${c.author?.displayName || "Someone"} · ${c.created || ""}`, "", wikiToMarkdown(c.body || ""));
  }
  return cut(sections.join("\n"), summary.url, limit);
}

const notFoundIsEmpty = (error: unknown): JiraIssue[] => {
  if (error instanceof ExternalError && error.code === "EXTERNAL_NOT_FOUND") return [];
  throw error;
};

export const jiraAdapter: ConnectorAdapter = {
  label: "Jira",
  readBytes: connectorLimits.readBytes,
  async verify(connection, fetchImpl) {
    const me = await new JiraClient(connection, fetchImpl).myself();
    return { account: me.displayName || me.name || me.emailAddress || "", login: me.name || "" };
  },
  async search(connection, fetchImpl, raw) {
    const client = new JiraClient(connection, fetchImpl);
    const query = classifyQuery(raw, connection);
    const done = (issues: JiraIssue[]): Fetched[] => issues.filter((i) => i.key).map((issue) => ({ summary: jiraSummary(connection, issue) }));
    if (query.kind === "recent") return done(await client.search(recentJql, connectorLimits.recent));
    if (query.kind === "key") return done(await client.issue(query.key).then((issue) => [issue], notFoundIsEmpty));
    if (query.kind === "number") {
      const recent = await client.search(recentJql, connectorLimits.recent);
      const jql = jqlKeys(numberCandidates(query.number, recent.map((i) => ({ key: i.key || "" }))));
      return done(jql ? await client.search(jql, connectorLimits.search) : []);
    }
    if (query.kind !== "text") return [];
    const keys = await client.picker(query.text).catch((error) => {
      if (error instanceof ExternalError && error.code !== "EXTERNAL_INVALID") throw error;
      return [] as string[];
    });
    const jql = jqlKeys(keys.slice(0, connectorLimits.search));
    const found = jql ? await client.search(jql, connectorLimits.search) : [];
    if (found.length) {
      const order = new Map(keys.map((k, i) => [k, i]));
      return done(found.sort((a, b) => (order.get(a.key || "") ?? 99) - (order.get(b.key || "") ?? 99)));
    }
    return done(await client.search(textJql(query.text), connectorLimits.search));
  },
  async get(connection, fetchImpl, ref, full) {
    const issue = await new JiraClient(connection, fetchImpl).issue(ref.key, full);
    return { summary: jiraSummary(connection, issue), ...(full ? { full: issue } : {}) };
  },
  async getMany(connection, fetchImpl, refs) {
    const jql = jqlKeys(refs.map((r) => r.key));
    if (!jql) return [];
    const issues = await new JiraClient(connection, fetchImpl).search(jql, 50);
    return issues.map((issue) => ({ summary: jiraSummary(connection, issue) }));
  },
  fingerprint: (full) => contentFingerprint(full as JiraIssue),
  markdown: (summary, full, limit) => ticketMarkdown(summary, full as JiraIssue, limit),
};

/**
 * Jira wiki markup (Jira DC and the Cloud v2 API) to Markdown, for agents and
 * the preview. Covers the common blocks and inline marks; anything else stays
 * as written, which is still readable.
 */
export function wikiToMarkdown(source: string): string {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let fence: string | null = null;
  for (const raw of lines) {
    if (fence !== null) {
      const marker = fence === "code" ? "{code}" : "{noformat}";
      const end = raw.indexOf(marker);
      if (end >= 0) {
        if (end > 0) out.push(raw.slice(0, end));
        out.push("```");
        fence = null;
        const rest = raw.slice(end + marker.length).trim();
        if (rest) out.push(inline(rest));
      } else out.push(raw);
      continue;
    }
    const open = /^\s*\{(code|noformat)(?::([^}]*))?\}(.*)$/.exec(raw);
    if (open) {
      const language = open[1] === "code" ? (open[2] || "").split("|")[0]!.replace(/^language=/, "").trim() : "";
      const after = open[3]!;
      const close = after.indexOf(open[1] === "code" ? "{code}" : "{noformat}");
      if (close >= 0) {
        out.push("```" + language, after.slice(0, close), "```");
        continue;
      }
      out.push("```" + language);
      if (after.trim()) out.push(after);
      fence = open[1]!;
      continue;
    }
    const heading = /^h([1-6])\.\s+(.*)$/.exec(raw);
    if (heading) {
      out.push(`${"#".repeat(Number(heading[1]))} ${inline(heading[2]!)}`);
      continue;
    }
    const list = /^([*#-]+)\s+(.*)$/.exec(raw);
    if (list && !/^-{4,}$/.test(raw.trim())) {
      const depth = list[1]!.length - 1;
      const ordered = list[1]!.endsWith("#");
      out.push(`${"  ".repeat(depth)}${ordered ? "1." : "-"} ${inline(list[2]!)}`);
      continue;
    }
    if (/^\s*----\s*$/.test(raw)) {
      out.push("---");
      continue;
    }
    if (/^\s*bq\.\s+/.test(raw)) {
      out.push(`> ${inline(raw.replace(/^\s*bq\.\s+/, ""))}`);
      continue;
    }
    if (/^\s*\|\|/.test(raw)) {
      const cells = raw.trim().replace(/^\|\||\|\|$/g, "").split("||").map((c) => inline(c.trim()));
      out.push(`| ${cells.join(" | ")} |`, `| ${cells.map(() => "---").join(" | ")} |`);
      continue;
    }
    if (/^\s*\|/.test(raw)) {
      const cells = raw.trim().replace(/^\||\|$/g, "").split("|").map((c) => inline(c.trim()));
      out.push(`| ${cells.join(" | ")} |`);
      continue;
    }
    out.push(inline(raw.replace(/\{quote\}/g, "")));
  }
  if (fence !== null) out.push("```");
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function inline(text: string) {
  return text
    .replace(/\{\{([^}]+)\}\}/g, "`$1`")
    .replace(/\[([^|\]]+)\|([^\]]+)\]/g, (_, label: string, href: string) =>
      /^https?:\/\//i.test(href.trim()) ? `[${label.trim()}](${href.trim()})` : `${label.trim()} (${href.trim()})`,
    )
    .replace(/\[(https?:\/\/[^\]\s]+)\]/g, "<$1>")
    .replace(/\[~([^\]]+)\]/g, "@$1")
    .replace(/!([^!\s|]+)(\|[^!]*)?!/g, "[image: $1]")
    .replace(/(^|[\s(])\*(\S(?:[^*]*\S)?)\*(?=$|[\s).,;:!?])/g, "$1**$2**")
    .replace(/(^|[\s(])_(\S(?:[^_]*\S)?)_(?=$|[\s).,;:!?])/g, "$1*$2*")
    .replace(/(^|[\s(])-(\S(?:[^-]*\S)?)-(?=$|[\s).,;:!?])/g, "$1~~$2~~")
    .replace(/\{color(?::[^}]*)?\}/g, "");
}
