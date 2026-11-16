import type { PaseoAgent, PaseoApi, PaseoWorkspace } from "@getpaseo/client";
import { logFailure } from "./error-report";
import { hostSupports, withHostFeature } from "./host-support";
import { metadataAgentId, metadataSession, metadataTaskId } from "../shared/session-metadata";

/** The capability name the probe remembers (PASEO-0.16-SPEC §2). */
export const METADATA_FEATURE = "metadata";

type Managed = { agentId: string; taskId: string };
/** A card's workspace: the plugin's binding, mirrored as `flowly.taskId` (PASEO-0.16-SPEC §3.6). */
type Bound = { workspaceId: string; taskId: string };
type Paseo = Pick<PaseoApi, "agents"> & Partial<Pick<PaseoApi, "workspaces">>;
type Patch = Record<string, string | null>;
/** What the plugin's own data binds now: read fresh before a pass that follows a board write. */
export type MetadataBindings = () => Promise<{ sessions: readonly Managed[]; workspaces: readonly Bound[] }>;

/**
 * Mirrors the plugin's card bindings onto Paseo metadata (PASEO-0.16-SPEC §3.4, §3.6): `flowly.taskId` and
 * `flowly.agentId` on every live card session Flowly manages (so a composer item can tell a card session's
 * composer from any other: Paseo hands an item its composer but not the session's id), and `flowly.taskId` on
 * every card's workspace. Only ids, never titles or content. Runs on the daemon, never on a client.
 *
 * A mirror, not the source of truth: the binding stays the plugin's data. A pass writes only what is missing or
 * different and clears a value the plugin no longer has (a deleted card's sessions and workspace, a session that
 * moved). Passes start after the chip refresh asks who is managed, and after a board write (`changed()`, with the
 * last connection a handler saw), so a new card or session gets its ids without a client open. A session found
 * right once is not looked at again in this daemon run unless the board changes. On a host without metadata
 * (method A or B) nothing is written until the plugin restarts.
 */
export class SessionMetadataSync {
  /** agentId → taskId written (or found right) in this daemon run. */
  private readonly done = new Map<string, string>();
  /** workspaceId → taskId written (or found right) in this daemon run. */
  private readonly doneWorkspaces = new Map<string, string>();
  /** Bound workspaces absent from the live list, deferred until a board change or bounded recheck. */
  private readonly missingWorkspaces = new Map<string, number>();
  /** Managed sessions that were not live at the last pass; looked at again after `recheckMs`. */
  private skipped = new Set<string>();
  private skippedAt = 0;
  private running: Promise<void> | null = null;
  private pendingChange = false;
  private readingBindings = false;
  /** The board changed since the last full pass (or none ran yet): bindings may have gone, look at every live value. */
  private dirty = true;
  private paseo: Paseo | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(
    private readonly now: () => number = Date.now,
    private readonly recheckMs = 2 * 60_000,
    private readonly bindings: MetadataBindings | null = null,
    private readonly settleMs = 1000,
  ) {}

  /** The connection later passes use (every handler has one; the daemon has none of its own). */
  attach(paseo: Paseo) {
    this.paseo = paseo;
  }

  /** A prepared session now exists in Paseo: retry it even if a prepare-time pass found it missing. */
  created(paseo: Paseo, agentId: string) {
    this.attach(paseo);
    this.skipped.delete(agentId);
    this.changed();
  }

