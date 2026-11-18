# Memory / Guardrails page idle-read rework

Product source: `917038070c83590a635e63d2e7d30558e06377ec`; comparison base: merged PR #118 `043bb2d2b8332f380f0ca3858b2dad956a018508`.

## Contract and implementation

The auto-review finding is valid: the shared `useGuardrailsQuery` still read every 30 seconds on a static Memory page. Both Memory and Guardrails use this hook. Healthy `BoardPushLive` now removes its timer, including while review is running. Unsupported/connecting/disconnected hosts and query errors retain the original 30-second idle / 5-second running fallback; recovery stops it. Hidden queries remain disabled and re-entry keeps staleTime 0.

Existing board invalidation now includes the guardrails prefix and reuses cancel-before-invalidate for an initial pending request. GuardrailsStore commits already notify the board. Review running start/end now notify too (including completion without a store write), as do ready global feature-setting changes. No new protocol, polling, setting, dependency, or generation state. Global/project Memory-switch policy stays the same.

Specs §3.5 and Guardrails §7.4 were updated before implementation. README/OVERVIEW mention page updates. No new user action or headline capability warrants a tour/tip; no telemetry action/switch was added, so no heartbeat field is warranted. No version or What's new change.

## Parent checks

- RED, corrected regression harness on the previous implementation: 2 files, 6 failed / 16 passed, exit 1. Static 180-second page went from 1 to 7 reads; new push/fallback/pending/running assertions exposed the missing behavior. The first automatic-review test waited on the not-yet-implemented callback and timed out; that harness error is INVALID as product evidence. It was corrected to wait for existing summarySettled entry before the reported RED run.
- PASS: `npm run typecheck`, exit 0.
- PASS: `NODE_ENV=test FLOWLY_TELEMETRY=0 node_modules/.bin/vitest run client/guardrails-push.test.ts client/guardrail-counts-push.test.ts server/memory.test.ts server/guardrails.test.ts server/change-feed.test.ts client/queries.test.ts client/card-detail-query.test.ts client/session-chips.test.ts client/query-activity.test.ts --reporter=dot`, 9 files / 115 tests, exit 0.
- PASS: `NODE_ENV=test FLOWLY_TELEMETRY=0 npm test -- --reporter=dot`, 167 files passed / 1 skipped; 1536 tests passed / 6 skipped, exit 0.
- PASS: `git diff --check`.

## Parent isolated runtime

Real Paseo 0.16.0 daemon loaded the candidate under ID `flowly`, with telemetry disabled (`NODE_ENV=test FLOWLY_TELEMETRY=0 DO_NOT_TRACK=1`). Owned home/project/script: candidate `.verification/memory-page-2b09705c-20261117/`; loopback `127.0.0.1:17768`; supervisor PID 89132. Normal daemon/settings/resources were untouched.

PASS, smoke exit 0: project `7ef20d9d-9026-481d-83a9-56fe0405ac06`; real `board.changes` subscription and `guardrails.read`. Creating an owned note notified after 108.7 ms and appeared in the page view. Global `settings.features.write` memory=false/true notified after 105.0/103.8 ms and page enabled became false/true. Deleting the note notified after 106.0 ms, entries returned to zero. An unchanged etag omitted the value. These are daemon event times, not phone UI timings. No paid review-agent prompt was sent; running transition behavior is covered by focused service tests, not a new native-agent runtime sample.

Cleanup PASS: exact fixture project removed with `projects.remove(alsoPaseo:true)`; board projects/tasks and native projects/workspaces/agents were empty. Subscription/client closed. Owned daemon stop succeeded, status was stopped/PID null and no owned-home process remained. Entire owned fixture directory/script was removed; only this report remains.

## Remaining gates

- Independent exact-SHA Luna report is separate; parent never edits its evidence.
- Current UI/phone/cold-start measurement: UNRUN. AndroMeld socket unavailable; adb listed no devices. Standard shared adb server is retained.
- Previous historical source `3043bd8` +3.7257% paired median / 5% acceptance was authorized for PR #118 overview counts. It has NOT been silently extended to this new Memory-page patch. New authorization or phone verification remains required before overall acceptance/merge.
- Current real 0.15 runtime/UI: UNRUN; original fallback options have regression coverage, previous old-host evidence is inherited only.
- Actual new-PR CodeRabbit and CI: pending; rate-limit NEUTRAL/skipped will not count as review approval.

Existing unrelated mismatch: manual Wrap up docs say worktree-only; code also archives card-owned directory workspaces. Existing idea `301ae423-333a-446b-b670-24f36113a22f` tracks it; this patch changes no policy.

## Later user decisions (2026-11-17)

The user explicitly authorized this Memory-page patch to inherit historical `3043bd8` +3.7257% / 5% cold-start acceptance. Current-source phone/UI remains UNRUN; the authorization is not a new measurement. The original independent report retains its earlier authorization boundary unchanged.

The user then instructed that small changes can land directly without the PR process. This focused fix will use a normal fast-forward push to main, preserving exact product `9170380` and its passing parent/Luna checks; draft PR #119 will close. This supersedes the PR/CodeRabbit gate for this delivery. CodeRabbit check on #119 was NEUTRAL/rate-limited, not a passed review. CI results are reported separately. No protection or admin setting is changed.

Independent Luna code/typecheck/9-file115 checks PASS: `LUNA-MEMORY-PAGE.md`, report commit `08d3939`, session `398a2bae-7a34-412e-b225-266a72fbd9ee`. Exact native deletion returned one deleted ID, inspect returned AGENT_NOT_FOUND, and fresh Flowly sessions no longer contained it. Parent did not alter its evidence.
