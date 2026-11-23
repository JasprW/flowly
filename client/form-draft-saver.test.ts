import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { DraftSaver, FailedLoadEdits, clearAfterSaves, flushBeforeClose, readAfterSaves, fitDraftFields, mergeAfterFailedLoad, overwriteLatest } from "./form-draft-saver";
import { draftConflictMessage } from "../shared/form-drafts";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const image = (id: string) => ({ id, name: `${id}.png`, mimeType: "image/png" as const, data: "QUJD" });

function setup(fail?: (call: number) => Error | null) {
  const calls: { baseRevision: number; fields: unknown; images: { id: string; data?: string }[] }[] = [];
  let revision = 0;
  const saver = new DraftSaver(async (input) => {
    calls.push(input);
    const error = fail?.(calls.length);
    if (error) throw error;
    if (input.baseRevision !== revision) throw new Error(draftConflictMessage);
    return { revision: ++revision };
  });
  return { saver, calls, setRevision: (r: number) => (revision = r) };
}

test("typing saves once, 400 ms after the last change, never per keystroke", async () => {
  const { saver, calls } = setup();
  saver.loaded(0, []);
  saver.change({ fields: { title: "a" }, images: [] });
  saver.change({ fields: { title: "ab" }, images: [] });
  await vi.advanceTimersByTimeAsync(399);
  expect(calls).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(1);
  expect(calls).toEqual([{ baseRevision: 0, fields: { title: "ab" }, images: [] }]);
});

test("closing flushes the pending change at once and chains revisions", async () => {
  const { saver, calls } = setup();
  saver.loaded(0, []);
  saver.change({ fields: { title: "a" }, images: [] });
  expect(await saver.flush()).toBe(true);
  saver.change({ fields: { title: "b" }, images: [] });
  expect(await saver.flush()).toBe(true);
  expect(calls.map((c) => c.baseRevision)).toEqual([0, 1]);
  expect(saver.dirty).toBe(false);
});

test("an image's data is sent once; later saves name it by id", async () => {
  const { saver, calls } = setup();
  saver.loaded(0, ["old"]);
  saver.change({ fields: {}, images: [image("old"), image("new")] });
  await saver.flush();
  saver.change({ fields: { title: "x" }, images: [image("new")] });
  await saver.flush();
  expect(calls[0].images).toEqual([{ id: "old", name: "old.png", mimeType: "image/png" }, { ...image("new") }]);
  expect(calls[1].images).toEqual([{ id: "new", name: "new.png", mimeType: "image/png" }]);
});

test("a failed save keeps the input unsaved and reports it; discard drops only unsaved changes", async () => {
  const { saver, calls } = setup((n) => (n === 1 ? new Error("disk full") : null));
  const states: string[] = [];
  const watched = new DraftSaver(async () => {
    throw new Error("disk full");
  }, (s) => states.push(s.error));
  watched.loaded(0, []);
  watched.change({ fields: { title: "keep" }, images: [] });
  expect(await watched.flush()).toBe(false);
  expect(watched.dirty).toBe(true);
  expect(states.at(-1)).toBe("disk full");
  watched.discard();
  expect(watched.dirty).toBe(false);
  expect(watched.state.error).toBe("");
  // The retry after a failure sends the same content again.
  saver.loaded(0, []);
  saver.change({ fields: { title: "again" }, images: [] });
  expect(await saver.flush()).toBe(false);
  expect(await saver.flush()).toBe(true);
  expect(calls.slice(-2).map((c) => c.fields)).toEqual([{ title: "again" }, { title: "again" }]);
});

test("a stale revision is a conflict; overwrite saves on top of the newer one", async () => {
  const { saver, calls, setRevision } = setup();
  saver.loaded(0, []);
  setRevision(3); // another window saved meanwhile
  saver.change({ fields: { title: "mine" }, images: [] });
  expect(await saver.flush()).toBe(false);
  expect(saver.state.conflict).toBe(true);
  expect(await saver.overwrite(3)).toBe(true);
  expect(calls.at(-1)).toMatchObject({ baseRevision: 3, fields: { title: "mine" } });
});

