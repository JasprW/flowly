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
 */
export function mergeAfterFailedLoad(
  loaded: { fields: FormDraftFields; images: DraftSnapshot["images"] } | null,
  typed: DraftSnapshot | null,
  base: DraftSnapshot | null,
): DraftSnapshot | null {
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
  return { fields, images: [...loaded.images, ...added.filter((i) => !ids.has(i.id))] };
}