  /** After a board write: one pass soon (writes of one action are gathered), with the last connection seen. */
  changed() {
    if (hostSupports(METADATA_FEATURE) === false) return;
    this.dirty = true;
    this.missingWorkspaces.clear();
    if (this.running || this.readingBindings) {
      this.pendingChange = true;
      return;
    }
    if (!this.bindings || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.fromBindings();
    }, this.settleMs);
    (this.timer as { unref?: () => void }).unref?.();
  }

  /** Runs a pass from the plugin's current bindings; nothing before a handler gave a connection. */
  async fromBindings() {
    if (!this.bindings || !this.paseo || this.readingBindings) return;
    this.readingBindings = true;
    try {
      const current = await this.bindings();
      await this.sync(this.paseo, current.sessions, current.workspaces);
    } catch (error) {
      logFailure("Flowly session metadata sync failed:", error);
    } finally {
      this.readingBindings = false;
      this.drainChange();
    }
  }

  private drainChange() {
    if (!this.pendingChange || this.running || this.readingBindings) return;
    this.pendingChange = false;
    this.dirty = true;
    clearTimeout(this.timer);
    this.timer = undefined;
    void this.fromBindings();
  }

  stop() {
    this.pendingChange = false;
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  /** One pass at a time; ordinary reads join it, while changed() queues one fresh binding pass. */
  sync(paseo: Paseo, managed: readonly Managed[], workspaces?: readonly Bound[]) {
    this.paseo = paseo;
    if (this.running || hostSupports(METADATA_FEATURE) === false) return this.running ?? Promise.resolve();
    if (this.now() - this.skippedAt >= this.recheckMs) this.skipped = new Set();
    const full = this.dirty;
    const wanted = managed.filter((m) => full || (this.done.get(m.agentId) !== m.taskId && !this.skipped.has(m.agentId)));
    const wantedWorkspaces = (workspaces ?? []).filter((w) =>
      this.doneWorkspaces.get(w.workspaceId) !== w.taskId &&
      (full || this.now() - (this.missingWorkspaces.get(w.workspaceId) ?? -Infinity) >= this.recheckMs),
    );
    if (!wanted.length && !wantedWorkspaces.length && !this.dirty) return Promise.resolve();
    this.dirty = false;
    this.running = this.pass(paseo, managed, wanted, workspaces ?? null, full)
      .catch((error) => {
        if (full) this.dirty = true;
        logFailure("Flowly session metadata sync failed:", error);
      })
      .finally(() => {
        this.running = null;
        this.drainChange();
      });
    return this.running;
  }

  /** One write through the probe; false when the host has no metadata (stop the pass). */
  private async write(target: { setMetadata?: (patch: Patch) => Promise<void> }, patch: Patch) {
    const result = await withHostFeature(METADATA_FEATURE, () =>
      typeof target.setMetadata === "function" ? target.setMetadata(patch) : undefined,
    );
    // Ordinary failures reach the pass handler; only successful writes may enter the done cache.
    return result.ok;
  }

  private async pass(paseo: Paseo, managed: readonly Managed[], wanted: readonly Managed[], workspaces: readonly Bound[] | null, full: boolean) {
    const live = await liveAgents(paseo);
    for (const m of wanted) {
      const agent = live.get(m.agentId);
      // Archived (or gone): nothing to show a control on. Looked at again later, so a restored session gets it.
      if (!agent) {
        if (!this.skipped.size) this.skippedAt = this.now();
        this.skipped.add(m.agentId);
        continue;
      }
      const current = metadataSession(agent.metadata as Record<string, unknown> | null | undefined);
      if (current?.taskId === m.taskId && current.agentId === m.agentId) {
        this.done.set(m.agentId, m.taskId);
        continue;
      }
      const ref = paseo.agents.ref(m.agentId) as { setMetadata?: (patch: Patch) => Promise<void> };
      if (!(await this.write(ref, { [metadataTaskId]: m.taskId, [metadataAgentId]: m.agentId }))) return;
      this.done.set(m.agentId, m.taskId);
    }
    if (full) {
      // Clear only sessions no longer managed. Rebound sessions were updated above; `live` still has their old metadata.
      // Background agents carry only `flowly.taskId` (no session id) and are archived after their run: left alone.
      const bound = new Set(managed.map((m) => m.agentId));
      for (const agent of live.values()) {
        const current = metadataSession(agent.metadata as Record<string, unknown> | null | undefined);
        if (!current || bound.has(agent.id)) continue;
        const ref = paseo.agents.ref(agent.id) as { setMetadata?: (patch: Patch) => Promise<void> };
        if (!(await this.write(ref, { [metadataTaskId]: null, [metadataAgentId]: null }))) return;
        this.done.delete(agent.id);
      }
    }
    if (workspaces) await this.workspacePass(paseo, workspaces, full);
  }

  private async workspacePass(paseo: Paseo, workspaces: readonly Bound[], full: boolean) {
    if (!paseo.workspaces || typeof paseo.workspaces.list !== "function") return;
    const binding = new Map(workspaces.map((w) => [w.workspaceId, w.taskId] as const));
    const listed = await liveWorkspaces(paseo);
    const listedIds = new Set(listed.map((workspace) => workspace.id));
    for (const workspace of listed) {
      this.missingWorkspaces.delete(workspace.id);
      const want = binding.get(workspace.id) ?? null;
      const known = this.doneWorkspaces.get(workspace.id);
      if (!full && want !== null && known === want) continue;
      const raw = (workspace as { metadata?: Record<string, unknown> | null }).metadata?.[metadataTaskId];
      const have = typeof raw === "string" && raw ? raw : null;
      if (have === want) {
        if (want !== null) this.doneWorkspaces.set(workspace.id, want);
        continue;
      }
      // Only a value Flowly wrote is cleared; a workspace without a card and without the key is not touched.
      if (want === null && (!full || have === null)) continue;
      const ref = paseo.workspaces.ref(workspace.id) as { setMetadata?: (patch: Patch) => Promise<void> };
      if (!(await this.write(ref, { [metadataTaskId]: want }))) return;
      if (want === null) this.doneWorkspaces.delete(workspace.id);
      else this.doneWorkspaces.set(workspace.id, want);
    }
    for (const workspace of workspaces) {
      if (!listedIds.has(workspace.workspaceId)) this.missingWorkspaces.set(workspace.workspaceId, this.now());
    }
  }
}

async function liveAgents(paseo: Paseo) {
  const agents = new Map<string, PaseoAgent>();
  let cursor: string | undefined;
  do {
    const page = await paseo.agents.list({ filter: { includeArchived: false }, page: { limit: 200, cursor } });
    for (const { agent } of page.entries) if (!agent.archivedAt) agents.set(agent.id, agent);
    cursor = page.pageInfo.nextCursor ?? undefined;
  } while (cursor);
  return agents;
}

/** The host's workspaces (archived ones are not listed by Paseo). */
async function liveWorkspaces(paseo: Paseo) {
  const workspaces: PaseoWorkspace[] = [];
  let cursor: string | undefined;
  do {
    const page = await paseo.workspaces!.list({ page: { limit: 200, cursor } });
    workspaces.push(...page.entries);
    cursor = page.pageInfo.nextCursor ?? undefined;
  } while (cursor);
  return workspaces;
}

/** Every card's workspace and its card, from the plugin's data (one workspace belongs to one card). */
export function workspaceBindings(board: { tasks: readonly { id: string; workspaceId: string }[] }): Bound[] {
  return board.tasks.filter((t) => !!t.workspaceId).map((t) => ({ workspaceId: t.workspaceId, taskId: t.id }));
}

/**
 * The create option that mirrors a card's id onto a background agent Flowly runs for that card (summary, auto
 * review; PASEO-0.16-SPEC §3.6). Only once this host was seen to take metadata: an older daemon refuses the field,
 * and a temporary run must not fail for a mirror.
 */
export function taskMetadata(taskId: string): { metadata?: Record<string, string> } {
  return hostSupports(METADATA_FEATURE) === true ? { metadata: { [metadataTaskId]: taskId } } : {};
}
