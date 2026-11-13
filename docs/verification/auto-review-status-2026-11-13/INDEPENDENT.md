# Independent verification — 2026-11-13

Verdict: **PASS for the requested code inspection and focused checks**; live acceptance remains UNRUN in this independent session.

- Verifier: Codex, Paseo session `4c542036-23a1-4a3c-bfcb-04868b246e8b` (Codex thread `01a1d38f-e624-7491-bec5-5ebfa4595bf4`); did not implement this change.
- Haiku session `80438cc4-b511-48c5-a978-9a0cc3159299` failed before checks with an individual spend limit. The user explicitly approved Codex as its replacement, as recorded in the verification assignment.
- Directory: `/Users/bofan.wang/Developer/personal/paseo-utlra-kanban/.test-data/auto-review-ship/verify`.
- Exact HEAD before and after checks: `d5125ba0dff5d421c4a89ee97b2d9e3a1f77e0cb`; clean verification checkout before and after. Used installed dependencies; no install, implementation edits, native resources, reload, child session, commit or push.

| Command | Exit | Passed | Failed | Skipped |
| --- | --- | --- | --- | --- |
| `NODE_ENV=test FLOWLY_TELEMETRY=0 npm run typecheck` | 0 | 1 check | 0 | 0 |
| `NODE_ENV=test FLOWLY_TELEMETRY=0 npx vitest run server/auto-review.test.ts shared/auto-review.test.ts client/attention.test.ts shared/i18n.test.ts` | 0 | 102 tests / 4 files | 0 | 0 |
| `git diff --check 5ea3f09..HEAD` | 0 | 1 check | 0 | 0 |

## Correctness and scope

Read AUTO-REVIEW-SPEC §3.1, §8.2 and §9, relevant PROGRESS entries, SINGLE-ROOT-SPEC, and inspected `5ea3f09..HEAD`. No blocking correctness finding in the requested change.

- Delivery writes the waiting marker in its status transaction. Shared visibility helpers hide the previous verdict and its Attention signal, and hold unread Attention while waiting. Card/accessibility and drawer show Waiting for review; drawer and service both reject Rerun while waiting.
- Review start clears the matching marker in the same transaction. The queue wrapper clears it on skipped/early-failed reviews, matching event ID so it does not clear another delivery's marker. Existing per-project promise chains remain serial; regression tests cover a second waiting card, redelivery, leaving In review and disabling Auto review.
- Restart recovery removes persisted waiting markers and records Unavailable for eligible In review cards, preserving delivery identity; the focused test verifies subsequent Rerun succeeds. The turn-end hook now calls `reviews.turnEnded` before settings/model/timeline reads; this ordering is inspected, not live timing proof.
- Production changes are limited to waiting state/schema, status presentation, visibility/Attention, marker lifecycle/recovery/Rerun and earlier scheduling, plus catalogs/spec/progress and verification artifacts. No backgroundWork/SDK changes, dependency/version changes, or image deletions appear in this diff; added images are verification artifacts.
- Existing onboarding/telemetry remain appropriate: this repairs an existing status display without a new switch or counted core action.

Documentation caveats (pre-existing, not introduced by this patch): AUTO-REVIEW-SPEC §8.2 still sketches `rules` and §9.2 describes Commands/LLM review groups, whereas current code uses `items` and a unified sorted item list; the spec's opening amendment directs readers to GUARDRAILS-SPEC for superseded behavior. §9.1 still names Review passed/Reworking, whereas current labels are Checked/Sent back. Its introductory “card has a review record” wording also does not cover a first delivery waiting before any review exists; the new §3.1 and §9.1 waiting bullet and code do cover it. Followed current code and the amended waiting contract; no implementation changes made.

## UNRUN limitations

Independent live desktop/compact/native-window/phone rendering, message delivery, a real-model delivering-turn-end/completed verdict, live restart/Rerun and native registry cleanup verification are UNRUN. Existing REPORT.md/screenshots are implementer evidence, not independently reproduced results. Full `npm test` is UNRUN here by assignment; only the four requested files ran. No fixture resources or build artifacts were created by this verification session; test fixtures use the suite's existing cleanup. Only this report was written outside the clean verification checkout; parent card/status/tags/workpad/outputs were not changed.
