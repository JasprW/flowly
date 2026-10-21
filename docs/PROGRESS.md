# Implementation progress

## Session pane: history, keyboard, scroll performance (card "sidebar session 优化") — 2026-10-20

- [x] Design and feasibility: [SESSION-PANE-SPEC](SESSION-PANE-SPEC.md). Read-only SDK spike on the local daemon: `before`/`after` cursors page cleanly (tail 15 + before 15 = tail 30), whole turns of 1000 entries are ~69 KB slim.
- [x] Decisions (user): open on the current turn (≤ 300), Load earlier row, FlatList directly (phones: inverted, as Paseo's own view; web: plain scroll view).
- [x] Implemented: `sessions.tail` modes turn/before/after; `client/session-timeline.ts` (incremental refresh, Load earlier ≤ 1000); `client/session-transcript.tsx` (own component, inverted virtualized list on phones, lifted with the composer by the keyboard's native-driver value); follower never scrolls during a drag; display cap removed; tip `session-history`; strings in all catalogs.
- [x] PASS: `npm run typecheck`; `npm test`; new tests for daemon paging (turn stop at user message, cap, before/after, stale cursor), window merges, follower (normal and inverted), tip order.
- [x] PASS (Luna 6 `0870a92e`, web desktop 1700×1000 + compact 430×900): current turn on open, Load earlier keeps position (Δ < 1 px), follow tail / Latest, no console or plugin errors. [Report](verification/session-pane-history.md). The tip did not show because it was already recorded as seen.
- [x] Fixed: `tipsSeen` was capped at 20 with 20 tips, so the next tip would have pushed out `first-card`; cap now 100 (`TIPS_SEEN_MAX`).
- [x] Images in first messages (user request 2026-10-21): New task's agent instruction and New session take images on web (paste, drop, Add images). Phones: declined by the user (no plugin picker; host internals not used). Spec §6.
- [ ] UNRUN: phone verification (iPhone + Android: keyboard lift with reader at end and scrolled up, Load earlier position, scroll FPS before/after with RN perf monitor); AndroMeld Android Use was off.

## Native session pane: faster Next moves card, one card style — 2026-10-21

- [x] Requests: (1) on phones the Progress card is quick but the Next moves card is slow; (2) the two timeline cards look different. Spec: NATIVE-SESSION-SPEC §8.1, §5.3, §6.3; SESSION-CHIP-SPEC 2026-10-21 amendment.
- [x] Cause measured on this host (1251 agents, 386 summarizer leftovers): a chip refresh round listed all live agents (233 KB), then every agent including archived (3.1 MB) after any board change, before it computed the Next moves state; rounds ran every 5 s; the daemon wrote the card behind the model lookup (up to 2 s) and a board write. Luna's partial baseline (round 5, CPU rate 4 and 1, raw data in `docs/verification/fixtures/native-session/perf/`, not committed or reported): Progress card visible 13-64 ms after its row, Next moves card 0.4-5.9 s after its row.
- [x] Fix (commit "Next moves card no longer waits for the archived scan"): state first, archived scan after and not on board changes; live sessions from the agent stream; pushed status / user-message / permission changes trigger a round within ~150 ms; a row that arrives first asks for a round; managed card written first in the hook; unchanged chip state wakes no subscriber; timing log entries `chips.round`, `chips.archived`. Unit tests: `client/live-agents.test.ts`, `client/session-chips.test.ts`.
- [x] Style (commit "Progress and Next steps cards share one frame and header"): `client/native-card.tsx` header + frame, `ContentCard` optional `header`; Open card moved into the header so the phone footer no longer wraps. Screenshots: `docs/verification/native-session/style/`.
- [x] PASS: `npm run typecheck`; `npm test` 786 passed / 65 skipped (branch), 821 passed on the combined main tree; plugin reloaded, headless load has no page errors; Progress card checked on desktop and a 430 px phone layout.
- [ ] UNRUN (user cancelled the Luna measurement, 2026-10-21: "if there is a performance problem I will come back"): the after-fix Next moves latency, live on a phone or CPU-throttled; the Next moves card with the new style was not screenshotted (no ready card existed at deploy time).

## Native session pane P2–P4: sessions outside Flowly — 2026-10-21

- [x] Request: give every session Flowly does not manage the same Progress / Next moves / Ideas without joining a project; ideas may continue in the session, a new session or a new workspace. User decisions: Paseo child sessions (like card summaries), off by default, three switches. [Spec §12](NATIVE-SESSION-SPEC.md).
- [x] Daemon: `server/session-insights.ts` (store `session-insights.json`, capped; one child insight session per completed turn, merged while one runs; progress / moves / ideas from one JSON answer; rows appended in the background; suggestion ends at the next turn; idea actions here / session / workspace), `shared/session-insights.ts` (schemas, prompt, lenient parser), `NextMoveRows.writeSession`, hooks for unmanaged sessions, RPCs `sessions.insights` (etag), `sessions.idea-run`, `sessions.idea-dismiss`.
- [x] Client: chip refresh reads insights only when switched on; `sessionChipMoves`; card-less Next moves card and Progress row (no Open card); `OutsideIdeasPopover`; settings switches. Flowly's own screens unchanged apart from the settings.
- [x] PASS: `npm run typecheck`; `npm test` 102 files / 765 passed, 65 skipped (rebased on main).
- [x] Luna 6 round 4 (session `e63b5616-a0db-47cd-9b11-4c3691dcde10`; fixtures: a plain session in a temporary Tinylink card's workspace and one in a temporary git repo outside any Flowly project, all cleaned up; settings restored): 10 PASS, 0 FAIL. Off does nothing; on gives both sessions a Progress row without Open card and a Next moves card under the reply (rows verified by SDK); Ideas chip "Ideas · 2" with Continue here and New session working; Progress and Next steps switches each gate their part; the next turn dismisses the card in place; a managed session keeps its card path (Open card, no outside run); Flowly's own screens unchanged. [Evidence](verification/native-session.md#round-4).
- [ ] UNRUN (no idea was generated for the repo session): Ideas Dismiss, New workspace, the non-Git error, and the Ideas switch suppressing an open idea live. Covered by unit tests (`server/session-insights.test.ts`, `client/session-chips.test.ts`) only.

## Native session pane: Summary, Next moves, Ideas (P1) — 2026-10-20

- [x] Card request "summary、next move、ideas上原生session": the same features in Paseo's own session view for Flowly-managed sessions; user decisions: Summary through the native timeline, P1 only, timeline rows best effort; later (after the prompt-suggestions reference) Next moves as a timeline card instead of a chip, tapping fills Paseo's message box by default (setting: or copy), Ideas stays a chip. [Spec](NATIVE-SESSION-SPEC.md), [plan](superpowers/plans/2026-10-20-native-session.md).
- [x] Risk probe (temporary `flowly-probe` plugin, Claude Haiku + Codex Luna sessions in Tinylink, all cleaned up): appended rows never reach the agent, raise no attention, are visible to the plugin's SDK refetch, are accepted by both providers, and are lost on session reload. Spec §5.5.
- [x] Daemon: a new summary version appends a `flowly-summary` row to the session whose turn produced it; skipped after a newer turn of that session or for an archived session; failures only logged (`server/summaries.ts`, `shared/native-session.ts`).
- [x] Client: `SummaryRow` for Paseo's timeline renderer (`client/summary-row.tsx`; per the user, not shown in Flowly's own session view, which has the sidebar's Progress); Next moves card (`server/next-move-rows.ts` writes `flowly-next-moves` rows at turn end and dismisses them at the next turn start; `client/next-move-card.tsx` renders it while `chipMoves` says the set is current; `client/web-composer.ts` fills the session's message box on web/desktop under the new AGENTS.md exception, else copies; setting `native-session.nextMoveTap`); Ideas pill on managed sessions in the existing chip refresh (`client/session-link.ts`, `client/native-chips.ts`); Ideas popover and revalidating actions (`client/native-popovers.tsx`, `client/native-actions.ts`); hidden suggestion sets for the card (`client/hidden-moves.ts`); board opens the prefilled new-card form from an idea link (`parseIdeaLink`); RPC `sessions.native-chips`.
- [x] Scope (user, 2026-10-20): the feature must not change Flowly's own behavior or look. No Flowly tip, tour unchanged, Flowly's suggestion-row × stays local (not shared with the card's ×), no Progress card in Flowly's session view, summary queue never waits on the row append. New in Flowly only: the `ideaId` board link opened by the native Ideas chip, and the user-requested setting on Settings → AI features. README; strings in all 9 catalogs used only by the native card/chip/popover and that setting.
- [x] Fixes from live use: the timeline kind/id must match Paseo's `^[a-z][a-z0-9-]*$` (a dot broke the whole client plugin; host-id test added); after Move to Done the wrap-up question outlives the suggestion set and reads Auto wrap up fresh; Ideas actions refresh the chips at once; rows in Paseo's view get a shared Reduce Motion provider, so Show more / Show less animate (headless: 193→377 px over ~210 ms, back over ~175 ms).
- [x] PASS on the combined main tree (this commit + other uncommitted work): `npm run typecheck`; `npm test` 103 files / 793 passed, 65 skipped. Plugin reloaded from the main checkout; headless app load has no page errors.
- [x] Luna 6 full-access verification, session `e63b5616-a0db-47cd-9b11-4c3691dcde10`, Tinylink fixtures cleaned up ([evidence](verification/native-session.md)): round 1 (chip version, superseded) data 3 PASS, UI 10 PASS / 2 FAIL (chip refresh lag, fixed) / 3 UNRUN; round 2 (timeline card) 8 PASS / 1 FAIL (D7, fixed); round 3 (D7) 3 PASS. Covered: Progress row desktop + compact, Next moves card fill / copy / dismissed rewrite / × / no Next chip, Ideas chip immediate refresh, Move to Done with Not now / Wrap up / Auto wrap up, unmanaged sessions get nothing, Flowly's own board/drawer/session view unchanged.
- [ ] UNRUN: the iOS/Android apps (filling falls back to copying there; not checked on a device); "Open card" on the Progress row and the welcome-tour check from round 1 were not re-run.

## Connectors: Confluence, GitHub, GitLab (card "更多connector接入") — 2026-10-20

- [x] Request: bring in more external connectors (Confluence, GitHub, GitLab …), gather them under the Artifacts +, then wire up each one. [Spec](CONNECTORS-SPEC.md).
- [x] Decisions (2026-10-20, §11): generic names instead of the ticket ones (the design recommended keeping them; the user chose renaming after hearing the alias/migration cost): artifact `ticket` → `external` (board v5), `flowly_read_ticket` → `flowly_read_external` (old name kept as an alias), CLI `ticket` → `external`, RPC `tickets.*` → `connectors.*`; PR/MR give file names, not diffs; New task From Jira becomes one From <service> button per connected service; order Confluence → GitLab → GitHub.
- [x] Implemented: `shared/connectors.ts`; `server/connectors/` (read-only HTTP with per-service GET whitelists, Jira moved in unchanged, Confluence DC/Cloud pages with storage → Markdown, GitLab issues/MRs, GitHub issues/PRs incl. Enterprise, project repositories from git remotes, `ConnectorService`); v4 → v5 migration with `board.pre-v5.json`; `tickets/` → `connectors/` data move at start; unified + menu in the drawer, Settings → Connections with four groups, picker/preview/chip generalized, card-face key and icon; tip `connectors`, tour row, README; 9 catalogs +68 / −32.
- [x] PASS: `npm run typecheck`; `npm test` 101 files / 780 passed, 65 skipped (with other cards' new tests) (new connector adapter tests with mock fetch, store migration, card-display old id, tip rule).
- [x] Independent code review: fixed token reuse on an edited address, https-only (loopback excepted), redirects reported as moved, body timeout, moved Jira keys, Confluence comments and unread, bare keys falling back to file paths, picker passing its connection, per-service picked keys (CONNECTORS-SPEC §12.1); regression tests added.
- [x] PASS (live): `paseo plugin reload flowly` migrated the real data (one Jira connection, one ticket input; board v5, `board.pre-v5.json`, `connectors/`); on this card a bare `SHOPSR-69689` was recognized against jira.shopee.io, `get_task` returned `external` plus the deprecated `ticket`, `flowly_read_external` returned the ticket Markdown; the temporary input was removed.
- [x] PASS (real services, tokens from the user's `~/.env` entered through the Settings page): GitLab git.garena.com and Confluence confluence.shopee.io connected, links recognized (nested groups, `/diffs` subpage, viewpage), `flowly_read_external` read an MR, an issue and a page, + menu and pickers (recent and text search) work. Found and fixed: GitLab 14.10 has no `/diffs`, so MR changed files now fall back to `/changes` (names only). Temporary inputs removed; connections kept.
- [x] User feedback (2026-10-20): GitHub search now needs `is:issue` or `is:pull-request` (HTTP 422 from New task → From GitHub) → every search runs both kinds and merges them; Confluence recent list now shows pages I viewed (DC recently-viewed endpoint, Cloud CQL `recentlyViewedContent`) and edited, newest activity first. PASS live on github.com (@JasprW) and confluence.shopee.io; `npm test` 795 passed / 65 skipped.
- [x] Luna 6 full-access UI acceptance against local mock GitLab / GitHub Enterprise / Confluence servers (session `d4e02830-acc3-4634-b8d1-74ceb1d869c4`, card session `01a158d9…`): cases 1–7, 10, 11 PASS (Settings groups, single + menu, picker/preview per service, PR via /issues/ link, card-face key, From buttons, agent read and unread, compact layout, no tokens in logs). Case 9 FAIL: removing a connection left its summaries in `cache.json` → fixed (persist on remove, drop entries of missing connections on load, regression test; live cache cleaned after reload). Jira `ticket` compatibility field: UNRUN there (no real tickets on test cards), PASS here on this card after the reload. [Evidence](verification/connectors.md).
- [x] PASS: Luna re-check on the reloaded plugin (A cache cleanup on remove and restore, B same key across GitHub/GitLab not shown as linked, C changed address without a token refused and no request to the new port, D non-loopback http refused, E PR via /issues/ link). Cleanup verified: only the original Jira connection, 0 loopback cache entries, Tinylink back to its 6 cards, test sessions archived.
- [x] User request (2026-10-21): each connector shows its own brand logo (`client/brand-icons.tsx`, Simple Icons CC0 paths prerendered as 48px PNG data URIs for RN `Image`; Confluence #1868DB, GitHub light variant on dark themes) in Settings → Connections, the Artifacts + menu and rows, the card face key, New task From buttons, picker and preview titles. PASS: typecheck, `npm test`, headless screenshots in light and dark; onboarding unchanged (visual only).

## Next moves in the delivery call — 2026-10-20

- [x] Card request: let the calls an agent already makes at the end of a turn carry the next moves, so suggesting them is part of delivering and not a second call that gets dropped. [Spec](NEXT-MOVES-SPEC.md) §8 (reconciled with the concurrent delivery-reminders design §9, which lands on its own card).
- [x] Implemented: `flowly_update_status` and `flowly_report_progress` (all kinds) take an optional `nextMoves` with the `flowly_suggest_next_moves` items; absent records nothing, `[]` records an explicit none (`next_moves_suggested`, `moves: []`, note "No next steps needed"), 1–3 record the suggestion. One transaction writes the status/report event, then the suggestion; one receipt; a refused call (WORKPAD_OPEN, REVISION_CONFLICT, guard) writes nothing; replay does not add a second suggestion. The standalone tool now accepts `[]` too. A `moveTo:"done"` move is only accepted on a call that leaves the card in In review (INVALID_INPUT otherwise; the standalone tool is unchanged). CLI `status` / `note` take `--moves '<JSON>'` or `--no-moves`. Activity shows only the explicit none, as "<agent> suggested no next moves". Tool descriptions and both skill copies say to pass `nextMoves` when delivering, asking or reporting, and keep `flowly_suggest_next_moves` for mid-turn updates. README (both), 1 string in all 9 catalogs. No tour entry or tip: the only visible change is one Activity line.
- [x] PASS: `npm run typecheck`; full `npm test` 93 files / 705 passed, 65 skipped, three runs in a row. New tests: agent-service (delivery with moves in order, every report kind, `[]` replaces and absent keeps, invalid moves write nothing, Done guard incl. finished cards, replay/reuse, WORKPAD_OPEN refusal then resend), next-moves (`isNoMoves`, empty after non-empty), progress-rules (a report with its suggestion still counts as work), tool-server (schemas allow `[]`, descriptions and skill text, CLI `--moves`/`--no-moves` and bad flag combinations, MCP calls). The CLI flow test got a 30 s timeout: it runs a long sequence of real CLI processes and passed 3.2 s alone but timed out at 5 s in one parallel full run after this card added calls to it.
- [x] Checked: Agent habits (`shared/agent-habits.ts`, `shared/insights.ts`) already reads `moves: []` as an explicit none, so the new events count there without a change.
- [x] PASS (live, desktop): after `paseo plugin reload flowly`, two `codex/gpt-6-luna` full-access sessions on a temporary card in the Tinylink fixture (one with the MCP server, one CLI only). `update_status in_review` with `nextMoves` wrote the status change and the suggestion in the same millisecond and showed the chips (3 over MCP, 2 over the CLI); `report_progress` with `[]` and `note --no-moves` wrote `moves: []`, removed the chips and added the "suggested no next moves" Activity row (2 rows); the Done guard refused `moveTo: done` on a non-delivery call with `INVALID_INPUT` and wrote nothing. The card, its 2 sessions and its workspace were deleted and archived afterwards; Tinylink's own cards, workspaces and sessions are unchanged. Evidence: [verification/next-moves-delivery.md](verification/next-moves-delivery.md).
- [ ] UNRUN: the chip row and the Activity row on a phone / compact layout; the standalone `flowly_suggest_next_moves` with `[]` live (unit tests only); coverage recompute after rollout (baseline 56 of 101 delivery, question and result turns, about 55%; target 90% or more).

## Card sidebar tweaks (card "UI/UX 调整") — 2026-10-19

- [x] Request: History alignment, Artifacts paging (+5 per press, no collapse, reset on reopen), Artifacts collapsible as a whole, user-ordered sidebar sections. [Spec](DRAWER-SPEC.md#section-order-and-artifacts-paging); CARD-ARTIFACTS-SPEC §5.2 and CARD-DISPLAY-SPEC §3 updated. No inputs or tickets on the card.
- [x] `client/disclosure.tsx`: shared `Collapse` (measured height, stays in layout until measured when mounted open) and `Chevron`; `Disclosure` gains `flush`. Progress → History uses it; an opened version's fields line up with its title.
- [x] `client/task-artifacts.tsx`: per-group limit (5, +5 per *Show N more*, aligned with rows), whole-section collapse through `SectionHeader` `open`/`onToggle`; both reset when the sidebar opens.
- [x] `shared/drawer-sections.ts` (+ test), `board-view.drawerOrder`, drawer renders the six movable sections in that order; Settings → Cards → Card sidebar (drag / arrows, reset).
- [x] Onboarding: tip `sidebar-order` (after `card-display`), ONBOARDING-SPEC table; tour unchanged (view preference, not a new concept). 8 strings in all 9 catalogs.
- [x] PASS on `7a4562d` + dirty: `npm run typecheck`; `npm test` 583 passed / 63 skipped; `paseo plugin reload flowly` running.
- [x] PASS (headless web, real card with 37 artifacts): paging, whole-section collapse, reset on reopen, History alignment, drag reorder + drawer order + reset. [Verification](verification/sidebar-tweaks.md).
- [x] Follow-up: Workpad collapses as a whole like Artifacts (title + chevron, resets on reopen); collapsed header shows `Acceptance n/m · Checks n/m` (existing strings, no new catalog entries).
- [x] Follow-up "整体调整 UI": every sidebar section is a shared `Section` (title + trailing chevron, actions, collapsed summary, empty sections without chevron); Details/Usage/Activity converted from `Disclosure`. Settings → Cards → Card sidebar: order plus a *Starts open* switch per section (`drawerOpen`), pinned bottom three, *Reset sidebar layout*. Workpad lists page by 5, checks sorted by what needs a look, commands one line. Phones: title/properties/tags scroll with the content. 7 strings added and 4 removed in all 9 catalogs; tip text updated.
- [x] PASS on `7a4562d` + dirty: typecheck; `npm test` 587 passed / 63 skipped; plugin reload. Headless web (desktop 1700×1100 and phone 430×900): before/after screenshots, defaults round trip (Workpad off/Activity on → drawer opens that way → toggle → Reset), paging/collapse regression. [Verification](verification/sidebar-tweaks.md).
- [x] Follow-up: default layout set to the user's current one: order Progress, Sessions, Workpad, Artifacts, Ideas, Links; Links (and the bottom three) start closed, Artifacts open.
- [x] Follow-up: Progress → History times are compact (today `21:57`, this year `Oct 19, 21:57`, older `Dec 31, 2025`) via `shared/compact-time.ts` (+ test).
- [x] Follow-up: main and sub sessions (user chose option 1, automatic): Paseo child agents nest under their main session behind a folded `↳ 2 working` row (open when one needs you); `sessionTree` in `shared/subagents.ts` (+ tests). No new strings, tip or tour change (reuses the Subagents chip text; the existing `subagents` tip already introduces child agents).
- [x] Follow-up: session rows keep the last-activity time ("just now") on one line at full width; long titles and model names truncate instead (`client/session-card.tsx`). PASS: typecheck, `npm test` 615 / 63 skipped, reload; headless web at 360 px phone and 1400 px desktop: every time label one line, not clipped.
- [x] Follow-up: subagent rows open and close with the shared `Collapse` (height + fade) and a rotating chevron. PASS: typecheck, `npm test` 615 / 63 skipped, reload; headless web on Tinylink with 2 temporary child agents: group height eases 93→193 px on open and 197→93 px on close; fixtures `c0749534`, `44013a5b` deleted.
- [x] Follow-up: one type scale across the sidebar (DRAWER-SPEC, Type scale): list body text 13 (was 12 in Workpad, Artifacts, Links, History), secondary lines 12 (was 11), group labels stay 11.
- [x] Follow-up: the session view's Subagents chip opens a subagent in the side bar when it is one of the card's sessions (drawer `onOpenSession`), else in a Paseo agent pane; row label `Open {title}` (stale `Open {title} in Paseo` removed from 9 catalogs).
- [x] Follow-up: list rows (`Row` in `client/ui.tsx`, e.g. the Needs attention list) keep their trailing value ("just now", counts) at full width; titles and details truncate instead. PASS: typecheck, `npm test` 615 / 63 skipped, reload; headless web Needs attention at 1400 px and 360 px: times one line, not clipped.
- [x] Follow-up: on phones the trailing "just now" still lost its last word (native Android measures a line narrower than it draws). `Label` single-line text uses `textBreakStrategy="simple"`, `relativeTime` joins its words with non-breaking spaces, and the Needs attention time is single-line. PASS: typecheck, `npm test`, reload, web check. UNRUN: native phone (AndroMeld not running).
- [x] Follow-up: Back from a session could leave the card details shifted ~18 pt on Android (native-driven transform outliving the animation, invisible to React). `MotionReveal`, `Enter` and the drawer container now carry animated opacity/transform only while moving (MOTION-SPEC, Rest state). PASS: typecheck, `npm test`, motion renderer test (new case), reload; headless web Back at 0–400 ms and rapid open/back: title at its rest x, no transform. UNRUN: Android device (AndroMeld not running).
- [x] Follow-up: Show more in Artifacts and Workpad opens the added rows with a height/fade reveal (`PagedRows`); the session view re-checks the tail at drag end and momentum end, so "Jump to latest" hides after a fling to the bottom on phones (the throttled last onScroll could stop short). PASS: typecheck, `npm test` (one flaky `tool-server` timing test passed on rerun), reload; headless web: Outputs 238→428 px and Acceptance 354→498 px animate over ~200 ms. UNRUN: phone check of the latest button (AndroMeld not running).
- [x] Follow-up: a stray coloured line under a session row while scrolling the board was a browser focus outline clipped by the rounded list. 23 `Pressable`s without `noFocusRing` fixed (the new subagent row also shows focus as its background); `client/focus-ring.test.ts` fails on any `Pressable` without it (probe-checked). Subagent chip and row always lead with the total (`2 subagents · 1 working`). PASS: typecheck, `npm test` 623 / 64 skipped, reload; headless web: focused rows after a sideways board scroll have `outline: none`.
- [x] Follow-up: a subagent's unread turn no longer counts toward attention (user decision; approvals, errors and manual unread still do). PASS: typecheck, `npm test` 624 / 64 skipped (new case), reload; live on Tinylink with a temporary finished child: card 0 unread / 0 need attention, not in Needs attention; fixture deleted.
- [ ] UNRUN: native apps, compact web, Luna 6 test session.


## Attention dismiss — 2026-10-19

- [x] Card request "attention dismiss": Attention counts kept showing items the user could not or did not want to decide yet. [Spec](ATTENTION-DISMISS-SPEC.md) approved by the user as written (per card, back on any new signal, no timed snooze).
- [x] `shared/attention-dismiss.ts`: schema, signal keys (`q:` question event, `p:` request, `e:` error, `u:` unread generation), `isDismissed`. `board.json` gains `attentionDismissals` (default `[]`, no migration); card delete and project remove drop it.
- [x] RPC `attention.dismiss` / `attention.restore` (`BoardStore.dismissAttention` / `restoreAttention`): serialized, idempotent, no task/project revision or Activity.
- [x] `client/attention.ts`: items carry `signals` and `dismissed`; `attentionFromSources` (bell, sidebar badge, overview chips, tabs, tips) excludes dismissed; `allAttentionFromSources` for the list.
- [x] UI: Dismiss button per Attention row, collapsed *Dismissed · N* section with Restore, card `Dismissed` signal, drawer notice + Restore and menu entry, board context menu and phone Actions sheet entries, toasts.
- [x] Onboarding: tip `attention-dismiss` (after `needs-you`), ONBOARDING-SPEC table, README (both). Tour unchanged: not a new concept. 14 strings in all 9 catalogs.
- [x] PASS: `npm run typecheck`; `npm test` 577 passed / 63 skipped (new `client/attention-dismiss.test.ts`, `server/attention-dismiss.test.ts`, tip order).
- [x] PASS (headless web, Tinylink): Restore → Dismiss round trip, counts/chip/badge, Dismissed section, card marker, drawer notice, compact sheet. [Verification](verification/attention-dismiss.md).
- [ ] UNRUN: live re-surface on a real new agent turn (unit tests only), native apps, Luna 6 test session.

## Flowly tool and skill naming — 2026-10-19

- [x] User request and [complete incremental spec](FLOWLY-NAMING-SPEC.md) before implementation. Input: this card and the user's rename instruction; no ticket inputs.
- [x] MCP server/config key `flowly`, all 11 `flowly_*` tools; bundled skill moved to `skills/flowly`, runtime skill matches, generated instructions and ticket-read hints updated.
- [x] CLI `flowly.mjs`, new `FLOWLY_*` session/config environment, helper labels and query prefixes. Preserve private legacy environment/CLI reads, helper recognition, non-destructive data/settings migration and existing provisioning idempotency keys.
- [x] README/overview and current tool references synchronized. No new tour row/tip: naming changes no concept, capability or user interaction.
- [x] PASS on `50965f996861` + dirty changes: focused 75/75 (8 files), `npm run typecheck`, full `npm test` 579 passed / 63 skipped (84 passed / 12 skipped files). Only `flowly` reloaded, no daemon restart.
- [x] PASS: independent `codex/gpt-6-luna` `bc10675f-1b10-49dd-8cba-6ebbf2f18fd0`, explicitly full-access at creation; real installed MCP read/progress write, environment/skill checks, 22/22 focused tests. Test session archived then deleted; native missing and fresh card session list confirmed. [Evidence](verification/flowly-naming.md).
- [x] Review/publish validation: constructed a rename-only index from HEAD, excluding unrelated Workflow insights/Attention dismiss code. Isolated typecheck PASS; full tests with `--maxWorkers=2`: 534 passed / 63 skipped; candidate diff check PASS. Working-tree byte hashes preserved. [Review evidence](verification/flowly-naming-review.md).
- UNRUN: desktop/compact visual checks, not required for this naming-only change; no UI actions taken. Existing unrelated work preserved; commit/push completion is recorded on the card.

## Card display: calmer layout and user-chosen fields — 2026-10-19

- [x] Card request "任务卡片布局调整": cards had too many kinds of information. [Spec](CARD-DISPLAY-SPEC.md).
- [x] Layout (`client/card.tsx`): meta row above the title (priority Urgent/High/Low, type, ticket key, first two tags as plain `#tag`), no pills or chips; one activity line by default (progress summary, else latest output, now with its time); status row ordered asks-first (Needs you, waiting, approvals, errors, workspace, sessions, workpad, ideas, Archived, Legacy). The output tail is not fetched when the activity line cannot show it.
- [x] Options: host-scoped `cardActivity` (auto/progress/output/both/none) and `cardHidden` (priority, type, ticket, tags, sessions, workpad, ideas) in `board-view`; each falls back on its own (`.catch`) so a bad value never resets other board preferences, unknown hidden ids are kept. Pure helpers `shared/card-display.ts`. Settings → Cards (`client/card-settings.tsx`) with a live preview drawn by the real `TaskCard` and Reset to defaults; Sort menu → *Card display…* opens it.
- [x] Onboarding: tip `card-display` (≥6 active cards, after `first-card`, before `project-menu`), ONBOARDING-SPEC table, README (both) "Also included". Tour unchanged: a view preference, not a new concept. 33 strings in all 9 catalogs.
- [x] PASS: `npm run typecheck`; `npm test` 526 passed / 63 skipped (new `shared/card-display.test.ts`, settings and tip-order tests). One run hit a 5 s timeout in `server/tool-server.test.ts` (CLI flow, unrelated); it passes alone and on the next full run.
- [x] PASS (headless web, Tinylink, user setting restored): layout, Sort menu → Card display…, live toggles on preview and board, Reset. [Verification](verification/card-display.md).
- [ ] UNRUN: compact phone/native rendering; Luna 6 test session.


## Card workpad and soft delivery gate — 2026-10-19

- [x] Card request "卡片 Workpad：结构化计划/验收/验证清单 + 交付门槛" (from the Symphony research). Evaluated first; the user chose the slim version and settled the three open points (no gate without a workpad, hide summary Target when acceptance exists, people may mark a check pass). [Spec](WORKPAD-SPEC.md).
- [x] Implemented: `workpads`/`plans` on the board (`shared/model.ts`), pure logic `shared/workpad.ts` (merge with ids, by/at and sha rules, freshness, open items, card signal, plan from timeline), `server/workpad.ts` (git HEAD/commit reads, human check/resolve/refresh, plan + HEAD at turn end), `flowly_update_workpad` + `acknowledgeOpen`/`WORKPAD_OPEN` gate in `server/agent-service.ts`, CLI `workpad` and `--acknowledge-open`, tool body limit 256 KiB, skill (both copies); card signal, drawer Workpad section (`client/task-workpad.tsx`), Activity hides workpad events, Progress hides Target; workpads/plans follow card delete, project remove/restore and project-folder snapshots.
- [x] Onboarding: tour feature row *Workpad*, tip `first-workpad` (after `next-move`, before `first-idea`), ONBOARDING-SPEC tip table, README (both) highlight + tool list; 26 strings in all 9 catalogs.
- [x] PASS: typecheck; full `npm test` 519 passed / 63 skipped; live MCP/CLI and headless desktop/compact UI checks — details in [verification/workpad.md](verification/workpad.md).
- [ ] UNRUN: Plan from a real session's todo list; cycling check state / resolving confusions / out-of-date display in the real UI; Luna 6 test session.
- [x] User follow-up "workpad作为一个可选功能，允许在project设置中开关": `Project.workpad` (absent = on), *Card workpad* switch in project settings. Off: `WORKPAD_DISABLED`, no delivery gate, `get_task` `workpadEnabled:false` with no workpad/plan, no Plan or HEAD recording, people's edits refused, card signal / drawer section / tip hidden, summary Target shown again; stored data kept. Skill (both copies), spec §9, ONBOARDING tip row, README; 2 strings × 9 catalogs; tests in `server/agent-service.test.ts` and `server/workpad.test.ts`.

## Project tab context menu — 2026-10-19

- [x] Card request "project tab增加contextual menu、进行编辑、设置等": right-click (long-press on touch) a desktop project tab for Project settings, New task, Insights, Ideas, Move left/right, Restore (archived) and Remove…. Reuses the board's `ContextMenuProvider`; `ProjectTabs` takes `menuFor`, entries built in `client/board.tsx` (`projectTabMenu`). [Spec](PROJECT-TABS-SPEC.md) updated.
- [x] Onboarding: tip `project-menu` (desktop tabs with ≥2 projects, after `first-card`), ONBOARDING-SPEC tip table; no tour change (project/card/session mapping unchanged). 3 strings in all 9 catalogs.
- [x] PASS: typecheck; full `npm test` (new tip-order test in `client/onboarding-logic.test.ts`).
- [x] User follow-up "增加project tab drag n drop调整顺序": tabs reorder by mouse drag. `SortableList` gains `horizontal` (row layout, x axis, `translateX`) and `onItemLayout` (tabs keep auto-reveal offsets); chooser and tabs share `dropProject` in `client/board.tsx`. Tip text now mentions dragging (all 9 catalogs).
- [x] PASS: typecheck; `npm test` 495 passed / 63 skipped; plugin reloaded.
- [x] PASS (headless app.paseo.sh web client on the local daemon, own profile, 1440×900; the user's windows untouched): right-click on the 2nd tab lists Project settings, New task, Insights, Ideas, Move left, Move right, Remove… without switching project; outside click closes it. Dragging `Flowly` past `Search System` → order `Search System, Flowly, Tinylink`, Flowly still active; dragged back → original order restored (user's real project order, verified restored). No page errors.
- [ ] UNRUN: picking each menu item in the UI; Electron desktop app; touch long-press; Luna 6 test session.


## Recent activity sorts by turn ends — 2026-10-19

- [x] Card request "recent activity排序优化": the Recent activity sort used every session update (each streamed message) and the card's own `updatedAt`, so cards jumped while sessions ran. It now uses only finished turns: `latestTurnEnds`/`turnEndActivity` in `shared/sort.ts` (recorded `agent.turn_ended` events; for sessions that record none, the time they last went idle, remembered client-side while they run); a card without a turn end counts from its creation. Menu detail now "Latest finished session turn first" (all catalogs). [Spec](UI-REFRESH-SPEC.md) Sort bullet updated.
- [x] PASS: typecheck; full `npm test` 494 passed / 63 skipped (`shared/sort.test.ts`: turn-start and task edits do not move a card, settled non-Kanban sessions count).
- [ ] UNRUN: watching the live board reorder during a running turn; Luna 6 test session.
- Onboarding: no tour or tip change, the sort option and its place are unchanged; only its ordering rule.

## Jira tickets as card inputs — 2026-10-19

- [x] Card request "jira工单接入": research and design how to bring Jira/Linear tickets into Flowly, and whether to isolate or merge statuses. First draft (milestone push to Jira) replaced by the user's decision: tickets are **read-only inputs and references**; Flowly status never affects the tracker. User's flow: New task → From Jira (my recent tickets, search by name or number, title prefilled only when empty), link on existing cards, agents perceive the ticket every turn like artifacts. Decisions: self-hosted and Cloud Jira both in P1; recent list = 10 unresolved; card face shows the key only. [Spec](EXTERNAL-TRACKER-SPEC.md).
- [x] Implemented P1 (spec §8.1): `shared/tickets.ts`, `server/tickets.ts` (0600 connections, GET-only allowlisted client, cache, backoff, fingerprints), ticket artifacts and `tasks.create` `tickets` in one commit, `get_task.artifacts[].ticket` + unread on content change, `flowly_read_ticket` / CLI `ticket --id`, skill (both copies); Settings → Connections, From Jira picker with title prefill, Link Jira ticket + ticket preview in the drawer, key line on cards; tips `first-ticket` / `jira-connect`, tour line, README, ONBOARDING-SPEC tip table, 49 strings in all 9 catalogs.
- [x] PASS: typecheck; full `npm test` 490 passed / 63 skipped (new `shared/tickets.test.ts` 10, `server/tickets.test.ts` 18: private credentials, GET-only allowlist, Cloud/DC auth and search endpoints, 401/429/login page/offline cache, fingerprint ignores status, Markdown + truncation, card + tickets in one write, link by URL/key, agent unread and read scope).
- [x] PASS (live, installed plugin reloaded): this card's session saw `flowly_read_ticket` over MCP; reading a non-ticket artifact returns `TICKET_NOT_FOUND`.
- [x] Fixed (user report): "Add a Jira connection" froze all of Paseo. The connection form was a host Modal opened on top of the settings window (itself an RN Modal); the editor now replaces the list inside the Connections page. Typecheck + `npm test` 490 passed; plugin reloaded. UI re-check UNRUN.
- [x] User request: Test connection in the connection editor (`tickets.connection-test`, checks `/myself`, saves nothing; editing tests with the stored token; result hidden once address/type/email/token change). 3 strings × 9 catalogs. Test added; `npm test` 491 passed on 8 runs (one earlier run had 1 failure that did not reproduce and was not captured). Plugin reloaded. UI UNRUN.
- [x] User question: deleting a connection that cards still use. Ticket inputs stay as links (data untouched); drawer shows "Connection removed", preview explains, agent gets `ticket.connection: "removed"` + `TICKET_UNAVAILABLE` (ask the user), new-session context drops the tool hint; removal confirmation counts the affected cards; adding the same Jira again restores them (lookup by own connection, else by link host/path). 4 strings × 9 catalogs; lifecycle test added; `npm test` 492 passed ×3; plugin reloaded. UI UNRUN.
- [x] User report: closing Flowly settings animated twice. Cause outside Flowly: paseo-native-polish ghosts every removed `role="dialog"` unless the host exit is a CSS transition; RN Modal (web) fades out with a keyframe animation, so the window faded a second time. Fixed there per the user: released 0.4.14 (commit 31fa09a on `main`, tag `v0.4.14`, pushed to JasprW/paseo-native-polish; installed plugin updated to it): an `animationstart` on a tracked overlay or its wrapper whose last keyframe is transparent marks the exit host-owned. Typecheck PASS. Flowly code unchanged. UI UNRUN.
- [ ] UNRUN: against a real Jira (jira.shopee.io needs the user's token entered in Settings → Connections; Jira Cloud); desktop/phone UI of the picker, settings page and drawer; Luna 6 test session.

## AI mark — 2026-10-19

- [x] Card request "所有AI feature增加星星标记": mark existing AI features with the star like next moves. [Spec](AI-MARK-SPEC.md).
- [x] Implemented: `AiMark` + `SectionHeader ai` in `client/ui.tsx`; card progress line (Flag → mark), drawer Progress and Ideas headers, Ideas page title, Insights daily Summary, agent-added artifacts and tags (Bot → mark). Card type `feature` icon Sparkles → Puzzle so Sparkles only means AI. Tour page 3 line; 2 strings in all 9 catalogs. No tip (nothing to do).
- [ ] UNRUN: desktop/phone UI check in the installed plugin, Luna 6 test session.

## Suggested next moves — 2026-10-19

- [x] Card request "建议next move": agents end turns with "要不要……或者……"; give them a tool to suggest the next move, show this turn's hints above the composer, tap pre-fills (never sends). [Spec](NEXT-MOVES-SPEC.md).
- [x] Implemented: `flowly_suggest_next_moves` (+ CLI `next-moves --moves <JSON>`, HTTP action `next_moves`, receipts/replay, `TASK_FINISHED` on Done/Cancelled) records `next_moves_suggested` with `moves` on the event, no task revision change. `shared/next-moves.ts` (`openNextMoves`: latest set until the session's next turn starts; `nextMoveDraft`: fill or append). Session view `client/next-moves.tsx` chips above the composer, hidden while running, while a question/approval is pending, after a newer user message, or after ×; native input remounts with the text and focus (no IME breakage), web focuses the controlled input. Hidden from the activity timeline; A1r ignores it. Skill text (both copies), tool description, tip `next-move`, tour feature line, README, 6 strings in all 9 catalogs.
- [x] PASS: typecheck; full `npm test` 73 files / 461 tests (new `shared/next-moves.test.ts`; agent-service write/replay/limits/finished; CLI flow + bad `--moves`; A1r with only next moves; tool list; tip order).
- [ ] UNRUN: desktop/phone UI check of the chips in the installed plugin, Luna 6 test session.

## Answer agent questions in the session — 2026-10-18

- [x] Card request "提问能力接入": an agent's ask-user-question lit up the card but the question was only visible in the native Paseo session. [Spec](SESSION-QUESTION-SPEC.md).
- [x] Card request "提问方式优化" (2026-10-20): the skill and `flowly_report_progress` description now tell agents to ask through their own question tool (AskUserQuestion etc.) and use `kind=question` only as the fallback, never both for one question. Text-only change. [Spec](SESSION-QUESTION-SPEC.md) §2.2.
- [x] Capability check: the public SDK already carries `pendingPermissions` on agent snapshots and `agent.respondToPermission`; the answer encoding was read from the installed Paseo 0.11.2 app (answers keyed by header, `", "` joins, dismiss = deny "Dismissed by user") and the Claude provider (maps headers back to question text).
- [x] Implemented: `shared/permission-question.ts` (pure form logic), `client/session-question.tsx` (question form; Allow/Deny or provider actions for other requests) above the session composer; respond re-checks membership and that the request is still pending. "Waiting for your answer" session label; agent questions count as Needs you / questions, not approvals. Tip `agent-question`, tour feature line, 19 strings in all 9 catalogs.
- [x] PASS: typecheck; full `npm test` (a `server/tool-server.test.ts` failure seen mid-way came from a parallel session's in-progress edit and passed once it settled). The session-attention verification fixture now expects the new `questions` count.
- [x] PASS (live, user, desktop): single select, multi select + Other, Other-only text, Dismiss, tool approval (always-ask mode, file create/delete). User feedback "输入框回车不能直接提交" fixed: web Enter submits the form, Shift+Enter new line.
- [ ] UNRUN: phone layout, plan approval, Luna 6 test session.

## Project folder copy — 2026-10-17

- [x] Card request "Flowly project保存在原始project目录". User chose A: each project's board is also saved in `<root>/.flowly/project.json`, restorable after the project is removed from Flowly, git-ignored by default. [Spec](PROJECT-FOLDER-SPEC.md).
- [x] Daemon: `server/project-folder.ts` (snapshot writer debounced after each board commit, only changed projects; `.flowly/.gitignore` = `*` created with the folder only; foreign/invalid file kept as a dated copy; failures logged and never fail the board). `projects.restore-check`, `projects.restore` (native project found/created, same IDs, revisions + 1, `restored` event, bound workspaces cleared, summaries merged, flow log re-enabled), `projects.folder-state`. Snapshot includes card artifacts.
- [x] Client: restore notice with Restore it / Start empty in Create project; *Saved in project folder* row in project settings; line in the Remove dialog; restore toast; tour feature line. Strings in all 9 catalogs.
- [x] PASS: typecheck; `server/project-folder.test.ts` 7 tests (scope of records, gitignore, change detection, write failure isolation, remove → restore round trip, conflicts write nothing, unbound workspace, invalid/foreign file kept).
- [x] User follow-up "老项目升级插件后自动迁移": explicit upgrade migration on each start (spec §1.1): every project (archived included) gets its folder copy, already-current copies untouched, failures retried; result in `folder-migration.json`. PASS: 2 more tests (9 total): pre-version board → all written, second start all current with no rewrite, board unchanged; unwritable folder failed then written on the next start.
- [x] PASS: full `npm test` 417 passed / 63 skipped (after the parallel card-artifacts work settled).
- [x] Installed the local checkout as `flowly` (user request "安装 我来测试"): the published plugins.paseo.sh install had to be removed first (`plugin install` refuses a configured ID); plugin data and settings were backed up to `~/.paseo/flowly-backup-20261018-001006/` beforehand. On start the migration logged `1 written, 0 current, 0 failed`; `/Users/claw/Dev/flowly/.flowly/project.json` holds the Flowly project (4 cards, 39 events); `git check-ignore` confirms `.flowly/.gitignore` ignores it. User checked the installed plugin: the project works normally.
- [ ] UNRUN: Luna UI acceptance and the remove → restore flow on a fixture project through the UI. Luna session `1c921648-071b-4634-9efc-7f3d52ad3c31` (codex/gpt-6-luna, full-access) could not run commands: its shell tool failed twice, even on `pwd` ("timed out negotiating with the code-mode host"); no fixtures created, nothing changed.

## Card artifacts — 2026-10-17

- [x] Card request "设计一下任务卡片增加assets或者artifacts，用于记录和收集这个任务输入输出的文档、交付物等。由agent根据理解自行添加也可以由人手工添加". Drafted the [card artifacts spec](CARD-ARTIFACTS-SPEC.md): references (file in card scope / http(s) link) with role input/output/reference in `board.artifacts`; human RPCs; `flowly_add_artifact` / `flowly_remove_artifact` tools; drawer section, preview, cascade on delete.
- [x] User decisions: references only; agents cannot remove human-added artifacts; nothing on the card face; each row shows input/output and human/agent; follow-up inheritance deferred. Roles reduced to input/output.
- [x] Implemented (user: "开始"): `board.artifacts` + `shared/artifacts.ts`; `server/artifacts.ts` (scope check with realpath so symlinks can't escape, `./` workspace-relative storage, dedupe by target, `updatedAt` edit conflict, board revision only, `artifact_added`/`artifact_removed` events, batched missing check, preview re-checked on read: image ≤8 MB, text ≤256 KB, folder ≤200 entries). RPCs `artifacts.create/update/delete/status/preview`. Tools `flowly_add_artifact` / `flowly_remove_artifact` (+ CLI `artifact` / `artifact-remove`, receipts, `ARTIFACT_INVALID` / `ARTIFACT_FORBIDDEN` / `ARTIFACTS_DISABLED`), `get_task.artifacts`, inputs/outputs in session context, skill text. Drawer section with add/edit form and preview; setting Agent artifacts; tip `first-artifact`, tour feature, README; 9 catalogs. Card delete / project remove back up and drop artifacts. Dropped from v1 (spec §10): collect from session, file browse, Copy path, Undo.
- [x] PASS: typecheck; `npm test` 66 files / 415 tests (new `server/artifacts.test.ts`, tip order, tool list, i18n).
- [x] PASS (installed local build, this card's own session over MCP): `flowly_add_artifact` registered `docs/CARD-ARTIFACTS-SPEC.md` as output → stored `./docs/CARD-ARTIFACTS-SPEC.md`, `createdBy: agent`, `missing: false`, `artifact_added` event, task revision unchanged; `/etc/hosts` refused with `ARTIFACT_INVALID`.
- [x] User report: the artifact preview did not scroll on phones. Cause: a nested ScrollView (maxHeight 520) inside the host modal's scrollable body took the pan. Fix: the text/markdown preview renders directly in the modal body, which scrolls. Typecheck and tests pass; plugin reloaded.
- [ ] UNRUN: phone re-check of the fix; drawer UI (desktop/compact), human edit/remove, and the Luna 6 test session.
- [x] User question "用户自己添加的 artifacts，Agent 如何有效使用"; chose A+B. A: session context lists the user's inputs first with `[user]/[agent]` and the note; skill makes user inputs required reading (notes are instructions, say so when one can't be read, name the inputs used), `flowly_get_task` description asks for a read each turn. B: `get_task.artifacts[].unread` (added/edited since this session's last explicit get_task, never its own), per-session read times in `artifact-reads.json`, not the board.
- [x] PASS: typecheck; `server/artifacts.test.ts` 6 tests (unread first read / own additions / write context does not mark / other session / edit re-flags / survives a new service). Full `npm test`: 445 passed; 2 failed outside this change (`tool-server` CLI flow timed out at 5 s under load, passes alone in ~4 s, same as HEAD; `session-attention` fixture fails on another session's uncommitted `shared/session-attention.ts`).
- [x] PASS (reloaded local plugin, this session over MCP): `get_task` returns `unread: false` on this session's own artifact; `artifact-reads.json` written with this session's read time (mode 600).
- [x] PASS (live): the user added an input link in the drawer; this session's next `get_task` showed it `createdBy: human, unread: true`, the following read `unread: false`; the agent opened the link as the skill asks. The context lines built from the live board put it first as `- [user] 我的个人博客: https://bofan.wang — <note>`.
- [ ] UNRUN: a newly created session actually receiving those context lines.

## Composer focus during a running session — 2026-10-16

- [x] Card report "PC 上 session 运行中打字会被打断，内容更新时出现，打断后完全无法输入". Cause: the transcript ScrollView had `keyboardDismissMode="on-drag"` on web; RN Web's `_handleScroll` then blurs the focused input on every scroll event, and follow-tail scrolls on each output update. Web now uses `none` ([spec](SESSION-INPUT-SPEC.md)).
- [x] PASS: typecheck; headless app.paseo.sh against the local daemon, typing into this card's running session with forced transcript scrolls: with the fix the textarea kept focus (0 blurs); control run with the old value lost focus to `<body>`, blur stack `_handleScroll → blurTextInput`.
- [ ] UNRUN: the Electron desktop window.

## Card links — 2026-10-16

- [x] Card request "设计任务卡片关联关系…父子任务可能有点麻烦，在其他agent kanban项目里怎么设计的". Researched Vibe Kanban (attempt-scoped subtasks, independent status), Multica, Linear/Jira/Plane, agent-tasks MCP. User chose option A: Follow-up of (derived) + Related + Blocks (hint only), no parent/child; approved the [card links spec](CARD-LINKS-SPEC.md), then "OK 做吧".
- [x] Data: `board.links` (`derived`/`related`/`blocks`, same project, board stays v4); files without `links` derive them once from `Task.origin`. `shared/links.ts` (relations, resolution, cycle detection, context lines). `links.create` / `links.delete` (CAS-free, board revision only; events on both cards; Related replaced by a more specific link; cycle, duplicate, cross-project, archived and 50-per-card checks). `tasks.create` with `followUpOf` (checked before the workspace and in the write) and with `ideaId` writes a derived link. Card delete / project remove back up and drop links; the other card records `unlinked`.
- [x] Agents: `flowly_get_task.links` (relation, title, lane, archived, resolved), session context lists links instead of `Derived from card`, skill rule (read-only; unresolved blocked_by is a hint).
- [x] Client: "Waiting on N" card signal; drawer Links section below Ideas (groups, open, optimistic remove, `+` menu); "From idea on / Follow-up of" line; Link to a card… picker; New follow-up task form; card menu and phone action sheet entries.
- [x] PASS: typecheck; `npm test` 331 passed / 63 skipped (new `shared/links.test.ts`, `server/links.test.ts`, `client/link-rows.test.ts`; idea tests updated).
- [x] Luna (`codex/gpt-6-luna`, full access) acceptance, session `a2d45f82`, headless app.paseo.sh, two runs with fresh fixtures (cleaned): PASS link modal/search/toast, both-side groups, Waiting on → Was waiting on after Done, cycle and already-linked errors in the modal, remove + Activity, New follow-up task, linked-card delete backup (RPC), agent `flowly_get_task.links` and context lines, dark desktop, no console errors. FAIL fixed afterwards: the picker offered a card already linked by Blocks as a Related candidate. [Verification](verification/card-links.md).
- [ ] UNRUN: compact 390×844 UI (automation could not reach the board in the mobile context); Delete permanently from the UI (checked via RPC); browser re-check of the picker fix; Electron window and a physical phone.

## Project insights — 2026-10-16

- [x] Card request "项目整体天级统计、变更总结" / "为项目增加一个project级别的统计、总结、insight的功能". User chose purpose A (daily review and planning the day) and approved an untrimmed flow log; then "先这么实现看看". Wrote [insights spec](PROJECT-INSIGHTS-SPEC.md).
- [x] Daemon: `flow/<projectId>.jsonl` appended after each board commit (notes not stored), reconciled from the board at startup and before each read (first run backfilled 533 events); card delete rewrites it with a `removed/` backup, project remove moves it to `removed/`. Rule A1 resumes undone by A1r are ignored (not rework, no new review wait).
- [x] `insights.project` (etag): day stats in the client's time zone, 7-day averages and trend, lane dwell medians, In review / Blocked waits, rules R1–R7, git commits (root + first-level child repos, `git log --all --numstat`). `insights.digest` / `insights.digest-refresh`: LLM daily digest in `digests.json` (60 days per project), auto for past days when *Daily digest* is on, run in the project root's workspace (else the latest card workspace) and archived in `finally`.
- [x] Client: *Insights* chip in the overview bar and shortcut I; page with day navigation, number tiles, Waiting on you, Suggestions, Summary, Last 7 days; Esc / ‹ Board returns. *Daily digest* toggle in settings.
- [x] PASS: typecheck; `npm test` 308 passed / 63 skipped (new insights, flow-log, git-stats, digest and service tests); plugin reloaded; analysis checked against this board's real data.
- [x] Luna UI acceptance (session `bceb36e5`, worker `03d2ee59`) in a headless app.paseo.sh client, 1440×900 and 390×844 light/dark: 9 PASS, 1 FAIL (Commits tile hid its average behind the line delta), fixed afterwards (hint and average share the line). Digest generated with Haiku 5.5 and its sessions archived; fixtures cleaned. [Verification](verification/project-insights.md).
- [ ] UNRUN: digest model-error paths; Electron window and a physical phone; re-screenshot after the tile fix.
- [x] Idea "Insights：按天统计 token 用量" (continued in this card): log parsers keep 15-minute token slots (Claude per deduped message, Codex count differences with reset handling); `insights.tokens` sums them into the client's days for all sessions of the project's cards; Tokens tile, Token use section (types, cache rate, top 5 cards) and Tokens per day bars. Spec §11.
- [x] PASS: typecheck; `npm test` 320 passed / 63 skipped (bucket and day-sum tests); real logs: plugin per-day sums equal an independent script (Claude 23,843,196 on 2026-10-16; Codex 5,683,345 on 2026-10-14).

## Ideas cards — 2026-10-15

- [x] Card request "agent执行过程中根据现状提供下一步计划，在任务中提议下一步可以做的任务，用户觉得好可以点击idea卡片创建新的任务卡片并把上下文带进去". User chose: ideas come from the working agent via a tool (A), show on the source card's drawer plus a card badge (A), and Create task opens the prefilled new-task form (A); then "直接实现，不审阅方案". Wrote [ideas spec](IDEAS-SPEC.md). Baseline commit of the prior working tree first (the repository already existed, so no re-init).
- [x] Data: `board.ideas` (absent reads as `[]`, board stays v4), optional `task.origin`, receipt action `idea`. Agent tool `flowly_propose_idea` (signed request, replay, `IDEA_DUPLICATE`, `IDEA_LIMIT` 10 open, 50 kept per card), `flowly_get_task` lists the card's ideas, CLI `idea` subcommand, skill rule. `ideas.update` (dismiss/restore). `tasks.create` with `ideaId` checks before the workspace and again in the write, linking both ways atomically. Card delete / project remove back up and drop ideas.
- [x] Client: lightbulb count on cards, drawer Ideas section (open cards with Create task / Dismiss, closed group with links and Restore), "From idea on …" line, new-task form prefilled from the idea and source progress ("Create task from idea"); session context line `Derived from card: …`.
- [x] PASS: typecheck; `npm test` 279 passed / 63 skipped (new `server/ideas.test.ts`, tool-server MCP/CLI idea checks). Plugin reloaded.
- [x] Luna (`codex/gpt-6-luna`, full access) live acceptance, test session `c8e2e1b0`: MCP and CLI proposals, duplicate refusal, dismiss/restore, create-from-idea links and `Derived from card` context, reuse refused without a new workspace, delete backup; fixtures cleaned to the baseline counts. [Verification](verification/ideas.md).
- [x] Follow-up "ideas放到sessions下面": the drawer's Ideas section sits below Sessions.
- [x] Follow-up "优化idea卡片的设计、交互、motion。接受按钮改成good idea": cards show title, a meta line (type, non-Normal priority, age) and the rationale; details (What to do, Context) expand with animated height and a rotating chevron; actions are **Not now** and **Good idea**. Not now is optimistic and collapses the card in place (rolled back with a toast on failure); accepted ideas collapse out too; ideas arriving while the drawer is open rise in. Slot-keeping merge in `client/idea-rows.ts` (3 tests). PASS: typecheck; `npm test` 282 passed / 63 skipped; reloaded.
- [x] Follow-up "按钮左对齐还更好看点": idea actions left-aligned with the title, primary Good idea first, then Not now.
- [x] Follow-up "按钮有点太大了 移动端看有点不协调": shared `Button` gains `small` (32 pt on touch / 28 px desktop, 12 pt label, 13 pt icon, hitSlop keeps the 44 pt target); idea actions and Restore use it. Low priority shows as text without its single-bar glyph (read as a stray comma). Checked read-only on this card at 390×844 in a separate headless app.paseo.sh client; the phone lane picker was put back to Design.
- [x] Follow-up "good idea有些是当前任务的延伸…两种路径都要支持。重新设计这个链路": ideas carry the agent's `scope` (here / new; tool, CLI `--scope`, skill rule). Good idea opens a menu: **Do it in this task** (`ideas.adopt`: marks the idea for the proposing or newest live session, then queues the instruction through the composer; reverted if the hand-off fails) or **Start a new task** (prefilled form). The suggested path comes first; the meta line shows it; Closed shows "→ Sent to <session>". PASS: typecheck; `npm test` 311 passed / 63 skipped (new adopt tests).
- [x] Idea adopted in this card via "Do it in this task" (first live end-to-end use of the path): Restore refuses a dismissed idea whose title matches an open idea on the card (`ideaTitleKey` moved to `shared/ideas.ts`; new store test). PASS: typecheck; `npm test` 312 passed / 63 skipped; reloaded.
- [x] Follow-up "多个session会在哪个继续？能不能再加一个使用新session做的选项" (user: 可以): Good idea menu now offers Continue in <proposer or newest session>, Send to another session… (2+ live sessions; second menu), Do it in a new session (Start session prefilled with the idea; recorded with `ideas.adopt send:false` once created), and Start a new task. PASS: typecheck; `npm test` 313 passed / 63 skipped.
- [x] Luna UI acceptance (test session `59dbe335`, worker `515d644c`) in a separate headless app.paseo.sh client at 1440×900 and 390×844, light and dark: badge, drawer order, card layout, expand/collapse, Not now → Closed → Restore, Good idea prefilled form, two-way links; no console errors; fixtures cleaned. [Verification](verification/ideas-ui.md).
- [ ] UNRUN: frame-by-frame motion and Reduce Motion; the Electron window and a physical phone.

## App performance — 2026-10-15

- [x] Card request "app端存在一些性能问题，例如动画卡顿、session卡片加载慢等，输入框不跟手、丢字、自动关闭输入法等情况". Audit, then [performance spec](PERFORMANCE-SPEC.md) before code. Cause: the phone's JS thread was busy decoding large polls (relay E2EE in JS) and re-rendering the whole tree on every poll.
- [x] Daemon: `board.read-changed`, `summaries.read-changed`, `resources.read-changed` (etag; unchanged = 38 B), `sessions.tail` (slim projected tail, card-scoped).
- [x] Client: shared queries (`client/queries.ts`), streamed live agent list, drawer sessions from the stream, preview loads agent/transcript in parallel from cache, tools/access only while shown, memoized cards/drawer/transcript with stable callbacks and a stable theme/menu context, phone board hidden instead of unmounted, native-looped pulse, no card mount fade, native composer self-sizing, keyboard padding after the animation, send clears at once (restores on failure), late draft restore never remounts a focused input.
- [x] PASS: typecheck; `npm test` 266 passed / 63 skipped; plugin reloaded; live RPC sizes and agent stream checked. [Verification](verification/performance.md).
- [x] Follow-up "session card右边的最后活跃时间垂直居中": the time moved out of the title row, beside the chevron, centered on the row.
- [x] Follow-up "打开任务卡内容、打开session，动画都很卡": heavy sections and reads wait for the open transition (`useSettled`); archived sessions from the daemon (`sessions.archived`) instead of paging every agent on each open; phone card is an overlay above the still laid-out board. PASS: typecheck; `npm test` 267 passed / 63 skipped; reloaded; live RPC check.
- [x] Follow-up "上下滚动的时候会出现这种水平漂移问题": cached interpolation nodes (`lerp`), final-value sync after native transitions, no reveal on first mount. PASS: app typecheck; tests (one failure from the concurrent Ideas work); reloaded.
- [ ] UNRUN: real-device smoothness/IME on iOS/Android over LAN and relay; Luna UI acceptance; stale renderer fixtures (pre-existing).

## Automatic status as a setting — 2026-10-15

- [x] Card request "自动流转作为设置项提供，默认打开". New host setting `auto-status.autoStatus` (default on; unset/invalid stored values read as on), shown in Ultra Kanban settings → *Moving cards* → *Auto-update status from sessions*. Off: the daemon still records turn facts but skips rules A1/A1r. The per-project switch stays as an opt-out, renamed *Auto-update status in this project*. [AUTO-STATUS-SPEC](AUTO-STATUS-SPEC.md) amended.
- [x] PASS: typecheck; `npm test` 254 passed / 63 skipped (new: setting defaults). Plugin reloaded.
- [ ] UNRUN: Luna UI acceptance of the settings toggle; a live turn with the setting off.

## Delete a card permanently — 2026-10-15

- [x] Card request "增加彻底删除卡片的能力，并把现在当前project下无法unarchive的那些老的卡片删了". Wrote [task delete spec](TASK-DELETE-SPEC.md): archived cards get *Delete permanently…* in the board card menu and drawer task menu, with a confirm dialog; `tasks.delete` (CAS, archived only) drops the card, its events, receipts and summaries after a `removed/` backup; Paseo resources untouched. AGENTS.md exception added.
- [x] PASS: typecheck; `npm test` 251 passed / 63 skipped (2 new store tests). Plugin reloaded.
- [x] Deleted the 11 archived Ultra Kanban cards whose worktrees the old wrap-up removed, through the plugin RPC; kept the restorable “竞品调研”. [Verification](verification/task-delete.md).
- [x] Follow-up "手机端lane列表的选中标记导致数字不在一列": `Row` puts the selected check before the trailing value (user preferred this over a reserved empty slot), so the phone lane picker counts stay flush right in one column. PASS: typecheck; `npm test` 251 passed / 63 skipped. Plugin reloaded.
- [x] Follow-up "菜单没有删除任务的选项，允许任何lane里删除，删除时询问是否同时archive，增加选项自动archive": *Delete permanently…* on every card; the dialog runs `tasks.delete-check` (wrap-up preflight without the lane rule) and asks Keep / Archive for its sessions and own workspace (running sessions disable Archive, warnings shown); new setting *Auto archive on delete* (`wrap-up.archiveOnDelete`) skips the question when the preflight is clean. `tasks.delete` archives first (wrap-up run, keepCard) and deletes only if that succeeds. PASS: typecheck; `npm test` 253 passed / 63 skipped (new: live-card delete, delete preflight/run). Plugin reloaded; live `tasks.delete-check` on 竞品调研 (clean) and this card (running session → blocker).
- [ ] UNRUN: Luna UI acceptance of the menu entries, dialog and setting; a live delete with Archive on a fixture card; phone lane picker alignment on a real phone.

## Task type — 2026-10-15

- [x] Card request "任务卡片增加任务类型，比如research、bugfix、feature等". Wrote [task type spec](TASK-TYPE-SPEC.md): optional `task.type` (Feature / Bug fix / Research / Refactor / Docs / Chore); absent on existing cards, so no board migration.
- [x] Create/edit form Type choice (default None), card meta chip, drawer Type property, Details row, board Type filter (`filterType`, remembered, reset and cleared by session links); session context line `Task type: …` when set.
- [x] PASS: typecheck; `npm test` 248 passed / 63 skipped (new: store set/clear/keep, context line, settings default).
- [x] Follow-up "side bar里改状态和tag直接在按钮旁边出下拉菜单": drawer Status / Type / Priority open a dropdown anchored below the button (context menu gained `leading` icons; the button measures itself), values save directly with CAS + toast; the drawer Status modal is gone. PASS: typecheck; `npm test` 249 passed / 63 skipped. Plugin reloaded.
- [ ] UNRUN: Luna (`codex/gpt-6-luna`) UI acceptance on desktop/compact, including dropdown placement near the right edge.

## Restore the workspace and sessions when a wrapped-up card leaves Done/Cancelled — 2026-10-15

- [x] User chose option A: a temporary direct daemon connection, because the plugin SDK has no workspace restore. Wrote [workspace restore spec](WORKSPACE-RESTORE-SPEC.md), which records the SDK migration path (`COMPAT(sdk-workspace-restore)` in `server/workspace-restore.ts`).
- [x] Moving a card out of Done/Cancelled restores its workspace in the background, under the same workspace ID: unarchive in place, or recreate a removed worktree on its kept branch. This applies only when the plugin's wrap-up archived it or the card owns it. Records `workspace_restored` / `workspace_restore_skipped`. Sessions stay archived until messaged.
- [x] PASS: typecheck; `npm test` 243 passed / 63 skipped (5 new). Reloaded the plugin. End-to-end through the real plugin RPC, worktree and directory cards: [verification](verification/workspace-restore.md); fixtures cleaned up.
- [x] User follow-up "把session也复活": the sessions the wrap-up archived are revived too, by daemon agent refresh on the same connection. Selection: `archivedAt` within a wrap-up event, so user-archived sessions and summarizers are excluded. An already-active workspace still gets its sessions back (`sessions_restored`). PASS: `npm test` 246 passed / 63 skipped; e2e with sessions that ran a turn, both restored.
- [ ] UNRUN: Luna UI acceptance; end-to-end with Auto wrap up off; real unavailable-path cases (covered by focused tests).
- [ ] Follow-up: switch to the SDK once `PaseoApi.workspaces` exposes restore.

## Workflow stages: In progress → Design / Development / Test — 2026-10-15

- [x] User decisions: split In progress into Design → Development → Test for every project (option B); the agent decides whether to start with Design or Development. Wrote [workflow stages spec](WORKFLOW-STAGES-SPEC.md) and the user approved it ("可以 试试看吧，不行再改回去").
- [x] Board v4 (`server/migrate.ts`): In progress cards → Development; a configured In progress lane expands in place (on/off kept, custom name → Development); events/receipts keep the retired status (`historyStatusSchema`), shown as "In progress"; one-time `board.pre-v4.json` copy.
- [x] Rules: A1 no longer moves Backlog/Todo; resuming from In review/Blocked returns to the latest enabled work stage (else the first enabled one, else no move). A1r and the silent-turn marker cover all three stages.
- [x] Agents: `allowedStatuses` uses design/development/test/blocked/in_review; `in_progress` is accepted as a deprecated alias (keeps the current stage, else Development) so sessions with the old tool schema still work. Skill, tool description, CLI usage and UI copy updated; status icons CircleEllipsis / CircleDot / CircleGauge (same Circle family as the other statuses; Pencil/ShieldCheck looked a different size).
- [x] PASS: typecheck; `npm test` 231 passed / 63 skipped (new: v3→v4 migration, rejected v4 in_progress, A1 resume/skip/disabled lanes, silent turn per stage, alias). Reloaded the plugin. Live board migrated to v4: 2 In progress cards → Development, Ultra Kanban lanes expanded, 37 history events still read `in_progress`, `board.pre-v4.json` holds the v3 data. A live `flowly_update_status(in_progress)` call from this session (old schema) kept the card in Development.
- [x] Fix (user report): dragging a card to another lane under a non-Manual sort showed "Sorted by priority…" instead of moving it. Cause: web `onLayout` uses ResizeObserver and only reports size changes, so lanes shifted by a sibling collapsing/expanding (or lanes added/hidden) kept a stale x and the drop resolved to the card's own lane. Lanes are now re-measured with `measureInWindow` at drag start; the toast now says lane moves still work. Cross-lane drops under priority/other sorts land by the sort rule.
- [x] Fix (user report, session `fdfe6286`): a rework-of-implementation follow-up resumed the card in Design. The agent had set Design, implemented, and delivered without ever setting Development, so A1 returned to that stale stage. Skill and tool description now require keeping the stage current (Development as soon as code changes; never deliver implementation from Design) and checking the auto-resumed stage at the start of every turn. A1 itself unchanged.
- [x] Follow-up (user: the same card went back to Design again; its session still had the old guidance): A1 now resumes a card **in review in Development** (review feedback is rework; falls back like Blocked when Development is off); Blocked still returns to the previous stage. Skill, settings copy and specs updated; tests cover both paths and the fallback.
- [ ] UNRUN: Luna (`codex/gpt-6-luna`) UI acceptance of the new lanes on desktop/compact, lane editor and activity rendering; drag between the three stages in the real app.

## Card token usage from local logs; Activity collapsible — 2026-10-15

- [x] Wrote [usage stats spec](USAGE-STATS-SPEC.md) before code. Tokens only, no money. Source: Claude Code (`~/.claude/projects/*/<id>.jsonl` + `subagents/`) and Codex (`~/.codex/sessions/**`, `archived_sessions/`) logs, located by Paseo `runtimeInfo.sessionId`. Read-only, cached by size/mtime.
- [x] Unified types: input (uncached), cache read, cache write, output (incl. reasoning), reasoning; turns and running time from the logs. Drawer **Usage** section (collapsed, header shows total and turns; per-session lines; progress summarizers as one subtotal). **Activity** is now collapsible and collapsed by default.
- [x] PASS: typecheck; `npm test` 225 passed / 63 skipped (5 new in `server/usage.test.ts`). Live `usage.task` on card `8c22cc02` (226 ms cold, 28 ms cached): Codex session `dddf746d` matches its rollout exactly (input 130,862 = 3,068,206 − 2,937,344 cached; output 17,098; reasoning 6,393); Claude session `17975bba` matches an independent recount within the turn that ran in between; 12/12 summarizer runs found.
- [ ] UNRUN: real-app rendering of Usage/Activity; Claude variants whose wrapper sets a different `CLAUDE_CONFIG_DIR` (the daemon's own environment is used).

## Task progress summary — 2026-10-15

- [x] Wrote [task summary spec](TASK-SUMMARY-SPEC.md) after the user approved the design (cheap model via a Paseo session; Summary model setting, default Haiku 5.5 → GPT-6-Luna; one short-lived session per run).
- [x] Daemon: after a completed turn of a Kanban-managed session, a summarizer child session in the card's workspace returns `{update, state, recap, next}`. It runs one at a time per card and merges turns that end meanwhile. It is archived in `finally`. Results go to `summaries.json` (50 versions per card, last error per card), never changing board or task revisions. Project Remove backs the summaries up to `removed/`. RPCs: `summaries.read/history/refresh`.
- [x] UI: one-line state on cards; drawer Progress section (State/Recap/Next, Refresh, History); Settings → Ultra Kanban (Auto summary, Summary model). Summarizer sessions are hidden from board session views by label.
- [x] PASS: typecheck; `npm test` 220 passed / 63 skipped (20 new). Luna live acceptance `dddf746d` plus a follow-up live re-check: [verification](verification/task-summary.md).
- [x] Fixed from live testing: summarizer directory registered a native project (moved to the card workspace as a child session, user choice B; leftover project deleted); Haiku's array-valued recap failed the schema (lenient parsing).
- [x] User feedback: host settings page never appeared → floating settings button at the board's bottom-left opens a plugin-drawn modal (Auto summary; Provider → Model). Progress collapsed by default (state, 3 recap lines, 1 next line; Show more). Output tightened (state ≤15 words/30 汉字, recap ≤4 short lines, next one sentence; hard caps 80/400/160). Live refresh after the change: 15 s, state 33 chars, 4 recap lines.
- [x] Added `target` (goal + up to 4 feature points; kept stable unless scope changes; old versions read as ""). Progress shows it between State and Recap (1 line collapsed). Live refresh on card `8c22cc02`: 12 s, target "Goal: 为每个任务提供快速确认进度的摘要" + 4 feature lines. Tests 235 passed.
- [x] Usage: cache hit rate = cache read ÷ all input (header, totals, per session).
- [ ] UNRUN: real-app rendering of the card line, Progress section, settings button and modal; finished-notification behavior for child summarizers.

## Sidebar attention badge (F2) — 2026-10-15

- [x] Wrote [sidebar badge spec](SIDEBAR-BADGE-SPEC.md) before code. Confirmed from the 0.11.2 public types and installed app bundle that `SidebarRow.trailing` renders nothing when null and otherwise sits in a non-accessible host Pressable sharing the row press; nested pressables press on their own.
- [x] Sidebar row shows a warning count pill (`99+` cap) only when the count is > 0; pressing the row still opens the board, pressing the pill opens the board with the Needs attention modal (unique `view=attention&open=<token>` per press). Board and sidebar both count through the shared pure `attentionFromSources`; badge pill extracted to `CountPill` and reused by the board button.
- [x] Sidebar polls board/agents/read receipts every 10 s with host-scoped query keys through plugin `useRpc`/`usePaseo` only; observers end on unmount. Board/agent failure hides the badge.
- [x] PASS: `npm run typecheck`; `npm test` 95 passed / 56 renderer-only skipped (2 new focused tests in `client/attention.test.ts`).
- [ ] UNRUN: plugin install/reload, real desktop/compact sidebar rendering, pill press and modal opening in the app, screen-reader focus of the pill. Not permitted in this card (no install/reload, no UI driving).
## Card latest agent output (F1) — 2026-10-15

- [x] Wrote [card output spec](CARD-OUTPUT-SPEC.md) before code. Agent snapshot has no assistant-text field, so cards use a bounded 20-entry projected tail fetch keyed by session ID + `updatedAt`, only for mounted cards, at most 3 concurrent, no polling/retry.
- [x] Card shows one muted, non-selectable, single-line plain-text summary of the newest assistant message plus relative time; quiet for no session/loading/failure/no text; accessibility label includes it. Drag/press/Actions unchanged.
- [x] PASS: typecheck; full `npm test` 99 passed / 59 renderer-only skipped; focused helpers 6/6; synthetic renderer card 3/3; legacy card responder 8/8 after fixing its stale mock. [Verification](verification/card-output.md).
- [ ] FAIL (pre-existing, unchanged): session-attention renderer fixture 4 failures from stale mock, same on baseline.
- [ ] UNRUN: plugin install/reload, real desktop/phone UI, screen reader, live request rate.
## F3 drag reorder within/between columns — 2026-10-15

- [x] Wrote [drag reorder spec](DRAG-REORDER-SPEC.md) before implementation: insertion line, midline hit testing, `tasks.place` contract (CAS, single serialized atomic write, position/status only, no-op without write).
- [x] Implemented `tasks.place` (`BoardStore.placeTask`, fractional neighbor midpoint, normalization only when neighbors tie), pure `dropSlot`/`placementUpdate`, column insertion line and drop wiring; new cards append after the column's max position. Menu up/down and phone/touch paths unchanged.
- [x] PASS: typecheck; `npm test` 110 passed / 60 renderer-only skipped; focused store 10/10, geometry 12/12, service append 1/1, columns renderer 4/4 (temp `react-test-renderer`). [Evidence](verification/drag-reorder.md).
- [ ] FAIL (pre-existing, unchanged): 45 legacy renderer fixtures fail identically on the base commit due to stale `client/ui` mocks.
- [ ] UNRUN: actual desktop UI/drag feel and live conflict error — no plugin install/reload by instruction.
## F4 desktop keyboard shortcuts — 2026-10-15

- [x] Researched Paseo 0.11.2 before implementation. The plugin SDK has no shortcut API, and Command Center items have no key field. The host shortcut registry is internal, and a global DOM listener is forbidden. The trade-off is recorded in the [shortcuts spec](SHORTCUTS-SPEC.md), written before code.
- [x] Board-scoped keys on desktop web: N new task, P projects, / or F filters, A attention, ? help, Esc (session Back, then close the sidebar), and J/K/H/L card navigation. The root `View` is focusable and receives the RN-Web `onKeyDown`. Plugin text inputs and all plugin modals block shortcuts through a ref-counted guard (`useShortcutBlock`, `client/modal.tsx`). Modifier chords, repeats and IME input pass through.
- [x] Discoverability: a desktop header Keyboard button opens a help modal; header button labels include their key. Five global Command Center items open the board with a once-only, 30-second `intent` param.
- [x] PASS: `npm run typecheck`. PASS: focused `client/shortcuts.test.ts` 10/10. PASS: full `npm test` (103 passed / 56 renderer-only skipped). An initial run failed 3 renderer fixtures because `Modal.Content` was read at import time and their host mocks omit `Modal`; it is now read lazily, and the re-run passed.
- [ ] UNRUN: real desktop key handling, how focus enters the board, focus after a host modal closes, Command Center item display and navigation with params on an already-open board, and help modal appearance. Per card instructions, the plugin was not installed or reloaded and no Luna test session was created. [Verification](verification/shortcuts.md).

## Compact task status label — 2026-10-14

- [x] Updated [drawer spec](DRAWER-SPEC.md) before implementation. The [user capture](verification/fixtures/status-label/before.png) showed `T...`: installed host `SettingsSelect` reserves a 160 pt label while the plugin capped its wrapper at 240 pt.
- [x] Compact detail header now shows the full selected status in a full-width button; the seven options appear only after opening a themed host Modal. Same-value no-op, stale/inactive/archived/pending guards, exact task revision and success toast are preserved. Wide host selector has a larger width budget.
- [x] Focused 9/9, legacy renderer 43/43 and immediate-close 2/2 passed after updating stale test mocks; full suite 84 passed / 56 renderer-only skipped, final typecheck PASS, detector no findings. Reloaded only `paseo-ultra-kanban`, which reports running. Temporary renderers removed; no native resources created. [Evidence](verification/status-label.md).
- [ ] Android pixel visibility and sheet interaction remain UNRUN under the user's current code-only acceptance choice. Synthetic checks prove the selected label and actions passed to components, not the phone's pixels.

## Phone session composer — 2026-10-14

- [x] Updated [session UX spec](SESSION-UX-SPEC.md) before implementation from the user's Android [before screenshot](verification/fixtures/mobile-composer/before.png). Compact preview now uses a 48–96 pt growing input with a 48 pt Send target on the same row, one 48 pt Steer/Interrupt row only while running, and an inline Jump to latest target. Wide composer and send authorization remain intact.
- [x] Final typecheck PASS; focused real-component callback fixture 18/18 PASS (including compact growth, mode/send, paused follow and readonly); one full `npm test` 84 passed / 55 renderer-only skipped. Impeccable detector returned no findings. Reloaded only `paseo-ultra-kanban`; it reports running. No native resource was created.
- [ ] App E2E is UNRUN and deferred by the user's code-only acceptance choice. Paseo desktop CUA `getApp` timed out; AndroMeld `devices.list` returned `[]`, so no Android Phone Screen session existed. No desktop window or phone UI was operated. AI mirror control was disabled after the attempt. [Verification detail](verification/mobile-composer.md).

## Android project chooser theme crash — 2026-10-14

- [x] Amended [UI/UX spec](UI-UX-SPEC.md) before implementation. The user screenshot shows `Error: Theme missing` in the plugin `Button` when the compact project chooser opens. Source inspection found the custom theme provider outside the host Modal body.
- [x] Reprovided the current theme inside all seven host modal bodies: board project/filter/status/task-action choosers, project/task forms and session creation. No RPC, board data or resource contract changed.
- [x] `npm run typecheck` passed. Source inspection found a provider immediately inside every `Modal.Content`. Reloaded only `paseo-ultra-kanban`; plugin inventory reports enabled and running. No tests or new Paseo resources were created.
- [ ] Android opening/dismissing those modals is UNRUN: no safely addressable Android UI target was available; the ADB device inventory did not return and was interrupted. The plugin's `running` state is not proof of the mobile fix. [Verification and user screenshot](verification/android-modal-theme.md).

## Follow-up composer Enter submission — 2026-10-14

- Complete [input spec](SESSION-INPUT-SPEC.md) before code: desktop Enter/Shift/IME, native Send, shared lock/draft semantics, plain tool-purpose copy and exact user-message delivery without the repeated task preamble.
- [x] Shared button/key submission, native Send behavior, latest-draft buffer/writable guard, Shift/IME/repeat protection and purpose/hint copy implemented; parent typecheck PASS, detector no findings.
- [x] User correction applied: ordinary card follow-ups now send only the typed text after fresh actor/scope checks. Initial session context and explicit Kanban work instructions remain separate. Updated the existing wire-payload unit assertion and passed parent typecheck.
- [x] Independent full-access Luna passed 17 focused composer checks, 46 renderer regressions, final typecheck and one full suite (83 passed / 54 renderer-only skipped) before the wire-payload correction. The bounded post-correction wire check passed 4/4 and final typecheck passed; the broad suite was not repeated. [Chronology and evidence](verification/session-input.md).
- [x] Reloaded only `paseo-ultra-kanban`, confirmed running, deleted exact test session `6cbf1980-bcac-4b6b-9693-2731c7b611c4` and confirmed `AGENT_NOT_FOUND`. Its derived CLI context and all seven recorded renderer directories are absent. Two projects/two cards remain; six normal session lifecycle events are preserved. [Cleanup evidence](verification/fixtures/session-input/parent-closeout.json).
- [ ] Actual desktop/compact UI, hardware Shift/IME, focus and message delivery remain UNRUN: fresh CUA could not identify the required non-fullscreen window by ID/title/geometry. No GUI action was attempted. Delivered for user review.

## Task sidebar hierarchy — 2026-10-14

- Complete [drawer spec](DRAWER-SPEC.md) before implementation: grouped native Status/Edit/Archive, grip-only resizing and collapsed metadata/workspace.
- [x] Grouped public host Status selector/Edit/Archive, removed width controls and workspace action, primary Sessions and collapsed read-only metadata implemented. Shared measured-height motion and adjustable boundary grip retained; parent typecheck passed and detector returned no findings.
- [x] Full-access Luna: focused 8/8, corrected legacy 43/43, reduced-motion immediate-close 2/2, final typecheck PASS; the single full suite passed 72 / 48 renderer-only skipped before the bounded follow-up. Exact stale accordion completion and archived-project guard are covered; [chronology and limits](verification/drawer.md).
- [x] Reload/inventory enabled and running. Exact test session `5a68229e-51a2-4b3c-8d66-d20a373d5374` deleted (AGENT_NOT_FOUND); derived CLI context removed; all six recorded renderer paths and current scoped temp inventory absent. Source hashes match verifier evidence. Project/card counts remain 2/2; six normal test-session lifecycle events preserved, live read-state hash unchanged with no test-agent receipt.
- [ ] Actual desktop/compact appearance, host dropdown/keyboard/path wrapping and gesture/motion feel remain UNRUN: fresh CUA lacks window ID/title/geometry; no GUI interaction. Delivered for user review.

## Board feedback and navigation motion — 2026-10-14

- Complete [motion spec](MOTION-SPEC.md) written before code; AGENTS.md requires shared, interruptible motion and native toast feedback.
- [x] Native success toast, non-selectable lane text, shared motion/preference primitives, inert drawer exit, forward/Back session transition and direct-coordinate drag feedback implemented; parent typecheck passed and design detector returned no findings.
- [x] Independent full-access Luna: motion 8/8, legacy renderer 42/42, retained-preview exit fixture 10/10 and final typecheck PASS. One full suite passed 72 tests / 39 renderer-only skipped before the final exit case; chronology and unexercised criteria are in [verification](verification/motion.md).
- [x] Final plugin reload/inventory running. Exact testing session `363ff97e-8a55-491a-bdfe-34d9e73c934b` deleted, inspection AGENT_NOT_FOUND; derived CLI context removed and renderer paths absent. No project/workspace/card created; existing board remains two projects/two cards. Eight normal test-session lifecycle history entries preserved; live read-store hash unchanged with zero test-agent receipts.
- [ ] Actual desktop/compact motion, toast/selection/gesture feel and additional listed criteria remain UNRUN. Fresh CUA lacks native window ID/title/geometry; no GUI interaction. Delivered for user review.

## Native session chip — current request

- [x] Public 0.11.2 composer pill/screen params gate; complete [SESSION-CHIP-SPEC.md](SESSION-CHIP-SPEC.md) before implementation
- [x] Host-scoped paginated chip discovery/cleanup and fresh navigation validation; cold route validation, stale board-fetch cancellation and one-time card/sidebar/session entry. First typecheck passed
- [x] Full-access Luna 6: helper 7/7, new synthetic navigation 3/3, old regressions 30/30; complete suite 72 passed / 30 skipped and final typecheck passed
- [x] Final reload running; exact test session deleted, native inspection AGENT_NOT_FOUND; both renderer directories/current scoped temporary directories absent. Live read-store hash unchanged; standard test-session lifecycle history retained on the user card
- [ ] Real native chip/wide/compact focus: requires safely bound non-fullscreen Paseo window

Testing session `d380e718-8a0a-42a6-bc1e-cabe0ef8f483`, `codex/gpt-6-luna`, created with `modeId=full-access` in existing workspace `wks_1b4e2fc48dd38d30` and deleted at closeout. No test project/workspace/card or child was created. [Verification and limits](verification/session-chip.md). The development workspace is now linked to a user card; its four normal test-session lifecycle entries are retained as history. The board hash changed and is not reported as unchanged. Two existing user projects/cards and the read-store file were preserved. Delivered for user review; actual native chip/focus/wide/compact UI remain UNRUN.

## Task-card session attention — current request

- [x] Complete [SESSION-ATTENTION-SPEC.md](SESSION-ATTENTION-SPEC.md) before implementation: snapshot capability gate, counts/read semantics, separate daemon watermark store, validated RPC and failure/race/cleanup criteria
- [x] Implemented workspace-scoped session totals, run/finished/unread/attention counts, sidebar read state, explicit generation acknowledgement, and separate serialized daemon store; corrected workspace lifecycle check against the SDK and passed typecheck
- [x] Full-access Luna 6: focused 30/30 (10 logic/store/service, 4 new UI, 16 legacy UI), full suite 65 passed / 27 skipped, typecheck passed; additional error-read shared assertion rerun 5/5
- [x] Final reload running; exact testing session deleted and inspection returns AGENT_NOT_FOUND. Both renderer directories and all current-prefix test-store directories absent; board bytes/source hashes unchanged
- [ ] Actual wide/compact UI/native read flow: requires unambiguous non-fullscreen window targeting

Testing session `9ba46f22-fa8e-4925-95c0-5bcb1ea908d8`, `codex/gpt-6-luna`, created with `modeId=full-access` in existing workspace `wks_1b4e2fc48dd38d30` and deleted at closeout. No fixture native project/workspace/card or child was created. [Verification and UI limits](verification/session-attention.md). Delivered for user review; real desktop/compact rendering and native read/focus flow remain UNRUN.

## Session preview layout and tail — current correction

- [x] Updated [SESSION-UX-SPEC.md](SESSION-UX-SPEC.md) section 8 before implementation: native Markdown subset, fixed bottom composer, responsive metadata and follow-tail pause/resume
- [x] Implemented native Markdown rendering, fixed composer, wrapping metadata, follow-tail pause/resume and cancellable trailing subscription refresh; first typecheck passed and initial plugin reload running
- [x] Independent full-access Luna 6: combined focused checks 20/20; final full suite 55 passed / 23 renderer-only skipped; final typecheck passed. Timeline error/empty-state defect corrected; prior fixture collection failure fixed with test-only mock compatibility changes
- [x] Final reload running; exact test agent deleted and native inspection returns AGENT_NOT_FOUND. Both temporary renderer directories removed; board bytes and verified implementation hashes unchanged at closeout
- [ ] Actual desktop/phone rendering and keyboard/gesture checks: current CUA inventory has no window ID/title/geometry for the required non-fullscreen window

Testing session `1ea62ff1-6a08-4e88-bd17-1873cd76e53b`, `codex/gpt-6-luna`, created with `modeId=full-access` in existing workspace `wks_1b4e2fc48dd38d30` and deleted at closeout. No test project/workspace/card or child was created. [Verification and remaining UI limits](verification/session-layout.md). Delivered for user review; real rendering, keyboard positioning and gestures remain UNRUN.

## Session creation and preview — latest UI request

- [x] Native pane API gate first: installed 0.11.2 SDK has no embeddable Agent pane or draft/create navigation; public existing-session native navigation supported
- [x] Complete fallback contract: [SESSION-UX-SPEC.md](SESSION-UX-SPEC.md)
- [x] Creation host Modal with collapsed settings and existing MCP/skill/recovery flow; overview session cards with execution state; explicit preview Back/native actions
- [x] Per-session draft and in-flight operation isolation; live membership checks; preview-only observation and cleanup
- [x] First typecheck and 55 passed / 7 renderer-only skipped regression checks; plugin reload running
- [x] Full-access Luna 6: final focused component checks 7/7 and typecheck passed; temporary renderer removed and exact test agent deleted
- [x] Broad suite before the final mounted-ref StrictMode fix: 55 passed / 13 skipped. No broad rerun after that fix; the final focused suite covers StrictMode navigation and cancellation after Back
- [x] Final plugin reload/runtime running; cleanup inspection returns AGENT_NOT_FOUND and no test lifecycle events remain in the board
- [ ] Real Paseo UI/native focus/message delivery remain UNRUN: no unambiguous non-fullscreen window target

Testing session `18121ba1-252f-4a1c-93d7-2253918805ba`, `codex/gpt-6-luna`, created full-access in the existing development workspace and deleted at closeout. No fixture native project/workspace/card or child session was created. The existing board project/card and native resources were preserved. [API gate and verification](verification/session-pane.md). Delivered for user review; native focus and actual message delivery remain UNRUN.

## Whole-card drag amendment — latest UI request

- [x] Updated UI/UX spec: whole-card primary-mouse drag, independent Actions, card/preview text non-selectable
- [x] Implementation, typecheck and plugin reload running; native/compact vertical task list unchanged
- [x] Full-access Luna 6: focused checks 8/8, typecheck passed, full suite 50 passed / 7 renderer-only skipped. Temporary renderer removed; exact test agent deleted and native inspection confirms AGENT_NOT_FOUND

This supersedes the handle-only presentation below. Verification session `2fdbb024-4ddb-4793-bad5-d281470910ae`, `codex/gpt-6-luna`, created with `modeId=full-access` in the existing development workspace and deleted at closeout; no fixture native project/workspace/card created. Plugin is running; real desktop/phone gestures remain UNRUN. [Whole-card drag verification](verification/whole-card-drag.md). Delivered for user review.

## UI/UX refinement — 2026-10-14

- [x] Complete incremental contract: [UI-UX-SPEC.md](UI-UX-SPEC.md)
- [x] One-row toolbar with project management/filter menus; desktop columns and phone status chooser/vertical list
- [x] Status drag from a dedicated card handle, captured-revision writes, target feedback and horizontal edge scroll
- [x] Adjustable drawer grip and accessible width controls; bounded scrolling and wrapping choices/forms
- [x] First implementation typecheck, 49/49 regression checks, plugin reload running
- [x] Independent full-access Luna 6: 4/4 synthetic component checks; final normal suite 49 passed / 4 renderer-only skipped; final typecheck passed. Whole-card responder finding fixed by dedicated handle
- [ ] Live desktop/phone UI: current CUA inventory has no window identities/geometry, so the required non-fullscreen Paseo window cannot be bound. No Paseo UI action attempted

Testing session: `c8bfb6b3-40c8-40ec-8a0c-82a1909abe04`, `codex/gpt-6-luna`, created with `modeId=full-access` in the existing development workspace. Deleted after verification; exact native inspection now returns `AGENT_NOT_FOUND`. No fixture native project/workspace/card created. Renderer and current-run migration temporary directories removed; migration test now cleans each run automatically. Plugin remains running. [Verification and limits](verification/ui-ux.md). Implementation is delivered for user review; actual desktop/mobile gestures and live UI CAS rejection remain UNRUN.

2026-10-14 清理：此前验收留下的 11 个测试看板 project、22 张卡片、7 个托管 worktree、4 个验收 session 和隔离临时目录均已移除；对应原生 fixture project 在清理开始前已不在 Paseo 列表。插件恢复 running/ready，当前看板为空。今后的测试必须在结束时清理自身 fixture。[清理记录](verification/cleanup-20261014.md)。

## 2026-10-15 合并、自动进度 v1 与体验迭代

- [x] F1–F4 由 4 个只读 code-reviewer 审查，结论均为 MERGE WITH FIXES，已合入 main 并修复：F1 运行中 session 输出刷新节流（15s 窗口）与无障碍文案截断；F2 侧边栏复用看板查询缓存（15s）、attention token 模块级去重、单复数与热区；F3 菜单上/下移统一走 placeTask 单一排序路径；F4 intent 模块级去重且有效期 5s、picker 搜索框阻止快捷键
- [x] F1–F4 卡片经 Wrap up 真实收尾：worktree 已由 Paseo 移除，分支保留后已合并删除；收尾检查改为只报告“仅存在于该分支”的提交
- [x] 自动进度 v1（[AUTO-STATUS-SPEC](AUTO-STATUS-SPEC.md)）：只为看板管理 session 记录生命周期；规则 A1；question/静默标记；活动 Auto 标签；项目开关
- [x] 记住上次项目（host settings）、状态变化高亮、活动时间线降噪
- [x] Typecheck；`npm test` 142 passed / 63 skipped；只 reload 本插件；web 客户端：桌面/深色/420pt 手机渲染、收尾流程、项目记忆
- [ ] UNRUN：A1/question 在真实 agent 回合中的端到端触发；状态变化高亮的实际观感；原生 iOS/Android；Luna 验收
- [ ] 已知：绑定到仓库主 workspace 的卡片，其输出摘要会显示该 workspace 中普通对话的内容（摘要尚未区分看板管理 session）

## M2.5 多任务人工管理 — 2026-10-14

- [x] Spec: [MULTITASK-SPEC.md](MULTITASK-SPEC.md)（A 需要关注总览、B 一键开 session、D 手动收尾；C/E 不做）
- [x] AGENTS.md 增补显式 Wrap up 例外
- [x] 实现：`client/attention.ts`、`client/wrapup.tsx`、`server/wrapup.ts`、board/drawer/session-create 接入
- [x] Typecheck；`npm test` 96 passed / 56 skipped（新增 attention 3 项、wrapup 6 项，含真实 git 临时仓库）；只 reload 本插件
- [x] Web 客户端只读渲染：桌面与 420pt 手机的工具栏 Attention、空状态弹窗、卡片菜单 Start session、预填创建框（取消，未创建）
- [ ] UNRUN：Attention 有内容时的跳转（当前无待处理 session）；Wrap up 弹窗与真实归档（当前无 Done 卡片，未对用户资源执行）；原生 iOS/Android；Luna 验收（用户暂缓）

## UI refresh — 2026-10-14

- [x] Spec: [UI-REFRESH-SPEC.md](UI-REFRESH-SPEC.md) (native-blend direction, visual + IA changes, behavior parity)
- [x] Implementation: shared primitives/tokens (`client/ui.tsx`), status/priority glyphs (`client/status.tsx`), board toolbar and pickers, lanes, cards, drawer, session rows, session detail, forms
- [x] Typecheck; `npm test` 84 passed / 56 skipped; reloaded only `paseo-ultra-kanban`
- [x] Rendered check through a separate headless app.paseo.sh client connected to the local daemon (not the user's windows), read-only navigation only: desktop light/dark board, drawer, session detail, project/filter/action modals, card hover; 420 pt phone status chooser, list, drawer, session. No writes performed; no fixtures created.
- [x] Phone horizontal drift fix (spec §7a): vertical-only lists with clipped content width; compact status switch fades instead of sliding. Web 390 pt touch-emulated probe finds no horizontally overflowing scroller; not reproduced or verified on a native device (none connected)
- [x] Session composer keyboard inset and send button restyle (spec §7b); `keyboardOverlap` unit-tested (87 passed); web composer rendered empty/with draft. Native keyboard behavior not verified on a device
- [x] Android chip toast `Cannot read property 'id' of undefined`: chip action now only navigates; board validates (SESSION-CHIP-SPEC 2026-10-14 amendment). Step-prefixed errors. Chip fixture test updated to the new contract; 87 passed. Web compact chip flow re-run OK. Root cause on Android not confirmed (no device)
- [ ] Luna UI acceptance: deferred by the user's choice; user reviews in the real app first
- [ ] Not exercised live: drag/drop, resize grip drag, create/edit forms submission, session send/steer/interrupt, mark read, native iOS/Android

## Card write scope — research only, deferred — 2026-10-15

- [x] Research/design: [TASK-SCOPE-DESIGN.md](TASK-SCOPE-DESIGN.md) (Codex/Claude only; other providers unresearched)
- [ ] Implementation: deferred by the user; linked projects stay unrestricted for now

## Wrap up on Done/Cancelled — 2026-10-15

- [x] Spec: [MULTITASK-SPEC.md](MULTITASK-SPEC.md) supplement: moving a card into Done/Cancelled prompts "Wrap up this card?" (archives sessions/own workspace, keeps the card); setting *Auto wrap up* (default off) makes the daemon do it when the preflight is clean, recording skips
- [x] Typecheck, 238 tests (auto/keepCard/ownership cases in `server/wrapup.test.ts`), plugin reload
- [ ] Live move with a fixture card, prompt and settings UI check: unrun

## Remove project (board, optionally Paseo) — 2026-10-15

- [x] Spec: [PROJECT-REMOVE-SPEC.md](PROJECT-REMOVE-SPEC.md): one Remove entry (replaces Archive); the dialog chooses Keep in Paseo or Also remove from Paseo (native removal keeps all files; blocked while sessions run); board records backed up
- [x] Typecheck, 197 tests, reload, live UI removal of both kinds with fixture cleanup. [Verification](verification/project-remove.md)

## Desktop project tabs — 2026-10-15

- [x] Spec: [PROJECT-TABS-SPEC.md](PROJECT-TABS-SPEC.md): desktop header tabs for one-click project switching; returning to the board reopens the project last viewed in this app run, a cold start opens the first
- [x] Typecheck, tests, reload, headless web-client check of switch/leave/return/reload. [Verification](verification/project-tabs.md)

## Project directory picker and linked multi-repo projects — 2026-10-15

- [x] Spec: [PROJECT-PICKER-SPEC.md](PROJECT-PICKER-SPEC.md)
- [x] In-app folder browser (daemon-side listing) and system folder dialog (Finder/Explorer/zenity/kdialog on the Paseo computer)
- [x] "Multiple repositories" project source: new root under `plugin-data/.../projects/<name>` with one symlink per directory, registered as the native project; links editable on the project form
- [x] Typecheck, 187 tests, plugin reload, live RPC 12/12 with full fixture cleanup. [Verification](verification/project-picker.md)
- [ ] UI acceptance in the Paseo window and native-dialog end-to-end selection: unrun

## Single-root amendment — latest user decision

- [x] Complete amended contract: [SINGLE-ROOT-SPEC.md](SINGLE-ROOT-SPEC.md)
- [x] New project and card flows use one native Paseo project root; common parent directories are managed as native projects
- [x] Existing multi-repo cards keep their saved scope and workspace links as read-only legacy data; v3 board storage is preserved
- [x] Typecheck, 43/43 tests across 7 files, and skill validator pass
- [x] Reloaded only `paseo-ultra-kanban`; `board.json` SHA-256 stayed identical across reload
- [x] Full-access Luna 6 isolated non-UI acceptance: 13/13 resource checks in both corrected runs; native binding immutability; real `flowly_get_task` root scope and identity. [Verification report](verification/single-root.md)
- [ ] UI acceptance: CUA cannot distinguish the user's non-fullscreen Paseo window; no UI action was attempted

The prior Phase 1/2 multi-repo scope below is historical. UI acceptance remains constrained to the non-fullscreen Paseo window; CUA currently cannot enumerate macOS windows, so no UI action is allowed without unambiguous targeting.

## Phase 1 — Kanban and Paseo resources

Current scope: revised on 2026-10-13. Cards default to all project repos or explicitly select one/multiple repos; existing workspaces are linked by actual repo membership, preserving their native owners. Phase 1 delivery stops for user acceptance.

- [x] Accepted outline and project invariants
- [x] AGENTS.md constraints
- [x] Complete Phase 1 spec
- [x] Implementation (first pass)
- [x] Final Luna typecheck and 21/21 checks across 4 test files (20 implementation tests plus isolated migration verification)
- [x] Installed Paseo plugin; Luna 6 acceptance session launched
- [x] Actual wide UI, ownership, persistence and selected-session message acceptance
- [x] Revised repo-scope implementation, migration and existing cross-project workspace eligibility
- [x] Luna 6 revised core acceptance, controlled retry/negative cases, stale UI draft, move/reorder/filter and project repo edit guards
- [ ] Revised compact light/dark UI: externally blocked by CUA `cgWindowNotFound`/window-coordinate errors; System Events also denied assistive access. Old compact captures do not validate the revised UI.
- [x] Stopped for user acceptance; subsequent instructions authorized Phase 2 design, implementation and testing

Delivery: implementation is ready for the user's review in Paseo → Ultra Kanban. [Verification report](verification/phase-01.md) distinguishes the passing revised core from the unresolved compact capture boundary and the historical unattributed duplicate workspace observation. No daemon restart or resource deletion was performed.

## Phase 2 — Agent tools and skill

- [x] Revised complete Phase 2 design, aligned with optional multi-repo scope and preserved existing workspace ownership
- [x] User authorization: implement Phase 2 and perform complete testing
- [x] S0 preallocated agent identity, explicit full access and real provider MCP probe (Luna)
- [x] Tool/CLI/MCP and skill implementation; installed under the existing plugin ID
- [x] Typecheck, complete `npm test` (7 files/42 tests), skill validator; daemon RPC health and board v3 view
- [x] Luna 6 full-access, real MCP and existing-session CLI behavioral acceptance; scope, identity, concurrency, replay, reload and core negative cases
- [ ] Phase 2 UI acceptance: CUA on macOS cannot identify/bind the user's non-fullscreen Paseo window; no Paseo UI action was attempted
- [ ] Full live expiry/capacity/port-collision/v2-service migration scenarios; focused service/store tests pass, limits are recorded in the verification report

Phase 2 spec: [PHASE-02-SPEC.md](PHASE-02-SPEC.md). Three current-card tools; automatic MCP/skill for drawer-created sessions; explicit CLI/skill instructions for existing sessions; Agent delivers In review and human confirms Done. Task/project revisions protect live scope, progress notes preserve task revision, and persistent receipts prevent duplicate retry writes. Testing used full-access `codex/gpt-6-luna` sessions. The complete non-UI acceptance and remaining boundaries are in [verification report](verification/phase-02.md). Work stops for user review after this phase.

## Environment

- Plugin ID: `paseo-ultra-kanban`; existing `paseo-kanban` is a separate installation.
- Daemon/client compatibility target: Paseo 0.11.2.
- Global plugins are already enabled.
- Testing model discovered: `codex/gpt-6-luna`. No configured launch profiles.
- Phase 1 test session: `8c65c2a2-960b-4d0b-b9b8-782a8bc29029`, workspace `wks_1b4e2fc48dd38d30`.
- Luna integration finding: Paseo rejects literal `HEAD` as a worktree base. Default now resolves the selected source repo's named branch; blank-default and non-default branch live retests passed.
- Revised card session: `6c18d210-afa6-4b36-9550-60301a87767c`, `codex/gpt-6-luna`; actual writes in both repos under default scope and only repo-two after a scope edit were verified.
- Duplicate directory workspaces observed after stale CUA element actions are not yet attributed to product provisioning; preserve evidence and test controlled same-operation retries separately.
- Project-local npm registry is public npm; SDK 0.11.2 was missing from the mirror used by the first install attempt.

## 2026-10-19 Needs-you inline answers (card "提问框接入need you")

- Done: the card drawer's Needs-you area renders each live session's pending agent questions/approvals with the session view's form (`CardRequests`, SESSION-QUESTION-SPEC §2.1). Tour feature copy and README updated; the `agent-question` tip kept as is (user's choice). Board Attention menu and the board card itself stay unchanged (user's choice).
- PASS: typecheck, `npm test` (493 passed), plugin reloaded.
- PASS (live, user, 2026-10-19): a two-question AskUserQuestion (single select + multi select) answered by the user; the agent received both answers.
- PASS (live, user, 2026-10-19): tool approvals answered from the card drawer's Needs-you area with the session in Always Ask mode: Allow (create `/tmp/flowly-approval-test.txt`, ran) and Deny (delete it, agent received "Denied by user"); session switched back to bypassPermissions.
- UNRUN: phone layout, plan approval from the drawer, Luna 6 test session.

## 2026-10-19 Ideas card UI (card "ideas UI优化")

- Done: Ideas card actions are right-aligned at the standard button size (Not now, then Good idea at the far right). The card body is clamped with the same fade as Progress via the shared `client/clamped.tsx`: Show more / Show less in the bottom-left, the timestamp on the right. Progress swapped its toggle and timestamp to match. The tap-to-expand chevron is gone; three strings only it used were removed from all catalogs. Specs updated (IDEAS-SPEC §5.2, TASK-SUMMARY-SPEC §7). Onboarding: layout change only, no new tour copy or tip.
- PASS: typecheck, `npm test` (494 passed).
- PASS: `paseo plugin reload flowly` (status running, store ready, no errors in logs; 2026-10-19).
- UNRUN: visual check of the Ideas and Progress cards on desktop and compact (this session has no desktop-window control tool; the daemon serves no web client and react-native-web is not installed, so no screenshot was possible); Luna 6 session. Restore in the Closed group keeps the compact size.
- Follow-up (2026-10-19): the Ideas card's Show more and its two action buttons share one footer row (Show more left, Not now / Good idea right); the timestamp is back in the meta row; the Ideas page source line moved below that row. PASS: typecheck, `npm test`, plugin reload. UNRUN: visual check (no window-control tool).
- Follow-up (2026-10-19): the Progress card's style is now a shared resource, `client/content-card.tsx` (`ContentCard` surface + clamp + footer row, `CardBody`, `CardHeadline`, `CardText`, `CardField`, `CardMetaRow`/`CardMeta`, `CardFootnote`); Progress and Ideas both render through it (`client/clamped.tsx` removed). PASS: typecheck (also clean under --noUnusedLocals for the touched files), `npm test` (494), plugin reload. UNRUN: visual check.
- Follow-up (2026-10-19): Not now renamed Dismiss (button, accessible name `Dismiss {title}`, first-idea tip, tour line, README, specs; 3 strings re-keyed in all 9 catalogs). Desktop dismiss swipes the card out to the right with a fade (180 ms), then closes its slot (160 ms); phones keep the in-place collapse; Reduce Motion removes at once; restore mid-exit cancels it. PASS: typecheck, `npm test` (494), plugin reload. UNRUN: visual check of the swipe.
- Follow-up (2026-10-19): insert animation for Restore and newly arriving ideas: the slot opens (160 ms), then the card comes in (220 ms); on desktop a restored card slides in from the right, mirroring Dismiss; restored ideas animate even if they were listed at first render. PASS: typecheck, `npm test` (495), plugin reload. UNRUN: visual check.

## 2026-10-19 Subagents chip (card "side bar session关联subagent")

- Research: Paseo-native child agents (label `paseo.parent-agent-id`) are in the plugin SDK's agent list and open with `navigation.openAgent`. Provider subagents (Claude Task / Codex) are daemon-only (`listProviderSubagents`, not in `PaseoApi` 0.11.2/0.11.4) and plugins have no navigation target for them. The user chose native child agents only (option C).
- Done: a Subagents chip above the session view's message box (`client/subagents.tsx`, logic in `shared/subagents.ts`), styled like Paseo's composer pill: per-bucket segments (working / need input / failed / ready to review, else N subagents), an upward list, rows open the child in a Paseo agent pane. Reads the shared live agent list only. New one-time tip `subagents`; tour unchanged (not a headline capability). Spec: [SUBAGENTS-SPEC.md](SUBAGENTS-SPEC.md).
- PASS: typecheck, `npm test` (532 passed), `paseo plugin reload flowly` (running, store ready).
- PASS (data, live): a child created from this card's session (`6b58d4ff-1936-4302-83ed-5888480904ea`, claude haiku) carries the parent label; the daemon list returns it as idle / finished / requiresAttention, so the chip shows "1 ready to review".
- PASS (live, user, 2026-10-19): the user checked the Subagents chip in the side bar; the test child `6b58d4ff-…` was archived afterwards.
- UNRUN: compact (phone) layout; Luna 6 session.

## 2026-10-19 Phone performance (card "手机端性能优化")

- Done: board reads send only the events the phone does not hold yet (`board.read-changed` `since`/`delta`; 877 KB → 216 KB on this board's data); running agents' clock/usage ticks no longer replace the shared agent list (the board re-rendered ~2×/s whenever any agent on the host ran); per-card derived props are cached across board renders; the transcript's scroll callback is throttled to 100 ms. Details: [PERFORMANCE-SPEC](PERFORMANCE-SPEC.md) "Follow-up: phone sluggish again". Onboarding: no user-visible feature, so no tour copy or tip.
- PASS: typecheck, `npm test` (591 passed, 63 skipped), `paseo plugin reload flowly` (running, store ready).
- UNRUN: device smoothness on a phone (LAN and relay); live RPC byte count of the delta read; Luna 6 session.
- Follow-up (2026-10-19): the rest of the board (tasks, ideas, artifacts, workpads, projects, links, dismissals, plans) is patched too: the daemon remembers per-item hashes of the last 32 boards by etag and answers a held etag with only the changed items, removed IDs and new events (`server/board-delta.ts`, `applyBoardPatch`); events-only delta and the full board remain the fallbacks. PASS: typecheck, `npm test`, plugin reload. UNRUN: phone check; live byte count on the running daemon.
- Follow-up (2026-10-19): the phone's lane list is virtualized (host `FlatList`, `client/lane-list.tsx`, `client/lane-rows.ts`; off-screen cards mount nothing and read nothing) and a developer timing log was added (`performance.log` host setting; `board.render`, `board.read.*`, `board.apply`, `drawer.open.*`, printed by the daemon in the plugin log). PASS: typecheck, `npm test` (615 passed), plugin reload. UNRUN: device check of the list and real numbers. Onboarding: no user-visible feature.
- Cold start (2026-10-20): client bundle 2.12 MB -> 0.95 MB (UI-language catalogs are served by the daemon on demand, `i18n.catalog`; `LocaleRoot` waits up to 400 ms for the catalog); the session-chip poll's first round waits 2.5 s (was at plugin load); `plugin.load` / `catalog.load` added to the timing log; fixed the chip poll ignoring board patches (new `client/board-read.ts`). Details: [PERFORMANCE-SPEC](PERFORMANCE-SPEC.md) "cold start". Onboarding: no user-visible feature. UNRUN: device start-up time.

## 2026-10-20 Agent habits (card "Insights: next-move and idea rates per session and model")

- Done: Insights has an **Agent habits** block (`client/agent-habits.tsx`, counters in `shared/agent-habits.ts`, WORKFLOW-INSIGHTS-SPEC §12): per day for the last 7 days, per model and in total, the share of deliveries (in_review + result; questions listed apart) that came with next moves, ideas, explicit "none", and how many suggestions the user picked; a model or session with 0 next moves (or 0 ideas) over at least 10 deliveries is flagged. Pure rules over the flow log, so it works with Workflow insights off and costs no tokens. `agent.turn_ended` events now carry `model` and `pick` (written by the hook from the session snapshot and the turn's user message); flow entries carry `offered` / `offersDone`. `insights.project` returns `habits`.
- PASS: `npm run typecheck`; `npm test` (705 passed, 65 skipped); `paseo plugin reload flowly` (running, no errors); counters equal an independent hand count of a frozen flow log for five day/zone combinations (`docs/verification/agent-habits.md`).
- Correction to the card: its example numbers (10-19: 65 / 11, 10-20: 1 / 0) came from `board.json`, which keeps only the last 100 events per card. Flow log: 10-19 has 79 next-move events across all projects (57 in Flowly, rate 61% of delivery/result turns), 10-20 had 5 by 10:48 (8%).
- Onboarding upkeep: no welcome-tour change and no new tip. It is a diagnostics block, not a headline capability, and a new tip id would be shown once to every user. README (both languages) got one highlight paragraph.
- UNRUN: the block in a real desktop or compact window; a live `pick` and a live explicit `none` (NEXT-MOVES-SPEC §8 is another session's unfinished work); Luna 6 session.

## 2026-10-20 Delivery-time reminders (card "Delivery-time reminders for missing next moves and ideas, plus firmer skill wording")

- Done: a successful `flowly_update_status` (in_review, blocked) or `flowly_report_progress` (question, result) that leaves the session without next moves (an explicit `[]` counts) since its latest `agent.turn_started` on the card adds a `reminders` array right after the receipt; an in_review delivery also reminds when the session proposed no idea on the card and Ideas are on. Text only, the write already succeeded; failed writes, finished cards and Ideas-off stay quiet; a replay is judged on the board as it is now (NEXT-MOVES-SPEC §9, IDEAS-SPEC §4.1). The skill (both copies) now says every delivery, ask or result ends with next moves and every delivery reviews ideas, and explains `reminders`.
- Calls on the card: the ideas check reads `board.ideas`, not `idea_proposed` events (events keep only the last 100 per card); `moves: []` on the standalone tool, which the reminder text offers, came with the sibling next-moves card (96ac586).
- PASS: `npm run typecheck`; `npm test` (711 passed, 65 skipped), including MCP `structuredContent.reminders` through the output schema and the CLI's key order.
- PASS (live, 2026-10-20): five `codex/gpt-6-luna` full-access sessions on a temporary Tinylink card (`docs/verification/delivery-reminders.md`): `reminders` arrive over MCP and over the CLI; sessions allowed to act made the named call (`moves: []` over MCP, `next-moves` over CLI) and the second delivery no longer carried the next-moves reminder; an explicit `[]` on the delivery call also avoids it. Card, sessions and workspace cleaned up and checked in the board and the native registry.
- NOT SHOWN: that Luna acts on the reminder unprompted (S2, told to end its turn, did not; the ideas reminder led to no idea in 5 sessions); phone layout; non-English; `question`/`result` and replay live.
- Onboarding upkeep: no welcome-tour change and no new tip. Agent-facing change; users only see more suggestion chips and ideas, which the existing `next-move` and `first-idea` tips already introduce.

## GitHub CI/CD — 2026-10-21

- Implemented in an isolated branch from origin/main (5e53249), preserving the
  active checkout's unrelated changes. Contract: [CI-CD-SPEC](CI-CD-SPEC.md).
- CI on Node 22/24; stable CI gate; exact npm tarball install; generated shipped
  shrinkwrap, OIDC tag release, prerelease channel, retry integrity, release
  assets/checksums, weekly action updates, Makefile and [operations](CI-CD.md).
- PASS local: npm ci; typecheck; npm test (678 passed, 65 skipped); focused
  release guard tests (4); package extraction + declared install; actionlint.
- Remote runs, repository settings and independent Luna evidence are recorded
  in [verification/ci-cd.md](verification/ci-cd.md) when completed. No new npm
  version or actual publish is part of this setup's verification.
- Onboarding: contributor tooling only; no welcome-tour or one-time tip change.
