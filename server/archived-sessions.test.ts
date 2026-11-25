import { afterEach, expect, test } from "vitest";
import type { PaseoApi } from "@getpaseo/client";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BoardStore } from "./store";
import { ArchivedSessionsService } from "./archived-sessions";
import { SUMMARIZER_LABELS } from "../shared/summary";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});

test("returns only the card workspace's archived, non-summarizer sessions across pages", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "ultra-archived-")));
  roots.push(root);
  const store = new BoardStore(join(root, "data"));
  const now = new Date().toISOString();
  await store.mutate((b) => {
    b.projects.push({ id: "p", paseoProjectId: "n", title: "P", description: "", primaryPath: root, repos: [root], revision: 1, createdAt: now, updatedAt: now, archivedAt: null });
    b.tasks.push({ id: "t", projectId: "p", workspaceId: "w", sourcePath: root, repoPaths: [root], title: "T", description: "", status: "todo", priority: "normal", position: 0, revision: 1, operationId: "o", createdAt: now, updatedAt: now, archivedAt: null });
  });
  const pages = [
    [{ id: "a1", workspaceId: "w", archivedAt: now, labels: {} }, { id: "live", workspaceId: "w", archivedAt: null, labels: {} }],
    [{ id: "other", workspaceId: "x", archivedAt: now, labels: {} }, { id: "sum", workspaceId: "w", archivedAt: now, labels: { ...SUMMARIZER_LABELS } }, { id: "a2", workspaceId: "w", archivedAt: now, labels: {} }],
  ];
  const calls: unknown[] = [];
  const paseo = {
    agents: {
      list: async (options: { page: { cursor?: string } }) => {
        calls.push(options);
        const index = options.page.cursor ? 1 : 0;
        return { entries: pages[index].map((agent) => ({ agent })), pageInfo: { nextCursor: index === 0 ? "next" : null } };
      },
    },
  } as unknown as PaseoApi;
  const service = new ArchivedSessionsService(store);
  expect((await service.list("t", paseo)).map((a) => a.id)).toEqual(["a1", "a2"]);
  expect(calls).toHaveLength(2);
  await expect(service.list("missing", paseo)).rejects.toThrow(/Task not found/);
});

test("refs lists bare ids of archived, non-summarizer sessions in card workspaces only", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "ultra-archived-")));
  roots.push(root);
  const store = new BoardStore(join(root, "data"));
  const now = new Date().toISOString();
  await store.mutate((b) => {
    b.projects.push({ id: "p", paseoProjectId: "n", title: "P", description: "", primaryPath: root, repos: [root], revision: 1, createdAt: now, updatedAt: now, archivedAt: null });
    b.tasks.push({ id: "t", projectId: "p", workspaceId: "w", sourcePath: root, repoPaths: [root], title: "T", description: "", status: "todo", priority: "normal", position: 0, revision: 1, operationId: "o", createdAt: now, updatedAt: now, archivedAt: null });
  });
  const entries = [
    { id: "a1", workspaceId: "w", archivedAt: now, labels: {} },
    { id: "live", workspaceId: "w", archivedAt: null, labels: {} },
    { id: "other", workspaceId: "x", archivedAt: now, labels: {} },
    { id: "sum", workspaceId: "w", archivedAt: now, labels: { ...SUMMARIZER_LABELS } },
  ];
  const paseo = { agents: { list: async () => ({ entries: entries.map((agent) => ({ agent })), pageInfo: { nextCursor: null } }) } } as unknown as PaseoApi;
  expect(await new ArchivedSessionsService(store).refs(paseo)).toEqual([{ id: "a1", workspaceId: "w" }]);
});

