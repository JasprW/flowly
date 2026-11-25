import { afterEach, expect, test, vi } from "vitest";
import type { PaseoApi } from "@getpaseo/client";
import { mkdtemp, mkdir, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BoardStore } from "./store";
import { BoardService, resolveWorktreeBaseRef } from "./service";
import { operationReusedMessage } from "../shared/model";
import {
  projectInput,
  taskInput,
  taskEdit,
  projectEdit,
} from "../shared/model";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const git = promisify(execFile),
  roots: string[] = [];
async function setup() {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "ultra-single-root-")),
  );
  roots.push(root);
  const a = join(root, "project-root"),
    b = join(root, "old-second-repo");
  await mkdir(a);
  await mkdir(b);
  const store = new BoardStore(join(root, "data")),
    service = new BoardService(store),
    now = new Date().toISOString();
  await store.mutate((board) =>
    board.projects.push({
      id: "p",
      paseoProjectId: "native",
      title: "Legacy project",
      description: "",
      primaryPath: a,
      repos: [a, b],
      revision: 1,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    }),
  );
  const create = vi.fn(async (_options: unknown) => ({ id: "workspace" }));
  const refresh = vi.fn(async () => ({
    id: "workspace",
    projectId: "foreign-native",
    workspaceDirectory: a,
    workspaceKind: "directory",
    status: "done",
  }));
  const paseo = {
    workspaces: { create, ref: () => ({ refresh }) },
  } as unknown as PaseoApi;
  const input = {
    projectId: "p",
    operationId: "op",
    title: "New card",
    description: "",
    status: "todo" as const,
    priority: "normal" as const,
    mode: "directory" as const,
    baseRef: "",
  };
  return { root, a, b, store, service, paseo, create, refresh, input };
}
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((p) => rm(p, { recursive: true, force: true })),
  );
});

