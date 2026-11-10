import { afterEach, describe, expect, test, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BoardStore } from "./store";
import { currentWrapup } from "../shared/wrapup-state";
import { WorkspaceRestoreService, archivedByWrapup, type ArchivedSession, type RecoveryState } from "./workspace-restore";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});

const recoverable = (action = "restore", branch: string | null = "kanban/x"): RecoveryState => ({
  kind: "recoverable", workspaceId: "w", workspaceName: "Card", action, branch,
});

async function setup(options: {
  status?: string;
  ownsWorkspace?: boolean;
  archivedAt?: string | null;
  events?: { action: string; note?: string; at?: string }[];
  state?: RecoveryState | Error;
  restoreError?: Error;
  connectError?: Error;
  sessions?: ArchivedSession[];
  reviveError?: Error;
}) {
  const root = await mkdtemp(join(tmpdir(), "ultra-restore-"));
  roots.push(root);
  const store = new BoardStore(join(root, "data"));
  const now = new Date().toISOString();
  await store.mutate((board) => {
    board.projects.push({
      id: "p", paseoProjectId: "native", title: "P", description: "",
      primaryPath: root, repos: [root], revision: 1,
      createdAt: now, updatedAt: now, archivedAt: null,
    });
    board.tasks.push({
      id: "t", projectId: "p", workspaceId: "w", sourcePath: root, repoPaths: [root],
      title: "Card", description: "", status: (options.status || "todo") as "todo", priority: "normal",
      position: 0, revision: 3, operationId: "op",
      createdAt: now, updatedAt: now, archivedAt: options.archivedAt ?? null,
      ...(options.ownsWorkspace === undefined ? {} : { ownsWorkspace: options.ownsWorkspace }),
    });
    for (const e of options.events || []) {
      const event = store.event(board, { taskId: "t", actor: "human", action: e.action, note: e.note });
      if (e.at) event.at = e.at;
    }
  });
  const state = options.state ?? recoverable();
  const recovery = {
    inspect: vi.fn(async () => {
      if (state instanceof Error) throw state;
      return state;
    }),
    restore: vi.fn(async () => {
      if (options.restoreError) throw options.restoreError;
    }),
    archivedSessions: vi.fn(async () => options.sessions || []),
    reviveSession: vi.fn(async (id: string) => {
      if (options.reviveError && id === "bad") throw options.reviveError;
    }),
    close: vi.fn(async () => undefined),
  };
  const connect = vi.fn(async () => {
    if (options.connectError) throw options.connectError;
    return recovery;
  });
  return { store, recovery, connect, service: new WorkspaceRestoreService(store, { connect }) };
}

const wrapped = { action: "wrapped_up", note: "1 session(s) archived; workspace archived; card kept" };

test("reopening a wrapped-up card restores its workspace and records it", async () => {
  const x = await setup({ events: [wrapped] });
  await x.service.restoreAfterReopen("t");
  expect(x.recovery.restore).toHaveBeenCalledWith("w");
  const last = (await x.store.read()).events.at(-1);
  expect(last).toMatchObject({ action: "workspace_restored", actor: "system" });
  expect(last?.note).toMatch(/kanban\/x/);
});

test("auto wrap-up and owned workspaces count; shared or kept workspaces are never restored", async () => {
  const auto = await setup({ events: [{ action: "workspace_auto_archived", note: "x" }] });
  await auto.service.restoreAfterReopen("t");
  expect(auto.recovery.restore).toHaveBeenCalled();
  // Activity may be trimmed; a workspace the card created is still its own.
  const owned = await setup({ ownsWorkspace: true });
  await owned.service.restoreAfterReopen("t");
  expect(owned.recovery.restore).toHaveBeenCalled();
  const unrelated = await setup({ ownsWorkspace: false });
  await unrelated.service.restoreAfterReopen("t");
  expect(unrelated.connect).not.toHaveBeenCalled();
  // Wrap-up kept a shared workspace; if it is archived anyway, someone else did it.
  const kept = await setup({ events: [{ action: "wrapped_up", note: "2 session(s) archived; workspace kept" }] });
  await kept.service.restoreAfterReopen("t");
  expect(kept.recovery.restore).not.toHaveBeenCalled();
  expect(kept.recovery.reviveSession).not.toHaveBeenCalled();
});

test("finished or archived cards are left alone", async () => {
  for (const x of [
    await setup({ status: "done", events: [wrapped] }),
    await setup({ status: "cancelled", events: [wrapped] }),
    await setup({ archivedAt: new Date().toISOString(), events: [wrapped] }),
  ]) {
    await x.service.restoreAfterReopen("t");
    expect(x.recovery.restore).not.toHaveBeenCalled();
  }
});

