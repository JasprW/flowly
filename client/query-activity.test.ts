import { afterEach, expect, test, vi } from "vitest";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { boardIsActive, drawerNeedsBoard } from "./query-activity";

afterEach(() => vi.restoreAllMocks());

test("compact retained board pauses for drawer, page and task form; wide remains active", () => {
  expect(boardIsActive(true, "", null, false)).toBe(true);
  expect(boardIsActive(true, "t", null, false)).toBe(false);
  expect(boardIsActive(true, "", "ideas", false)).toBe(false);
  expect(boardIsActive(true, "", null, true)).toBe(false);
  expect(boardIsActive(false, "t", "memory", true)).toBe(true);
});

test("an open card polls its own detail in every layout; a compact root pauses under it, a wide root keeps its overview", () => {
  expect(drawerNeedsBoard(true, "")).toBe(true);
  expect(boardIsActive(true, "t", null, false)).toBe(false);
  expect(boardIsActive(false, "t", null, false)).toBe(true);
  expect(drawerNeedsBoard(false, "")).toBe(false);
  expect(drawerNeedsBoard(true, "session")).toBe(false);
});

test("disabled observers neither start nor refetch on invalidation, but explicit fresh reads and re-enable work", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const key = ["visibility-test"];
  let revision = 1;
  const read = vi.fn(async () => ({ revision }));
  const options = (enabled: boolean) => ({ queryKey: key, queryFn: read, enabled, staleTime: 0 });
  const observer = new QueryObserver(client, options(false));
  const unsubscribe = observer.subscribe(() => undefined);
  try {
    await client.invalidateQueries({ queryKey: key });
    expect(read).not.toHaveBeenCalled();
    // Hiding observers must never prevent the route's imperative fresh authorization.
    expect(await client.fetchQuery({ queryKey: key, queryFn: read, staleTime: 0 })).toEqual({ revision: 1 });
    revision = 2;
    observer.setOptions(options(true));
    await vi.waitFor(() => expect(observer.getCurrentResult().data).toEqual({ revision: 2 }));
    observer.setOptions(options(false));
    const count = read.mock.calls.length;
    revision = 3;
    await client.invalidateQueries({ queryKey: key });
    expect(read).toHaveBeenCalledTimes(count);
    observer.setOptions(options(true));
    await vi.waitFor(() => expect(observer.getCurrentResult().data).toEqual({ revision: 3 }));
  } finally { unsubscribe(); client.clear(); }
});
