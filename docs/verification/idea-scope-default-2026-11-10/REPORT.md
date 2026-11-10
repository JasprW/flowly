# Native Ideas popover: default button follows idea scope (2026-11-10)

- Tree: `a010135` + uncommitted change to `client/native-popovers.tsx` (working tree, plugin reloaded with `paseo plugin reload flowly`).
- Fixture: Tinylink card "Add rate limiting to POST /shorten" (`wks_ba6ff18c509f409e`), session `402bf42e`; two open ideas (one `scope=new`, one `scope=here`). Nothing created or changed.
- Method: `docs/promo/shot-lib.mjs` (`launch`, `open`, `shot`), headless Chromium 1600x1000, open the workspace, click the `Ideas · 2` chip.

| Idea | scope | Buttons left → right | Bordered (default) button |
|---|---|---|---|
| Share rate-limit state across instances with Redis | new | Dismiss, Continue here, Start a new task | Start a new task |
| Make rate limit configurable via env vars | here | Dismiss, Start a new task, Continue here | Continue here |

Result: pass (2/2). No page errors. Unrun: outside-session popover (no outside session with an open idea at hand), phone.

Screenshot: `ideas-popover.png`.
