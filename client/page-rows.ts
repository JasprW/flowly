import { useRef, useState } from "react";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";

const BATCH = 2;

/** Incrementally mount compact project-page cards; keep every revealed row alive.
 * Counts/filtering use the full list. No timer eagerly fills the hidden tail.
 */
export function usePageRows(key: string, total: number, compact: boolean) {
  const [cursor, setCursor] = useState({ key, count: BATCH });
  const current = useRef({ key, total, compact });
  current.current = { key, total, compact };
  if (cursor.key !== key) setCursor({ key, count: BATCH });
  const limit = compact ? Math.min(total, cursor.key === key ? cursor.count : BATCH) : total;
  const more = () => {
    // An event queued by the previous filter/page must not change the new one.
    const valid = () => current.current.compact && current.current.key === key && current.current.total === total;
    if (!valid()) return;
    setCursor((previous) => {
      if (!valid()) return previous;
      const count = previous.key === key ? previous.count : BATCH;
      return { key, count: Math.max(count, Math.min(total, count + BATCH)) };
    });
  };
  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    // Native layout/size notifications at offset zero are not user scrolling.
    if (limit < total && contentOffset.y > 0 && contentSize.height > 0 && layoutMeasurement.height > 0 && contentOffset.y + layoutMeasurement.height * 1.5 >= contentSize.height) more();
  };
  return { limit, remaining: total - limit, more, onScroll: compact ? onScroll : undefined };
}

/** Keep edited rows alive across background insertions without mounting the hidden tail. */
export function keepPageRows<T extends { id: string }>(rows: readonly T[], limit: number, kept: ReadonlySet<string>): readonly T[] {
  return kept.size ? rows.filter((row, index) => index < limit || kept.has(row.id)) : rows.slice(0, limit);
}
