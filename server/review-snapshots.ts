import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { writeFileAtomic } from "./board-file";

/** A review start's per-file content digests (AUTO-REVIEW-SPEC §3.6). */
export type ReviewSnapshot = { startedAt: string; files: ReadonlyMap<string, string> };

const idPattern = /^[A-Za-z0-9-]{1,100}$/;

/**
 * Each card's latest review snapshot, in `<plugin data>/review-snapshots/<taskId>.json`, so a rework round after a
 * plugin restart still tells this round's changes from the previous delivery's (§3.6). Daemon-only: never in the board.
 * A missing or unreadable file reads as no snapshot.
 */
export class ReviewSnapshots {
  /** What this run wrote or read, so a failed write still serves this run; null: known to be absent. */
  private cache = new Map<string, ReviewSnapshot | null>();
  constructor(readonly directory: string) {}
  get root() {
    return join(this.directory, "review-snapshots");
  }
  private pathOf(taskId: string) {
    return idPattern.test(taskId) ? join(this.root, `${taskId}.json`) : null;
  }

  async get(taskId: string): Promise<ReviewSnapshot | undefined> {
    if (this.cache.has(taskId)) return this.cache.get(taskId) ?? undefined;
    const path = this.pathOf(taskId);
    const snapshot = path ? parse(await readFile(path, "utf8").catch(() => "")) : undefined;
    this.cache.set(taskId, snapshot ?? null);
    return snapshot;
  }

  /** Replaces the card's snapshot; `undefined` removes it. Kept in memory even when the write fails. */
  async set(taskId: string, snapshot: ReviewSnapshot | undefined) {
    this.cache.set(taskId, snapshot ?? null);
    const path = this.pathOf(taskId);
    if (!path) return;
    if (!snapshot) return void (await rm(path, { force: true }));
    await writeFileAtomic(path, JSON.stringify({ version: 1, startedAt: snapshot.startedAt, files: Object.fromEntries(snapshot.files) }));
  }

  /** Card delete and project Remove: tries every card, then reports the first failure. */
  async remove(taskIds: Iterable<string>) {
    const failed = (await Promise.allSettled([...taskIds].map((id) => this.set(id, undefined)))).find((r) => r.status === "rejected");
    if (failed) throw failed.reason;
  }

  /** Plugin start: drops the files of cards that no longer exist. Returns how many went. */
  async cleanup(existing: ReadonlySet<string>): Promise<number> {
    let count = 0;
    for (const name of await readdir(this.root).catch(() => [] as string[])) {
      // Only finished files: a `.tmp` may be a write in progress.
      if (!name.endsWith(".json") || existing.has(name.slice(0, -5))) continue;
      this.cache.delete(name.slice(0, -5));
      await rm(join(this.root, name), { force: true });
      count++;
    }
    return count;
  }
}

function parse(text: string): ReviewSnapshot | undefined {
  if (!text) return undefined;
  try {
    const value = JSON.parse(text) as { version?: unknown; startedAt?: unknown; files?: unknown };
    if (value?.version !== 1 || typeof value.startedAt !== "string" || !value.files || typeof value.files !== "object" || Array.isArray(value.files)) return undefined;
    const files = new Map<string, string>();
    for (const [path, digest] of Object.entries(value.files as Record<string, unknown>)) {
      if (typeof digest !== "string") return undefined;
      files.set(path, digest);
    }
    return { startedAt: value.startedAt, files };
  } catch {
    return undefined;
  }
}
