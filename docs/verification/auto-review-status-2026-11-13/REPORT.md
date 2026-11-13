# Auto review waiting state — 2026-11-13

Continued session `427150b3-b3b3-473d-b2a4-c3c34b725e75` for card `c9bf9958-9dc7-401b-b1b1-06cd3fb4c517`.

## Scope and inputs

- Read the previous session's activity and the card's five existing acceptance criteria. Its recorded user decision was to show **Waiting for review**, retain the project's serial queue, and queue reviews before the turn-end hook's settings/model/timeline reads.
- Inspected the existing implementation and AUTO-REVIEW-SPEC. Added regression coverage for disabling Auto review before turn end, a second card waiting behind the first review, and suppressing an old failure/unread Attention signal after a new delivery.
- Tested the shared, uncommitted workspace, not an isolated commit. HEAD was `6108ecf` at inspection and `5ea3f09` after other sessions advanced main. Unrelated changes were preserved; this report does not validate those commits as standalone trees.

## Passed

| Command | Exit | Result |
| --- | --- | --- |
| `NODE_ENV=test FLOWLY_TELEMETRY=0 npm run typecheck` | 0 | TypeScript passed |
| `NODE_ENV=test FLOWLY_TELEMETRY=0 npm test` | 0 | 161 files passed, 1 file skipped; 1439 tests passed, 6 skipped, 0 failed; 23.81 s |
| `git diff --check` on this task's implementation/spec/catalog paths | 0 | No whitespace errors |

The full suite includes delivery-marker writes, hiding the previous result, blocking Rerun while waiting, clearing on start/skip, restart recovery and Rerun, serial queuing, Attention behavior and catalog validation.

## Failed, then corrected

The first full run exited 1 (1438 passed, 6 skipped, 1 failed). The new serial-queue fixture cloned the first card's `operationId`, violating `assertBoardInvariants`: **Duplicate task operation.** Gave the second fixture card its own operation ID and reran the whole suite, producing the passing result above. No production invariant or assertion was weakened.

## Live follow-up — 2026-11-13, 13:47–13:55 SGT

Re-ran `NODE_ENV=test FLOWLY_TELEMETRY=0 npm run typecheck` (exit 0) before reloading the installed `flowly` directory plugin. Reloads succeeded; the daemon was not restarted. No production source changed in this follow-up, so the passing full suite above was reused.

The computer-use inventory exposed the Paseo application but no window IDs or geometry. The user's two native windows were left untouched. Instead, `shot-lib.mjs` launched independent headless Chromium contexts, using the desktop app's installed 0.16 web build through the existing `open016` helper, connected to the real local daemon. These are live plugin UI checks, not native-window or phone acceptance. All screenshots and page-text exports use `shot` / `pageText` from `docs/promo/shot-lib.mjs`, excluding the host sidebar and other projects' tabs.

### Passed live checks

| Scenario | Desktop (1700 × 1000) | Compact (1000 × 1000; plugin width 680) |
| --- | --- | --- |
| A real agent-scoped delivery waits behind another card's running review | Card strip and drawer show Waiting for review | Same |
| Redelivery hides the previous unavailable result; Rerun is hidden while waiting | Passed | Passed |
| Plugin reload clears the waiting marker and records Review unavailable | Card and drawer show unavailable and restart reason | Same |
| Review starts following a real Rerun click in the compact drawer | Card and drawer show Reviewing and the running command | Same; Rerun disappears |

Six phase/layout captures (`waiting`, `recovered`, `running`, each in desktop and compact), plus an actual compact Rerun interaction, passed with no page errors. Screenshots are `<phase>-<layout>-board.png` / `-drawer.png`; the clicked Rerun has `rerun-compact-drawer.png`. The `*-ui.json` files record assertions and page errors. `waiting` was captured again after a previous unavailable review to verify the stale result was hidden.

The controlled guardrail command held the first card in the real project queue. The second card's `reviewWaiting` was observed through `board.read`; after reload its persisted review reason was exactly `Flowly restarted before the review started.` Rerun replaced it with a real running review and command. The fixture sessions used the available `claude/claude-haiku-5-5` configuration with `bypassPermissions`, without starting a model turn. Agent-scoped deliveries used the sessions' signed CLI requests against the running plugin. This verifies the idle-session delivery/project-queue path; it does not claim a fresh real-model delivering-turn-end check or a completed LLM verdict.

### Harness corrections

An early compact drawer screenshot was taken during its opening/loading transition; the initial recovered compact assertion ran before its reason loaded. The harness now waits for the specific status inside the drawer and the restart reason before capturing. All affected evidence was replaced by successful stable captures. No product-code change was needed.

### Cleanup

`live-ids.json` records the fixture project, two cards, two workspaces, two idle sessions and the successful cleanup receipt at 05:54:38 UTC. Session IDs were `76e21afe-ada1-4622-9607-272e3daae0a4` and `3f79c8d1-0eb7-479a-8d45-72d3d32ec0a1`.

- Deleted only those two sessions, then removed the fixture project and its cards through `projects.remove` with `alsoPaseo:true`.
- Re-read the plugin board and native project/workspace/agent registries: no fixture project, cards, sessions or workspaces remain.
- Released the fixture check processes and verified none remained; removed `.auto-review-status-fixture-503c` and its temporary git repository/request snapshots.
- Closed all test Chromium contexts. Tinylink and the user's windows/resources were preserved. Product-managed removal backups retain the normal recovery record.
- Retained only evidence and harness files in this verification directory (about 2.0 MiB). The earlier temporary full-suite log was removed.

## Remaining limits

- Native Electron window and physical phone rendering are unrun; desktop and compact web rendering are verified as described above.
- A fresh real-model delivering-turn-end and completed LLM review verdict are unrun in this follow-up.
- Independent verification on an exact commit is unrun. Changes remain uncommitted and unpushed in the shared workspace.

No new onboarding tour/tip or telemetry field is warranted for this correction to an existing status display.
