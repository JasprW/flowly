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
