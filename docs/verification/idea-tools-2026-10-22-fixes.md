# Astra P2/P3 fixes — 2026-10-22

Card: `5fcd00c8-2869-456a-96c8-3e1f4fa8b637` (扩展idea工具).
Input: [Astra review](idea-tools-2026-10-22-astra.md) and the user's instruction to fix both findings.
Baseline: `fab80456ead870e7b7e6a493bae276ee878e34fd`, dirty=true. Shared checkout; unrelated changes preserved.

## Changes

- P2: idea proposal/update/removal receipts now persist optional `ideaId`. Replay prefers that stable result ID before the legacy request/entity fallback. Removing or pruning an idea cannot remove its new receipt's result identity. The additive schema preserves old receipts; an old proposal receipt can still resolve a retained entity. An already removed old entity's missing ID cannot be recovered retroactively.
- P3: `client/drawer.tsx` maps `idea_edited` / `idea_removed` through module-level `msg("Edited the idea")` / `msg("Removed the idea")`; all nine non-English catalogs include both translations. No layout change.
- IDEAS-SPEC documents receipt persistence, old-data boundaries, localization and regressions. Existing onboarding guidance covers the user interaction; no tour/tip/What's new change is warranted for these fixes.

## Regression evidence

1. Before the implementation fix, `npx vitest run server/agent-service.test.ts -t 'proposal replay keeps the idea ID'` failed as expected (1 failed / 52 skipped): the replay after removal and service reload lacked `ideaId`.
2. After the fix, `npx vitest run server/agent-service.test.ts shared/i18n.test.ts` passed: 2 files / 97 tests, 12.31 seconds.
3. New regressions cover propose → remove → reload BoardStore/AgentService → replay proposal with the original idea ID and receipt, empty ideas, unchanged task/project revisions and unchanged board bytes; a legacy receipt without `ideaId` still resolves a retained entity without rewriting the board.
4. Existing catalog checks see both module-level literal keys through `msg()` and require complete, non-empty, placeholder-correct entries in all languages.
5. `git diff --check` on the touched source/spec files passed.

Independent final typecheck/full-suite and locale-function results are recorded by [Luna](idea-tools-2026-10-22-fixes-luna.md), session `5affa8a0-d7fc-49c0-8842-d70c65bbbcba`, created with `codex/gpt-6-luna`, `full-access`, using the current Luna Worker profile's xhigh reasoning.

## Installed MCP verification and cleanup

- After Luna's typecheck/full-suite PASS, `paseo plugin reload flowly` exited 0 and reported running. No daemon restart or separate installation was needed for this local source installation.
- Temporary idea: `dd1622ca-c83c-4a87-bd3d-5630001bec4b`.
- Proposal event: `0b9efe9b-a848-4d44-bb78-194bc8485d48`; its returned receipt persisted the same `ideaId`.
- Removal event: `02cb0a54-63fe-4334-a108-7abefef71603`; the returned ideas list was empty.
- Replaying the original proposal request after removal returned `replayed=true`, the original idea ID and a byte-equivalent JSON receipt. A fresh get_task confirmed no idea was resurrected, exactly one proposal and one removal event were present, and Test/task revision=9/project revision=7 remained unchanged.
- Luna independently passed `npm run typecheck` and `npm test` (110 files / 938 tests), plus 18 runtime translations across nine non-English locales. Its report records matching source hashes before and after those checks.
- Cleanup: the only new runtime idea was removed; the parent archived and deleted only Luna test session `5affa8a0-d7fc-49c0-8842-d70c65bbbcba`. Native lookup returns not found; fresh get_task lists the two pre-existing card sessions and no ideas. No extra workspace/project/fixture was created.

## Boundaries

No commit/push/release was requested. Native desktop/compact rendering is UNRUN; source/catalog and locale-function checks establish translation behavior, not on-screen rendering. No UI-window actions were taken. Both Astra findings are resolved by the focused regressions, independent checks and installed MCP result above; the original review remains unchanged as historical evidence.
