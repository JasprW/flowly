# Workflow insights — verification (2026-10-19)

Spec: [WORKFLOW-INSIGHTS-SPEC](../WORKFLOW-INSIGHTS-SPEC.md). Card `3df1723e`. Implementation session `132ad340` (Claude). No Luna 6 test session yet.

## PASS

- `npm run typecheck`.
- `npm test`: 81 files, 567 passed, 63 skipped. New tests:
  - `shared/workflow-insights.test.ts` (23): splitting, classifying and normalizing commands, redaction, records, lane replay, scheduling (run hour, interval, time zone, collapsed missed runs, daily once a day), quiet skip, aggregation, round-robin samples, material budget, lenient parsing, validation (unknown or ambiguous cards, under 2 cards, over-long fields, repeats, dismissed cooldown, at most 8), trimming, settings defaults, paseo.json scripts.
  - `server/workflow-insights.test.ts` (10): the command log (dedup, 30-day prune, card delete, project remove, purge, late append for a deleted card); a turn recorded only when on, never for summarizers or excluded projects; backfill (two workers, cutoff); a manual run (labels, archive, usage, no repeat); the JSON retry and then an error; an unavailable configured model with no fallback; scheduled runs skipping quiet periods and waiting on an empty log; Run now on an empty log backfilling first; dismiss/restore with revision; accept through `tasks.create` with `insightFindingId`, refused once accepted; a deleted card cleared; project remove backup.
  - `server/agent-service.test.ts`: `get_task` lists paseo.json scripts by name and type only.
  - `client/onboarding-logic.test.ts`: tip order (after `first-idea`, before `first-artifact`).
  - i18n: 56 new strings in all 9 catalogs.
- Plugin reloaded (`paseo plugin reload flowly`): running, no errors in `paseo plugin logs flowly`.
- **Live Run now on the Flowly project** through the plugin RPCs (`workflow-insights.run` / `.get`).
  - The global switch stayed off. `model` was set to `claude/claude-sonnet-5` for the run and then restored to `""`; the settings read back identical to before.
  - The empty log was backfilled from 7 days of sessions: 5143 shell calls (44 sessions, 37 cards, 4319 action segments, 1607 inline excerpts, 145 failed).
  - Redaction check on the written log: 0 `ghp_`, 0 JWT, 0 e-mail, 0 `Bearer <token>`, 0 `/Users/bofan`. The 141 `sk-` hits are words like `task-id`, with no real key shape. A first version replaced long slash-separated paths with `<secret>`; fixed, see the regression test.
  - Run: 240 s, status ok, model `claude/claude-sonnet-5`, $0.63, 151k context tokens, 21k output tokens. The JSON parsed on the first reply, with no retry. 7 validated suggestions (open):
    1. repo_tool, high: a `scripts/patch.mjs` edit helper. Assert-and-replace inline scripts appear 1148×, across 34 cards.
    2. repo_tool, high: an i18n helper that adds a key to all 9 catalogs (6 cards).
    3. paseo_script, high: a `check` script, `npm run typecheck && npm test` (typecheck→test in 36 sessions).
    4. repo_tool, medium: a shared local DaemonClient connect helper (5 cards).
    5. repo_tool, medium: a board.json query script (4 cards).
    6. skill, medium: a test-fixture lifecycle checklist (4 cards).
    7. repo_tool, low: a Paseo.app asar dump helper (3 cards).
  - Compared with the 2026-10-19 probe (6 findings), 4 are the same: i18n, verify/check, board inspector, fixture checklist. **The Playwright dependency suggestion did not come back** this run, so the spec §10 bar ("at least i18n and Playwright") is only half met. The run instead found the generic patch helper, the DaemonClient helper and the asar dumper. The model output varies from run to run.
  - Temporary session `649d313d` was archived by the plugin (2026-10-19T08:24:27Z), then deleted by this test. `paseo ls -a` shows no session with the `ultra-kanban-insight` label.
  - The 7 suggestions and the Flowly command log stay in the user's data, as the result of this run. They can be dismissed in Insights, and the log removed with *Delete collected commands*.

## 2026-10-21: repeats, quiet rule, cost estimate

Review of the scheduled runs on 10-20 and 10-21 (read only):
- 25 open suggestions, about half restating earlier ones in other words or another language. The verify/check script, the board inspector and the DaemonClient helper came back 3 times each. Fingerprints did not catch them: the titles of the two board-inspector suggestions score only 0.13 on lexical similarity.
- Agent SMITH (990 actions, 2 cards) was skipped every time by the 3-card quiet rule.
- The monthly estimate took a single run of one project, so with two projects analyzed daily it was about half the real figure.