test("conflict retry after a clear uses the revision read reports, not 0", async () => {
  const { saver, calls, setRevision } = setup();
  saver.loaded(1, []);
  setRevision(2); // another window created and cleared the draft: no draft left, next save names 2
  saver.change({ fields: { title: "mine" }, images: [] });
  expect(await saver.flush()).toBe(false);
  expect(saver.state.conflict).toBe(true);
  expect(await overwriteLatest(saver, async () => ({ revision: 2, draft: null }))).toBe(true);
  expect(calls.at(-1)).toMatchObject({ baseRevision: 2, fields: { title: "mine" } });
  expect(saver.state.conflict).toBe(false);
});

test("a draft that failed to load is never saved over", async () => {
  const { saver, calls } = setup();
  saver.disable();
  saver.change({ fields: { title: "" }, images: [] });
  await vi.advanceTimersByTimeAsync(1000);
  expect(await saver.flush()).toBe(true);
  expect(calls).toHaveLength(0);
});

test("the saver reports the revision it last loaded or saved", async () => {
  const { saver } = setup();
  saver.loaded(0, []);
  saver.change({ fields: { title: "a" }, images: [] });
  await saver.flush();
  expect(saver.currentRevision).toBe(1);
});

test("text longer than a draft holds is saved empty, so the draft save never blocks a create", () => {
  const long = "x".repeat(20001);
  expect(fitDraftFields({ prompt: long, title: "kept", startAgent: true, tags: ["a"] })).toEqual({ prompt: "", title: "kept", startAgent: true, tags: ["a"] });
});

test("Retry after a failed load keeps what was typed and what was saved", () => {
  const saved = { fields: { title: "saved title", prompt: "", priority: "high", status: "design", tags: ["a"], operationId: "card-saved" }, images: [image("s")] };
  // The form after the failed load started from defaults…
  const base = { fields: { title: "", prompt: "", priority: "normal", status: "todo", tags: [], operationId: "card-typed" }, images: [] };
  // …and the user then typed a title and prompt, raised the priority and added a tag and an image.
  const typed = { fields: { title: "typed title", prompt: "typed prompt", priority: "urgent", status: "todo", tags: ["b"], operationId: "card-typed" }, images: [image("t")] };
  expect(mergeAfterFailedLoad(saved, typed, base)).toEqual({
    // Untouched defaults (status) never override the saved choice; the saved operationId stays.
    fields: { title: "saved title\n\ntyped title", prompt: "typed prompt", priority: "urgent", status: "design", tags: ["a", "b"], operationId: "card-saved" },
    images: [image("s"), image("t")],
  });
  // Nothing changed after the failed load: the loaded draft is used as is.
  expect(mergeAfterFailedLoad(saved, base, base)).toBeNull();
  expect(mergeAfterFailedLoad(saved, null, base)).toBeNull();
  // No saved draft: what was typed becomes the draft.
  expect(mergeAfterFailedLoad(null, typed, base)).toEqual(typed);
});

test("a merge never holds more images than the form: added images stay, saved ones that do not fit are counted", () => {
  const saved = { fields: {}, images: ["s1", "s2", "s3", "s4"].map(image) };
  const base = { fields: {}, images: [] };
  const typed = { fields: {}, images: [image("t")] };
  const merged = mergeAfterFailedLoad(saved, typed, base, 4);
  expect(merged?.images.map((i) => i.id)).toEqual(["s1", "s2", "s3", "t"]);
  expect(merged?.leftOut).toBe(1);
  // Within the limit nothing is left out.
  expect(mergeAfterFailedLoad(saved, typed, base, 8)).toEqual({ fields: {}, images: [...saved.images, image("t")] });
});

test("edits made while a load failed survive failed retries and are merged only into the same key", () => {
  const edits = new FailedLoadEdits();
  const defaults = { fields: { title: "" }, images: [] };
  const typed = { fields: { title: "typed" }, images: [image("t")] };
  expect(edits.begin("task:p:plain", false)).toBeNull(); // first load fails
  edits.started(defaults);
  edits.changed(typed);
  // Retry fails too: the remounted form shows the edits and its mount is not a new starting point.
  expect(edits.begin("task:p:plain", true)).toEqual({ typed, base: defaults });
  expect(edits.shown("task:p:plain")).toEqual(typed);
  edits.started(typed);
  // The next Retry still has both.
  expect(edits.begin("task:p:plain", true)).toEqual({ typed, base: defaults });
  // Another project's draft never receives them, even while the old load had failed.
  expect(edits.begin("task:q:plain", true)).toBeNull();
  expect(edits.shown("task:q:plain")).toBeNull();
  expect(edits.begin("task:p:plain", true)).toBeNull();
  // A successful load starts over.
  edits.changed(typed);
  edits.reset();
  expect(edits.begin("task:p:plain", true)).toEqual({ typed: null, base: null });
});

