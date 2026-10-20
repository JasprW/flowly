# Native session acceptance verification

Date: 2026-10-20 (Asia/Singapore)  
Test session: `e63b5616-a0db-47cd-9b11-4c3691dcde10` — `codex/gpt-6-luna`, full access.  
Plugin under test: `flowly`, reloaded from main after the renderer kind fix and the Flowly behavior scope updates (main `6803f60`). The fixture agent used `claude/claude-haiku-5-5`, `bypassPermissions`.

## Fixture

- Tinylink project: `3db2ad5b-e6c4-4054-b2ed-a13a8dfa0663` (existing permanent fixture; not modified or removed).
- Temporary card: `40e346c9-b0ac-43b4-b003-82bd6b0e2903`, title `[test] native session bc0d52e9`, mode `directory`.
- Workspace: `wks_cce8ddd1737269a0`.
- Managed session: `4c4fb4a4-633f-4a9c-a12e-b9d7aaa4b10d`.
- Unmanaged session: `ff983e19-2f4f-4cf5-b72b-944db6826bad`.
- Summary rows observed: legacy pre-fix `flowly.summary:b66588be-0975-4175-980e-d0de7a3340b4` (rendered unavailable after the renderer-kind fix); new `flowly-summary-f8db7b4b-ea65-43eb-b05d-cd833c3dcaaf`, whose payload matched `summaries.read.latest`; later new row `flowly-summary-b4b0578d-440a-4932-b686-7400fcec04b7` also matched the latest summary while the fixture was active.
- Fixture IDs and RPC/browser observations are recorded in [evidence.json](fixtures/native-session/evidence.json). Browser checks are recorded in the per-mode `ui-evidence-*.json` files in the same directory.

## Results

