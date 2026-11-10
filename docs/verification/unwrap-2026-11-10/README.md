# Unwrap in place — end-to-end, 2026-11-10

- Tree: 602f5f4 + this card's uncommitted changes (installed from the checkout, `paseo plugin reload flowly`).
- Command: `FLOWLY_TELEMETRY=0 node docs/verification/unwrap-2026-11-10/run.mjs` → exit 0, 22 PASS / 0 FAIL ([run.log](run.log)).
- Fixture: one new worktree card + one Haiku session in Tinylink. Auto wrap up archived the workspace and session when the card was moved to Done. Everything created was removed afterwards (card, session, worktree, branch); Tinylink's own cards were left as they were.
- Checked: Unwrap in the desktop sidebar brings back the same workspace ID, recreates the worktree on its branch and unarchives the session. The card stays in Done with the same revision. A single `workspace_restored` is recorded with actor human, and nothing is auto-wrapped again within 10 s. Desktop and phone-width sidebars show Finished afterwards.
- Found and fixed in this run: the stale "Workspace is unavailable or archived." warning after Unwrap (`client/drawer.tsx` now refetches the workspace query after Unwrap).
- Screenshots: desktop-wrapped, desktop-unwrapped, phone-wrapped, phone-unwrapped. The phone screenshots come from a 750 px browser window with a 430 px compact plugin surface, not a real phone.
- Unrun: a real phone, and an independent session rerunning these checks.
