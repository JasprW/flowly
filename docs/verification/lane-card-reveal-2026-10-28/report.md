# Lane card reveal, desktop check (2026-10-28)

Tree: `ff3b83e` plus uncommitted changes (`cardRevealOffset`, reveal `taskId`). Plugin reloaded with `paseo plugin reload flowly`.
Method: `docs/promo/shot-lib.mjs` (`launch`, `open`, `shot`), Google Chrome via `PLAYWRIGHT_CHROMIUM_PATH` (no Playwright Chromium installed), project Flowly, 1700x1000. The card is opened with dispatched mouse events, since a real click would scroll it into view itself.

- Target: the last card of the Done lane (101 cards), `Flowly 工作流构建文章`. Before opening: x=1857, y=2324 (off screen both ways).
- After opening: x=635, y=865, h=114 (inside the 1000 px window). Done lane centred in the board left of the drawer, card at the bottom of the visible list with the selected border.
- Result: pass. Screenshot: `done-bottom-card.png`.
- Not checked: phone layout (unchanged by design), a card already visible (covered by `cardRevealOffset` unit test).
