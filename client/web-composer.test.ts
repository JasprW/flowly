import { afterEach, expect, test, vi } from "vitest";

vi.mock("react-native", () => ({ Platform: { OS: "web" } }));

/** A textarea as React renders it: the fiber chain carries the composer's agentId and workspaceId props. */
function field(agentId: string, value = "") {
  const events: string[] = [];
  const el = {
    value,
    focused: false,
    selection: [0, 0],
    matches: (s: string) => s === "textarea[data-composer-input]",
    focus() {
      el.focused = true;
    },
    setSelectionRange(a: number, b: number) {
      el.selection = [a, b];
    },
    dispatchEvent(e: { type: string }) {
      events.push(e.type);
      return true;
    },
    events,
  };
  Object.defineProperty(el, "__reactFiber$abc", {
    value: { memoizedProps: { style: {} }, alternate: null, return: { memoizedProps: { agentId, workspaceId: "w" }, alternate: null, return: null } },
    enumerable: true,
  });
  return el;
}
const g = globalThis as Record<string, unknown>;
afterEach(() => {
  delete g.document;
  delete g.InputEvent;
  vi.resetModules();
});
function install(fields: object[]) {
  g.document = { querySelectorAll: () => fields };
  g.InputEvent = class {
    constructor(public type: string) {}
  };
}

test("without a DOM nothing is filled (native apps fall back to copying)", async () => {
  const { fillComposer } = await import("./web-composer");
  expect(fillComposer("a1", "Verify it")).toBe(false);
});

test("fills only the message box that belongs to this session, after what is typed", async () => {
  const mine = field("a1", "typed"),
    other = field("a2");
  install([other, mine]);
  const { fillComposer } = await import("./web-composer");
  expect(fillComposer("a1", "Verify it")).toBe(true);
  expect(mine.value).toBe("typed\n\nVerify it");
  expect(mine.events).toEqual(["input"]);
  expect(mine.focused).toBe(true);
  expect(mine.selection).toEqual([mine.value.length, mine.value.length]);
  expect(other.value).toBe("");
});

test("no box for this session, or two that claim it: nothing is filled", async () => {
  install([field("a2")]);
  let { fillComposer } = await import("./web-composer");
  expect(fillComposer("a1", "x")).toBe(false);
  vi.resetModules();
  const one = field("a1"),
    two = field("a1");
  install([one, two]);
  ({ fillComposer } = await import("./web-composer"));
  expect(fillComposer("a1", "x")).toBe(false);
  expect(one.value + two.value).toBe("");
});
