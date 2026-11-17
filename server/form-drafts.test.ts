import { afterEach, expect, test } from "vitest";
import { mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BoardStore } from "./store";
import { FormDraftStore } from "./form-drafts";
import { draftConflictMessage, formDraftKey } from "../shared/form-drafts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});

const png = Buffer.from("fake-png").toString("base64");

async function setup() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "flowly-form-drafts-")));
  roots.push(root);
  const board = new BoardStore(join(root, "data"));
  const now = new Date().toISOString();
  await board.mutate((b) => {
    for (const id of ["p", "q"])
      b.projects.push({ id, paseoProjectId: `n-${id}`, title: id, description: "", primaryPath: root, repos: [root], revision: 1, createdAt: now, updatedAt: now, archivedAt: null });
    for (const id of ["t", "u"])
      b.tasks.push({ id, projectId: "p", workspaceId: `w-${id}`, sourcePath: root, repoPaths: [root], title: id, description: "", status: "todo", priority: "normal", position: 0, revision: 1, operationId: `o-${id}`, createdAt: now, updatedAt: now, archivedAt: null });
  });
  return { board, drafts: new FormDraftStore(board.directory, board) };
}

test("keys separate projects, cards and prefill sources", () => {
  expect(formDraftKey("task", "p")).toBe("task:p:plain");
  expect(formDraftKey("task", "p", { ideaId: "i1" })).toBe("task:p:idea:i1");
  expect(formDraftKey("task", "p", { insightFindingId: "f1" })).toBe("task:p:insight:f1");
  expect(formDraftKey("task", "p", { followUpOf: "t" })).toBe("task:p:follow:t");
  expect(formDraftKey("session", "t", { ideaId: "i1" })).toBe("session:t:idea:i1");
  expect(formDraftKey("session", "bad id")).toBeNull();
});

test("a saved draft reads back with its images, per key", async () => {
  const { drafts } = await setup();
  expect(await drafts.read("task:p:plain")).toEqual({ revision: 0, draft: null });
  const saved = await drafts.save({
    key: "task:p:plain",
    baseRevision: 0,
    fields: { title: "Half", startAgent: false, tags: ["ui"] },
    images: [{ id: "img-1", name: "a.png", mimeType: "image/png", data: png }],
  });
  expect(saved.revision).toBe(1);
  const read = await drafts.read("task:p:plain");
  expect(read.draft).toMatchObject({ revision: 1, fields: { title: "Half", startAgent: false, tags: ["ui"] } });
  expect(read.draft?.images).toEqual([{ id: "img-1", name: "a.png", mimeType: "image/png", data: png }]);
  // Other projects, cards and sources see nothing.
  for (const key of ["task:q:plain", "task:p:idea:i1", "session:t:plain", "session:u:plain"])
    expect((await drafts.read(key)).draft).toBeNull();
});

test("a stale revision is refused and does not overwrite the newer draft", async () => {
  const { drafts } = await setup();
  await drafts.save({ key: "session:t:plain", baseRevision: 0, fields: { prompt: "first" }, images: [] });
  await drafts.save({ key: "session:t:plain", baseRevision: 1, fields: { prompt: "second" }, images: [] });
  await expect(drafts.save({ key: "session:t:plain", baseRevision: 1, fields: { prompt: "stale" }, images: [] })).rejects.toThrow(draftConflictMessage);
  await expect(drafts.save({ key: "session:t:plain", baseRevision: 0, fields: { prompt: "blank" }, images: [] })).rejects.toThrow(draftConflictMessage);
  expect((await drafts.read("session:t:plain")).draft?.fields.prompt).toBe("second");
});

