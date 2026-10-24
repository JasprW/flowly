import { expect, test, vi } from "vitest";
import type { QueryClient } from "@tanstack/react-query";

const harness = vi.hoisted(() => ({ effects: [] as (() => void | (() => void))[], options: {} as Record<string, unknown>,
  subscribe: vi.fn(), list: vi.fn(), client: null as unknown as QueryClient }));
vi.mock("react", async (original) => ({ ...await original<typeof import("react")>(),
  useEffect: (effect: () => void | (() => void)) => harness.effects.push(effect) }));
vi.mock("@tanstack/react-query", async (original) => ({ ...await original<typeof import("@tanstack/react-query")>(),
  useQuery: (options: Record<string, unknown>) => { harness.options = options; return {}; },
  useQueryClient: () => harness.client }));
const api = { agents: { list: harness.list, subscribe: harness.subscribe } };
vi.mock("@getpaseo/plugin/client", () => ({ usePaseo: () => api, useRpc: () => null }));

import { QueryClient as Client } from "@tanstack/react-query";
import { useLiveAgents } from "./queries";

test("disabled board never starts a stream; visible readers share it and last cleanup stops it; return starts again", async () => {
  harness.client = new Client();
  const unsubscribe = vi.fn(), release = vi.fn(async () => undefined);
  harness.subscribe.mockReturnValue(unsubscribe);
  harness.list.mockResolvedValue({ subscription: { release } });
  const mount = (enabled: boolean) => {
    useLiveAgents({ enabled });
    return harness.effects.pop()!();
  };
  expect(mount(false)).toBeUndefined();
  expect(harness.options.enabled).toBe(false);
  expect(harness.subscribe).not.toHaveBeenCalled();
  const first = mount(true), second = mount(true);
  expect(harness.subscribe).toHaveBeenCalledTimes(1);
  await Promise.resolve();
  if (typeof first === "function") first();
  expect(unsubscribe).not.toHaveBeenCalled();
  if (typeof second === "function") second();
  expect(unsubscribe).toHaveBeenCalledTimes(1);
  expect(release).toHaveBeenCalledTimes(1);
  expect(mount(false)).toBeUndefined();
  const resumed = mount(true);
  expect(harness.subscribe).toHaveBeenCalledTimes(2);
  await Promise.resolve();
  if (typeof resumed === "function") resumed();
  expect(unsubscribe).toHaveBeenCalledTimes(2);
  harness.client.clear();
});
