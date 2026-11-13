# Search-term highlight: UI check, 2026-10-27

Implementer's check of DRAWER-SPEC "Focus from search" items 6–7. Run on main ab1f8e4 (PR #73), with the installed plugin reloaded from the main checkout. Fixture: Tinylink, read only. Browser: headless Google Chrome via `docs/promo/shot-lib.mjs`. Script: `run.mjs`. Output: `log.txt`. Marks are counted 5 s after the click, when the ring and the focus timers have ended. `log.txt` also lists section titles and the card title, which were already bold, as bold text; ignore them.

| Hit clicked | Marked | Unfolded | Result |
|---|---|---|---|
| Summary (`Rate-limit POST`) | "Rate-limit", "POST" in Target | Progress past Show more (Show less visible) | pass (`d-summary.png`) |
| Note (`clicks counter`) | "counter" in that event only | the note has no line limit | pass (`d-note.png`) |
| Workpad (`limiter syntax`) | the check text and its command | command and output shown (Hide output) | pass (`d-workpad.png`) |
| Idea (`Redis`) | title and detail of that idea only | opened past Show more | pass (`d-idea.png`) |
| Same card reopened normally after closing the sidebar | no marks | — | pass (`d-normal-open.png`) |
| Note at 430 px | "counter" | — | pass (`c-note.png`) |

No page errors.

Not checked:
- Artifact hits and closed ideas. Tinylink has neither; the logic is covered by unit tests.
- Native phone apps.

## Rerun after rework

The user reported that the highlight looked like the whole block was highlighted, not the text. Changes: the marked words get an accent background, and a target with marked words no longer gets the ring. Rerun on the main working tree with this change applied (plugin reloaded) using the same script, which now also saves `*-early.png` 0.9 s after the click. In `d-note-early.png` only "counter" carries the highlight and the block has no ring. All the checks above still pass, and there are no page errors.
