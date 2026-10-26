# Telemetry verification on the Coder host — 2026-10-26

Commit under test: `74d95e2` (origin/main), deployed to `coder.Bofan.main` (Paseo 0.13.0) at `/root/flowly-test/flowly`; previous source kept in `/root/flowly-test/backup-20261026-150014/source-flowly`. Build: `npm ci --omit=dev --ignore-scripts --no-audit --no-fund --legacy-peer-deps`, then `paseo plugin reload flowly`.

| Check | Result |
|---|---|
| Plugin loads | pass — `Plugin ready` at 07:01:21.954Z |
| First heartbeat 5 min after load, accepted by PostHog US | pass — `telemetry.json` `lastSentAt` = 07:06:21.959Z (only written on a 2xx) |
| Daemon has no `DO_NOT_TRACK` / `FLOWLY_TELEMETRY` / `NODE_ENV` | pass — read from `/proc/<daemon>/environ` |
| What's new shows the 1.7 telemetry item with Open settings | pass — `whats-new-1.7.png` |
| Open settings → General → Usage data, switch on by default | pass — `settings-usage-data.png` |
| Forced-off text (DO_NOT_TRACK on the daemon) | not run — needs a daemon restart with a changed environment; covered by `server/telemetry.test.ts` and the `telemetry.status` RPC |
| Event visible in PostHog Activity | to be confirmed by the maintainer (`flowly_heartbeat`) |

Screenshots: `docs/promo/shot-lib.mjs` (`launch`, `shot`, `pageText`), headless Chromium on app.paseo.sh connected to the Coder daemon through its pairing link.

## Error reports end to end (TELEMETRY-SPEC §11) — 2026-10-26

Commits deployed in turn to the same host: `412aaed`, `80ada7b`, `6d507cd` (PR #66, squash-merged as `9f3a04a`); previous source in `/root/flowly-test/backup-20261026-152800/`. Trigger: a one-off script using the plugin's `@getpaseo/client` (`DaemonClient.invokePluginRpc`, local credential) called `fs.list-directories` twice with a missing path (real `ENOENT` from `realpath`) and once with a regular file (`Expected an existing directory.`, a plain `Error`). Read back with the PostHog MCP (`execute-sql`) from a headless `claude -p` session. Script and archives removed afterwards.

| Check | Result |
|---|---|
| RPC failure reaches PostHog as `$exception`, `source = rpc fs.list-directories`, `type Error`, `value ENOENT` | pass — 07:29:03Z, 07:32:52Z, 07:42:56Z |
| Callers still get the original error | pass — the script saw the unchanged `ENOENT` / handler error |
| Same error twice → one event | pass — one event per run |
| Plain `Error` from a handler is not reported | pass — no event for the regular-file call |
| No message, no path outside Flowly | pass — properties hold only the §11.3 keys |
| `distinct_id` = heartbeat install id | pass — `0d645af4…` |
| Frames on Paseo 0.13 | **fail on `412aaed`**: Paseo `eval`s the esbuild bundle (`bundle-evaluator.js`, no file name or source map), so frames came out as `bundle-evaluator.js:32:21), <anonymous>`. Fixed in `80ada7b`: such frames are `flowly-bundle.js` with bundle line/column and the function name (`async listDirectories` → `async directory`); pass on `80ada7b` and `6d507cd` |
| IP not stored | **fail before the fix**: the PostHog project had *Discard client IP data* (`anonymize_ips`) off and all 4 earlier events had `$ip`. Turned on with the user's OK (project 688543); the 07:42 event has no `$ip` |
| Uncaught exceptions, background `logFailure` path | not run end to end — same sink as the RPC path; covered by `server/error-report.test.ts` |
