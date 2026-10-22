# Project memory acceptance

- Date: 2026-10-22 (Asia/Singapore)
- Test session: `014fabc7-1971-41a1-8f2b-293513ca0e4b` — `codex/gpt-6-luna`, full-access
- Build: `1dfe946` with uncommitted working tree
- Plugin `flowly` was already installed and reloaded by the parent session. This test did not reinstall, reload, or restart Paseo.
- Fixture: Tinylink project `3db2ad5b-e6c4-4054-b2ed-a13a8dfa0663`.

## Acceptance results

The two criteria from §15, verbatim:

1. **PASS** — “在卡 A 中确认的一条决策，在之后新建的卡 B 的 session 初始指令中出现”. Card A proposed the 7-character base62 decision; I confirmed it with an edited body before creating B. B's prepared instructions contained the confirmed decision, and its Luna session quoted it. Both `flowly_get_task` and `flowly_recall("short code length")` returned that same entry. See [instructions-b.txt](project-memory/instructions-b.txt), [card-b-answer.txt](project-memory/card-b-answer.txt), and [agent-tool-results.json](project-memory/agent-tool-results.json).
2. **PASS** — “记忆可在 UI 中修改和删除”. In the Memory page, I edited the confirmed entry title to `Short code length is 7 base62 characters`, saved it, and verified the new title through `memory.read` and a fresh `tools.prepare-session` for B. I then deleted the entry in the UI and verified that `memory.read` no longer contained it and a fresh B context no longer contained that title. See [UI delete evidence](project-memory/ui-delete-evidence.json), [edited context excerpt](project-memory/instructions-after-ui-edit.txt), and the desktop/compact screenshots below.

### Check results

| Check | Result | Evidence |
|---|---|---|
| Card A `flowly_remember` creates a candidate with `source.by=agent`, `source.taskId=A`, a `memory_proposed` card event, and `memoryId` in the session tool result | **PASS** | Candidate `5b136f23-729b-4d2b-abe4-553ca6de5c31`; event `9cd07226-0b90-477a-92cb-022d545b8f86`; [RPC acceptance](project-memory/rpc-acceptance.json), [tool results](project-memory/agent-tool-results.json) |
| Fake-token body is rejected | **PASS** | Tool result code `MEMORY_SECRET`; the token itself is not included in saved evidence. |
| Repeating the exact successful title is rejected | **PASS** | Tool result code `MEMORY_DUPLICATE`. |
| Human confirmation accepts the edited candidate; B context and B tools receive it | **PASS** | B's initial instruction excerpt and tool outputs above. |
| Memory page desktop screenshot | **PASS** | [Desktop, candidate and confirmed entry](project-memory/memory-desktop-initial.png); [after edit](project-memory/memory-desktop-edited.png). |
| Memory page compact screenshot | **PASS** | [420×860 compact view after edit](project-memory/memory-compact-edited.png). |
| Card A drawer screenshot | **PASS, partial view** | [Card drawer](project-memory/memory-card-a-drawer.png). The captured viewport shows Progress, Sessions, and the start of Workpad; the Memory section was below the visible area, so a separate Memory-section drawer screenshot is **UNRUN**. |
| Move A to Done and automatic review | **PASS** | Review completed in about 45 seconds; generated one `source.by=retro` candidate with evidence quoting the user's decision; `errors=[]`, `running=[]`. See [automatic review](project-memory/retro-auto.json). |
| Review agent archived | **PASS** (superseded: review sessions are now hard-deleted, see the last section) | Both review agents (automatic and manual) are archived. See [Paseo registry verification](project-memory/registry-verification.json). |
| Call `memory.retro({taskId:A})` once more | **PASS** | Returned `queued: true`; produced no additional candidate beyond the existing review result. That candidate and the extra agent candidate were dismissed. See [manual review](project-memory/retro-manual.json). |
| `memory.counts` while a candidate waits, and zero after review cleanup | **PASS** | Tinylink showed 1 waiting candidate before confirmation; after retro candidates were dismissed, Tinylink count was 0. Other project's count remained 5. See [RPC acceptance](project-memory/rpc-acceptance.json) and [cleanup verification](project-memory/cleanup-verification.json). |
| Cleanup and preservation | **PASS** | Both test cards deleted with `archive:true`; no test-owned memory entries remain; original six Tinylink cards match their pre-cleanup status, revision, and workspace IDs; other project count remains 5. No test workspace remains in the active Paseo registry. See [cleanup](project-memory/cleanup-verification.json) and [registry](project-memory/registry-verification.json). |
| `npm run typecheck` | **PASS** | Exit 0. |
| `npm test` | **PASS** | 112 test files passed, 13 skipped; 903 tests passed, 65 skipped. |

