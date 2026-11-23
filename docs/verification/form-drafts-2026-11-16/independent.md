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

## Re-run on ea6e7f7

Commit under test: `ea6e7f7` (branch `fix/form-drafts`), after `847afb3` (8 review fixes). Worktree `/tmp/flowly-verify-ea6e7f7` created, `npm ci` exit 0, removed afterwards. Part B skipped as instructed (implementer's own evidence is in `ui.md`).

| Check | Command | Exit | Result |
|---|---|---|---|
| Typecheck | `npm run typecheck` | 0 | clean |
| Full suite, Node 23 | `NODE_ENV=test FLOWLY_TELEMETRY=0 npm test` | 1 | files: 1 failed, 167 passed, 1 skipped (169). tests: 1 failed, 1519 passed, 6 skipped (1526). Failure: the same `server/sqlite-store.test.ts` transaction test as before (pre-existing on `origin/main`) |
| Full suite, Node 24 (run 1) | same, via `npx -y -p node@24` | 1 | tests: 1 failed, 1519 passed, 6 skipped. Failure: `server/tool-server.test.ts` CLI flow, `Test timed out in 30000ms` (same flake as before) |
| `server/tool-server.test.ts`, Node 24 | focused rerun | 0 | 12/12 passed |
| Full suite, Node 24 (run 2) | same | 0 | files: 168 passed, 1 skipped (169). tests: 1520 passed, 6 skipped (1526) |
| Focused suites, Node 24 | `server/form-drafts.test.ts client/form-draft-saver.test.ts client/task-draft.test.ts client/catalog.test.ts server/guardrails.test.ts` | 0 | 5/5 files, 43/43 tests passed (was 41; the 2 new tests are below) |

Node 23 sqlite failure is the same as before; the Node 23 run was not repeated because the Node 24 result is the CI-equivalent one.

### Review of 847afb3: is each fix real, and tested?

| Fix | Real? | Tested? |
|---|---|---|
| Saver bound to its own draft key (`client/form-draft.tsx`, `key!` instead of `keyRef`) | Yes: the closure captures the key the saver was built for. | No. Nothing covers a pending save across a key change. |
| `retrySave` conflict path: read errors are caught, conflict kept, Retry stays | Yes. | No. |
| `persist` before the first create (`forms.tsx:629`) | Yes: `operationId` is saved before `paseo`/create runs, and a failed persist returns before create. The `busy` flag is reset in the existing `finally`. | No. There is no test of the order or of a failed persist. |
| Close during save blocks create; running create defers close (`closing`/`busy` checks in `forms.tsx` and `session-create.tsx`) | Yes, as far as read: `save()` returns early when `closing` or `busy` is set, and `requestClose` no longer closes while `busy`. | No. |
| Prepared session attempts per draft key (`session-create.tsx`, `Map` keyed by `key`) | Yes: a card's attempt and an idea's attempt no longer overwrite each other. | No. |
| Unknown external providers dropped on restore (`task-draft.ts`, `hasOwnProperty(providerInfo)`) | Yes. `toString` and retired providers are rejected. | Yes: `client/task-draft.test.ts` new test (`github` kept; `retired-service` and `toString` dropped). |
| fsync before rename; temp file removed on failure (`server/form-drafts.ts`) | Yes in the code. | Partly: `server/form-drafts.test.ts` new test checks no `.tmp` file is left and the previous draft survives a failed write (chmod 0500 on the directory). It does not check fsync. The test uses chmod, so it does nothing as root. |
| Failed old-image cleanup after commit no longer deletes new images; error logged with `logFailure` | Yes: the cleanup is moved after the commit and wrapped in `.catch`. | Not directly. The new test does not cover a cleanup failure. |

Item 5 duplicate-card claim: **confirmed**, with a caveat.

- `server/service.ts:474-478`: `createCard` is serialized and returns an existing card with the same `operationId` before any workspace is created. `store.mutate` at line ~578 checks again.
- `server/service.test.ts:84`: calls `createTask` twice with the same input, expects the same card id and `x.create` called once. That is the only test of this path, and it sits inside a test named for native-root sourcing. It covers a retry after success, not a retry after a failure partway through.
- `client/task-draft.test.ts`: round-trips `operationId` through restore. It does not prove the form sends it again.

## Still untested

- Retry after a lost response or crash mid-create, i.e. a workspace created but no card written. The Paseo-side `idempotencyKey` (`service.ts:555`) is the only protection there, and no test covers it.
- The UI sequence: persist → create → clear, and a failed persist keeping the form open. Client UI logic has no tests in these suites.
- Clear after a successful create fails: the draft stays and the form can be reopened with the old `operationId`. The result is an idempotent re-create, which is probably safe, but not tested.
- Key binding across a key change; retry after a conflict-read error; the close-vs-create race; per-key prepared attempts; the image-cleanup-failure path.
- Spec §6 items 1 (Esc/Cancel reopen, reload), 2 (client key use), 4 (`DraftNotice` buttons) are still as in the first report.
- Part B (live UI) is not run by me in either pass; see `ui.md` for the implementer's probe.

## Run on 92aa208

Commit under test: `92aa208` (branch `fix/form-drafts`, PR #116). Worktree `/tmp/flowly-verify-92aa208` created from the commit; `npm ci` exit 0 (not symlinked). Worktree removed afterwards.

Node: machine `node -v` = v23.11.0; CI-equivalent via `npx -y -p node@24` = v24.22.3.

Model: claude-haiku-5-5 (independent verifier). Session title: not known to me; the requesting session is titled "修复".

| Check | Command | Exit | Result |
|---|---|---|---|
| Typecheck | `npm run typecheck` | 0 | clean |
| Full suite, Node 24 | `NODE_ENV=test FLOWLY_TELEMETRY=0 npx -y -p node@24 -- node node_modules/vitest/vitest.mjs run` | 0 | files: 168 passed, 1 skipped (169). tests: 1527 passed, 6 skipped (1533). No rerun needed |
| Full suite, Node 23 | `NODE_ENV=test FLOWLY_TELEMETRY=0 npm test` | 1 | files: 1 failed, 167 passed, 1 skipped (169). tests: 1 failed, 1526 passed, 6 skipped (1533). Only failure: `server/sqlite-store.test.ts` "a write that fails inside the transaction changes neither the database nor the cache" (known Node 23 issue, see below) |
| Focused suites, Node 24 | `server/form-drafts.test.ts client/form-draft-saver.test.ts client/task-draft.test.ts client/catalog.test.ts server/guardrails.test.ts` | 0 | 5/5 files, 50/50 tests passed |

Note: my first Node 23 run printed `exit=0` because the shell captured the exit code of `$(node -v)` in the echo, not of `npm test`. Rerun with the exit code captured directly: exit 1, same single failure.

Node 23 failure output (only the failing test, raw):

```
FAIL  server/sqlite-store.test.ts > writes > a write that fails inside the transaction changes neither the database nor the cache
Error: cannot start a transaction within a transaction
 ❯ transaction server/sqlite-storage.ts:185:6
 ❯ SqliteBoard.save server/sqlite-storage.ts:220:18
```

This is the same known Node 23 failure as in earlier runs. Node 24 passes it.

### Coverage of the behavior changes in `ea6e7f7..92aa208` (client, server, shared)

| Behavior change | Covered by | Verdict |
|---|---|---|
| Unread draft not cleared after a failed load (`form-draft.tsx` `clear()` returns when `status !== "ready"`) | none. `useFormDraft` has no test | **Not covered** |
| operationId kept in memory after a failed load (`unsavedOperations` map, `persist`/`unsavedOperation`) | none | **Not covered** |
| Cleanup errors logged without masking the save error (`logFailure` `.catch` in `server/form-drafts.ts` temp and image rollback) | none. No test mocks `logFailure` or forces the cleanup to fail | **Not covered** |
| Cleared revision recorded as revision+1 | `server/form-drafts.test.ts` "revisions never repeat after a clear…" (read returns revision 2 after clearing revision 1) | Covered |
| Clear only for the matching revision (`clear(key, revision)` returns `ok:false` on mismatch) | `server/form-drafts.test.ts` "a window still holding the cleared revision…" and "a clear naming an older revision keeps the newer draft" | Covered |
| Over-limit text saved empty (`fitDraftFields`) | `client/form-draft-saver.test.ts` "text longer than a draft holds is saved empty…". Server-side limit not tested here | Covered (client function only) |
| Retry after a failed load merges typed and loaded content (`mergeAfterFailedLoad`) | `client/form-draft-saver.test.ts` "Retry after a failed load keeps what was typed and what was saved". Pure function only; the hook wiring is not tested | Covered (function only) |
| Conflict Retry uses `read()`'s revision (`overwriteLatest`) | `client/form-draft-saver.test.ts` "conflict retry after a clear uses the revision read reports, not 0" | Covered |

Also new in `2d53e0c`..`92aa208`: `read()` now returns `{ revision, draft }`; covered by the updated "a saved draft reads back" test. `clearFormDraft` takes an optional `revision` (RPC schema); covered by the clear tests above.

Uncovered, by reading only: the three "not covered" rows. Their code paths were checked by reading `client/form-draft.tsx` and `server/form-drafts.ts` diff; the behavior is not exercised by any test or UI run here.

### Summary

- Typecheck exit 0.
- Node 24 (CI-equivalent): full suite exit 0, 1527 tests passed, 6 skipped. Focused suites 50/50.
- Node 23: exit 1, one failure, the known sqlite-store transaction test; nothing else failed.
- 5 of 8 listed behavior changes have a test (3 of them only at the pure-function level). 3 have none: unread-draft-not-cleared, operationId kept after failed load, and cleanup-error logging without masking.

## Run on 15c9d2f

Commit under test: `15c9d2f` (branch `fix/form-drafts`, PR #116). Worktree `/tmp/flowly-verify-15c9d2f` created with `git worktree add --detach`; `npm ci` exit 0 (real install, not symlinked); `git rev-parse HEAD` = `15c9d2f8c1f2c82241411dc781bf356b51633c89`. Worktree removed with `git worktree remove --force`; `git worktree list` shows only the main checkout, the path is gone, and the main checkout is clean.

Node: machine `node -v` = v23.11.0; CI-equivalent `npx -y -p node@24 -- node -v` = v24.22.3.

Model: claude-haiku-5-5 (independent verifier). No Paseo session or workspace was created; no push or commit.

| Check | Command | Exit | Result |
|---|---|---|---|
| Typecheck | `npm run typecheck` | 0 | clean |
| Full suite, Node 24, run 1 | `NODE_ENV=test FLOWLY_TELEMETRY=0 npx -y -p node@24 -- node node_modules/vitest/vitest.mjs run` | 1 | files: 168 passed, 1 skipped (169). tests: 1554 passed, 6 skipped (1560). Vitest reported 1 unhandled error (see raw output below); no test failed |
| Full suite, Node 24, run 2 (rerun) | same | 0 | files: 168 passed, 1 skipped (169). tests: 1554 passed, 6 skipped (1560). No errors |
| Full suite, Node 23 | `NODE_ENV=test FLOWLY_TELEMETRY=0 npm test` | 1 | files: 1 failed, 167 passed, 1 skipped (169). tests: 1 failed, 1553 passed, 6 skipped (1560). Only failure: `server/sqlite-store.test.ts` "a write that fails inside the transaction changes neither the database nor the cache" (known Node 23 issue, same as earlier runs) |
| Focused suites, Node 24 | `NODE_ENV=test FLOWLY_TELEMETRY=0 npx -y -p node@24 -- node node_modules/vitest/vitest.mjs run server/form-drafts.test.ts client/form-draft-saver.test.ts client/task-draft.test.ts shared/i18n.test.ts` | 0 | 4/4 files passed, 74/74 tests passed |

Raw output, failures only:

Node 24 run 1 (exit 1, not reproduced in run 2):

```
Vitest caught 1 unhandled error during the test run.
This might cause false positive tests. Resolve unhandled errors to make sure your tests are not affected.

⎯⎯⎯⎯ Unhandled Rejection ⎯⎯⎯⎯⎯
EnvironmentTeardownError: [vitest-worker]: Closing rpc while "onUserConsoleLog" was pending
This error originated in "server/summaries.test.ts" test file. It doesn't mean the error was thrown inside the file itself, but while it was running.
```

Node 23 (exit 1):

```
FAIL  server/sqlite-store.test.ts > writes > a write that fails inside the transaction changes neither the database nor the cache
Error: cannot start a transaction within a transaction
 ❯ transaction server/sqlite-storage.ts:185:6
 ❯ SqliteBoard.save server/sqlite-storage.ts:220:18
```

### Coverage of the behavior changes in `5bd30f1..15c9d2f` (client, server, shared)

| Behavior change | Covered by | Verdict |
|---|---|---|
| Drafts of archived/removed scopes dropped by prune keep a revision marker (`server/form-drafts.ts` prune) | `server/form-drafts.test.ts` "a draft dropped with its archived scope keeps its revision marker…" | Covered |
| Read of a dropped draft returns revision+1; a stale window cannot save after a restore (`read`, `save`) | same test | Covered |
| Clear leaves revision+1 marker instead of deleting it (`clear`) | same test; the earlier clear tests still pass | Covered |
| Temp-file and image rollback cleanup failures logged with `logFailure` (`server/form-drafts.ts`) | none | **Not covered** (code reading only) |
| `clearAfterSaves`: discard, disable, flush, clear the revision produced; `false` when another window saved newer | `client/form-draft-saver.test.ts` "clearing after a create waits for a save on its way and names the revision it produced" | Covered (function level) |
| `readAfterSaves`: pending save lands before read; superseded load applies nothing | `client/form-draft-saver.test.ts` "a reload saves pending edits before it reads, and a superseded load applies nothing" | Covered (function level) |
| `readAfterSaves`: failed save reads nothing and keeps the edit pending | `client/form-draft-saver.test.ts` "a reload whose save fails reads nothing and keeps the edit pending" | Covered (function level) |
| `FailedLoadEdits`: edits survive failed retries of the same key; never carried to another key | `client/form-draft-saver.test.ts` "edits made while a load failed survive failed retries and are merged only into the same key" | Covered (class level) |
| `mergeAfterFailedLoad` with `imageLimit`: added images kept, saved ones that do not fit counted in `leftOut` | `client/form-draft-saver.test.ts` "a merge never holds more images than the form…" | Covered (function level) |
| `useFormDraft` wiring: load id supersedes older loads, closed/keyed-out loads dropped, flush on close, `clear()` throws the "could not be loaded" / "changed in another window" messages | none directly; the functions it calls are covered above | **Not covered** at hook level |
| `DraftNotice`: Retry disabled while a create is busy; "left out" notice (`client/form-draft.tsx`) | none | **Not covered** |
| `session-create.tsx` / `forms.tsx`: shared `busy` guard; a failed clear after create shows a toast instead of being silent | none | **Not covered** |
| `forms.tsx`: image limit passed to `useFormDraft` (`maxImages`, `cardImageLimit`) | none | **Not covered** |
| Session chips: board pushes drive rounds; stream startup reconciles once; idle means no timed rounds (`client/session-link.ts`) | `client/session-chips.test.ts` "with board pushes, stream startup reconciles and archiving refreshes refs without a timed round" | Covered |
| Session chips: failed initial stream reconcile retries the full list before going idle | `client/session-chips.test.ts` "a failed initial stream reconciliation retries the full list before returning to idle" | Covered |
| Session chips: archive during a pending scan survives a stale completion (ok or failed) | `client/session-chips.test.ts` "an archive during a pending scan survives stale completion (failed=…)" | Covered |
| Session chips: failed archive scan retries after its delay or is cancelled on stop | `client/session-chips.test.ts` "a failed archive scan retries after its delay or is cancelled on stop (stop=…)" | Covered |
| Session chips: settings changes refresh the managed-session info (`chipInfoGen`) | none found in the new tests | **Not covered** (code reading only) |
| New i18n strings in 8 locales (`shared/i18n/*.ts`) | `shared/i18n.test.ts` (catalog completeness) in the focused run | Covered (presence only) |

### Summary

- Commit verified: `15c9d2f`.
- Typecheck exit 0.
- Node 24 (CI-equivalent): run 1 exit 1 (168 files and 1554 tests passed; one unhandled `EnvironmentTeardownError` from `server/summaries.test.ts` teardown, no test failed); run 2 exit 0 (168 files, 1554 tests passed, 6 skipped).
- Node 23: exit 1; the only failure is the known `server/sqlite-store.test.ts` transaction test (1553 tests passed).
- Focused Node 24: exit 0, 4/4 files, 74/74 tests.
- Coverage: 13 of 19 rows covered (several at function level only); 6 rows not covered, including image-cleanup logging, hook-level load/clear wiring, DraftNotice Retry/notice, the busy guard and failed-clear toast, the image limit wiring, and the settings-change refresh.
