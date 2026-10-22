# Delivery constraints independent review — 2026-10-22

## Session

- Paseo agent ID: `c06c0037-1486-4597-ae67-75c2c1490255`
- Runtime session ID: `01a1636f-558e-73f2-952f-8be12d24a0aa`
- Provider/model/mode: `codex` / `gpt-6-luna` / `full-access` (medium reasoning)

## Verdict

**PASS for the implementation contract and documentation.** No implementation invariant violation found in the reviewed paths; `docs/PROGRESS.md` now records the delivery-constraints implementation.

## Evidence

- Read `docs/DELIVERY-CONSTRAINTS-SPEC.md` and reviewed the requested changes in `shared/tools.ts`, `shared/model.ts`, `server/agent-service.ts`, `server/delivery-gate.ts`, `server/reminders.ts`, `server/cli-source.ts`, `server/tool-server.ts`, `server/skill-source.ts`, `skills/flowly/SKILL.md`, and `index.server.ts`.
- `npx vitest run server/agent-service.test.ts server/tool-server.test.ts` — **PASS**, 2 files / 55 tests.
- No fixtures or Paseo resources were created. Existing `live-*` files in this evidence directory were left untouched.
- Parent-reported latest checks after the fallback change: 3 files / 59 focused tests passed; typecheck passed; `npm test` passed (109 files / 932 tests). These results were not rerun by this reviewer. Fresh-session model behavior checks and plugin reload remain outside this review session.

## Reviewed invariants

- Output targets are prevalidated; artifact writes, delivery/progress event, carried next moves, and receipt are committed through one `BoardStore.transaction`. Throwing during validation/gating leaves the persisted board untouched.
- Exact nonempty-output replay checks the prior receipt before connector/path revalidation; parameter changes are rejected as `REQUEST_REUSED`. Empty/omitted outputs retain the normal receipt replay route and preserve the intended distinction between `[]` and omission.
- The open-item/setup refusal is session-bound and fingerprints task/project revisions, workpad revision/open items, setup gaps, and HEAD. The first acknowledged attempt still refuses; successful delivery clears the gate; the turn-start hook clears it for the managed session.
- CLI validation, MCP schemas/descriptions, and both skill representations (`server/skill-source.ts` and `skills/flowly/SKILL.md`) describe the new outputs and first-refusal behavior.

## Incremental review — explicit URL fallback (2026-10-22)

- Parent-reported first runtime failure: the real Sonnet run supplied its merged private-fixture PR, and `ConnectorService.recognize` returned `EXTERNAL_NOT_FOUND` because the configured Flowly token could not see that private repository. I did not rerun or replace that scenario. The parent reports that the initial failure evidence is preserved. It is not duplicated or modified in this reviewer directory; the trigger and result are recorded here as parent-reported evidence, not an independently captured trace.
- Reviewed the amended spec §1, `server/agent-service.ts`, and the new test in `server/agent-service.test.ts`. Fallback is constrained to `ExternalError` plus an explicit `http(s)://` prefix; the URL then still passes `normalizeTarget` validation. Bare keys and non-`ExternalError` exceptions remain refusals. The saved plain URL receives a notice that no external status/content was verified. Recognized external links continue to carry external metadata and output role.
- The new focused test covers all four `ExternalError` codes, recognized external output, bare-key rejection, programmer-error rejection, and persisted-board atomicity on refusal. Parent-reported latest results are 3 files / 59 focused tests passed, typecheck passed, and full suite passed (109 files / 932 tests); I did not rerun them.
- The prior documentation finding is resolved: `docs/PROGRESS.md:815` now records the implementation and synced contract.

## Incremental verdict

**PASS.** The URL fallback review found no broader downgrade path, the parent reports the post-change focused/type/full checks passing, and the progress-documentation gap is resolved. The original Sonnet `EXTERNAL_NOT_FOUND` remains the pre-fix failure evidence and is not counted as a pass.
