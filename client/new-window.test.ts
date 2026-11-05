import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { GestureResponderEvent } from "react-native";
import { openAgentInNewWindow, takeNewWindowAgent, wantsNewWindow } from "./new-window";

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
  expect(takeNewWindowAgent()).toEqual({ openAgent: "a1", openAgentHost: "h1" });
  expect(takeNewWindowAgent()).toBeNull();
});

test("a stale or broken request is dropped", () => {
  store.set(key, JSON.stringify({ agentId: "a1", hostId: "h1", from: "other", at: Date.now() - 60_000 }));
  expect(takeNewWindowAgent()).toBeNull();
  expect(store.has(key)).toBe(false);
  store.set(key, "{");
  expect(takeNewWindowAgent()).toBeNull();
  expect(store.has(key)).toBe(false);
});
