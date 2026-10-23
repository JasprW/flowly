# Insights redesign: verification (2026-10-22)

Spec: [INSIGHTS-REDESIGN-SPEC](../INSIGHTS-REDESIGN-SPEC.md), second version. Card `ccefebbe` "Insights重设计". Session: Claude Code (claude-opus-5-5), card session `f9a20624`.

## Checks run

| Check | Result |
| --- | --- |
| `npm run typecheck` on the shared working tree | pass, 0 errors |
| `npm test` on the shared working tree | pass: 910 passed, 65 skipped (includes `shared/workflow-stats.test.ts`, the `byUser`/`tool` tests in `server/progress-rules.test.ts` and `shared/agent-habits.test.ts`, the R3 threshold, i18n completeness) |
| `paseo plugin reload flowly` | plugin `running`; `byUser` and `tool` are recorded from this reload on |
| Hand count `node docs/verification/fixtures/insights/handcount.mjs` (independent of `shared/workflow-stats.ts`) vs the page, Flowly project, Asia/Shanghai | match: week of Oct 19: 40 cards, median 2 rounds, 15.0% in one pass; week of Oct 12: 19 cards, median 1 round, 21.1% |
| Headless Chromium against `https://app.paseo.sh` on the local daemon, Flowly project | rendered, no page errors |

## Screenshots

- Old page: `insights-redesign-before-2026-10-22.png`.
- First version (output statistics), withdrawn: `insights-redesign-v1-withdrawn-2026-10-22.png`.
- Second version: `insights-redesign-v2-desktop-light-2026-10-22.png`, `insights-redesign-v2-desktop-dark-2026-10-22.png`, `insights-redesign-v2-narrow-2026-10-22.png` (820 px viewport, Paseo sidebar cropped).

## Observed

- "Interventions" shows "—": no turn carried `byUser` before this reload, as the spec says (§7.3). It fills in as new turns finish.
- Tokens per card for a model with few cards changed between reads (111K vs 13.6M for gpt-6.1-sol, 3 cards). A card whose local Codex log is not found on a read sums to 0 and drops out of the median. Not fixed here; proposed as a follow-up.

## Not run

- Luna 6 full-access test session with fixture projects (AGENTS.md): UNRUN.
- Phone (native app) layout: UNRUN.
- README screenshots `docs/promo/screenshots/05-insights*.png`: not regenerated.