| Check | Result | Evidence |
| --- | --- | --- |
| A1 — new summary row appended to managed session and absent from unmanaged session | **PASS** | `flowly-summary` row payload matched the latest summary; unmanaged timeline had no such row. The old `flowly.summary` row was a pre-fix artifact. See `fixture-observed` and `new-kind-summary-row` in [evidence.json](fixtures/native-session/evidence.json). |
| A2 — summary excluded from agent context; append did not change attention | **PASS** | After a no-tools follow-up, the agent did not repeat the exact summary state text and made no tool calls. Attention was identical immediately before and after the new row append (`requiresAttention=true`, `attentionReason=finished`). See `context-echo-check` and `new-kind-summary-row` in [evidence.json](fixtures/native-session/evidence.json). |
| A3 — native-chips includes managed session only | **PASS** | RPC listed the managed fixture session and not the unmanaged one. |
| B1 — native Progress card on desktop | **PASS** | Headless Paseo pane showed Progress, Target/Recap/Next, “Updated … · Haiku 5.5”, and “Open card”; see [desktop screenshot](native-session/native-session-desktop-current.png) and [current pane screenshot](native-session/native-session-current-state.png). **Open card navigation itself was not clicked (UNRUN).** |
| B1 — compact layout | **UNRUN** | Headless mobile mode opened the Tinylink board, but the mobile board initially exposed Backlog while the fixture card was in Test; the lane could not be reached reliably before cleanup. See [mobile failure screenshot](native-session/error-compact.png). No desktop behavior was inferred from this. |
| B2 — Next popover lists two moves, allows editing, sends exact edited text | **PASS** | Popover listed Verify and Commit; the editor was prefilled, edited, and sent. The exact user message `Edited in Paseo: verify the native summary card exactly.` was present in the managed session timeline; see `post-cleanup-readback` in [evidence.json](fixtures/native-session/evidence.json) and [send screenshot](native-session/native-next-sent.png). |
| B2 — Next chip disappears when the new turn starts | **FAIL (delayed)** | At the first post-send UI snapshot (+1.2 s), the session showed the active-turn stop control but still showed `Next · 2`; a later page load after the turn ended showed no Next chip. The immediate acceptance behavior was not met in the first snapshot. See [send screenshot](native-session/native-next-sent.png) and `ui-evidence-send-next.json`. |
| B3 — Next Dismiss hides native set; Flowly suggestion row remains unchanged | **PASS** | Native Next disappeared after Dismiss. Reopening Flowly showed its Verify/Commit suggestion row still present, and its transcript had no Progress card. See [dismiss screenshot](native-session/native-next-dismissed.png), [Flowly row screenshot](native-session/flowly-suggestion-row-after-native-dismiss.png), and [dismiss evidence](fixtures/native-session/ui-evidence.json). |
| B4 — Continue here confirmation adopts idea into this session | **PASS** | Confirmation stated it would send to this session; Send caused `idea_adopted`, and board data showed `status=accepted` with `acceptedAgentId` equal to the managed session. See [continued idea screenshot](native-session/native-idea-continued.png) and [idea-continue evidence](fixtures/native-session/ui-evidence-idea-continue.json). |
| B4 — Start a new task prefills form; cancel creates no card | **PASS** | Form title was prefilled with “Document session summary troubleshooting”; Cancel closed it and no task with that title appeared on the board. See [prefilled form](native-session/native-idea-new-task-form.png), [cancelled form](native-session/native-new-task-form-cancelled.png), and `final-board-check` in [evidence.json](fixtures/native-session/evidence.json). |
| B4 — Dismiss marks idea dismissed | **PASS** | The UI showed “Idea dismissed”; the `tasks.delete` backup captured before cleanup contains the idea with `status=dismissed`. See [dismiss screenshot](native-session/native-idea-dismissed.png) and `removed-backup-readback` in [evidence.json](fixtures/native-session/evidence.json). |
| B4 — Ideas chip disappears after Dismiss | **FAIL (delayed / immediate removal not observed)** | The same-page screenshot 500 ms after Dismiss still displayed `Ideas · 1`. A later fresh page showed no Ideas chip; no same-page post-poll snapshot was captured. See [dismiss screenshot](native-session/native-idea-dismissed.png) and [later current-state screenshot](native-session/native-session-current-state.png). |
| B5 — unmanaged session keeps Task chip and gets no Next/Ideas chips | **PASS** | Unmanaged session showed Task only; no Next, Ideas, or Progress row. See [unmanaged screenshot](native-session/native-unmanaged-session.png) and `ui-evidence-unmanaged.json`. |
| B6 — Flowly transcript excludes Progress card | **PASS** | After the Flowly-only scope update and a fresh page load, the Flowly managed-session transcript had no Progress card. See [Flowly-mode evidence](fixtures/native-session/ui-evidence-flowly.json) and [Flowly session screenshot](native-session/flowly-session-current.png). |
| B7 — Move to Done and wrap-up behavior | **PASS** | Next popover contained Move to Done; clicking it moved the card to Done. `Auto wrap up=true`, so no wrap-up question or “Not now” choice appeared. Both sessions were automatically archived. See [popover](native-session/native-move-to-done-popover.png), [result](native-session/native-moved-to-done.png), and `move-to-done-suggestion-ready` / `cleanup-verify` in [evidence.json](fixtures/native-session/evidence.json). |
| C1 — Flowly board, drawer, and existing session UI | **PASS** | Board and drawer Progress section rendered; the existing suggestion filled the composer, and Flowly’s own Hide suggestions control hid its row. No `native-session` tip was visible. See [Flowly-mode evidence](fixtures/native-session/ui-evidence-flowly.json), [drawer](native-session/flowly-drawer-current.png), and [Flowly suggestions hidden](native-session/flowly-session-own-suggestions-hidden.png). The welcome tour was not opened (UNRUN). |
| Browser page errors | **PASS** | `page.on('pageerror')` recorded no page errors in successful browser runs. Locator/navigation retries and timeouts are recorded in the per-mode evidence; they were not page errors. |

## Cleanup

- `tasks.delete` removed the temporary card after backing up its plugin data to `removed/task-40e346c9-b0ac-43b4-b003-82bd6b0e2903-2026-10-20T14-27-41-762Z.json`.
- Final board check: fixture card absent; cancelled-form task absent; Tinylink remained at its original six tasks.
- Both fixture sessions had `archivedAt=2026-10-20T14:27:12.603Z`; Auto wrap up archived them before card deletion.
- `wks_cce8ddd1737269a0` was absent from `paseo workspace ls`.
- The plugin still returns the archived managed session in `sessions.native-chips` after card deletion; the unmanaged session is not returned. This is retained plugin session-binding metadata, not an active board card/workspace. No supported RPC for removing that binding was used, and plugin data was not edited directly.
- No fixture directories or extra tasks were left behind. The only retained fixture assets are this report, the acceptance scripts/evidence, and screenshots under `docs/verification/`.

## Overall

