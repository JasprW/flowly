# Paseo 0.16 Guardrail count recovery: independent verification

- Product source SHA: `93b7a2feac02414ac06f3c240a186b1cd04ba89f`
- Comparison base: `4de164d0489adc1b9f270e849cd87b0ae79010f7`
- Verifier session: `ec866156-1b9e-41be-a9b4-680e802bada2` (requested GPT-6 Luna, full access)
- Checkout: `.worktrees/paseo016-companion-candidate`
- Result: **PASS-WITHHELD-UNRUN** — source review, typecheck and requested focused checks pass. Current-source daemon/UI and phone measurements were not run.

## Review

`BoardPush` sends `board`/`all` events through `onBoardPushed` to `invalidateCardViews`. That helper now cancels an in-flight `guardrailCountsKey` query before invalidating it, so a slow first read cannot consume a newer push. The added regression uses a real React Query `QueryObserver`: it holds the first response, invalidates during that read, returns the old response, then verifies a second RPC leaves the new count in cache and that 180 seconds of healthy idle cause no further read.

The existing count-query behavior remains intact: a live push subscription has no healthy interval; a failed count read gets its 60-second recovery read; an old host, connecting subscription or disconnected subscription keeps the 60-second fallback; hidden/disabled observers do not fetch when invalidated. Explicit overview Refresh still calls `data.refetch()` and now also invalidates counts. The query is disabled when the host Memory feature is off (`features.memory === false`), so invalidation alone does not fetch. The three pre-existing count tests cover healthy idle/push/hidden, old-host/connecting/disconnected recovery, and count-read failure recovery. Server tests cover notifications after successful GuardrailsStore commits.

The project-level `project.memory === false` setting is distinct from the host Memory feature switch: the existing counts hook is gated by `features.memory`, while the displayed count is hidden for a project with Guardrails off. This review's disabled-path result applies to the host feature switch and hidden overview; it does not claim that project-level Guardrails-off suppresses count reads while the host feature remains on.

No mismatch was found between the reviewed changes and `docs/PASEO-0.16-SPEC.md` §3.5. No implementation files or prior reports were changed.

## Checks

| Check | Result |
| --- | --- |
| `NODE_ENV=test FLOWLY_TELEMETRY=0 npm run typecheck` | PASS, exit 0 |
| `NODE_ENV=test FLOWLY_TELEMETRY=0 node_modules/.bin/vitest run client/guardrail-counts-push.test.ts server/guardrails.test.ts server/change-feed.test.ts client/queries.test.ts client/card-detail-query.test.ts client/session-chips.test.ts client/query-activity.test.ts --reporter=dot` | PASS, exit 0; 7 files, 92 tests passed |

The parent reported the full suite on this product SHA as exit 0, 166 files passed / 1 skipped, 1,529 tests passed / 6 skipped. This verifier did not rerun the full suite.

## Inherited and unrun evidence

- The user authorized this PR #118 count patch to inherit the prior `3043bd8` paired cold-start result (+3.7257%, within the 5% threshold). This is an accepted inherited result, not a measurement of SHA `93b7a2feac02414ac06f3c240a186b1cd04ba89f`; current-source phone/cold-start measurement remains **UNRUN**.
- The parent previously verified 0.16 daemon notification, etag and reconnect behavior on `31d9dee` (about 104 ms notification). That is parent evidence for `31d9dee`; no new daemon check was run on `93b7a2f`.
- Current-source desktop/compact UI, live daemon behavior and old-host UI: **UNRUN**. The old-host fallback logic was reviewed and its query behavior is covered by the focused test, not by a live old-host session.

No build, install, new cache, fixture, daemon, workspace or worktree was created. The prior `LUNA-GUARDRAIL-COUNTS.md` was left unchanged.
