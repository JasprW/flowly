# Paseo 0.16 persistent stream setup recovery: independent verification

- Product source SHA: `6be6f315e993e7aa4a40096cc2f519af41ebc6d3`
- Comparison base: `dd47856`
- Verifier session: `1bfba11f-1a47-472c-b66b-b8357dfad94f` (GPT-6 Luna, full access)
- Checkout: `.worktrees/paseo016-companion-candidate`
- Result: **PASS** for the code and focused checks in this report.

## Review

The candidate changes the existing stream setup backoff callback from `openStream()` to `refreshNow()`. The refresh round retries stream setup and, while the stream is not ready, uses the ordinary full agent list so newly created sessions can receive their Task chips. The retry continues to use the existing 5/30/60-second backoff; this change adds no timer. The regression test covers continued setup failures, visibility of sessions `a2` and `a3`, recovery, and 180 seconds without further reads after recovery.

This matches `docs/PASEO-0.16-SPEC.md` §3.5: ordinary reads continue during stream setup failure, recovery stops after success, and healthy idle still performs no periodic reads. I found no code/spec mismatch in this change.

## Checks

| Check | Result |
| --- | --- |
| `NODE_ENV=test FLOWLY_TELEMETRY=0 npm run typecheck` | PASS, exit 0 |
| `NODE_ENV=test FLOWLY_TELEMETRY=0 node_modules/.bin/vitest run server/session-metadata.test.ts server/host-support.test.ts server/change-feed.test.ts client/session-chips.test.ts client/query-activity.test.ts --reporter=dot` | PASS, exit 0; 5 files, 76 tests passed |

## Not run / inherited evidence

- Full test suite: **UNRUN** by this verifier; the parent task owns it.
- New phone cold-start measurement: **UNRUN**. Under the user's explicit authorization for this patch, the historical `3043bd8` paired median result of `+3.7257%` is inherited against the 5% threshold. This is not a measurement of the candidate SHA.
- Old-host UI and live daemon behavior: **UNRUN** in this verification.

No implementation, fixture, daemon, workspace, or agent resources were created or modified by this verifier.
