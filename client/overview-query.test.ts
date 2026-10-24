import { expect, test, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { boardSchema } from "../shared/model";
import { boardOverview, OverviewDeltas } from "../server/board-overview";
import { boardKey, boardQueryOptions, overviewQueryOptions } from "./queries";
import { readOverviewDelta, overviewKey, preferOverviewMetadata, projectOpenIdeaCount } from "./overview-query";

vi.mock("@getpaseo/plugin/client", () => ({ usePaseo: () => null, useRpc: () => null }));
const full = () => boardSchema.parse({ events: [], version: 5, revision: 1, projects: [], tasks: [] });
const view = () => boardOverview(full());

test("overview and fresh full reader use different keys and never join each other's in-flight request", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  let finish!: (value: { etag: string; value: ReturnType<typeof view> }) => void;
  const overviewRead = vi.fn(() => new Promise<{ etag: string; value: ReturnType<typeof view> }>(resolve => { finish = resolve; }));
  const completeRead = vi.fn(async () => ({ etag: "complete", value: full() }));
  const pending = client.fetchQuery(overviewQueryOptions(client, "h", overviewRead));
  expect(await client.fetchQuery(boardQueryOptions(client, completeRead))).toEqual(full());
  expect(completeRead).toHaveBeenCalledTimes(1);
  expect(client.getQueryData(boardKey)).toEqual(full());
  expect(client.getQueryData(overviewKey("h"))).toBeUndefined();
  finish({ etag: "overview-v1:first", value: view() });
  await pending;
  expect(client.getQueryData(boardKey)).toEqual(full());
  expect(client.getQueryData(overviewKey("h"))).toEqual(view());
  expect(overviewKey("h2")).not.toEqual(overviewKey("h"));
  client.clear();
});

test("missing or wrong patch baseline rereads overview once without an etag", async () => {
  const read = vi.fn(async (input: { etag?: string }) => input.etag ? { etag: "new", patch: { baseEtag: "wrong", revision: 2 } } : { etag: "new", value: view() });
  expect((await readOverviewDelta(read, view(), "old")).value).toEqual(view());
  expect(read.mock.calls.map(([input]) => input)).toEqual([{ etag: "old" }, {}]);
  const broken = vi.fn(async () => ({ etag: "new", patch: { baseEtag: "wrong", revision: 2 } }));
  await expect(readOverviewDelta(broken, undefined, "old")).rejects.toThrow("Missing overview");
  expect(broken).toHaveBeenCalledTimes(2);
});

test("malformed order triggers a scoped reread, not a partially lost task list", async () => {
  const initial = { ...view(), projects: [{ id: "p" }] } as ReturnType<typeof view>;
  const read = vi.fn(async (input: { etag?: string }) => input.etag ? { etag: "new", patch: { baseEtag: "old", revision: 2, projects: { set: [], remove: [], order: [] } } } : { etag: "new", value: view() });
  expect((await readOverviewDelta(read, initial, "old")).value).toEqual(view());
  expect(read).toHaveBeenCalledTimes(2);
});

test("etag reuse, foreign cache replacement and concurrent same-scope requests stay local", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const deltas = new OverviewDeltas();
  const read = vi.fn(async (input: { etag?: string }) => deltas.read(view(), input));
  const options = overviewQueryOptions(client, "h", read);
  await Promise.all([client.fetchQuery(options), client.fetchQuery(options)]);
  expect(read).toHaveBeenCalledTimes(1);
  const held = client.getQueryData(overviewKey("h"));
  await client.fetchQuery(options);
  expect(read.mock.calls[1][0].etag).toMatch(/^overview-v1:/);
  expect(client.getQueryData(overviewKey("h"))).toBe(held);
  client.setQueryData(overviewKey("h"), { ...view(), revision: 99 });
  await client.fetchQuery(options);
  expect(read.mock.calls.at(-1)?.[0]).toEqual({});
  expect(client.getQueryData(boardKey)).toBeUndefined();
  client.clear();
});

test("newer complete deletion wins metadata without promoting overview to full data", () => {
  const old = view(), deleted = { ...full(), revision: 2 };
  expect(preferOverviewMetadata(old, deleted)).toBe(deleted);
  expect(preferOverviewMetadata({ ...old, revision: 3 }, deleted)).not.toHaveProperty("events");
});

test("warm complete metadata keeps the project Ideas count after switching to compact", () => {
  const complete = { ...full(), tasks: [{ id: "t", projectId: "p" }], ideas: [
    { id: "1", projectId: "p", taskId: "t", status: "open" },
    { id: "2", projectId: "p", taskId: "t", status: "open" },
    { id: "3", projectId: "p", taskId: "t", status: "accepted" },
    { id: "4", projectId: "other", taskId: "x", status: "open" },
  ] } as unknown as ReturnType<typeof full>;
  const overview = { ...view(), tasks: complete.tasks, cards: [{ taskId: "t", openIdeas: 2 }] } as ReturnType<typeof view>;
  expect(projectOpenIdeaCount(overview, "p")).toBe(2);
  expect(preferOverviewMetadata(overview, complete)).toBe(complete);
  expect(projectOpenIdeaCount(preferOverviewMetadata(overview, complete), "p")).toBe(2);
  expect(projectOpenIdeaCount(preferOverviewMetadata(overview, { ...complete, revision: 2, ideas: [] }), "p")).toBe(0);
  expect(projectOpenIdeaCount(undefined, "p")).toBe(0);
});