test("scopes scans with projectKeys, coalesces concurrent reads, caches within TTL, and respects fresh/invalidate", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "ultra-archived-")));
  roots.push(root);
  const store = new BoardStore(join(root, "data"));
  const nowIso = new Date().toISOString();
  await store.mutate((b) => {
    b.projects.push({ id: "p", paseoProjectId: "prj_board", title: "P", description: "", primaryPath: root, repos: [root], revision: 1, createdAt: nowIso, updatedAt: nowIso, archivedAt: null });
    b.tasks.push({ id: "t", projectId: "p", workspaceId: "w", sourcePath: root, repoPaths: [root], title: "T", description: "", status: "todo", priority: "normal", position: 0, revision: 1, operationId: "o", createdAt: nowIso, updatedAt: nowIso, archivedAt: null });
  });
  let clock = 1_000;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const filters: unknown[] = [];
  let wsRefreshes = 0;
  let archivedCount = 1;
  const paseo = {
    workspaces: {
      ref: () => ({
        refresh: async () => {
          wsRefreshes++;
          return { id: "w", projectId: "prj_actual", project: { projectKey: "prj_actual" } };
        },
      }),
    },
    agents: {
      list: async (options: { filter?: unknown }) => {
        filters.push(options.filter);
        if (filters.length === 1) await gate;
        const entries = [
          { agent: { id: "live", workspaceId: "w", archivedAt: null, labels: {} } },
          { agent: { id: "a1", workspaceId: "w", archivedAt: nowIso, labels: {} } },
          ...(archivedCount > 1 ? [{ agent: { id: "a2", workspaceId: "w", archivedAt: nowIso, labels: {} } }] : []),
          { agent: { id: "sum", workspaceId: "w", archivedAt: nowIso, labels: { ...SUMMARIZER_LABELS } } },
        ];
        return { entries, pageInfo: { nextCursor: null } };
      },
    },
  } as unknown as PaseoApi;

  const service = new ArchivedSessionsService(store, { ttlMs: 10_000, now: () => clock });
  // Concurrent drawer list + usage workspaceAgents + chip refs share one in-flight project-scoped scan.
  const p1 = service.list("t", paseo);
  const p2 = service.workspaceAgents("t", paseo);
  await Promise.resolve();
  release();
  const [listed, all] = await Promise.all([p1, p2]);
  expect(listed.map((a) => a.id)).toEqual(["a1"]);
  expect(all.map((a) => a.id)).toEqual(["live", "a1", "sum"]);
  expect(filters).toEqual([{ includeArchived: true, projectKeys: ["prj_actual"] }]);
  expect(wsRefreshes).toBe(1);

  // Within TTL, list() and refs() reuse the cached snapshot without scanning again.
  expect(await service.refs(paseo)).toEqual([{ id: "a1", workspaceId: "w" }]);
  expect(filters).toHaveLength(1);

  // fresh: true bypasses the cache immediately.
  archivedCount = 2;
  expect((await service.list("t", paseo, { fresh: true })).map((a) => a.id)).toEqual(["a1", "a2"]);
  expect(filters).toHaveLength(2);
  expect(wsRefreshes).toBe(1); // workspace -> projectKey stayed cached

  // invalidate() forces the next read to scan again, and TTL expiry does too.
  service.invalidate("prj_actual");
  await service.list("t", paseo);
  expect(filters).toHaveLength(3);
  clock += 10_001;
  await service.list("t", paseo);
  expect(filters).toHaveLength(4);
});

test("legacy multi-repo card falls back to unfiltered scan when workspace refresh is unavailable", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "ultra-archived-")));
  roots.push(root);
  const store = new BoardStore(join(root, "data"));
  const nowIso = new Date().toISOString();
  await store.mutate((b) => {
    b.projects.push({ id: "p", paseoProjectId: "prj_board", title: "P", description: "", primaryPath: root, repos: [root, join(root, "r2")], revision: 1, createdAt: nowIso, updatedAt: nowIso, archivedAt: null });
    b.tasks.push({ id: "t", projectId: "p", workspaceId: "w", sourcePath: root, repoPaths: [root, join(root, "r2")], title: "T", description: "", status: "todo", priority: "normal", position: 0, revision: 1, operationId: "o", createdAt: nowIso, updatedAt: nowIso, archivedAt: null });
  });
  const filters: unknown[] = [];
  const paseo = {
    agents: {
      list: async (options: { filter?: unknown }) => {
        filters.push(options.filter);
        return { entries: [{ agent: { id: "a1", workspaceId: "w", archivedAt: nowIso, labels: {} } }], pageInfo: { nextCursor: null } };
      },
    },
  } as unknown as PaseoApi;
  const service = new ArchivedSessionsService(store);
  expect((await service.list("t", paseo)).map((a) => a.id)).toEqual(["a1"]);
  expect(filters).toEqual([{ includeArchived: true }]);
});

