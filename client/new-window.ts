import type { GestureResponderEvent } from "react-native";
import type { PluginScreenParams } from "@getpaseo/plugin/client";

// ⌘-click on "Open in Paseo" opens the session in a new desktop window. The plugin API can only open an
// agent in its own window, and the desktop bridge can only open a blank one, so the request is handed over
// through localStorage (shared by every window): the new window's sidebar entry takes it and opens the board
// with `openAgent`, and the board, which has navigation, opens the agent there.

const handoffKey = "flowly:open-agent-in-new-window";
const handoffTtlMs = 20_000;
/** Tells this window's own requests apart from another window's: the sidebar here is already mounted. */
const windowTag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

type OpenNewWindow = (options?: { pendingOpenProjectPath?: string | null }) => Promise<void>;

interface DesktopBridge {
  window?: { openNew?: OpenNewWindow };
}

interface Handoff {
  agentId: string;
  hostId: string;
  from: string;
  at: number;
}

function openNewWindow(): OpenNewWindow | undefined {
  return (globalThis as { paseoDesktop?: DesktopBridge }).paseoDesktop?.window?.openNew;
}

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage ?? undefined;
  } catch {
    return undefined;
  }
}

/** ⌘ (macOS) or Ctrl (elsewhere) held during the press. */
export function wantsNewWindow(event: GestureResponderEvent | undefined): boolean {
  const native = event?.nativeEvent as { metaKey?: boolean; ctrlKey?: boolean } | undefined;
  return !!(native?.metaKey || native?.ctrlKey);
}

/** False when this client cannot open windows (phone, browser, older desktop): open in place instead. */
export async function openAgentInNewWindow(agentId: string, hostId: string): Promise<boolean> {
  const openNew = openNewWindow();
  const store = storage();
  if (typeof openNew !== "function" || !store) return false;
  const handoff: Handoff = { agentId, hostId, from: windowTag, at: Date.now() };
  store.setItem(handoffKey, JSON.stringify(handoff));
  await openNew({});
  return true;
}

/** The board params that open a handed-over agent, once, in the window that did not ask for it. */
export function takeNewWindowAgent(): PluginScreenParams | null {
  const store = storage();
  const raw = store?.getItem(handoffKey);
  if (!store || !raw) return null;
  let handoff: Partial<Handoff>;
  try {
    handoff = JSON.parse(raw) as Partial<Handoff>;
  } catch {
    store.removeItem(handoffKey);
    return null;
  }
  if (handoff.from === windowTag) return null;
  store.removeItem(handoffKey);
  if (typeof handoff.agentId !== "string" || typeof handoff.hostId !== "string") return null;
  if (typeof handoff.at !== "number" || Date.now() - handoff.at > handoffTtlMs) return null;
  return { openAgent: handoff.agentId, openAgentHost: handoff.hostId };
}