Core data checks: **3 PASS**. UI: **10 PASS, 2 FAIL, 3 UNRUN** (including compact layout, Open card navigation, and welcome-tour inspection). Main failures: Next-chip removal was not immediate after Send; Ideas chip remained visible in the same-page snapshot after Dismiss. Cleanup completed for the card, sessions, and workspace, with the archived managed-session binding metadata noted above.

## Round 2 — Suggested next steps timeline card

Date: 2026-10-20 (Asia/Singapore)  
Test session: `e63b5616-a0db-47cd-9b11-4c3691dcde10` — `codex/gpt-6-luna`, full access.  
Fixture agents: `claude/claude-haiku-5-5`, `bypassPermissions`.  
Plugin build: the running Flowly plugin after the implementer's `12073cc` update. No plugin reload or daemon restart was performed by this test.

### Fixture

- Existing Tinylink project: `3db2ad5b-e6c4-4054-b2ed-a13a8dfa0663` (preserved).
- Temporary card: `362b1dc5-6868-45c2-9c91-aef6a5206fa9`, `[test] native session round 2 efdb87ff`, directory mode.
- Workspace: `wks_01858c75920f019f`.
- Managed session: `24f2a7bd-69f8-4b93-9613-ef497b772fad`.
- Unmanaged session: `1f17c507-425c-41c4-a56d-6c6bd9408f01`.
- Initial next-moves event/row: `2a67a2d8-c16a-4766-940f-e0d1fe11f631` / `flowly-next-moves-2a67a2d8-c16a-4766-940f-e0d1fe11f631`.
- Idea: `6c13394b-8328-4065-bb69-2b2a7db9e969` (“Document native timeline behavior”).
- The fixture also generated a compact-layout row `flowly-next-moves-2ddd4a8d-59f5-4e6c-a871-3c515aecddcd` and final Move to Done row `flowly-next-moves-431a1b56-bc18-47f0-9e1d-316dae345cdc`.
- Full RPC and browser observations are in [Round 2 fixture evidence](fixtures/native-session/round2/evidence.json) and [Round 2 UI evidence](fixtures/native-session/round2/ui-evidence.json). Screenshots are in [the Round 2 screenshot directory](native-session/round2/).

### Results

| Check | Result | Evidence |
| --- | --- | --- |
| D1 — native ready card under the last reply; no Next composer chip | **PASS** | At 1700×1000, the “Suggested next steps” card appeared after the final assistant reply, with “Inspect row” and “Verify fill”. SDK timeline row kind/id/status were `flowly-next-moves`, `flowly-next-moves-2a67a2d8-c16a-4766-940f-e0d1fe11f631`, `ready`; its event id and two prompts matched. No Next composer chip was present. See `d1` in [UI evidence](fixtures/native-session/round2/ui-evidence.json) and [desktop screenshot](native-session/round2/d1-desktop-ready-card.png). |
| D2 — Fill sends nothing and appends after existing text | **PASS** | Tapping “Inspect row” filled exactly `Inspect the native timeline row and verify its event id.` and focused the managed session’s composer. After entering `hello`, tapping “Verify fill” produced exactly `hello\n\nVerify that this prompt fills the correct session input.` User-message count remained 1 throughout; no send occurred. React-fiber ownership matched the managed agent and fixture workspace. See `d2` and [fill screenshot](native-session/round2/d2-fill-append.png). |
| D3 — Copy setting, clipboard, and restoration | **PASS** | Changed the setting through Flowly Settings → AI features → “Paseo's session view” to Copy. The move showed “Copied”, clipboard text exactly matched its prompt, composer text did not change, and no user message was sent. Restored and verified `nextMoveTap=fill`. See `d3` and [copy screenshot](native-session/round2/d3-copy-result.png). |
| D4 — next turn rewrites the same row and stays dismissed after reload | **PASS** | Sending `Round 2 composer send: begin a new turn to dismiss this suggestions card.` from the managed native composer caused the exact same row id to become `{status:"dismissed"}`. The card was gone before and after reload/reopening the managed session, and the timeline contained the exact message. See `d4` and [dismissed screenshot](native-session/round2/d4-row-dismissed-after-reload.png). |
| D5 — native X hides only the native card | **PASS** | “Hide suggestions” immediately removed the native card while the raw row stayed `ready`. In Flowly’s own session view, its separate suggestion row and both move buttons remained visible. See `d5` and [Flowly suggestion-row screenshot](native-session/round2/d5-flowly-suggestion-row-preserved.png). |
| D6 — Ideas Dismiss refreshes the same page | **PASS** | Dismissing the fixture idea removed the Ideas chip within one second without a reload; board state changed to `dismissed`. See `d6` and [Ideas screenshot](native-session/round2/d6-idea-dismissed-same-page.png). |
| D7 — Move to Done and wrap-up prompt | **FAIL** | With Auto wrap up temporarily disabled, tapping “Move to Done” moved the card to Done and showed the “Moved to Done” toast. No wrap-up question or choices appeared, so “Not now” could not be selected. This was still absent after a 12-second wait. The concurrent `tasks.wrapup-check` reported two sessions, an archivable workspace, and no blockers/warnings, so the prompt was expected. Auto wrap up was restored to its original `true`. See `d7` and [Move to Done screenshot](native-session/round2/d7-move-to-done-dialog.png); the checker result is in [UI evidence](fixtures/native-session/round2/ui-evidence.json). |
| D8 — compact rendering at 430×900 | **PASS** | Reached the managed session in headless mobile mode by opening its native workspace URL and using “Switch tabs” to select the managed tab. At 430×900 with `isMobile`/`hasTouch`, the card and both buttons rendered, wrapped within the viewport, and did not horizontally overflow. Initial navigation through the mobile Tinylink sidebar failed because its workspace button was unavailable in that view; the direct Paseo session route succeeded. See the final `d8-compact` result in [UI evidence](fixtures/native-session/round2/ui-evidence.json) and [compact screenshot](native-session/round2/d8-compact.png). |
| D9 — unmanaged session behavior | **PASS** | The unmanaged session showed the existing Task chip, no Suggested next steps card, no Ideas chip, and no Next composer chip. The native-chip RPC did not list the unmanaged session. See `d9` and [unmanaged screenshot](native-session/round2/d9-unmanaged.png). |
| Browser page errors | **PASS** | `page.on('pageerror')` recorded no errors in successful UI runs. One settings locator initially used the wrong accessible name and one mobile sidebar route lacked its workspace button; these were corrected or bypassed using the UI’s native session route, not treated as page errors. |

