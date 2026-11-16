# Paseo 0.15.4 old-host verification

2026-11-16, GPT6 Luna. Root HEAD: `fb9e7445d42db77ea11807b3b7dc2eb2aaab3a9d`, with a dirty shared worktree. This is a runtime check of that source snapshot, not candidate-commit acceptance. The fixture CLI and its `@getpaseo/client`, `@getpaseo/plugin`, and `@getpaseo/protocol` packages were 0.15.4; the installed Flowly source used SDK 0.16.0. All fixture state lived under `.verification/paseo016-old-host/`; no real daemon, installed plugin, phone, or existing worktree was used.

## Results

- **PASS — load and ordinary plugin RPC.** Isolated daemon on `127.0.0.1:17767` reported Paseo 0.15.4. Installing the dirty-root plugin returned `running / enabled`; logs reported `Plugin ready`. `board.read` worked before and after writes.
- **PASS — project/card/workspace and idle session.** Through plugin RPC, created project `977ed913-63b4-4009-951a-883c753aa798`, card `4693d6b8-7abd-49ef-8eb8-2ae9108c83e7`, and its native workspace `wks_c18030a8f9e65344`. Created native agent `8fa5d58d-5150-46a3-a411-3a13f6ac1f0f` with provider `codex/gpt-6-luna` and **no prompt**; its snapshot was `idle` with `initialPrompt: null`. Normal workspace refresh, agent listing, `sessions.native-chips`, and board reads all worked.
- **PASS — real metadata fallback.** After triggering `sessions.native-chips`, Paseo 0.15.4 logged `Flowly: this Paseo has no metadata; using the older path (method missing).` Before and after snapshots both had null workspace/agent metadata; neither contained any `flowly.*` key. The plugin remained `running / enabled` and the subsequent board read succeeded.
- **PASS — old client export guard.** The actual 0.15.4 plugin client runtime has no `useSubscription` export. Evaluating the `canSubscribe` expression from root `client/board-push.tsx` against that runtime value returned `false`.
- **UNRUN — real client UI and polling/reconnect behavior.** No 0.15.4 desktop/web client was attached. The export/guard check is not a UI test.
- **UNRUN — exact candidate commit.** Awaiting the parent’s candidate SHA.

## Commands and cleanup

- PASS, exit 0: fixture CLI `--version` → `0.15.4`; `daemon start --home <fixture home> --timeout 60` with `PASEO_HOME=<fixture home> NODE_ENV=test FLOWLY_TELEMETRY=0` → daemon PID `47278`, worker `47280`, loopback port `17767`.
- PASS, exit 0: `plugin install "$PWD" --id flowly --home <fixture home>`; plugin listed as running/enabled.
- PASS, exit 0: inline Node ESM using the fixture’s 0.15.4 `DaemonClient`/`createPaseoApi`: create native workspace, create idle agent without `prompt`, create card by Flowly RPC, trigger `sessions.native-chips`, inspect metadata, and read board.
- PASS, exit 0: import the fixture’s 0.15.4 plugin client and evaluate the root `canSubscribe` guard; `useSubscription` was undefined and guard result false.
- PASS, exit 0: delete the exact test agent ID; remove the exact Flowly project with `alsoPaseo: true`. Removal reported one card and one workspace. Final `board.read`, `project ls`, `workspace ls`, and agent `ls` were empty.
- PASS, exit 0: stop fixture daemon. The owned `home/` and `project/` directories were removed; pre-existing fixture dependencies and package files were preserved.

No credentials were copied into this report. The temporary root `P16_PHONE_PROBE` instrumentation was present; the `.verification/paseo016-phone/subscriptions-disabled` gate was absent, so it did not affect the run.
