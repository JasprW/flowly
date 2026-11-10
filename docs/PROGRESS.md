# Implementation progress

## Auto wrap up first-run write fixed (card "Done 卡片支持 Unwrap up", step 2) — 2026-11-10

- A UI test on an isolated daemon (separate home, port 6868, empty board) showed that the first-run tour never wrote `wrap-up.json`. The host hands plugins schema output with defaults filled in, so `autoWrapup` was always `false` and `firstRunWrapup` read it as "already chosen". The unit test missed this because it passed raw objects.
- Fix: `autoWrapup` is `z.boolean().optional()`, and `wrapupSettingsValues` maps unset to off. A new test feeds `wrapupSettings.schema.parse(...)`, which is what the host hands out.
- UI results on the isolated daemon, after the fix:
  - Fresh install, tour closed from its last page (Create project): `{"autoWrapup":true,"archiveOnDelete":false}`.
  - Fresh install, Skip on the first page: the same.
  - Stored `{"autoWrapup":false}`, Skip: unchanged.
  - Stored `{"autoWrapup":false,"archiveOnDelete":true}`, last page: unchanged.
  - Before the fix, the same run wrote no `wrap-up.json`.
- The fixture daemon, its home and its temp directory were removed. The real `~/.paseo` settings were never touched.

## Auto wrap up on for new installs (card "Done 卡片支持 Unwrap up", step 2) — 2026-11-10

- How the setting is stored: Paseo saves only the values a user changed (`wrap-up.json` is `{"version":1,"values":{...}}`), readers fill the rest from schema defaults, and the daemon cannot write settings. Changing `default(false)` would therefore have turned it on for every existing user who never touched it, so the default stays off.
- Instead, the first, auto-opened welcome tour writes `autoWrapup=true` when it closes, but only if no value is stored yet (`firstRunWrapup` in `client/onboarding-logic.ts`, through `saveSure`, which now also accepts a patch function). This is the same pattern as the outside-session switches (ONBOARDING-SETUP-SPEC D3).
- Also updated: a More features line, the `first-done` tip text, and README and OVERVIEW.md. Two strings were added to all 9 catalogs and the old tip string was removed. No new tip id. There is no What's new entry: per the user's decision (2026-11-10), the release task writes it.
- Telemetry: `f_auto_wrapup` already exists, so the heartbeat is unchanged. The version was not bumped.
- Checks: `npm run typecheck` passed (exit 0) and `npm test` passed (exit 0; 153 files, 1353 passed, 6 skipped). The plugin reloaded and runs.
- Not run: a UI pass of the first-run tour on a clean host, and an independent verification.

## Telemetry error fixes (card "近期error排查") — 2026-11-10