test("images are sent once, then referenced; dropped images lose their files", async () => {
  const { drafts } = await setup();
  const key = "session:t:plain";
  await drafts.save({ key, baseRevision: 0, fields: {}, images: [{ id: "a", name: "a.png", mimeType: "image/png", data: png }, { id: "b", name: "b.png", mimeType: "image/png", data: png }] });
  expect(await readdir(drafts.imageDirectory)).toHaveLength(2);
  await drafts.save({ key, baseRevision: 1, fields: {}, images: [{ id: "a", name: "a.png", mimeType: "image/png" }] });
  expect(await readdir(drafts.imageDirectory)).toHaveLength(1);
  expect((await drafts.read(key)).draft?.images.map((i) => i.id)).toEqual(["a"]);
  // A reference to an image the daemon does not have is refused, and nothing changes.
  await expect(drafts.save({ key, baseRevision: 2, fields: {}, images: [{ id: "zzz", name: "z.png", mimeType: "image/png" }] })).rejects.toThrow(/attach it again/);
  expect((await drafts.read(key)).draft?.revision).toBe(2);
  await drafts.clear(key);
  expect((await drafts.read(key)).draft).toBeNull();
  expect(await readdir(drafts.imageDirectory)).toHaveLength(0);
});

test("drafts of archived cards or projects cannot be saved and read as none", async () => {
  const { board, drafts } = await setup();
  await drafts.save({ key: "session:t:plain", baseRevision: 0, fields: { prompt: "x" }, images: [] });
  await drafts.save({ key: "task:q:plain", baseRevision: 0, fields: { title: "x" }, images: [] });
  await board.mutate((b) => {
    b.tasks.find((t) => t.id === "t")!.archivedAt = new Date().toISOString();
    b.projects.find((p) => p.id === "q")!.archivedAt = new Date().toISOString();
  });
  await expect(drafts.save({ key: "session:t:plain", baseRevision: 1, fields: {}, images: [] })).rejects.toThrow(/unavailable/);
  await expect(drafts.save({ key: "session:missing:plain", baseRevision: 0, fields: {}, images: [] })).rejects.toThrow(/unavailable/);
  expect(await drafts.prune()).toBe(2);
  expect((await drafts.read("session:t:plain")).draft).toBeNull();
  expect((await drafts.read("task:q:plain")).draft).toBeNull();
});

test("a draft dropped with its archived scope keeps its revision marker, so a stale window cannot save after a restore", async () => {
  const { board, drafts } = await setup();
  await drafts.save({ key: "session:t:plain", baseRevision: 0, fields: { prompt: "old" }, images: [] }); // a window holds revision 1
  await drafts.save({ key: "session:u:plain", baseRevision: 0, fields: { prompt: "old" }, images: [] });
  const archive = (ids: string[], at: string | null) =>
    board.mutate((b) => {
      for (const id of ids) b.tasks.find((t) => t.id === id)!.archivedAt = at;
    });
  await archive(["t"], new Date().toISOString());
  expect(await drafts.prune()).toBe(1); // t's draft
  expect(await drafts.prune()).toBe(0); // its marker stays; nothing left to drop
  await archive(["u"], new Date().toISOString());
  expect(await drafts.read("session:u:plain")).toEqual({ revision: 2, draft: null }); // dropped on read instead
  await archive(["t", "u"], null);
  for (const key of ["session:t:plain", "session:u:plain"]) {
    expect(await drafts.read(key)).toEqual({ revision: 2, draft: null });
    await expect(drafts.save({ key, baseRevision: 1, fields: { prompt: "stale" }, images: [] })).rejects.toThrow(draftConflictMessage);
    expect((await drafts.save({ key, baseRevision: 2, fields: { prompt: "new" }, images: [] })).revision).toBe(3);
  }
});

test("invalid data is preserved, never reset", async () => {
  const { drafts } = await setup();
  await writeFile(drafts.path, "{not json");
  await expect(drafts.read("task:p:plain")).rejects.toThrow(/preserved/);
  await expect(drafts.save({ key: "task:p:plain", baseRevision: 0, fields: { title: "x" }, images: [] })).rejects.toThrow(/preserved/);
  expect(await readFile(drafts.path, "utf8")).toBe("{not json");
});

