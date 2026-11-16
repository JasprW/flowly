import { afterEach, expect, test, vi } from "vitest";
import { hostSupports, isHostRefusal, paseoVersionAtLeast, resetHostSupport, withHostFeature } from "./host-support";

afterEach(() => resetHostSupport());

test("§2 B: an older host's refusal answers no, is remembered, and the call is not tried again", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  const run = vi.fn(async () => {
    throw new Error("Update the host to use metadata.");
  });
  expect(await withHostFeature("metadata", run)).toEqual({ ok: false });
  expect(await withHostFeature("metadata", run)).toEqual({ ok: false });
  expect(run).toHaveBeenCalledTimes(1);
  expect(hostSupports("metadata")).toBe(false);
  // Logged once as an older host, never as a failure.
  expect(log).toHaveBeenCalledTimes(1);
  log.mockRestore();
});

test("§2 A: a missing method answers no without calling anything", async () => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  expect(await withHostFeature("metadata", () => undefined)).toEqual({ ok: false });
  expect(hostSupports("metadata")).toBe(false);
});

test("a success is remembered; any other failure is the caller's and teaches nothing", async () => {
  await expect(withHostFeature("metadata", async () => { throw new Error("agent not found"); })).rejects.toThrow("agent not found");
  expect(hostSupports("metadata")).toBe(null);
  expect(await withHostFeature("metadata", async () => 7)).toEqual({ ok: true, value: 7 });
  expect(hostSupports("metadata")).toBe(true);
  expect(hostSupports("background agents")).toBe(null);
});

test("refusals are recognized by the fixed prefix only", () => {
  expect(isHostRefusal(new Error("Update the host to use background agents."))).toBe(true);
  expect(isHostRefusal("Update the host to use metadata.")).toBe(true);
  expect(isHostRefusal(new Error("Update failed"))).toBe(false);
});

test("§2 C: version fallback counts a pre-release as its release and is null when unknown", () => {
  expect(paseoVersionAtLeast("0.16.0", "0.16.0")).toBe(true);
  expect(paseoVersionAtLeast("0.16.0-beta.2", "0.16.0")).toBe(true);
  expect(paseoVersionAtLeast("0.15.4", "0.16.0")).toBe(false);
  expect(paseoVersionAtLeast("1.0.0", "0.16.0")).toBe(true);
  expect(paseoVersionAtLeast("0.16.1", "0.16.2")).toBe(false);
  expect(paseoVersionAtLeast("", "0.16.0")).toBe(null);
});
