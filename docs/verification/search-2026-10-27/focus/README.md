# Focus from search: UI check, 2026-10-27

Implementer's check of DRAWER-SPEC "Focus from search" on main 876e7df (PR #72), installed plugin reloaded from the main checkout. Fixture: Tinylink (read only). Headless Google Chrome via `docs/promo/shot-lib.mjs` (`launch`, `hidePrivate`); screenshots are clipped at the host sidebar edge. Script: `run.mjs`; output: `log.txt`.

| Hit clicked | Lands on | Result |
|---|---|---|
| Summary (`Rate-limit POST`) | Progress section of *Add rate limiting* | pass (`d-summary*.png`) |
| Note (`clicks counter`, first hit) | that Activity event, ringed | pass (`d-note-ring.png`, `d-note.png`) |
| Workpad (`limiter syntax`) | the *Check limiter syntax* check | pass (`d-workpad*.png`) |
| Idea (`Redis`) | the Redis idea | pass (`d-idea*.png`) |
| Note at 430 px (compact) | the event on the full-screen card | pass (`c-note*.png`) |
| Opening the same card normally afterwards | Activity closed again (stored default untouched) | pass (`d-normal-open.png`) |

No page errors. Not checked: artifact hits (Tinylink has no artifacts; covered by `client/drawer-focus-logic.test.ts`), Reduce Motion, native phone apps. A summary hit lands on the Progress section; when the matched words are in the summary's target or next step, they stay folded under Progress → Show more.