test("new card uses only native root even in a previously multi-repo project", async () => {
  const x = await setup(),
    card = await x.service.createTask(x.input, x.paseo);
  expect(card).toMatchObject({ sourcePath: x.a, repoPaths: [x.a] });
  expect(x.create.mock.calls[0][0]).toMatchObject({
    source: { kind: "directory", path: x.a, projectId: "native" },
  });
  expect((await x.service.context(card.id, x.paseo)).directories).toEqual([
    { repo: x.a, directory: x.a },
  ]);
  expect((await x.service.createTask(x.input, x.paseo)).id).toBe(card.id);
  expect(x.create).toHaveBeenCalledTimes(1);
});
test("a common parent directory contains two repositories without registering each separately", async () => {
  const x = await setup();
  await mkdir(join(x.a, "repo-one"));
  await mkdir(join(x.a, "repo-two"));
  const card = await x.service.createTask(x.input, x.paseo);
  expect(card.sourcePath).toBe(x.a);
  expect((await x.service.context(card.id, x.paseo)).context).toContain(
    "Native Paseo project root: " + x.a,
  );
  expect(x.create.mock.calls[0][0]).toMatchObject({ source: { path: x.a } });
});
test("new board project links the exact native Paseo root and persists only that directory", async () => {
  const x = await setup(),
    nativeRoot = join(x.root, "common-root");
  await mkdir(nativeRoot);
  await mkdir(join(nativeRoot, "repo-one"));
  await mkdir(join(nativeRoot, "repo-two"));
  const native = {
    projectId: "new-native",
    projectRootPath: nativeRoot,
    projectDisplayName: "Common root",
  };
  const paseo = {
    projects: { list: async () => ({ projects: [native] }) },
  } as unknown as PaseoApi;
  const created = await x.service.createProject(
    {
      title: "Combined",
      description: "",
      primaryPath: nativeRoot,
      paseoProjectId: "new-native",
    },
    paseo,
  );
  expect(created).toMatchObject({
    paseoProjectId: "new-native",
    primaryPath: nativeRoot,
    repos: [nativeRoot],
    // Auto review is on for new projects (GUARDRAILS-SPEC D1).
    autoReview: { enabled: true, maxRounds: 2 },
  });
  await expect(
    x.service.createProject(
      {
        title: "Again",
        description: "",
        primaryPath: nativeRoot,
        paseoProjectId: "new-native",
      },
      paseo,
    ),
  ).rejects.toThrow("already linked");
  await expect(
    x.service.createProject(
      {
        title: "Wrong root",
        description: "",
        primaryPath: x.a,
        paseoProjectId: "new-native",
      },
      paseo,
    ),
  ).rejects.toThrow("root does not match");
});
test("existing workspace inside a child repo is eligible through common project root", async () => {
  const x = await setup(),
    child = join(x.a, "repo-one");
  await mkdir(child);
  x.refresh.mockResolvedValue({
    ...(await x.refresh()),
    workspaceDirectory: child,
  });
  const card = await x.service.createTask(
    { ...x.input, mode: "existing", workspaceId: "workspace" },
    x.paseo,
  );
  expect(card).toMatchObject({ sourcePath: x.a, repoPaths: [x.a] });
  expect(
    (await x.service.context(card.id, x.paseo)).workspaceRepoPaths,
  ).toEqual([x.a]);
});
test("worktree originates from native root and default base resolves its named branch", async () => {
  const x = await setup();
  await git("git", ["-C", x.a, "init", "-b", "root-main"]);
  await git("git", ["-C", x.b, "init", "-b", "secondary-release"]);
  const card = await x.service.createTask(
    { ...x.input, mode: "worktree", branchName: "single-root", baseRef: "" },
    x.paseo,
  );
  expect(card.sourcePath).toBe(x.a);
  // Kept on the card for the review's own change (GUARDRAILS-SPEC §6.2).
  expect(card.baseRef).toBe("refs/heads/root-main");
  expect(x.create.mock.calls[0][0]).toMatchObject({
    source: {
      kind: "worktree",
      cwd: x.a,
      projectId: "native",
      refName: "refs/heads/root-main",
    },
  });
  expect(await resolveWorktreeBaseRef(x.a, "HEAD")).toBe(
    "refs/heads/root-main",
  );
});
test("non-Git common root requires a directory workspace", async () => {
  const x = await setup();
  await expect(
    x.service.createTask(
      { ...x.input, mode: "worktree", branchName: "feature" },
      x.paseo,
    ),
  ).rejects.toThrow("Enter a valid base ref");
  expect(x.create).not.toHaveBeenCalled();
  await x.service.createTask(x.input, x.paseo);
  expect(x.create).toHaveBeenCalledTimes(1);
});
test("corrected base ref uses a new native request key in the same card operation", async () => {
  const x = await setup(),
    input = {
      ...x.input,
      mode: "worktree" as const,
      branchName: "feature",
      baseRef: "invalid",
    };
  x.create.mockRejectedValueOnce(new Error("Invalid base ref"));
  await expect(x.service.createTask(input, x.paseo)).rejects.toThrow(
    "Invalid base ref",
  );
  await x.service.createTask({ ...input, baseRef: "main" }, x.paseo);
  const first = x.create.mock.calls[0][0] as { idempotencyKey: string },
    second = x.create.mock.calls[1][0] as { idempotencyKey: string };
  expect(first.idempotencyKey).not.toBe(second.idempotencyKey);
  expect((await x.store.read()).tasks).toHaveLength(1);
});
test("existing root workspace retains foreign native owner and cannot bind twice", async () => {
  const x = await setup(),
    input = { ...x.input, mode: "existing" as const, workspaceId: "workspace" };
  const card = await x.service.createTask(input, x.paseo);
  expect(card).toMatchObject({
    sourcePath: x.a,
    repoPaths: [x.a],
    workspaceId: "workspace",
  });
  await expect(
    x.service.createTask({ ...input, operationId: "other" }, x.paseo),
  ).rejects.toThrow("already bound");
  expect(x.create).not.toHaveBeenCalled();
  expect((await x.refresh()).projectId).toBe("foreign-native");
});
test("new card cannot link workspace in secondary legacy repo or outside root", async () => {
  const x = await setup(),
    input = { ...x.input, mode: "existing" as const, workspaceId: "workspace" };
  x.refresh.mockResolvedValue({
    ...(await x.refresh()),
    workspaceDirectory: x.b,
  });
  await expect(x.service.createTask(input, x.paseo)).rejects.toThrow("outside");
  x.refresh.mockResolvedValue({
    ...(await x.refresh()),
    workspaceDirectory: x.store.directory,
  });
  await expect(x.service.createTask(input, x.paseo)).rejects.toThrow("outside");
  x.refresh.mockResolvedValue(null as never);
  await expect(x.service.createTask(input, x.paseo)).rejects.toThrow(
    "unavailable",
  );
  expect((await x.store.read()).tasks).toHaveLength(0);
});
test("legacy card retains saved two-directory context and workspace", async () => {
  const x = await setup(),
    now = new Date().toISOString();
  x.refresh.mockResolvedValue({
    ...(await x.refresh()),
    workspaceDirectory: x.b,
    workspaceKind: "directory",
  });
  await x.store.mutate((board) =>
    board.tasks.push({
      id: "old",
      projectId: "p",
      workspaceId: "workspace",
      sourcePath: x.b,
      repoPaths: [],
      title: "Old",
      description: "",
      status: "todo",
      priority: "normal",
      position: 0,
      revision: 1,
      operationId: "old-op",
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    }),
  );
  const context = await x.service.context("old", x.paseo);
  expect(context.available).toBe(true);
  expect(context.directories).toEqual([
    { repo: x.a, directory: x.a },
    { repo: x.b, directory: x.b },
  ]);
  expect(context.context).toContain("Legacy card scope retained");
  await x.store.editTask({
    id: "old",
    revision: 1,
    title: "Edited",
    actor: "human",
  });
  expect((await x.store.read()).tasks[0]).toMatchObject({
    sourcePath: x.b,
    repoPaths: [],
    workspaceId: "workspace",
  });
});
test("new write contracts reject old repo/source fields", () => {
  expect(() =>
    projectInput.parse({
      title: "P",
      primaryPath: "/root",
      repos: ["/root", "/other"],
    }),
  ).toThrow();
  expect(() =>
    projectEdit.parse({ id: "p", revision: 1, repos: ["/root", "/other"] }),
  ).toThrow();
  expect(() =>
    taskInput.parse({
      projectId: "p",
      operationId: "o",
      title: "T",
      mode: "directory",
      repoPaths: ["/other"],
      sourcePath: "/other",
    }),
  ).toThrow();
  expect(() =>
    taskEdit.parse({ id: "t", revision: 1, repoPaths: ["/other"] }),
  ).toThrow();
});

