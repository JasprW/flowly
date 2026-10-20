import { AccessibilityInfo } from "react-native";

/**
 * The system Reduce Motion preference for Flowly rows Paseo renders outside Flowly's own tree (NATIVE-SESSION-SPEC
 * §5.3): one shared query and listener for all of them, instead of one per timeline row. Reduced until the system
 * answers, the same safe default as `MotionProvider`.
 */
let reduced = true;
let known = false;
let stop: (() => void) | null = null;
const listeners = new Set<() => void>();

function set(next: boolean) {
  if (reduced === next) return;
  reduced = next;
  listeners.forEach((l) => l());
}

export function reduceMotionNow() {
  return reduced;
}

export function subscribeReduceMotion(listener: () => void) {
  listeners.add(listener);
  if (!stop) {
    let changed = false;
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", (next) => {
      changed = true;
      known = true;
      set(next);
    });
    stop = () => sub.remove();
    if (!known)
      void AccessibilityInfo.isReduceMotionEnabled()
        .then((next) => {
          // An event received after the query began is newer than its result.
          if (!changed) {
            known = true;
            set(next);
          }
        })
        .catch(() => undefined);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size && stop) {
      stop();
      stop = null;
      // Unwatched from here on: ask again when a row next appears.
      known = false;
    }
  };
}
