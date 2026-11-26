# Auto review convergence: live check of needs_user and of keeping the result after A1/A1r — 2026-11-26

Implementer's check for card a333fd46 ("Auto review P1"), run by session `d89d46ee-c91e-4b6f-9689-a274881c208b`. It is not independent verification.

- Tree: worktree `.worktrees/auto-review-p1`, branch `feat/auto-review-convergence`, uncommitted (base `b9bcd81`). `npm run typecheck` exited 0 before the install.
- Install: the shared checkout holds other sessions' uncommitted work in the same files, so flowly was pointed at the worktree for the run, at the user's choice (2026-11-26). Steps:
  - Back up `plugin-settings/flowly` and `flowly.sqlite`.
  - Run `paseo plugin remove flowly` and then `paseo plugin install <worktree> --id flowly`.
  - Copy the settings back and reload.
  - Paseo 0.17.4; the daemon was not restarted.
- Fixture: Tinylink.
  - One temporary card `ab513e55-3024-4765-b46f-6680f25ba52c` (directory mode, workspace `wks_a336a0eb8113a0b7`) asks for an action only a person can do: rotate a production API key in a hosting dashboard.
  - One session `6f7c1abd-66b8-41e7-a279-86620d457e2b` (codex/gpt-6-luna, low, full-access).
  - Tinylink's Auto review was switched on for the run (maxRounds 2). The review model is the user's setting (codex/gpt-6.2-sol).
- UI: headless Chromium on the installed app's web build (`open016`), desktop 1700 × 1000, connected to the real daemon. Screenshots and text come from `docs/promo/shot-lib.mjs`. Only this card's lines of the Attention popover are kept.
- Drivers: `live.mjs` (setup / deliver / cancel N / move / status / cleanup) and `ui.mjs` (one UI step).

## Results

| # | Step | Observed | |
|---|---|---|---|
| 1 | Agent delivers ("nothing in the repo can rotate the key") | Review round 1 in 13 s: Tests passed; "Does what you asked" is `needs_user/blocker`. Card **stays In review**, no rework message, event "Auto review needs you: …". `reviewCount` 1, `fingerprint.content` `b566354257de7671`. `attention.count` 0 → 1 | pass |
| 2 | UI after step 1 (`1-needs-user-*`) | Card face "Review needs you" with the person icon. Attention: "Tinylink · In review · Review needs you: Does what you asked: The repository owner must sign in to the hosting provider's dashboard, rotate … and confirm …". Drawer: "Review needs you · Round 1", the item reads "Needs you" with the detail open | pass |
| 3 | Redeliver; while the review runs, a person's message whose turn runs `sleep 60` (A1) | 14:30:40 review started → 14:30:41 A1 `in_review → development` (system, "resumed after a new message"). At 14:30:55 the review finished while the card was out of In review: state `cancelled`, `held: true`, event "Auto review held: the card left In review during the review" | pass |
| 4 | The turn ends without a report (A1r) | 14:31:49 A1r `development → in_review` ("No work was reported in that turn; restored"). The held result was **applied in the same second**: state `needs_user`, the same verdicts, `reviewCount` 2, content fingerprint unchanged. No second review ran | pass |
| 5 | UI after step 4 (`2-after-a1r-*`) | Card "Review needs you · 1 unread"; Attention line as in step 2 plus "· 1 unread" | pass |
| 6 | Redeliver; while the review runs, a person drags the card to Development (`tasks.place`) | Within 346 ms: state `cancelled`, reason "A person moved the card during the review.", event "Auto review cancelled: a person moved the card". No review session is left (`flowly-review` agents: none). `reviewCount` stays 2: a cancelled review does not count toward the cap | pass |
| 7 | Plugin log during the run | No failures logged | pass |

Note: delivering again while the card is already In review records only a progress note and starts no review. That is existing behavior, so steps 3 and 6 first move the card to Development from the agent.

## Cleanup (verified by `live.mjs cleanup`)

- The session was hard-deleted.
- The card was deleted with Archive, which archived its workspace. The backup is in plugin `removed/`.
- Tinylink's Auto review was restored to `{ enabled: false, maxRounds: 2 }`.
- The "Tests" command (`d5cf11d8-…`) that Auto review detected when it was switched on during setup was deleted. Before setup, Tinylink had no guardrails.
- Remaining: card none, dismissal none, labelled native agents none, active workspace none.
- Tinylink has its 6 cards, and its repository has no changes.
- Before flowly was reinstalled from the shared checkout, the plugin data held no `needs_user`, `held` or severity records. The old code cannot read them.
- The plugin settings are identical to the backup.

## Not run

- Compact layout and phone.
- Independent verification.
- A plugin restart while a result is held: the held result lives only in memory, so a restart loses it. A1r still returns the card to In review, with the review left as Cancelled, and a person can rerun it.
