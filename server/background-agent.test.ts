import { afterEach, expect, test, vi } from "vitest";
import { backgroundAgentsSupported, createHidden, isBackgroundAgent, isBackgroundRefusal, resetBackgroundAgents } from "./background-agent";

afterEach(() => resetBackgroundAgents(null));

test("a host with background agents gets background: true and is remembered as supporting them", async () => {
  const create = vi.fn(async (extra: { background?: true }) => ({ id: "a", extra }));
  expect((await createHidden(create)).extra).toEqual({ background: true });
  expect(backgroundAgentsSupported()).toBe(true);
});

test.each([
  "Update the host to use background agents.",
  "Update the host to use background workspaces.",
  "background is workspace creation intent; configure the selected workspace at creation.",
])("an older host's refusal (%s) creates the session the 0.15 way and is not tried again", async (refusal) => {
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  const create = vi.fn(async (extra: { background?: true }) => {
    if (extra.background) throw new Error(refusal);
    return { id: "a", extra };
  });
  expect((await createHidden(create)).extra).toEqual({});
  expect(backgroundAgentsSupported()).toBe(false);
  await createHidden(create);
  expect(create.mock.calls.map(([extra]) => extra)).toEqual([{ background: true }, {}, {}]);
  log.mockRestore();
});

test("any other create failure is the caller's failure: no retry, support still unknown", async () => {
  const create = vi.fn(async () => Promise.reject(new Error("Workspace w has no available directory")));
  await expect(createHidden(create)).rejects.toThrow("no available directory");
  expect(create).toHaveBeenCalledTimes(1);
  expect(backgroundAgentsSupported()).toBe(null);
  expect(isBackgroundRefusal(new Error("Workspace w has no available directory"))).toBe(false);
});

test("a session is background only when its snapshot says so", () => {
  expect(isBackgroundAgent({ current: () => ({ background: true }) })).toBe(true);
  expect(isBackgroundAgent({ current: () => ({ background: false }) })).toBe(false);
  expect(isBackgroundAgent({ current: () => null })).toBe(false);
  expect(isBackgroundAgent({ id: "a" })).toBe(false);
});
