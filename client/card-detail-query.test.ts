import { expect, test, vi } from "vitest";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import type { PaseoApi } from "@getpaseo/client";
import { detailKey, detailQueryOptions, projectIndexKey } from "./card-detail-query";
import type { CardDetail } from "../shared/card-detail";
import { resolveCardDetailLink } from "./session-link";
import { boardKey } from "./queries";
vi.mock("@getpaseo/plugin/client", () => ({ usePaseo: () => null, useRpc: () => null }));
const link = { taskId: "t", workspaceId: "w", sessionId: "a", requestId: "r" };
const value = { version: 1, revision: 2, task: { id: "t", workspaceId: "w", projectId: "p" }, project: { id: "p" }, events: [], ideas: [], artifacts: [], plans: [], links: [], relatedTasks: [], workpad: null, attentionDismissal: null } as unknown as CardDetail;
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
test("cold requests coalesce within detail scope; warm fresh reads retain etag, never share full/overview/project keys", async () => {
  const c = client(), read = vi.fn(async (i: { etag?: string }) => i.etag ? { etag: "tag" } : { etag: "tag", value });
  const options = detailQueryOptions(c, "host", "t", "w", read);
  const [a, b] = await Promise.all([c.fetchQuery(options), c.fetchQuery(options)]); expect(a).toBe(b); expect(read).toHaveBeenCalledTimes(1);
  expect(await c.fetchQuery(options)).toBe(a); expect(read.mock.calls[1][0].etag).toBe("tag");
  expect(c.getQueryData(boardKey)).toBeUndefined(); expect(projectIndexKey("host", "p")).not.toEqual(detailKey("host", "t", "w"));
  c.setQueryData(options.queryKey, { ...value, revision: 99 }); await c.fetchQuery(options); expect(read.mock.calls[2][0].etag).toBeUndefined();
  c.clear();
});
test("missing full value and mismatched task/workspace/project never return a valid detail", async () => {
  for (const response of [{ etag: "same" }, { etag: "bad", value: { ...value, task: { ...value.task, workspaceId: "other" } } }]) {
    const c = client(); await expect(c.fetchQuery(detailQueryOptions(c, "host", "t", "w", async () => response))).rejects.toThrow(); c.clear();
  }
});
test("native fresh route checks exact actor every time and cannot authorize from a warm display cache", async () => {
  const c = client(), read = vi.fn(async () => ({ etag: "tag", value }));
  const refresh = vi.fn(async () => ({ agent: { id: "a", workspaceId: "w" } }));
  const paseo = { agents: { ref: vi.fn(() => ({ refresh })) } } as unknown as PaseoApi;
  const fresh = () => c.fetchQuery(detailQueryOptions(c, "host", "t", "w", read));
  expect((await resolveCardDetailLink(paseo, fresh, link)).detail).toBe(value);
  refresh.mockResolvedValueOnce({ agent: { id: "other", workspaceId: "w" } }); await expect(resolveCardDetailLink(paseo, fresh, link)).rejects.toThrow("workspace changed");
  read.mockRejectedValueOnce(new Error("offline")); await expect(resolveCardDetailLink(paseo, fresh, link)).rejects.toThrow("offline");
  expect(read).toHaveBeenCalledTimes(3); expect(refresh).toHaveBeenCalledTimes(3); expect(c.getQueryData(boardKey)).toBeUndefined(); c.clear();
});

test("poll-only detail observer is silent while display still sees data and unavailable errors", async () => {
  const c = client();
  const read = vi.fn(async (i: { etag?: string }) => i.etag ? { etag: "tag" } : { etag: "tag", value });
  const ordinary = detailQueryOptions(c, "poll-host", "t", "w", read);
  await c.fetchQuery(ordinary);
  const baseline = new QueryObserver(c, { ...ordinary, enabled: false });
  const baselineNotify = vi.fn(), stopBaseline = baseline.subscribe(baselineNotify);
  await baseline.refetch();
  expect(baselineNotify.mock.calls.length).toBeGreaterThanOrEqual(2);
  stopBaseline(); baseline.destroy();

  const poll = new QueryObserver(c, { ...detailQueryOptions(c, "poll-host", "t", "w", read, true), enabled: false });
  const display = new QueryObserver(c, { ...ordinary, enabled: false, notifyOnChangeProps: ["data", "error"] });
  const pollNotify = vi.fn(), displayNotify = vi.fn();
  const stopPoll = poll.subscribe(pollNotify), stopDisplay = display.subscribe(displayNotify);
  try {
    await poll.refetch();
    expect(pollNotify).not.toHaveBeenCalled(); expect(displayNotify).not.toHaveBeenCalled();
    const changed = { ...value, revision: 3 };
    read.mockResolvedValueOnce({ etag: "next", value: changed });
    await poll.refetch();
    expect(c.getQueryData(ordinary.queryKey)).toEqual(changed);
    expect(displayNotify).toHaveBeenCalledTimes(1); expect(pollNotify).not.toHaveBeenCalled();
    read.mockRejectedValueOnce(new Error("Card detail is unavailable."));
    await poll.refetch();
    expect(display.getCurrentResult().error?.message).toBe("Card detail is unavailable.");
    expect(displayNotify).toHaveBeenCalledTimes(2); expect(pollNotify).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledTimes(5);
  } finally { stopPoll(); stopDisplay(); poll.destroy(); display.destroy(); c.clear(); }
});
