import { afterEach, expect, test, vi } from "vitest";
import type { QueryClient, QueryObserverOptions } from "@tanstack/react-query";

// QueryObserver needs a client environment to exercise actual polling timers.
const harness = vi.hoisted(() => {
  vi.stubGlobal("window", {});
  return { read: vi.fn(), client: null as unknown as QueryClient, options: {} as QueryObserverOptions };
});
vi.mock("@getpaseo/plugin/client", () => ({ usePaseo: () => null, useRpc: () => harness.read }));
vi.mock("@tanstack/react-query", async original => ({ ...await original<typeof import("@tanstack/react-query")>(),
  useQueryClient: () => harness.client,
  useQuery: (options: unknown) => { harness.options = options as QueryObserverOptions; return {}; },
}));
import { QueryClient as Client, QueryObserver } from "@tanstack/react-query";
import { guardrailCountsKey, useGuardrailCountsQuery } from "./queries";
import { invalidateCardViews } from "./card-detail-query";

afterEach(() => { harness.client?.clear(); vi.useRealTimers(); vi.unstubAllGlobals(); });
function setup(pushLive: boolean, enabled = true) {
  vi.useFakeTimers();
  harness.client = new Client({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  let notes = 1;
  harness.read.mockReset().mockImplementation(async () => ({ etag: `n${notes}`, value: { p: { observing: 0, added: 0, notes } } }));
  const options = (live: boolean, on = true) => {
    useGuardrailCountsQuery(on, live);
    return { ...harness.options, refetchIntervalInBackground: true };
  };
  const observer = new QueryObserver(harness.client, options(pushLive, enabled));
  const stop = observer.subscribe(() => undefined);
  return { observer, options, stop, setNotes: (n: number) => { notes = n; } };
}

test("Memory counts: live idle 180s has zero timed reads; pushes refresh external add/archive; hidden stays silent", async () => {
  const x = setup(true);
  try {
    await vi.advanceTimersByTimeAsync(1);
    expect(harness.read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(180_000);
    expect(harness.read).toHaveBeenCalledTimes(1);
    x.setNotes(2);
    await invalidateCardViews(harness.client);
    expect(harness.client.getQueryData(guardrailCountsKey)).toEqual({ p: { observing: 0, added: 0, notes: 2 } });
    x.setNotes(1);
    await invalidateCardViews(harness.client);
    expect(harness.read).toHaveBeenCalledTimes(3);
    expect(harness.client.getQueryData(guardrailCountsKey)).toEqual({ p: { observing: 0, added: 0, notes: 1 } });
    x.observer.setOptions(x.options(true, false));
    await invalidateCardViews(harness.client);
    await vi.advanceTimersByTimeAsync(180_000);
    expect(harness.read).toHaveBeenCalledTimes(3);
    x.observer.setOptions(x.options(true));
    await vi.advanceTimersByTimeAsync(1);
    expect(harness.read).toHaveBeenCalledTimes(4);
  } finally { x.stop(); x.observer.destroy(); }
});

test("Memory counts: old host/connecting/disconnected keeps 60s polls, reconnect stops them", async () => {
  const x = setup(false);
  try {
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(harness.read).toHaveBeenCalledTimes(2);
    x.observer.setOptions(x.options(true));
    await vi.advanceTimersByTimeAsync(180_000);
    expect(harness.read).toHaveBeenCalledTimes(2);
    x.observer.setOptions(x.options(false));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(harness.read).toHaveBeenCalledTimes(3);
    x.observer.setOptions(x.options(true));
    await invalidateCardViews(harness.client);
    await vi.advanceTimersByTimeAsync(180_000);
    expect(harness.read).toHaveBeenCalledTimes(4);
  } finally { x.stop(); x.observer.destroy(); }
});

test("Memory counts: failed read recovers even with healthy push and no new event; success and unmount stop retries", async () => {
  const x = setup(true);
  try {
    await vi.advanceTimersByTimeAsync(1);
    harness.read.mockRejectedValueOnce(new Error("offline"));
    await invalidateCardViews(harness.client);
    expect(x.observer.getCurrentResult().isError).toBe(true);
    x.setNotes(3);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(x.observer.getCurrentResult().isError).toBe(false);
    expect(harness.read).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(180_000);
    expect(harness.read).toHaveBeenCalledTimes(3);
    harness.read.mockRejectedValueOnce(new Error("offline"));
    await invalidateCardViews(harness.client);
    x.stop();
    await vi.advanceTimersByTimeAsync(180_000);
    expect(harness.read).toHaveBeenCalledTimes(4);
  } finally { x.stop(); x.observer.destroy(); }
});


test("a push during the first count read starts a fresh read and keeps the new count", async () => {
  vi.useFakeTimers();
  harness.client = new Client({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const oldValue = { p: { observing: 0, added: 0, notes: 1 } };
  const newValue = { p: { observing: 0, added: 0, notes: 2 } };
  let release!: (v: { etag: string; value: typeof oldValue }) => void;
  const oldResponse = new Promise<{ etag: string; value: typeof oldValue }>(resolve => { release = resolve; });
  harness.read.mockReset().mockImplementationOnce(() => oldResponse).mockResolvedValue({ etag: "new", value: newValue });
  useGuardrailCountsQuery(true, true);
  const observer = new QueryObserver(harness.client, harness.options);
  const stop = observer.subscribe(() => undefined);
  try {
    expect(harness.read).toHaveBeenCalledTimes(1);
    // A committed Memory write pushed after the server computed the first response.
    const pushed = invalidateCardViews(harness.client);
    await Promise.resolve();
    release({ etag: "old", value: oldValue });
    await pushed;
    expect(harness.read).toHaveBeenCalledTimes(2);
    expect(harness.client.getQueryData(guardrailCountsKey)).toEqual(newValue);
    await vi.advanceTimersByTimeAsync(180_000);
    expect(harness.read).toHaveBeenCalledTimes(2);
    expect(harness.client.getQueryData(guardrailCountsKey)).toEqual(newValue);
  } finally { release({ etag: "old", value: oldValue }); stop(); observer.destroy(); }
});


test("live counts refresh on quick re-entry without a hidden push, but not on rerender or idle", async () => {
  const x = setup(true);
  try {
    await vi.advanceTimersByTimeAsync(1);
    expect(harness.read).toHaveBeenCalledTimes(1);
    x.observer.setOptions(x.options(true, false));
    // The seven-day window can expire without a write or pushed invalidation.
    x.setNotes(0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(harness.read).toHaveBeenCalledTimes(1);
    x.observer.setOptions(x.options(true));
    await vi.advanceTimersByTimeAsync(1);
    expect(harness.read).toHaveBeenCalledTimes(2);
    expect(harness.client.getQueryData(guardrailCountsKey)).toEqual({ p: { observing: 0, added: 0, notes: 0 } });
    for (let i = 0; i < 20; i++) x.observer.setOptions(x.options(true));
    await vi.advanceTimersByTimeAsync(180_000);
    expect(harness.read).toHaveBeenCalledTimes(2);
  } finally { x.stop(); x.observer.destroy(); }
});
