import type { PaseoAgent, PaseoApi } from "@getpaseo/client";
import type { BoardStore } from "./store";
import type { Project, Task } from "../shared/model";
import { isLegacyScope } from "../shared/scope";
import { isSummarizer } from "../shared/summary";

const DEFAULT_CACHE_TTL_MS = 20_000;
const MAX_SCOPED_PROJECT_KEYS = 12;

type CachedProject = {
  at: number;
  byWorkspace: Map<string, PaseoAgent[]>;
};

/**
 * Archived and workspace-scoped sessions (PERFORMANCE-SPEC §3).
 *
 * Paseo's `agents.list` has no workspace filter, so an unfiltered full-host scan pages
 * every archived agent across all projects on the daemon. On busy daemons with thousands
 * of archived sessions, concurrent uncached scans from `sessions.archived`,
 * `sessions.archived-refs`, `usage.task`, and `flowly_get_task` saturate the daemon and
 * hit Paseo's 30 s plugin RPC timeout.
 *
 * Scoping to the workspace's native `projectKey`, coalescing concurrent scans (singleflight),
 * and keeping a short-TTL cache (invalidated on `agent.archive.after` and Flowly archive/restore
 * mutations) turns repeated multi-page storms into one small project-scoped read.
 */
export class ArchivedSessionsService {
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly workspaceProjectKeys = new Map<string, string>();
  private readonly projectCache = new Map<string, CachedProject>();
  private readonly projectInflight = new Map<string, Promise<Map<string, PaseoAgent[]>>>();

