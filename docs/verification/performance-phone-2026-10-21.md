# Phone performance evaluation (2026-10-21)

Card: 手机端性能评测. Spec: [PERFORMANCE-SPEC](../PERFORMANCE-SPEC.md) (device checks were UNRUN until now).

## Setup

- Device: Samsung SM-S911B (Galaxy S23), Android 16, 8 GB RAM, 1080x2340, display up to 120 Hz. Battery 35-38 %, charging, 41-43 C (thermal throttling is possible).
- Host app: Paseo Android 0.12.0 (release build). Host daemon: `bofan-laptop`, reached over the network (board reads 200-300 ms means relay/E2EE or a slow link; not separated).
- Flowly: working tree at `2c69b54` plus uncommitted changes, plugin reloaded before the run. Project Flowly: 62 cards (Blocked 2, Todo 2, Done 59, Cancelled 1).
- Driving: `adb shell input` (the AndroMeld UI channel timed out; the user approved adb). Measures: `dumpsys gfxinfo sh.paseo` (reset per scenario), `am start -W`, and the plugin timing log (`paseo plugin logs flowly`, lines tagged `android`; lines tagged `web` are other clients and were ignored).
- Timing log switch: the file must be the settings envelope `{"version":1,"values":{"log":true}}`. The bare `{ "log": true }` shown in PERFORMANCE-SPEC §3 was ignored (spec corrected in the follow-up). The switch was removed again after the run.
- Caveat: gfxinfo "Janky frames" uses a 8.3 ms deadline at 120 Hz, so it overstates jank; frame-time percentiles and "Slow UI thread" are more reliable. The JS thread is not visible in gfxinfo. Each scenario is a single short run (not repeated enough for statistics).

## Results

| Scenario | Measure | Result |
| --- | --- | --- |
| App cold start | `am start -W` TotalTime to first frame | 708, 585, 486 ms (Paseo shell only; Flowly is not involved) |
| Plugin load | `plugin.load` (bundle eval to end of `contribute`) | 68 ms (n=1, Hermes) |
| Open Flowly from the sidebar | tap to board | board visible within ~3 s (screenshot; not timed more finely); first `board.render` 27 ms |
| Lane switch to Done (59 cards) | gfxinfo / `board.render` | 207 frames, p50 7 ms, p95 19 ms, p99 22 ms, 18 slow UI frames; `board.render` 414 ms once |
| "Show 20 older tasks" | gfxinfo | p99 frame 150 ms (one long frame), 9 slow UI frames |
| Scroll Done lane, 10 fast swipes down (24 cards) | gfxinfo | 708 frames, p50 8 ms, p95 11 ms, p99 12 ms, 4 slow UI frames, 2 missed vsync |
| Scroll back up, 10 fast swipes | gfxinfo | 391 frames, p50 8 ms, p95 11 ms, p99 14 ms, 13 slow UI frames |
| Open card (Blocked lane) | `drawer.open.mount` / `.settled` | 113 ms and 71 ms mount; 384 ms to settled (n=2 / n=1) |
| Open card + Back, 4 rounds | gfxinfo | 124 frames, p50 11 ms, p90 32 ms, p99 61 ms, 32 slow UI frames, 10 missed vsync |
| Open session | screenshot | transcript and composer shown within 4 s (not timed more finely) |
| Type 28 chars in the session composer (adb injection, ~90 ms per char) | gfxinfo and result | no character dropped, keyboard stayed open; 281 frames, p50 5 ms, p99 12 ms, 23 slow UI frames |

Aggregated plugin timing log for the phone (≈4 min of use, 15 reports):

| Name | n | avg | max |
| --- | --- | --- | --- |
| board.read.same | 65 | 269 ms | 994 ms |
| board.read.full | 5 | 2 586 ms | 2 989 ms |
| board.render | 28 | 82 ms | 414 ms |
| chips.round | 27 | 860 ms | 5 817 ms |
| chips.archived | 2 | 8 032 ms | 8 737 ms |
| drawer.open.mount | 2 | 92 ms | 113 ms |
| drawer.open.settled | 1 | 384 ms | 384 ms |
| plugin.load | 1 | 68 ms | 68 ms |

## Findings (ordered by impact)

1. **Full board reads still happen on the phone and cost about 2.6 s each** (5 in ~4 min, up to 3.0 s). **Root cause found in a follow-up run (same day):** the per-card cap of 100 events in `store.event()` removes a card's oldest event from the middle of the global list whenever a card at the cap gets a new event, so the caller's events no longer continue and the daemon sends the whole board (2840 events). 8 cards are at the cap. Reason log: `reason=events-discontinuous held=2840 heldLastAt=2837`. Details and the open decision (send removed event ids in the patch) are in PERFORMANCE-SPEC, "Follow-up: why a board read is full". Also fixed: the daemon could evict the caller's own etag before looking it up.
2. **The session-chip poll is the biggest steady cost.** `chips.round` averages 860 ms (max 5.8 s) and `chips.archived` 8 s (max 8.7 s), about every 5-10 s, on the JS thread, while the phone is in the plugin. Spec §3 says archived sessions are rescanned once a minute or on change; the measured `chips.archived` n=2 in 4 min is consistent, but each rescan is long enough to freeze input if it lands on the JS thread.
3. **Steady polling latency**: `board.read.same` 269 ms average (max 994 ms), 65 reads in 4 min. Every poll is a round trip even when nothing changed.
4. **Interaction smoothness is mixed.** Scrolling a 24-card lane is smooth (p99 12-14 ms). The heavy moments are one-offs: lane switch to the 59-card Done lane (`board.render` 414 ms), "Show older" (150 ms frame), and open/Back of a card (p90 32 ms, p99 61 ms, 10 missed vsync, drawer settled at 384 ms). Typing is fine.
5. **Docs bug** (fixed): PERFORMANCE-SPEC §3 told the developer to write `{ "log": true }` to `performance.json`; the settings store needs `{"version":1,"values":{"log":true}}`. With the bare form nothing is logged and nothing says why.
6. Not covered: relay vs LAN comparison (the link type was not determined), repeated runs, a long-lived running session streaming output, Reduce Motion, tablet. Cold start of the Flowly board itself was only observed, not timed from process start (the board is not the first screen).

## After the fixes (same phone, same host, same day)

| Measure | Before | After |
| --- | --- | --- |
| `chips.archived` (Task chip's archived scan) | 7.3, 12.7, 13.3, 12.1 s (avg 8 s over 4 reports) | 0.34, 0.35, 0.46, 0.31 s |
| `board.read.full` after a board change | 5 in ~4 min, 2.4–3.0 s each | none in 3 observation windows of 3–3.5 min each; a capped card's new event is a patch (real-board round trip: a few hundred bytes against 880 KB) |
| `board.render` | ~80 ms avg per board change | unchanged (~80–95 ms); a per-card cache was tried and reverted |
| `board.read.same` | 269 ms avg | unchanged (200–700 ms; relay round trip) |

Limits: after-numbers are from the board screen sitting open on the Blocked lane, not a repeat of every scenario; the removal path was verified with the real `board.json` offline, not by writing an event to a capped card on the host.

## Cleanup and side effects

- The timing switch file `~/.paseo/plugin-settings/flowly/performance.json` was created for the run and removed afterwards; plugin reloaded.
- A test string was typed in a session composer and cleared; nothing was sent. No cards, sessions or settings were changed on the host.
- Two mis-taps landed on a system update prompt and the Paseo host picker (no choice made, both dismissed with Back).
- Raw timing lines: `/tmp/perfrun/android-perf.txt` (not kept in the repo).
