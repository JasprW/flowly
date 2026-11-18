# Guardrails/Memory count push rework — 2026-11-17

Product source: `31d9dee941b1d48ca5cb995b84523403197e01c5`; comparison base `d96c3d3f819e632193bf1ecafd1bfa1432c74b36` (merged PR #117).

Accepted auto-review finding `goal`: the Memory-enabled overview still read `guardrails.counts` every 60 seconds. §3.7 deferral does not exempt this read.

## Change

- GuardrailsStore notifies the existing board change feed after a successful atomic write, including external memory writes/learning without a board commit. No-op/failed writes do not notify. Plugin cleanup detaches the callback.
- The board's invalidation set includes counts, and the counts hook receives the existing subscription-live state. Healthy live counts no longer poll; old-host/connecting/disconnected reads keep the original 60-second interval. A counts read error also enables that interval until a successful recovery. Hidden/unmounted readers do not fetch.
- No subscription protocol, dependency, UI, setting, telemetry, tour/tip or version change. README/OVERVIEW describe the count push. Rolling seven-day counts recompute on notification, re-entry or explicit refresh, with no periodic read for time alone.

## Parent checks

All commands used `NODE_ENV=test FLOWLY_TELEMETRY=0` in the existing candidate worktree with existing dependencies/cache; no build/install/new cache. Disk available about 20 GiB, existing dependencies 283 MiB.

| Check | Result |
| --- | --- |
| Initial client regression | RED: 180 seconds live idle read count 1 → 4; reconnect and push-invalidation assertions also failed |
| Server commit regression | RED after fixing an invalid fixture missing `noteKind`: successful independent guardrail commit notified 0 times, expected 1 |
| Seven-file focused suite | PASS, exit 0, 91 tests |
| `npm run typecheck` (final source) | PASS, exit 0 |
| `npm test -- --reporter=dot` (final source) | PASS, exit 0, 166 files passed / 1 skipped, 1528 tests passed / 6 skipped |
| `git diff --check` | PASS, exit 0 |

Focused command: `node_modules/.bin/vitest run client/guardrail-counts-push.test.ts server/guardrails.test.ts server/change-feed.test.ts client/queries.test.ts client/card-detail-query.test.ts client/session-chips.test.ts client/query-activity.test.ts --reporter=dot`.

The new client tests capture the production hook options and run real QueryObservers with fake time: 180-second idle, invalidation after external add/archive, hidden/resume, unsupported/connecting/disconnected/reconnected states, read failure without another event, successful recovery, and unmount. This is automated query behavior evidence, not a rendered device UI measurement.

## Unrun / open gates

- New candidate phone benefit/cold-start sampling: **UNRUN**. AndroMeld reported missing control socket; `adb devices -l` was empty. User said the phone cannot connect temporarily.
- Historical `3043bd8` cold-start paired median +3.7257% under the accepted 5% limit remains historical. Initially the carry-forward authorization only covered PR #117. After reviewing this new candidate/checks, the user explicitly extended it to this PR #118 count patch on 2026-11-17. **Accepted by explicit carry-forward; new measurement remains UNRUN.**
- Desktop/phone UI and actual 0.15 client UI: **UNRUN**. New parent-owned 0.16.0 daemon RPC checks are recorded below; they do not change the independent verifier’s originally unrun scope. Prior device evidence remains scoped to its recorded source.
- Independent GPT 6 Luna review: `LUNA-GUARDRAIL-COUNTS.md`, report commit `a3af96d`, verifies product `31d9dee`: code/typecheck/7 files 91 tests pass. Its overall-withheld conclusion records the state before the later user authorization; original evidence remains unchanged. Session `26784627-9826-417c-8ee9-f2f964efad11` was deleted after completion; native inspect returned `AGENT_NOT_FOUND`. Parent does not edit independent evidence.
- PR: https://github.com/JasprW/flowly/pull/118. CI, actual CodeRabbit review and merge are pending; auto-merge stays disabled until real review passes.

Existing unrelated mismatch retained: manual Wrap up docs say worktree-only; code also archives card-owned directory workspaces. Existing idea `301ae423-333a-446b-b670-24f36113a22f` tracks it. No policy change in this patch.


## Parent-owned isolated runtime check

- Product source remained `31d9dee`; checked-out head `8d562fc` adds documentation only. Paseo CLI/daemon 0.16.0 loaded this candidate under its own `flowly` ID, `NODE_ENV=test FLOWLY_TELEMETRY=0 DO_NOT_TRACK=1`. Fixture home/project were inside candidate `.verification/guardrail-counts-2b09705c-20261117/`, loopback `127.0.0.1:17768`, supervisor PID 88231 / worker 88234. The normal daemon was not restarted or reconfigured.
- PASS, exit 0: real plugin RPC created project `7c624413-5761-4164-8490-f43ff6ca0ed1`, then subscribed to `board.changes`. Creating note `b8c144d1-e0d2-41b3-9acb-4619e11cc6c6` sent a board-scope event after **104.2 ms**; `guardrails.counts` changed 0→1 while board revision remained 1. Archiving it sent another board event after **104.3 ms**; count returned to 0, still board revision 1. These are local daemon event timings, not phone UI timings.
- PASS: an unchanged etag count response omitted the value; a fresh subscription received `scope: all`.
- Cleanup PASS: exact fixture project removed through `projects.remove(alsoPaseo:true)`. The plugin board had 0 projects / 0 tasks; native project/workspace/agent lists were empty. No agent prompt, UI interaction or existing resource was used.
- Cleanup PASS: `paseo daemon stop --home <owned fixture home>` succeeded; `daemon status` showed `localDaemon: stopped`, PID null; `ps` found neither owned PID. The entire owned fixture home/project/script/IDs directory was then removed. Only this short report is retained.
- Setup note: first trying config path `listen` was rejected without saving it; `daemon.listen` was then configured successfully in the owned fixture home. No test result was inferred from that rejected setup command.


## CodeRabbit follow-up: first pending read and explicit Refresh

- Real CodeRabbit review of `4de164d` finished at 2026-11-17 02:33 UTC: one inline finding (thread `PRRT_kwDOVL1NI864Pivt`) and one outside-diff finding. Check SUCCESS did not mean its findings were resolved; auto-merge stayed off.
- First-read race reproduced with real QueryObserver: while the uncached first count response is delayed, a Memory write pushes invalidation but reuses that old promise. Temporary diagnostic: 1 failed / 3 skipped; permanent regression on old source: 1 failed / 3 passed, expected 2 reads / actual 1. Temporary diagnostic file was removed.
- User explicitly approved the minimal fix and retained regression on 2026-11-17, continuing this patch's old cold-start carry-forward. Product source **`93b7a2feac02414ac06f3c240a186b1cd04ba89f`** now cancels the counts query before board invalidation. Late initial completion cannot leave the old count cached; the regression also checks another 180 seconds with zero additional reads.
- The overview's explicit Refresh preserves `data.refetch()` and invalidates counts as well. Readers disabled by the global `features.memory` switch remain disabled. Existing project-level `project.memory` behavior is unchanged; that switch is not the query enable guard. No new polling, generation counter, protocol, dependency, setting or UI text. Existing onboarding/telemetry decisions remain unchanged.
- PASS, exit 0: `NODE_ENV=test FLOWLY_TELEMETRY=0 npm run typecheck`.
- PASS, exit 0: complete seven-file focused command above, **92 tests**.
- PASS, exit 0: `NODE_ENV=test FLOWLY_TELEMETRY=0 npm test -- --reporter=dot`, **166 files passed / 1 skipped, 1529 tests passed / 6 skipped**. Disk available 55 GiB; reused existing 283 MiB dependencies/cache.
- PASS, exit 0: `git diff --check`. New candidate phone, cold start, daemon and UI measurements remain **UNRUN**; the earlier isolated runtime measurements are scoped to `31d9dee`, and the explicitly authorized old cold-start conclusion is inherited, not remeasured.
- Independent exact-SHA evidence belongs to `LUNA-COUNT-RECOVERY.md`; the parent does not edit it or earlier independent reports. Updated CI and actual CodeRabbit re-review remain required before merge.

- Independent Luna result: **PASS for code and requested checks** on exact `93b7a2`; 7 files / 92 tests, typecheck exit0, report commit `dc0da42`, session `ec866156-1b9e-41be-a9b4-680e802bada2`. Full suite remains parent-owned evidence. The report explicitly distinguishes global features.memory disabled from the existing project.memory switch; no project-level feature policy was changed.


## CodeRabbit follow-up: quick overview re-entry

- Real CodeRabbit review `5932379450` of `62b2a74` finished at 2026-11-17 03:35 UTC with one outside-diff finding: returning to the overview before the 30-second stale window, without a hidden push, did not re-read the rolling count. This is a correction to the existing re-entry contract, not a new concurrency mechanism.
- New real QueryObserver regression was RED on the prior source: 1 failed / 4 passed (expected 2 reads, actual 1). It hides for 10 seconds without invalidation, changes the simulated aged count, and returns.
- Product **`bacc7909afacbe15801cac2545f56f8746f0a12a`** changes only the counts query freshness: live pushes use `staleTime: 0`; old-host/not-live paths keep 30 seconds. Re-enabling therefore reads once; 20 ordinary option/render updates and another 180 seconds idle do not read. No effect, timer, generation counter, dependency or protocol was added.
- PASS, exit 0: `NODE_ENV=test FLOWLY_TELEMETRY=0 npm run typecheck`; complete seven-file focused command above, **93 tests**; `git diff --check`.
- PASS, exit 0: `NODE_ENV=test FLOWLY_TELEMETRY=0 npm test -- --reporter=dot`, **166 files passed / 1 skipped, 1530 tests passed / 6 skipped**. Existing 283 MiB dependencies/cache reused; disk available 53 GiB.
- Independent Luna **PASS** on exact product `bacc790`: typecheck exit0, 7 files / 93 tests. Report `LUNA-COUNT-REENTRY.md`, commit `661a6ff`, session `4befbffa-7332-4ccd-be54-5125f64682d3`; parent full-suite result is explicitly inherited, not rerun by the verifier. Prior independent reports remain unchanged.
- Current-source UI, daemon, phone/cold-start measurements remain **UNRUN**. This same PR #118 count patch continues the user's explicit historical `3043bd8` +3.7257% / 5% cold-start carry-forward decision; no new sample is claimed. Actual CodeRabbit review of the new head and CI remain required for merge.
