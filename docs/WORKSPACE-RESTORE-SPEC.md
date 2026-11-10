# Restore a wrapped-up card's workspace and sessions when it leaves Done/Cancelled

Status: the user requested this on 2026-10-15 and chose option A, a temporary direct daemon connection. Their words: "按A试一下，并进行测试，如果通过就先这么用，记录着，以后SDK支持了的话再改方案". Upstream: [MULTITASK-SPEC](MULTITASK-SPEC.md) (wrap-up, auto wrap-up).

## Behavior

- **Trigger**: a human moves a card from Done or Cancelled to any other lane. This covers the board menu, drag, drawer status and the edit form (`tasks.update` / `tasks.place`). Moving between Done and Cancelled does not trigger it. Agents cannot move cards out of Done/Cancelled.
- **Scope**: the card must not be archived. Its workspace is restored only when Paseo reports it archived and recoverable, and one of these holds:
  - the card's latest wrap-up record says the plugin archived the workspace. That means a `workspace_auto_archived` event, or a `wrapped_up` event whose note says `workspace archived`, with no `workspace_restored` after it;
  - or the card created that workspace (`ownsWorkspace === true`). This covers activity trimmed past 100 events.

  A shared workspace (e.g. the project main, `ownsWorkspace: false`) is never restored.
- **What Paseo does** (`workspace.recovery.restore`, same workspace ID, so the card binding stays valid):
  - **Directory still exists**: unarchive in place.
  - **Worktree directory removed**: recreate the worktree at the same path on its kept branch, then unarchive. With no recorded branch, Paseo creates `restored/<id>` from the base. Uncommitted changes lost at archive time are not recovered.
  - **Directory, project or source repository gone**: unavailable. The plugin records the reason.
- **Sessions** (user follow-up the same day: "把session也复活"): after the workspace is back, the sessions that a wrap-up of this card archived are unarchived too.
  - **Which sessions**: archived sessions in the workspace whose `archivedAt` falls within one of the card's `wrapped_up` / `workspace_auto_archived` events. The window runs from 120 s before the event to 5 s after it; the event is recorded right after archiving, and re-archiving a workspace re-stamps its sessions.
  - **Left archived**: sessions the user archived at other times, and summarizer children.
  - **How**: the daemon's agent refresh (`refreshAgent`). It unarchives the session and reloads it from provider persistence. A session that never ran has nothing to reload; refresh reports an error, but the session is unarchived anyway, so it counts as restored.
  - **Already-restored workspace**: if the workspace is already active but sessions from the wrap-up are still archived (e.g. restored by the first version of this feature), reopening the card revives them and records `sessions_restored`.
  - **Failures**: listed per session in the note; the others are still restored.
- **Execution**: runs in the background after the status write and never blocks it. At most one restore runs per card at a time. Before restoring, the plugin re-checks that the card is still out of Done/Cancelled and not archived.
- **Activity** (actor `system`):
  - `workspace_restored`: notes whether the worktree was recreated and on which branch, and how many sessions came back.
  - `sessions_restored`: the workspace was already active; only sessions came back.
  - `workspace_restore_skipped`: unreachable daemon, unrecoverable workspace, or failed restore, with the reason. Skips are recorded only when the plugin's own wrap-up archived the workspace.
  - Silent when the workspace is not archived, which leaves nothing to do.

## Unwrap in place

User request 2026-11-10 (card "Done 卡片支持 Unwrap up"): a wrapped-up card kept on the board can get its workspace and sessions back without leaving Done/Cancelled, so a mistaken wrap-up costs one press.

- **Entry**: the sidebar's *Wrapped up* block has an **Unwrap** button. It calls RPC `tasks.unwrap` (`{ id }` → `{ restored: boolean, failed: string[] }`).
- **Preconditions**, checked on the daemon:
  - the card exists (`Task not found.`), is not archived (`Card is archived.`) and is in Done or Cancelled (`Only Done or Cancelled cards can be unwrapped.`); a card outside them is restored by moving it, above;
  - the card is currently wrapped up (`currentWrapup` in `shared/wrapup-state.ts` is not null). Otherwise the call is a silent no-op: `{ restored: false, failed: [] }`, no Paseo connection, no activity. This covers a second press and a card already unwrapped.
- **What it restores**: the same as reopening (scope, Paseo behavior, session window). The card stays in its lane and its revision is unchanged.
  - The workspace is restored only when the plugin's wrap-up archived it or the card owns it. A shared workspace (e.g. the project main) is never restored; when the wrap-up kept it, only the sessions come back.
  - A workspace that is already active counts as success: only sessions are revived.
