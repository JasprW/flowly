import { afterEach, expect, test, vi } from "vitest";
import { ChangeFeed } from "./change-feed";

afterEach(() => vi.useRealTimers());

function subscriber() {
  const events: { seq: number; scope: string }[] = [];
  const controller = new AbortController();
  return { events, controller, push: async (event: { seq: number; scope: string }) => void events.push(event) };
}

test("a new subscriber hears one event at once; writes of one action become one event", async () => {
  vi.useFakeTimers();
  const feed = new ChangeFeed(100);
  const a = subscriber();
  feed.serve(a.push, a.controller.signal);
  expect(a.events).toEqual([{ seq: 0, scope: "all" }]);
  feed.notify();
  feed.notify();
  await vi.advanceTimersByTimeAsync(100);
  expect(a.events).toEqual([{ seq: 0, scope: "all" }, { seq: 1, scope: "board" }]);
  feed.notify("sessions");
  await vi.advanceTimersByTimeAsync(100);
  feed.notify("sessions");
  feed.notify();
  await vi.advanceTimersByTimeAsync(100);
  expect(a.events.slice(2).map((e) => e.scope)).toEqual(["sessions", "all"]);
});

test("a released subscriber hears nothing more, and nothing is scheduled without subscribers", async () => {
  vi.useFakeTimers();
  const feed = new ChangeFeed(100);
  const a = subscriber();
  feed.serve(a.push, a.controller.signal);
  a.controller.abort();
  expect(feed.size).toBe(0);
  feed.notify();
  await vi.advanceTimersByTimeAsync(100);
  expect(a.events).toHaveLength(1);
  expect(vi.getTimerCount()).toBe(0);
});
