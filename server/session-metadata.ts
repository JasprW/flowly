import type { PaseoAgent, PaseoApi } from "@getpaseo/client";
import { logFailure } from "./error-report";
import { hostSupports, withHostFeature } from "./host-support";
import { metadataAgentId, metadataSession, metadataTaskId } from "../shared/session-metadata";

/** The capability name the probe remembers (PASEO-0.16-SPEC §2). */
export const METADATA_FEATURE = "metadata";

type Managed = { agentId: string; taskId: string };
type Paseo = Pick<PaseoApi, "agents">;
type Patch = Record<string, string | null>;
/** What the plugin's own data binds now: read fresh before a pass that follows a board write. */
export type MetadataBindings = () => Promise<{ sessions: readonly Managed[] }>;

/** Mirrors card session ids on the daemon. Plugin bindings remain the source of truth.
 * Writes missing/different ids on live sessions, clears stale Flowly bindings after a board write,
 * and skips unsupported hosts for this plugin run. Workspace and background-agent mirrors are separate.
 */
export class SessionMetadataSync {
  /** agentId → taskId written (or found right) in this daemon run. */
  private readonly done = new Map<string, string>();
  /** Managed sessions that were not live at the last pass; looked at again after `recheckMs`. */
  private skipped = new Set<string>();
  private skippedAt = 0;
  private running: Promise<void> | null = null;
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

  /** After a board write: one pass soon (writes of one action are gathered), with the last connection seen. */
  changed() {
    if (hostSupports(METADATA_FEATURE) === false) return;
    this.dirty = true;
    if (!this.bindings || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.fromBindings();
    }, this.settleMs);
    (this.timer as { unref?: () => void }).unref?.();
  }

  /** Runs a pass from the plugin's current bindings; nothing before a handler gave a connection. */
  async fromBindings() {
    if (!this.bindings || !this.paseo) return;
    try {
      const current = await this.bindings();
      await this.sync(this.paseo, current.sessions);
    } catch (error) {
      logFailure("Flowly session metadata sync failed:", error);
    }
  }

  stop() {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  /** Fire and forget: one pass at a time; a call while one runs is dropped (the next chip round or write asks again). */
  sync(paseo: Paseo, managed: readonly Managed[]) {
    this.paseo = paseo;
    if (this.running || hostSupports(METADATA_FEATURE) === false) return this.running ?? Promise.resolve();
    if (this.now() - this.skippedAt >= this.recheckMs) this.skipped = new Set();
    const wanted = managed.filter((m) => this.done.get(m.agentId) !== m.taskId && !this.skipped.has(m.agentId));
    if (!wanted.length && !this.dirty) return Promise.resolve();
    const full = this.dirty;
    this.dirty = false;
    this.running = this.pass(paseo, managed, wanted, full)
      .catch((error) => {
        if (full) this.dirty = true;
        logFailure("Flowly session metadata sync failed:", error);
      })
      .finally(() => {
        this.running = null;
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

  private async pass(paseo: Paseo, managed: readonly Managed[], wanted: readonly Managed[], full: boolean) {
    const live = await liveAgents(paseo);
    for (const m of wanted) {
      const agent = live.get(m.agentId);
      // Archived (or gone): looked at again later, so a restored session gets its binding.
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
