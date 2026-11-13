# Review reasoning and permissions

## Contract and assessment

- Review reasoning is model-specific; use advertised thinkingOptions and send thinkingOptionId only for the explicitly configured model. Model changes clear it; missing/obsolete options use the model default. Summary fallback has no override.
- Recommend a fixed read-only policy for automatic reviewers, rather than an editable Permissions selector. Reviewers inspect evidence and return findings; project command checks already execute separately. Allowing edits would let a reviewer change the work it judges. Deny pending approvals so unattended runs cannot wait for a person.
- Current implementation is only partially enforced: Claude profiles use Plan mode, other providers retain their default, pending requests are denied. The installed Paseo 0.16 protocol advertises Codex auto/auto-review (both workspace-write) and full-access; no read-only mode. Prompt instructions and approval denial cannot block writes already permitted by that default. The SDK already exposes config.options (providerOptions), and the official agent-configuration example passes sandbox_mode and approval_policy. The read-only/never combination and actual execution enforcement need runtime verification; absence of a read-only mode does not prove a missing host API. Do not present the current system as a strict guarantee. This card does not add an unsafe permission picker or invent unsupported mode ids.
- A “read before write” rule does not make a reviewer read-only: after reading it could still change the file. For ordinary implementation sessions it may avoid blind replacements, but shell commands, new-file creation and external tools need separate semantics and host enforcement. Do not add a Flowly-wide read ledger for this review setting.
- Documentation mismatch corrected: AUTO-REVIEW-SPEC and the summary setting comment said project model then summary fallback; llmReviewer actually uses Review model then summary fallback. Existing behavior is retained.
- Telemetry: no new switch/core action or payload; no new fields needed. Onboarding: revise the existing auto-review tip to point to model/reasoning settings; no new tip id or tour page needed.

## Verification

Tree: shared working directory based on `af9b69a`; this is not an isolated committed tree. Other sessions' pre-existing changes were preserved. No commit, push, installation or reload performed.

- PASS: `npm run typecheck`, exit 0 after fixing two optional `models` accesses (first run exit 2).
- PASS: `NODE_ENV=test FLOWLY_TELEMETRY=0 npm test`, exit 0; 161 files passed, 1 skipped; 1447 tests passed, 6 skipped. Covers explicit supported/default/obsolete reasoning, fallback without override, settings backward compatibility and existing permission-denial behavior. Initial focused suite: 84 passed.
- PASS (read-only live capability query): Paseo `inspect_provider(codex)` advertises exactly auto, auto-review, full-access, no feature controls; `list_models(codex)` exposes thinkingOptions, including low/medium/high/xhigh/max for Luna and ultra for supported models. No test sessions/resources created.
- UNRUN: desktop/compact UI, installed-plugin persistence and actual model execution, strict write-refusal probe, independent Haiku verification on an exact commit. No claim of runtime enforcement or deployed UI.
- Input: user request and clarification (automatic reviewers must be read-only), current source/SDK and live provider capabilities; no external artifacts.


## Installed live follow-up — 2026-11-14

