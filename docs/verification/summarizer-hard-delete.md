# Summarizer child hard-delete verification

Date: 2026-10-22 (UTC)

## Test identity and setup

- Test session: `624f51ac-d19a-4bc2-8661-1a5635852e7b` (`PASEO_AGENT_ID`); dispatched as the Luna full-access test session.
- Commit under test at start: `e90d120`. Before closeout, shared `origin/main` advanced to `b329e76`; `server/summarizer-remove.ts`, `server/summaries.ts`, and `server/session-insights.ts` match `e90d120` exactly (`git diff --quiet e90d120 -- <three files>` passed).
- Flowly was running from this checkout. Summary setting before and after: `summaryEnabled=true`, `summaryModel=""` (Auto). Provider list reported Claude available.
- Worker model/mode: `claude/claude-haiku-5-5`, `bypassPermissions`. Summary entries also reported `claude/claude-haiku-5-5`.
- Fixture: project `f4d2c7ba-3b93-498e-9ecc-2aa1fa300124`, card `ccf0f5fb-55a9-4fa6-b36f-62ea772871a3`, worker `f3b524b2-90dc-4a7e-8822-74ee8bc25349`, workspace `wks_d89f8616bfb66a33`, directory `/var/folders/0b/f1crzdg95g5fwbq49s_3pw9c0000gq/T/flowly-e2e-delete-djSHLm`.
- One setup retry followed an RPC validation rejection (`priority=medium`, `type=task` were invalid). It left an empty fixture project `e9a7f52c-8a33-4de8-ae02-af29d572ebd2` at `/var/folders/0b/f1crzdg95g5fwbq49s_3pw9c0000gq/T/flowly-e2e-delete-5Xd4mA`; both this project and the valid fixture were tracked and cleaned up.

## Counts

| Snapshot | `paseo ls -a --json` total | Summarizer labels | `paseo ls --json` non-archived | Archived (= total minus non-archived) |
| --- | ---: | ---: | ---: | ---: |
| Baseline | 1468 | Not available from baseline CLI JSON; it omitted `labels` | 53 | 1415 |
| After first summary, before cleanup | 1469 | CLI JSON omitted `labels` | 54 | 1415 |
| After second summary, before cleanup | 1469 | CLI JSON omitted `labels` | 54 | 1415 |
| After cleanup | 1468 | 579 existing registry files; none modified since test start | 53 | 1415 |

The baseline/list-count delta was exactly one session, the fixture worker. Archived count stayed at 1415 while the worker existed, so neither summary child was left in the archive. The post-cleanup labelled count is an on-disk metadata count; the baseline labelled count was not captured and cannot be reconstructed from the CLI output. `paseo ls -a --json` rows had no `labels` key, including the worker row.

## Runtime observations

- First summary stored at `2026-10-22T02:02:37.449Z`; RPC reported enabled, no running summaries/errors, and the expected Haiku model.
- Second summary stored at `2026-10-22T02:04:27.358Z`; RPC again reported no running summaries/errors and the expected Haiku model.
- Poll JSONL: [summarizer-hard-delete-poll.jsonl](summarizer-hard-delete-poll.jsonl). Across 34 `paseo ls -a --json` samples (about 1–2 seconds apart), only the worker appeared. Its rows did not expose labels, attention, unread, `requiresAttention`, or `needsAttention`. `paseo inspect` likewise did not expose those fields.
- Child appearance/disappearance: **not directly observed**. Both summaries completed between polling samples; the summarized output and the absence of any extra session/archive entry are observed, but the transient child lifecycle is not.
- Completion notification/attention signal: **could not determine**. No signal was observed in available CLI output; these commands omit attention fields, so this is not evidence that Paseo emitted no notification.
- `paseo plugin logs flowly` contained no `could not delete a summarizer session` fallback message.

## Acceptance results

### Completed / PASS

- One card produced a stored summary; a second turn also produced a stored summary.
- After each run, the only additional native session was the fixture worker (`+1` total and `+1` non-archived); archived count did not increase.
- No summarizer child remained in native session listing or archive. Post-cleanup label metadata had 579 existing records and zero files modified since test start.
- Summary remained enabled and Auto; actual worker and summary model were `claude/claude-haiku-5-5`.
- No fallback-to-archive log was found.
- Cleanup passed: worker hard-deleted; both exact fixture projects removed with `projects.remove(alsoPaseo:true)`; 1 card removed; Paseo reported 1 workspace removed for the valid fixture; both temp directories are absent; plugin board has zero fixture projects/cards; native project listing has no fixture paths; final total/non-archived counts returned to 1468/53.
- Relevant implementation files match commit `e90d120`.

### Failed

- None observed.

### Unrun / incomplete

- Exact baseline count of `flowly=summarizer` labels: not available because the baseline `paseo ls -a --json` omitted labels. Current registry metadata count is 579, with no label records modified during the test.
- Whether a completion notification appeared while the child ran: not observable with the available CLI fields; no UI interaction was performed.
- Delete-failure injection and the archive fallback path were not exercised. Source review confirms the fallback log string exists, but runtime failure behavior remains unverified.
- The test session's Luna/full-access identity came from the dispatch/environment; the worker itself was verified as Haiku 5.5 with bypass permissions.
