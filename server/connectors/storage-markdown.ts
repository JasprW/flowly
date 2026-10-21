/**
 * Confluence storage format (XHTML with ac:/ri: macros) to Markdown for
 * agents and the preview (CONNECTORS-SPEC §7). A small tolerant parser:
 * unknown tags keep their text, unknown macros keep their body.
 */

type Node = { tag: string; attrs: Record<string, string>; children: Node[] } | { text: string };
const isText = (n: Node): n is { text: string } => "text" in n;

const voidTags = new Set(["br", "hr", "img", "col", "meta", "link", "input", "ri:page", "ri:attachment", "ri:user", "ri:url", "ri:space", "ri:blog-post", "ac:emoticon"]);

const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };
export function decodeEntities(text: string) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
    }
    return entities[name.toLowerCase()] ?? whole;
  });
}

function parse(source: string): Node[] {
  const root: Node = { tag: "#root", attrs: {}, children: [] };
  const stack: Extract<Node, { tag: string }>[] = [root as Extract<Node, { tag: string }>];
  const token = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\/([a-zA-Z][\w:.-]*)\s*>|<([a-zA-Z][\w:.-]*)((?:\s+[\w:.-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+|<)/g;
  let match: RegExpExecArray | null;
  while ((match = token.exec(source))) {
    const top = stack[stack.length - 1]!;
    if (match[1] !== undefined) top.children.push({ text: match[1] });
    else if (match[2]) {
      const name = match[2].toLowerCase();
      const at = stack.map((n) => n.tag).lastIndexOf(name);
      if (at > 0) stack.length = at;
    } else if (match[3]) {
      const name = match[3].toLowerCase();
      const attrs: Record<string, string> = {};
      for (const a of (match[4] || "").matchAll(/([\w:.-]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g))
        attrs[a[1]!.toLowerCase()] = decodeEntities((a[2] || "").replace(/^["']|["']$/g, ""));
      const node = { tag: name, attrs, children: [] as Node[] };
      top.children.push(node);
      if (!match[5] && !voidTags.has(name)) stack.push(node);
    } else if (match[6] !== undefined) top.children.push({ text: decodeEntities(match[6]) });
  }
  return root.children;
}

type Element = Extract<Node, { tag: string }>;
const child = (node: Element, tag: string) => node.children.find((c): c is Element => !isText(c) && c.tag === tag);
const param = (node: Element, name: string) => {
  const p = node.children.find((c): c is Element => !isText(c) && c.tag === "ac:parameter" && c.attrs["ac:name"] === name);
  return p ? plain(p.children) : "";
};
const plain = (nodes: Node[]): string => nodes.map((n) => (isText(n) ? n.text : plain(n.children))).join("");

/** Inline text: newlines collapse to spaces. */
function inline(nodes: Node[]): string {
  return nodes
    .map((n) => {
      if (isText(n)) return n.text.replace(/\s+/g, " ");
      const body = () => inline(n.children);
      switch (n.tag) {
        case "strong":
        case "b":
          return wrap("**", body());
        case "em":
        case "i":
          return wrap("*", body());
        case "s":
        case "del":
          return wrap("~~", body());
        case "code":
          return "`" + plain(n.children) + "`";
        case "br":
          return "\n";
        case "a": {
          const text = body().trim();
          const href = n.attrs.href || "";
          return /^https?:\/\//i.test(href) ? `[${text || href}](${href})` : text;
        }
        case "ac:link": {
          const label = child(n, "ac:link-body") || child(n, "ac:plain-text-link-body");
          const target = n.children.find((c): c is Element => !isText(c) && c.tag.startsWith("ri:"));
          const name = target ? target.attrs["ri:content-title"] || target.attrs["ri:filename"] || target.attrs["ri:username"] || target.attrs["ri:userkey"] || target.attrs["ri:account-id"] || "" : "";
          const text = label ? inline(label.children).trim() : "";
          if (target?.tag === "ri:user") return `@${text || name || "user"}`;
          return text || name;
        }
        case "ac:image": {
          const file = child(n, "ri:attachment")?.attrs["ri:filename"];
          const url = child(n, "ri:url")?.attrs["ri:value"];
          return file ? `[image: ${file}]` : url ? `![image](${url})` : "[image]";
        }
        case "ac:emoticon":
          return "";
        case "time":
          return n.attrs.datetime || body();
        case "ac:structured-macro":
          return inlineMacro(n);
        default:
          return body();
      }
    })
    .join("");
}

const wrap = (mark: string, text: string) => {
  const trimmed = text.trim();
  return trimmed ? `${mark}${trimmed}${mark}` : "";
};

function inlineMacro(n: Element) {
  const name = n.attrs["ac:name"] || "";
  if (name === "jira") return `[Jira: ${param(n, "key") || param(n, "jqlQuery") || "issues"}]`;
  if (name === "status") return `[${param(n, "title") || "status"}]`;
  const rich = child(n, "ac:rich-text-body");
  if (rich) return inline(rich.children);
  return "";
}

const blockTags = new Set(["p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "table", "blockquote", "pre", "hr", "ac:structured-macro", "ac:task-list", "ac:layout", "ac:layout-section", "ac:layout-cell", "section", "tbody", "thead"]);

/** Block content: paragraphs separated by blank lines. */
function blocks(nodes: Node[], depth = 0): string {
  const out: string[] = [];
  let run: Node[] = [];
  const flush = () => {
    const text = inline(run).trim();
    if (text) out.push(text);
    run = [];
  };
  for (const n of nodes) {
    if (isText(n) || !blockTags.has(n.tag)) {
      run.push(n);
      continue;
    }
    flush();
    const block = renderBlock(n, depth);
    if (block.trim()) out.push(block);
  }
  flush();
  return out.join("\n\n");
}

function renderBlock(n: Element, depth: number): string {
  const heading = /^h([1-6])$/.exec(n.tag);
  if (heading) return `${"#".repeat(Number(heading[1]))} ${inline(n.children).trim()}`;
  switch (n.tag) {
    case "p":
      return inline(n.children).trim();
    case "hr":
      return "---";
    case "blockquote":
      return quote(blocks(n.children, depth));
    case "pre":
      return "```\n" + plain(n.children).replace(/\n$/, "") + "\n```";
    case "ul":
    case "ol":
      return list(n, depth);
    case "table":
      return table(n);
    case "ac:task-list":
      return n.children
        .filter((c): c is Element => !isText(c) && c.tag === "ac:task")
        .map((task) => `- [${plain(child(task, "ac:task-status")?.children || []).trim() === "complete" ? "x" : " "}] ${inline(child(task, "ac:task-body")?.children || []).trim()}`)
        .join("\n");
    case "ac:structured-macro":
      return macro(n, depth);
    default:
      return blocks(n.children, depth);
  }
}

function macro(n: Element, depth: number) {
  const name = n.attrs["ac:name"] || "";
  if (name === "code" || name === "noformat") {
    const body = child(n, "ac:plain-text-body");
    return "```" + (param(n, "language") || "") + "\n" + plain(body?.children || []).replace(/\n$/, "") + "\n```";
  }
  if (["info", "note", "warning", "tip", "panel"].includes(name)) {
    const title = param(n, "title");
    const body = blocks(child(n, "ac:rich-text-body")?.children || [], depth);
    const label = name === "panel" ? "" : `**${name[0]!.toUpperCase()}${name.slice(1)}:** `;
    return quote(`${label}${title ? `**${title}** ` : ""}${body}`.trim());
  }
  if (["toc", "children", "pagetree", "recently-updated", "contentbylabel", "attachments", "anchor"].includes(name)) return "";
  const rich = child(n, "ac:rich-text-body");
  if (rich) return blocks(rich.children, depth);
  const plainBody = child(n, "ac:plain-text-body");
  if (plainBody) return "```\n" + plain(plainBody.children).replace(/\n$/, "") + "\n```";
  return inlineMacro(n);
}

function list(n: Element, depth: number): string {
  const ordered = n.tag === "ol";
  const indent = "  ".repeat(depth);
  return n.children
    .filter((c): c is Element => !isText(c) && c.tag === "li")
    .map((li) => {
      const nested = li.children.filter((c) => !isText(c) && (c.tag === "ul" || c.tag === "ol")) as Element[];
      const own = blocks(li.children.filter((c) => isText(c) || (c.tag !== "ul" && c.tag !== "ol")), depth + 1).replace(/\n+/g, " ").trim();
      const lines = [`${indent}${ordered ? "1." : "-"} ${own}`];
      for (const sub of nested) lines.push(list(sub, depth + 1));
      return lines.join("\n");
    })
    .join("\n");
}

function table(n: Element): string {
  const rows: Element[] = [];
  const collect = (node: Element) => {
    for (const c of node.children) if (!isText(c)) c.tag === "tr" ? rows.push(c) : collect(c);
  };
  collect(n);
  const cells = rows.map((r) =>
    r.children
      .filter((c): c is Element => !isText(c) && (c.tag === "td" || c.tag === "th"))
      .map((c) => blocks(c.children).replace(/\n+/g, " ").replace(/\|/g, "\\|").trim()),
  );
  const width = Math.max(0, ...cells.map((r) => r.length));
  if (!width) return "";
  const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => r[i] || "").join(" | ")} |`;
  return [line(cells[0]!), `| ${Array.from({ length: width }, () => "---").join(" | ")} |`, ...cells.slice(1).map(line)].join("\n");
}

const quote = (text: string) =>
  text
    .split("\n")
    .map((l) => (l ? `> ${l}` : ">"))
    .join("\n");

export function storageToMarkdown(source: string): string {
  return blocks(parse(source))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
