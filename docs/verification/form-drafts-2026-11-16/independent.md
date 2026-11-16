# Independent verification: form drafts (commit 652cef6)

- Verifier session: `verifier`, model `claude-haiku-5-5`
- Commit under test: `652cef6` (branch `fix/form-drafts`), spec `docs/FORM-DRAFTS-SPEC.md` §6
- Machine Node: v23.11.0 (default). CI version Node 24 used as a second run (`npx -y -p node@24`).
- Worktree `/tmp/flowly-verify-652cef6` created, `npm ci` exit 0 (no fallback needed). Removed afterwards.

## Part A: exact-commit checks

| Check | Command | Exit | Result |
|---|---|---|---|
| Typecheck | `npm run typecheck` | 0 | clean |
| Full suite, Node 23 | `NODE_ENV=test FLOWLY_TELEMETRY=0 npm test` | 1 | files: 1 failed, 167 passed, 1 skipped (169). tests: 1 failed, 1517 passed, 6 skipped (1524) |
| Full suite, Node 24 (run 1) | same, via `npx -y -p node@24` | 1 | tests: 1 failed, 1517 passed, 6 skipped. Failure below (load timeout) |
| `server/tool-server.test.ts`, Node 24 | focused rerun | 0 | 12/12 passed |
| Full suite, Node 24 (run 2) | same | 0 | files: 168 passed, 1 skipped (169). tests: 1518 passed, 6 skipped (1524) |
| Focused suites, Node 24 | `server/form-drafts.test.ts client/form-draft-saver.test.ts client/task-draft.test.ts client/catalog.test.ts server/guardrails.test.ts` | 0 | 5/5 files, 41/41 tests passed |

Focused suites were run under Node 24 only.

### The sqlite claim

Confirmed.

- Node 23 on `652cef6`: `server/sqlite-store.test.ts` "a write that fails inside the transaction changes neither the database nor the cache" fails.
- Node 23 on `origin/main` (fetched, fresh worktree): the same test fails (31 passed, 1 failed of 32). So it is not caused by this commit.
- Node 24: `server/sqlite-store.test.ts` passes 32/32.

Raw output of the Node 23 failure:

```
FAIL  server/sqlite-store.test.ts > writes > a write that fails inside the transaction changes neither the database nor the cache
Error: cannot start a transaction within a transaction
 ❯ transaction server/sqlite-storage.ts:185:6
 ❯ SqliteBoard.save server/sqlite-storage.ts:220:18
```

### Other failure (Node 24, run 1, not reproduced)

`server/tool-server.test.ts > CLI runs a complete scoped flow; replay, wrong env, snapshots and flags`: `Error: Test timed out in 30000ms.` It passed alone (12/12) and in the full run 2 (exit 0). It looks like a timing flake under load from the parallel suite. I did not change any test.

## Part A.3: do the focused tests cover spec §6?

| §6 item | Covered by | Gap |
|---|---|---|
| 1. Close/reopen restores text, choices, images; same after reload | `task-draft.test.ts:7` (restore of fields, operationId); `form-draft-saver.test.ts:34` (close flushes pending change) | No test of the Esc/Cancel/backdrop path or of a client reload. Image restore is not tested at the client level. |
| 2. Plain/prefilled, projects and cards do not share drafts | `server/form-drafts.test.ts:30` (keys separate projects, cards, prefill sources) | Key separation is tested on the server only. Nothing checks that the form actually uses the per-prefill key. |
| 3. Stale `baseRevision` refused; invalid data preserved | `server/form-drafts.test.ts:57` (stale refused), `:97` (invalid preserved); `form-draft-saver.test.ts:78` (conflict, overwrite) | Covered. |
| 4. Failed load never saves; failed save keeps form with Retry and Close without saving | `form-draft-saver.test.ts:89` (no save after failed load); `:56` (failed save keeps input unsaved, discard drops only unsaved) | The `DraftNotice` buttons (`client/form-draft.tsx:142`) and the form staying open are not tested. |
| 5. Successful create clears draft; failed create keeps it; card created while agent fails to start is not created again | Nothing directly. `task-draft.test.ts` only round-trips `operationId`. | **Gap.** No test for clear-after-create (`forms.tsx:658`, `session-create.tsx:149/218`), for failed create keeping the draft, or for retry reusing the operationId. This is the riskiest item (duplicate card). |

Two more gaps, not in the spec list:

- If the clear after a successful create fails, the code only shows a toast (`forms.tsx:658`). A reopened New task form would then restore the old fields and `operationId`. Whether the daemon's create is idempotent on that `operationId` was not checked by these suites. Someone should confirm it, because it decides whether this path can make a second card.
- The `catalog.test.ts` and `guardrails.test.ts` suites pass but do not test drafts.

## Part B: live UI, UNRUN

- Fixture not created. No project, card, session or temp directory was created, so there is nothing to clean up. `paseo project ls` shows 12 projects, the same 12 as before my session. `/tmp/flowly-drafts-fixture-*` does not exist.
- Reasons:
  - `docs/promo/shot-lib.mjs` `launch()` failed: Playwright's default Chromium path is missing. I used the cached Chrome for Testing under `~/Library/Caches/ms-playwright/chromium-1234` via `PLAYWRIGHT_CHROMIUM_PATH`.
  - The cached Playwright build does not know the `local-network-access` permission. I ignored that error.
  - Through the Flowly project chooser, "New project" did not open a form in headless runs. The clicks landed on the user's own Flowly board, which is the active project in the default view. I stopped there rather than keep clicking on the user's live projects.
- Side effect: the probes only viewed the user's Flowly board in a separate headless browser context. They did not change any data and did not touch the user's windows. Probe screenshots were deleted; none are kept as evidence.
- Not run: desktop 1700x1000 and compact 430x900 checks, Esc/reopen, reload restore, per-entry separation, image attach, create-clears-draft.

## Cleanup

- Worktree `/tmp/flowly-verify-652cef6` removed. Second worktree `/tmp/flowly-verify-main` (origin/main, for the sqlite check) removed, with its `node_modules` symlink removed first so the target was untouched.
- `git worktree list` now shows only `/Users/franklin/Documents/flowly` (on `fix/form-drafts`, HEAD now `089d115`, not `652cef6`; someone else moved it, I did not change it).
- Probe scripts and scratch logs removed. No files changed outside this directory.

## Totals

- Typecheck: exit 0.
- Full suite: Node 23 exit 1 (1 failure, pre-existing on `origin/main`); Node 24 exit 0 on rerun (1 run earlier failed on a timeout flake).
- Focused suites: 5/5 files, 41/41 tests passed (Node 24).
- Part B: 0 run, all UNRUN.
