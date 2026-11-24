# Auto review retry and Attention after a failure — live check, 2026-11-24

Implementer's check of AUTO-REVIEW-SPEC §3.5 / §13.3, run by session `6ed76c62-43c0-4736-9ca1-07b94dc0987a` (card "auto review优化"). Not independent verification.

- Tree: shared working tree on `76527e1` with this card's uncommitted changes (and other sessions' uncommitted work). `npm run typecheck` exit 0 before reload; `paseo plugin reload flowly` succeeded (Paseo 0.17.4, daemon not restarted).
- Fixture: Tinylink. One temporary card `7fd8c9dc-4c38-4726-93e3-99b8146dc32b` (workspace `wks_48b0612badf6f78f`), sessions `5ee86d3f-acd8-46b0-bbc2-23c7a37cee2b` (claude/claude-haiku-5-5) and `66390017-e540-46ff-b051-4fed6b329fbf` (codex/gpt-6-luna, low, full-access). For the run, Tinylink's Auto review was set to on with `maxRounds 0`, and a temporary command guardrail `d854806d-…` was added. It exits 1 until a gate file exists.
- UI: headless Chromium on the installed app's web build (`open016`), desktop 1700 × 1000, connected to the real daemon; screenshots/text via `docs/promo/shot-lib.mjs`. Native windows and the phone were not touched.
- Drivers: `live.mjs` (setup / deliver / message / rerun / gate / status / cleanup) and `ui.mjs` (one UI step; `dismiss` and `rerun` click the real controls).

## Results

| # | Step | Observed | |
|---|---|---|---|
| 1 | Agent delivery, gate closed | R2 → Blocked, Review failed round 1, `handledAt` empty; the drawer Review group shows Rerun; the menu offers Dismiss from Attention; `attention.count` 1 → 2 | pass |
| 2 | Dismiss (UI menu) | Card shows "Dismissed from Attention"; `attention.count` 2 → 1; `handledAt` still empty (D18: Dismiss is not handling) | pass |
| 3 | Person's message to the Haiku session | A1 blocked → design, `handledAt` written at turn start. The turn failed ("Not logged in", the claude provider is not logged in on this host), so A1r correctly did not run. The card came back into Attention with 1 error and 1 unread and without Review failed | pass |
| 4 | Codex session delivers (gate closed) → new failure; person's message | New review (Blocked, `handledAt` empty). The message: A1 blocked → design, `handledAt` set, turn completed without a report, **A1r design → blocked**. Card face still Review failed; the Attention item reads "Tinylink · Blocked · 1 error", no Review failed | pass |
| 5 | Rerun (UI drawer button) from Blocked | One human event `blocked → in_review` "Rerun auto review", review round 1. It failed again and R2 put the card back in Blocked with a new `startedAt` | pass |
| 6 | Attention after that failure | "Tinylink · Blocked · Review failed · 1 error" (new key, back in Attention) | pass |
| 7 | Gate open, Rerun (UI) | Commands passed; the goal check failed because it took the test message "reply with OK" as the request. Back to Blocked, as R2 requires | pass (as specified) |
| 8 | Codex session redelivers properly | Review passed (3 checks), card stays In review, not Done | pass |
| 9 | Rerun (UI) in In review | While running, the old "Checked" result was hidden ("Reviewing · Round 1") and Rerun was hidden; the review then passed and the card stayed In review | pass |
| 10 | Attention at the end | "Tinylink · In review · 1 error · 1 unread"; no review signal | pass |

Note: A1 resumed the card in Design, not Test, because the card was created directly in Test and has no `status_changed` event to resume from (`resumeStage` falls back to the first work stage). This is existing behavior, unrelated to this change.

## Cleanup (verified by `live.mjs cleanup`)

Both sessions were hard-deleted. The card was deleted with Archive, which archived its workspace (backup in plugin `removed/`). The temporary guardrail and the "Tests" command that Auto review auto-detected when it was switched on were deleted. Tinylink's Auto review was restored to `{ enabled: false, maxRounds: 2 }`. Remaining: card none, dismissal none, guardrails `[]` (as before), labelled native agents none, active workspace none. Tinylink still has its 6 cards in unchanged lanes and its 2 earlier dismissals, and its repository has no changes. Screenshots of the Attention popover were deleted because they showed another project's card; the JSON files keep only this card's lines.

## Not run

Compact layout and phone; the native Mark as read button (covered by `server/auto-review.test.ts`); independent verification.
