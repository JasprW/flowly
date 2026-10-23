import { expect, test, vi } from "vitest";
import type { PaseoApi } from "@getpaseo/client";
import { availableModels, runSummaryModels } from "./summary-models";

const paseo = {
  providers: {
    listAvailable: async () => ({ providers: [{ provider: "one", available: true }, { provider: "two", available: true }, { provider: "unused", available: true }] }),
    listModels: vi.fn(async (provider: string) => ({ models: provider === "one" ? [{ id: "a" }, { id: "b" }] : [{ id: "c" }], error: null })),
  },
} as unknown as PaseoApi;

test("custom providers are discovered once; unrelated providers are not queried", async () => {
  vi.mocked(paseo.providers.listModels).mockClear();
  const providers = await availableModels(paseo, ["two/c", "one/a", "one/b"]);
  expect(providers.map((p) => p.provider)).toEqual(["one", "two"]);
  expect(vi.mocked(paseo.providers.listModels).mock.calls.map(([p]) => p)).toEqual(["one", "two"]);
});

test("shared callers get ordered parsing fallback, cleanup before retry, and stop at valid empty output", async () => {
  const actions: string[] = [];
  const create = async (model: string) => {
    actions.push(`create ${model}`);
    return { id: model, archive: async () => undefined, waitForFinish: async () => ({ status: "idle", lastMessage: model === "two/c" ? "bad" : "[]" }) };
  };
  const result = await runSummaryModels(paseo, ["missing/x", "two/c", "one/b", "one/a"], {
    create, parse: (text) => JSON.parse(text!), timeoutMs: 100,
    remove: async (agent) => { actions.push(`remove ${agent.id}`); },
  });
  expect(result).toEqual({ model: "one/b", output: [] });
  expect(actions).toEqual(["create two/c", "remove two/c", "create one/b", "remove one/b"]);
});

test("provider-list failure cannot mark unknown models as available", async () => {
  const broken = { providers: { ...paseo.providers, listModels: async () => { throw new Error("discovery offline"); } } } as unknown as PaseoApi;
  const create = vi.fn();
  await expect(runSummaryModels(broken, ["one/a"], { create, parse: () => null, remove: async () => {}, timeoutMs: 100 })).rejects.toThrow(/No configured summary model/);
  expect(create).not.toHaveBeenCalled();
});
