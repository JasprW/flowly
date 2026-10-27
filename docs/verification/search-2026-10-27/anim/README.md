# Search page animations: UI check, 2026-10-27

Fixture: Tinylink, read only. Browser: headless Chrome via `docs/promo/shot-lib.mjs`. Script: `run.mjs`; output: `log.txt`.

For each action, the script samples the lowest opacity on the first result's ancestors at every animation frame for 600 ms:

| Action | Opacity during the 600 ms | Opacity at the end |
|---|---|---|
| Source filter (Workpads) | reaches 0, then rises | 1 |
| Scope (All projects) | reaches 0, then rises | 1 |
| Edit the query | reaches 0, then rises | 1 |

Each new response fades the list in. No page errors. `after.png` shows the layout after the last action.

Not checked:
- Reduce Motion, which the shared `Enter`/`useMotionValue` handle.
- Native phone apps.
