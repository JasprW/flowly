# Discord AI feature screenshots

- `summary.png`: current Tinylink rate-limiting card, expanded Progress. Captured 2026-10-20, 1200 x 940.
- `next-moves.png`: unchanged copy of `../06-next-moves.png`, captured 2026-10-19 in the Tinylink screenshot fixture, 876 x 910. Suggestions prefill a message; they do not send it.
- `ideas-card.png`: Ideas cards inside the Tinylink rate-limiting task drawer, showing both Continues this task and New task scopes with Dismiss / Good idea actions. Captured 2026-10-20, 1200 x 820. This replaces the inbox screenshot in the ZIP.
- `ideas-task-context.png`: optional wider-context version with the parent task header, 1200 x 1800. Available beside the ZIP; not included in the four-image pack.
- `workpad.png`: the Tinylink rate-limiting task's real Workpad and task header. Captured 2026-10-20, 1200 x 1360. Three acceptance criteria and three checks pass. A new codex/gpt-6-luna full-access verification session ran npm test (13/13), node --check src/limiter.js and node --check src/server.js on clean commit 47899f7286df. No source edits. The created session was archived afterward.
- `workpad-detail.png`: optional focused Workpad crop, 1200 x 960; available beside the ZIP.

Current captures use a separate headless Chrome profile on the local Paseo host. The native Paseo windows were not touched. Screenshots exclude other projects and personal workspace sidebars; the workpad's host/path stamp and author metadata were hidden for privacy. No task results or check states were fabricated. Tinylink's existing tasks, sessions and repository were preserved; its rate-limiting task now also has the real verification Workpad requested for this screenshot.

All four PNGs were visually reviewed for readable text and complete crops. The images are promotional material. The Tinylink checks are recorded in docs/verification/workpad-promo/session.json; they do not constitute a new Flowly product acceptance test.
