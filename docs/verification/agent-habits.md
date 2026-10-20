# Agent habits — verification (2026-10-20)

Spec: [WORKFLOW-INSIGHTS-SPEC §12](../WORKFLOW-INSIGHTS-SPEC.md). Card `5aaa5b01`. Implementation session `7664c1eb` (Claude). No Luna 6 test session was used.

## PASS

- `npm run typecheck`: clean. (Midway through, it failed once on `isNoMoves` in `shared/next-moves.test.ts`: another session's test-first work on NEXT-MOVES-SPEC §8, not part of this change. It passed again when that session's code landed.)
- `npm test`: 93 files passed + 13 skipped; 705 tests passed, 65 skipped (the 63 skipped before this change, plus the env-gated frozen-board comparison, plus the Windows/CLI-gated ones it already had).
- New and changed tests:
  - `shared/agent-habits.test.ts` (69): turn boundaries (events inside a turn, late events after `turn_ended`, events with no `turn_started`, a lone `turn_ended`, two sessions, unordered log, events made by rules or people); delivery kinds (delivery > result > question, question out of the rate, silent turns); days (7-day window, last-event day, time zones, old turns); models (stamped model, fallback, unknown, order, `modellessAgents`); `matchPick` (exact, appended after the user's text, whitespace, small edits, no-space text, short prompts, ties, action moves, several messages); `turnPick` (moves open at turn start, none open, the turn's own moves, another session, no message); picked share (index 0, -1, unknown, unanswered, replaced set, Done move with and without a Move to Done suggestion, reply before Done, set booked on the offering turn's day and model); explicit none (last call decides, base only, nothing to pick, old entries); flags (threshold 10, 9, any move, ideas, results, window, order, none is not a miss); `userTexts`; `withMoveDetails`; `flowEntry`.
  - Mutation checks on the counters: each of these broke at least one test and was restored: coverage threshold, question inside the rate, Done without an offer, a lone `turn_ended` reusing the ended turn, no reply link, a none turn flagged as "no next moves".
  - `server/progress-rules.test.ts`: `turn_ended` carries `model` / `pick` only when given.
  - `server/agent-model.test.ts` (3): `modelId`, `sessionModel` (fallback provider, failure, missing snapshot, slow answer returns in time).
  - `server/insights.test.ts`: `project()` carries `habits`, validated against `insightsWithHabitsSchema`; unstamped turns take the session's current model from the agent list; the flow log keeps `offered` but not the suggestion text.
  - i18n: 12 new strings in all 9 catalogs (`shared/i18n.test.ts` passes).
- `paseo plugin reload flowly`: running, store ready, no errors in `paseo plugin logs flowly`.
- **Counters against an independent hand count of a frozen copy** (flow log `e0da44f0…`, board `ebefbea1…`, frozen 2026-10-20T02:48:05Z, project Flowly). `handcount.mjs` imports nothing from the plugin and is a second implementation of the same definitions; `compare.test.ts` checks, per day, the 7-day total, the model group and the session flags. It passed for: 2026-10-20 / Asia/Shanghai, 2026-10-20 / UTC, 2026-10-19 / Asia/Shanghai, 2026-10-17 / America/Los_Angeles, 2026-10-20 / Pacific/Kiritimati. A first run on the 16th differed (25 vs 30 deliveries) because the hand count then read `board.json`, which keeps only the last 100 events per card; pointing it at the flow log fixed the source, not the counters.

  | Day (UTC+8) | Deliveries | Results | Questions | Delivery/result turns with next moves | Rate | Ideas | `next_moves_suggested` events | `idea_proposed` events |
  |---|---|---|---|---|---|---|---|---|
  | 10-14 | 1 | 0 | 0 | 0 | 0% | 0 | 0 | 0 |
  | 10-15 | 41 | 1 | 16 | 0 | 0% | 0 | 0 | 0 |
  | 10-16 | 30 | 0 | 9 | 0 | 0% | 10 | 0 | 10 |
  | 10-17 | 0 | 0 | 0 | 0 | – | 0 | 0 | 0 |
  | 10-18 | 1 | 0 | 1 | 0 | 0% | 0 | 0 | 0 |
  | **10-19** | 74 | 3 | 7 | **47** | **61%** | 7 | **57** | 7 |
  | **10-20** (to 10:48) | 12 | 0 | 2 | **1** | **8%** | 4 | **5** | 4 |

  Window total (10-14 … 10-20): 159 deliveries, 4 results, 35 questions, 48 delivery/result turns with next moves, 61 turns with next moves of any kind, 21 ideas. Sessions with at least 10 deliveries: `82ea8335` 25 deliveries / 14 with next moves / 3 ideas; `9089937d` 12 / 2 / 0; `f254ca79` 10 / 0 / 0. So `f254ca79` is flagged for "no next moves" and "no ideas", `9089937d` for "no ideas".
- **Second freeze, with live data** (2026-10-20T07:45:43Z, 1814 flow lines; the first freeze in `/tmp` was gone by then). Same five day/zone combinations pass, now including per-model grouping and the live `pick` values. Two earlier attempts on this data failed, and both were the fixtures, not the counters: `handcount.mjs` still ignored `pick` (it only knew Done outcomes), and `compare.test.ts` still assumed one model group. Both now read `pick` and group by the stamped `model` (unstamped turns as "history"). Result on 2026-10-20 (Asia/Shanghai): 26 deliveries, 8 with next moves, 7 with an explicit none, 12 turns with next moves of any kind, 5 ideas, 7 suggestion sets answered with a known outcome, 5 taken.
- Picked, history: 4 sets answered, 4 picked, all of them "Move to Done" suggestions followed by the card going to Done. Message picks cannot be counted for history because no `pick` was recorded before this change.

### The card's example numbers

The card gives 10-19 as 65 next moves / 11 ideas and 10-20 as 1 / 0. They do not match what the data says today, and my evaluation of them was partly wrong:

- **65** is the number of `next_moves_suggested` events still in `board.json`. The board keeps only the last 100 events per card (`BoardStore.event`), so it undercounts. My first evaluation read `board.json` too and reported 63 for 10-19; that was wrong for the same reason. The flow log, which is never trimmed, has **79** on 10-19 across all four projects and **57** in the Flowly project (in 56 turns, 47 of them delivery/result turns).
- **11** ideas on 10-19 is the all-projects count in the flow logs (Flowly alone: 7). `board.json` still holds 10 `idea_proposed` events for that day, and the 11th idea's event was trimmed away; `board.ideas` lists all 11 created that day.
- **1 / 0** on 10-20 was true earlier that morning. By 10:48 the session that wrote the card had made more calls: 5 events and 4 ideas.

## UNRUN

- The Agent habits block in a real desktop or compact window. This session has no window-control tool, the daemon serves no web client, and the plugin has no CLI to call an RPC, so the layout, the warning colour, the flag rows and the day cells were only type-checked and covered by the service test that validates the RPC answer against its schema.
- A real explicit `none` (`nextMoves: []`): NEXT-MOVES-SPEC §8 is another session's unfinished design, so no such events exist yet. The counters are covered by unit tests with `offered: 0`.
- A live `-1` (a reply that matches no suggestion) and a live edited pick.
- Luna 6 full-access test session.

## Live stamp

The first `agent.turn_ended` after the 02:55:38Z reload was this session's own, at 2026-10-20T02:59:23.856Z (card `5aaa5b01`, session `7664c1eb`). It carries `model: "claude/claude-sonnet-5-5"` and `pick: 0`. The user's message that started the turn was the exact prompt of the first suggestion (`next_moves_suggested` at 02:35:02Z), so the hook found the suggestions that were open when the turn began, matched the message to index 0 and read the session's model from its snapshot. The same fields are in the project's flow log entry for that event.

Two more live events from the same session, both `pick: 1` with the exact prompt of the second suggestion: 03:09:14Z (the commit request) and 03:21:07Z (the request to commit section 12 of the spec; that turn lasted 1.7 s and did no work, so rule A1r put the card back). Still covered by unit tests only: a reply that matches nothing (`-1`) and an edited pick.
