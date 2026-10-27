import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import { matchRanges } from "../shared/search-text";
import { CueRing, radius, tint, useTheme } from "./ui";

export * from "./drawer-focus-logic";
import { FOCUS_RING_MS } from "./drawer-focus-logic";

/** The words to mark in one item until the sidebar closes (DRAWER-SPEC "Focus from search" 6–7). */
export type FocusMark = { target: string; terms: readonly string[]; field?: string };
type FocusState = { key: string; target: string; found(key: string, node: View): void; mark: FocusMark | null };
const FocusContext = createContext<FocusState | null>(null);
export const DrawerFocusProvider = FocusContext.Provider;

/** The current target id (`section:…`, `event:…`, `workpad:…`, `idea:…`, `artifact:…`), or "". */
export function useFocusTarget(): string {
  return useContext(FocusContext)?.target ?? "";
}

/** The mark for this item (`event:…`, `section:progress`…), or null when it is not the one a hit opened. */
export function useMark(id: string): FocusMark | null {
  const mark = useContext(FocusContext)?.mark;
  return mark && mark.target === id && mark.terms.length ? mark : null;
}

/** `text` with the marked words highlighted (accent background, bold accent text); plain text without terms. Put inside a Label. */
export function Marked({ text, terms }: { text: string; terms?: readonly string[] | null }) {
  const { colors } = useTheme();
  if (!terms?.length) return <>{text}</>;
  const parts: ReactNode[] = [];
  let at = 0;
  matchRanges(text, terms).forEach(([start, end], i) => {
    if (start > at) parts.push(text.slice(at, start));
    parts.push(
      <Text key={i} style={{ fontWeight: "600", color: colors.accent, backgroundColor: tint(colors.accent, 0.2), borderRadius: 2 }}>
        {text.slice(start, end)}
      </Text>,
    );
    at = end;
  });
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}

/**
 * Wraps a section or row. When it is the focus target it reports its node to the drawer (which scrolls to it)
 * and shows the accent ring for a moment. Always a View, so becoming the target never remounts the children.
 */
export function FocusTarget({ id, round = radius.md, children }: { id: string; round?: number; children: ReactNode }) {
  const focus = useContext(FocusContext);
  const hit = !!focus && focus.target === id;
  // Marked words are the cue; the ring is only for targets without them.
  const marked = !!focus?.mark && focus.mark.target === id && focus.mark.terms.length > 0;
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
      {hit && !marked && <CueRing on={ring} radius={round} inset={3} />}
    </View>
  );
}