## Created IDs

- Cards: A `5fe28d64-e35f-4889-b80b-4f3f666803a9`; B `f55e2130-1c36-4dbf-970e-6e992b22076d`.
- Workspaces: A `wks_b9ae1c679c9fb0a1`; B `wks_07f08a12213c702b`.
- Card sessions: A `1b78f53e-8356-4317-92b6-7bf7a39f8d12`; B `33790375-f125-4039-b7a1-b4c8f34b1f4b`.
- Summary sessions created by the test turns: A `1496ef7b-404e-4af2-a4fa-3d4912688a29`, `d90a0660-798a-4666-8af4-aa9412e2662b`, `a3f2c784-b57e-4dd4-aad1-690096876ea8`; B `bf519a61-e9c5-438b-8a4c-940c1d7e2d12`.
- Review sessions: automatic `92a63fed-fad3-4bed-b373-ab8d3a25a029`; manual `16bd40b5-083f-47fc-ace4-f21bf0d8c173`.
- Memory entries: confirmed then UI-deleted `5b136f23-729b-4d2b-abe4-553ca6de5c31`; extra agent candidate `e4adacaf-5e58-4259-91e4-e5e34a5eb3fd`; retro candidate `8afbf7af-fffb-4999-af19-8bdea9c58586`. Candidates were dismissed as required and then removed with their source cards; the confirmed entry was deleted through the UI.
- Proposal event: `9cd07226-0b90-477a-92cb-022d545b8f86` (`memory_proposed`).

## Problems and surprises

- The Luna session for A followed Flowly's required card-setup instructions and additionally set type `research`, added tag `api`, and wrote a workpad, despite the test prompt asking it to avoid those changes. These were confined to the disposable card and removed during cleanup.
- In its first follow-up, the agent generated a different English title instead of reusing the successful Chinese title, so that call created a second candidate rather than testing duplication. I then sent a follow-up with the exact existing title; it correctly returned `MEMORY_DUPLICATE`. The extra candidate was dismissed and cleaned up.
- The first Playwright attempt used the stale cache path referenced by `docs/promo/shots.mjs`, and the current package expected Chromium 1248 while only Chromium 1243 was installed. Reusing the existing 1243 headless shell worked; no browser was downloaded. Compact navigation required opening the mobile menu and selecting Tinylink from the project selector.
- The confirmed entry's title edit and deletion worked through the UI, including fresh-session-context checks. No UI write needed an RPC fallback.

## Post-run edits by the implementation session

- The three desktop screenshots were cropped to the plugin area (left 320 px removed) and the host-sidebar text was removed from `memory-desktop-initial.txt`: the raw captures showed the user's personal Paseo workspaces, which evidence must not expose (same rule as `docs/promo/shots.mjs`). No test result changed.
- The test session `014fabc7` was archived after it finished.

## Cleanup verification

The final board contains exactly Tinylink's six original cards; their status, revision, and workspace IDs are unchanged. The two test cards and all test-owned memory entries are gone. Card, summary, and review agents created by this test are archived; the two test card workspaces are absent from the active Paseo workspace list. Tinylink has zero waiting candidates and zero test-owned memory entries. The other project's candidate count is still 5. The temporary helper directory `/tmp/flowly-memory-e2e-20261022` was removed after evidence was written.

## Native question answers become clues (2026-10-22)

Script: [`fixtures/memory-answer-clue/run.mjs`](fixtures/memory-answer-clue/run.mjs) (based on `fixtures/native-question/run.mjs`), raw output: `fixtures/memory-answer-clue/evidence.json`. Run by the implementation session `787f42ac` after the clue capture for native question tools was added (spec §4.0); plugin reloaded from the working tree first.

