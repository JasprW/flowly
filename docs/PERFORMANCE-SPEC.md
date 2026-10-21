# App performance: smooth animation, fast session cards, typing that keeps up

Status: card “性能优化” (2026-10-15). User report: in the app, animations stutter, session cards load slowly, and the input lags, drops characters and sometimes closes the keyboard. Goal: close to native smoothness. This amends the motion, session UX and session input specs; business contracts (single root, card/workspace/session ownership, CAS writes, exact follow-up text) are unchanged.

## 1. Diagnosis

The animations already run on the native driver, and the composer already owns its text on native. The stutter comes from a JS thread that is busy most of the time:

- **Polling volume.** With the board open, the client fetched the full board every 3 s (about 180 KB: every task's every event), resources every 5 s, every live agent every 5 s, summaries every 5 s and managed sessions every 10 s. With a session open, it also fetched every agent on the host including archived ones every 3 s (the drawer list), the session's agent every 2 s, a 35-entry projected timeline with full tool payloads (diffs, file contents, sub-agent logs) every 3 s plus on every stream event, tool health every 5 s and access state every 3 s. Off the LAN, every response is decrypted, base64-decoded and parsed on the JS thread (relay E2EE), then deep-compared by react-query.
- **No render containment.** No component used `React.memo`. Each poll that changed anything (an agent's `updatedAt` changes constantly while it runs) re-rendered the board, every card, the open drawer, the whole transcript and the composer. The host's theme object could also change identity on unrelated host renders, which invalidates every `useTheme` consumer.
- **Mount work during transitions.** On a phone, opening a card unmounted the whole board and Back remounted it (every card, query and animated value) in the same commit that starts the exit animation. Opening a session mounted the transcript only after two sequential round trips with no cache.
- **JS-driven loops.** The running pulse used `Animated.loop(sequence)`, which cannot loop on the native driver, so every running dot needed a JS callback every 800 ms and froze whenever the JS thread was busy.
- **Input.** The composer re-rendered the session view on every wrapped line (JS height round trip, applied a frame late) and on keyboard events. Text typed while a send was in flight could be erased when the send cleared the box. A daemon draft restore that arrived after the user focused an empty composer remounted the input, which closes the keyboard.
- **Unstable transcript keys.** Entries without a message ID were keyed by their position in the sliding 35-entry window, so blocks remounted (and collapsed) as output arrived. The key used `entry.seq`, which projected entries do not have.

## 2. Behavior

Nothing the user sees changes, except that it is faster:

- Board, drawer and sessions show the same data. Freshness is at least as good as before: live agent changes arrive through a Paseo subscription within about half a second (updates are batched per 500 ms), and polling only reconciles.
- Opening a card shows its sessions at once (from the board's live agent list). Archived sessions follow from a slower read.
- Opening a session shows the cached transcript at once when it was seen recently. Otherwise the agent and transcript load in parallel.
- Sending clears the composer at once. If the send fails, the text returns: into the empty box, or before anything typed since. The error is shown as before. Text typed while a send is in flight is never erased.
- The keyboard never closes because of background data. An outside change that would replace the text (restore, queued-message edit) never remounts a focused input that the user has typed in.
- On a phone, Back from a card returns to the board with its scroll position, without rebuilding it.

## 3. Changes

### Daemon (no storage migration)

- `board.read-changed` `{ etag? } → { etag, board? }`: the board view with a content hash; the board is omitted when the hash matches. `summaries.read-changed` and `resources.read-changed` do the same. The original RPCs stay for other callers.
- `sessions.tail` `{ taskId, agentId, limit } → { entries }`: a session's projected timeline tail, reduced to what the UI shows (`seqStart`, item type, text, tool name/status, message/call IDs). Text is clipped (agent and user messages at 12 000 characters, reasoning at 2 000). The session must belong to the card's workspace, like `sessions.image`.

### Client data

- One shared query definition per key (`client/queries.ts`). Board, summaries and resources poll with their etag: an unchanged response is tiny and leaves the cached object as it was, so nothing re-renders. The cache holds plain values; the etag is only sent when the cache still holds the value this reader stored (any `setQueryData` forces a full read).
- Live agents (`["ultra","activity"]`): `paseo.agents.list({ subscribe: {} })` with a one-entry page establishes a filter-scoped update stream. Upserts and removals patch the cache, batched per 500 ms. Archived agents and progress summarizers leave the list; an update never replaces a newer snapshot. The full list still reconciles every 20 s, or every 5 s until the stream is ready or after it fails. The subscription is released on unmount.
- Drawer sessions: live sessions come from the shared live agent list, filtered by workspace (`select`, so other workspaces' updates do not re-render the drawer). Archived sessions are read every 30 s, after any session action, and as soon as a session leaves the live list. Workspace availability and task context poll every 10 s instead of 3 s/5 s.
- Session preview: the agent query is keyed by session (shared with other views, normal cache time) and seeded from the live agent list. The transcript query starts in parallel and uses `sessions.tail`. Stream events refresh only the transcript, coalesced at 400 ms. Polling falls back to 15 s while the stream is ready. Tool health and access state are read only while the Kanban tools section is open.
- Card output: the latest-output line uses `sessions.tail` with a short limit, and cached outputs live for 5 minutes.
- Session images: native skips `Image.getSize` (a second decode of the same data URI); `onLoad` reports the size.

### Client rendering

- Memoized components with stable callbacks: task cards, task drawer, transcript (and each entry, markdown block, inline run and activity block). The native composer does not re-render the session per keystroke (it owns its text), so focus, keyboard and draft-report renders now skip the memoized transcript. Board-wide derivations (events by task, agents by workspace, available workspaces) are computed once per data change, and cards read them by lookup.
- The board root receives a theme object whose identity changes only when a color changes. The context-menu opener is stable, so opening a menu does not re-render the board.
- Phone: the board stays mounted under an open card (`display: none`, so it is not focusable or reachable by accessibility). A lane switch still starts its list at the top.
- Transcript keys use `seqStart`, else the message or call ID. The extra scroll-to-end effect before layout is gone; the transcript follows its tail from its own content-size/layout events, so it lands on the new end in one step.
- Native composer grows by itself between its minimum and maximum height (no JS height round trip). Web keeps the measuring mirror. The keyboard hook applies the transcript padding when the keyboard animation finishes, not at its start.

### Motion

- The running pulse is one native-driver timing looped natively (`Animated.loop(timing)`, opacity interpolated 1 → 0.35 → 1), so it never needs the JS thread.
- Cards no longer fade in on every mount; the list's own reveal covers navigation. The status-change flash overlay is mounted only while it is visible.

### Follow-up: open transitions (user report: opening a card or a session still stutters)

The transitions run on the native driver, but they started in the same frame that mounted the whole drawer or session view and fired its reads. One of those reads paged every agent on the host to find archived sessions. On a phone, the UI thread was busy creating views and the JS thread was busy decoding during the slide.

- `useSettled(key)` (`client/motion.tsx`) turns true one frame after the forward transition (220 ms), and at once under Reduce Motion.
- Opening a card shows its header, questions, description, progress and sessions (from the cache) at once. Details, Usage and Activity, and the workspace, context, archived-session, composer and usage reads, start once it has settled. The late sections sit below the sessions and fade in, so nothing above them moves.
- Opening a session shows its header, notices and composer at once. The transcript, its tail read, the model list and the composer state start once it has settled; the transcript fades in.
- `sessions.archived { taskId }`: the daemon returns the card workspace's archived, non-summarizer sessions. The client no longer pages every agent (hundreds of KB) on each open.
- Phone: the open card is an opaque overlay above the board, which stays laid out (covered, not focusable, hidden from accessibility). Opening and Back change no layout underneath. The board no longer replays its own reveal when a card opens or closes.

### Follow-up: sideways drift while scrolling (user report with an Android capture)

The open card's content (its header included) sat offset to the left while the host header did not, i.e. the details view's own reveal transform (it slides from the left) stayed at a stale start value. Two weaknesses in the shared primitives made that possible on Android's new architecture: every render built new interpolation nodes (re-attaching the native graph and committing the JS-side value mid-animation), and nothing forced the end value into the committed props.

- `lerp(value, outputRange)` (`client/motion.tsx`) returns one cached interpolation node per value and range; every plugin animation uses it.
- Shared transitions set their final value from JS when the native animation finishes, and an interrupted reveal resets to its rest value.
- `MotionReveal` no longer animates on first mount (the surrounding card or board already brings it in); only identity changes animate.

### Follow-up: Back from a session left the card half revealed (user report, phone)

Occasionally, after Back from a session, the card details stayed faded and offset while still accepting touches. Two remaining paths could leave a stale value on screen:

- The reveal range was keyed by direction (`[direction * distance, 0]`), and forward/Back flip the direction, so every Back swapped the view's animated props node in the same frame the reverse transition started. On Android's new architecture the old node's detach restores and disconnects values asynchronously, racing the new animation.
- A stopped native animation reports its end asynchronously, and React Native then syncs the JS value to where the native animation stood and commits it, after the reveal had already reset to rest.

`MotionReveal` now animates one signed offset (±1 → 0) through fixed interpolation nodes for both directions, and after every native end, unless a newer reveal is moving, sets the rest value again on both sides and commits it.

### Follow-up: typing on a phone interrupted when a card changes lane (user report, 2026-10-18)

Report: while typing in a card's session on a phone, an agent's stage update (or the status rule after a send) interrupts input. Not reproduced on a device (no phone mirror available); two load sources were found and removed:

- **Session view re-render.** Every board change re-rendered the drawer and, through inline callbacks, the whole `SessionPreview` (transcript, Markdown, composer): a long JS frame mid-typing. `SessionPreview` is now `memo`ized. It compares only the card fields it reads (`samePreviewTask`: id, workspace, archived, title) and this session's latest turn event (`turnEventKey`). The drawer passes stable callbacks (`useStableCallback`). A lane/revision change alone no longer re-renders it. A new turn, a rename or an archive still does.
- **Native session chip poll** (`registerSessionChips`, runs on every client while Paseo's own composer is in use). Every 5 s it re-downloaded the full board, paged every agent on the host including archived ones, and pushed `chip.update` into the host composer even when nothing changed. Now the board is read by etag (`board.read-changed`), only live sessions are listed each round, archived ones are rescanned only when the board changed, a chipped session vanished, or once a minute, and a pill is updated only when its text changed.

Unit: `client/session-chips.test.ts`, `client/session-state.test.ts` (memo keys); session-chip fixture updated to the new reads. Device check: UNRUN.

### Follow-up: phone sluggish again (user report, 2026-10-19: scrolling, animations and taps feel slow; desktop is fine)

Not reproduced on a device (no phone mirror). Three load sources were found by reading the data and the render paths, and removed:

- **The board payload had grown 6×.** `board.read-changed` returns the whole board, and events are append-only: 1 663 events were 684 KB of a 877 KB view (it was 147 KB when the etag read was introduced). Every board change (any agent turn start/end, progress report, status move) re-sent, decrypted and parsed all of it on the phone, then diffed it. `board.read-changed` now accepts `since: { count, lastId }` (the events the caller holds). When the daemon finds that event at exactly that position it returns the board with only the newer events and `delta: true`; any mismatch (a deleted card's events, a trimmed log) falls back to the full board. `readBoardDelta` (`client/queries.ts`) appends them to the cached events, reusing the cached event objects, so react-query's structural sharing is cheap. Measured on this daemon's data: 877 KB → 216 KB for a change of two events. The rest of that was sent whole by this first step; the next paragraph removes it.
- **Item-level patches for the rest of the board** (same day, second step). The daemon (`server/board-delta.ts`, `BoardDeltas`) remembers a fingerprint of each of the last 32 boards it served, keyed by etag: one short hash per item of projects, tasks, ideas, links, artifacts, workpads and attention dismissals (matched by `id`, workpads and dismissals by `taskId`), the plans as a whole, and the event count with the last event ID. A caller that names an etag it holds (the client only sends one while its cache still holds exactly what it stored under it) gets `patch` instead of `value`: the revision, the events after the ones the fingerprint counted, per collection the items that are new or differ (`set`) and the IDs that vanished (`remove`), and an `order` (all IDs) only when appending the new items after the kept ones would not give the real order, plus `plans` when they changed. `applyBoardPatch` (`client/queries.ts`) rebuilds the board; untouched items keep their objects, so structural sharing and memoized cards see no change. Fallbacks, in order: the events-only `since` delta when the etag was never served or was forgotten (restart, eviction, another client's etag), then the full board; also when the events no longer continue the fingerprint's (a deleted card's events). A patch for a board the client no longer holds triggers a full read. Typical size now: the changed items plus new events (a workpad update ≈ 7 KB, a status move ≈ 1–2 KB) instead of 877 KB.
- **Agent churn re-rendered the board twice a second.** A running agent rewrites `updatedAt` (and its turn handle and usage) on every stream event, and the shared live agent list is replaced on each batch. With any agent running on the host, even in another project, every consumer of the whole list (the board root, hence every card derivation) re-rendered about every 500 ms. `applyAgentUpdates` now drops an update of a running agent that differs from the cached one only in `updatedAt`, `activeTurn`, `lastUsage` or `runtimeInfo` (none is read live); any other change, and every settled agent's update, still applies, and the 20 s reconcile brings the dropped fields current.
- **Per-card derivations ran on every board render.** `renderCard` scanned each card's events and sessions (attention summary, questions, wrap-up, workpad signal, output session) on every Board render, so opening a card, a menu or a filter redid it for the whole lane in the frame that starts the transition. The derived props are now cached per task object (`cardDerived`, a `WeakMap` that is replaced when any source changes). `selected`, `flash`, `drag` and `disabled` stay outside it.
- Smaller: the transcript's `onScroll` now fires every 100 ms instead of every frame (it only decides whether to follow the tail); `useSessionReads` returns a stable empty list while loading.

Unit: `client/queries.test.ts` (churn-only updates keep the cached list and anything else applies; delta append and full fallback; a daemon patch applied to the cached board gives exactly the new board, unchanged items keep their objects), `server/etag.test.ts` (events delta, stale prefix, deleted events, unchanged), `server/board-delta.test.ts` (changed/added/removed/reordered items, plans, workpads by task, events that stop continuing, remembered/forgotten etags). The patch was also round-tripped on a copy of this daemon's real board through the RPC output schema. Device check: UNRUN.

### Follow-up: virtualized lane list and a timing log (user: "much better", asked for more)

- **Virtualized lane list (phone).** The compact board rendered every card of the open lane in one `ScrollView`, so a long lane (Done) mounted hundreds of views, animated values and card reads at once, and every later render walked all of them. The list is now the host's `FlatList` (`client/lane-list.tsx`): `initialNumToRender` 8, `maxToRenderPerBatch` 6, `windowSize` 7, cards separated by a spacer (not `gap`, which would also space the virtualization spacers). Only cards near the screen are mounted, so only they run their latest-output read (`sessions.tail`); an unmounted card's cached output stays for 5 minutes, so scrolling back shows it at once. The rows (cards, the "No recent tasks"/empty placeholder with its Add task button, the Show older toggle, the older cards) are one list built by `laneRows` (`client/lane-rows.ts`); `sameRows` hands the list the previous array when no row changed, so a board render that changes nothing here does not touch the list. Switching lane still remounts the list (`key={mobileStatus}`), so it starts at the top; Back from a card keeps the position because the board stays mounted under the card (unchanged). A host without `FlatList` falls back to the previous plain scroll of every row. Desktop columns are unchanged.
- **Timing log (developer switch).** To measure on a device without a profiler: set `{"version":1,"values":{"log":true}}` in `~/.paseo/plugin-settings/flowly/performance.json` on the host (the settings envelope; a bare `{ "log": true }` is ignored) and reload the plugin (no settings page, so no UI text). The board reads that setting; when on, `client/perf.ts` aggregates timings per name and sends them every 10 s through `perf.report`, and the daemon prints one line per report: read them with `paseo plugin logs flowly` while using the phone (`[perf] ios board.render n=12 avg=3.1ms max=9.0ms | …`). When off (default) each call is one boolean check and the daemon ignores reports. Names:
  - `board.render`: from the start of a board render to its commit (the board component plus its subtree's render and commit), one sample per render.
  - `board.read.same|patch|events|full`: the board poll's round trip as the phone sees it (network, relay decryption, parsing), by what came back; `board.apply`: applying a patch or events to the cached board.
  - `drawer.open.mount`: tap on a card to the drawer's first commit; `drawer.open.settled`: tap to the heavy sections starting (after the open transition).
- Unit: `client/lane-rows.test.ts` (row order, placeholder, unique keys, row identity), `client/perf.test.ts` (off means nothing kept, per-name aggregation and 10 s flush, marks and laps, off drops data, report schema and log line), `shared/settings.test.ts` (switch defaults off). Device check of the list (scroll position on Back, no blank cards while scrolling fast, lane switch to top) and the numbers: UNRUN.

### Follow-up: cold start (user: the app reloads the plugin at every launch; start-up speed is how soon the plugin is visible)

How the host loads a plugin (read from its `compiler.js` and renderer): the daemon bundles `index.client.tsx` with esbuild into **one unminified CommonJS file** (no code splitting, `async/await` lowered), sends the text to the app inside the plugin catalog (through the relay's E2EE on a phone), and the app runs `globalThis.eval` on it at every launch and connection. There is no lazy chunk: every byte is transferred, parsed and executed before `contribute()` can register the sidebar item and screens. The cost of a start is therefore bundle size plus whatever the plugin does when it registers.

- **Bundle 2.12 MB → 0.95 MB (−55%).** Measured by compiling `index.client.tsx` with the daemon's own esbuild options. 1.18 MB were the nine UI-language catalogs; every client carried all of them although it shows one (and English needs none). The client bundle now has none: the daemon serves the current language's catalog on demand (`i18n.catalog`), see I18N-SPEC "Delivery". English users download nothing extra; others fetch 78–127 KB after start instead of 1.18 MB inside the bundle. Surfaces wait at most 400 ms for the catalog (`LocaleRoot`), so the plugin is visible as soon as the board can render, English at worst; Command Center titles are rebuilt when the device language's catalog arrives. On V8 the compile step of the bundle fell from 11.5 ms to 7.4 ms; Hermes parses from source and is much slower, so the real gain is larger.
- **Start-up work moved off the first paint.** The Composer-pill (session chip) poll ran its first round at plugin load: a board read plus a list of every live agent plus a scan of every archived agent on the host (hundreds of KB, decoded on the JS thread) while the app was still painting. Its first round now waits 2.5 s (`CHIPS_START_DELAY_MS`); chips appear that much later and are unchanged afterwards.
- **Regression fixed on the way.** The chip poll sends an etag to `board.read-changed`; since the board patches, the daemon answers a remembered etag with a `patch` and no `value`, which the poll ignored, so its board stayed at the first read (new cards or sessions would not get chips until the plugin reloaded). It now reads through `readBoardDelta` like the board screen (`client/board-read.ts`, split out of `queries.ts` so the entry does not import React Query).
- **Timing log.** `plugin.load` (from the first import of the bundle, `client/boot.ts`, to the end of `contribute`: the evaluation cost of the plugin on that device) and `catalog.load` (the catalog request) are measured before the log's setting can be read and reported once when it turns on, with the other names.
- **Not done / ideas:** module-level work in the remaining 0.95 MB (zod schemas, tables) is unmeasured on a device (`plugin.load` will show it); rarely used pages (Insights, Tickets, Settings, onboarding) cannot be split out because the host has no lazy chunks; a minified bundle or UTF-8 output would be a host change (`compiler.js`: no `minify`, esbuild's default ASCII escaping inflates non-Latin text).
- Unit: `client/catalog.test.ts` (language requested once and never for English, retry after failure, every catalog fits the RPC reply, nothing reachable from the entry imports the catalogs), `client/session-chips.test.ts` (patch answers update the chips; first round waits for the start delay), `shared/i18n.test.ts` (catalogs still complete, through `i18n-all`). Device check of start-up time: UNRUN.

### Follow-up: why a board read is full (phone evaluation, 2026-10-21)

The phone evaluation ([report](verification/performance-phone-2026-10-21.md)) saw `board.read.full` about 2.6 s each, 5 times in 4 minutes, although the etag/patch path exists. With the timing log on, a full read now says why:

- Daemon (`BoardDeltas`, `onFull`): one line `[perf] board.read.full reason=<r> events=<n> remembered=<k> [held=<n> heldLastAt=<i>]`. `no-etag` (the caller sent none), `etag-unknown` (never served or forgotten), `events-discontinuous` (a new event is not at the end of the list, so it cannot be appended: should not happen), `no-since`, `since-mismatch`.
- Client (`readBoardDelta`): `board.read.full.<why>` next to `board.read.full`, with `first-read`, `cache-replaced` (another writer touched the cached board), `cache-changed-in-flight`, `patch-without-cache`, `chips-first-read` or `server` (an etag was sent and the daemon still answered in full).

Findings:

- **Root cause: the per-card event cap.** `store.event()` keeps at most 100 events per card; appending one to a card at the cap removes that card's oldest event from the middle of the global list. The list keeps its length (2840 here) but the caller's last event is no longer at its old position, so `diffBoard` returned null and `boardIfChanged`'s `since` check failed: the whole board (all events, about 2.4–3.0 s on the phone) was sent to every client that polled with an older etag. 8 of this board's cards are at the cap (`harness2研究` is in review); one event on any of them triggered it. Logged: `reason=events-discontinuous held=2840 heldLastAt=2837`.
- **Fix: events are matched by id.** The fingerprint remembers the event ids; `diffBoard` sends the events that are new (they are always at the end; if not, no patch) and `removeEvents`, the ids that left; `applyBoardPatch` drops those, then appends. A real-board round trip (a capped card's oldest event dropped, one appended) gives a patch of a few hundred bytes against 880 KB, and the patched board equals the new board. Tests: `server/board-delta.test.ts`, `client/queries.test.ts`.
- **Bug fixed on the way: eviction order.** `BoardDeltas.read` remembered the new board (evicting the oldest, 32 kept) before looking up the caller's etag, so a caller whose etag was the oldest got a full board although it held a valid one. It now looks up first.
- After a plugin reload every client's first read is `no-etag` (the daemon forgot its boards): expected. The first read of an app launch is still a full board (2840 events, about 2.5 s to decode on the phone). Trimming what the first read carries (older events per card) would change what the drawer's Activity shows, so it is a decision, not done here.

### Follow-up: the Task chip's archived scan (phone evaluation, 2026-10-21)

`chips.archived` took 7.3–13.3 s on the phone (avg 8 s, n=4): the scan paged every agent on the host, archived included, and decoded all of it on the JS thread (a round trip of megabytes, after the plugin's first board read). Now `sessions.archived-refs {} → [{ id, workspaceId }]` does the paging on the daemon (locally, cheap) and returns bare ids of archived, non-summarizer sessions in a card's workspace, which is all the chip needs. Measured on the same phone and host: `chips.archived` 0.31–0.46 s (n=4). Unit: `server/archived-sessions.test.ts` (refs), `client/session-chips.test.ts` (fixtures answer the new RPC).

Checked and left as is: `board.read.same` (200–700 ms on the phone, mostly the relay round trip; the response is tiny, so it does not load the JS thread) and `board.render` (about 80 ms per board change, also for a two-card lane). A per-card derivation cache keyed by each card's own events and sessions was tried and reverted: no measurable change, so the cost is elsewhere (candidates: the O(events) passes over the 2840 events per board change, the header counts); it needs a profiler run, not a guess.

## 4. Constraints kept

- No second Paseo connection: the subscription uses the supplied SDK. No new dependency, no DOM, no private host import.
- Fresh authorization before every send is unchanged (`sendCardInstruction` still refreshes the actor and the scoped context first). Ordinary follow-ups send exactly the user's text.
- Reduce Motion, interruptible transitions and cleanup rules from `MOTION-SPEC.md` hold. An inactive drawer or preview still stops its subscriptions and polling.
- `AGENTS.md` records the performance rules for future work (§5).

## 5. Rules for future work (also in AGENTS.md)

- Poll only what is on screen, and only as often as it changes; prefer the SDK subscription, an etag/unchanged response, or a daemon-side slim RPC to re-downloading a large payload.
- List items and panes that receive frequently changing parents are `React.memo` components with stable callbacks (`useStableCallback`) and primitive or identity-stable props.
- Loops and transitions run on the native driver. Do not loop a `sequence`; do not animate layout properties in hot paths.
- Do not unmount and remount large trees for navigation on phones; hide them.

## 6. Acceptance

Results: [verification](verification/performance.md).


- PASS needed: typecheck; focused unit tests for the etag reader (unchanged keeps the cached object, a foreign `setQueryData` forces a full read), live-agent patching (upsert/insert/archive/remove/summarizer filtering), the tail reducer (fields, clipping, key stability) and the send-clear/restore helper; full suite; plugin reload; live RPC check of `board.read-changed` and `sessions.tail` against this daemon.
- UNRUN unless done on a device: perceived smoothness, frame rate, IME and keyboard behavior on real iOS/Android phones and tablets over LAN and relay. Synthetic tests do not prove frame rate.
