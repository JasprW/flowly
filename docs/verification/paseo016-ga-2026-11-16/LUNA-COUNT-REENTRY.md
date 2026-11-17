# Guardrail count re-entry — independent verification

- Session: `4befbffa-7332-4ccd-be54-5125f64682d3`
- Candidate: `bacc7909afacbe15801cac2545f56f8746f0a12a`; base: `62b2a74f63495d815b57b947f11cb9eedee6c960`.
- Scope: reviewed the candidate's `useGuardrailCountsQuery` freshness change and QueryObserver regression against `docs/PASEO-0.16-SPEC.md` §3.5. Live mode uses `staleTime: 0`; non-live mode keeps 30 seconds. The regression covers initial read, hidden 10 seconds without a push, immediate re-entry read with updated counts, then 20 option updates and 180 seconds idle with no extra reads. No timer/effect was added.

## Checks

| Check | Result |
| --- | --- |
| `NODE_ENV=test FLOWLY_TELEMETRY=0 npm run typecheck` | PASS, exit 0 |
| `NODE_ENV=test FLOWLY_TELEMETRY=0 node_modules/.bin/vitest run client/guardrail-counts-push.test.ts server/guardrails.test.ts server/change-feed.test.ts client/queries.test.ts client/card-detail-query.test.ts client/session-chips.test.ts client/query-activity.test.ts --reporter=dot` | PASS, exit 0; 7 files, 93 tests passed |
| Parent's full suite on this source SHA | INHERITED, not rerun: exit 0; 166 files passed / 1 skipped; 1,530 tests passed / 6 skipped |
| Pre-fix regression result | INHERITED from the handoff: 1 failed / 4 passed; not rerun here |

**Code checks: PASS** for this scoped candidate. UI, live daemon behavior, and device measurement: **UNRUN**.

The user-approved PR #118 decision carries forward the historical `3043bd8` cold-start paired median difference of +3.7257% under the 5% limit. This is inherited authorization/evidence, not a measurement of this candidate; current device measurement remains UNRUN. CI and a real CodeRabbit review remain required before merge.
