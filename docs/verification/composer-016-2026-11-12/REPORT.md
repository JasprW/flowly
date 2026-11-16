# Paseo 0.16 composer: verification (2026-11-12)

Implementer's run (card "Paseo 0.16 接入：composer"), uncommitted tree on `main` at a597cc8 plus this card's changes.

| Check | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm test` | exit 0; 158 files passed, 1 skipped; 1388 tests passed, 6 skipped |
| Session metadata on the 0.16.0-beta.2 daemon (read with a short-lived local client after `paseo plugin reload flowly`) | 17 live card sessions carry `flowly.taskId`; `flowly.agentId` equals the session id on all 17 |
| 0.15.4 web client (app.paseo.sh, its bundle has no `addComposerItem`) on the 0.16 daemon, Tinylink card "Add rate limiting to POST /shorten" → Open in Paseo | plugin loads, no page errors; Ideas · 2 and Task pills shown as before; no composer controls (`session-web-wide.png`) |

## 0.16 client (desktop app's web build), 2026-11-12, second run

The user allowed testing in the non-fullscreen desktop window. Window enumeration from this shell showed no titled Paseo windows (no Accessibility/Screen Recording access), so that window could not be identified, and the app binary turns any extra argument into a CLI call, so a separate instance could not be started either. Instead `verify.mjs` loads the desktop app's own 0.16.0-beta.2 web build (`/Applications/Paseo.app/Contents/Resources/app-dist`, whose bundle has `addComposerItem`) in headless Chromium, served under the `https://app.paseo.sh` origin through Playwright routing so the local daemon accepts it. The user's windows were not touched. Same Tinylink card session as above.

| Check | Result |
|---|---|
| Card session, 1700 px | Stage (`In review`) and `Next moves` inline in the composer toolbar; Defer, Ideas · 2 and Task pills still above (`w016-wide.png`) |
| Next moves → "Add 429 tests" into an empty box | box = that prompt, focused, cursor at end (225/225); not sent (`w016-next-moves-open.png`, `w016-filled.png`) |
| Box holds "Draft", pick "Verify with Luna" | `Draft\n\n<prompt>`, focused, cursor at end; box cleared afterwards |
| Stage Select | lists the project's lanes with the current one ticked (`w016-stage-open.png`); In review → Test → In review recorded as two human status events (04:17:03, 04:17:11), card back at In review (revision 10) |
| 1100 px | both controls still inline (`w016-narrow-1100.png`) |
| 800 px | toolbar shows only the model button; its sheet holds `In review` and `Next moves` rows (`w016-overflow-800.png`); picking "Add 429 tests" there fills and focuses the box (`w016-overflow-next-800.png`); box cleared |
| New Agent draft in the same workspace | no Flowly controls, no pills (`w016-draft.png`) |
| Page errors | none in any run |

Not run:

- Android (no phone attached, `adb devices` empty) and the desktop app's own Electron window.
- `focus()` refusal on a live host (covered by `client/composer-fill.test.ts` only).
- A 0.15 daemon load test (the server half; the 0.15 client half is above).
- The toast text after a stage change was not captured by the page-text read; the status events prove the move.
