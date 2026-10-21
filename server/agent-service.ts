import { isSummarizer } from "../shared/summary";
import { enabledStatuses, laneEnabled, laneName } from "../shared/lanes";
import type { PaseoApi } from "@getpaseo/client";
import { randomUUID } from "node:crypto";
import { ideaTitleKey } from "../shared/ideas";
import { nextMovesAction, noMovesNote } from "../shared/next-moves";
import { isResolved, linksOf } from "../shared/links";
import { absoluteTarget, artifactsOf } from "../shared/artifacts";
import { changeTags, normalizeTags, projectTagStats, tagChangeNote } from "../shared/tags";
import { setTags } from "./store";
import { artifactRoots, dropArtifact, externalArtifact, missingArtifacts, normalizeTarget, putArtifact } from "./artifacts";
import { ArtifactReadStore } from "./artifact-reads";
import { ExternalError } from "./connectors/http";
import { ExternalReadStore, refKey, type ConnectorService } from "./connectors/service";
import { familyOf, itemTypeOf } from "../shared/connectors";
import { join } from "node:path";
import { hostname } from "node:os";
import type { Artifact, GitHead, NextMove, Workpad } from "../shared/model";
import { mergeWorkpad, openItemLines, openItems, plansOf, validationFreshness, workpadEnabled, workpadNote, workpadOf, workpadUpdatedAction } from "../shared/workpad";
import { defaultGit, readHead, resolveCommit, type Git } from "./workpad";
import { deliveryReminders, type DeliveryCall } from "./reminders";
import {
  agentStatuses,
  ideaInputSchema,
  artifactInputSchema,
  artifactRemovalSchema,
  tagsInputSchema,
  typeInputSchema,
  nextMovesInputSchema,
  workpadInputSchema,
  progressInputSchema,
  statusInputSchema,
  type ToolIdentity,
  type ToolContext,
  type ToolResult,
  type StatusInput,
  type ProgressInput,
  type IdeaInput,
  type ArtifactToolInput,
  type ArtifactRemovalInput,
  type TagsToolInput,
  type TypeToolInput,
  type NextMovesInput,
  type WorkpadInput,
  type ExternalContext,
  type ReadExternalInput,
} from "../shared/tools";
import { BoardStore } from "./store";
import { BoardService } from "./service";
import { ToolSecrets, digest } from "./tool-context";
import { ToolError } from "./tool-error";
import { ideaLimits, isWorkStatus, legacyStatus, type Board, type Idea, type Receipt, type Status } from "../shared/model";
import { isLegacyScope } from "../shared/scope";

