import { appendFile, mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { RETENTION_DAYS, commandRecordSchema, type CommandRecord } from "../shared/workflow-insights";

const stamp = (now: Date) => now.toISOString().replace(/[:.]/g, "-");
const safeId = (id: string) => id.replace(/[^A-Za-z0-9_-]/g, "_");
const DAY_MS = 86_400_000;

/**
 * `commands/<projectId>.jsonl`: redacted shell calls of a project's card sessions
 * (WORKFLOW-INSIGHTS-SPEC §3.4). Writes are serialized; records are deduplicated
 * by id; invalid lines are skipped, never rewritten away except by pruning.
 */
export class CommandLog {
  private tail: Promise<unknown> = Promise.resolve();
  private known = new Map<string, Set<string>>();
  private pruned = new Map<string, string>();
  /** Deleted cards and removed projects: late appends must not bring them back. */
  private forgotten = new Set<string>();
  constructor(readonly directory: string) {}
  get folder() {
    return join(this.directory, "commands");
  }
  path(projectId: string) {
    return join(this.folder, `${safeId(projectId)}.jsonl`);
  }
  private queue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.tail.then(job);
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
  private async load(projectId: string): Promise<CommandRecord[]> {
    let text: string;
    try {
      text = await readFile(this.path(projectId), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const out: CommandRecord[] = [];
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        const parsed = commandRecordSchema.safeParse(JSON.parse(line));
        if (parsed.success) out.push(parsed.data);
      } catch {
        // a torn or invalid line
      }
    }
    return out;
  }
  private async rewrite(projectId: string, records: readonly CommandRecord[]) {
    const temporary = `${this.path(projectId)}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, records.map((r) => JSON.stringify(r) + "\n").join(""), { mode: 0o600 });
      await rename(temporary, this.path(projectId));
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
    this.known.set(projectId, new Set(records.map((r) => r.id)));
  }
  /** Appends new records; the first write of a day drops records older than RETENTION_DAYS. */
  append(projectId: string, records: readonly CommandRecord[], now = new Date()) {
    if (!records.length) return Promise.resolve(0);
    return this.queue(async () => {
      if (this.forgotten.has(projectId)) return 0;
      let ids = this.known.get(projectId);
      if (!ids) {
        ids = new Set((await this.load(projectId)).map((r) => r.id));
        this.known.set(projectId, ids);
      }
      const fresh = records.filter((r, i) => !ids!.has(r.id) && !this.forgotten.has(r.taskId) && records.findIndex((o) => o.id === r.id) === i);
      if (!fresh.length) return 0;
      await mkdir(this.folder, { recursive: true, mode: 0o700 });
      const day = now.toISOString().slice(0, 10);
      if (this.pruned.get(projectId) !== day) {
        this.pruned.set(projectId, day);
        const all = await this.load(projectId);
        const cutoff = now.getTime() - RETENTION_DAYS * DAY_MS;
        const kept = all.filter((r) => Date.parse(r.at) >= cutoff);
        if (kept.length !== all.length) await this.rewrite(projectId, kept);
        ids = this.known.get(projectId)!;
      }
      await appendFile(this.path(projectId), fresh.map((r) => JSON.stringify(r) + "\n").join(""), { mode: 0o600 });
      for (const r of fresh) ids.add(r.id);
      return fresh.length;
    });
  }
  /** Records at or after `since` (ms). */
  async read(projectId: string, since = 0): Promise<CommandRecord[]> {
    await this.tail;
    return (await this.load(projectId)).filter((r) => Date.parse(r.at) >= since);
  }
  /** Projects with a log on disk. */
  async projects(): Promise<string[]> {
    try {
      return (await readdir(this.folder)).filter((n) => n.endsWith(".jsonl")).map((n) => n.slice(0, -6));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }
  /** Permanent card delete: the card's lines go to `removed/`, the log is rewritten without them. */
  removeTask(projectId: string, taskId: string, now = new Date()) {
    this.forgotten.add(taskId);
    return this.queue(async () => {
      const all = await this.load(projectId);
      const removed = all.filter((r) => r.taskId === taskId);
      if (!removed.length) return null;
      const folder = join(this.directory, "removed");
      await mkdir(folder, { recursive: true, mode: 0o700 });
      const backup = join(folder, `task-${safeId(taskId)}-commands-${stamp(now)}.jsonl`);
      await writeFile(backup, removed.map((r) => JSON.stringify(r) + "\n").join(""), { mode: 0o600, flag: "wx" });
      await this.rewrite(projectId, all.filter((r) => r.taskId !== taskId));
      return backup;
    });
  }
  /** Project Remove: the whole log moves to `removed/`. */
  removeProject(projectId: string, now = new Date()) {
    this.forgotten.add(projectId);
    return this.queue(async () => {
      this.known.delete(projectId);
      const folder = join(this.directory, "removed");
      await mkdir(folder, { recursive: true, mode: 0o700 });
      const backup = join(folder, `${safeId(projectId)}-commands-${stamp(now)}.jsonl`);
      try {
        await rename(this.path(projectId), backup);
        return backup;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    });
  }
  /** Project folder restore: the project and its cards may be logged again. */
  remember(projectId: string, taskIds: Iterable<string>) {
    this.forgotten.delete(projectId);
    for (const id of taskIds) this.forgotten.delete(id);
  }
  /** "Delete collected commands": every project's log, no backup (the user asked for it). */
  purge() {
    return this.queue(async () => {
      const names = await this.projects();
      for (const name of names) await unlink(join(this.folder, `${name}.jsonl`)).catch(() => undefined);
      this.known.clear();
      this.pruned.clear();
      return names.length;
    });
  }
}