Fix (spec §4.1, §4.3–§4.4, §5.1–§5.3, §2.3, §11):
- The model refers to existing suggestions by short id: `updates` refreshes one, `merges` folds duplicate open ones into a kept one.
- The daemon fallback is a lexical similarity check. Its thresholds were calibrated on the real titles: the clear rewordings score 0.64 and 0.67. A pair that shares only generic words ("alpha helper tool" / "bravo helper tool", 0.5) is not merged.
- Quiet rule: under 2 cards still runs once there are at least 200 new actions.
- Cycle cost: sum of the latest costed run per included project, last 30 days.

PASS (on the PR branch tree):
- `npm run typecheck`.
- `npm test`: 839 passed, 65 skipped.
- New tests:
  - `shared/workflow-insights.test.ts` (30): the quiet thresholds; the material line format; parsing `updates`/`merges`; refreshing via `updates` but not accepted or dismissed suggestions; an unknown id treated as new; CJK and English similarity with negative cases; dedupe within a run; merge validation; `applyReconciled`.
  - `server/workflow-insights.test.ts` (13): a later run refreshing and merging (seen 4, refreshed 1, merged 1, no "No suggestions" reason); the overview cycle cost over included projects only; a busy 2-card project analyzed on schedule.
- i18n: 3 new strings in all 9 catalogs, 1 removed.

UNRUN:
- The merge of the existing repeats on real data. It happens on the next model run after PR #8 is installed.
- "Seen in N runs" and the per-project cost line in a real window.

### 2026-10-21: after merging PR #8 (e9dd8f1)

- PR #8 squash-merged as `e9dd8f1`; local main reset to it (mixed), with the PR diff 3-way merged into the shared working tree first. typecheck PASS; `npm test` 850 passed, 65 skipped (the working tree, including other sessions' uncommitted work). `paseo plugin reload flowly`: running, no errors. Before the reload the running plugin did not contribute `workflow-insights.*` at all, because another session had reloaded it from a tree without that code.
- Run now on Flowly through `workflow-insights.run` (`claude/claude-sonnet-5-5`): status ok, about 50 s, **$0.49**, 129k context tokens, 4.3k output tokens. Window: 7812 calls, 7603 actions, 56 cards, 72 sessions.
- Counts reported by the run: **2 added, 5 refreshed, 13 merged**. Open suggestions went from **22 to 11**.
  - The 13 merged ones were all real repeats, folded into 5 kept ones:
    - the patch/i18n CLI, now seen 5×, on 18 cards;
    - the board.json inspector, 4×;
    - the AGENTS.md rule, 3×;
    - the feature-delivery checklist, 3×;
    - the fixture checklist, 2×.
  - The DaemonClient/Playwright harness (4×) and `verify` (3×) suggestions had already absorbed their earlier repeats.
  - No merge joined two different things.
  - The asar dump helper was refreshed (seen 2×, cards 3→5).
- **Both new suggestions are repeats** that slipped through:
  - "改完代码的收尾:check 与 reload 合并" repeats the open `verify` suggestion. Title similarity 0.00.
  - "追加 docs/PROGRESS.md 和 SPEC-OUTLINE.md 条目的脚本" repeats the open "文档追加脚本" suggestion. Title similarity 0.40.
  - The model did not mark either with `updates`, and both scores are below the fallback thresholds. The next run can merge them (`merges` between open ones), or they can be dismissed.
- Overview: `cycleCostUsd` 0.95 over 2 projects (Flowly 0.49, Search System 0.46), i.e. about $28.5 per month at daily runs.
- The temporary session `9619e547` ("Flowly workflow insights · Flowly") is archived.

### 2026-10-21: new suggestions must state how they differ

The fix for the 2 repeats above, on branch `fix/workflow-insights-nearest`:
- When existing suggestions are listed, every finding without `updates` must give `nearest` (the closest listed suggestion) and `difference` (what it covers that `nearest` does not). The prompt says that a narrower, broader or combined version of a listed suggestion is an update, not a difference.
- `nearest` without a `difference` refreshes `nearest`. A finding with neither is dropped. With no suggestions listed, nothing is required.
- Spec §4.3, §4.4, §5.3 and §10 are updated.

PASS:
- `npm run typecheck`.
- `npm test` (the branch tree): 853 passed, 65 skipped.
- New tests in `shared/workflow-insights.test.ts`, built on the two missed pairs:
  - both pairs stay below the similarity fallback;
  - without a difference both are dropped;
  - with only `nearest` both refresh the existing suggestion;
  - a stated difference adds a new one;
  - with no suggestions listed, or only one dismissed past its cooldown, no difference is needed.
- Parsing reads `nearest` and `difference`.

UNRUN: a live run with this change. The installed plugin runs the main tree, which does not have it until the PR is merged.

## UNRUN

- The Insights section, settings group, project switch, Create card prefill and tip in a real desktop or compact window (no UI session was used).
- A scheduled run at the configured hour, and the backfill when the switch is turned on, in the real daemon (covered only by unit tests).
- Codex shell items (no Codex session in the window).
- Luna 6 full-access test session.