export class AgentService {
  private paseo?: PaseoApi;
  readonly accesses = new Map<string, { at: string; action: string }>();
  /** The Ideas setting; off refuses new proposals (IDEAS-INBOX-SPEC §10). Set by the plugin entry. */
  ideasOn: () => Promise<boolean> = async () => true;
  /** The Agent artifacts setting; off refuses artifact writes (CARD-ARTIFACTS-SPEC §4.3). */
  artifactsOn: () => Promise<boolean> = async () => true;
  /** Reads the workspace HEAD and verifies commits for the workpad (WORKPAD-SPEC §4.2, §5.1). */
  git: Git = defaultGit;
  constructor(
    readonly store: BoardStore,
    readonly secrets: ToolSecrets,
    readonly clock = () => Date.now(),
  ) {
    this.artifactReads = new ArtifactReadStore(store.directory);
    this.externalReads = new ExternalReadStore(join(store.directory, "connectors"));
  }
  /** Reads external inputs (CONNECTORS-SPEC §9); set by the plugin entry. */
  connectors?: ConnectorService;
  /** Per-session external content last seen, for external `unread`. */
  readonly externalReads: ExternalReadStore;
  /**
   * Current summaries of the card's external inputs and whether their content
   * changed since this session last saw it. A service being unreachable never
   * fails get_task: the cached values come back marked stale.
   */
  private async externalInfo(agentId: string, list: readonly Artifact[]) {
    const out = new Map<string, { external: ExternalContext; changed: boolean; fingerprint: string }>();
    if (!this.connectors || !list.some((a) => a.external)) return out;
    const connectors = this.connectors;
    const located = await connectors.locate(list).catch(() => new Map<string, null>());
    const refs = [...located.values()].filter((r): r is NonNullable<typeof r> => !!r);
    const [summaries, seen] = await Promise.all([
      refs.length ? connectors.summaries(refs).catch(() => new Map()) : new Map(),
      this.externalReads.seen(agentId).catch(() => ({}) as Record<string, string>),
    ]);
    for (const a of list) {
      if (!a.external) continue;
      const ref = located.get(a.id);
      const hit = ref ? summaries.get(refKey(ref)) : undefined;
      const fingerprint = hit?.fingerprint || "";
      out.set(a.id, {
        external: {
          provider: a.external.provider,
          itemType: hit?.summary.itemType || itemTypeOf(a.external),
          key: hit?.summary.key || a.external.key,
          summary: hit?.summary.summary || a.title,
          status: hit?.summary.status || "",
          type: hit?.summary.type || "",
          priority: hit?.summary.priority || "",
          assignee: hit?.summary.assignee || "",
          container: hit?.summary.container || "",
          updated: hit?.summary.updated || "",
          stale: !hit || hit.stale,
          connection: ref ? "ok" : "removed",
        },
        changed: !!fingerprint && !!seen[a.id] && seen[a.id] !== fingerprint,
        fingerprint,
      });
    }
    return out;
  }
  /** flowly_read_external, alias flowly_read_ticket (CONNECTORS-SPEC §9): one of this card's external inputs, read-only. */
  async readExternal(identity: ToolIdentity, input: ReadExternalInput) {
    const r = await this.resources(identity);
    const board = await this.store.read();
    const artifact = board.artifacts.find((a) => a.id === input.artifactId && a.taskId === r.task.id);
    if (!artifact) throw new ToolError("EXTERNAL_NOT_FOUND", "No artifact with that id on this card. Use an id from get_task artifacts.");
    if (!artifact.external)
      throw new ToolError("EXTERNAL_NOT_FOUND", "This artifact is not an external input. Read files through absolutePath and other links with your web tool.");
    if (!this.connectors) throw new ToolError("CONNECTORS_DISABLED", "Connectors are unavailable in this Flowly build.");
    const service = serviceName(artifact.external.provider);
    const ref = (await this.connectors.locate([artifact])).get(artifact.id);
    if (!ref)
      throw new ToolError(
        "EXTERNAL_UNAVAILABLE",
        `The user removed this ${service} connection in Flowly settings, so the item can't be read. Tell the user and ask them to add the connection again (Settings → Connections) or paste what you need; don't guess the content.`,
      );
    try {
      const detail = await this.connectors.detail(ref, input.refresh ?? false);
      if (detail.fingerprint)
        await this.externalReads.mark(identity.agentId, { [artifact.id]: detail.fingerprint }).catch(() => undefined);
      this.accesses.set(identity.agentId, { at: new Date(this.clock()).toISOString(), action: "external" });
      return {
        artifactId: artifact.id,
        key: detail.summary.key,
        url: detail.summary.url,
        status: detail.summary.status,
        markdown: detail.markdown,
        truncated: detail.truncated,
        stale: detail.stale,
        fetchedAt: detail.fetchedAt,
      };
    } catch (error) {
      if (error instanceof ExternalError)
        throw new ToolError(
          error.code === "EXTERNAL_INVALID" ? "EXTERNAL_UNAVAILABLE" : error.code,
          error.code === "EXTERNAL_AUTH"
            ? `The ${service} connection's token was refused. Ask the user to update it in Flowly settings → Connections; don't guess the content.`
            : error.message,
          error.code === "EXTERNAL_UNAVAILABLE",
        );
      throw error;
    }
  }
  /** Per-session last read of the card's artifacts, for `unread` (CARD-ARTIFACTS-SPEC §4.2). */
  readonly artifactReads: ArtifactReadStore;
  attach(paseo: PaseoApi) {
    this.paseo = paseo;
  }
  get sdkReady() {
    return !!this.paseo;
  }
  private api() {
    if (!this.paseo)
      throw new ToolError(
        "PASEO_UNAVAILABLE",
        "Paseo context is not ready after startup/reload. Refresh the drawer or start the next session turn, then re-read.",
        true,
      );
    return this.paseo;
  }
  private async resources(identity: ToolIdentity) {
    const paseo = this.api();
    const actor = await paseo.agents.ref(identity.agentId).refresh();
    if (
      !actor?.agent ||
      actor.agent.archivedAt ||
      actor.agent.workspaceId !== identity.workspaceId
    )
      throw new ToolError(
        "SESSION_MISMATCH",
        "Session is unavailable, archived, or belongs to another workspace.",
      );
    const board = await this.store.read(),
      task = board.tasks.find((t) => t.id === identity.taskId),
      project = board.projects.find((p) => p.id === task?.projectId);
    if (!task || !project || task.workspaceId !== identity.workspaceId)
      throw new ToolError(
        "SESSION_MISMATCH",
        "Card is missing or no longer bound to this workspace.",
      );
    const workspace = await paseo.workspaces
      .ref(identity.workspaceId)
      .refresh();
    if (!workspace || workspace.archivingAt)
      throw new ToolError(
        "RESOURCE_UNAVAILABLE",
        "Workspace is unavailable or being archived.",
      );
    const context = await new BoardService(this.store).context(
      task.id,
      paseo,
      board,
    );
    if (!context.workspaceRepoPaths.length)
      throw new ToolError(
        "WORKSPACE_INCOMPATIBLE",
        "Workspace is outside the board project's repositories.",
      );
    return { paseo, task, project, workspace, context };
  }
  /**
   * `markArtifacts`: this call is the session reading its card (flowly_get_task),
   * so artifacts it returns stop being unread for that session. The context
   * returned after a write shows the flags without clearing them.
   */
  async get(identity: ToolIdentity, recordAccess = true, markArtifacts = recordAccess): Promise<ToolContext> {
    // Taken before reading the board: an artifact added meanwhile stays unread.
    const readAt = new Date(Math.max(Date.now(), this.clock())).toISOString();
    const lastRead = await this.artifactReads.lastRead(identity.agentId).catch(() => undefined);
    const r = await this.resources(identity);
    const entries: { id: string; title: string; status: string }[] = [];
    let cursor: string | undefined,
      scanned = 0,
      unavailableReason = "",
      partial = false;
    try {
      do {
        const page = await r.paseo.agents.list({
          filter: { includeArchived: true },
          page: { limit: 200, cursor },
        });
        scanned += page.entries.length;
        entries.push(
          ...page.entries
            .map((e) => e.agent)
            .filter((a) => a.workspaceId === identity.workspaceId && !isSummarizer(a))
            .map((a) => ({
              id: a.id,
              title: a.title || a.id,
              status: a.archivedAt ? "archived" : a.status,
            })),
        );
        cursor = page.pageInfo.nextCursor ?? undefined;
      } while (cursor && entries.length < 20 && scanned < 2000);
      partial = !!cursor || entries.length > 20;
    } catch {
      partial = true;
      unavailableReason = "Session summary is currently unavailable.";
    }
    const revision = { task: r.task.revision, project: r.project.revision };
    const finished = ["done", "cancelled"].includes(r.task.status);
    let externals = new Map<string, { changed: boolean; fingerprint: string; external: ExternalContext }>();
    const value: ToolContext = {
      identity,
      task: r.task,
      project: r.project,
      revision,
      request: this.secrets.request(identity, revision),
      toolVersion: 1,
      writable: r.context.available && !finished,
      reason:
        r.context.reason ||
        (finished ? "Task is finished; only a human can reopen it." : ""),
      // Agents may only use agent statuses that are lanes of this project.
      allowedStatuses: agentStatuses.filter((status) => laneEnabled(r.project, status)),
      lanes: enabledStatuses(r.project).map((status) => ({ status, name: laneName(r.project, status) })),
      scope: {
        mode: isLegacyScope(r.task, r.project) ? "selected" : "all",
        repoPaths: r.context.directories.map((p) => p.repo),
        directories: r.context.directories,
      },
      workspace: {
        id: r.workspace.id,
        directory: r.workspace.workspaceDirectory,
        nativeOwner: r.context.owner,
        status: r.workspace.status,
        repoPaths: r.context.workspaceRepoPaths,
      },
      sessions: { entries: entries.slice(0, 20), partial, unavailableReason },
      ...(await this.store.read().then(async (board) => ({
        activity: board.events.filter((e) => e.taskId === r.task.id).slice(-20),
        projectTags: projectTagStats(board.tasks, r.project.id).map(({ tag, count }) => ({ tag, count })),
        ideas: board.ideas
          .filter((i) => i.taskId === r.task.id)
          .map((i) => ({
            id: i.id,
            title: i.title,
            status: i.status,
            ...(i.scope ? { scope: i.scope } : {}),
            ...(i.acceptedTaskId ? { acceptedTaskId: i.acceptedTaskId } : {}),
            ...(i.acceptedAgentId ? { acceptedAgentId: i.acceptedAgentId } : {}),
          })),
        artifacts: await (async () => {
          const list = artifactsOf(board.artifacts, r.task.id).slice(0, 100);
          const where = artifactRoots(r.task, r.project, r.workspace.workspaceDirectory);
          const missing = await missingArtifacts(list, where);
          externals = await this.externalInfo(identity.agentId, list);
          return list.map((a) => ({
            id: a.id,
            role: a.role,
            kind: a.kind,
            target: a.target,
            ...(a.kind === "file" ? { absolutePath: absoluteTarget(a.target, where.workspace) } : {}),
            title: a.title,
            note: a.note,
            createdBy: a.createdBy,
            missing: missing.has(a.id),
            // Added or edited since this session last read the card; its own additions never count.
            unread:
              (!(a.createdBy === "agent" && a.agentId === identity.agentId) && (!lastRead || a.updatedAt > lastRead)) ||
              !!externals.get(a.id)?.changed,
            ...(externals.has(a.id) ? { external: externals.get(a.id)!.external } : {}),
            // Sessions started with the older skill look for `ticket` (CONNECTORS-SPEC §3.3).
            ...(externals.has(a.id) && familyOf(a.external!.provider) === "jira" ? { ticket: externals.get(a.id)!.external } : {}),
          }));
        })(),
        ...(workpadEnabled(r.project)
          ? { workpadEnabled: true, ...workpadContext(board.workpads, board.plans, r.task.id, identity.agentId) }
          : { workpadEnabled: false, workpad: null, plan: [] }),
        links: linksOf(board, r.task.id)
          .filter((v) => v.other)
          .map(({ relation, other }) => ({
            relation,
            taskId: other!.id,
            title: other!.title,
            status: other!.status,
            laneName: laneName(r.project, other!.status),
            archived: !!other!.archivedAt,
            ...(relation === "blocked_by" ? { resolved: isResolved(other) } : {}),
          })),
      }))),
    };
    if (recordAccess)
      this.accesses.set(identity.agentId, {
        at: new Date(this.clock()).toISOString(),
        action: "get",
      });
    if (markArtifacts && value.artifacts.length)
      await this.artifactReads.mark(identity.agentId, readAt).catch((e) =>
        console.error("Kanban artifact reads not saved:", e instanceof Error ? e.message : String(e)),
      );
    const seenExternals = Object.fromEntries([...externals].filter(([, v]) => v.fingerprint).map(([id, v]) => [id, v.fingerprint]));
    if (markArtifacts && Object.keys(seenExternals).length)
      await this.externalReads.mark(identity.agentId, seenExternals).catch((e) =>
        console.error("Kanban external reads not saved:", e instanceof Error ? e.message : String(e)),
      );
    return value;
  }
  /** Each commit the agent named, verified in the workspace repository (WORKPAD-SPEC §5.1). */
  private async commits(input: WorkpadInput, dir: string, head: GitHead | null) {
    const given = [...new Set(input.validation.flatMap((v) => (v.sha && v.state !== "unrun" ? [v.sha] : [])))];
    const resolved = new Map<string, string>();
    if (given.length && !head)
      throw new ToolError("WORKPAD_INVALID", "This workspace is not a git repository (or git is unavailable); omit sha.");
    for (const sha of given) {
      const value = await resolveCommit(dir, sha, this.git);
      if (!value) throw new ToolError("WORKPAD_INVALID", `"${sha}" is not a commit in this workspace's repository.`);
      resolved.set(sha, value);
    }
    return resolved;
  }
  async write(
    identity: ToolIdentity,
    action: "status" | "progress" | "idea" | "artifact" | "artifact_remove" | "tags" | "type" | "next_moves" | "workpad",
    raw: unknown,
  ): Promise<ToolResult> {
    const input: StatusInput | ProgressInput | IdeaInput | ArtifactToolInput | ArtifactRemovalInput | TagsToolInput | TypeToolInput | NextMovesInput | WorkpadInput =
      action === "status"
        ? statusInputSchema.parse(raw)
        : action === "idea"
          ? ideaInputSchema.parse(raw)
          : action === "artifact"
            ? artifactInputSchema.parse(raw)
            : action === "artifact_remove"
              ? artifactRemovalSchema.parse(raw)
              : action === "tags"
                ? tagsInputSchema.parse(raw)
                : action === "type"
                  ? typeInputSchema.parse(raw)
                  : action === "next_moves"
                    ? nextMovesInputSchema.parse(raw)
                    : action === "workpad"
                      ? workpadInputSchema.parse(raw)
                      : progressInputSchema.parse(raw);
    const signed = this.secrets.validateRequest(
      identity,
      input.request,
      input.expectedRevision,
    );
    const resources = await this.resources(identity);
    // Read for a proposal, and for a delivery whose result may remind of ideas (IDEAS-SPEC §4.1).
    const ideasOn =
      action === "idea" || (action === "status" && (input as StatusInput).status === "in_review") ? await this.ideasOn() : true;
    const artifactWrite = action === "artifact" || action === "artifact_remove";
    const artifactsOn = artifactWrite ? await this.artifactsOn() : true;
    // Paths are checked before the write; the transaction only records the result.
    // An item link or key of a configured connection becomes an external input (CONNECTORS-SPEC §3.1).
    const externalTarget =
      action === "artifact" && artifactsOn
        ? await externalArtifact(this.connectors, (input as ArtifactToolInput).target).catch((e) => {
            throw new ToolError("ARTIFACT_INVALID", e instanceof Error ? e.message : String(e));
          })
        : null;
    const artifactTarget =
      action === "artifact" && artifactsOn
        ? externalTarget
          ? { kind: externalTarget.kind, target: externalTarget.target, external: externalTarget.external, externalTitle: externalTarget.title }
          : await normalizeTarget(
              (input as ArtifactToolInput).target,
              artifactRoots(resources.task, resources.project, resources.workspace.workspaceDirectory),
            ).catch((e) => {
              throw new ToolError("ARTIFACT_INVALID", e instanceof Error ? e.message : String(e));
            })
        : undefined;
    // Git runs outside the transaction: the workpad's HEAD stamp and commits (WORKPAD-SPEC §4.2, §5.1),
    // and the HEAD the delivery check compares checks against (§5.3).
    const delivering = action === "status" && (input as StatusInput).status === "in_review";
    const head: GitHead | null | undefined =
      action === "workpad" || delivering
        ? await readHead(resources.workspace.workspaceDirectory, this.git, new Date(this.clock()).toISOString())
        : undefined;
    const commits = action === "workpad" ? await this.commits(input as WorkpadInput, resources.workspace.workspaceDirectory, head ?? null) : undefined;
    // Tags are normalized before the write; one invalid value refuses the whole call (CARD-TAGS-SPEC §4.1).
    const tagEdit = action === "tags" || action === "idea" ? normalizeToolTags(action, input as TagsToolInput | IdeaInput) : undefined;
    const key = `${identity.agentId}:${digest(input.request.id)}`,
      payloadHash = digest(JSON.stringify({ action, input }));
    // What this call left out (NEXT-MOVES-SPEC §9): read from the board as it is after the write, also on a replay
    // (the first response may have been lost), and only while the card still takes writes.
    const call: DeliveryCall | undefined =
      action === "status"
        ? { action, status: (input as StatusInput).status }
        : action === "progress"
          ? { action, kind: (input as ProgressInput).kind }
          : undefined;
    const reminders = (board: Board): string[] => {
      const task = board.tasks.find((t) => t.id === identity.taskId);
      if (!call || !task || task.archivedAt || ["done", "cancelled"].includes(task.status)) return [];
      if (board.projects.find((p) => p.id === task.projectId)?.archivedAt) return [];
      return deliveryReminders(board, { taskId: task.id, agentId: identity.agentId }, call, ideasOn);
    };
    const result = await this.store.transaction((board) => {
      const existing = board.agentReceipts.find((r) => r.key === key);
      if (existing) {
        if (existing.payloadHash !== payloadHash)
          throw new ToolError(
            "REQUEST_REUSED",
            "Request already committed with different parameters.",
          );
        const idea = existing.eventId ? board.ideas.find((i) => i.eventId === existing.eventId) : undefined;
        return {
          value: { receipt: existing, replayed: true, ideaId: idea?.id, artifactId: existing.artifactId, reminders: reminders(board) },
          changed: false,
        };
      }
      const age = this.clock() - Date.parse(signed.issuedAt);
      if (age > 15 * 60 * 1000 || age < -30000)
        throw new ToolError(
          "REQUEST_EXPIRED",
          "Request is expired. Re-read the task before a new update.",
        );
      const task = board.tasks.find((t) => t.id === identity.taskId),
        project = board.projects.find((p) => p.id === task?.projectId);
      if (!task || !project || task.workspaceId !== identity.workspaceId)
        throw new ToolError("SESSION_MISMATCH", "Card binding changed.");
      if (task.archivedAt || project.archivedAt)
        throw new ToolError("ARCHIVED", "Task or project is archived.");
      if (["done", "cancelled"].includes(task.status))
        throw new ToolError(
          "TASK_FINISHED",
          "Only a human can reopen or change a finished task.",
        );
      if (
        task.revision !== input.expectedRevision.task ||
        project.revision !== input.expectedRevision.project
      )
        throw new ToolError(
          "REVISION_CONFLICT",
          `Card/project changed (current task=${task.revision}, project=${project.revision}). Re-read before deciding whether to retry.`,
        );
      if (
        !resources.context.workspaceRepoPaths.some((p) =>
          project.repos.includes(p),
        )
      )
        throw new ToolError(
          "WORKSPACE_INCOMPATIBLE",
          "Project repositories changed; re-read context.",
        );
      board.agentReceipts = board.agentReceipts.filter(
        (r) => Date.parse(r.expiresAt) > this.clock(),
      );
      if (board.agentReceipts.length >= 5000)
        throw new ToolError(
          "RECEIPTS_FULL",
          "Agent receipt capacity is full; no unexpired receipt was removed. Try after expiry or use the human board UI.",
          true,
        );
      if (action === "idea" && !ideasOn)
        throw new ToolError("IDEAS_DISABLED", "Ideas are turned off in Flowly settings. Mention follow-up suggestions in your reply instead.");
      if (action === "idea") checkIdea(board, task.id, (input as IdeaInput).title);
      if (artifactWrite && !artifactsOn)
        throw new ToolError(
          "ARTIFACTS_DISABLED",
          "Agent artifacts are turned off in Flowly settings. List your deliverables in your reply instead.",
        );
      const previous = task.status,
        next = action === "status" ? resolveAgentStatus((input as StatusInput).status, previous) : previous;
      if (next !== previous && !laneEnabled(project, next))
        throw new ToolError(
          "STATUS_UNAVAILABLE",
          `${laneName(project, next)} is not a lane in this project. Use one of allowedStatuses from get_task.`,
        );
      // Next moves that ride on a status or report (NEXT-MOVES-SPEC §8.2): a Done move is only offered with a delivery.
      const carried = action === "status" || action === "progress" ? (input as StatusInput | ProgressInput).nextMoves : undefined;
      if (carried?.some((m) => m.moveTo === "done") && next !== "in_review")
        throw new ToolError(
          "INVALID_INPUT",
          "A moveTo=\"done\" move is only offered together with a delivery to In review (status in_review). Leave it out, or deliver first.",
        );
      // Soft delivery gate (WORKPAD-SPEC §5.3): open items need an explicit acknowledgement.
      // Off for the project (WORKPAD-SPEC §9): no gate, and the stored workpad stays as it is.
      const deliveryPad =
        next === "in_review" && next !== previous && workpadEnabled(project) ? board.workpads.find((w) => w.taskId === task.id) : undefined;
      if (deliveryPad && head !== undefined) deliveryPad.head = head;
      const delivered = deliveryPad ? openItems(deliveryPad) : undefined;
      if (deliveryPad && delivered!.total > 0 && !(input as StatusInput).acknowledgeOpen)
        throw new ToolError(
          "WORKPAD_OPEN",
          `${delivered!.total} workpad item${delivered!.total === 1 ? " is" : "s are"} still open:\n${openItemLines(deliveryPad).join("\n")}\nRerun out-of-date checks and finish what you can. Deliver anyway only with acknowledgeOpen=true and a note that explains every open item (failed, not run, out of date or not met).`,
        );
      if (next !== previous) {
        task.status = next;
        task.revision++;
        task.updatedAt = new Date(this.clock()).toISOString();
      }
      let artifactId: string | undefined;
      const artifactEvent = artifactWrite
        ? (() => {
            try {
              if (action === "artifact") {
                const a = input as ArtifactToolInput;
                const put = putArtifact(
                  this.store,
                  board,
                  {
                    taskId: task.id,
                    role: a.role,
                    kind: artifactTarget!.kind,
                    target: artifactTarget!.target,
                    title: a.title || ("externalTitle" in artifactTarget! ? artifactTarget.externalTitle : undefined),
                    note: a.note,
                    createdBy: "agent",
                    agentId: identity.agentId,
                    ...("external" in artifactTarget! ? { external: artifactTarget.external } : {}),
                  },
                  new Date(this.clock()).toISOString(),
                );
                artifactId = put.artifact.id;
                return { id: put.eventId ?? "", at: new Date(this.clock()).toISOString() };
              }
              const dropped = dropArtifact(this.store, board, (input as ArtifactRemovalInput).id, {
                createdBy: "agent",
                agentId: identity.agentId,
                taskId: task.id,
              });
              artifactId = dropped.artifact.id;
              return { id: dropped.eventId, at: new Date(this.clock()).toISOString() };
            } catch (e) {
              if (e instanceof ToolError) throw e;
              const text = e instanceof Error ? e.message : String(e);
              throw new ToolError(text.startsWith("Only the user") ? "ARTIFACT_FORBIDDEN" : "ARTIFACT_INVALID", text);
            }
          })()
        : undefined;
      const tagsEvent =
        action === "tags"
          ? (() => {
              const at = new Date(this.clock()).toISOString();
              let change;
              try {
                change = changeTags(task.tags || [], tagEdit!, { actor: "agent", agentId: identity.agentId, at });
              } catch (e) {
                const text = e instanceof Error ? e.message : String(e);
                throw new ToolError(text.startsWith("Only the user") ? "TAG_FORBIDDEN" : "TAG_INVALID", text);
              }
              if (!change.added.length && !change.removed.length) return { id: "", at };
              setTags(task, change.tags);
              return this.store.event(board, {
                taskId: task.id,
                agentId: identity.agentId,
                actor: "agent",
                action: "tags_changed",
                note: tagChangeNote(change),
              });
            })()
          : undefined;
      // An agent only fills in a missing type; any existing type stays (CARD-TYPE-SPEC §2).
      const typeEvent =
        action === "type"
          ? (() => {
              const type = (input as TypeToolInput).type;
              if (task.type === type) return { id: "", at: new Date(this.clock()).toISOString() };
              if (task.type)
                throw new ToolError(
                  "TYPE_ALREADY_SET",
                  `This card already has type ${task.type}; only the user changes an existing type.`,
                );
              task.type = type;
              task.revision++;
              task.updatedAt = new Date(this.clock()).toISOString();
              return this.store.event(board, {
                taskId: task.id,
                agentId: identity.agentId,
                actor: "agent",
                action: "type_set",
                note: type,
              });
            })()
          : undefined;
      let workpadRevision: number | undefined;
      // Full replacement guarded by the workpad's own revision (WORKPAD-SPEC §2.4, §3).
      const workpadEvent =
        action === "workpad"
          ? (() => {
              const w = input as WorkpadInput;
              if (!workpadEnabled(project))
                throw new ToolError(
                  "WORKPAD_DISABLED",
                  "The workpad is turned off for this project. List acceptance criteria and checks (passed, failed, not run) in your progress and delivery notes instead; do not retry.",
                );
              const current = board.workpads.find((x) => x.taskId === task.id);
              if ((current?.revision ?? 0) !== w.workpadRevision)
                throw new ToolError(
                  "WORKPAD_CONFLICT",
                  `Workpad changed (current revision=${current?.revision ?? 0}), possibly by the user. Re-read get_task, keep their checks, then retry.`,
                );
              const now = new Date(this.clock()).toISOString();
              let merged;
              try {
                merged = mergeWorkpad(current, w, { now, head: head ?? null, resolved: commits! });
              } catch (e) {
                throw new ToolError("WORKPAD_INVALID", e instanceof Error ? e.message : String(e));
              }
              const env = { host: hostname(), path: resources.workspace.workspaceDirectory, head: head ?? null };
              const value: Workpad = {
                ...(current ?? {}),
                taskId: task.id,
                projectId: project.id,
                revision: (current?.revision ?? 0) + 1,
                ...merged,
                env,
                head: head ?? null,
                updatedAt: now,
                updatedBy: "agent",
                agentId: identity.agentId,
              };
              if (current) board.workpads[board.workpads.indexOf(current)] = value;
              else board.workpads.push(value);
              workpadRevision = value.revision;
              return this.store.event(board, {
                taskId: task.id,
                agentId: identity.agentId,
                actor: "agent",
                action: workpadUpdatedAction,
                note: workpadNote(value),
              });
            })()
          : undefined;
      // A session's candidate next messages; the latest of a turn wins (NEXT-MOVES-SPEC §2-3). An empty list is
      // recorded too: the agent's explicit "nothing for the user this turn" (§8.3).
      const recordMoves = (moves: readonly NextMove[]) =>
        this.store.event(board, {
          taskId: task.id,
          agentId: identity.agentId,
          actor: "agent",
          action: nextMovesAction,
          note: moves.length ? moves.map((m) => m.label).join(" · ") : noMovesNote,
          moves: [...moves],
        });
      const movesEvent = action === "next_moves" ? recordMoves((input as NextMovesInput).moves) : undefined;
      const event =
        artifactEvent ??
        tagsEvent ??
        typeEvent ??
        movesEvent ??
        workpadEvent ??
        (action === "idea"
          ? this.store.event(board, {
              taskId: task.id,
              agentId: identity.agentId,
              actor: "agent",
              action: "idea_proposed",
              note: (input as IdeaInput).title,
            })
          : this.store.event(board, {
              taskId: task.id,
              agentId: identity.agentId,
              actor: "agent",
              action: next !== previous ? "status_changed" : "progress_reported",
              note: (input as StatusInput | ProgressInput).note,
              reportKind:
                action === "progress" ? (input as ProgressInput).kind : "progress",
              ...(next !== previous ? { from: previous, to: next } : {}),
              ...(deliveryPad ? { workpad: { ...delivered!, revision: deliveryPad.revision } } : {}),
            }));
      if (deliveryPad) deliveryPad.delivery = { ...delivered!, revision: deliveryPad.revision, eventId: event.id, at: event.at };
      // The suggestion follows the status change or report it rode on, in the same write (NEXT-MOVES-SPEC §8.3).
      if (carried) recordMoves(carried);
      let ideaId: string | undefined;
      if (action === "idea") {
        const idea = input as IdeaInput;
        ideaId = randomUUID();
        board.ideas.push({
          id: ideaId,
          taskId: task.id,
          projectId: project.id,
          agentId: identity.agentId,
          eventId: event.id,
          title: idea.title,
          detail: idea.detail,
          rationale: idea.rationale,
          context: idea.context,
          ...(idea.type ? { type: idea.type } : {}),
          ...(idea.priority ? { priority: idea.priority } : {}),
          ...(tagEdit?.add.length ? { tags: tagEdit.add } : {}),
          scope: idea.scope,
          status: "open",
          createdAt: event.at,
          updatedAt: event.at,
        });
        pruneIdeas(board, task.id);
      }
      const receipt: Receipt = {
        key,
        agentId: identity.agentId,
        taskId: task.id,
        payloadHash,
        action,
        eventId: event.id,
        ...(artifactId ? { artifactId } : {}),
        ...(workpadRevision ? { workpadRevision } : {}),
        taskRevision: task.revision,
        projectRevision: project.revision,
        status: task.status,
        at: event.at,
        expiresAt: new Date(this.clock() + 7 * 86400000).toISOString(),
      };
      board.agentReceipts.push(receipt);
      return { value: { receipt, replayed: false, ideaId, artifactId, reminders: reminders(board) }, changed: true };
    });
    const {
      key: _key,
      payloadHash: _hash,
      expiresAt: _expires,
      ...receipt
    } = result.receipt;
    try {
      const current = await this.get(identity, true, false);
      this.accesses.set(identity.agentId, {
        at: new Date(this.clock()).toISOString(),
        action,
      });
      return { receipt, replayed: result.replayed, ...remindersField(result.reminders), ...ideaField(result.ideaId), ...(result.artifactId ? { artifactId: result.artifactId } : {}), current };
    } catch (e) {
      return {
        receipt,
        replayed: result.replayed,
        ...remindersField(result.reminders),
        ...ideaField(result.ideaId), ...(result.artifactId ? { artifactId: result.artifactId } : {}),
        current: null,
        contextError: e instanceof Error ? e.message : "Re-read the task.",
      };
    }
  }
}

