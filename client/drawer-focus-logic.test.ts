import { describe, expect, test } from "vitest";
import { activityStart, focusOfHit, limitFor } from "./drawer-focus-logic";

describe("focus from search (DRAWER-SPEC)", () => {
  test("each hit source lands on its section and item; card fields only open the drawer", () => {
    expect(focusOfHit({ source: "summary", refId: "s1" })).toEqual({ section: "progress" });
    expect(focusOfHit({ source: "note", refId: "e1" })).toEqual({ section: "activity", target: "event:e1" });
    expect(focusOfHit({ source: "workpad", refId: "w1" })).toEqual({ section: "workpad", target: "workpad:w1" });
    expect(focusOfHit({ source: "idea", refId: "i1" })).toEqual({ section: "ideas", target: "idea:i1" });
    expect(focusOfHit({ source: "artifact", refId: "a1" })).toEqual({ section: "artifacts", target: "artifact:a1" });
    expect(focusOfHit({ source: "workpad" })).toEqual({ section: "workpad" });
    expect(focusOfHit({ source: "card" })).toBeNull();
    expect(focusOfHit({ source: "memory", refId: "m" })).toBeNull();
  });
  test("a hit carries its field and matched words for the highlight", () => {
    expect(focusOfHit({ source: "note", refId: "e1", field: "note", snippet: "ran the Search test", ranges: [[8, 14]] })).toEqual({
      section: "activity",
      target: "event:e1",
      field: "note",
      terms: ["search"],
    });
    expect(focusOfHit({ source: "summary", refId: "s1", field: "target", snippet: "ship it", ranges: [[0, 4]] })).toEqual({
      section: "progress",
      field: "target",
      terms: ["ship"],
    });
  });
  test("Activity keeps its last 12 and widens back to an older target only", () => {
    const ids = Array.from({ length: 30 }, (_, i) => `e${i}`);
    expect(activityStart(ids, "")).toBe(18);
    expect(activityStart(ids, "event:e25")).toBe(18);
    expect(activityStart(ids, "event:e3")).toBe(3);
    expect(activityStart(ids, "event:missing")).toBe(18);
    expect(activityStart(ids, "idea:e3")).toBe(18);
    expect(activityStart(ids.slice(0, 5), "event:e0")).toBe(0);
  });
  test("a paged list grows in whole pages to include the target", () => {
    expect(limitFor(2, 5, 5)).toBe(5);
    expect(limitFor(5, 5, 5)).toBe(10);
    expect(limitFor(12, 5, 5)).toBe(15);
    expect(limitFor(3, 10, 5)).toBe(10);
  });
});