test("concurrent saves from the same revision: exactly one wins", async () => {
  const { drafts } = await setup();
  const results = await Promise.allSettled(
    ["a", "b", "c"].map((title) => drafts.save({ key: "task:p:plain", baseRevision: 0, fields: { title }, images: [] })),
  );
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect((await drafts.read("task:p:plain")).draft?.revision).toBe(1);
});

test("a failed write leaves no temporary file and keeps the previous draft", async () => {
  const { drafts } = await setup();
  await drafts.save({ key: "task:p:plain", baseRevision: 0, fields: { title: "kept" }, images: [] });
  const { chmod } = await import("node:fs/promises");
  await chmod(drafts.directory, 0o500);
  try {
    await expect(drafts.save({ key: "task:p:plain", baseRevision: 1, fields: { title: "lost" }, images: [] })).rejects.toThrow();
  } finally {
    await chmod(drafts.directory, 0o700);
  }
  expect((await readdir(drafts.directory)).filter((f) => f.includes(".tmp"))).toEqual([]);
  expect((await drafts.read("task:p:plain")).draft).toMatchObject({ revision: 1, fields: { title: "kept" } });
});

test("revisions never repeat after a clear, so a stale window cannot save over a newer draft", async () => {
  const { drafts } = await setup();
  const key = "session:t:plain";
  await drafts.save({ key, baseRevision: 0, fields: { prompt: "old" }, images: [] }); // window A holds revision 1
  await drafts.clear(key);
  expect(await drafts.read(key)).toEqual({ revision: 2, draft: null });
  // Window B starts fresh from what it read.
  expect((await drafts.save({ key, baseRevision: 2, fields: { prompt: "new" }, images: [] })).revision).toBe(3);
  // Window A, still at revision 1, is refused.
  await expect(drafts.save({ key, baseRevision: 1, fields: { prompt: "stale" }, images: [] })).rejects.toThrow(draftConflictMessage);
  await expect(drafts.save({ key, baseRevision: 0, fields: { prompt: "stale" }, images: [] })).rejects.toThrow(draftConflictMessage);
  expect((await drafts.read(key)).draft?.fields.prompt).toBe("new");
});

test("a window still holding the cleared revision cannot recreate the cleared draft", async () => {
  const { drafts } = await setup();
  const key = "task:p:plain";
  await drafts.save({ key, baseRevision: 0, fields: { title: "made" }, images: [] }); // both windows hold revision 1
  expect(await drafts.clear(key, 1)).toEqual({ ok: true }); // window A created the card
  // Window B saves before any replacement draft exists.
  await expect(drafts.save({ key, baseRevision: 1, fields: { title: "made" }, images: [] })).rejects.toThrow(draftConflictMessage);
  expect(await drafts.read(key)).toEqual({ revision: 2, draft: null });
  // Its explicit Retry names the revision read() reports and succeeds.
  expect((await drafts.save({ key, baseRevision: 2, fields: { title: "mine" }, images: [] })).revision).toBe(3);
});

test("a clear naming an older revision keeps the newer draft", async () => {
  const { drafts } = await setup();
  const key = "task:p:plain";
  await drafts.save({ key, baseRevision: 0, fields: { title: "A" }, images: [{ id: "a", name: "a.png", mimeType: "image/png", data: png }] });
  await drafts.save({ key, baseRevision: 1, fields: { title: "B" }, images: [{ id: "a", name: "a.png", mimeType: "image/png" }] });
  expect(await drafts.clear(key, 1)).toEqual({ ok: false });
  expect((await drafts.read(key)).draft).toMatchObject({ revision: 2, fields: { title: "B" } });
  expect(await readdir(drafts.imageDirectory)).toHaveLength(1);
  expect(await drafts.clear(key, 2)).toEqual({ ok: true });
  expect((await drafts.read(key)).draft).toBeNull();
});
