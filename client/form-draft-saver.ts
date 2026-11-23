import { draftConflictMessage, formDraftTextLimit, type DraftImageInput, type FormDraftFields } from "../shared/form-drafts";

/** What a form saves: its fields and the images it has read in. */
export type DraftSnapshot = {
  fields: FormDraftFields;
  images: readonly { id: string; name: string; mimeType: DraftImageInput["mimeType"]; data: string }[];
};
export type DraftSaveState = { saving: boolean; error: string; conflict: boolean };
type Save = (input: { baseRevision: number; fields: FormDraftFields; images: DraftImageInput[] }) => Promise<{ revision: number }>;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Debounced, serialized draft saving for New task / New session
 * (docs/FORM-DRAFTS-SPEC.md §3). Never runs in the keystroke path: `change`
 * only stores the snapshot and restarts a timer. A failed save keeps the
 * snapshot as unsaved; `discard` drops it (Close without saving).
 */
export class DraftSaver {
  private revision = 0;
  private savedImages = new Set<string>();
  private pending: DraftSnapshot | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<boolean> = Promise.resolve(true);
  private enabled = false;
  state: DraftSaveState = { saving: false, error: "", conflict: false };

  constructor(
    private readonly save: Save,
    private readonly onState: (state: DraftSaveState) => void = () => undefined,
    private readonly delay = 400,
  ) {}

  /** The draft was read: later saves build on this revision. */
  loaded(revision: number, imageIds: readonly string[]) {
    this.revision = revision;
    this.savedImages = new Set(imageIds);
    this.enabled = true;
  }
  /** The draft could not be read: never save, so nothing overwrites it. */
  disable() {
    this.enabled = false;
    this.cancelTimer();
    this.pending = null;
  }
  get dirty() {
    return !!this.pending;
  }
  /** What is not saved yet (after a failed save, the snapshot it tried). */
  get unsaved() {
    return this.pending;
  }
  /** The revision of the last successful load or save. */
  get currentRevision() {
    return this.revision;
  }

  change(snapshot: DraftSnapshot) {
    if (!this.enabled) return;
    this.pending = snapshot;
    this.cancelTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.delay);
  }

  /** Saves what is unsaved now; true when nothing is left unsaved. */
  flush(): Promise<boolean> {
    this.cancelTimer();
    const run = this.running.then(() => this.saveOnce());
    this.running = run.catch(() => false);
    return run;
  }

  /** After a conflict: keep this form's version on top of the newer one. */
  overwrite(revision: number) {
    this.revision = revision;
    this.savedImages.clear();
    return this.flush();
  }

  /** Close without saving: drop the changes since the last successful save. */
  discard() {
    this.cancelTimer();
    this.pending = null;
    this.setState({ saving: false, error: "", conflict: false });
  }

  stop() {
    this.cancelTimer();
  }

  private async saveOnce(): Promise<boolean> {
    const snapshot = this.pending;
    if (!snapshot || !this.enabled) return !this.pending;
    this.pending = null;
    this.setState({ saving: true, error: "", conflict: false });
    try {
      const result = await this.save({
        baseRevision: this.revision,
        fields: snapshot.fields,
        images: snapshot.images.map((i) =>
          this.savedImages.has(i.id) ? { id: i.id, name: i.name, mimeType: i.mimeType } : { id: i.id, name: i.name, mimeType: i.mimeType, data: i.data },
        ),
      });
      this.revision = result.revision;
      this.savedImages = new Set(snapshot.images.map((i) => i.id));
      this.setState({ saving: false, error: "", conflict: false });
      return !this.pending;
    } catch (e) {
      // Newer typing wins; otherwise this snapshot stays unsaved.
      this.pending ??= snapshot;
      const text = message(e);
      // The daemon lost an image it should have: send them all again next time.
      if (/attach it again/.test(text)) this.savedImages.clear();
      this.setState({ saving: false, error: text, conflict: text.includes(draftConflictMessage) });
      return false;
    }
  }

  private cancelTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
  private setState(next: DraftSaveState) {
    this.state = next;
    this.onState(next);
  }
}

/**
 * After a successful create: waits for a save already on its way (so its
 * revision is the one named), then clears that revision. False when another
 * window saved a newer draft, which is kept.
 */
export async function clearAfterSaves(saver: DraftSaver, clear: (revision: number) => Promise<{ ok: boolean }>) {
  saver.discard();
  saver.disable();
  await saver.flush();
  return (await clear(saver.currentRevision)).ok;
}

/**
 * A (re)load: an edit still waiting for its save, or a save on its way, lands
 * first so the read includes it; then saving stops until the read is applied.
 * If that save fails nothing is read: `unsaved` is the edit, still pending in
 * the saver (with its error), for the form to show again. Null when a newer
 * load (or a close) superseded this one, before or after the read; a read
 * error is thrown as is.
 */
export async function readAfterSaves<T>(
  saver: DraftSaver,
  current: () => boolean,
  read: () => Promise<T>,
): Promise<{ result: T } | { unsaved: DraftSnapshot } | null> {
  const saved = await saver.flush().catch(() => false);
  if (!current()) return null;
  const unsaved = saver.unsaved;
  if (!saved && unsaved) return { unsaved };
  saver.disable();
  const result = await read();
  return current() ? { result } : null;
}