/** get_task's workpad and plans (WORKPAD-SPEC §4.1). */
function workpadContext(workpads: readonly Workpad[], plans: Board["plans"], taskId: string, agentId: string) {
  const w = workpadOf(workpads, taskId);
  const own = plansOf(plans, taskId).map((p) => ({ agentId: p.agentId, own: p.agentId === agentId, items: p.items, at: p.at }));
  return {
    workpad: w
      ? {
          revision: w.revision,
          acceptance: w.acceptance,
          validation: w.validation.map((v) => ({ ...v, fresh: validationFreshness(v, w.head) })),
          confusions: w.confusions,
          env: w.env,
          head: w.head,
          open: openItems(w),
        }
      : null,
    plan: [...own.filter((p) => p.own), ...own.filter((p) => !p.own)],
  };
}

/** Maps the retired in_progress alias onto a work stage (WORKFLOW-STAGES-SPEC §4). */
export function resolveAgentStatus(requested: StatusInput["status"], current: Status): Status {
  if (requested !== legacyStatus) return requested;
  return isWorkStatus(current) ? current : "development";
}

/** Normalized add/remove lists of a tags call, or an idea's suggested tags as `add`. */
function normalizeToolTags(action: "tags" | "idea", input: TagsToolInput | IdeaInput) {
  try {
    if (action === "idea") return { add: normalizeTags((input as IdeaInput).tags || []), remove: [] };
    const t = input as TagsToolInput;
    const edit = { add: normalizeTags(t.add), remove: normalizeTags(t.remove) };
    if (!edit.add.length && !edit.remove.length) throw new Error("Add or remove at least one tag.");
    return edit;
  } catch (e) {
    throw new ToolError("TAG_INVALID", e instanceof Error ? e.message : String(e));
  }
}

