import { afterEach, expect, test, vi } from "vitest";
import type { QueryClient, QueryObserverOptions } from "@tanstack/react-query";

const harness = vi.hoisted(() => {
  vi.stubGlobal("window", {});
  return { read: vi.fn(), live: false, client: null as unknown as QueryClient, options: {} as QueryObserverOptions };
});
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useContext: () => harness.live }));
vi.mock("@getpaseo/plugin/client", () => ({ usePaseo: () => null, useRpc: () => harness.read }));
vi.mock("@tanstack/react-query", async original => ({ ...await original<typeof import("@tanstack/react-query")>(),
  useQueryClient: () => harness.client,
  useQuery: (options: unknown) => { harness.options = options as QueryObserverOptions; return {}; },
}));
import { QueryClient as Client, QueryObserver } from "@tanstack/react-query";
import { guardrailsKey, useGuardrailsQuery } from "./queries";
import { invalidateCardViews } from "./card-detail-query";

afterEach(() => { harness.client?.clear(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const value = (text: string, running: string[] = [], enabled = true) => ({ entries: [{ id: "note", text }], items: [], errors: [], running, enabled });
function setup(live: boolean, enabled = true) {
  vi.useFakeTimers(); harness.live = live;
  harness.client = new Client({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  let view = value("old");
  harness.read.mockReset().mockImplementation(async () => ({ etag: JSON.stringify(view), value: view }));
  const options = (on = true) => { useGuardrailsQuery("p", on); return { ...harness.options, refetchIntervalInBackground: true }; };
  const observer = new QueryObserver(harness.client, options(enabled));
  const stop = observer.subscribe(() => undefined);
  return { observer, stop, options, set: (v: typeof view) => { view = v; } };
}

test("Memory/Guardrails page live idle 180s has no timed read; pushes refresh entries, running and enabled", async () => {
  const x = setup(true);
  try {
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(180_000);
    expect(harness.read).toHaveBeenCalledTimes(1);
    for (const next of [value("new", ["t"]), value("new", []), value("new", [], false)]) {
      x.set(next); await invalidateCardViews(harness.client);
      expect(harness.client.getQueryData(guardrailsKey("p"))).toEqual(next);
    }
    expect(harness.read).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(180_000);
    expect(harness.read).toHaveBeenCalledTimes(4);
  } finally { x.stop(); x.observer.destroy(); }
});

test("page fallback preserves 30s idle / 5s running and stops after subscription recovery", async () => {
  const x = setup(false);
  try {
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(harness.read).toHaveBeenCalledTimes(2);
    x.set(value("running", ["t"])); await x.observer.refetch();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(harness.read).toHaveBeenCalledTimes(4);
    harness.live = true; x.observer.setOptions(x.options());
    await vi.advanceTimersByTimeAsync(180_000);
    expect(harness.read).toHaveBeenCalledTimes(4);
    harness.live = false; x.observer.setOptions(x.options());
    await vi.advanceTimersByTimeAsync(5_000);
    expect(harness.read).toHaveBeenCalledTimes(5);
    harness.live = true; x.set(value("done")); x.observer.setOptions(x.options());
    await invalidateCardViews(harness.client);
    await vi.advanceTimersByTimeAsync(180_000);
    expect(harness.read).toHaveBeenCalledTimes(6);
  } finally { x.stop(); x.observer.destroy(); }
});

test("a page read error recovers without another push and then stops; hidden and unmounted readers stay silent", async () => {
  const x = setup(true);
  try {
    await vi.advanceTimersByTimeAsync(1);
    harness.read.mockRejectedValueOnce(new Error("offline"));
    await invalidateCardViews(harness.client);
    expect(x.observer.getCurrentResult().isError).toBe(true);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(x.observer.getCurrentResult().isError).toBe(false);
    expect(harness.read).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(180_000);
    expect(harness.read).toHaveBeenCalledTimes(3);
    x.observer.setOptions(x.options(false)); x.set(value("hidden"));
    await invalidateCardViews(harness.client);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(harness.read).toHaveBeenCalledTimes(3);
    x.observer.setOptions(x.options());
    await vi.advanceTimersByTimeAsync(1);
    expect(harness.read).toHaveBeenCalledTimes(4);
    harness.live = false; x.observer.setOptions(x.options()); x.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(harness.read).toHaveBeenCalledTimes(4);
  } finally { x.stop(); x.observer.destroy(); }
});

test("a page push during its uncached first read fetches the new view", async () => {
  const x = setup(true, false);
  let release!: (v: unknown) => void;
  const old = new Promise(resolve => { release = resolve; });
  harness.read.mockImplementationOnce(() => old);
  try {
    x.observer.setOptions(x.options());
    expect(harness.read).toHaveBeenCalledTimes(1);
    x.set(value("new")); const pushed = invalidateCardViews(harness.client);
    await Promise.resolve(); release({ etag: "old", value: value("old") }); await pushed;
    expect(harness.read).toHaveBeenCalledTimes(2);
    expect(harness.client.getQueryData(guardrailsKey("p"))).toEqual(value("new"));
  } finally { release({ etag: "old", value: value("old") }); x.stop(); x.observer.destroy(); }
});
