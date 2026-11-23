import { afterEach, expect, test } from "vitest";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { agentFixture } from "./agent-fixture";
import { CardImageService, cardImageContextLine } from "./card-images";
import { cardImageLimit } from "../shared/model";
import { maxImageBytes } from "../shared/composer";
import { uploadCardImages } from "../client/card-image-upload";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
async function setup() {
  const f = await agentFixture();
  roots.push(f.root);
  return { ...f, images: new CardImageService(f.store) };
}
const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex").toString("base64");
const thumb = Buffer.from("thumbnail").toString("base64");
const revision = async (x: Awaited<ReturnType<typeof setup>>) => (await x.store.read()).tasks[0].revision;
const files = async (dir: string) => (await readdir(dir).catch(() => [] as string[])).sort();

test("add stores the image and its thumbnail, bumps the task revision and records no event", async () => {
  const x = await setup();
  const events = (await x.store.read()).events.length;
  const { task } = await x.images.add({
    taskId: "t",
    expectedRevision: 1,
    image: { name: "screen.png", mimeType: "image/png", data: png },
    thumb: { mimeType: "image/webp", data: thumb },
  });
  expect(task.revision).toBe(2);
  expect(task.images).toHaveLength(1);
  const image = task.images![0];
  expect(image).toMatchObject({ name: "screen.png", mimeType: "image/png", bytes: 16, thumbMimeType: "image/webp" });
  expect(image.id).toMatch(/^img-/);
  expect(await files(join(x.store.directory, "card-images", "t"))).toEqual([`${image.id}.png`, `${image.id}.thumb.webp`].sort());
  expect((await stat(x.images.pathOf("t", image))).mode & 0o777).toBe(0o600);
  expect((await x.store.read()).events.length).toBe(events);
  expect((await x.images.read({ taskId: "t", id: image.id, size: "thumb" })).dataUri).toBe(`data:image/webp;base64,${thumb}`);
  expect((await x.images.read({ taskId: "t", id: image.id, size: "full" })).dataUri).toBe(`data:image/png;base64,${png}`);
});

test("read without a stored thumbnail falls back to the image; unknown ids are refused", async () => {
  const x = await setup();
  const { task } = await x.images.add({ taskId: "t", expectedRevision: 1, image: { name: "a.png", mimeType: "image/png", data: png } });
  const id = task.images![0].id;
  expect((await x.images.read({ taskId: "t", id, size: "thumb" })).dataUri).toBe(`data:image/png;base64,${png}`);
  await expect(x.images.read({ taskId: "t", id: "img-missing", size: "full" })).rejects.toThrow("This image no longer exists.");
  await expect(x.images.read({ taskId: "t", id: "../../board", size: "full" })).rejects.toThrow("This image no longer exists.");
});

test("add refuses wrong types, oversized images, a full card, archived cards and stale revisions, writing nothing", async () => {
  const x = await setup();
  const dir = join(x.store.directory, "card-images", "t");
  await expect(
    x.images.add({ taskId: "t", expectedRevision: 1, image: { name: "a.bmp", mimeType: "image/bmp" as "image/png", data: png } }),
  ).rejects.toThrow("not a PNG, JPEG, GIF or WebP image");
  const big = Buffer.alloc(maxImageBytes + 1).toString("base64");
  await expect(x.images.add({ taskId: "t", expectedRevision: 1, image: { name: "big.png", mimeType: "image/png", data: big } })).rejects.toThrow(
    "larger than 5 MB",
  );
  await expect(x.images.add({ taskId: "t", expectedRevision: 9, image: { name: "a.png", mimeType: "image/png", data: png } })).rejects.toThrow(
    "Revision conflict",
  );
  await expect(x.images.add({ taskId: "nope", expectedRevision: 1, image: { name: "a.png", mimeType: "image/png", data: png } })).rejects.toThrow(
    "Task not found.",
  );
  // A failed board write leaves no file behind.
  expect(await files(dir)).toEqual([]);
  for (let i = 0; i < cardImageLimit; i++)
    await x.images.add({ taskId: "t", expectedRevision: await revision(x), image: { name: `${i}.png`, mimeType: "image/png", data: png } });
  await expect(
    x.images.add({ taskId: "t", expectedRevision: await revision(x), image: { name: "9.png", mimeType: "image/png", data: png } }),
  ).rejects.toThrow(`At most ${cardImageLimit} images per card.`);
  expect(await files(dir)).toHaveLength(cardImageLimit);
  await x.store.mutate((board) => {
    board.tasks[0].archivedAt = new Date().toISOString();
  });
  const removing = (await x.store.read()).tasks[0].images![0].id;
  await expect(x.images.remove({ taskId: "t", expectedRevision: await revision(x), id: removing })).rejects.toThrow("Archived cards can't be changed.");
});

test("remove drops the record and both files; a stale revision changes nothing", async () => {
  const x = await setup();
  const { task } = await x.images.add({
    taskId: "t",
    expectedRevision: 1,
    image: { name: "a.png", mimeType: "image/png", data: png },
    thumb: { mimeType: "image/jpeg", data: thumb },
  });
  const id = task.images![0].id;
  await expect(x.images.remove({ taskId: "t", expectedRevision: 1, id })).rejects.toThrow("Revision conflict");
  expect(await files(join(x.store.directory, "card-images", "t"))).toHaveLength(2);
  const after = await x.images.remove({ taskId: "t", expectedRevision: 2, id });
  expect(after.task.images).toBeUndefined();
  expect(after.task.revision).toBe(3);
  expect(await files(join(x.store.directory, "card-images", "t"))).toEqual([]);
});

