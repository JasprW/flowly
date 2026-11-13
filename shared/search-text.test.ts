import { describe, expect, test } from "vitest";
import { fold, matchRanges, termsOfHit } from "./search-text";

describe("search text (SEARCH-SPEC §3, DRAWER-SPEC Focus from search 6)", () => {
  test("fold keeps length, lowercases and maps full-width ASCII", () => {
    expect(fold("ＡＢＣ　Def")).toBe("abc def");
    expect(fold("İx").length).toBe(2);
  });
  test("matchRanges finds every occurrence, case-insensitive, merged", () => {
    expect(matchRanges("Search the SEARCH page", ["search"])).toEqual([[0, 6], [11, 17]]);
    expect(matchRanges("搜索功能和搜索", ["搜索", "功能"])).toEqual([[0, 4], [5, 7]]);
    expect(matchRanges("ＰＲ link", ["pr"])).toEqual([[0, 2]]);
    expect(matchRanges("nothing", ["x", ""])).toEqual([]);
  });
  test("termsOfHit takes the snippet's marked words, folded and once each", () => {
    expect(termsOfHit({ snippet: "Fix Search and search box", ranges: [[4, 10], [15, 21]] })).toEqual(["search"]);
    expect(termsOfHit({ snippet: "…a b", ranges: [] })).toEqual([]);
  });
});
