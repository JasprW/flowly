# v1.7.0 release: live UI check (2026-10-26)

Installed build: `release/v1.7.0` (plugin `flowly` reloaded from that commit). Script: `ui-check.mjs` (shot-lib, headless Chrome via `PLAYWRIGHT_CHROMIUM_PATH`), project Tinylink.

| Check | Result |
| --- | --- |
| What's new opens from Settings → General on Flowly 1.7; › disabled on the newest page | pass (desktop, compact) |
| ‹ pages to 1.6, then 1.5; ‹ disabled on the oldest page; › returns to 1.6 | pass (desktop, compact) |
| Items slide in from the paging side (`whats-new-desktop-older-sliding.png`, 120 ms after the press) | pass (desktop, visual) |
| Got it closes the window; no page errors | pass (desktop, compact) |
| Welcome tour pages 1–5 render; Insights sample shows weekday labels, the selected day, the day card and a two-line skill row (`tour-page-4.png`) | pass (desktop, visual) |

Compact (750 px window, Flowly compact layout) was checked through the controls' state only: the host centres the modal on the whole window, so a shot cropped at the 320 px sidebar cuts it off; those shots are not kept. Phones were not tested.

Raw results: `results.json`.
