# Native session chip back to a Kanban card

Status: implementation authorized by the user's request. A linked native session gets a chip that opens Flowly at its task's overview (see the 2026-10-16 amendment).

## 2026-10-14 amendment — chip action navigates only

User report (Android): tapping the chip showed a host toast `Cannot read property 'id' of undefined`. Not reproducible in the web client (fresh mount or with the board already mounted after Open in Paseo). The chip action no longer pre-validates through the client-level RPC/SDK: it opens screen `board` with the link and a new request ID. The board screen's existing fresh read and membership validation remains the authoritative fail-closed check, and its errors surface on the board. Any remaining action failure is rethrown with the step prefix `Couldn't open Ultra Kanban:`; board-side lookups prefix `Kanban board read failed:` / `Session lookup failed:`. This supersedes the earlier "Clicking a chip fresh-reads the board and refreshes its native actor" and "Native chip actions revalidate even between poll intervals" lines; competing clicks now resolve as last navigation wins.

## 2026-10-16 amendment — Hermes root cause; chip opens the task

Root cause of the Android toast above: Hermes gives a loop body's `const` one binding for the whole loop, so every chip's press handler read the last iteration's task/actor (`undefined` when the last agent had no card) and threw before the prefixed step. Chip buttons are now built in their own call (`chipButton`); deferred closures must never capture `for` loop variables (AGENTS.md).

User decision: the chip opens the **task**, not the session it was tapped in. The board still validates the full link (card, workspace and the session's membership) and then opens the card's overview. A card that is already open on a session preview returns to its details (a one-time entry with an empty session ID). This supersedes "select the exact session preview" below; Back/Close/re-click rules apply to the overview the same way.

## 2026-10-18 amendment — cheaper poll

Phones decode every response on the JS thread, and this poll ran while the user typed in Paseo's composer. The 5 s round now reads the board by etag (`board.read-changed`; unchanged rounds transfer no board) and lists live sessions only. Archived sessions are rescanned when the board changed, when a chipped session left the live list, or at most once a minute. A chip is updated only when its label/title changed. This supersedes "polls the host board and paginated agent directory every five seconds, including archived actors" below (PERFORMANCE-SPEC, follow-up 2026-10-18).

## 2026-10-21 amendment — the archived scan leaves the round

The archived scan (every agent on the host, 3 MB here) no longer runs inside the round and no longer follows a board change: it runs after the round, when a chipped session left the live list or once a minute, and the round's live sessions come from the agent stream (listed once, then every minute). A board change still updates every chip title from what is held. This supersedes "rescanned when the board changed" in the 2026-10-18 amendment. Reason and numbers: NATIVE-SESSION-SPEC §8.1.

## Capability and placement

Pinned public SDK 0.11.2 supports `PluginClientContext.addComposerPill({id,workspaceId,agentId,button})`, asynchronous action behavior, `openScreen({screenId,params})`, and string-valued `PluginScreenProps.params`. Use a native composer-track chip next to Paseo's Tasks/Subagents controls. Its icon, hit target, pending/error state and compact layout are host-owned. No private pane import or native app change.

The plugin context owns one host's SDK/RPC/navigation. Discover links only from that host's board and directory; `client.openScreen` opens the plugin screen on that context's host. No second connection, private host import or external URL/DOM navigation.

## User behavior

- Each existing session whose actual workspace is bound to a board card gets one **Task · title** chip. Its accessible full title names the task. Unlinked sessions have no chip. Multiple sessions in one workspace link to the same card but keep their own session IDs. Archived sessions/cards/projects remain linkable for read-only inspection when native resources still exist.
- Clicking a chip fresh-reads the board and refreshes its native actor. Require the original card/workspace identity and actual membership, and an existing board project. Then open screen `board` with task/session/workspace IDs and a new request ID. No prompt, read acknowledgement, task status or native resource mutation.
- The board independently validates string route params and resolves a fresh board/actor before opening. Select the card's project, clear title/priority filters, reveal archives/finished columns if needed, select its compact status, open the task sidebar at the card overview. Preserve the current sidebar width where the host keeps this screen mounted.
- Preview **Back to task** returns to that card overview. Sidebar Close stays closed, and manually opening a card starts at task details. Polls, rerenders and unchanged URL params must not reopen the session after Back or Close. Clicking the chip again creates a new request, so the same session can explicitly reopen. A second chip for another session/card redirects to that new target.
- Newer navigation wins over a slower older request. Changing params to an invalid/missing/moved target closes the previous target sidebar and reports an error; never substitute another card, project or session. The board remains usable through ordinary navigation. Only known params are used; partial malformed card links fail closed.
- The initial sidebar session entry is consumed once. Subsequent session choices, actor-specific drafts, operation locks, subscriptions, read state, composer and follow-tail retain existing behavior. Opening the chip does not mark a session as read.

## Registration and lifetime

One client-level refresh polls the host board and paginated agent directory every five seconds, including archived actors for linking. It creates/updates/removes registrations by agent ID as workspace membership, card title or board links change. Initial loading or lookup failure exposes no stale chip target. Do not subscribe to conversations or create per-card native connections.

Do not overlap polling reads; stop timers and remove all owned chips on cleanup. Late RPC/directory/action completions cannot register or navigate after teardown. Native chip actions revalidate even between poll intervals. Superseded requests do not show stale errors or navigate late. No server storage/schema/RPC migration: existing `board.read` and supplied agent SDK suffice.

## Route and architecture

Screen string params: `{ taskId, sessionId, workspaceId, requestId }`. IDs are nonempty and bounded; malformed partial links produce an actionable error. Request identity distinguishes repeated clicks, not authorization. Board validation has a fresh mount/request-scoped query and releases its cache; copied or stale URL params never bypass membership validation.

- `client/session-link.ts`: param validation, fresh link resolution, host-scoped native chip registration and cleanup.
- `index.client.tsx`: thin registration and returned chip cleanup.
- `client/board.tsx`: route resolution and one-time project/filter/sidebar entry. A request updates the host-scoped board cache with its fresh validated snapshot.
- `client/drawer.tsx`: consumes a targeted entry once (an empty session ID selects the card overview); Back continues to clear local selection.

## Verification and cleanup

Use one explicit full-access Paseo `codex/gpt-6-luna` session in the existing development workspace. Test agent owns only `docs/verification/session-chip.md` and its fixtures. Use fake SDK/registrations and temporary renderer; no fixture native project/workspace/card or child is needed. Delete the exact test session and unique temporary directories when complete.

Focused checks: public capability gate; linked/unlinked/multi-session/archived chips; title/ownership updates and removal; fresh-click membership guard; correct screen/params on the same host context; repeated and competing click ordering; failed lookups and cleanup during in-flight reads/actions; route valid/partial/stale/moved lookup; initial card/project/archive/finished/filter handling; exact preview entry, Back, Close, manual card reopen and second navigation; draft/subscription/read state remain independent. Typecheck before reload and run one full suite after source stabilizes. Preserve board/read-store bytes and native resources.

If the existing development workspace is linked to a user card, creating/running the required test session produces ordinary persisted lifecycle events through the existing Phase 2 hooks. Record this separately from intentional test writes; do not restore older board bytes, remove user records or claim a globally unchanged board hash. Deleting the exact test session removes it from session counts; preserve its normal history entries. No test acknowledgement changes the live read-store file.

Actual native chip appearance/focus and desktop/compact navigation require a safely identified non-fullscreen Paseo window. If CUA cannot bind its actual ID/title/geometry, stop native UI actions and mark these checks UNRUN. Synthetic callbacks and runtime running do not prove native focus or rendering. Record PASS/FAIL/UNRUN, reload only this plugin, never restart the daemon, and stop for user review.
