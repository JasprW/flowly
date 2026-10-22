import { Platform } from "react-native";
import { nextMoveDraft } from "../shared/next-moves";

/*
 * Exception to the DOM-free client rule (AGENTS.md, user-approved 2026-10-20; NATIVE-SESSION-SPEC §6.4): Paseo has no
 * plugin API for its message box, so on web and desktop a suggested next step is filled in through the DOM, the way
 * the prompt-suggestions plugin does. The text field carries `data-composer-input`, and the React fiber above it holds
 * the composer's `agentId` and `workspaceId` props. Nothing here may throw, and when the box cannot be proven to belong
 * to the session, nothing is filled and the caller copies instead.
 */
const SELECTOR = "textarea[data-composer-input]";

type Field = {
  value: string;
  focus?(): void;
  setSelectionRange?(start: number, end: number): void;
  dispatchEvent(event: object): boolean;
  getClientRects?(): ArrayLike<unknown>;
  closest?(selector: string): unknown;
};
type Fiber = { return: Fiber | null; alternate: Fiber | null; memoizedProps: Record<string, unknown> | null };
const browser = globalThis as unknown as {
  document?: { querySelectorAll(selector: string): ArrayLike<Field> };
  InputEvent?: new (type: "input", init: { bubbles: boolean }) => object;
};

function ownerOf(start: Fiber | null): string | null {
  for (let node = start; node; node = node.return) {
    const props = node.memoizedProps;
    if (props && typeof props.agentId === "string" && "workspaceId" in props) return props.agentId;
  }
  return null;
}

/**
 * The sessions the box's composer has been rendered for. The DOM node keeps the fiber it was created with, and React
 * swaps a fiber with its other copy on each update, so either copy may hold the props of an earlier render: a box
 * created for a new session's draft keeps naming the draft until the page reloads. Both copies are asked.
 */
function ownersOf(field: Field): string[] {
  const key = Object.keys(field).find((name) => name.startsWith("__reactFiber$"));
  const fiber = key ? ((field as unknown as Record<string, Fiber | null>)[key] ?? null) : null;
  return [ownerOf(fiber), ownerOf(fiber?.alternate ?? null)].filter((id): id is string => !!id);
}

/**
 * Paseo keeps other workspaces mounted but hidden (`aria-hidden`, or not laid out); a box there may still name this
 * session through a stale fiber copy, and is never the one being used.
 */
function onScreen(field: Field): boolean {
  if (field.getClientRects && field.getClientRects().length === 0) return false;
  return !field.closest?.('[aria-hidden="true"]');
}

/** React tracks the value it rendered; the prototype's own setter plus an `input` event is what reaches onChange. */
function setValue(field: Field, value: string) {
  for (let proto = Object.getPrototypeOf(field) as object | null; proto; proto = Object.getPrototypeOf(proto) as object | null) {
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) return void setter.call(field, value);
  }
  field.value = value;
}

/** Puts `text` in this session's Paseo message box (after anything typed, as Flowly's composer does). False: not filled. */
export function fillComposer(agentId: string, text: string): boolean {
  try {
    if (Platform.OS !== "web" || !browser.document || !browser.InputEvent) return false;
    const fields = Array.from(browser.document.querySelectorAll(SELECTOR)).filter((f) => onScreen(f) && ownersOf(f).includes(agentId));
    // Two visible boxes for one session (a split view) cannot be told apart: do not guess.
    if (fields.length !== 1) return false;
    const field = fields[0];
    const next = nextMoveDraft(text, field.value ?? "");
    setValue(field, next);
    field.dispatchEvent(new browser.InputEvent("input", { bubbles: true }));
    field.focus?.();
    field.setSelectionRange?.(next.length, next.length);
    return true;
  } catch {
    return false;
  }
}
