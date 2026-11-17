# Paseo 0.16 agent stream recovery — independent verification

- Verdict: **WITHHELD** for acceptance of the live-list reconciliation change. The requested checks pass, but a temporary diagnostic test reproduced a missed removal that lets a stale full-list snapshot re-add an archived session. The current-source phone cold-start measurement is **UNRUN**; the user explicitly authorized this patch to inherit the prior conclusion.
- Verifier session: `d9ec9508-bc69-46e5-8961-44a09069807d` (Paseo session ID supplied by the parent task)
- Exact candidate SHA: `3ab5ff8eb950c1a19a4556a216b0ebbacbafb10d`
- Comparison base: `63d8364`
- Checkout: `.worktrees/paseo016-companion-candidate`
- Scope: stream setup retry and live-agent list reconciliation in `client/session-link.ts`, the new regression cases in `client/session-chips.test.ts`, and `docs/PASEO-0.16-SPEC.md` §3.5.

## Review

Reviewed the complete candidate diff against the base and the §3.5 contract. On rejected agent-stream setup, the code stops the failed local listener, schedules a retry using the existing 5/30/60-second backoff, resets the backoff after a successful setup, and clears the pending retry on stop. The implemented membership guard handles events that change the local map and the existing regression cases cover known-session archive/create races. However, an event for an ID absent from the local map does not advance the membership generation, so a stale list can still re-add that ID.

### Reproducible stale archive race

A temporary diagnostic Vitest case reproduced the reported sequence on the exact candidate. The first complete list returned empty. The stream bootstrap result contained `a1`, but `openStream` ignores that result's entries and only marks the stream ready. The second complete list captured `[a1]` and was held before returning. A stream `remove(a1)` then arrived while the local live map was empty; `applyLiveUpdate` returned `changed: false` with `before`/`after` both null, so `liveMembershipGen` did not change. Releasing the older list caused `reconcileLive` to reinsert `a1`, and the test observed a Task composer pill for the archived session. This ordering is possible because the SDK's subscribed list response is the initial snapshot and the client registers the event listener before awaiting that response; the returned snapshot is ignored by this code, while a later independent full list can be in flight as stream events arrive.

The scratch test passed its diagnostic assertion that the stale pill was recreated (1 file / 1 test); it was removed after the run. No implementation file was changed. This defect blocks acceptance until the generation/invalidity guard also accounts for removals of IDs not currently in the map and a regression covers that case.

The preceding CodeRabbit check was reported as PASS, while its review body still contained two outside-diff findings. This review checked those two findings against the implementation and regressions rather than treating the check status alone as resolution.

## Independent checks

| Check | Result |
| --- | --- |
| `NODE_ENV=test FLOWLY_TELEMETRY=0 npm run typecheck` | PASS, exit 0 |
| `NODE_ENV=test FLOWLY_TELEMETRY=0 node_modules/.bin/vitest run server/session-metadata.test.ts server/host-support.test.ts server/change-feed.test.ts client/session-chips.test.ts client/query-activity.test.ts --reporter=dot` | PASS, exit 0; 5 files, 73 tests passed |
| `NODE_ENV=test FLOWLY_TELEMETRY=0 node_modules/.bin/vitest run client/__diag_stream_remove_unknown.test.ts --reporter=dot` | Diagnostic reproduced the defect; 1 file, 1 assertion observed stale `a1` pill recreation. Temporary test removed after the run. |
| `git diff --check 63d8364..3ab5ff8eb950c1a19a4556a216b0ebbacbafb10d -- client/session-link.ts client/session-chips.test.ts` | PASS, exit 0; no whitespace errors |

The full suite was not rerun by this verifier. The parent task reports exit 0, 165 files passed / 1 skipped, 1521 tests passed / 6 skipped.

## Cold-start gate and unrun checks

On 2026-11-17, while approving the minimal membership-race fix, the user explicitly reconfirmed that this patch may inherit the earlier cold-start conclusion. The inherited result is +3.7257% against the 5% threshold from the earlier paired measurement; it is an authorized inherited conclusion, not a measurement on this source SHA. Current-source phone cold-start measurement: **UNRUN**. Phone UI and old-host UI were also not run by this verifier.

No daemon, fixture, browser, or persistent test resource was created. The temporary diagnostic file was removed. No implementation files were changed. Only this verification report is owned by this session.
