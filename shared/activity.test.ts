import { describe, expect, it } from "vitest";
import { ACTIVITY_WEEKS, activity, activityFrom, activityLevel, activityLevels, mondayOf } from "./activity";
import type { FlowEntry } from "./insights";

let n = 0;
const e = (at: string, action: string, extra: Partial<FlowEntry> = {}): FlowEntry =>
  ({ id: `e${n++}`, at, taskId: "t1", actor: "system", action, ...extra }) as FlowEntry;

describe("activity range", () => {
  it("starts on the Monday 52 weeks before this week's", () => {
    expect(mondayOf("2026-10-25")).toBe("2026-10-19"); // Sunday
    expect(mondayOf("2026-10-19")).toBe("2026-10-19");
    expect(activityFrom("2026-10-25")).toBe("2025-10-20");
    expect(ACTIVITY_WEEKS).toBe(53);
  });
});

describe("activity", () => {
  it("counts turns, cards with a turn or move, and each card done once per day", () => {
    const view = activity({
      today: "2026-10-25",
      tz: "UTC",
      entries: [
        e("2026-10-21T10:00:00Z", "agent.turn_ended"),
        e("2026-10-21T11:00:00Z", "agent.turn_ended", { taskId: "t2" }),
        e("2026-10-21T12:00:00Z", "status_changed", { taskId: "t3", to: "done" }),
        e("2026-10-21T13:00:00Z", "status_changed", { taskId: "t3", to: "development" }),
        e("2026-10-21T14:00:00Z", "status_changed", { taskId: "t3", to: "done" }),
        e("2026-10-21T15:00:00Z", "progress_reported", { taskId: "t4" }),
      ],
    });
    expect(view.days).toEqual([{ day: "2026-10-21", turns: 2, cards: 3, done: ["t3"] }]);
  });

  it("splits days in the client's zone", () => {
    const entries = [e("2026-10-21T23:30:00Z", "agent.turn_ended")];
    expect(activity({ entries, today: "2026-10-25", tz: "UTC" }).days[0].day).toBe("2026-10-21");
    expect(activity({ entries, today: "2026-10-25", tz: "Asia/Shanghai" }).days[0].day).toBe("2026-10-22");
  });

  it("leaves out days before the range and after today", () => {
    const view = activity({
      today: "2026-10-25",
      tz: "UTC",
      entries: [e("2025-10-19T10:00:00Z", "agent.turn_ended"), e("2025-10-20T10:00:00Z", "agent.turn_ended"), e("2026-10-26T10:00:00Z", "agent.turn_ended")],
    });
    expect(view.days.map((d) => d.day)).toEqual(["2025-10-20"]);
  });

  it("is empty without activity", () => {
    expect(activity({ entries: [], today: "2026-10-25", tz: "UTC" })).toEqual({ from: "2025-10-20", days: [], levels: [] });
  });
});

describe("levels", () => {
  it("splits non-zero days at their quartiles", () => {
    const levels = activityLevels([1, 2, 3, 4, 5, 6, 7, 8, 0, 0]);
    expect(levels).toEqual([3, 5, 7]);
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8].map((t) => activityLevel(t, levels))).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4]);
  });

  it("keeps a single busy day at level 1 and never exceeds 4", () => {
    expect(activityLevels([9])).toEqual([]);
    expect(activityLevel(9, [])).toBe(1);
    expect(activityLevel(1000, [2, 3, 4])).toBe(4);
  });

  it("collapses equal quartiles", () => {
    const levels = activityLevels([5, 5, 5, 5, 6]);
    expect(levels).toEqual([6]);
    expect(activityLevel(5, levels)).toBe(1);
    expect(activityLevel(6, levels)).toBe(2);
  });
});
