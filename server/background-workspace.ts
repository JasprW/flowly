import { mkdir, readFile, writeFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { PaseoApi } from "@getpaseo/client";
import { z } from "zod";
import type { Project } from "../shared/model";
import { daemonWorkspaceRecovery, type WorkspaceRecovery } from "./workspace-restore";

export const BACKGROUND_TITLE = "Flowly background";

/** What the plugin does with a remembered background workspace before a run. */
export type Revival = "live" | "restored" | "gone";
export type Revive = (workspaceId: string) => Promise<Revival>;

/**
 * COMPAT(sdk-workspace-restore): the SDK cannot restore an archived workspace, so
 * this goes over the same short-lived local connection as WORKSPACE-RESTORE-SPEC.
 * Anything Paseo cannot bring back (removed, unreachable) counts as gone: a new one is made.
 */
export function daemonRevive(recovery: WorkspaceRecovery = daemonWorkspaceRecovery()): Revive {
  return async (workspaceId) => {
    const daemon = await recovery.connect();
    try {
      const state = await daemon.inspect(workspaceId);
      if (state.kind === "recoverable") {
        await daemon.restore(workspaceId);
        return "restored";
      }
      return state.reason === "workspace_not_archived" ? "live" : "gone";
    } finally {
      await daemon.close();
    }
  };
}

const stateSchema = z.object({ version: z.literal(1), projects: z.record(z.string(), z.string()) });
type State = z.infer<typeof stateSchema>;

/**
 * Project-level temporary sessions (memory review, digest, workflow insights) run in one
 * plugin-owned workspace per project at its root, never in a card's (BACKGROUND-WORKSPACE-SPEC).
 * It is archived when the last run in it ends; the next run restores and reuses it, and only
 * makes a new one when it cannot be brought back.
 */
export class BackgroundWorkspaces {
  private slots = new Map<string, { id: string; users: number }>();
  private locks = new Map<string, Promise<unknown>>();
  private tail: Promise<unknown> = Promise.resolve();
  constructor(
    readonly directory: string,
    private revive: Revive = daemonRevive(),
  ) {}
  get path() {
    return join(this.directory, "background-workspaces.json");
  }

  /** Runs `work` with the project's background workspace open; archives it after the last run. */
  async use<T>(project: Project, paseo: PaseoApi, work: (workspaceId: string) => Promise<T>): Promise<T> {
    const id = await this.locked(project.id, async () => {
      const slot = this.slots.get(project.id);
      if (slot) {
        slot.users++;
        return slot.id;
      }
      const id = await this.open(project, paseo);
      this.slots.set(project.id, { id, users: 1 });
      return id;
    });
    try {
      return await work(id);
    } finally {
      await this.locked(project.id, async () => {
        const slot = this.slots.get(project.id);
        if (!slot || --slot.users > 0) return;
        this.slots.delete(project.id);
        await paseo.workspaces.archive(id).catch((e) =>
          console.error("Flowly could not archive its background workspace:", e instanceof Error ? e.message : String(e)),
        );
      });
    }
  }

  private async open(project: Project, paseo: PaseoApi) {
    const known = (await this.read()).projects[project.id];
    if (known) {
      const state = await this.revive(known).catch((e) => {
        console.error("Flowly could not restore its background workspace; making a new one:", e instanceof Error ? e.message : String(e));
        return "gone" as const;
      });
      if (state !== "gone") return known;
    }
    const created = await paseo.workspaces.create({
      title: BACKGROUND_TITLE,
      idempotencyKey: `flowly-background:${project.id}:${randomUUID()}`,
      source: { kind: "directory", path: project.primaryPath, projectId: project.paseoProjectId },
    });
    await this.write((state) => (state.projects[project.id] = created.id));
    return created.id;
  }

  private locked<T>(key: string, job: () => Promise<T>): Promise<T> {
    const run = (this.locks.get(key) ?? Promise.resolve()).then(job, job);
    this.locks.set(key, run.catch(() => undefined));
    return run;
  }

  private async read(): Promise<State> {
    await this.tail;
    return this.load();
  }
  private async load(): Promise<State> {
    try {
      return stateSchema.parse(JSON.parse(await readFile(this.path, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, projects: {} };
      throw new Error(`Background workspace data is invalid; preserved at ${this.path}.`);
    }
  }

  private write(change: (state: State) => void) {
    const job = this.tail.then(async () => {
      const state = await this.load();
      change(state);
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const temporary = `${this.path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(state, null, 2), { mode: 0o600 });
        await rename(temporary, this.path);
      } finally {
        await unlink(temporary).catch(() => undefined);
      }
    });
    this.tail = job.catch(() => undefined);
    return job;
  }
}

/** One per data directory, so memory review, digest and workflow insights share one workspace and count. */
const shared = new Map<string, BackgroundWorkspaces>();
export function backgroundWorkspaces(directory: string) {
  let found = shared.get(directory);
  if (!found) shared.set(directory, (found = new BackgroundWorkspaces(directory)));
  return found;
}