### Cleanup and settings restoration

- `tasks.delete` removed the test card after writing backup `/Users/bofan.wang/.paseo/plugin-data/flowly/removed/task-362b1dc5-6868-45c2-9c91-aef6a5206fa9-2026-10-20T15-10-28-747Z.json`.
- Cleanup verification confirmed the card is absent from `board.read`; both fixture sessions are closed and archived; workspace `wks_01858c75920f019f` is absent from `paseo workspace ls`.
- Tinylink remains intact with its original six cards. No project, other card/session, or Tinylink directory was removed or reset.
- Settings are restored and verified as `nextMoveTap=fill` and `autoWrapup=true`.
- `sessions.native-chips` still lists the archived managed fixture binding after cleanup; the card, sessions, and workspace themselves are gone. No direct plugin-data edits were made.
- Browser page errors: none. No leftover test child agents or temporary dirs were created.

### Round 2 summary

**8 PASS, 1 FAIL, 0 UNRUN.** The main failure is D7: the native Move to Done action did not show the wrap-up prompt despite a clean preflight with two sessions and an archivable workspace. Desktop and compact next-moves rendering, fill/copy behavior, dismissal, Ideas refresh, and unmanaged-session isolation passed.

## Round 3 — D7 wrap-up choices

Date: 2026-10-20 (Asia/Singapore)  
Test session: `e63b5616-a0db-47cd-9b11-4c3691dcde10` — `codex/gpt-6-luna`, full access.  
Fixture agents: `claude/claude-haiku-5-5`, `bypassPermissions`.  
Plugin under test: Flowly after the implementer's `f44b222` update.

### Settings recorded before fixture creation

Through the headless Flowly settings UI, before creating any Round 3 resources, I recorded Auto wrap up **on**, Auto archive on delete **on**, and Tapping a suggested next step **Fill the message box**. The original values are in [settings-before.json](fixtures/native-session/round3/settings-before.json); after testing, a fresh UI read confirmed all three were restored exactly.

### Fixtures

