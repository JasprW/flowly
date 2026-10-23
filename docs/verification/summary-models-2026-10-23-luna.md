# Summary model priority — independent Luna verification

Date: 2026-10-23 (Asia/Singapore)

## Test session and tree

- Paseo agent: `24b743be-57e7-47a2-9bc4-0ed2fa871eb2`; runtime session: `01a16462-ffb9-7bd2-b5ca-5a0fb8307562`.
- Runtime identity verified read-only with `get_agent_status`: `codex/gpt-6-luna`, `full-access`.
- HEAD: `2a727e8af2d4908d1cc86f2905c641c1cb56b838`.
- The shared worktree was already dirty. The starting status snapshot is `summary-models-2026-10-23-git-status.txt`; target source hashes are in `summary-models-2026-10-23-source-hashes.txt`. A post-run hash capture is identical (`summary-models-2026-10-23-postrun-source-hashes.txt`).
- No product files were changed by this test session. No fixture/native project, workspace, card, or session was created.

## Checks

| Check | Result | Evidence |
| --- | --- | --- |
| Focused: `npx vitest run shared/summary.test.ts server/summaries.test.ts server/summary-models.test.ts server/session-insights.test.ts server/insights.test.ts server/memory.test.ts client/onboarding-logic.test.ts shared/i18n.test.ts` | **PASS** — 8 files, 167 tests | command output in this session |
| `npm run typecheck` | **PASS** | exit 0 |
| `npm test` | **PASS** — 111 files, 958 tests | exit 0 |

## Review

- `task-summary` remains v1. The optional list is nonempty, unique, and shaped as `provider/model`; `summaryModelsOf` prefers it, otherwise preserves a legacy explicit model as a singleton, otherwise returns Haiku → Luna. Reads do not migrate/write settings. Settings edits save `summaryModels` and clear `summaryModel` together.
- Runtime discovery is limited to configured providers. Resolution retains configured order while excluding unavailable providers, absent models, and non-selectable models; no runnable candidates produces an English error before any child is created.
- The shared runner tries each resolved candidate once, treats non-idle and idle-with-error results or parse failures as failures, cleans each created child before retrying, and returns the successful model. Persistence remains after the runner, outside retry handling.
- Card summaries, outside-session insights, daily digests, and finished-card memory reviews use the runner. Their prior workspace/parent scopes and cleanup strategies remain intact. Workflow insights keeps its separate model setting and uses the summary list only for its existing last-resort choice.
- Settings and the welcome tour share `SummaryModelGroup`. Rows are ordered and accessible; move/remove are disabled while settings are busy; the final entry cannot be removed; selected models cannot be added again; only a selected model is saved; Restore defaults writes Haiku → Luna. The i18n and onboarding checks passed.
- No source-level defect found in the reviewed scope.

## UI and native/live evidence from parent session

This session did not repeat live UI or resource operations. The parent reports:

- **PASS:** Settings interactions for add, remove, reorder, final-entry protection, duplicate disabling, refresh persistence, and exact restoration of original settings.
- **PASS:** compact desktop at 820 px; real settings RPC rejects empty and duplicate lists.
- **PASS:** configured list `[unavailable/skip, codex/gpt-6-luna, claude/claude-haiku-5-5]` skipped the unavailable candidate, created only the Luna child, saved the Luna summary, and deleted that child; original settings were restored exactly. Evidence: `summary-models-2026-10-23-live.json`.
- **UNRUN:** phone layout at 580 px; the host switched back to Community during the run.
- Plugin reload was not part of this independent test session.

## Outcome

All requested focused tests, typecheck, and full tests passed on the captured source hashes. Parent-reported live checks passed except the 580 px phone layout, which remains UNRUN.
