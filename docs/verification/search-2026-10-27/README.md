# Verification report: commit 8818b45 (feat/search, PR #71)

Verifier: independent session (did not write the code). Worktree: `/private/tmp/flowly-search-verify` (detached at 8818b45, `node_modules` symlinked to the main checkout), removed at the end.

Not part of this run: the UI check (§11 UI实测) and the user-data dry run. Neither was performed here.

## Commands and results

| Command | Exit | Result |
|---|---|---|
| `npm run typecheck` | 0 | `tsc --noEmit` clean |
| `npm test` | 0 | 138 files passed; 1183 tests passed, 1 skipped (1184) |
| `npx vitest run server/search.test.ts server/tool-server.test.ts client/onboarding-logic.test.ts shared/i18n.test.ts` | 0 | 4 files passed; 142 tests passed, 0 failed, 0 skipped |

Scratch check (not committed, file removed): a `SearchService` whose `memoryOn` flips from true to false between two `query()` calls still returned the memory entry on the second call. Failure output: `expected [ { id: 'm', ... } ] to have a length of +0 but got 1`.

## §11 coverage (implementer items 1–10)

| # | Item | Covered by | Notes |
|---|---|---|---|
| 1 | Each source hits its field; non-searched content stays out | `sources (§2)` `test.each` (`server/search.test.ts`); `"systemword"`, `"archivedword"`, `"receiptword"`, `"oldsummaryword"`, `"candidateword"` not searched | Archived project: `archived projects are left out`. Artifact external **title** not tested (see F3). |
| 2 | Multi-term across sources; quoted phrase; `#tag` and `#prefix/` | `every word must appear somewhere in the card, across sources`; `quoted phrases match as a whole`; `#tag and #prefix/ filter like the board` | Covered. |
| 3 | Case / full-width fold; 1- and 2-char CJK | `case and full-width letters match; one or two Chinese characters match`; `case and full-width ASCII fold without changing length` | Covered. |
| 4 | Snippet ≤160; ranges point at the hit; ≤3 hits per card | `a window around the first match…`; `at most three hits per card, best weight first` | Covered. |
| 5 | Ranking: weight → open/closed/archived → recency; memory after cards | `best field, then open before closed before archived, then recency` | "Memory after cards" is only true by output shape; not asserted. |
| 6 | `limit`/`truncated`; `projectId: null` excludes archived; unknown/archived → `Project not found.`; invalid input rejected | `limit and truncated; project scope`; `results follow the schema; null project…`; `unknown or archived projects and invalid input are errors` | Covered. Truncated-by-memory case not tested (F2). |
| 7 | Corrupt summaries/memory: rest returned, `partial` correct | `an unreadable summaries or memory file leaves the rest and is reported in partial` | Covered for the RPC; agent path not asserted (F5). |
| 8 | `flowly_search`: own project, own card excluded, no memory, latest summary ≤400; CLI = HTTP | `flowly_search: own project only…` (`server/search.test.ts`); `flowly_search over HTTP and the CLI…` (`server/tool-server.test.ts:546`, asserts `JSON.parse(cli.stdout)` equals the HTTP result) | Covered. |
| 9 | Performance: 10× data (~5 万事件), one search ≤50 ms | `performance: one search over ten times…` (`server/search.test.ts:309`): 1130 tasks, 48 000 events, worst of 5 queries < 50 ms | Covered; wall-clock assertion can flake on a loaded runner (Low). |
| 10 | Onboarding tip rule; i18n | `search follows card display and comes before the connectors tip` (`client/onboarding-logic.test.ts:83`); i18n test passes | Covered. |

## Findings

**Medium**

- **F1: global memory switch is not applied until the cache key changes.** `server/search.ts:303-311`: the index key is `board.revision|summaries stamp|memory stamp`, and memory is filtered by `this.io.memoryOn(p)` only at rebuild time. The global switch (`setMemoryEverywhere`, `server/memory.ts:122`, set from `index.server.ts:82-84`) changes none of those, so after the user turns project memory off globally, active memory keeps appearing in `search.query` until the next board write or memory-file change. Spec §2 says memory is not searched when it is off globally. Verified with the scratch test above. No test covers a changing `memoryOn`; the existing "memory off for a project" test builds a fresh service. Fix: include `memoryOn` results in the key, or filter memory at query time.

**Low**

- **F2: wrong footer when only memory is truncated.** `client/search-page.tsx:273-276` shows "Showing the first 30 cards" whenever `truncated` is true, but `runSearch` sets `truncated` also when memory exceeds 10 (`server/search.ts:256`). With 2 cards and 12 memory matches the page says "first 30 cards". Spec §5.2 does not cover this case; §3.4 defines `truncated` for both.
- **F3: spec and code disagree on artifact fields.** Spec §2 says artifacts search "外部条目的 key 和标题", but `externalRefSchema` (`shared/connectors.ts:68-76`) has no title, and `server/search.ts:131` searches only `key`. Either fix the spec wording or record the external title somewhere if it is meant to be searched.
- **F4: card-title hits hidden in the UI.** `client/search-page.tsx:102` drops hits with `source === "card" && field === "title"` from the hit rows. Spec §5.2 describes hit rows without this exception. It is reasonable (the title is already on the row), but it is unlisted; the spec should say so or the code should match.
- **F5: agent summary can come from a stale cache.** `server/search.ts:347` reads `this.summaries?.value`, which is the last successful read, not the one used for the index in `load()`. When `summaries.json` becomes unreadable, the index drops summaries but `flowly_search` still returns the old summary text. The agent path does not report `partial`.
- **F6: unlisted paths not tested.** Spec §4 "board storage unavailable → original error" and §9 "agent tool: invalid identity → same error as other flowly_* read tools" have no test. Not §11 items.

No High findings. No mismatches found in `shared/search.ts` (schemas and limits match §3.4, §4, §6) or in the tip rule and copy (§8).

Cleanup: worktree removed, `node_modules` symlink removed first, scratch test file removed from the worktree (the worktree itself is deleted).