test("unrecoverable or unreachable workspaces record why; a live workspace is silent", async () => {
  const gone = await setup({
    events: [wrapped],
    state: { kind: "unavailable", workspaceId: "w", reason: "workspace_directory_missing", message: "Directory gone." },
  });
  await gone.service.restoreAfterReopen("t");
  expect((await gone.store.read()).events.at(-1)).toMatchObject({ action: "workspace_restore_skipped", note: "Directory gone." });
  const offline = await setup({ events: [wrapped], connectError: new Error("connect ECONNREFUSED") });
  await offline.service.restoreAfterReopen("t");
  expect((await offline.store.read()).events.at(-1)?.note).toMatch(/Could not reach Paseo: connect ECONNREFUSED/);
  const failed = await setup({ events: [wrapped], restoreError: new Error("branch missing") });
  await failed.service.restoreAfterReopen("t");
  expect((await failed.store.read()).events.at(-1)?.note).toMatch(/Restoring failed: branch missing/);
  const live = await setup({
    events: [wrapped],
    state: { kind: "unavailable", workspaceId: "w", reason: "workspace_not_archived", message: "x" },
  });
  const before = (await live.store.read()).events.length;
  await live.service.restoreAfterReopen("t");
  expect((await live.store.read()).events.length).toBe(before);
});

test("one restore per card at a time, and a restore ends the wrap-up record", async () => {
  const x = await setup({ events: [wrapped] });
  await Promise.all([x.service.restoreAfterReopen("t"), x.service.restoreAfterReopen("t")]);
  expect(x.recovery.restore).toHaveBeenCalledTimes(1);
  const board = await x.store.read();
  expect(archivedByWrapup(board.events, "t")).toBe(false);
});

const wrapAt = "2026-10-15T08:31:04.763Z";
const session = (id: string, archivedAt: string, labels: Record<string, string> = {}): ArchivedSession => ({ id, archivedAt, labels });

test("sessions archived by the wrap-up come back with the workspace; others stay archived", async () => {
  const x = await setup({
    events: [{ ...wrapped, at: wrapAt }],
    sessions: [
      session("main", "2026-10-15T08:31:03.900Z"),
      session("summary", "2026-10-15T08:31:03.844Z", { "ultra-kanban": "summarizer" }),
      session("old", "2026-10-15T07:00:00.000Z"),
    ],
  });
  await x.service.restoreAfterReopen("t");
  expect(x.recovery.reviveSession.mock.calls.map((c) => c[0])).toEqual(["main"]);
  expect((await x.store.read()).events.at(-1)?.note).toMatch(/1 session\(s\) restored/);
  expect(x.recovery.close).toHaveBeenCalled();
});

test("a workspace already back still gets its wrap-up sessions; re-archiving re-stamps them", async () => {
  // The user's card: wrapped up, restored without sessions, then auto-archived and reopened again.
  const x = await setup({
    events: [
      { ...wrapped, at: wrapAt },
      { action: "workspace_restored", note: "x", at: "2026-10-15T08:56:54.994Z" },
      { action: "workspace_auto_archived", note: "x", at: "2026-10-15T08:57:12.493Z" },
    ],
    state: { kind: "unavailable", workspaceId: "w", reason: "workspace_not_archived", message: "x" },
    sessions: [session("main", "2026-10-15T08:57:12.421Z")],
  });
  await x.service.restoreAfterReopen("t");
  expect(x.recovery.restore).not.toHaveBeenCalled();
  expect(x.recovery.reviveSession).toHaveBeenCalledWith("main");
  expect((await x.store.read()).events.at(-1)).toMatchObject({ action: "sessions_restored", note: "1 session(s) restored." });
});

test("a session that cannot be revived is reported; the others still come back", async () => {
  const x = await setup({
    events: [{ ...wrapped, at: wrapAt }],
    sessions: [session("bad", wrapAt), session("good", wrapAt)],
    reviveError: new Error("provider unavailable"),
  });
  await x.service.restoreAfterReopen("t");
  const note = (await x.store.read()).events.at(-1)?.note;
  expect(note).toMatch(/1 session\(s\) restored; not restored: bad: provider unavailable/);
});

