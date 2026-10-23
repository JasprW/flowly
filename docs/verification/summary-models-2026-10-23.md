# Configurable summary model priority

User input: allow selecting multiple summary models with priority; retain Haiku → Luna as the default. No external input artifacts were attached.

## Delivered behavior

Settings → Models → Summary models and the welcome tour share an ordered list: add a provider/model, move up/down, remove (at least one remains), restore defaults. Duplicates cannot be added. Each model's provider/id stays visible, including unavailable stored choices. The first-model cost estimate is labelled as such, and the list explains that fallback sends the same input to the next provider.

The additive optional `summaryModels` field in v1 settings takes precedence; legacy explicit `summaryModel` stays a singleton, legacy Auto stays Haiku → Luna. No migration on read. New edits save the list and clear the old string together. Card Progress, outside-session insights, daily digest and memory review now share one ordered runtime runner, including create/wait/error/parse fallback and cleanup before retry. Valid output stops; persistence is outside the retry loop. Unavailable models are skipped without adding unconfigured candidates.

Spec: [SUMMARY-MODELS-SPEC](../SUMMARY-MODELS-SPEC.md). Existing summary/model/onboarding specs, both READMEs, the shared tour control, one-time `summary-models` tip and latest three-item What's new entry are updated; the tour announcement item was replaced to keep that entry at three items. All nine translation catalogs updated. No SDK/dependency/version change.

## Verification

HEAD `2a727e8af2d4908d1cc86f2905c641c1cb56b838`, dirty=true. The checkout contains unrelated work and no commit/push was requested. Independent source fingerprints and the initial dirty manifest are linked from [Luna report](summary-models-2026-10-23-luna.md).

- PASS independent `codex/gpt-6-luna`, explicitly `full-access` at creation: 8 files / 167 targeted tests, `npm run typecheck`, `npm test` (111 files / 958 tests). Focused command: `npx vitest run shared/summary.test.ts server/summaries.test.ts server/summary-models.test.ts server/session-insights.test.ts server/insights.test.ts server/memory.test.ts client/onboarding-logic.test.ts shared/i18n.test.ts`. This one run covers both overlapping planned focused checks; no redundant two-file run was needed.
- PASS `paseo plugin reload flowly` after typecheck: running from this checkout. No daemon restart.
- PASS final `node docs/verification/summary-models-2026-10-23-ui.mjs`, exit 0: defaults, up/down, remove, last-item protection, add provider/model, duplicate disablement, page-reload persistence, compact desktop 820px action geometry, no page errors, live RPC empty/duplicate rejection with unchanged settings revision. [Raw UI evidence](summary-models-2026-10-23-ui.json), [desktop screenshot](summary-models-2026-10-23-desktop.png), [compact action-region screenshot](summary-models-2026-10-23-compact-actions.png). All exports use `docs/promo/shot-lib.mjs`, which excludes the private sidebar; compact export intentionally contains only the right action region. No native user window was operated.
- PASS `node docs/verification/summary-models-2026-10-23-live.mjs`, exit 0: temporary custom order `[unavailable/skip, codex/gpt-6-luna, claude/claude-haiku-5-5]`; native child `7ded0812-e375-4b92-8445-965e146354bb` was Luna, summary `d0f64eba-d574-48c5-bbe9-c6a933a8cac8` was saved as Luna, and that child was absent after completion. No Haiku attempt was needed. This establishes the configured order and skipping unavailable candidates in the running plugin; deterministic three-candidate runtime failure is covered by fake-SDK tests. [Raw live evidence](summary-models-2026-10-23-live.json).
- PASS original summary and onboarding values restored exactly after final UI verification. Live priority check restored original summary values exactly. The only new tip marked seen by the earlier screenshot test was cleared before the final run; all older onboarding preferences were preserved. No test-created projects/workspaces/cards; Tinylink remained unchanged.
- PASS test session `24b743be-57e7-47a2-9bc4-0ed2fa871eb2` hard-deleted with `paseo delete <exact-id> --json`; subsequent inspect returned `AGENT_NOT_FOUND` and Flowly lists only the original card session. No temporary build directory, binary, or isolated cache was created; retained evidence is small.

## First failures and limits

Early local checks caught a missing disclosure import/id, a test-helper argument, a changed error-message expectation and a fixture that omitted model config. They were fixed before the independent passing checks. The first UI assertion ran after backend persistence but before the frontend update; the verifier now waits for the old row to disappear. Earlier UI traces retain these failures (`ui-first.json`, `ui-interactions.json`).

At 580px the host recreated its responsive navigation and returned to Community, removing the Flowly page. Two attempts (wait for remount, reopen settings) could not find the plugin entry; [host evidence](summary-models-2026-10-23-ui-phone-host.json) is retained. Full phone/native-device layout remains UNRUN; 1700px desktop and 820px compact desktop passed. No native user window was touched. Dark theme was not separately exercised; the new controls use existing theme-driven primitives.

The previous follow-up idea for other summary consumers was dismissed because this turn implemented it. No further idea or memory proposal was warranted.

## Selective shipping scope — 2026-10-23

This PR is projected onto origin/main and excludes other cards' Insights redesign, What's new framework and version edits. The summary setting is announced by its once-per-host tip and shared welcome-tour control. The What's new sentence prepared during implementation stays in the shared checkout with that separate feature. Historical 167/958 results above describe the broadly dirty implementation checkout; the PR checks validate the isolated shipping tree separately.
