import { useContext, useRef } from "react";
import { BoardOutputActive } from "./query-activity";
import { useQuery } from "@tanstack/react-query";
import { useRpc } from "@getpaseo/plugin/client";
import { sessionTail } from "../shared/rpc";
import { parseSessionInline, parseSessionMarkdown } from "./session-markdown";

export const OUTPUT_TAIL_LIMIT = 20;
export const OUTPUT_CONCURRENCY = 3;
export const OUTPUT_MAX_LENGTH = 240;

export type OutputSession = { id: string; updatedAt: string; status?: string };

/** Running sessions update constantly; refetch them at most once per window. */
export const RUNNING_REFRESH_MS = 15_000;
export function outputCacheKey(session: OutputSession) {
  const at = Date.parse(session.updatedAt);
  return session.status === "running" && Number.isFinite(at)
    ? `running:${Math.floor(at / RUNNING_REFRESH_MS)}`
    : session.updatedAt;
}
export type CardOutput = { text: string; at: string };

type SessionCandidate = {
  id: string;
  workspaceId?: string;
  archivedAt?: string | null;
  updatedAt?: string | null;
  lastUserMessageAt?: string | null;
  createdAt?: string | null;
  status?: string;
};

const time = (iso: string | null | undefined) => {
  const at = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(at) ? at : Number.NEGATIVE_INFINITY;
};

/** The workspace's most recently active, non-archived session. */
export function pickOutputSession(
  agents: readonly SessionCandidate[],
  workspaceId: string,
  managed?: ReadonlySet<string>,
): OutputSession | null {
  // When the card has Kanban-managed sessions, summarize those only: other
  // sessions sharing the workspace (e.g. a main checkout) are unrelated chats.
  const live = agents.filter(
    (a) => a.workspaceId === workspaceId && !a.archivedAt && !!a.updatedAt,
  );
  const own = managed ? live.filter((a) => managed.has(a.id)) : [];
  let best: SessionCandidate | null = null;
  for (const agent of own.length ? own : live) {
    if (!best) {
      best = agent;
      continue;
    }
    const order =
      time(agent.updatedAt) - time(best.updatedAt) ||
      time(agent.lastUserMessageAt) - time(best.lastUserMessageAt) ||
      time(agent.createdAt) - time(best.createdAt) ||
      (agent.id > best.id ? 1 : agent.id < best.id ? -1 : 0);
    if (order > 0) best = agent;
  }
  return best
    ? { id: best.id, updatedAt: best.updatedAt!, ...(best.status ? { status: best.status } : {}) }
    : null;
}

const inline = (text: string) =>
  // Images carry no readable progress; drop them instead of leaving "Image" alt text.
  parseSessionInline(text.replace(/!\[[^\]\n]*\]\([^)\n]*\)/g, ""))
    .map((part) => part.text)
    .join("")
    .replace(/~~/g, "");

/** Single-line plain text of an assistant message, without Markdown markers. */
export function plainOutputText(markdown: string, max = OUTPUT_MAX_LENGTH) {
  const prose: string[] = [],
    code: string[] = [];
  for (const block of parseSessionMarkdown(markdown)) {
    if (block.kind === "rule") continue;
    if (block.kind === "code") code.push(block.text);
    else if (block.kind === "table")
      prose.push(
        [block.headers, ...block.rows].map((row) => row.map(inline).join(" ")).join(" "),
      );
    else prose.push(inline(block.text));
  }
  const text = (prose.join(" ").trim() ? prose : code)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** Newest assistant text in a timeline page; other entry kinds are skipped. */
export function latestAgentOutput(
  entries: readonly { timestamp?: string; item: { type: string; text?: unknown } }[],
): CardOutput | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const { item, timestamp } = entries[i];
    if (item.type !== "assistant_message" || typeof item.text !== "string")
      continue;
    const text = plainOutputText(item.text);
    if (text) return { text, at: timestamp || "" };
  }
  return null;
}

const aborted = () => {
  const error = new Error("Aborted");
  error.name = "AbortError";
  return error;
};

/** FIFO limiter; queued work whose signal aborts never starts. */
export function createLimiter(limit: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  const next = () => {
    while (active < limit && queue.length) queue.shift()!();
  };
  return function run<T>(work: () => Promise<T>, signal?: AbortSignal) {
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        signal?.removeEventListener("abort", cancel);
        if (signal?.aborted) return reject(aborted());
        active++;
        work()
          .then(resolve, reject)
          .finally(() => {
            active--;
            next();
          });
      };
      const cancel = () => {
        const index = queue.indexOf(start);
        if (index >= 0) queue.splice(index, 1);
        reject(aborted());
      };
      if (signal?.aborted) return reject(aborted());
      signal?.addEventListener("abort", cancel, { once: true });
      queue.push(start);
      next();
    });
  };
}

const limit = createLimiter(OUTPUT_CONCURRENCY);

/**
 * Latest output of the chosen session; refetches only when its updatedAt
 * changes. Reads the daemon's slim tail (no tool payloads); outputs stay cached
 * for 5 minutes so lane switches and Back do not refetch them.
 */
export function useCardOutput(session: OutputSession | null | undefined, taskId: string) {
  const active = useContext(BoardOutputActive);
  const tail = useRpc(sessionTail);
  const query = useQuery({
    queryKey: ["flowly", "cardOutput", session?.id, session ? outputCacheKey(session) : ""],
    queryFn: ({ signal }) =>
      limit(async () => {
        const response = await tail({ taskId, agentId: session!.id, limit: OUTPUT_TAIL_LIMIT });
        return latestAgentOutput(response.entries);
      }, signal),
    enabled: active && !!session,
    staleTime: Infinity,
    gcTime: 5 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[2] === session?.id ? previous : undefined,
  });
  const last = useRef<{ id: string; output: CardOutput | null } | null>(null);
  if (session && query.isSuccess && !query.isPlaceholderData)
    last.current = { id: session.id, output: query.data };
  if (!session) return null;
  if (query.data !== undefined) return query.data;
  return last.current?.id === session.id ? last.current.output : null;
}
