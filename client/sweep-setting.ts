import { useSyncExternalStore } from "react";

/** Whether the running dot sweep plays (Settings → Cards). One shared flag: the sweep sits in many trees. */
let on = true;
const listeners = new Set<() => void>();

export function setSweepEnabled(next: boolean) {
  if (on === next) return;
  on = next;
  listeners.forEach((l) => l());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

export const useSweepEnabled = () => useSyncExternalStore(subscribe, () => on, () => true);
