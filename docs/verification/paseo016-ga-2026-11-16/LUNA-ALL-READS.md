# Paseo 0.16 companion reads — independent verification

- Verdict: **PASS** for code review and the requested focused checks on the exact candidate below. The user-authorized cold-start gate is accepted by inheritance; current-source phone cold-start measurement is **UNRUN**.
- Verifier session: `87138694-ba59-497d-ace6-c9c4b09357ab`
- Exact candidate SHA: `531adad99e48a62027d54a1cad1f94000b2c559e`
- Comparison base: `27439ba`
- Checkout: `.worktrees/paseo016-companion-candidate`
- Scope: Paseo 0.16 companion reads, especially `client/session-link.ts`, `client/session-chips.test.ts`, and `docs/PASEO-0.16-SPEC.md` §3.5.

## Review

Reviewed the candidate diff and §3.5 contracts for ordinary read failures, successful recovery, healthy idle, and stop/disposal behavior. The new archive failure path schedules one delayed retry at 15 seconds, clears it when an archive scan starts successfully or when the plugin stops, and does not retry immediately in the failure handler. A newer archive-removal generation still triggers the existing follow-up path. Native-chip settings failures remain stale and mark the round failed; outside-session insight failures also mark the round failed. Both use the existing 5/30/60-second retry sequence. A successful round resets failure backoff, while a healthy live subscription schedules no timed chip reads. Stop clears the archive retry, regular retry, and subscription retry and prevents in-flight work from scheduling more reads. I found no reproducible defect in the reviewed scope.

## Checks

| Check | Result |
| --- | --- |
| `NODE_ENV=test FLOWLY_TELEMETRY=0 npm run typecheck` | PASS, exit 0 |
| `NODE_ENV=test FLOWLY_TELEMETRY=0 node_modules/.bin/vitest run server/session-metadata.test.ts server/host-support.test.ts server/change-feed.test.ts client/session-chips.test.ts client/query-activity.test.ts --reporter=dot` | PASS, exit 0; 5 files, 69 tests passed |

The focused suite covers a failed archive scan retrying after 15 seconds and stop cancelling it; settings and insight read failures recovering without another change and then producing no reads during 180 seconds of healthy idle; persistent board/agent read failures backing off; stale settings/archive responses preserving newer invalidations; subscription reconnect; and existing metadata/host-support/change-feed/query activity behavior.

## Cold-start gate

On 2026-11-16, after the source-scope gap was explained, the user explicitly authorized this `531adad` patch to inherit the prior paired cold-start conclusion. The prior measured median difference was **+3.7257%**, within the accepted 5% threshold. This is an authorized inherited conclusion, not a new phone measurement. There was no current-source phone cold-start sample for this candidate: **UNRUN**. See the append-only clarification in `LUNA-IDLE-RECOVERY.md`.

## Other scope

- The parent task reports its separate full suite as exit 0, 165 files passed / 1 skipped, 1517 passed / 6 skipped; this verifier did not rerun it.
- No live phone, old-host UI, daemon, fixture, or browser verification was run in this review.
