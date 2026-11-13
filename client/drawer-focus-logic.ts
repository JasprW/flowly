import type { SearchHit } from "../shared/search";
import { termsOfHit } from "../shared/search-text";

/** Focus from search (DRAWER-SPEC "Focus from search", SEARCH-SPEC §5.3): which drawer section and item a hit lands on. */

export type FocusSection = "progress" | "workpad" | "artifacts" | "ideas" | "activity";
export type DrawerFocus = {
  key: string;
  section: FocusSection;
  target?: string;
  /** The hit's field (`recap`, `evidence`, `detail`…) and its matched words, for the highlight. */
  field?: string;
  terms?: string[];
};
/** How long the target keeps its ring. */
export const FOCUS_RING_MS = 1600;
/** Without a rendered target by then, the section itself is the target. */
export const FOCUS_FALLBACK_MS = 1500;

/** Card-field hits have no section: the drawer just opens. */
export function focusOfHit(hit: Pick<SearchHit, "source" | "refId"> & Partial<Pick<SearchHit, "field" | "snippet" | "ranges">>): Omit<DrawerFocus, "key"> | null {
  const mark = hit.snippet !== undefined && hit.ranges ? { field: hit.field, terms: termsOfHit({ snippet: hit.snippet, ranges: hit.ranges }) } : {};
  const item = (prefix: string) => ({ ...mark, ...(hit.refId ? { target: `${prefix}:${hit.refId}` } : {}) });
  switch (hit.source) {
    case "summary":
      return { section: "progress", ...mark };
    case "note":
      return { section: "activity", ...item("event") };
    case "workpad":
      return { section: "workpad", ...item("workpad") };
    case "idea":
      return { section: "ideas", ...item("idea") };
    case "artifact":
      return { section: "artifacts", ...item("artifact") };
    default:
      return null;
  }
}

/** Activity lists the last `size` events (oldest first here); the window widens back to the target. */
export function activityStart(ids: readonly string[], target: string, size = 12): number {
  const base = Math.max(0, ids.length - size);
  const at = target.startsWith("event:") ? ids.indexOf(target.slice(6)) : -1;
  return at >= 0 && at < base ? at : base;
}

/** A paged list's limit raised (in whole pages) so the item at `index` is shown. */
export function limitFor(index: number, limit: number, page: number): number {
  return index < limit ? limit : Math.ceil((index + 1) / page) * page;
}

