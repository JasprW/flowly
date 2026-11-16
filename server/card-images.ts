import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cardImageLimit, cardImageMimeTypes, type CardImage, type Task } from "../shared/model";
import { maxImageBytes } from "../shared/composer";
import type { BoardStore } from "./store";

/**
 * Description images of cards (CARD-IMAGES-SPEC). The record is part of the
 * task; the bytes live in `<plugin data>/card-images/<taskId>/`. Files are
 * written before the board and removed again when the board write fails.
 */
type Mime = (typeof cardImageMimeTypes)[number];
const extension: Record<Mime, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };
/** Thumbnails are made by the web client at 320 px; this only stops abuse. */
const maxThumbBytes = 1024 * 1024;
const idPattern = /^img-[a-z0-9-]{1,60}$/;

export type CardImageAdd = {
  taskId: string;
  expectedRevision: number;
  image: { name: string; mimeType: Mime; data: string };
  thumb?: { mimeType: Mime; data: string };
};
export type CardImageRemove = { taskId: string; expectedRevision: number; id: string };
export type CardImageRead = { taskId: string; id: string; size: "thumb" | "full" };

const isMime = (value: string): value is Mime => (cardImageMimeTypes as readonly string[]).includes(value);

export class CardImageService {
  constructor(
    private readonly store: BoardStore,
    readonly directory = store.directory,
  ) {}
  get root() {
    return join(this.directory, "card-images");
  }
  private folder(taskId: string) {
    if (!/^[A-Za-z0-9-]+$/.test(taskId)) throw new Error("Task not found.");
    return join(this.root, taskId);
  }
  /** Absolute path of an image's file; agents read it with their own tools. */
  pathOf(taskId: string, image: Pick<CardImage, "id" | "mimeType">) {
    return cardImagePath(this.directory, taskId, image);
  }
  private thumbPathOf(taskId: string, image: Pick<CardImage, "id" | "thumbMimeType">) {
    return image.thumbMimeType ? join(this.folder(taskId), `${image.id}.thumb.${extension[image.thumbMimeType]}`) : null;
  }
  private async writeAtomic(path: string, data: Buffer) {
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, data, { mode: 0o600 });
    await rename(temporary, path);
  }

  async add(input: CardImageAdd): Promise<{ task: Task }> {
    const name = input.image.name.trim().slice(0, 120) || "Image";
    if (!isMime(input.image.mimeType)) throw new Error(`${name} is not a PNG, JPEG, GIF or WebP image.`);
    const data = Buffer.from(input.image.data, "base64");
    if (!data.length) throw new Error(`${name} is empty.`);
    if (data.length > maxImageBytes) throw new Error(`${name} is larger than 5 MB.`);
    const thumb = input.thumb && isMime(input.thumb.mimeType) ? Buffer.from(input.thumb.data, "base64") : null;
    const thumbMimeType = thumb && thumb.length && thumb.length <= maxThumbBytes ? input.thumb!.mimeType : undefined;
    const image: CardImage = {
      id: `img-${randomUUID()}`,
      name,
      mimeType: input.image.mimeType,
      bytes: data.length,
      ...(thumbMimeType ? { thumbMimeType } : {}),
      createdAt: new Date().toISOString(),
    };
    const folder = this.folder(input.taskId);
    // Cheap checks first, so a refused add writes nothing.
    const before = await this.store.read();
    this.check(before.tasks.find((t) => t.id === input.taskId), input.expectedRevision, true, archivedOf(before, input.taskId));
    const written = [this.pathOf(input.taskId, image)];
    await mkdir(folder, { recursive: true, mode: 0o700 });
    try {
      await this.writeAtomic(written[0], data);
      const thumbPath = this.thumbPathOf(input.taskId, image);
      if (thumbPath && thumb) {
        written.push(thumbPath);
        await this.writeAtomic(thumbPath, thumb);
      }
      const task = await this.store.mutate((board) => {
        const task = board.tasks.find((t) => t.id === input.taskId);
        this.check(task, input.expectedRevision, true, archivedOf(board, input.taskId));
        task!.images = [...(task!.images || []), image];
        this.touch(task!);
        return { ...task! };
      });
      return { task };
    } catch (error) {
      await Promise.all(written.map((path) => rm(path, { force: true })));
      throw error;
    }
  }

  async remove(input: CardImageRemove): Promise<{ task: Task }> {
    let removed: CardImage | undefined;
    const task = await this.store.mutate((board) => {
      const task = board.tasks.find((t) => t.id === input.taskId);
      this.check(task, input.expectedRevision, false, archivedOf(board, input.taskId));
      removed = task!.images?.find((i) => i.id === input.id);
      if (!removed) throw new Error("This image no longer exists.");
      const rest = task!.images!.filter((i) => i.id !== input.id);
      if (rest.length) task!.images = rest;
      else delete task!.images;
      this.touch(task!);
      return { ...task! };
    });
    const paths = [this.pathOf(input.taskId, removed!), this.thumbPathOf(input.taskId, removed!)].filter((p): p is string => !!p);
    await Promise.all(paths.map((path) => rm(path, { force: true })));
    return { task };
  }

  async read(input: CardImageRead): Promise<{ dataUri: string }> {
    const task = (await this.store.read()).tasks.find((t) => t.id === input.taskId);
    const image = idPattern.test(input.id) ? task?.images?.find((i) => i.id === input.id) : undefined;
    if (!task || !image) throw new Error("This image no longer exists.");
    const thumbPath = input.size === "thumb" ? this.thumbPathOf(task.id, image) : null;
    try {
      if (thumbPath) {
        const data = await readFile(thumbPath).catch(() => null);
        if (data) return { dataUri: `data:${image.thumbMimeType};base64,${data.toString("base64")}` };
      }
      const data = await readFile(this.pathOf(task.id, image));
      return { dataUri: `data:${image.mimeType};base64,${data.toString("base64")}` };
    } catch {
      throw new Error("This image no longer exists.");
    }
  }

  /** Removes files no card refers to (plugin start). Returns how many files went. */
  async cleanup(): Promise<number> {
    const board = await this.store.read();
    const kept = new Map<string, Set<string>>();
    for (const task of board.tasks) {
      if (!task.images?.length) continue;
      const names = new Set<string>();
      for (const image of task.images) {
        names.add(`${image.id}.${extension[image.mimeType]}`);
        if (image.thumbMimeType) names.add(`${image.id}.thumb.${extension[image.thumbMimeType]}`);
      }
      kept.set(task.id, names);
    }
    let count = 0;
    for (const entry of await readdir(this.root, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isDirectory()) continue;
      const folder = join(this.root, entry.name);
      const names = kept.get(entry.name);
      for (const file of await readdir(folder).catch(() => [] as string[])) {
        if (names?.has(file)) continue;
        await rm(join(folder, file), { force: true });
        count++;
      }
      if (!names) await rm(folder, { recursive: true, force: true });
    }
    return count;
  }

  /** Card delete and project Remove: each card's folder moves into `removed/` (TASK-DELETE-SPEC). */
  async removeTasks(taskIds: Iterable<string>, now = new Date()): Promise<string[]> {
    const moved: string[] = [];
    const stamp = now.toISOString().replace(/[:.]/g, "-");
    for (const taskId of taskIds) {
      const from = this.folder(taskId);
      if (!(await readdir(from).catch(() => null))) continue;
      const to = join(this.directory, "removed", `task-${taskId}-images-${stamp}`);
      await mkdir(join(this.directory, "removed"), { recursive: true, mode: 0o700 });
      await rename(from, to);
      moved.push(to);
    }
    return moved;
  }

  private check(task: Task | undefined, expectedRevision: number, adding: boolean, archived: boolean): asserts task is Task {
    if (!task) throw new Error("Task not found.");
    if (archived) throw new Error("Archived cards can't be changed.");
    if (task.revision !== expectedRevision) throw new Error("Revision conflict: this card changed. Reload and try again.");
    if (adding && (task.images?.length || 0) >= cardImageLimit) throw new Error(`At most ${cardImageLimit} images per card.`);
  }
  private touch(task: Task) {
    task.revision++;
    task.updatedAt = new Date().toISOString();
  }
}

/** Whether the card or its project is archived. */
function archivedOf(board: { tasks: Task[]; projects: { id: string; archivedAt: string | null }[] }, taskId: string) {
  const task = board.tasks.find((t) => t.id === taskId);
  if (!task) return false;
  return !!task.archivedAt || !!board.projects.find((p) => p.id === task.projectId)?.archivedAt;
}

/** Absolute path of a card image's file under the plugin data folder. */
export function cardImagePath(directory: string, taskId: string, image: Pick<CardImage, "id" | "mimeType">) {
  if (!/^[A-Za-z0-9-]+$/.test(taskId) || !idPattern.test(image.id)) throw new Error("This image no longer exists.");
  return join(directory, "card-images", taskId, `${image.id}.${extension[image.mimeType]}`);
}

/** The session-context line after the description (CARD-IMAGES-SPEC §5); "" without images. */
export function cardImageContextLine(directory: string, task: Pick<Task, "id" | "images">) {
  if (!task.images?.length) return "";
  return `Card images (part of the description; view each with your image tool): ${task.images.map((i) => cardImagePath(directory, task.id, i)).join(", ")}`;
}