test("cold refs() resolves native workspace projectKeys before scanning and falls back safely for unresolved legacy cards", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "ultra-archived-")));
  roots.push(root);
  const store = new BoardStore(join(root, "data"));
  const nowIso = new Date().toISOString();
  await store.mutate((b) => {
    b.projects.push({ id: "p", paseoProjectId: "prj_board", title: "P", description: "", primaryPath: root, repos: [root], revision: 1, createdAt: nowIso, updatedAt: nowIso, archivedAt: null });
    b.tasks.push({ id: "t", projectId: "p", workspaceId: "w", sourcePath: root, repoPaths: [root], title: "T", description: "", status: "todo", priority: "normal", position: 0, revision: 1, operationId: "o", createdAt: nowIso, updatedAt: nowIso, archivedAt: null });
  });
  const seenFilters: unknown[] = [];
  const paseo = {
    workspaces: {
      ref: () => ({
        refresh: async () => ({ id: "w", projectId: "prj_actual", project: { projectKey: "prj_actual" } }),
      }),
    },
    agents: {
      list: async (options: { filter?: { projectKeys?: string[] } }) => {
        seenFilters.push(options.filter);
        // Only return the archived session when the scan actually targets the workspace's native projectKey.
        const entries = options.filter?.projectKeys?.includes("prj_actual")
          ? [{ agent: { id: "a1", workspaceId: "w", archivedAt: nowIso, labels: {} } }]
          : [];
        return { entries, pageInfo: { nextCursor: null } };
      },
    },
  } as unknown as PaseoApi;

  const coldService = new ArchivedSessionsService(store);
  expect(await coldService.refs(paseo)).toEqual([{ id: "a1", workspaceId: "w" }]);
  expect(seenFilters).toEqual([{ includeArchived: true, projectKeys: ["prj_actual"] }]);

  // Legacy card whose workspace key cannot be resolved still triggers an unfiltered fallback scan.
  await store.mutate((b) => {
    b.projects[0].repos.push(join(root, "r2"));
    b.tasks[0].repoPaths = [join(root, "r2")];
  });
  const legacyFilters: unknown[] = [];
  const legacyPaseo = {
    workspaces: { ref: () => ({ refresh: async () => null }) },
    agents: {
      list: async (options: { filter?: unknown }) => {
        legacyFilters.push(options.filter);
        return { entries: [{ agent: { id: "a1", workspaceId: "w", archivedAt: nowIso, labels: {} } }], pageInfo: { nextCursor: null } };
      },
    },
  } as unknown as PaseoApi;
  expect(await new ArchivedSessionsService(store).refs(legacyPaseo)).toEqual([{ id: "a1", workspaceId: "w" }]);
  expect(legacyFilters).toEqual([{ includeArchived: true }]);
});