test("worktree branch is optional: generated name is stable per operation", async () => {
  const { generatedBranchName } = await import("./service");
  expect(generatedBranchName("Fix Login Bug!", "op-1")).toMatch(/^kanban\/fix-login-bug-[0-9a-f]{6}$/);
  expect(generatedBranchName("F1 卡片显示摘要", "op-1")).toMatch(/^kanban\/f1-[0-9a-f]{6}$/);
  expect(generatedBranchName("卡片显示摘要", "op-1")).toMatch(/^kanban\/task-[0-9a-f]{6}$/);
  expect(generatedBranchName("x", "op-1")).toBe(generatedBranchName("x", "op-1"));
  expect(generatedBranchName("x", "op-1")).not.toBe(generatedBranchName("x", "op-2"));
  expect(generatedBranchName("a".repeat(80), "op").length).toBeLessThanOrEqual(7 + 40 + 7);
});

test("worktree card without a branch name uses the generated branch", async () => {
  const x = await setup();
  await git("git", ["-C", x.a, "init", "-b", "main"]);
  await x.service.createTask({ ...x.input, mode: "worktree", branchName: "  " }, x.paseo);
  expect(x.create.mock.calls[0][0]).toMatchObject({
    source: { kind: "worktree", branchName: expect.stringMatching(/^kanban\/new-card-[0-9a-f]{6}$/) },
  });
});
test("a new card is appended after fractional or reordered positions in its column", async () => {
  const x = await setup();
  let n = 0;
  x.create.mockImplementation(async () => ({ id: `workspace-${++n}` }));
  const first = await x.service.createTask({ ...x.input, operationId: "o1" }, x.paseo);
  const second = await x.service.createTask({ ...x.input, operationId: "o2" }, x.paseo);
  await x.store.placeTask({ id: first.id, revision: first.revision, status: "todo", beforeId: null, afterId: second.id });
  const third = await x.service.createTask({ ...x.input, operationId: "o3" }, x.paseo);
  const column = (await x.store.read()).tasks.sort((a, b) => a.position - b.position).map((t) => t.id);
  expect(column).toEqual([second.id, first.id, third.id]);
  expect(third.position).toBeGreaterThan(first.position);
});