test("clearing after a create waits for a save on its way and names the revision it produced", async () => {
  vi.useRealTimers();
  let finish: (() => void) | undefined;
  const saver = new DraftSaver(() => new Promise((resolve) => (finish = () => resolve({ revision: 2 }))));
  saver.loaded(1, []);
  saver.change({ fields: { title: "last" }, images: [] });
  const saving = saver.flush();
  for (let i = 0; i < 20 && !finish; i++) await Promise.resolve();
  expect(finish).toBeTypeOf("function"); // the save is on its way
  const cleared: number[] = [];
  const clearing = clearAfterSaves(saver, async (revision) => {
    cleared.push(revision);
    return { ok: revision === 2 };
  });
  await Promise.resolve();
  expect(cleared).toEqual([]);
  finish!();
  await saving;
  expect(await clearing).toBe(true);
  expect(cleared).toEqual([2]);
  // A draft another window saved meanwhile is kept, and the caller is told.
  expect(await clearAfterSaves(saver, async () => ({ ok: false }))).toBe(false);
});

test("a reload saves pending edits before it reads, and a superseded load applies nothing", async () => {
  const { saver, calls } = setup();
  saver.loaded(0, []);
  saver.change({ fields: { title: "typed before reopening" }, images: [] }); // still inside the 400 ms debounce
  const order: string[] = [];
  const loaded = await readAfterSaves(saver, () => true, async () => {
    order.push(`read after ${calls.length} save(s)`);
    return "draft";
  });
  expect(order).toEqual(["read after 1 save(s)"]);
  expect(calls[0].fields).toEqual({ title: "typed before reopening" });
  expect(loaded).toEqual({ result: "draft" });
  // A Retry that a newer load replaced while it was reading applies nothing.
  let newest = true;
  expect(
    await readAfterSaves(saver, () => newest, async () => {
      newest = false;
      return "older draft";
    }),
  ).toBeNull();
  // Superseded before the read: no read at all.
  let read = false;
  expect(await readAfterSaves(saver, () => false, async () => (read = true))).toBeNull();
  expect(read).toBe(false);
});

test("a reload whose save fails reads nothing and keeps the edit pending", async () => {
  const { saver } = setup(() => new Error("disk full"));
  saver.loaded(0, []);
  saver.change({ fields: { title: "unsaved" }, images: [] });
  let read = false;
  const loaded = await readAfterSaves(saver, () => true, async () => (read = true));
  expect(read).toBe(false);
  expect(loaded).toEqual({ unsaved: { fields: { title: "unsaved" }, images: [] } });
  expect(saver.dirty).toBe(true);
  expect(saver.state.error).toMatch(/disk full/);
});

test("closing after a failed load keeps the form open only while it holds edits nothing saved", async () => {
  const edits = new FailedLoadEdits();
  let flushed = 0;
  // The disabled saver of a failed load reports success without writing.
  const saver = { flush: async () => (++flushed, true) };
  const key = "task:p:plain";
  edits.begin(key, false);
  edits.started({ fields: { title: "" }, images: [] });
  // Untouched form: Esc / Cancel close it as usual.
  expect(await flushBeforeClose(saver, edits, key, true)).toBe(true);
  edits.changed({ fields: { title: "typed after the failure" }, images: [] });
  expect(edits.pending(key)).toBe(true);
  expect(await flushBeforeClose(saver, edits, key, true)).toBe(false);
  // Typed back to where it started: nothing to lose.
  edits.changed({ fields: { title: "" }, images: [] });
  expect(await flushBeforeClose(saver, edits, key, true)).toBe(true);
  // An added image counts as an edit too.
  edits.changed({ fields: { title: "" }, images: [image("t")] });
  expect(await flushBeforeClose(saver, edits, key, true)).toBe(false);
  // Another key, a loaded form, and Close without saving (reset) all go through the saver.
  expect(await flushBeforeClose(saver, edits, "task:q:plain", true)).toBe(true);
  expect(await flushBeforeClose(saver, edits, key, false)).toBe(true);
  edits.reset();
  expect(await flushBeforeClose(saver, edits, key, true)).toBe(true);
  expect(flushed).toBe(5);
});
