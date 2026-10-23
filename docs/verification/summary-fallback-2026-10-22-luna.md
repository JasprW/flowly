# Summary Auto fallback — independent verification

Date: 2026-10-22 to 2026-10-23 (Asia/Singapore)

## Result

**PASS** for the requested fallback behavior and its persistence boundary. No implementation files were changed by this verification session.

## Review and evidence

- Read `AGENTS.md` and `docs/TASK-SUMMARY-SPEC.md` §§4, 8, 11. Auto must try available Haiku then Luna once each, stop on success or valid `update=false`, preserve the last summary when all candidates fail, clean each created child, keep manually selected models fixed, and never retry a model after a persistence failure.
- In `shared/summary.ts`, `resolveModels` returns only the configured model for manual selection and filters Auto models in preference order (`:241-255`). In `server/summaries.ts`, each candidate's create/wait/parse/cleanup is bounded by the retry loop; it breaks after success, while summary persistence happens after the loop (`:256-294`).
- The focused fake-SDK tests cover create/quota/runtime/idle-with-error/wait/timeout/permission/bad-output fallback, success and `update=false` stop, both-fail preservation, child cleanup, and manual-model behavior (`server/summaries.test.ts:129-172,223-239`).
- Added a verification-only test at `summary-fallback-2026-10-22-luna.persistence.test.mjs`. It injects a write failure after a successful Haiku result and verifies there is exactly one model creation, that child cleanup ran, that the previous summary remains, and that the persistence error is recorded. This file is under `docs/verification/`, not product source; its temporary directory is removed in `afterEach`.
- The parent session's real Paseo refresh evidence is in `summary-fallback-2026-10-22-live.json`: Haiku child `7fd2b644-72af-451e-ae25-5d6c3a0eb864`, then Luna child `728b0aed-a324-44ef-99c3-069371e725b5`; summary `5033c156-d0db-4f6a-a88d-e63a51782427` was stored with `model=codex/gpt-6-luna`. Both children were absent afterward, and `summaryModel` remained Auto (`""`). This live check was performed by the parent session, not this test session.

## Checks

| Check | Result | Evidence |
| --- | --- | --- |
| `npx vitest run server/summaries.test.ts shared/summary.test.ts` | **PASS** — 2 files, 41 tests | `summary-fallback-2026-10-22-luna-focused.log` |
| `npx vitest run docs/verification/summary-fallback-2026-10-22-luna.persistence.test.mjs` | **PASS** — 1 test | `summary-fallback-2026-10-22-luna-persistence.log` |
| `npm run typecheck` | **PASS** — exit 0, no diagnostics | `summary-fallback-2026-10-22-luna-typecheck.log` |
| `npm test` | **PASS** — 110 files, 948 tests | `summary-fallback-2026-10-22-luna-full.log` |
| `git diff --check -- server/summaries.ts server/summaries.test.ts shared/summary.ts shared/summary.test.ts` | **PASS** — no whitespace errors | command output was empty; exit 0 |
| Real reload + manual refresh | **PASS** — parent-run | `summary-fallback-2026-10-22-live.json` |

## Checkout and ownership

- HEAD: `2a727e8af2d4908d1cc86f2905c641c1cb56b838`, branch `main` tracking `origin/main`.
- The checkout was already broadly dirty at session start. Existing target-source diffs remained unchanged through verification; current SHA-256 values for the four target files match the parent's recorded tree snapshot in `summary-fallback-2026-10-22-tree.json`. Values are in `summary-fallback-2026-10-22-luna-source-hashes.log`; target diff counts are in `summary-fallback-2026-10-22-luna-target-diff.log`.
- This session wrote only `docs/verification/summary-fallback-2026-10-22-luna.*` evidence files. It did not install/reload the plugin, change settings, create native Paseo fixtures, or modify unrelated dirty work.
