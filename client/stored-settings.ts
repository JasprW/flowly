import { useRef } from "react";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Stored values and a patch-and-save that reloads when another writer got there first. */
// The SDK's settings state is generic in the definition; callers only need this shape.
type Stored<T> = { status: string; values?: unknown; revision?: number; saving: boolean; error?: string; saveError?: string; save(values: T, revision: never): Promise<unknown>; reload(): Promise<unknown> | void };
export function useStored<T extends object>(settings: unknown, parse: (values: unknown) => T) {
  const s = settings as Stored<T>;
  const latest = useRef(s);
  latest.current = s;
  const values = s.status === "ready" ? parse(s.values) : null;
  return {
    values,
    busy: !values || s.saving,
    problem: s.status === "error" || s.status === "invalid" ? s.error : s.saveError,
    save(patch: Partial<T>) {
      if (!values || s.saving) return;
      void (s.save as (v: T, r: unknown) => Promise<unknown>)({ ...values, ...patch }, s.revision).then((saved) => {
        if (!saved) void s.reload();
      });
    },
    /**
     * A save that must not be dropped (the welcome tour's first-run defaults): waits for the
     * settings to load, merges into the latest stored values and retries a stale revision.
     */
    async saveSure(patch: Partial<T>): Promise<boolean> {
      for (let attempt = 0; attempt < 6; attempt++) {
        const current = latest.current;
        if (current.status !== "ready" || current.revision === undefined || current.saving) {
          await wait(150);
          continue;
        }
        const next = { ...parse(current.values), ...patch };
        if (await (current.save as (v: T, r: unknown) => Promise<unknown>)(next, current.revision)) return true;
        await current.reload();
        await wait(50 * (attempt + 1));
      }
      return false;
    },
  };
}
