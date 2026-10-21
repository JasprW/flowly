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

## UNRUN

- The Insights section, settings group, project switch, Create card prefill and tip in a real desktop or compact window (no UI session was used).
- A scheduled run at the configured hour, and the backfill when the switch is turned on, in the real daemon (covered only by unit tests).
- Codex shell items (no Codex session in the window).
- Luna 6 full-access test session.