describe("unwrap in place", () => {
  const live: RecoveryState = { kind: "unavailable", workspaceId: "w", reason: "workspace_not_archived", message: "x" };

  test("restores the workspace and sessions while the card stays in Done; the wrap-up ends", async () => {
    const x = await setup({ status: "done", events: [{ ...wrapped, at: wrapAt }], sessions: [session("main", wrapAt)] });
    expect(await x.service.unwrap("t")).toEqual({ restored: true, failed: [] });
    expect(x.recovery.restore).toHaveBeenCalledWith("w");
    expect(x.recovery.reviveSession).toHaveBeenCalledWith("main");
    const board = await x.store.read();
    expect(board.tasks[0]).toMatchObject({ status: "done", revision: 3, archivedAt: null });
    expect(board.events.at(-1)).toMatchObject({ action: "workspace_restored", actor: "human" });
    expect(currentWrapup(board.events, "t")).toBeNull();
  });

  test("a kept shared workspace is not restored; its sessions come back and the wrap-up still ends", async () => {
    const kept = { action: "wrapped_up", note: "1 session(s) archived; workspace kept; card kept", at: wrapAt };
    const x = await setup({ status: "cancelled", ownsWorkspace: false, events: [kept], state: live, sessions: [session("main", wrapAt)] });
    expect(await x.service.unwrap("t")).toEqual({ restored: true, failed: [] });
    expect(x.recovery.restore).not.toHaveBeenCalled();
    expect(x.recovery.reviveSession).toHaveBeenCalledWith("main");
    expect((await x.store.read()).events.at(-1)).toMatchObject({ action: "workspace_restored", note: "Workspace already active; 1 session(s) restored." });
    // Archived by someone else after the wrap-up kept it: left alone, and the user is told.
    const other = await setup({ status: "done", ownsWorkspace: false, events: [kept] });
    await expect(other.service.unwrap("t")).rejects.toThrow(/archived outside this card's wrap-up/);
    expect(other.recovery.restore).not.toHaveBeenCalled();
  });

  test("a card that is not wrapped up is a silent no-op", async () => {
    const restored = await setup({ status: "done", events: [wrapped, { action: "workspace_restored", note: "x" }] });
    const fresh = await setup({ status: "done", ownsWorkspace: true });
    for (const x of [restored, fresh]) {
      const before = (await x.store.read()).events.length;
      expect(await x.service.unwrap("t")).toEqual({ restored: false, failed: [] });
      expect(x.connect).not.toHaveBeenCalled();
      expect((await x.store.read()).events.length).toBe(before);
    }
  });

  test("unreachable, unrecoverable and failed restores are recorded and rejected", async () => {
    const offline = await setup({ status: "done", events: [wrapped], connectError: new Error("connect ECONNREFUSED") });
    await expect(offline.service.unwrap("t")).rejects.toThrow(/Could not reach Paseo/);
    expect((await offline.store.read()).events.at(-1)).toMatchObject({ action: "workspace_restore_skipped", actor: "human" });
    const gone = await setup({
      status: "done",
      events: [wrapped],
      state: { kind: "unavailable", workspaceId: "w", reason: "workspace_directory_missing", message: "Directory gone." },
    });
    await expect(gone.service.unwrap("t")).rejects.toThrow("Directory gone.");
    expect(gone.recovery.close).toHaveBeenCalled();
    const failed = await setup({ status: "done", events: [wrapped], restoreError: new Error("branch missing") });
    await expect(failed.service.unwrap("t")).rejects.toThrow(/Restoring failed: branch missing/);
    for (const x of [offline, gone, failed]) expect(currentWrapup((await x.store.read()).events, "t")).not.toBeNull();
  });

  test("a session that fails to revive is returned; the rest is restored", async () => {
    const x = await setup({
      status: "done",
      events: [{ ...wrapped, at: wrapAt }],
      sessions: [session("bad", wrapAt), session("good", wrapAt)],
      reviveError: new Error("provider unavailable"),
    });
    expect(await x.service.unwrap("t")).toEqual({ restored: true, failed: ["bad: provider unavailable"] });
    expect((await x.store.read()).events.at(-1)?.action).toBe("workspace_restored");
  });

  test("concurrent presses restore once", async () => {
    const x = await setup({ status: "done", events: [wrapped] });
    const results = await Promise.all([x.service.unwrap("t"), x.service.unwrap("t")]);
    expect(results).toEqual([{ restored: true, failed: [] }, { restored: true, failed: [] }]);
    expect(x.recovery.restore).toHaveBeenCalledTimes(1);
    expect((await x.store.read()).events.filter((e) => e.action === "workspace_restored")).toHaveLength(1);
  });

  test("cards outside Done/Cancelled, archived or missing are rejected", async () => {
    await expect((await setup({ events: [wrapped] })).service.unwrap("t")).rejects.toThrow("Only Done or Cancelled cards can be unwrapped.");
    await expect((await setup({ status: "done", archivedAt: new Date().toISOString(), events: [wrapped] })).service.unwrap("t")).rejects.toThrow("Card is archived.");
    await expect((await setup({ status: "done" })).service.unwrap("missing")).rejects.toThrow("Task not found.");
  });
});