const ideaField = (ideaId: string | undefined) => (ideaId ? { ideaId } : {});
/** `reminders` only when there are some, so other calls' results stay as they were (NEXT-MOVES-SPEC §9.5). */
const remindersField = (reminders: string[] | undefined) => (reminders?.length ? { reminders } : {});

/** Rejects a duplicate open title or an eleventh open idea on the card (IDEAS-SPEC §3). */
export function checkIdea(board: Board, taskId: string, title: string) {
  const open = board.ideas.filter((i) => i.taskId === taskId && i.status === "open");
  const duplicate = open.find((i) => ideaTitleKey(i.title) === ideaTitleKey(title));
  if (duplicate)
    throw new ToolError("IDEA_DUPLICATE", `This card already has an open idea with that title (${duplicate.id}).`);
  if (open.length >= ideaLimits.openPerTask)
    throw new ToolError(
      "IDEA_LIMIT",
      `This card already has ${ideaLimits.openPerTask} open ideas. Stop proposing until the user accepts or dismisses some.`,
    );
}

/** Keeps at most `keptPerTask` ideas per card, dropping the oldest closed ones first. */
export function pruneIdeas(board: Board, taskId: string) {
  const own = board.ideas.filter((i) => i.taskId === taskId);
  const excess = own.length - ideaLimits.keptPerTask;
  if (excess <= 0) return;
  const drop = new Set<Idea>(own.filter((i) => i.status !== "open").slice(0, excess));
  board.ideas = board.ideas.filter((i) => !drop.has(i));
}

/** "GitLab", for agent-facing messages. */
const serviceName = (provider: Parameters<typeof familyOf>[0]) => ({ jira: "Jira", confluence: "Confluence", github: "GitHub", gitlab: "GitLab" })[familyOf(provider)];
