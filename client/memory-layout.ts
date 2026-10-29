import type { GuardrailEntry } from "../shared/guardrails";
import type { MemorySort } from "../shared/settings";

/** The Memory page's ordering and grid (GUARDRAILS-SPEC §7.4). Pure: no React. */

/** Grid columns for the page's width: one per 280 pt, two to four. */
export const gridColumns = (width: number) => Math.max(2, Math.min(4, Math.floor(width / 280)));

const usedCards = (e: GuardrailEntry) => new Set(e.counts.usedBy.map((u) => u.taskId)).size;

/** Pinned first, then by the chosen order; ties go to the newer entry. */
export function sortNotes(entries: readonly GuardrailEntry[], sort: MemorySort): GuardrailEntry[] {
  const key = (e: GuardrailEntry) => (sort === "used" ? usedCards(e) : 0);
  const at = (e: GuardrailEntry) => (sort === "recent" ? e.counts.usedAt || "" : "");
  return [...entries].sort(
    (a, b) => Number(!!b.pinned) - Number(!!a.pinned) || key(b) - key(a) || at(b).localeCompare(at(a)) || b.createdAt.localeCompare(a.createdAt),
  );
}

/** About how tall a card renders in a column this wide; the body clamps near five lines, so this stays close. */
export function estimateHeight(e: GuardrailEntry, width: number) {
  const chars = Math.max(20, Math.floor((width - 28) / 7));
  const lines = (text: string) => text.split("\n").reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / chars)), 0);
  const content = 18 + 8 + lines(e.text) * 20 + (e.body ? 8 + lines(e.body) * 18 : 0) + (e.tags?.length ? 8 + 16 : 0) + 8 + 16;
  const source = e.source?.taskId || e.sources.length ? 36 : 0;
  return Math.min(content, 104) + 8 + 32 + 24 + 2 + source;
}

/**
 * Puts each entry, in order, into the currently shortest column. An entry placed before keeps its column
 * (`previous`) so a background refresh does not reshuffle the grid or remount a card being edited.
 */
export function placeMasonry<T extends { id: string }>(items: readonly T[], columns: number, height: (item: T) => number, previous?: ReadonlyMap<string, number>): T[][] {
  const out: T[][] = Array.from({ length: columns }, () => []);
  const sums = new Array<number>(columns).fill(0);
  for (const item of items) {
    const kept = previous?.get(item.id);
    const column = kept !== undefined && kept < columns ? kept : sums.indexOf(Math.min(...sums));
    out[column].push(item);
    sums[column] += height(item);
  }
  return out;
}