- PASS: fresh `npm run typecheck`, exit 0 before reload. `paseo plugin install "$PWD" --id flowly` returned exit 1 because `flowly` was already configured at this exact directory; no duplicate plugin was created. `paseo plugin reload flowly --json` exited 0, and final `paseo plugin ls flowly --json` reports this checkout, enabled, running. Reloaded a second time after selecting reasoning to verify stored persistence. No daemon restart.
- PASS, desktop web layout (1700×1000): actual installed Paseo 0.16 `app-dist` via the existing `open016` harness, local running daemon and plugin. Review Reasoning displayed Model default plus provider-supported options; choosing `high` saved `reviewThinking: high` in the plugin service. `desktop-options.png`, `desktop-high.png`.
- PASS, compact web layout (1000×900, plugin area 680 px): picked `xhigh`, service readback matched. Row bounds `{x:228,y:681,width:678,height:52}` are inside the actual viewport. A new browser context displayed `xhigh`. `compact-persisted.png`, `compact-selected.png`, `ui-checks.json`. The required shot-lib privacy crop starts at x=320, so compact screenshots clip the left-hand labels of the centered settings modal; this is an evidence-crop limitation, not actual viewport clipping. No hand cropping or product layout manipulation was used.
- PASS, plugin reload persistence: service readback retained `reviewModel: codex/gpt-6.1-terra`, `reviewThinking: xhigh`, and the reloaded UI displayed xhigh (`reload-persisted-xhigh.png`). Browser errors: 0.
- PASS, real auto review: disposable project `ffd09ea0-e674-497c-a675-ce715a589504`, card `f9c44c9b-3715-4b0a-9d87-e2a0a0360528`, workspace `wks_d8fab4412f01e809`, idle parent `4a39dfc3-5d2d-49c8-b9dd-34035b6a3d52`. Flowly created reviewer `6e42edbf-9767-44fd-9e4f-d2de56a9bcc0`; native persisted snapshot: provider codex, model gpt-6.1-terra, **thinkingOptionId xhigh**, mode auto, background true. The real model passed the goal check in 9174 ms with README.md:2 evidence; reviewer was automatically archived. This is the installed reviewer path, not a mock or a directly created substitute. `fixture.json` records selection, observed snapshot, review and cleanup; `live.mjs` contains the reproduction harness.
- PASS, cleanup: hard-deleted only fixture parent/reviewer, removed only the disposable project and its card/native workspace/project, removed `.test-data/review-reasoning-dc766582`. Readback: boardProject=false, boardCards=false, nativeProject=false, nativeWorkspaces=0, nativeAgents=0, directoryRemoved=true. Tinylink's existing six cards/sessions were not changed. Closed both browser test contexts and test SDK connections.
- Restored only the two review setting fields to the pre-test state: codex/gpt-6.1-terra, no reasoning override; unrelated summary settings retained. Per the development telemetry rule, disabled this machine's Flowly telemetry through the running settings RPC and left it disabled; no daemon/environment/config file rewrite. Source changes from other sessions were not edited, committed or reset.
- Harness failures corrected without product changes: node_repl lacked WebSocket/process support, so used ordinary Node; native agents pagination rejects limit=500, corrected the fixture query to 200. The fixture completed successfully after that query correction.
- Limits: no native-window actions (the computer-use API could not bind the user's non-fullscreen window reliably); desktop/compact evidence comes from isolated headless Chromium using the installed app build. Android/iOS device validation, strict write-refusal probe and independent exact-commit Haiku verification remain UNRUN. The implementation is still uncommitted. No spec/code mismatch newly found.

## PR separation

This PR is based on origin/main with SDK 0.15. It contains only the reasoning feature, its translations/specs and this card's evidence. Existing card-image handling and agent lifecycle remain as on main. The live UI/model evidence above was collected against the shared SDK 0.16 development installation, not against this isolated PR tree. Exact-commit automated verification is recorded separately in independent.md. The fixture manifest is sanitized (no session-context or local CLI paths).

## Assessment correction during PR preparation

The earlier claim that strict read-only access requires a new host API was too strong. Both the baseline SDK 0.15 and development SDK expose `PaseoAgentConfig.options` → providerOptions; the official [agent-configuration example](https://github.com/getpaseo/paseo/blob/main/plugin-examples/agent-configuration/index.server.ts) passes sandbox_mode / approval_policy. Current mode discovery is evidence about the picker only. Recommendation remains fixed read-only review, but provider-native read-only/never options must be tested before deciding whether host work is necessary. No permission implementation was added in this card.

## Independent verification attempt

Prepared from origin/main without changing the shared checkout/index. Implementation commit `204a997ae05f3486b4da8a86ff648ea22db70a56`: implementer typecheck exit 0; full tests exit 0, 157 files passed/1 skipped, 1430 tests passed/6 skipped. Subsequent permission-assessment correction is documentation only.

Independent session `4d9e69cf-5cbf-42b2-bc45-7b430ba72167` was created in the card workspace as the required claude/claude-haiku-5-5 with bypassPermissions. It errored before verification: individual spend limit. No independent checks or report were produced. That test session was hard-deleted. Independent verification remains UNRUN pending the user's model/provider decision; it is not counted as a pass.

## Independent verification completed

The user selected GPT Luna after the Haiku quota failure. Independent full-access/xhigh session `74d3ab68-9f76-4802-81d1-e388945345e4` verified commit `504280666d24ad8d113749b99252f47e5a2b6763`: typecheck exit 0, 5 focused files/128 tests passed, no reproducible defects or contract mismatch. The verifier owns [independent.md](independent.md); no implementation changed after that run. Exact-commit UI remains UNRUN; shared-install live evidence is identified above.
