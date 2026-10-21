# Flowly logo in the welcome tour title — 2026-10-21

Card "plugin logo设计" (27fd4d9f-8726-4a82-a353-ea88d8690c7c), session 063084a2-576c-4a0c-adde-c818d0fbfa2b.

Run on 7c440b7 with uncommitted changes (dirty), after `npm run typecheck` (exit 0) and `paseo plugin reload flowly`
(logs: "Plugin ready", no errors; status running).

## How

The Paseo web client (`https://app.paseo.sh`) ran in headless Chromium against the local daemon. It is the same daemon
and the same reloaded plugin bundle as the desktop app, in two separate browser contexts (`colorScheme` light / dark,
1600×1000, 2x). Steps: Flowly → Flowly settings (gear) → Show welcome tour. Neither Paseo desktop window was touched.
This session has no desktop-control tool, so the non-fullscreen desktop window itself was not driven.

## Result

| | Light | Dark |
| --- | --- | --- |
| Modal surface | rgb(250, 250, 250) | rgb(30, 33, 32) |
| Title text | 14 px, rgb(26, 26, 30) | 14 px, rgb(250, 250, 250) |
| Mark | 20×20 px at (565, 232), 8 px before the title, vertically centred on it (title 233.5–250.5) | same |
| Mark colour (full-coverage pixels) | #1E2120 (darkest 30/255) | #F3F1EC (lightest 243/255) |
| Page errors | none | none |

The mark picks the ink PNG on the light surface and the paper PNG on the dark one. On the dark surface the anti-aliased
core reads #EEEDE8.

Evidence: `flowly-logo-welcome-tour/{light,dark}-title.png` (title row) and `{light,dark}-modal.png` (whole first page).

Not checked: phones (native app) and the desktop app window itself.

## Rerun with the redrawn small mark — 2026-10-21

The small mark was redrawn (T5 from `docs/brand/logo-drafts/v12-two-ends/`: a solid start dot, an open end ring and one
S curve on a 20 grid) and now ships as 20 / 40 / 60 px PNGs, picked by pixel ratio. After `npm run typecheck` (exit 0),
`npm test` (106 files, 822 tests passed) and `paseo plugin reload flowly` (Plugin ready, no errors), the same steps
gave: mark 20×20 px at (565, 232), 8 px before the title; the page loaded the 40 px image at 2x (data URI length
matches `flowlyMarkPng.*[2]`), so it is shown 1:1 without resampling; full-coverage colour #1E2120 on light and
#F3F1EC on dark; no page errors. The screenshots in `flowly-logo-welcome-tour/` were replaced by this run.
