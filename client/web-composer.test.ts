import { afterEach, expect, test, vi } from "vitest";

vi.mock("react-native", () => ({ Platform: { OS: "web" } }));

/**
 * A textarea as React renders it: the fiber chain carries the composer's agentId and workspaceId props. `stale` is the
 * agentId the fiber's other copy still holds from an earlier render; `hidden` puts it in a hidden workspace.
 */
function field(agentId: string, value = "", { stale = "", hidden = false } = {}) {
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
    getClientRects: () => (hidden ? [] : [{}]),
    closest: () => null,
    events,
  };
  const copy = (id: string) => ({ memoizedProps: { style: {} }, alternate: null, return: { memoizedProps: { agentId: id, workspaceId: "w" }, alternate: null, return: null } });
  const fiber = { ...copy(agentId), alternate: stale ? copy(stale) : null };
  Object.defineProperty(el, "__reactFiber$abc", { value: fiber, enumerable: true });
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

test("a box first rendered for another id (a new session's draft) still fills while either fiber copy names this session", async () => {
  // Either copy may be the stale one: the DOM node keeps the fiber it was created with.
  const current = field("a1", "", { stale: "draft-1" }),
    created = field("draft-1", "", { stale: "a1" });
  install([current]);
  let { fillComposer } = await import("./web-composer");
  expect(fillComposer("a1", "Verify it")).toBe(true);
  expect(current.value).toBe("Verify it");
  vi.resetModules();
  install([created]);
  ({ fillComposer } = await import("./web-composer"));
  expect(fillComposer("a1", "Verify it")).toBe(true);
  expect(created.value).toBe("Verify it");
});

test("a box in a hidden workspace is never filled, even when it names this session", async () => {
  const hidden = field("a1", "", { hidden: true }),
    shown = field("a1", "", { stale: "draft-1" });
  install([hidden, shown]);
  let { fillComposer } = await import("./web-composer");
  // The visible box is the one being used; the hidden one does not make it ambiguous.
  expect(fillComposer("a1", "x")).toBe(true);
  expect(shown.value).toBe("x");
  expect(hidden.value).toBe("");
  vi.resetModules();
  const only = field("a1", "", { hidden: true });
  install([only]);
  ({ fillComposer } = await import("./web-composer"));
  expect(fillComposer("a1", "x")).toBe(false);
  expect(only.value).toBe("");
});
