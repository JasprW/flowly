import { expect, test } from "vitest";
import { complexityLevel, complexityShare, dayDetail, withDayTokens } from "./day-detail";
import { TOKEN_SLOT_MS, zeroUsage } from "./usage";
import type { FlowEntry } from "./insights";

let n = 0;
const e = (at: string, taskId: string, action: string, extra: Partial<FlowEntry> = {}): FlowEntry => ({ id: `e${n++}`, at, taskId, actor: "system", action, ...extra }) as FlowEntry;
const DAY = "2026-10-21";

test("counts turns, moves, agent time per card and splits a turn over midnight", () => {
  const entries = [
    // a: one turn inside the day (30 min) and done that day
    e("2026-10-21T10:00:00.000Z", "a", "agent.turn_started", { agentId: "s1" }),
    e("2026-10-21T10:30:00.000Z", "a", "agent.turn_ended", { agentId: "s1" }),
    e("2026-10-21T11:00:00.000Z", "a", "status_changed", { from: "in_review", to: "done" }),
    // b: a turn from 23:00 the day before to 01:00: one hour counts, its end counts as a turn
    e("2026-10-20T23:00:00.000Z", "b", "agent.turn_started", { agentId: "s2" }),
    e("2026-10-21T01:00:00.000Z", "b", "agent.turn_ended", { agentId: "s2" }),
    e("2026-10-21T02:00:00.000Z", "b", "agent.turn_started", { agentId: "s2" }),
    e("2026-10-21T04:00:00.000Z", "b", "agent.turn_ended", { agentId: "s2" }),
    // c: only a move; d: another day
    e("2026-10-21T12:00:00.000Z", "c", "status_changed", { from: "todo", to: "development" }),
    e("2026-10-22T09:00:00.000Z", "d", "agent.turn_ended", { agentId: "s4" }),
  ];
  const d = dayDetail({ entries, day: DAY, tz: "UTC", now: Date.parse("2026-10-26T00:00:00Z") });
  expect(d.list.map((c) => [c.taskId, c.turns, c.agentMs / 60000, c.done])).toEqual([
    ["b", 2, 180, false],
    ["a", 1, 30, true],
    ["c", 0, 0, false],
  ]);
  expect(d.turns).toBe(3);
  expect(d.agentMs).toBe(210 * 60000);
  expect(d.tokens).toBeUndefined();
});

test("a running turn counts until now only when its session runs", () => {
  const entries = [e("2026-10-21T10:00:00.000Z", "a", "agent.turn_started", { agentId: "s1" })];
  const now = Date.parse("2026-10-21T10:20:00Z");
  expect(dayDetail({ entries, day: DAY, tz: "UTC", now }).list).toEqual([]);
  expect(dayDetail({ entries, day: DAY, tz: "UTC", now, running: new Set(["s1"]) }).list[0].agentMs).toBe(20 * 60000);
});

test("tokens: only the day's buckets, per card; unreadable logs give no tokens", () => {
  const entries = [e("2026-10-21T10:00:00.000Z", "a", "agent.turn_ended", { agentId: "s1" }), e("2026-10-21T10:00:00.000Z", "b", "agent.turn_ended", { agentId: "s2" })];
  const d = dayDetail({ entries, day: DAY, tz: "UTC", now: Date.parse("2026-10-26T00:00:00Z") });
  const slot = (iso: string) => Math.floor(Date.parse(iso) / TOKEN_SLOT_MS);
  const usage = (input: number) => ({ ...zeroUsage(), input });
  const buckets = new Map([
    [slot("2026-10-21T00:00:00Z"), usage(100)],
    [slot("2026-10-21T23:45:00Z"), usage(10)],
    [slot("2026-10-22T00:00:00Z"), usage(5000)],
    [slot("2026-10-20T23:45:00Z"), usage(7000)],
  ]);
  const t = withDayTokens(d, [{ taskId: "a", buckets }, { taskId: "b", buckets: null }], "UTC");
  expect(t.list.find((c) => c.taskId === "a")!.tokens).toBe(110);
  expect(t.list.find((c) => c.taskId === "b")!.tokens).toBeUndefined();
  expect(t.tokens).toBe(110);
  expect(withDayTokens(d, [{ taskId: "a", buckets: null }], "UTC").tokens).toBeUndefined();
});

test("complexity: share of the busiest card by time, by turns when nobody has time", () => {
  const card = (agentMs: number, turns: number) => ({ taskId: String(agentMs) + turns, turns, agentMs, done: false });
  const list = [card(400, 1), card(100, 9), card(0, 3)];
  expect(list.map((c) => complexityShare(c, list))).toEqual([1, 0.25, 0]);
  const noTime = [card(0, 4), card(0, 2)];
  expect(noTime.map((c) => complexityShare(c, noTime))).toEqual([1, 0.5]);
  expect([0, 0.25, 0.26, 0.5, 0.75, 0.8, 1].map(complexityLevel)).toEqual([1, 1, 2, 2, 3, 4, 4]);
});
