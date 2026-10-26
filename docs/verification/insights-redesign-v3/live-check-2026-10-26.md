# Insights v3: live check (2026-10-26)

Branch `feat/insights-v3` rebased onto `origin/main` a0cbe68 (after the SQLite move), installed as plugin `flowly` from the worktree `flowly-insights-v3`, on the maintainer's real data (SQLite). Run by the implementing session (Claude Code, claude-opus-5-5), not the independent verifier: that run is still unrun.

## Before the install
- `npm run typecheck`: 0 errors on the rebased tree. First run found 2 errors: the v3 digest-queue test called `settle()` without the argument main added in 106c1b4. Fixed in the test (waits for both runs) and committed.
- `npm test`: 134 files, 1123 passed, 1 skipped (the crash child).

## Install
- `paseo plugin install` refuses an existing id, and `paseo plugin remove flowly` deleted `~/.paseo/plugin-settings/flowly` (13 files) but kept `plugin-data/flowly`. Both were copied to `/tmp/flowly-v3-backup/full` first; the settings were copied back and compare identical. The store opened on the existing SQLite file without a migration message.

## Checks (Flowly project, Asia/Shanghai)
| Check | Result |
| --- | --- |
| Hand count `handcount-v3.mjs` vs page, last 7 days (Oct 20-26) | match: 54 cards, median 2 rounds, 22.2% in one pass |
| Heatmap cell labels vs hand count | match: Oct 25 97 turns, Oct 26 96 turns / 6 cards, Oct 21 119 turns / 17 cards |
| Run now, Flowly | ok in about 1 minute, Sonnet 5.5, 148K in, 6.6K out, $0.58; 3 skill drafts (`flowly-pr-delivery` 7 cards, `flowly-ui-verification` 8, `flowly-feature-upkeep` 8) plus 4 other suggestions; `flowly-pr-delivery` covers PR delivery / CodeRabbit with real card references |
| Run now, Tinylink | ok, $0.15, "No suggestions this time" (1 card): no draft to add there |
| Past day summary (Oct 21) | "Writing the summary..." then a Haiku 5.5 summary with issues and card chips |
| Add to project (Flowly root, not Tinylink: it had no draft) | `.agents/skills/flowly-ui-verification/SKILL.md` written, `.claude/skills/flowly-ui-verification -> ../../.agents/skills/flowly-ui-verification`, toast text as specified, row shows "In the project", nothing committed. Test files removed afterwards; `.claude/` was left as found (empty) |

## Findings
1. After the test files were deleted, the draft `flowly-ui-verification` no longer appears at all (the `installed` record stays, the file is gone), so it cannot be added again until the next run replaces the drafts. Not in the spec.
2. `docs/promo/shot-lib.mjs` `open()` needs the Tinylink tab, which is not visible below about 1100 px; the compact shot is the 1700 px page resized to 1000 px after opening. Chromium for Playwright is not installed here; `PLAYWRIGHT_CHROMIUM_PATH` pointed at Google Chrome.

## Not run
- Independent verifier session (claude-haiku-5-5) on this commit.
- Luna 6 on the phone / native.
- README `05-insights*.png` still show the first version.

## Screenshots
`live-desktop-light-skill-open.png`, `live-desktop-light-day-summary.png`, `live-desktop-dark.png` (Other suggestions open), `live-compact-light.png`. Other projects' tabs are hidden in every image.
