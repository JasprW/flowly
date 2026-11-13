import { expect, test } from "vitest";
import type { PaseoApi } from "@getpaseo/client";
import { deliveringBackgroundWork } from "./background-work";

const host = (backgroundWork: unknown) => ({ agents: { ref: () => ({ backgroundWork }) } }) as unknown as PaseoApi;

test("the session's running background tasks, one line each", async () => {
  const lines = await deliveringBackgroundWork(
    host({ list: async () => [{ id: "1", kind: "shell", description: null, command: "npm  test", startedAt: "2026-11-11T00:00:00Z" }] }),
    "a",
  );
  expect(lines).toEqual(["shell: npm test (since 2026-11-11T00:00:00Z)"]);
});

test("a host without background work, or a failed read, gives nothing and never throws", async () => {
  expect(await deliveringBackgroundWork(host(undefined), "a")).toBeUndefined();
  expect(await deliveringBackgroundWork(host({ list: async () => Promise.reject(new Error("Update the host")) }), "a")).toBeUndefined();
  expect(await deliveringBackgroundWork({} as PaseoApi, "a")).toBeUndefined();
});
