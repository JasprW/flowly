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

## Folded rows aligned (same day, after the user's style note)
Other suggestions and Workflow summaries started at different left edges (each was right-aligned in a half-width box). Both rows now share a title column (`Disclosure` `titleMinWidth`, 150), so the summaries start at one left edge; the Workflow summary no longer truncates on desktop and truncates to one line on compact. Images: `live-desktop-light-folded-aligned.png`, `live-compact-light-folded-aligned.png`. `npm run typecheck` 0 errors; `npm test` 134 files, 1123 passed, 1 skipped (on the commit below, dirty before commit).

## Lists flush, skill rows restacked (same day, second style note)
The bodies of Other suggestions, Workflow and Dismissed were indented 22 px, so their lists did not line up with the Skills list; they now start at the page's left edge (`Disclosure` `flush`). A skill row is two lines (name in monospace, its title under it in muted text), status chip and card count stacked on the right, chevron aligned with the name. Images: `live-desktop-light-lists-flush.png`, `live-desktop-light-skill-row.png`. `npm run typecheck` 0 errors; `npm test` 134 files passed.

## Heatmap squeezed (same day, third style note)
Two defects: the weekday labels (Mon / Wed / Fri) were cut off at the bottom (their text box was shrunk to the 11 px cell height, line height 16 px, overflow hidden), and the 53 columns were 769 px wide in a 760 px column, so the last week stuck out past the panel's right edge. Labels now have their own 16 px line box centered on the cell; on wide layouts the cell size is measured from the room beside the labels (8 to 14 px) so the last week ends at the panel edge; compact still scrolls, ending at the right edge. Images: `live-heatmap-fit-desktop.png`, `live-heatmap-fit-compact.png`. `npm run typecheck` 0 errors; `npm test` 134 files passed.

## Page felt empty; Back bar height (same day, fourth and fifth style notes)
Workflow now opens by default and a "Last 7 days" list (date, finished cards, turns; a row picks the day) sits under the day panel (`live-desktop-light-full-page.png`). The "Board" bar of Insights, Ideas and Memory is `pageBarHeight` (48 px on desktop, 60 on touch) so its icon row sits where the task card's header icons do: with a card opened from Insights, the Back button and the card's Edit button both have their center at y = 143 (`live-bar-aligned-with-card.png`). `npm run typecheck` 0 errors; `npm test` 134 files passed. The Ideas and Memory pages were opened after the change: their Back button center is also y = 143.

## Day summary card (same day, user's redesign of the day panel)
Paging back from Today lands on Sun, Oct 25 and moves the heatmap selection: 97 turns (equals the heatmap and the hand count), 11 cards, 8 done, agent 11h 28m (session run time, parallel sessions add up), 578M tokens; the cards are ordered by agent time with bars (46 turns, 7h 20m, 313M for the busiest), 8 shown and "Show 3 more". Images: `live-day-card-desktop.png`, `live-day-card-compact.png`. `npm run typecheck` 0 errors; `npm test` 135 files, 1127 passed, 1 skipped.
