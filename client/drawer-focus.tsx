import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { View } from "react-native";
import { CueRing, radius } from "./ui";

export * from "./drawer-focus-logic";
import { FOCUS_RING_MS } from "./drawer-focus-logic";

type FocusState = { key: string; target: string; found(key: string, node: View): void };
const FocusContext = createContext<FocusState | null>(null);
export const DrawerFocusProvider = FocusContext.Provider;

/** The current target id (`section:…`, `event:…`, `workpad:…`, `idea:…`, `artifact:…`), or "". */
export function useFocusTarget(): string {
  return useContext(FocusContext)?.target ?? "";
}

/**
 * Wraps a section or row. When it is the focus target it reports its node to the drawer (which scrolls to it)
 * and shows the accent ring for a moment. Always a View, so becoming the target never remounts the children.
 */
export function FocusTarget({ id, round = radius.md, children }: { id: string; round?: number; children: ReactNode }) {
  const focus = useContext(FocusContext);
  const hit = !!focus && focus.target === id;
  const key = hit ? focus.key : "";
  const node = useRef<View>(null);
  const [ring, setRing] = useState(false);
  const report = useRef(focus?.found);
  report.current = focus?.found;
  useEffect(() => {
    if (!key) return;
    setRing(true);
    // Once laid out, and again after content above (sessions, sections loading) has settled.
    const send = () => node.current && report.current?.(key, node.current);
    const first = setTimeout(send, 60);
    const again = setTimeout(send, 450);
    const off = setTimeout(() => setRing(false), FOCUS_RING_MS);
    return () => {
      clearTimeout(first);
      clearTimeout(again);
      clearTimeout(off);
    };
  }, [key]);
  return (
    <View ref={node} collapsable={false}>
      {children}
      {hit && <CueRing on={ring} radius={round} inset={3} />}
    </View>
  );
}