- 30 days of `$exception` reports grouped by source, type, frames and version: [verification/telemetry-errors-2026-11-10.md](verification/telemetry-errors-2026-11-10.md). Every report still arriving from 1.8.0 comes from the local daemon connection.
- `server/local-daemon.ts`: `paseo.pid` is read again (10 × 50 ms, like Paseo's `readPidLock`) while Paseo rewrites it in place; a missing or still unreadable file and a connection the daemon does not complete are `LocalDaemonUnavailable` (logged, not reported). A rejected local credential (`DaemonAuthenticationError`, found by the independent Haiku check) and a Paseo without the needed methods stay reported. [WORKSPACE-RESTORE-SPEC](WORKSPACE-RESTORE-SPEC.md) step 1, [TELEMETRY-SPEC §11.2](TELEMETRY-SPEC.md).
- `DaemonRpcError` reports (6 in 30 days, 4 installs, unknown cause) now carry `value` = `requestType:code` from the error's fields, lowercased, each part kept only when wholly `^[a-z][a-z0-9_.]{0,59}$`; never the message. No new property: the `$exception` key set is unchanged. [TELEMETRY-SPEC §11.3](TELEMETRY-SPEC.md). The in-app notice is unchanged (a Paseo request name is not user content); README and OVERVIEW.md now say a failed Paseo request sends the request's name.
- Independent check of eb62c81 (before the two items above): [verification/telemetry-errors-2026-11-10-verify.md](verification/telemetry-errors-2026-11-10-verify.md), pass with notes; its Medium finding (auth failures hidden) is fixed, the timing-dependent retry test now waits within a 200 ms retry.
- Open, proposed as an idea: Windows linked roots (`symlink` EPERM without Developer Mode).
- Onboarding and heartbeat fields: none (internal fixes; nothing new to learn or count).
## Settings UI for the screening switches (card "Enable Decision Engine") — 2026-11-10

- The screening feature was only reachable by hand-editing settings. Settings → AI features, Guardrails group (`client/settings-pages.tsx`): the new "Screen what the review remembers" switch sits under "Find memory in finished cards" and is only switchable when Guardrails and the finished-card review are on (the screener only runs when the review runs); the cost line uses the review's token mix (one extra short call per run, same shape). When it is on, a "Screening model" group appears below with Provider/Model selects mirroring the review-model picker; leaving it empty falls back to the summary models chain (GUARDRAILS-SPEC §4.7).
- Spec: §4.7 notes the switches and their location and gating. Onboarding: no tour or tip change — the switch is a sub-setting of the existing Guardrails group, the same class as the finished-card review switch, which carries no tip either. Telemetry: none.
- Strings: three new in all 9 catalogs. Tests: `npm run typecheck` exit 0; client suite 272 passed (catalog parity included); full suite 1346 passed with only the 9 known environmental failures that PR #98 fixes upstream.

## Screened-out panel and one-click restore (card "Enable Decision Engine") — 2026-11-10

- Follow-up to the decision screening (GUARDRAILS-SPEC §4.7): a wrong auto-dismiss was invisible — the record sat in `guardrails.json` with no UI, and undoing it meant re-proposing by hand. The undo path is now as visible as the action.
- Schema (`shared/guardrails.ts`): `screenedOut` records gain `id` and the candidate's own `body`/`tags`/`keywords`, so a restore recreates the note faithfully; `guardrailsViewSchema` returns the project's records to the client.
- Server: new `guardrails.restore` RPC (`GuardrailsService.restoreScreened`, wired in `index.server.ts`) recreates the note active through the existing `create` path (trust gates apply) and drops the record; a title that already exists is not an error — the knowledge is present, the record is dropped and the existing note returned. The restored note carries no screening provenance: the restore is the human's override.
- Client (`client/memory.tsx`): the Memory page gains a folded "Screened out · {n}" section under Archived, each row showing the title, kind and the screening reason, with a one-click Restore. Three new strings in all 9 catalogs ("Screened out · {n}", "Restored.", plus the awaiting-review strings from the screening change).
- Spec: GUARDRAILS-SPEC §4.7 gains the undo-path paragraph. Onboarding: none (the section is self-explanatory inside the existing Memory page; the tour does not cover screening). Telemetry: none.
- Tests: `server/guardrails.test.ts` — restore recreates the note and drops the record, the view carries the records, the duplicate-title path drops the record, a gone record is NOT_FOUND; the seeded records and the trim test updated for the new `id` field.

## Decision screening for retro notes (card "Enable Decision Engine") — 2026-11-07

- [GUARDRAILS-SPEC](GUARDRAILS-SPEC.md) §0.4, §4.7 (new): the retro run's candidates are judged by a separately-configured model before they write. `task-summary.memoryScreening` (default off) + `memoryScreeningModel` (empty → the summaryModels chain) in `shared/summary.ts`. `confirm` + `high` writes the active note exactly as upstream does, with `source.screened: "auto-confirmed"` and `source.screenReason`; `dismiss` + `high` writes nothing and records `{projectId, taskId?, at, noteKind, title, reason}` in the new capped `state.screenedOut` (20 per project, §3.4), whose exact titles block re-proposals before the screener is called; `human`, non-high confidence, and any `supersedes` write the note `state: "observing"` with `observe: {reviews: 0, passed: 0}` and `source.screened: "flagged"` — the Guardrails page shows it with the observing marker, the injection and review paths ignore it (they filter `state: "active"`), and a person promotes it with Resume.
- Schema: `GuardrailEntry.source` gains `screened`/`screenReason` (mirrored on the compat `MemoryEntry.source` and carried through `toMemoryEntry`); the "only commands observe" refine now admits notes (guidelines still cannot) because the flagged note is the observing state's second use (§3.2); `guardrailsStateSchema` gains `screenedOut` and `screenerUnavailableAt`. Declared in zod because the store parses on every write — an undeclared key is silently dropped.
- Failure behavior: a screener failure (model error, timeout, JSON off-schema) fails open — the candidate writes active exactly as with screening off — and the run records `Decision screening is unavailable: …` in `state.errors` plus `state.screenerUnavailableAt`, both cleared on the next successful screening; `recordRetro` keeps that error across its per-task error wipe. The trust gates (`checkProposal`) run before the screener call and again inside `propose` in every branch; a `propose` rejection stays in `recordRetro`'s per-candidate catch, never a run error. `propose` archives a `supersedes` target only when the replacement writes active — a flagged replacement never displaces the live note.
- Screening off byte-for-byte: the retro path is untouched when `memoryScreening` is false; `memory_proposed` events, the retro record and the drop-error wording are unchanged.
- Onboarding and telemetry: none — the feature ships default off and adds no counters; the screening outcome is visible on the Guardrails page through the observing marker and the store's `screenedOut` (a page section for screened-out notes is a follow-up idea, not built here).
- Tests in `server/memory.test.ts` (8 new, 24 total): confirm writes active with provenance; dismiss writes nothing and records the reason; human/medium writes observing, out of agent context; secret gate wins before the model; supersedes stays observing; screener failure fails open with visible marker and recovery; off-default unchanged; provenance survives the parse-on-write round trip.
