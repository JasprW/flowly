import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { GestureResponderEvent } from "react-native";
import { openAgentInNewWindow, takeNewWindowAgent, takeOpenAgentParams, wantsNewWindow } from "./new-window";

const key = "flowly:open-agent-in-new-window";
const store = new Map<string, string>();
const localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};
const press = (native: Record<string, boolean>) => ({ nativeEvent: native }) as unknown as GestureResponderEvent;

beforeEach(() => {
  store.clear();
  vi.stubGlobal("localStorage", localStorage);
});
afterEach(() => vi.unstubAllGlobals());

test("⌘ or Ctrl asks for a new window; a plain press does not", () => {
  expect(wantsNewWindow(press({ metaKey: true }))).toBe(true);
  expect(wantsNewWindow(press({ ctrlKey: true }))).toBe(true);
  expect(wantsNewWindow(press({}))).toBe(false);
  expect(wantsNewWindow(undefined)).toBe(false);
});

test("without the desktop bridge it opens in place", async () => {
  expect(await openAgentInNewWindow("a1", "h1")).toBe(false);
  expect(store.has(key)).toBe(false);
});

test("the asking window opens a blank window and does not take its own request", async () => {
  const openNew = vi.fn(async () => {});
  vi.stubGlobal("paseoDesktop", { window: { openNew } });
  expect(await openAgentInNewWindow("a1", "h1")).toBe(true);
  expect(openNew).toHaveBeenCalledOnce();
  expect(takeNewWindowAgent()).toBeNull();
  expect(store.has(key)).toBe(true);
});

test("another window takes the request once", () => {
  store.set(key, JSON.stringify({ agentId: "a1", hostId: "h1", from: "other", at: Date.now() }));
  expect(takeNewWindowAgent()).toMatchObject({ openAgent: "a1", openAgentHost: "h1" });
  expect(takeNewWindowAgent()).toBeNull();
});

test("a stale or broken request is dropped", () => {
  store.set(key, JSON.stringify({ agentId: "a1", hostId: "h1", from: "other", at: Date.now() - 60_000 }));
  expect(takeNewWindowAgent()).toBeNull();
  expect(store.has(key)).toBe(false);
  store.set(key, "{");
  expect(takeNewWindowAgent()).toBeNull();
  expect(store.has(key)).toBe(false);
  store.set(key, "null");
  expect(takeNewWindowAgent()).toBeNull();
  expect(store.has(key)).toBe(false);
});

test("a full storage opens in place", async () => {
  vi.stubGlobal("paseoDesktop", { window: { openNew: vi.fn(async () => {}) } });
  vi.stubGlobal("localStorage", { ...localStorage, setItem: () => { throw new Error("QuotaExceededError"); } });
  expect(await openAgentInNewWindow("a1", "h1")).toBe(false);
});

test("a failed openNew drops its own request but not a newer one", async () => {
  vi.stubGlobal("paseoDesktop", { window: { openNew: vi.fn(async () => { throw new Error("no"); }) } });
  await expect(openAgentInNewWindow("a1", "h1")).rejects.toThrow("no");
  expect(store.has(key)).toBe(false);
  vi.stubGlobal("paseoDesktop", {
    window: { openNew: vi.fn(async () => { store.set(key, "newer"); throw new Error("no"); }) },
  });
  await expect(openAgentInNewWindow("a1", "h1")).rejects.toThrow("no");
  expect(store.get(key)).toBe("newer");
});

test("the board opens a handed-over agent once, and only while fresh", () => {
  const now = Date.now();
  const params = { openAgent: "a9", openAgentHost: "h1", openAgentAt: String(now) };
  expect(takeOpenAgentParams(params, now)).toEqual({ agentId: "a9", hostId: "h1" });
  expect(takeOpenAgentParams(params, now)).toBeNull();
  expect(takeOpenAgentParams({ openAgent: "a8", openAgentAt: String(now - 60_000) }, now)).toBeNull();
  expect(takeOpenAgentParams({ openAgent: "a7" }, now)).toBeNull();
});
