import { useSyncExternalStore } from "react";

/**
 * Suggestion sets the user hid on this device (NEXT-MOVES-SPEC §3; NATIVE-SESSION-SPEC §6.3), by event id. Shared
 * by Flowly's suggestion row and the native Next chip so hiding one hides both; in memory, so an app reload shows
 * them again, as before.
 */
const hidden = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

export function hideMoves(eventId: string) {
  if (hidden.has(eventId)) return;
  hidden.add(eventId);
  // Bounded: only the current set of each session matters.
  if (hidden.size > 200) hidden.delete(hidden.values().next().value!);
  version++;
  listeners.forEach((listener) => listener());
}
export function movesHidden(eventId: string) {
  return hidden.has(eventId);
}
export function onMovesHidden(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
/** Re-renders when any set is hidden. */
export function useHiddenMovesVersion() {
  return useSyncExternalStore(onMovesHidden, () => version);
}
