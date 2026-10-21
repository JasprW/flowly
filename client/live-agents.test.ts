import { expect, test } from "vitest";
import type { PaseoAgent, PaseoAgentUpdate } from "@getpaseo/client";
import { applyLiveUpdate, relevantChange } from "./live-agents";

const agent = (id: string, extra: Record<string, unknown> = {}) =>
  ({ id, workspaceId: "w1", status: "idle", updatedAt: "2026-10-21T00:00:01.000Z", archivedAt: null, labels: {}, pendingPermissions: [], attentionReason: null, lastUserMessageAt: null, ...extra }) as unknown as PaseoAgent;
const upsert = (a: PaseoAgent): PaseoAgentUpdate => ({ kind: "upsert", agent: a }) as PaseoAgentUpdate;

test("pushed updates keep the live map: add, replace, and ignore an older copy", () => {
  const map = new Map<string, PaseoAgent>();
  expect(applyLiveUpdate(map, upsert(agent("a1")))).toMatchObject({ changed: true, before: null });
  const newer = agent("a1", { status: "running", updatedAt: "2026-10-21T00:00:05.000Z" });
  expect(applyLiveUpdate(map, upsert(newer))).toMatchObject({ changed: true });
  expect(map.get("a1")?.status).toBe("running");
  // A poll or a late event that is older than what is held never goes back in time.
  expect(applyLiveUpdate(map, upsert(agent("a1", { status: "idle", updatedAt: "2026-10-21T00:00:02.000Z" })))).toMatchObject({ changed: false });
  expect(map.get("a1")?.status).toBe("running");
});

test("archived agents, summarizer leftovers and removals leave the live map", () => {
  const map = new Map<string, PaseoAgent>([["a1", agent("a1")], ["a2", agent("a2")]]);
  expect(applyLiveUpdate(map, upsert(agent("a1", { archivedAt: "2026-10-21T01:00:00.000Z", updatedAt: "2026-10-21T00:00:09.000Z" })))).toMatchObject({ changed: true, after: null });
  expect(map.has("a1")).toBe(false);
  expect(applyLiveUpdate(map, { kind: "remove", agentId: "a2" } as PaseoAgentUpdate)).toMatchObject({ changed: true });
  expect(map.size).toBe(0);
  expect(applyLiveUpdate(map, upsert(agent("s1", { labels: { flowly: "summarizer" } })))).toMatchObject({ changed: false });
  expect(map.size).toBe(0);
  expect(applyLiveUpdate(map, { kind: "remove", agentId: "gone" } as PaseoAgentUpdate)).toMatchObject({ changed: false });
});

test("only changes that decide a card's currency ask for a refresh; title and usage churn do not", () => {
  const base = agent("a1");
  expect(relevantChange(null, base)).toBe(true);
  expect(relevantChange(base, null)).toBe(true);
  expect(relevantChange(base, agent("a1", { status: "running" }))).toBe(true);
  expect(relevantChange(base, agent("a1", { lastUserMessageAt: "2026-10-21T00:00:09.000Z" }))).toBe(true);
  expect(relevantChange(base, agent("a1", { pendingPermissions: [{}] }))).toBe(true);
  expect(relevantChange(base, agent("a1", { attentionReason: "permission" }))).toBe(true);
  expect(relevantChange(base, agent("a1", { workspaceId: "w2" }))).toBe(true);
  expect(relevantChange(base, agent("a1", { title: "renamed", lastUsage: { inputTokens: 5 }, updatedAt: "2026-10-21T00:00:09.000Z" }))).toBe(false);
});
