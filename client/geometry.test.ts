import { describe, expect, test } from "vitest";
import {
  columnAtPoint,
  listDropIndex,
  listShift,
  contentY,
  drawerWidth,
  dropSlot,
  placementUpdate,
  edgeScroll,
  isCompactLayout,
  keyboardOverlap,
} from "./geometry";

const viewport = { x: 100, y: 80, width: 600, height: 500 };
const columns = [
  { status: "todo" as const, x: 12, width: 280 },
  { status: "development" as const, x: 304, width: 280 },
];

describe("board interaction geometry", () => {
  test("targets measured columns with viewport origin and horizontal scroll", () => {
    expect(columnAtPoint({ x: 115, y: 100 }, viewport, 0, columns)).toBe(
      "todo",
    );
    expect(columnAtPoint({ x: 420, y: 100 }, viewport, 0, columns)).toBe(
      "development",
    );
    expect(columnAtPoint({ x: 130, y: 100 }, viewport, 292, columns)).toBe(
      "development",
    );
  });
  test("gaps, toolbar, drawer and outside pointers are not drop targets", () => {
    for (const point of [
      { x: 398, y: 100 },
      { x: 130, y: 79 },
      { x: 700, y: 100 },
      { x: 130, y: 580 },
    ]) {
      expect(columnAtPoint(point, viewport, 0, columns)).toBeNull();
    }
  });
  test("edge scroll is bounded and inactive outside the viewport", () => {
    expect(edgeScroll({ x: 690, y: 100 }, viewport, 0, 1200)).toBe(18);
    expect(edgeScroll({ x: 110, y: 100 }, viewport, 10, 1200)).toBe(0);
    expect(edgeScroll({ x: 690, y: 100 }, viewport, 595, 1200)).toBe(600);
    expect(edgeScroll({ x: 690, y: 60 }, viewport, 100, 1200)).toBe(100);
    expect(edgeScroll({ x: 400, y: 100 }, viewport, 100, 1200)).toBe(100);
    expect(edgeScroll({ x: 690, y: 100 }, viewport, 0, 200)).toBe(0);
  });
  test("drawer resize keeps a readable drawer and at least 300 points of board", () => {
    expect(drawerWidth(100, 1200)).toBe(340);
    expect(drawerWidth(1000, 1600)).toBe(720);
    expect(drawerWidth(720, 800)).toBe(488);
    expect(drawerWidth(440, 760)).toBe(440);
  });
  test("only available width selects compact layout; unmeasured surfaces start compact", () => {
    expect(isCompactLayout(0)).toBe(true);
    expect(isCompactLayout(390)).toBe(true);
    expect(isCompactLayout(759)).toBe(true);
    expect(isCompactLayout(760)).toBe(false);
    expect(isCompactLayout(1000)).toBe(false);
    expect(isCompactLayout(1600)).toBe(false);
  });
});

const cards = [
  { id: "a", y: 0, height: 60 },
  { id: "b", y: 68, height: 80 },
  { id: "c", y: 156, height: 60 },
];
describe("drop slot hit testing", () => {
  test("compares the pointer with card midlines and anchors to the following card", () => {
    expect(dropSlot(-20, cards, "x", 8)).toEqual({ index: 0, beforeId: "a", afterId: null, lineY: -4 });
    expect(dropSlot(29, cards, "x", 8)).toMatchObject({ index: 0, beforeId: "a" });
    expect(dropSlot(30, cards, "x", 8)).toMatchObject({ index: 1, beforeId: "b", lineY: 64 });
    expect(dropSlot(150, cards, "x", 8)).toMatchObject({ index: 2, beforeId: "c" });
  });
  test("below the last midline appends after the last card; an empty column has no line", () => {
    expect(dropSlot(200, cards, "x", 8)).toEqual({ index: 3, beforeId: null, afterId: "c", lineY: 220 });
    expect(dropSlot(10, [], "x", 8)).toEqual({ index: 0, beforeId: null, afterId: null, lineY: null });
  });
  test("the dragged card is not a slot boundary", () => {
    expect(dropSlot(100, cards, "b", 8)).toMatchObject({ index: 1, beforeId: "c" });
    expect(dropSlot(200, cards, "c", 8)).toEqual({ index: 2, beforeId: null, afterId: "b", lineY: 152 });
  });
  test("window points convert through the list origin and vertical scroll", () => {
    expect(contentY(300, 200, 0)).toBe(100);
    expect(contentY(300, 200, 120)).toBe(220);
  });
});

describe("drop placement", () => {
  const task = { id: "b", revision: 7, status: "todo" as const };
  const column = ["a", "b", "c"];
  test("outside the board or the current slot does not write", () => {
    expect(placementUpdate(task, null, dropSlot(0, cards, "b", 8), column)).toBeNull();
    expect(placementUpdate(task, "todo", dropSlot(100, cards, "b", 8), column)).toBeNull();
    expect(placementUpdate(task, "todo", null, column)).toBeNull();
  });
  test("same-column moves carry the captured revision and one anchor", () => {
    expect(placementUpdate(task, "todo", dropSlot(0, cards, "b", 8), column)).toEqual({
      id: "b", revision: 7, status: "todo", beforeId: "a", afterId: null,
    });
    expect(placementUpdate(task, "todo", dropSlot(400, cards, "b", 8), column)).toEqual({
      id: "b", revision: 7, status: "todo", beforeId: null, afterId: "c",
    });
  });
  test("cross-column drops target the slot, or the end when no slot was measured", () => {
    const other = [{ id: "x", y: 0, height: 60 }];
    expect(placementUpdate(task, "done", dropSlot(10, other, "b", 8), ["x"])).toEqual({
      id: "b", revision: 7, status: "done", beforeId: "x", afterId: null,
    });
    expect(placementUpdate(task, "done", null, [])).toEqual({
      id: "b", revision: 7, status: "done", beforeId: null, afterId: null,
    });
  });
});

test("list drag lands by row centres and shifts the rows it passes", () => {
  const heights = [40, 40, 40, 40];
  expect(listDropIndex(heights, 0, 0, 4)).toBe(0);
  expect(listDropIndex(heights, 0, 30, 4)).toBe(0);
  expect(listDropIndex(heights, 0, 50, 4)).toBe(1);
  expect(listDropIndex(heights, 0, 500, 4)).toBe(3);
  expect(listDropIndex(heights, 3, -90, 4)).toBe(1);
  expect(listDropIndex(heights, 3, -500, 4)).toBe(0);
  expect([0, 1, 2, 3].map((i) => listShift(i, 0, 2, 44))).toEqual([0, -44, -44, 0]);
  expect([0, 1, 2, 3].map((i) => listShift(i, 3, 1, 44))).toEqual([0, 44, 44, 0]);
});

describe("keyboard overlap", () => {
  test("lifts only by the part of the view the keyboard covers", () => {
    expect(keyboardOverlap(800, null)).toBe(0);
    expect(keyboardOverlap(800, 500)).toBe(300);
    // The host already resized the window: nothing left to cover.
    expect(keyboardOverlap(500, 500)).toBe(0);
    expect(keyboardOverlap(480, 500)).toBe(0);
    // A taller IME (candidate bar) raises the inset.
    expect(keyboardOverlap(800, 456.4)).toBe(344);
  });
});
