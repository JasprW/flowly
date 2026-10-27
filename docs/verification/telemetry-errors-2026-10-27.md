# Telemetry error analysis — 2026-10-27

Card "遥测错误分析". Source: PostHog project 688543 (US), HogQL, read-only, run from the maintainer's signed-in browser on 2026-10-27 ~02:30 UTC. Window: last 14 days (in practice 2026-10-26 07:29 → 2026-10-27 01:48 UTC, i.e. since v1.6.0/v1.7.0 started reporting).

- Heartbeats: 35 `flowly_heartbeat` events from 35 installs.
- Exceptions: 34 `$exception` events; every (source, exception, version, Paseo version, OS) group has n=1, so per-day dedupe (§11.4) is doing its job and counts are "install-days", not raw occurrences.
- Bundle lines mapped with `node scripts/map-bundle-lines.mjs --dir <v1.7.0 archive> --paseo 0.13.0` (and `0.12.0`, which produced identical lines: same esbuild 0.25.12). PostHog drops the column, so frames resolve to a line only.

## Groups

| Events | Source | Type / value | Where (v1.7.0) | Cause | Fix |
|---:|---|---|---|---|---|
| 13 | `Flowly read-state sync failed` (linux ×8, darwin ×3, win32 ×2; one of them 1.6.0) | Error / "" | `server/local-daemon.ts:23` ← `session-reads.ts:178/277` | `openLocalDaemon` accepted only a TCP `host:port` in `paseo.pid`. Paseo also listens on a Unix socket or Windows named pipe, and writes `listen: null` while its supervisor restarts the worker. 11 of the 12 v1.7.0 events have `paseo_version = ""`: `readPaseoVersion` uses the same connection, so it failed on those installs every time. The same failure silently broke workspace restore, background-workspace reuse, attention clearing and summarizer hard-delete there. | Socket/pipe support (`ws` + `net.connect`); empty `listen` → `LocalDaemonUnavailable`, logged not reported |
| 4 | `Flowly session insight failed` (one linux install, Paseo 0.12.0) | Error / "" | `server/summary-models.ts:49` ← `session-insights.ts:203/165` | Every summary model failed for that install (provider trouble). | `SummaryModelError`, not reported |
| 5 | `rpc resources.read-changed`, `attention.count`, `sessions.tail`, `sessions.archived`, `sessions.image` (one darwin install, same second) | DaemonConnectionError / DAEMON_CONNECTION_LOST | `service.ts:164`, `attention-count.ts:13`, `session-tail.ts:35`, `archived-sessions.ts:20` | Daemon restarted with requests in flight. | Not reported (matched by name) |
| 4 | `rpc sessions.image` (darwin ×3, win32) | Error / ENOENT, no frames | `session-images.ts` `realpath` | The screenshot file referenced by the transcript is gone (temp files). | Plain "The image file no longer exists." |
| 3 | `rpc fs.list-directories` (linux, 1.6.0 only) | Error / ENOENT | `directories.ts:16` ← `service.ts:142` `directory()` | Typed or stale folder path. | `directory()` answers a missing path with "Expected an existing directory." (also covers project create) |
| 2 | `rpc sessions.configure` (win32, Paseo 0.12.0) | Error / EINVAL | `session-settings.ts:70/83` `execFile` | The desktop app sets `PASEO_CLI` to `resources\bin\paseo.cmd`; Node refuses to start a `.cmd` without a shell (CVE-2024-27980 fix). Reasoning/permissions/stop never worked on Windows. | `server/paseo-cli.ts` runs what the shim runs: `Paseo.exe` + runner + CLI entry, no shell |
| 1 | `rpc projects.create` (win32) | Error / ENOENT, no frames | `service.ts` `execute("paseo", …)` | Bare `paseo` is not on `PATH` (and libuv does not try `.cmd`). | Same CLI resolution as session settings |
| 2 | `Workflow insights backfill skipped a session` (win32, darwin) | Error / "" | `workflow-insights.ts:312` timeline refetch | A session's timeline could not be read; no message is reported, so the reason is unknown. | Not changed; best-effort by design |

Of the 34 events, 16 are fixed at the cause (13 + 2 + 1), 16 are now a plain answer or an outside failure that is logged but not reported (4 + 5 + 4 + 3), and the 2 backfill skips stay reported.

## Not verified

- No Linux or Windows machine was available: the socket path is covered by a real Unix-socket round trip in `server/local-daemon.test.ts`; named pipes and the Windows CLI launch only by unit tests built from Paseo's sources (`packages/desktop/bin/paseo.cmd`, `@getpaseo/cli` `resolveDaemonTarget`, desktop `local-transport.js`).
- Which listen form each failing install had is inferred (messages are never reported).