- **Activity** (actor `human`):
  - success: `workspace_restored`, with the same note as a reopen (`Workspace already active` when nothing was restored). This ends the wrapped-up state, so the sidebar shows *Finished* again with its Wrap up button.
  - sessions that fail to revive are listed in the note and returned in `failed`; the workspace and the other sessions still count as restored. The client shows them as an error.
  - `workspace_restore_skipped` with the reason when Paseo is unreachable, the workspace is unrecoverable, it was archived outside this card's wrap-up, or the restore fails. The RPC then fails with the same reason; the card stays wrapped up and can be retried.
- **Concurrency**: shares the per-card lock with the reopen restore; concurrent presses run one restore and get the same result.
- **Auto wrap-up**: runs only when a card enters Done/Cancelled from another lane (`afterStatus` in `index.server.ts`); there is no background scan or restart sweep. An unwrapped card staying in Done is therefore not wrapped up again until it leaves and re-enters Done/Cancelled.

## Temporary transport: COMPAT(sdk-workspace-restore)

`@getpaseo/client` 0.11.2 gives plugins `PaseoApi.workspaces` with only list/open/create/archive. Its agent handle `refresh()` only re-fetches; it does not unarchive. The `paseo` CLI has no restore command either. The daemon does serve `workspace.recovery.inspect/restore` and agent refresh, and `DaemonClient` exposes them as `inspectWorkspaceRecovery` / `restoreWorkspace` / `refreshAgent`.

Until the SDK exposes restore, `server/workspace-restore.ts` connects the way the `paseo` CLI does:

1. Read `listen` from `$PASEO_HOME/paseo.pid` (default `~/.paseo`) and resolve it as the `paseo` CLI does (Paseo 0.13 `resolveDaemonTarget`, `daemonTarget` in `server/local-daemon.ts`): `host:port`, a bare port, `tcp://host:port`, a Unix socket (`/path`, `~/path`, `unix://path`) or a Windows named pipe (`\\.\pipe\name`, `pipe://name`). Sockets and pipes are opened with `net.connect` and spoken to through the bundled `ws` package, because Node's built-in WebSocket cannot use them (Linux and Windows desktop installs listen on a socket or pipe; TCP-only support made every local connection fail there, found in telemetry 2026-10-27). An empty `listen` means Paseo's supervisor is restarting the daemon: `LocalDaemonUnavailable`, like a missing credential; both are logged, not reported (TELEMETRY-SPEC §11.2). Paseo writes `paseo.pid` in place (created empty and then written; `listen` set later by truncating and rewriting), so an empty or unparsable file is read again up to 10 times 50 ms apart, as Paseo's own `readPidLock` does; still unreadable, or no file at all, is `LocalDaemonUnavailable` too (telemetry 2026-11-10: `SyntaxError` from `JSON.parse` on 18 installs). A connection the daemon does not complete (timeout, refused, closed) is `LocalDaemonUnavailable` with the reason in the log; a daemon that rejects the local credential (`DaemonAuthenticationError`) and a Paseo version without the needed methods stays a reported error.
2. Read the local credential from `$PASEO_HOME/local-credential`. The daemon accepts it only for the address it listens on.
3. Open a short-lived `DaemonClient` (`@getpaseo/client/internal/daemon-client`, bundled from the pinned version) with `localCredential`. Inspect the workspace, restore it, list archived sessions (`fetchAgents`) and refresh the chosen ones, all on one connection, closed in `finally`. The token is never logged or returned.
4. If the connection or methods are missing, record `workspace_restore_skipped`. The status change itself is unaffected.

This departs from "use the supplied Paseo SDK"; AGENTS.md lists it as an explicit, temporary exception. **When the SDK exposes workspace restore**, replace `daemonWorkspaceRecovery` with the SDK calls (workspace restore, session unarchive). Keep `WorkspaceRecovery` / `RecoveryConnection` as the seam: tests inject a fake, so only the transport changes. Then delete the credential/pid reading and this section.

## Acceptance

- Focused tests (`server/workspace-restore.test.ts`, fake recovery):
  - restore after a wrap-up;
  - auto wrap-up and owned workspaces count; shared or kept workspaces are never touched;
  - finished or archived cards are ignored;
  - unrecoverable, unreachable and failed restores are recorded; a live workspace is silent;
  - concurrent moves restore once;
  - only wrap-up sessions are revived (summarizer and earlier archives skipped);
  - an already-active workspace still gets its sessions back;
  - a failed revive is reported while the others come back;
  - unwrap in place: restores while the card stays in Done and records `workspace_restored`; a kept shared workspace is not restored (only sessions); a card not wrapped up is a silent no-op; unreachable, unrecoverable and failed restores are recorded and rejected; concurrent presses restore once; cards outside Done/Cancelled or archived are rejected.
- End-to-end against the installed plugin (`docs/verification/fixtures/workspace-restore/e2e.mjs`): [verification](verification/workspace-restore.md).
