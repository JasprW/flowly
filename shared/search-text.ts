/** Search text matching shared by the daemon (SEARCH-SPEC §3) and the drawer's highlight (DRAWER-SPEC "Focus from search"). */

/** Case and full-width ASCII folded, one UTF-16 unit for one, so match positions index the original text. */
export function fold(value: string): string {
  const width = value.replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/　/g, " ");
  const lower = width.toLowerCase();
  if (lower.length === width.length) return lower;
  let out = "";
  for (const ch of width) {
    const l = ch.toLowerCase();
    out += l.length === ch.length ? l : ch;
  }
  return out;
}

/** Where folded `terms` occur in `text`, sorted and merged, as `[start, end)` UTF-16 offsets. */
export function matchRanges(text: string, terms: readonly string[]): [number, number][] {
  const lower = fold(text);
  const ranges: [number, number][] = [];
  for (const term of terms) {
    if (!term) continue;
    for (let at = lower.indexOf(term); at >= 0; at = lower.indexOf(term, at + term.length)) ranges.push([at, at + term.length]);
  }
  ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return merged;
}

/** The words a hit matched: its snippet's ranges, folded and deduplicated (so #tag filters are never highlighted). */
export function termsOfHit(hit: { snippet: string; ranges: readonly (readonly [number, number])[] }): string[] {
  const terms: string[] = [];
  for (const [start, end] of hit.ranges) {
    const term = fold(hit.snippet.slice(start, end));
    if (term && !terms.includes(term)) terms.push(term);
  }
  return terms;
}
