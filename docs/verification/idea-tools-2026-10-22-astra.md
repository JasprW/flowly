# Astra review — idea tools — 2026-10-22

Card: `5fcd00c8-2869-456a-96c8-3e1f4fa8b637` (扩展idea工具).
Reviewer: `codex/gpt-6-astra`, high reasoning, explicitly `full-access` at creation.
Session: `7e05a4bf-c82f-4651-a4d8-e6ca88cd550c`.
Baseline: `fab80456ead870e7b7e6a493bae276ee878e34fd` + current dirty checkout; only this card's hunks were reviewed.

## Verdict

Fix the P2 receipt issue before acceptance. One additional P3 translation omission is non-blocking. The parent checked both findings against the current source and agrees. No implementation was changed in this review turn, and neither finding was reproduced by a new runtime test.

## P2: proposal replay loses ideaId after deletion

- Location: `server/agent-service.ts:579` (receipt replay); `server/agent-service.ts:1042` (removal).
- Trigger: propose with request A, remove the idea with fresh request B, then replay A unchanged while its receipt remains valid.
- Proposal replay looks up the idea through `existing.eventId` in the current `board.ideas`. Removal deletes that entity. The `managed` fallback covers only update/remove, so the proposal replay returns the original receipt and `replayed=true`, but omits the original `ideaId`.
- This violates IDEAS-SPEC §3's promise that exact proposal replay returns the original idea ID. It does not duplicate or resurrect the idea.
- Minimal recommendation: persist optional `ideaId` in receipts and prefer it during replay, retaining the existing lookup for old receipts. Add a focused propose → remove → replay-propose regression check. Pruning could already expose this lookup weakness; the new removal tool makes it a regular lifecycle path.

## P3: new Activity actions are not localized

- Location: `server/agent-service.ts:1043` / `:1063` emit `idea_removed` / `idea_edited`; `client/drawer.tsx:1236` / `:1271` map and render actions.
- Neither new action is in `activityText`. The fallback renders English “Idea removed” / “Idea edited” in non-English interfaces.
- Minimal recommendation: add module-level `msg()` entries to the action map and translations to every catalog. No layout or onboarding-tip change is required.

## Other reviewed boundaries

- Signed identity/resource checks and transaction-time card binding, archive/finished state and revision checks remain in use. Idea lookup is scoped to the current task; accepted is rejected before update or removal.
- No agent restore path exists. Changed fields on dismissed ideas are rejected; repeated dismiss and same-value submissions remain no-ops.
- Duplicate-title checks exclude self and scope to other open ideas on the same card. Tags use shared normalization/deduplication, and `tags: []` clears them.
- Idea/event/receipt writes share the transaction. Edit+dismiss records the edit before dismissal. No-op changes retain task/idea data while still recording the receipt and advancing the board revision.
- MCP, HTTP actions and CLI mappings agree; only explicit update fields are serialized, and `--dismiss` maps to `status=dismissed`.

## Evidence limits and history

The existing [MCP report](idea-tools-2026-10-22.md) and [Luna report](idea-tools-2026-10-22-luna.md) support the main lifecycle, update/remove replay, selected refusals and unchanged task state/revision. They do not cover proposal replay after removal. Astra did not rerun typecheck, the 936 tests, live RPC/CLI or UI; those remain evidence from the earlier runs. A shared dirty tree's HEAD alone cannot prove byte-for-byte equality to the previously tested source.

Fable review was attempted first as requested but never ran: default Claude returned a weekly limit; the AICodeWith endpoint returned HTTP 402 for insufficient balance. The user explicitly switched the review to Astra. These are not successful reviews.

Cleanup: failed Fable sessions `6216dd9c-9c87-4198-a3e6-c0e352d6411c` / `b4fc701b-33ad-4674-9915-127dfb97ff35` and the completed Astra session were archived and deleted by the parent; native lookups return not found. No fixture, idea, project, workspace or runtime setting was created or changed by the reviewer.

## Resolution after the user's fix instruction

Both findings were subsequently fixed and verified; this review above remains the original pre-fix verdict. See [fix verification](idea-tools-2026-10-22-fixes.md) for the pre-fix failing regression, 97 focused passes, independent Luna typecheck/938 tests/18 locale translations, and installed MCP proposal replay after removal. This supplement is the primary agent's fix/verification record, not a second Astra review.
