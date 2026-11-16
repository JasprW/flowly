# Agent output contract

This amends PHASE-02-SPEC §5–7 and CONNECTORS-SPEC §3.3. MCP and CLI use the same projections; storage, authorization, signed requests and receipt retention do not change.

## Reads and compatibility

`flowly_get_task({responseDetail?: "compact" | "full"})` and CLI `current [--full]` default to compact (`toolVersion: 2`). `responseDetail: "full"` / `--full` returns the previous full context (`toolVersion: 1`), including the deprecated Jira `ticket` alias. Tool names, CLI commands and existing context/request files remain valid. An older skill may keep re-reading; no refresh cache or session negotiation is needed. Consumers needing removed fields request full detail.

Compact reads preserve identity, setup, the turn checklist, card title/description/status/priority/type/tags, project identity/root, scope/workspace/session observations, allowed statuses/lanes, signed request and both revisions, inputs/outputs, workpad acceptance, plans, memory, guardrails/review, linked cards and output language. Card/project bookkeeping fields and acceptance `by`/`at` are omitted. Artifact `unread`/`missing` appear only when true; absence means false. Artifact/idea/acceptance/review IDs remain available for later operations. Only full reads include `ticket`.

Activity contains the most recent ten non-lifecycle events, selected *after* excluding `agent.*` and `next_moves_suggested`. Events carry actor/action/time, relevant session/from/to/report kind and note; omit event/card IDs and move payloads. Human notes and review failures remain available. The persisted activity is unchanged.

## Writes and continued work

All MCP/CLI writes accept the same optional detail setting and default to compact. It changes presentation only and is removed before business-input validation and receipt hashing: retrying the same request with another detail returns the original receipt.

The result retains `receipt`, `replayed`, optional reminders/notice and operation IDs. `current` is a small continuation: identity, `toolVersion: 2`, current task ID/status, both revisions, a new complete signed request, setup, writable/reason and workpad-enabled state. Whenever `workpad` is present it pairs the revision with its normalized acceptance list (id/text/done), including generated IDs, so a fresh revision cannot authorize replacing the list with an older cached copy. Compact continuation generation rechecks live resources/scope but does not build session instructions or enumerate sessions, external summaries, memory, plans, activity or guardrails. It never clears unread inputs.

`responseDetail: "full"` returns the former full `current`. A post-commit context failure still returns the successful receipt with `current: null` and `contextError`. It must not be reported as an uncommitted write. A replay describes the original commit and current status separately; revisions, expired requests, identity checks and workpad conflicts keep their existing errors. No automatic conflict retry is introduced.

Compact continuations are issued for the committed receipt's task/project revisions. If either revision changed before the continuation read (including an old receipt replay), return the successful receipt with `current: null` and a re-read instruction; never silently sign an unseen human edit. Full detail still returns the current full context. This uses the existing revision checks and introduces no lock or automatic retry.

Read the card at each turn start, after long work before delivery, and after conflict/expiry or unavailable continuation. Consecutive successful writes may use `current.revision` and `current.request` directly. CLI writes accept `--save-request <path>` and save the continuation identity/revision/request plus available workpad information; `--request-file` remains an explicit input. Saving over the input file occurs only after a successful response with a usable continuation. On errors or `current: null`, keep the input snapshot so the original request can be retried. A local snapshot-save failure must identify that the server write committed.

## Acceptance

1. Real MCP/HTTP and generated CLI can chain get → write → write, without another get. Full mode retains the previous shape; presentation does not change replay identity.
2. Compact writes avoid full context generation and preserve replay, conflict, missing-setup reminders, generated acceptance IDs, unread inputs and successful-commit/post-context-failure behavior.
3. Compact reads preserve actionable fields, omit bookkeeping and false artifact flags, and retain meaningful events even behind more than ten lifecycle events. Stored data is unchanged.
4. A fixed busy-card fixture records serialized character counts before/after; a routine compact write is at least 80% smaller than its full counterpart. Character counts are not claimed as model token counts or phone performance.
5. Typecheck, focused transport/service/CLI tests and the full suite pass. No new UI capability, switch or core action is introduced, so tour/tips and telemetry fields do not change.
