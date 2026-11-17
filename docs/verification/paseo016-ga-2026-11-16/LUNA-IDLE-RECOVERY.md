# Paseo 0.16 idle recovery — independent verification

- Verdict: **PASS** for the requested code and focused-check scope.
- Verifier session: `a9101afd-26ed-4697-9eaa-84da40d58b8c`
- Exact candidate SHA: `682fb4fe09dd800374ad72492f8c71dc83289c81`
- Comparison base: `fa05284`
- Checkout: `.worktrees/paseo016-companion-candidate`
- Scope: `docs/PASEO-0.16-SPEC.md` §3.5 and its companion push/chip recovery changes. Source review found the failure retry uses the 5/30/60-second backoff even while push is live; a successful round resets the retry sequence and leaves healthy idle with no timed chip reads. Failed initial stream reconciliation retains the full-list relist obligation. Settings generations and archive-removal counts prevent older in-flight responses from consuming newer invalidations; archive scans check both success and failure paths and schedule a follow-up without an immediate failure loop. Disposal clears pending timers and prevents follow-up reads.

## Checks

| Check | Result |
| --- | --- |
| `NODE_ENV=test FLOWLY_TELEMETRY=0 npm run typecheck` | PASS, exit 0 |
| `NODE_ENV=test FLOWLY_TELEMETRY=0 node_modules/.bin/vitest run server/session-metadata.test.ts server/host-support.test.ts server/change-feed.test.ts client/session-chips.test.ts client/query-activity.test.ts --reporter=dot` | PASS, exit 0; 5 files, 65 tests passed |

The focused regressions cover online-stream initial relist after a failed read, zero chip reads during healthy idle, both successful and failed stale archive scans after a removal, preservation of a settings invalidation during an older read, read-failure backoff, and cancellation on stop.

## Unrun

- No new phone or old-host client sample was run in this verification. This report makes no claim of live device or compatibility acceptance.
- Full test suite and UI checks were not run; they were outside this assignment's requested checks.

## Later scope clarification — 2026-11-16

The PASS above is limited to code at `682fb4fe09dd800374ad72492f8c71dc83289c81` and its 65 focused tests. It did not establish the cold-start gate for the later `531adad99e48a62027d54a1cad1f94000b2c559e` candidate. Relative to the source measured for the earlier phone result (`3043bd8`), both `client/session-link.ts` and `server/session-metadata.ts` have since changed, and those later sources were not covered by a new phone sample. This comparison is against the phone-measurement source; it does not imply that `server/session-metadata.ts` changed between `682fb4f` and `531adad`.

After that gap was raised, the user explicitly authorized the 531adad patch to inherit the earlier paired cold-start conclusion. The underlying observed median difference remains +3.7257% against the agreed 5% threshold; this is an accepted inherited result, not a new measurement or a current-source phone PASS. Current-source phone cold-start measurement remains UNRUN. The separate 531adad verification report records this authorization and distinction.