  constructor(
    readonly store: BoardStore,
    options: { ttlMs?: number; now?: () => number } = {},
  ) {
    this.ttlMs = options.ttlMs ?? DEFAULT_CACHE_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  /** Drops cached snapshots (all projects when `projectKey` is omitted). */
  invalidate(projectKey?: string) {
    if (projectKey) {
      this.projectCache.delete(projectKey);
      this.projectCache.delete("*");
    } else {
      this.projectCache.clear();
    }
  }

  /** Drops the cached snapshot owning `workspaceId` (or all snapshots when its projectKey is not cached yet). */
  invalidateWorkspace(workspaceId: string, fallbackProjectKey?: string) {
    const key = this.workspaceProjectKeys.get(workspaceId) || fallbackProjectKey;
    this.invalidate(key || undefined);
  }

  private async resolveProjectKey(
    task: Pick<Task, "workspaceId" | "repoPaths">,
    project: Pick<Project, "paseoProjectId" | "primaryPath" | "repos"> | undefined,
    paseo: PaseoApi,
  ): Promise<string | null> {
    const cached = this.workspaceProjectKeys.get(task.workspaceId);
    if (cached) return cached;
    if (typeof paseo.workspaces?.ref === "function") {
      const ws = await paseo.workspaces.ref(task.workspaceId).refresh().catch(() => null);
      const key =
        (ws as { project?: { projectKey?: string | null }; projectId?: string | null } | null)?.project?.projectKey ||
        (ws as { projectId?: string | null } | null)?.projectId ||
        "";
      if (key) {
        this.workspaceProjectKeys.set(task.workspaceId, key);
        return key;
      }
    }
    if (project?.paseoProjectId && !isLegacyScope(task, project)) return project.paseoProjectId;
    return null;
  }

  private freshCached(cacheKey: string): Map<string, PaseoAgent[]> | null {
    if (this.ttlMs <= 0) return null;
    const now = this.now();
    const hit = this.projectCache.get(cacheKey);
    if (hit && now - hit.at < this.ttlMs) return hit.byWorkspace;
    if (cacheKey !== "*") {
      const full = this.projectCache.get("*");
      if (full && now - full.at < this.ttlMs) return full.byWorkspace;
    }
    return null;
  }

  private async scanProject(projectKey: string | null, paseo: PaseoApi, fresh = false): Promise<Map<string, PaseoAgent[]>> {
    const cacheKey = projectKey || "*";
    if (!fresh) {
      const cached = this.freshCached(cacheKey);
      if (cached) return cached;
      const inflight = this.projectInflight.get(cacheKey) ?? (cacheKey !== "*" ? this.projectInflight.get("*") : undefined);
      if (inflight) return inflight;
    } else {
      this.projectCache.delete(cacheKey);
    }

    const job = (async () => {
      const byWorkspace = new Map<string, PaseoAgent[]>();
      let cursor: string | undefined;
      do {
        const filter = projectKey
          ? { includeArchived: true as const, projectKeys: [projectKey] }
          : { includeArchived: true as const };
        const page = await paseo.agents.list({ filter, page: { limit: 200, cursor } });
        for (const { agent } of page.entries) {
          if (!agent.workspaceId) continue;
          let bucket = byWorkspace.get(agent.workspaceId);
          if (!bucket) {
            bucket = [];
            byWorkspace.set(agent.workspaceId, bucket);
          }
          bucket.push(agent);
        }
        cursor = page.pageInfo.nextCursor ?? undefined;
      } while (cursor);
      if (this.ttlMs > 0) this.projectCache.set(cacheKey, { at: this.now(), byWorkspace });
      return byWorkspace;
    })();

    this.projectInflight.set(cacheKey, job);
    try {
      return await job;
    } finally {
      if (this.projectInflight.get(cacheKey) === job) this.projectInflight.delete(cacheKey);
    }
  }

  /** All sessions (live, archived, and summarizers) in a card's workspace; shared across drawer, usage, and CLI reads. */
  async workspaceAgents(taskId: string, paseo: PaseoApi, options?: { fresh?: boolean }): Promise<PaseoAgent[]> {
    const board = await this.store.read();
    const task = board.tasks.find((t) => t.id === taskId);
    if (!task) throw new Error("Task not found.");
    const project = board.projects.find((p) => p.id === task.projectId);
    const projectKey = await this.resolveProjectKey(task, project, paseo);
    const byWorkspace = await this.scanProject(projectKey, paseo, options?.fresh === true);
    return [...(byWorkspace.get(task.workspaceId) || [])];
  }

  async list(taskId: string, paseo: PaseoApi, options?: { fresh?: boolean }): Promise<PaseoAgent[]> {
    const agents = await this.workspaceAgents(taskId, paseo, options);
    return agents.filter((agent) => !!agent.archivedAt && !isSummarizer(agent));
  }

  /** Ids of the archived, non-summarizer sessions in any card's workspace (the Task chip's scan). */
  async refs(paseo: PaseoApi, options?: { fresh?: boolean }): Promise<{ id: string; workspaceId: string }[]> {
    const board = await this.store.read();
    if (!board.tasks.length) return [];
    const workspaces = new Set(board.tasks.map((t) => t.workspaceId));
    const projectsById = new Map(board.projects.map((p) => [p.id, p]));
    const keys = new Set<string>();
    let allScoped = true;
    for (const task of board.tasks) {
      const cachedKey = this.workspaceProjectKeys.get(task.workspaceId);
      if (cachedKey) {
        keys.add(cachedKey);
        continue;
      }
      const project = projectsById.get(task.projectId);
      if (project?.paseoProjectId && !isLegacyScope(task, project)) {
        keys.add(project.paseoProjectId);
      } else {
        allScoped = false;
        break;
      }
    }

    const snapshots: Map<string, PaseoAgent[]>[] = [];
    if (allScoped && keys.size > 0 && keys.size <= MAX_SCOPED_PROJECT_KEYS) {
      for (const key of keys) snapshots.push(await this.scanProject(key, paseo, options?.fresh === true));
    } else {
      snapshots.push(await this.scanProject(null, paseo, options?.fresh === true));
    }

    const seen = new Set<string>();
    const found: { id: string; workspaceId: string }[] = [];
    for (const byWorkspace of snapshots) {
      for (const workspaceId of workspaces) {
        const list = byWorkspace.get(workspaceId);
        if (!list) continue;
        for (const agent of list) {
          if (!agent.archivedAt || isSummarizer(agent) || seen.has(agent.id)) continue;
          seen.add(agent.id);
          found.push({ id: agent.id, workspaceId });
        }
      }
    }
    return found;
  }
}
