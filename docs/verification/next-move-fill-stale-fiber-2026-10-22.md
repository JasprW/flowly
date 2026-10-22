# Next moves fill in Paseo's session view: stale fiber copy (2026-10-22)

Card: 原生session内next move预填输入框失效 (540b459e). Session fc9417a0. Spec: NATIVE-SESSION-SPEC §6.4.

## Symptom

On the Paseo desktop app (0.12.0, single session full screen), picking a suggested next step only copied it
("Copied. Paste it into the message box."). After the user reloaded Paseo, filling worked again.

## Cause

`client/web-composer.ts` identified the box's session by walking the React fiber from the textarea's DOM node and
refused when the matching fiber's other copy (`alternate`) named a different `agentId` ("mid-update"). The DOM node
keeps the fiber it was created with, and React swaps the two copies on each update, so one copy can hold props from an
earlier render for as long as the page lives (e.g. a box created while the session was a new-session draft). The rule
then refused that session until a reload.

## Fix

A box belongs to the session when it is on screen (laid out, not under `aria-hidden`) and **either** fiber copy's
`return` chain names the session's `agentId`. Two visible boxes for one session still fall back to copying.

## Checks

| Check | Result |
| --- | --- |
| `npx vitest run client/web-composer.test.ts` (adds: either copy may be stale; hidden box never filled) | pass, 5 tests |
| `npm run typecheck` | pass |
| `npm test` | pass, 946 passed / 65 skipped |
| Headless Chromium, app.paseo.sh bundle and the desktop app's own bundle (`/Applications/Paseo.app/.../index-3d91adc9….js`, served under the app.paseo.sh origin through request interception), live daemon, plugin reloaded: navigate between three Flowly workspaces and the Flowly board, then pick a real next move in session 4ce632e7 | filled the visible box, no copy toast |
| Same page with the pane fiber's other copy set to `agentId: "draft-probe"` (the stale state) | new code fills; the old rule evaluated on that page returns null (copy) |

Not run: the user's own desktop window (not automated, per the two-window rule). The headless clicks filled only the
headless client's message box; nothing was sent.
