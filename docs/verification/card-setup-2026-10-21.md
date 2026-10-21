# Flowly card setup: live agent verification (2026-10-21)

Spec: [CARD-SETUP-SPEC.md](../CARD-SETUP-SPEC.md), especially §§3 and 5. The plugin was already reloaded from this working tree; I did not reinstall it.

## Build and fixture

- Build under test: Flowly repo `HEAD b79482eb431092a3b0d85f6e5f97e4a612977e6b`, dirty working tree.
- Test-session agent: `2574a944-3fa0-4904-b2f1-1c676363d590` (`PASEO_AGENT_ID`, read from this process environment).
- Fixture: permanent Tinylink project `3db2ad5b-e6c4-4054-b2ed-a13a8dfa0663`; root repo `/Users/bofan.wang/Developer/personal/flowly-test/tinylink`.
- Before creating fixtures, recorded the six cards with their ids/status/revisions, five active native workspaces, and repo `HEAD 47899f7286df26700d4235800825b2ecbcee12bb` with clean status in [baseline.json](card-setup/baseline.json).
- The root repo has the expired-link bug in `src/server.js`; both subjects used separate Flowly-managed worktrees branched from `refs/heads/main`. The test did not change the Tinylink root checkout.
- Provider/model availability was checked before creation. S1 was created as `claude/claude-sonnet-5-5`, `medium`, `bypassPermissions`; S2 as `codex/gpt-6-luna`, `medium`, `full-access` at creation. Both used the current UI path: `tools.prepare-session` instructions as `systemPrompt`, Flowly MCP server `flowly`, label `flowly-task`, and `FLOWLY_CONTEXT_FILE` / `FLOWLY_CLI` / `FLOWLY_SKILL` environment variables.
- Both cards had the same title, `Handle expired links without crashing`, and empty description with no type or tags. Both received exactly this first user message: “Please fix expired-link requests so they return a proper HTTP error instead of crashing the server, and add a regression test.”

## Results

| Subject | First instructions | Setup and stage order | Outcome and final card state before cleanup |
| --- | --- | --- | --- |
| **S1 — Sonnet** · session `13a87fc6-eb96-41ef-b42e-9e04f264c265`; card `5763b446-622c-4f9f-adc7-a6bf18cde9ef` | Included `Card setup missing: type, tags, workpad.` | Set type at 05:24:06, tags at 05:24:11, and created the first workpad at 05:24:17.761. Its first file write was `test/expired.test.js` at 05:24:22.269, so all three setup fields existed before file changes. A later workpad update marked 3/3 acceptance items and 1/1 check complete at 05:24:33.736. **It never moved to Development**; it went from Todo directly to In review at 05:24:41.218. | Reported `npm test`: 14 passed. Changed `src/server.js` and added `test/expired.test.js` in its worktree. Final: `bugfix`; tags `redirect`, `api`; workpad 3/3 acceptance and 1/1 check; `in_review`. |
| **S2 — Luna** · session `b8070701-e025-47c1-bcb7-272393000297`; card `87a05c32-b3f9-42f1-83f3-52d84863e68d` | Included `Card setup missing: type, tags, workpad.` | Set type at 05:24:18, tags at 05:24:22, and first workpad at 05:24:31.609, before its Todo → Design move at 05:24:46.638 and Design → Development at 05:25:21.996. The activity sequence shows its first file edit after the Development move. The workpad was later updated before Development and completed after verification. | Reported `npm test`: 14 passed, plus `git diff --check`. Changed `README.md`, `src/server.js`, and `test/stats.test.js` in its worktree. Final: `bugfix`; tags `api`, `redirect`; workpad 2/2 acceptance and 1/1 check; `test`. It did not move to In review because the repo has no Git remote; it recorded that the changes remained uncommitted. |

The exact prepared-instruction lines and reminder quotes are in [reminder-quotes.json](card-setup/reminder-quotes.json); the ordered card event/workpad snapshots are in [events.json](card-setup/events.json), and the sanitized session/order observations are in [session-observations.json](card-setup/session-observations.json).

## Reminder behavior and delivery gate

- Both first instruction contexts contained the missing-setup line with all three items.
- Both subjects acted on the setup reminders. After `flowly_set_type`, each received the reminder to set tags and workpad; each then set tags. After `flowly_set_tags`, each received the remaining workpad reminder and wrote a workpad. Once workpad content existed, no further setup reminder was recorded.
- S1’s In review status result carried the separate ideas reminder (“You have proposed no ideas…”); it suggested next moves and ended without proposing an idea. This was not a setup reminder.
- No `SETUP_INCOMPLETE` or `WORKPAD_OPEN` refusal occurred. Neither subject needed the neutral follow-up because neither ended with setup missing. S1 delivered after setup was complete; S2 stayed in Test. Thus this run confirms the reminder-to-action path, while a live refusal for a still-incomplete card was **not exercised**.
- S1’s first workpad event already contained acceptance and validation entries, though all were unchecked; the next update marked them complete after testing. S2 likewise created acceptance/check entries before implementation and later recorded `npm test` as passed.
- The actual installed skill file starts with `# Flowly`, followed by `## Start of every turn` as its first subsection. The prepared instructions point the subjects to that section.

## Incidents and coverage limits

- S1 skipped the Development stage entirely and went from Todo to In review. Setup was already present before its first file write, but stage discipline was weaker than the spec’s intended loop.
- S2 used a correct final `npm test` workpad command even though its early activity summary initially described the check as `go test ./...`; its saved final workpad says `npm test` and passed.
- Flowly created two internal Haiku summary sessions after the subjects’ turns. They were already closed (mode `default`), not active child work sessions created by either subject. No running child remained; the task workspaces were archived.
- I did not run a second copy of either agent’s tests. Their test outcomes above are the sessions’ own reports. Desktop/compact UI checks were not run; the requested acceptance was the real agent/tool flow.

## Cleanup and verification

- `tasks.delete-check` reported no blockers. It warned that the test-owned worktree changes would be lost (2 changes for S1, 3 for S2); I acknowledged those warnings and deleted both cards with `archive: true`.
- The delete call archived each card’s workspace and one subject session. S2 was still listed as idle afterward, so I explicitly archived it; both subject sessions now report closed with no active turn.
- Both temporary worktree directories and their test-created branches were removed. Cleanup receipts and preflight are in [cleanup.json](card-setup/cleanup.json) and [preflight.json](card-setup/preflight.json).
- Verified the plugin board is back to Tinylink’s six original cards with identical ids, statuses, and revisions. The native registry has the same five original Tinylink workspaces; both temporary workspace ids are absent. The three permanent Haiku session ids and statuses match the pre-cleanup snapshot. Tinylink repo `HEAD` and clean `git status` match the baseline. See [native-before-cleanup.json](card-setup/native-before-cleanup.json) and [post-cleanup.json](card-setup/post-cleanup.json).
- Flowly’s `removed/` safety backups from the two card deletions were retained as product recovery copies.
