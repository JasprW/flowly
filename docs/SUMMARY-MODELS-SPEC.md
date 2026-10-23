# Summary models and fallback priority

Status: user requested implementation on 2026-10-23. Extends TASK-SUMMARY-SPEC §4.

## Behavior

Settings → Models → Summary models, and the welcome tour's Progress section, share one ordered list. Position 1 is tried first. Users add selectable models from available providers, move an entry up/down, remove an entry, or restore defaults. The final entry cannot be removed. A provider/model pair appears at most once. No arbitrary model-count limit or drag interface.

The default list stays `claude/claude-haiku-5-5`, then `codex/gpt-6-luna`. Choosing one model is a valid list and has no runtime fallback. Edits save immediately through existing revision-checked host settings. Controls are disabled while loading/saving; failed writes show existing settings errors, and stale writes reload rather than overwrite another writer. Add-model selection stays inside the current view, never swaps native modals. Nothing persists until a model is chosen.

Unavailable configured models stay visible and removable/reorderable so temporarily unavailable providers do not destroy preferences. Runtime skips unavailable/non-selectable entries, preserves order, and never adds an unconfigured model. If none can run, fail with an English daemon error and retain previous output. The existing list is not edited by runtime failures.

Each available model is tried at most once per run. Create/wait/runtime errors (including idle+error), timeout, permission requests and invalid output move to the next candidate after cleanup. Every candidate gets the same prepared input and original workspace/parent scope. First valid output stops, including a valid no-update/no-candidate result. Only the successful model is recorded. If all fail, retain previous output and report model-specific failures within existing error bounds. Persistence errors never retry a model.

The shared list applies to card Progress, outside-session progress/next moves/ideas, daily digests and finished-card memory reviews. Their existing enablement, prompts, storage and resource ownership stay intact. Workflow insights keeps its separate model setting/Auto preference; only its existing last-resort use of the summary setting reads the new list's first available model. If its second provider-inventory query fails, reuse the first successful inventory; a successful second query remains authoritative so summary-only providers stay eligible.

## Settings contract and compatibility

Host setting `task-summary` remains version 1, with additive optional `summaryModels: string[]`. Each value is a nonempty `provider/model` identifier, and the array is nonempty and unique. Invalid arrays are rejected by the existing settings RPC validator. `summaryEnabled`, `digestEnabled` and `retroEnabled` keep their values.

The deprecated `summaryModel` string remains readable and accepted. Effective list precedence:

1. `summaryModels`, when present;
2. legacy nonempty `summaryModel`, as a singleton;
3. default Haiku → Luna.

There is no write-on-read migration. New UI edits write `summaryModels` and clear legacy `summaryModel` in the same settings save. Reset writes the default pair. Existing legacy Auto and explicitly selected model settings retain their meaning until edited. No direct settings-file writes, board migration or new RPC endpoint.

## UI, wording and guidance

Show numbered model rows with provider identity and accessible Move up/Move down/Remove controls. Narrow layouts wrap action buttons as needed. Add model opens provider/model selectors inline using existing motion primitives. A model is appended only when selected, and already-selected models cannot be added again. Restore defaults is one action. Explain that models are tried top to bottom, and a fallback sends the same conversation to that model's provider. Cost estimates describe the first candidate, not guaranteed total fallback cost.

Update the shared welcome-tour control, README highlights and onboarding spec. A once-per-host `summary-models` tip appears when a card has a summary, after `ai-language`; Settings → Models or completing the tour marks it seen. The once-per-host tip announces the setting to existing users. A What's new announcement is also prepared in the shared checkout, but its separately developed uncommitted framework is outside this card's PR. All UI text uses t/msg and all nine catalogs.

## Acceptance and checks

- Legacy Auto, legacy explicit model, new default list, custom list/order, unavailable entries and invalid/duplicate/empty lists are covered by shared tests.
- Card summary tries three configured candidates in order, stops at first success, and records its actual model. Other summary-setting callers use the same runner; their error, persistence and cleanup guarantees remain covered.
- Add/remove/up/down/reset interactions persist in the real settings UI, including compact layout; unavailable stored models remain manageable and duplicates/final removal are prevented.
- New onboarding tip priority/seen behavior, tour sharing and catalogs pass existing checks.
- Focused: `npx vitest run shared/summary.test.ts server/summaries.test.ts server/summary-models.test.ts server/session-insights.test.ts server/insights.test.ts server/memory.test.ts client/onboarding-logic.test.ts`.
- `npm run typecheck`, `npm test`, then `paseo plugin reload flowly`.
- Independent Paseo codex/gpt-6-luna full-access test session; preserve unrelated work. UI evidence through docs/promo/shot-lib.mjs only. Restore exactly any settings changed for verification and clean only test-owned sessions/resources.