test("invalidate() and fresh reads detach in-flight scans and block stale snapshot publication", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "ultra-archived-")));
  roots.push(root);
  const store = new BoardStore(join(root, "data"));
  const nowIso = new Date().toISOString();
  await store.mutate((b) => {
    b.projects.push({ id: "p", paseoProjectId: "prj_a", title: "P", description: "", primaryPath: root, repos: [root], revision: 1, createdAt: nowIso, updatedAt: nowIso, archivedAt: null });
    b.tasks.push({ id: "t", projectId: "p", workspaceId: "w", sourcePath: root, repoPaths: [root], title: "T", description: "", status: "todo", priority: "normal", position: 0, revision: 1, operationId: "o", createdAt: nowIso, updatedAt: nowIso, archivedAt: null });
  });

  let releaseScan1!: () => void;
  const scan1Gate = new Promise<void>((resolve) => { releaseScan1 = resolve; });
  let enteredScan1!: () => void;
  const scan1Started = new Promise<void>((resolve) => { enteredScan1 = resolve; });
  let releaseScan2!: () => void;
  const scan2Gate = new Promise<void>((resolve) => { releaseScan2 = resolve; });
  let enteredScan2!: () => void;
  const scan2Started = new Promise<void>((resolve) => { enteredScan2 = resolve; });
  let call = 0;
  const paseo = {
    workspaces: { ref: () => ({ refresh: async () => ({ id: "w", projectId: "prj_a", project: { projectKey: "prj_a" } }) }) },
    agents: {
      list: async () => {
        call += 1;
        const n = call;
        if (n === 1) {
          enteredScan1();
          await scan1Gate;
          return { entries: [{ agent: { id: "stale", workspaceId: "w", archivedAt: nowIso, labels: {} } }], pageInfo: { nextCursor: null } };
        }
        if (n === 2) {
          enteredScan2();
          await scan2Gate;
          return { entries: [{ agent: { id: "fresh-1", workspaceId: "w", archivedAt: nowIso, labels: {} } }], pageInfo: { nextCursor: null } };
        }
        return { entries: [{ agent: { id: "fresh-2", workspaceId: "w", archivedAt: nowIso, labels: {} } }], pageInfo: { nextCursor: null } };
      },
    },
  } as unknown as PaseoApi;

  const service = new ArchivedSessionsService(store, { ttlMs: 20_000 });
  const staleRead = service.list("t", paseo);
  await scan1Started;

  // Invalidating while scan 1 is in flight detaches it; a subsequent read starts scan 2 (and coalesces another).
  service.invalidate("prj_a");
  const newRead1 = service.list("t", paseo);
  const newRead2 = service.list("t", paseo);
  await scan2Started;
  expect(call).toBe(2);

  // Release scan 2 first, then let stale scan 1 finish afterwards: stale scan 1 must NOT overwrite fresh-1.
  releaseScan2();
  expect((await newRead1).map((a) => a.id)).toEqual(["fresh-1"]);
  expect((await newRead2).map((a) => a.id)).toEqual(["fresh-1"]);
  releaseScan1();
  await staleRead;
  expect((await service.list("t", paseo)).map((a) => a.id)).toEqual(["fresh-1"]);
  expect(call).toBe(2);

  // Global invalidate() while a scan is in flight also blocks stale cache writes.
  service.invalidate();
  let releaseScan3!: () => void;
  const scan3Gate = new Promise<void>((resolve) => { releaseScan3 = resolve; });
  let enteredScan3!: () => void;
  const scan3Started = new Promise<void>((resolve) => { enteredScan3 = resolve; });
  const paseo3 = {
    ...paseo,
    agents: {
      list: async () => {
        call += 1;
        if (call === 3) {
          enteredScan3();
          await scan3Gate;
          return { entries: [{ agent: { id: "stale-3", workspaceId: "w", archivedAt: nowIso, labels: {} } }], pageInfo: { nextCursor: null } };
        }
        return { entries: [{ agent: { id: "latest-4", workspaceId: "w", archivedAt: nowIso, labels: {} } }], pageInfo: { nextCursor: null } };
      },
    },
  } as unknown as PaseoApi;
  const r3 = service.list("t", paseo3);
  await scan3Started;
  service.invalidate();
  releaseScan3();
  expect((await r3).map((a) => a.id)).toEqual(["stale-3"]);
  // Because scan 3 was invalidated before completion, it did not populate cache -> next read scans again.
  expect((await service.list("t", paseo3)).map((a) => a.id)).toEqual(["latest-4"]);
  expect(call).toBe(4);
});