- Existing Tinylink project `3db2ad5b-e6c4-4054-b2ed-a13a8dfa0663` remained intact.
- D7a/D7b card `6bd565b0-4f53-4027-ab6d-7e047935abe3`, workspace `wks_b9b122aa3eb49e8c`, managed session `3c82e691-c29d-458a-a8bd-545530443e1a`.
- D7c card `f8195786-d9fd-4af2-953a-b2a4f37a9264`, workspace `wks_6f4530b911c9404d`, managed session `4f3f1dfb-cc9c-45a5-bc93-ee186cce168b`.
- Fixture creation, event IDs, state changes, and cleanup verification are in [Round 3 fixture evidence](fixtures/native-session/round3/evidence.json). UI observations are in [Round 3 UI evidence](fixtures/native-session/round3/ui-evidence.json); screenshots are in [the Round 3 screenshot directory](native-session/round3/).

### Results

| Check | Result | Evidence |
| --- | --- | --- |
| D7a — Auto wrap up off; fresh setting read; Not now | **PASS** | Opened the native session while Auto wrap up was on, then changed it to off in a second browser page without reloading the native session. The native view was still on the same session; at click time the RPC also read `autoWrapup=false`. Move to Done displayed “Wrap up this card?” with Not now, Open in Flowly, and Wrap up. Not now closed the question and removed the next-moves card; the task stayed Done, the session remained idle/unarchived, and the workspace remained present. See `d7a-auto-wrapup-off-not-now` in [UI evidence](fixtures/native-session/round3/ui-evidence.json), [question screenshot](native-session/round3/d7a-wrap-question.png), and [after Not now](native-session/round3/d7a-after-not-now.png). |
| D7b — choose Wrap up | **PASS** | Reopened the same card to Development, had the agent deliver a fresh Move to Done row, then selected Wrap up from the three-option question. The card remained Done; its one managed session was archived and its workspace disappeared from `paseo workspace ls`. The card backup records `wrapped_up` with “1 session(s) archived; workspace archived; card kept.” See `d7b-wrap-up-manually`, `fixture-a-second-move-readback`, and cleanup evidence in [Round 3 fixture evidence](fixtures/native-session/round3/evidence.json), [question screenshot](native-session/round3/d7b-wrap-question.png), and [wrapped-up screenshot](native-session/round3/d7b-after-wrap-up.png). |
| D7c — Auto wrap up on | **PASS, recovered readback** | With Auto wrap up on before the second card/session was created, tapping its Move to Done did not show a wrap-up question during the 15-second UI poll. The task reached Done; the managed session closed and archived; the workspace disappeared. The card backup records the daemon's `workspace_auto_archived` event (“Workspace and 1 session(s) archived; the directory stays on disk.”). A transient Flowly service stop/load occurred during the post-action UI state RPC, so that browser run ended with “Plugin is not available”; after Flowly was ready, board, session and workspace readback confirmed the result. The no-question observation is documented with that recovery caveat in [D7c recovered readback](fixtures/native-session/round3/d7c-recovered-readback.json); see also [browser screenshot](native-session/round3/error-b-auto.png) and the card B cleanup backup referenced in [fixture evidence](fixtures/native-session/round3/evidence.json). The service stop/load was not initiated by this test; the plugin was running during final verification. |
| Settings restoration | **PASS** | Fresh Flowly Settings UI read after cleanup confirmed Auto wrap up **on**, Auto archive on delete **on**, and next-step behavior **Fill the message box**, matching the pre-test baseline. See `settings-final-restored` in [UI evidence](fixtures/native-session/round3/ui-evidence.json). |
| Browser page errors | **PASS** | No Playwright `pageerror` events were recorded. The D7c interruption was a transient plugin RPC availability error during a plugin stop/load, not a browser page error. |

### Cleanup

- `tasks.delete` removed both temporary cards after writing backups. D7a/D7b's wrap-up already archived card A's session/workspace; D7c's daemon auto-wrap-up already archived card B's session/workspace.
- Cleanup readback confirmed both cards absent from the Flowly board, both sessions archived, and both workspaces absent from `paseo workspace ls`. Tinylink remained at its original six cards.
- Auto wrap up, Auto archive on delete, and next-step behavior are restored to their recorded baseline. No other resource or the Tinylink directory was changed.

### Round 3 summary

**3 PASS, 0 FAIL, 0 UNRUN.** The previous D7 prompt failure was not reproduced: the question stayed available after the suggestion set ended, the setting change was read fresh while the native session remained open, manual Wrap up archived the session/workspace while keeping the card, and Auto wrap up on let the daemon archive without asking. D7c's post-action RPC overlapped a transient Flowly service restart; its UI no-question poll completed and the persisted state was verified after the plugin returned to running.