test("a repeated create returns its card, but different content under the same operationId is refused (FORM-DRAFTS-SPEC §5)", async () => {
  const x = await setup();
  let n = 0;
  x.create.mockImplementation(async () => ({ id: `workspace-${++n}` }));
  const first = await x.service.createTask({ ...x.input, title: "Draft title", description: "body" }, x.paseo);
  // A lost response retried with the same content: the same card, no second workspace.
  expect((await x.service.createTask({ ...x.input, title: " Draft title ", description: "body" }, x.paseo)).id).toBe(first.id);
  expect(x.create).toHaveBeenCalledTimes(1);
  // The card edited after a lost response: the unchanged original request still gets it back.
  await x.store.mutate((b) => {
    const card = b.tasks.find((t) => t.id === first.id)!;
    card.title = "Renamed elsewhere";
    card.description = "changed elsewhere";
  });
  expect((await x.service.createTask({ ...x.input, title: "Draft title", description: "body" }, x.paseo)).id).toBe(first.id);
  // A stale draft (clear failed, or another window) edited and submitted again: refused, never answered with the old card.
  await expect(x.service.createTask({ ...x.input, title: "Draft title", description: "edited" }, x.paseo)).rejects.toThrow(operationReusedMessage);
  await expect(x.service.createTask({ ...x.input, title: "Edited title", description: "body" }, x.paseo)).rejects.toThrow(operationReusedMessage);
  // Any other part of the request counts too: priority, tags, lane, workspace mode.
  for (const change of [{ priority: "high" as const }, { tags: ["ui"] }, { status: "design" as const }, { mode: "worktree" as const }])
    await expect(x.service.createTask({ ...x.input, title: "Draft title", description: "body", ...change }, x.paseo)).rejects.toThrow(operationReusedMessage);
  expect((await x.store.read()).tasks.filter((t) => t.operationId === "op")).toHaveLength(1);
  // A new operationId creates the edited card.
  const second = await x.service.createTask({ ...x.input, operationId: "op-2", title: "Draft title", description: "edited" }, x.paseo);
  expect(second.id).not.toBe(first.id);
  expect(second.description).toBe("edited");
  // A card made before the fingerprint existed keeps the old behavior: its card is returned.
  await x.store.mutate((b) => {
    delete b.tasks.find((t) => t.id === second.id)!.createFingerprint;
  });
  expect((await x.service.createTask({ ...x.input, operationId: "op-2", title: "Other" }, x.paseo)).id).toBe(second.id);
});

test("resources() caches within TTL, coalesces concurrent reads, and ignores stale loads across invalidateResources()", async () => {
  const x = await setup();
  let clock = 1_000;
  const service = new BoardService(x.store, { resourcesTtlMs: 8_000, now: () => clock });
  let calls = 0;
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  let releaseSecond!: () => void;
  const secondGate = new Promise<void>((resolve) => { releaseSecond = resolve; });
  const paseo = {
    projects: {
      list: async () => {
        calls += 1;
        const n = calls;
        if (n === 1) {
          await firstGate;
          return { projects: [{ projectId: "p1", projectDisplayName: "Old", projectRootPath: x.a }] };
        }
        if (n === 2) {
          await secondGate;
          return { projects: [{ projectId: "p2", projectDisplayName: "New", projectRootPath: x.a }] };
        }
        return { projects: [{ projectId: "p3", projectDisplayName: "Expired", projectRootPath: x.a }] };
      },
    },
    workspaces: {
      list: async () => ({ entries: [], pageInfo: { nextCursor: null } }),
    },
  } as unknown as PaseoApi;

  const p1 = service.resources(paseo);
  const p1Coalesced = service.resources(paseo);
  await Promise.resolve();
  expect(calls).toBe(1);

  // Mutation invalidates resources while load 1 is still in flight; load 2 starts independently.
  service.invalidateResources();
  const p2 = service.resources(paseo);
  await Promise.resolve();
  expect(calls).toBe(2);

  // Load 2 completes first, then stale load 1 finishes later: cache must keep p2, not revert to p1.
  releaseSecond();
  expect((await p2).projects.map((p) => p.id)).toEqual(["p2"]);
  releaseFirst();
  expect((await p1).projects.map((p) => p.id)).toEqual(["p1"]);
  expect((await p1Coalesced).projects.map((p) => p.id)).toEqual(["p1"]);
  expect((await service.resources(paseo)).projects.map((p) => p.id)).toEqual(["p2"]);
  expect(calls).toBe(2);

  // After TTL expires, resources() reloads.
  clock += 8_001;
  expect((await service.resources(paseo)).projects.map((p) => p.id)).toEqual(["p3"]);
  expect(calls).toBe(3);
});