test("cleanup removes only files no card refers to", async () => {
  const x = await setup();
  const { task } = await x.images.add({ taskId: "t", expectedRevision: 1, image: { name: "a.png", mimeType: "image/png", data: png } });
  const root = join(x.store.directory, "card-images");
  await writeFile(join(root, "t", "img-orphan.png"), "x");
  await mkdir(join(root, "gone"));
  await writeFile(join(root, "gone", "img-old.png"), "x");
  await writeFile(join(x.store.directory, "outside.png"), "x");
  expect(await x.images.cleanup()).toBe(2);
  expect(await files(join(root, "t"))).toEqual([`${task.images![0].id}.png`]);
  expect(await files(root)).toEqual(["t"]);
  expect(await files(x.store.directory)).toContain("outside.png");
});

test("deleting cards moves their images into removed/", async () => {
  const x = await setup();
  await x.images.add({ taskId: "t", expectedRevision: 1, image: { name: "a.png", mimeType: "image/png", data: png } });
  const moved = await x.images.removeTasks(["t", "never-had-images"], new Date("2026-11-13T00:00:00Z"));
  expect(moved).toEqual([join(x.store.directory, "removed", "task-t-images-2026-11-13T00-00-00-000Z")]);
  expect(await files(moved[0])).toHaveLength(1);
  expect(await files(join(x.store.directory, "card-images"))).toEqual([]);
});

test("context line lists absolute paths, nothing without images", async () => {
  const x = await setup();
  expect(cardImageContextLine(x.store.directory, (await x.store.read()).tasks[0])).toBe("");
  const { task } = await x.images.add({ taskId: "t", expectedRevision: 1, image: { name: "a.png", mimeType: "image/png", data: png } });
  expect(cardImageContextLine(x.store.directory, task)).toBe(
    `Card images (part of the description; view each with your image tool): ${x.images.pathOf("t", task.images![0])}`,
  );
});

test("an add retried with the same upload key returns the card unchanged; another key or other bytes add a new image", async () => {
  const x = await setup();
  const add = (uploadKey: string | undefined, expectedRevision: number, data = png) =>
    x.images.add({ taskId: "t", expectedRevision, image: { name: "a.png", mimeType: "image/png", data }, ...(uploadKey ? { uploadKey } : {}) });
  const first = await add("image-1-1", 1);
  expect(first.task.revision).toBe(2);
  // A retry from the same draft (even with the revision it had before the first upload) stores nothing new.
  const again = await add("image-1-1", 1);
  expect(again.task.revision).toBe(2);
  expect(again.task.images!.map((i) => i.id)).toEqual(first.task.images!.map((i) => i.id));
  expect(await files(join(x.store.directory, "card-images", "t"))).toEqual([`${first.task.images![0].id}.png`]);
  // Same key, different bytes: not the same upload.
  const other = Buffer.from("89504e470d0a1a0a0000000d4948445200", "hex").toString("base64");
  expect((await add("image-1-1", 2, other)).task.images).toHaveLength(2);
  expect((await add("image-1-2", 3)).task.images).toHaveLength(3);
  // No key: every add is a new image.
  expect((await add(undefined, 4)).task.images).toHaveLength(4);
  // A retried key on an archived card is still refused.
  await x.store.mutate((board) => {
    board.tasks[0].archivedAt = new Date().toISOString();
  });
  await expect(add("image-1-1", 5)).rejects.toThrow("Archived cards can't be changed.");
});

test("creating again from the same draft after a partial upload adds only the missing images, once each", async () => {
  const x = await setup();
  const draftImages = ["image-1-1", "image-1-2", "image-1-3"].map((id, n) => ({
    id,
    name: `${id}.png`,
    mimeType: "image/png" as const,
    data: Buffer.from(`89504e470d0a1a0a0${n}`, "hex").toString("base64"),
  }));
  // The first attempt: the second image fails (connection lost), the third still goes.
  let failSecond = true;
  const add: Parameters<typeof uploadCardImages>[0] = (input) => {
    if (failSecond && input.uploadKey === "image-1-2") return Promise.reject(new Error("Connection lost."));
    return x.images.add(input);
  };
  const first = await uploadCardImages(add, "t", 1, draftImages, async () => null, (e) => (e as Error).message);
  expect(first.problems).toEqual(["Connection lost."]);
  // Create again: the idempotent create returns the card at its current revision, then every draft image is sent again.
  failSecond = false;
  const second = await uploadCardImages(add, "t", await revision(x), draftImages, async () => null, (e) => (e as Error).message);
  expect(second.problems).toEqual([]);
  const task = (await x.store.read()).tasks[0];
  expect(task.images!.map((i) => i.uploadKey)).toEqual(["image-1-1", "image-1-3", "image-1-2"]);
  // A third attempt changes nothing.
  const third = await uploadCardImages(add, "t", task.revision, draftImages, async () => null, String);
  expect(third.revision).toBe(task.revision);
  expect((await x.store.read()).tasks[0].images).toHaveLength(3);
});
