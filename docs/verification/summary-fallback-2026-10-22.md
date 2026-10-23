# Summary runtime fallback verification

Date: 2026-10-22 UTC (2026-10-23 Singapore closeout).

Input: user report that Haiku reaches its limit but Auto does not fall back to Luna; no attached external inputs.

Root cause: `resolveModel` selected the first statically available model. The runtime attempted that model once and recorded failure without trying the other Auto candidate. Provider availability does not establish remaining quota.

Implementation: card Progress `SummaryService` tries the available `resolveModels` candidates in Haiku → Luna order. Each candidate is attempted at most once. Runtime errors (including an idle result with an error), creation/wait failures, timeout, permission, invalid output trigger the next candidate after cleanup. An explicit model remains fixed. A valid output stops the sequence, including `update=false`; persistence happens outside the candidate loop. All failed attempts retain the old summary and report model-specific errors. No global settings or UI changes.

## Evidence

- HEAD `2a727e8af2d4908d1cc86f2905c641c1cb56b838`, dirty=true. Exact four-file hashes: [tree manifest](summary-fallback-2026-10-22-tree.json). Shared checkout contains unrelated edits, which were preserved.
- PASS: `npx vitest run server/summaries.test.ts shared/summary.test.ts`: 2 files / 41 tests, both primary and independent Luna executions. Coverage includes quota errors, idle error plus stale JSON, quota text without JSON, timeout, permission, malformed schema, creation and wait exceptions, success/no-update stop, explicit model failure, exhausted candidates and cleanup.
- PASS: independent `npm test`: 110 files / 948 tests; one separate persistence-failure test also passed. [Full log](summary-fallback-2026-10-22-luna-full.log), [persistence log](summary-fallback-2026-10-22-luna-persistence.log).
- PASS: independent `npm run typecheck`, exit 0. [Log](summary-fallback-2026-10-22-luna-typecheck.log).
- PASS: `paseo plugin reload flowly` after typecheck; status running from this checkout. No daemon restart.
- PASS live: `node docs/verification/summary-fallback-2026-10-22-live.mjs`, exit 0. [Raw evidence](summary-fallback-2026-10-22-live.json). Existing setting was `summaryModel=""` (Auto), with summary/digest/retro enabled. The script never writes settings. Existing card `e5ea7edb-8453-4c19-8882-14aecc50c770` was refreshed; no test project/workspace/card was created.
- Observed Haiku child `7fd2b644-72af-451e-ae25-5d6c3a0eb864` at 15:59:16.434Z, followed by Luna child `728b0aed-a324-44ef-99c3-069371e725b5` at 15:59:20.422Z. Summary `5033c156-d0db-4f6a-a88d-e63a51782427` saved at 15:59:29.417Z with model `codex/gpt-6-luna`; no card error remained. Both child IDs returned absent from native refresh after completion. The failed Haiku child's exact provider error was not retained before deletion; the quota reason is covered explicitly by the fake SDK regression rather than claimed as captured runtime text.
- Independent test session: `629af9b7-61dd-4941-a32a-2ca4892ffa0f`, `codex/gpt-6-luna`, mode `full-access` at creation, profile thinking `xhigh`. [Independent report](summary-fallback-2026-10-22-luna.md) contains full-suite results and an extra persistence-failure check.

## Scope and remaining checks

No client change, so desktop/compact rendering was not re-tested. No tour/tip/What's new is warranted for restoring the existing Auto behavior. Other AI callers (digest, outside-session insights and memory review) still use the single-model resolver; extension was proposed as an idea. No commit or push requested.

Cleanup: independent test session `629af9b7-61dd-4941-a32a-2ca4892ffa0f` was hard-deleted with `paseo delete <exact-id> --json`; subsequent `paseo inspect <exact-id> --json` reported no matching agent. Flowly get_task lists only the original card session. The earlier MCP kill closed the session but did not delete it; the explicit hard-delete completed cleanup. No fixture projects, cards, workspaces, settings changes or temporary build directories remain.
