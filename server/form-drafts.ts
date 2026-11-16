import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { logFailure } from "./error-report";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { BoardStore } from "./store";
import type { Board } from "../shared/model";
import {
  draftConflictMessage,
  formDraftStateSchema,
  parseFormDraftKey,
  type DraftImageInput,
  type FormDraftFields,
  type FormDraftState,
  type ReadDraft,
  type StoredDraft,
} from "../shared/form-drafts";

const extension = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" } as const;
const empty = (): FormDraftState => ({ version: 1, drafts: {} });
/** The revision the next save must name: the live draft's, else the last cleared one's, else 0. */
const revisionOf = (state: FormDraftState, key: string) => state.drafts[key]?.revision ?? state.cleared?.[key] ?? 0;

/** Whether the draft's project (New task) or card (New session) is still live. */
function scopeLive(board: Board, key: string) {
  const { kind, scopeId } = parseFormDraftKey(key);
  if (kind === "task") return board.projects.some((p) => p.id === scopeId && !p.archivedAt);
  const task = board.tasks.find((t) => t.id === scopeId);
  return !!task && !task.archivedAt && board.projects.some((p) => p.id === task.projectId && !p.archivedAt);
}

/**
 * New task / New session drafts (docs/FORM-DRAFTS-SPEC.md): serialized writes,
 * atomic replace, stale revisions refused, an invalid file preserved.
 */
export class FormDraftStore {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(
    readonly directory: string,
    readonly board: BoardStore,
    readonly clock = () => Date.now(),
  ) {}
  get path() {
    return join(this.directory, "form-drafts.json");
  }
  get imageDirectory() {
    return join(this.directory, "form-draft-images");
  }
  private async load(): Promise<FormDraftState> {
    try {
      return formDraftStateSchema.parse(JSON.parse(await readFile(this.path, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return empty();
      throw new Error(`Draft data is invalid; preserved at ${this.path}. ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  private async write(state: FormDraftState) {
    const next = formDraftStateSchema.parse(state);
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      // Synced before the rename, so a power loss never leaves a truncated draft file.
      const file = await open(temporary, "w", 0o600);
      try {
        await file.writeFile(JSON.stringify(next));
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporary, this.path);
    } catch (error) {
      // A failed cleanup must not hide why the write failed.
      await rm(temporary, { force: true }).catch((e) => logFailure("Flowly form draft temp cleanup failed:", e));
      throw error;
    }
  }
  private serialize<T>(job: () => Promise<T>): Promise<T> {
    const run = this.tail.then(job);
    this.tail = run.then(() => undefined, () => undefined);
    return run;
  }
  private async removeFiles(files: readonly string[]) {
    await Promise.all(files.map((file) => rm(join(this.imageDirectory, file), { force: true })));
  }

  read(key: string): Promise<{ revision: number; draft: ReadDraft }> {
    return this.serialize(async () => {
      const state = await this.load();
      const draft = state.drafts[key];
      if (!draft) return { revision: revisionOf(state, key), draft: null };
      if (!scopeLive(await this.board.read(), key)) {
        delete state.drafts[key];
        if (state.cleared) delete state.cleared[key];
        await this.write(state);
        await this.removeFiles(draft.images.map((i) => i.file));
        return { revision: 0, draft: null };
      }
      const images = [];
      for (const image of draft.images) {
        try {
          const data = (await readFile(join(this.imageDirectory, image.file))).toString("base64");
          images.push({ id: image.id, name: image.name, mimeType: image.mimeType, data });
        } catch {
          // A missing file drops only that image; the rest of the draft is kept.
        }
      }
      return { revision: draft.revision, draft: { revision: draft.revision, fields: draft.fields, images } };
    });
  }

  save(input: { key: string; baseRevision: number; fields: FormDraftFields; images: DraftImageInput[] }) {
    return this.serialize(async () => {
      const state = await this.load();
      const current = state.drafts[input.key];
      if (revisionOf(state, input.key) !== input.baseRevision) throw new Error(draftConflictMessage);
      if (!scopeLive(await this.board.read(), input.key)) throw new Error("Project or task is unavailable or archived.");
      const known = new Map((current?.images || []).map((i) => [i.id, i]));
      const written: string[] = [];
      const images: StoredDraft["images"] = [];
      try {
        for (const image of input.images) {
          const previous = known.get(image.id);
          if (image.data === undefined) {
            if (!previous) throw new Error("An image of this draft is missing; attach it again.");
            images.push({ ...previous, name: image.name });
            continue;
          }
          await mkdir(this.imageDirectory, { recursive: true, mode: 0o700 });
          const file = `${randomUUID()}.${extension[image.mimeType]}`;
          await writeFile(join(this.imageDirectory, file), Buffer.from(image.data, "base64"), { mode: 0o600 });
          written.push(file);
          images.push({ id: image.id, name: image.name, mimeType: image.mimeType, file });
        }
        const revision = revisionOf(state, input.key) + 1;
        state.drafts[input.key] = { revision, updatedAt: new Date(this.clock()).toISOString(), fields: input.fields, images };
        if (state.cleared) delete state.cleared[input.key];
        await this.write(state);
      } catch (error) {
        // Not committed: the new files are referenced by nothing. A failed cleanup must not hide the save error.
        await this.removeFiles(written).catch((e) => logFailure("Flowly form draft image rollback failed:", e));
        throw error;
      }
      // Committed: the new files are referenced now; an old file that cannot be removed is only logged.
      const kept = new Set(images.map((i) => i.file));
      await this.removeFiles((current?.images || []).map((i) => i.file).filter((f) => !kept.has(f))).catch((e) =>
        logFailure("Flowly form draft image cleanup failed:", e),
      );
      return { revision: state.drafts[input.key].revision };
    });
  }

  /** With `revision`, only that revision is cleared: a newer draft from another window is kept (`ok: false`). */
  clear(key: string, revision?: number) {
    return this.serialize(async () => {
      const state = await this.load();
      const draft = state.drafts[key];
      if (!draft) return { ok: true };
      if (revision !== undefined && draft.revision !== revision) return { ok: false };
      delete state.drafts[key];
      (state.cleared ??= {})[key] = draft.revision;
      await this.write(state);
      await this.removeFiles(draft.images.map((i) => i.file));
      return { ok: true };
    });
  }

  /** Drops drafts whose project or card is gone or archived. */
  prune() {
    return this.serialize(async () => {
      const state = await this.load();
      const board = await this.board.read();
      const files: string[] = [];
      let removed = 0;
      for (const [key, draft] of Object.entries(state.drafts))
        if (!scopeLive(board, key)) {
          files.push(...draft.images.map((i) => i.file));
          delete state.drafts[key];
          removed++;
        }
      for (const key of Object.keys(state.cleared || {}))
        if (!scopeLive(board, key)) {
          delete state.cleared![key];
          removed++;
        }
      if (!removed) return 0;
      await this.write(state);
      await this.removeFiles(files);
      return removed;
    });
  }
}
