# Form drafts: implementer browser UI probe (2026-11-16)

- The independent session's live UI part did not run (see `independent.md`), so the implementer ran this probe. It is the implementer's own evidence, not independent evidence.
- Script: `ui-probe.mjs`, using `docs/promo/shot-lib.mjs`. Browser: Chrome for Testing from `~/Library/Caches/ms-playwright/chromium-1234`, headless, against app.paseo.sh with the local daemon. Plugin: installed `flowly` from this checkout at `089d115`, reloaded.
- Target: the live `flowly` project and this card (`修复`). Nothing is created. The probe types text and attaches a 1x1 `probe.png`, closes with Esc, reopens in the same context and in a fresh browser context, then clears the text, removes the image and checks that the cleared state is what stays saved.

## Result (clean run): 16 passed, 0 failed, exit 0

Desktop 1700x1000 and compact 430x900:

- New task: title and description restored after Esc; restored in a fresh browser context; the cleared probe stays cleared.
- New session: instruction restored after Esc; image restored after Esc (1 thumbnail); restored in a fresh browser context; the cleared probe stays cleared.

Desktop screenshots are in `ui/`. Compact has no screenshots, because shot-lib's crop is for the wide layout. `ui/results.json` holds the clean run.

## Failed attempts before the clean run

- Selector errors: the desktop New task button is named "New task (N)", and the compact form is a sheet without `role=dialog`.
- One run used a page-wide `Remove …` selector. It counted 4–5 thumbnails and its cleanup click timed out. That left probe text and two probe images in this card's New session draft.
- Checked afterwards: the card's tags, artifacts and activity were unchanged. The next runs, scoped to `Remove probe.png`, removed the leftover images and text.
- `shot-lib.mjs` now ignores a `grantPermissions` failure, because older Playwright builds reject `local-network-access`. That failure is what blocked the independent session.

## Not run

- Esc is the only close path the probe checked. Cancel and backdrop were not checked, but they share `requestClose` (`client/forms.tsx`, `client/session-create.tsx`).
- Idea and follow-up entry separation in the UI. It is covered by server tests only.
- Create-clears-draft in the UI, and the save-failure and load-failure notices.
- Paste events; the image was attached through the file chooser only.
- Phones, native client or daemon restart, force-quit.

## Re-run after the review fixes (`847afb3`, plugin reloaded)

Three runs. No assertion failed in any of them. Every failure was a navigation or page-load timeout before any form step: shot-lib's 8 s project-chooser click, or `app.paseo.sh` `page.goto` `ERR_TIMED_OUT`. Logs: `ui/run-847afb3-{1,2,3}.log`.

| Run | Passed | Failed (all navigation) |
| --- | --- | --- |
| 1 | 12 | compact New session round |
| 2 | 12 | desktop New task round |
| 3 | 4 | desktop New session round, both compact rounds |

Taken together, all 16 checks passed at `847afb3`. No single run passed all 16, so the clean single run above is still the one at `089d115`. `ui/results.json` holds the last run's result.

After the runs, a read-only look at the daemon's `form-drafts.json` shows two entries left: `task:<flowly project>:plain` and `session:<this card>:plain`. Both have empty text and no images. No probe text or images are left.

## Re-run after CodeRabbit's second round (plugin reloaded on the working tree that became the next commit)

- The probe is now scoped to the open form only: the innermost element holding the form field and its Cancel button, never the page.
- It refuses to run a round when the form already has a draft.
- One run: 16 passed, 0 failed, exit 0 (`ui/run-review2.log`). Desktop and compact; New task and New session; image restore included.
