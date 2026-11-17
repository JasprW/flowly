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
- Historical `3043bd8` cold-start paired median +3.7257% under the accepted 5% limit remains historical. User's carry-forward authorization explicitly covered PR #117; it has not been extended to this new count rework.
- New runtime daemon, desktop/phone UI, and actual 0.15 client UI: **UNRUN**. Prior evidence remains scoped to its recorded source.
- Independent GPT 6 Luna review: see verifier-owned `LUNA-GUARDRAIL-COUNTS.md` when available. Parent does not edit independent evidence.
- CI, actual CodeRabbit review and merge: pending a new PR; auto-merge must remain disabled while device acceptance is unresolved or review rate limited.

Existing unrelated mismatch retained: manual Wrap up docs say worktree-only; code also archives card-owned directory workspaces. Existing idea `301ae423-333a-446b-b670-24f36113a22f` tracks it. No policy change in this patch.
