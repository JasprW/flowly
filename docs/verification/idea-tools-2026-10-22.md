# Idea tools verification — 2026-10-22

Card: `5fcd00c8-2869-456a-96c8-3e1f4fa8b637` (扩展idea工具).
Resumed session: `98b70734-3443-4d5d-9e84-f46714f9e874`.
Primary verification session: `87fdc1e4-9942-44eb-b05e-47074d977d10`.
Independent tester: `d34eee81-94d1-4d32-a918-bd07392ee19b`, discovered `codex/gpt-6-luna`, created with `settings.modeId: "full-access"`.

Contract: [IDEAS-SPEC §3.1](../IDEAS-SPEC.md). No external inputs were attached; requirements came from the card workpad and the resumed session's recorded work.
Source at verification: `fab80456ead870e7b7e6a493bae276ee878e34fd`, dirty=true. Shared checkout contains other sessions' changes.

## Installed MCP — PASS

The previous session ran typecheck, the full suite and `paseo plugin reload flowly`, then stopped at its provider usage limit immediately before the live calls. This continuation used the already running service; no daemon restart or extra install/reload was needed.

Temporary idea: `bd83b304-83cc-4a8c-bd09-c66c67bcbbd9`.
All writes used fresh `flowly_get_task` requests, except deliberate replay/refusal probes.

| Check | Result |
| --- | --- |
| `flowly_propose_idea` | PASS; own temporary idea created |
| `flowly_update_idea` with title/detail/rationale/context/type/priority/scope/tags | PASS; returned open idea has the renamed title and new scope |
| `flowly_update_idea status=dismissed` | PASS; returned idea status is dismissed |
| Exact dismiss replay | PASS; replayed=true, original receipt/event |
| Changed parameters with committed request | PASS; REQUEST_REUSED |
| Edit dismissed idea | PASS; IDEA_CLOSED |
| `flowly_remove_idea` on dismissed idea | PASS; absent from current ideas |
| Exact removal replay | PASS; replayed=true, original receipt/event |
| Card status/revision | PASS; before and after Test, task=4, project=7 |
| Activity | PASS; exactly one idea_edited, idea_dismissed and idea_removed by primary session |
| Cleanup | PASS; own temporary idea absent in a fresh get_task |

Event IDs:
- proposed: `ca6c70e3-9263-4008-928a-04f20c29cefe`
- edited: `8b7ec17b-a5de-4e0b-b744-644defe538ec`
- dismissed: `56884de1-eceb-4955-98c4-7ba4bd1664a9`
- removed: `1ee51b08-9d7c-4cc6-8ba5-717643890d35`

## Independent validation

See [Luna report](idea-tools-2026-10-22-luna.md) for commands, output counts and the live CLI flow.

- PASS: `npm run typecheck` (exit 0); `npm test` (110 files / 936 tests passed, 15.19 seconds), on the source SHA above with dirty=true. No duplicate full run after documentation-only updates.
- The native child initially had no Flowly context. The parent used the existing `tools.prepare-existing` plugin RPC to bind only that child to this card; no credential/configuration file was edited. The initial UNRUN attempt remains in Luna's report.
- PASS after preparation: real CLI propose → multi-field edit → dismiss → refused dismissed edit (`IDEA_CLOSED`) → remove; exact propose replay and changed-parameter `REQUEST_REUSED`; final read shows no test idea and unchanged Test/task=4/project=7.
- Luna temporary idea: `e4b56783-5734-4d6a-9db1-7821a4bf12da`, removed. Temporary snapshots/logs under `docs/verification/.idea-tools-luna-tmp` removed; parent confirmed that directory is absent.
- Test session cleanup: parent archived and closed only `d34eee81-94d1-4d32-a918-bd07392ee19b` after its completion message, then deleted it through the native daemon API. Final native `get_agent_status` reports not found; fresh `flowly_get_task` lists only the two pre-existing card sessions and no ideas. The shared workspace was preserved.
- `git diff --check` on this card's affected files: PASS.

## Boundaries

- Desktop/compact visual checks: UNRUN. This extension changes agent MCP/CLI behavior and service data, with no client/UI change. Live MCP confirms the returned data, not pixel rendering.
- Accepted/cross-card/Ideas-off protections are exercised in isolated service tests; no real accepted idea, other card or global setting was changed.
- No commit, push, PR or release was requested or performed.
- Onboarding: existing Ideas guidance already covers the user actions; no tour, one-time tip or What's new change is warranted for these agent-facing tools.
