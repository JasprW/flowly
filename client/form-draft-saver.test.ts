import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { DraftSaver } from "./form-draft-saver";
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

test("a draft that failed to load is never saved over", async () => {
  const { saver, calls } = setup();
  saver.disable();
  saver.change({ fields: { title: "" }, images: [] });
  await vi.advanceTimersByTimeAsync(1000);
  expect(await saver.flush()).toBe(true);
  expect(calls).toHaveLength(0);
});