| Check | Result |
|---|---|
| A Claude session (`claude/claude-sonnet-5-5`, `bypassPermissions`, created like the card's New session) on a temporary Tinylink card asks through AskUserQuestion | PASS: card `afcd63f5`, session `8ed4c521`; one pending `kind: "question"` request with two questions ("Code length", "Alphabet") |
| Answered the way the card drawer answers (`respondToPermission` with `{ behavior: "allow", updatedInput: { ...input, answers } }`, keyed by header) | PASS: "6 characters", "base62"; the turn continued and ended once (1 turn_started, 1 turn_ended) |
| After the turn, `memory.json` holds `answer` clues with `ask` | PASS: two clues, `ask` = each question, `text` = the chosen option, ids `<agentId>:<toolu id>:<n>`; plus a `message` clue for the opening "Work on this card." |
| Cleanup | PASS: `tasks.delete` with archive (backup in `removed/`), session archived, workspace gone, the card's clues removed (0 left); the session's own `flowly_remember` candidate went with the card; Tinylink back to its 6 cards with no memory entries |

Observation: unprompted, the session also proposed the decision with `flowly_remember` ("短码默认格式：6 位 base62") after reporting the result, as the skill rule asks.

## Review session is hard-deleted (2026-10-22)

Script: [`fixtures/memory-retro-delete/run.mjs`](fixtures/memory-retro-delete/run.mjs), raw output: `fixtures/memory-retro-delete/evidence.json`. Run by the implementation session `787f42ac` after `server/memory.ts` switched from `agent.archive()` to `daemonRemoveAgent` (spec §4.2, AGENTS.md exception). Registry baseline `paseo ls -a --json`: 1473 sessions.

| Check | Result |
|---|---|
| A Haiku session (`claude/claude-haiku-5-5`, `bypassPermissions`) on a temporary Tinylink card leaves material for the review | PASS: card `f74aeaad`, session `6cb262be`; one `message` clue after its turn |
| Card moved to Done, **Find memories** (`memory.retro`) queued | PASS: `queued: true` |
| The review session exists while it runs | PASS: `12833246` seen `running` through `fetchAgents({ includeArchived: true, labels: { flowly-memory: retro, flowly-task } })` |
| After the run it is gone, archive included | PASS: the same query returns nothing within 1 s of the retro being recorded; `paseo ls -a` has no `12833246`; no `could not delete` line in `paseo plugin logs flowly` |
| The automatic review on entering Done (30 s later) skips: same material | PASS: still 1 retro record, no second review session after 40 s |
| Cleanup | PASS: the review's 2 candidates deleted, `tasks.delete` (backup in `removed/`; auto wrap-up had already archived the session and removed the workspace), worker `6cb262be` hard-deleted with `paseo delete`; clues 0, entries 0, Tinylink back to 6 cards, registry back to 1473 |

Unrun: the archive fallback when the delete fails (covered by `server/summarizer-remove.ts` tests, not injected live).

## Tighter finished-card review: replay on real cards (2026-10-22)

After the user reported too many card-specific candidates. Before: the first 5 reviews on the Flowly project produced 9 candidates; of the 7 the user decided, 1 was kept. The review prompt was rebuilt for each of those 5 cards from the stored material (board, summaries, clues; read-only), with every memory entry that came from the replayed card hidden, and run with `claude -p --model claude-haiku-5-5 --tools ""` (the same model as the Summary setting; not through the plugin, nothing written to `memory.json`). Prompts stayed in `/tmp` because they contain card text.

| Card | Old review (kept / dismissed / waiting) | Step 1: one at most + `reuse` + dismissed/waiting lists | Step 2: + `AGENTS.md`/`CLAUDE.md` | Step 3: + "same problem in other words counts as existing" |
|---|---|---|---|---|
| `1808efce` shortcut help title not translated | 1 kept (`msg()` pitfall) | 0 | 0 | 0 (3 runs) |
| `efeb2924` portable screenshot script | 0 | 1: screenshots must hide the host sidebar | 0 (now an `AGENTS.md` rule) | — |
| `14a6bba4` bindings of deleted cards | 2 dismissed | 0 | 0 | — |
| `36b030f2` phone attention would not open | 1 dismissed, 1 waiting | 0 | 1: reworded copy of the active "two Modals in one frame" entry | 0 (3 runs) |
| `c94f501a` summary/insight child sessions pile up | 1 dismissed, 1 waiting | 1: archive() leaves sessions behind | 0 (now an `AGENTS.md` exception) | — |
| **Total** | **9** | **2** | **1** | **0** |

The kept `msg()` entry is no longer suggested because `AGENTS.md` already says "mark module-level tables with `msg()`". Not shown by this replay: whether the stricter bar now misses a truly general lesson on future cards; judge after some use.