/**
 * What the user changed while a draft's load failed (docs/FORM-DRAFTS-SPEC.md §3):
 * kept over failed retries of the same key, merged into the first load that
 * succeeds, and never carried to another key.
 */
export class FailedLoadEdits {
  private key: string | null = null;
  private typed: DraftSnapshot | null = null;
  private base: DraftSnapshot | null = null;
  /** A load of `key` starts; what to merge when it retries that key after a failure. */
  begin(key: string, afterFailure: boolean) {
    const retrying = afterFailure && this.key === key;
    if (!retrying) this.reset();
    this.key = key;
    return retrying ? { typed: this.typed, base: this.base } : null;
  }
  /** The form's content when it mounted; a remount after a failed retry keeps the first one. */
  started(snapshot: DraftSnapshot) {
    if (!this.base) this.base = snapshot;
  }
  changed(snapshot: DraftSnapshot) {
    this.typed = snapshot;
  }
  /** Whether the form holds edits made after a failed load of `key` (nothing saves them). */
  pending(key: string) {
    return this.key === key && !!this.typed && JSON.stringify(this.typed) !== JSON.stringify(this.base);
  }
  /** What a form remounted after a failed load of `key` shows: the edits so far. */
  shown(key: string) {
    return this.key === key ? this.typed : null;
  }
  /** A load succeeded (the form starts over from it), or the edits were discarded. */
  reset() {
    this.typed = null;
    this.base = null;
  }
}

/**
 * Before a close: saves what is pending. False keeps the form open: the save
 * failed, or the load of `key` failed and the form holds edits nothing can save
 * (the user picks Retry or Close without saving, FORM-DRAFTS-SPEC §3).
 */
export function flushBeforeClose(saver: Pick<DraftSaver, "flush">, edits: FailedLoadEdits, key: string | null, loadFailed: boolean) {
  if (key && loadFailed && edits.pending(key)) return Promise.resolve(false);
  return saver.flush();
}

/**
 * Retry after a conflict: save this form's version on top of the current one.
 * Uses the revision the daemon says the next save must name, which is nonzero
 * after a clear even though no draft is left.
 */
export async function overwriteLatest(saver: DraftSaver, read: () => Promise<{ revision: number }>) {
  const latest = await read();
  return saver.overwrite(latest.revision);
}

/**
 * Text longer than a draft can hold is saved as empty: the open form keeps it
 * and creating still uses it, but it is not kept across a close.
 */
export function fitDraftFields(fields: FormDraftFields): FormDraftFields {
  const out: FormDraftFields = {};
  for (const [name, value] of Object.entries(fields)) out[name] = typeof value === "string" && value.length > formDraftTextLimit ? "" : value;
  return out;
}

/** Free text both sides may have written; other strings are choices, where the typed one wins. */
const joinText = new Set(["title", "description", "prompt"]);
const keepSaved = new Set(["operationId"]);

/**
 * After Retry on a failed load: the loaded draft combined with what the user
 * changed meanwhile (`typed` compared with the form's starting point `base`),
 * so neither is lost. Changed choices win; title, description and instruction
 * both sides wrote differently are kept as both (saved first, then typed); the
 * saved operationId is kept; images are joined. Returns null when nothing was
 * changed (the loaded draft is used as is).
 *
 * Images stay within `imageLimit` (what the form can hold, so the saved
 * selection is the one the form shows): the images added after the failed
 * load are all kept, and saved images that no longer fit are left out and
 * counted in `leftOut`, so the form can say so.
 */
export function mergeAfterFailedLoad(
  loaded: { fields: FormDraftFields; images: DraftSnapshot["images"] } | null,
  typed: DraftSnapshot | null,
  base: DraftSnapshot | null,
  imageLimit = Number.POSITIVE_INFINITY,
): (DraftSnapshot & { leftOut?: number }) | null {
  if (!typed) return null;
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const changed = Object.keys(typed.fields).filter((name) => !same(typed.fields[name], base?.fields[name]));
  const baseImages = new Set((base?.images || []).map((i) => i.id));
  const added = typed.images.filter((i) => !baseImages.has(i.id));
  if (!changed.length && !added.length) return null;
  if (!loaded) return typed;
  const fields: FormDraftFields = { ...loaded.fields };
  for (const name of changed) {
    const value = typed.fields[name];
    const before = loaded.fields[name];
    if (typeof value === "string") {
      // The saved create identity may already name a created card: it always wins.
      if (keepSaved.has(name) && typeof before === "string" && before) continue;
      fields[name] = joinText.has(name) && typeof before === "string" && before.trim() && value.trim() && before !== value ? `${before}\n\n${value}` : value;
    } else if (Array.isArray(value)) {
      fields[name] = Array.isArray(before) ? [...before, ...value.filter((v) => !before.includes(v))] : value;
    } else fields[name] = value;
  }
  const ids = new Set(loaded.images.map((i) => i.id));
  const fresh = added.filter((i) => !ids.has(i.id)).slice(0, imageLimit);
  const room = Math.max(0, imageLimit - fresh.length);
  const images = [...loaded.images.slice(0, room), ...fresh];
  const leftOut = loaded.images.length - Math.min(room, loaded.images.length);
  return leftOut > 0 ? { fields, images, leftOut } : { fields, images };
}
