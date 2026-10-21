import { attentionDismissInput, attentionDismissalSchema, attentionRestoreInput } from "./attention-dismiss";
import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import {
  ideaAdoption,
  ideaEdit,
  linkInput,
  linkSchema,
  artifactInput,
  artifactEdit,
  artifactSchema,
  workpadSchema,
  workpadCheck,
  workpadItemId,
  gitHeadSchema,
  ideaSchema,
  boardSchema,
  projectInput,
  projectEdit,
  linkedProjectInput,
  projectLinksEdit,
  projectRemoval,
  taskInput,
  taskDeletion,
  taskEdit,
  taskTagsEdit,
  taskPlacement,
  projectSchema,
  taskSchema,
  eventSchema,
  planSnapshotSchema,
} from "./model";
import { healthSchema, preparationSchema } from "./tools";
import { connectionInput, connectionSchema, externalSummarySchema } from "./connectors";
import { composerStateSchema, composerTarget, maxImages, outgoingImageSchema, queuedMessageSchema } from "./composer";
import {
  sessionReadStateSchema,
  sessionReadReceiptSchema,
  markSessionReadInput,
  markSessionUnreadInput,
} from "./session-attention";
import { summaryEntrySchema, summaryOverviewSchema } from "./summary";
import { taskUsageSchema } from "./usage";
import { tailEntrySchema } from "./session-tail";
import { tokenInsightsSchema } from "./insights";
import { digestViewSchema } from "./digest";
import { perfReportSchema } from "./perf";
import { localeCodes } from "./i18n";
import { insightsWithHabitsSchema } from "./agent-habits";

/** `{ etag }` in; the value is omitted when it still matches (PERFORMANCE-SPEC §3). */
const etagInput = z.strictObject({ etag: z.string().max(200).optional() });

export const readSessionReceipts = defineRpc({
  name: "sessions.read-state",
  input: z.strictObject({}),
  output: sessionReadStateSchema,
});
export const markSessionRead = defineRpc({
  name: "sessions.mark-read",
  input: markSessionReadInput,
  /** Null when there was nothing to acknowledge (e.g. only a manual unread mark was cleared). */
  output: sessionReadReceiptSchema.nullable(),
});
export const markSessionUnread = defineRpc({
  name: "sessions.mark-unread",
  input: markSessionUnreadInput,
  output: sessionReadReceiptSchema,
});

/** A language's UI catalog, served on demand so the client bundle carries none (PERFORMANCE-SPEC, Cold start). */
export const i18nCatalog = defineRpc({
  name: "i18n.catalog",
  input: z.strictObject({ locale: z.enum(localeCodes.filter((c) => c !== "en") as [string, ...string[]]) }),
  output: z.record(z.string(), z.union([z.string(), z.record(z.string(), z.string())])),
});

/** Phone timings for the plugin log; a no-op unless the performance log setting is on. */
export const perfReport = defineRpc({
  name: "perf.report",
  input: perfReportSchema,
  output: z.object({ logged: z.boolean() }),
});

export const readBoard = defineRpc({
  name: "board.read",
  input: z.object({}),
  output: boardSchema,
});
const collectionPatch = <T extends z.ZodType>(item: T) =>
  z.object({ set: z.array(item), remove: z.array(z.string()), order: z.array(z.string()).optional() }).optional();
/** What changed since the board behind the caller's etag (PERFORMANCE-SPEC §3). */
export const boardPatchSchema = z.object({
  revision: z.number().int().nonnegative(),
  events: z.array(eventSchema),
  plans: z.array(planSnapshotSchema).optional(),
  projects: collectionPatch(projectSchema),
  tasks: collectionPatch(taskSchema),
  ideas: collectionPatch(ideaSchema),
  links: collectionPatch(linkSchema),
  artifacts: collectionPatch(artifactSchema),
  workpads: collectionPatch(workpadSchema),
  attentionDismissals: collectionPatch(attentionDismissalSchema),
});
export const readBoardChanged = defineRpc({
  name: "board.read-changed",
  /** `since`: the caller holds this many events, the last being `lastId`; only newer ones are needed. */
  input: etagInput.extend({ since: z.strictObject({ count: z.number().int().nonnegative(), lastId: z.string().max(200) }).optional() }),
  /** `patch`: apply to the board behind the request's etag. `delta`: `value.events` holds only the events after `since`. */
  output: z.object({ etag: z.string(), value: boardSchema.optional(), delta: z.boolean().optional(), patch: boardPatchSchema.optional() }),
});
export const createProject = defineRpc({
  name: "projects.create",
  input: projectInput,
  output: projectSchema,
});
export const createLinkedProject = defineRpc({
  name: "projects.create-linked",
  input: linkedProjectInput,
  output: projectSchema,
});
export const setProjectLinks = defineRpc({
  name: "projects.set-links",
  input: projectLinksEdit,
  output: projectSchema,
});
export const removeProject = defineRpc({
  name: "projects.remove",
  input: projectRemoval,
  output: z.object({
    id: z.string(),
    removedTasks: z.number().int(),
    backup: z.string(),
    /** Set when alsoPaseo was requested. */
    paseo: z.object({ removed: z.boolean(), workspaces: z.number().int(), error: z.string() }).optional(),
  }),
});
export const removeProjectCheck = defineRpc({
  name: "projects.remove-check",
  input: z.object({ id: z.string().min(1) }),
  output: z.object({
    cards: z.number().int(),
    paseoProjectId: z.string(),
    /** False when the native project is already gone from Paseo. */
    paseoExists: z.boolean(),
    workspaces: z.number().int(),
    runningSessions: z.number().int(),
  }),
});
/** A project saved in a folder's `.flowly/` (PROJECT-FOLDER-SPEC §3). */
export const restoreProjectCheck = defineRpc({
  name: "projects.restore-check",
  input: z.object({ path: z.string().min(1).max(4096) }),
  output: z.union([
    z.object({ found: z.literal(false) }),
    z.object({
      found: z.literal(true),
      title: z.string(),
      cards: z.number().int(),
      savedAt: z.string(),
      /** Set: restore is refused (unreadable file, or the project is already on the board). */
      conflict: z.enum(["", "invalid", "on-board"]),
      /** Cards whose workspace is bound by another card; restored without it. */
      unbound: z.number().int(),
    }),
  ]),
});
export const restoreProject = defineRpc({
  name: "projects.restore",
  input: z.object({ path: z.string().min(1).max(4096) }),
  output: z.object({ project: projectSchema, cards: z.number().int(), unbound: z.number().int() }),
});
/** Where the project's board copy lives and whether its last write worked. */
export const projectFolderState = defineRpc({
  name: "projects.folder-state",
  input: z.object({ id: z.string().min(1) }),
  output: z.object({ path: z.string(), savedAt: z.string(), error: z.string() }),
});
export const nativePickers = ["finder", "explorer", "zenity", "kdialog"] as const;
export const listDirectories = defineRpc({
  name: "fs.list-directories",
  input: z.object({ path: z.string().max(4096).optional() }),
  output: z.object({
    path: z.string(),
    parent: z.string().nullable(),
    home: z.string(),
    native: z.enum(nativePickers).nullable(),
    truncated: z.boolean(),
    entries: z.array(z.object({ name: z.string(), path: z.string(), git: z.boolean() })),
  }),
});
export const pickNativeDirectory = defineRpc({
  name: "fs.pick-native",
  input: z.object({ multiple: z.boolean().default(false) }),
  output: z.object({ paths: z.array(z.string()) }),
});
export const updateProject = defineRpc({
  name: "projects.update",
  input: projectEdit,
  output: projectSchema,
});
export const createTask = defineRpc({
  name: "tasks.create",
  input: taskInput,
  output: taskSchema,
});
export const updateTask = defineRpc({
  name: "tasks.update",
  input: taskEdit,
  output: taskSchema,
});
/** Add or remove single tags without the card revision (CARD-TAGS-SPEC §3). */
export const updateTaskTags = defineRpc({
  name: "tasks.tags",
  input: taskTagsEdit,
  output: taskSchema,
});
/** Dismiss or restore an idea (IDEAS-SPEC §7). */
export const updateIdea = defineRpc({
  name: "ideas.update",
  input: ideaEdit,
  output: ideaSchema,
});
/** Hide a card from Attention until something new happens (ATTENTION-DISMISS-SPEC §5). */
export const dismissAttention = defineRpc({
  name: "attention.dismiss",
  input: attentionDismissInput,
  output: attentionDismissalSchema,
});
/** Put a dismissed card back into Attention. */
export const restoreAttention = defineRpc({
  name: "attention.restore",
  input: attentionRestoreInput,
  output: z.object({ taskId: z.string() }),
});
/** Accept an idea in its own card: send it to one of the card's sessions (IDEAS-SPEC §6.2). */
export const adoptIdea = defineRpc({
  name: "ideas.adopt",
  input: ideaAdoption,
  output: ideaSchema,
});
/** Link two cards of one project (CARD-LINKS-SPEC §3). */
export const createLink = defineRpc({
  name: "links.create",
  input: linkInput,
  output: linkSchema,
});
export const deleteLink = defineRpc({
  name: "links.delete",
  input: z.strictObject({ id: z.string().min(1) }),
  output: z.object({ id: z.string() }),
});
/** Connections and read-only external inputs (CONNECTORS-SPEC, EXTERNAL-TRACKER-SPEC). Credentials never leave the daemon. */
export const listConnections = defineRpc({
  name: "connectors.connections",
  input: z.object({}),
  output: z.object({ connections: z.array(connectionSchema) }),
});
export const saveConnection = defineRpc({
  name: "connectors.connection-save",
  input: connectionInput,
  output: connectionSchema,
});
/** Checks an address and token with the service without saving them. */
export const testConnection = defineRpc({
  name: "connectors.connection-test",
  input: connectionInput,
  output: z.object({ account: z.string(), baseUrl: z.string() }),
});
export const deleteConnection = defineRpc({
  name: "connectors.connection-delete",
  input: z.strictObject({ id: z.string().min(1) }),
  output: z.object({ id: z.string() }),
});
/**
 * Picker rows: my recent items for an empty query, else by key, link, number or text.
 * GitHub/GitLab search the project's repositories unless `all` (CONNECTORS-SPEC §4.3).
 */
export const searchExternal = defineRpc({
  name: "connectors.search",
  input: z.strictObject({ connectionId: z.string().min(1), query: z.string().max(500), projectId: z.string().min(1).optional(), all: z.boolean().optional() }),
  output: z.object({ results: z.array(externalSummarySchema) }),
});
/** Current summaries of a card's external inputs (cached up to 30 minutes unless `refresh`). */
export const cardExternals = defineRpc({
  name: "connectors.card",
  input: z.strictObject({ taskId: z.string().min(1), refresh: z.boolean().optional() }),
  output: z.object({
    items: z.array(z.object({ artifactId: z.string(), summary: externalSummarySchema, stale: z.boolean() })),
    /** External inputs whose connection was removed: shown as plain links until it is added again. */
    removed: z.array(z.string()).default([]),
  }),
});
export const readExternal = defineRpc({
  name: "connectors.read",
  input: z.strictObject({ artifactId: z.string().min(1), refresh: z.boolean().optional() }),
  output: z.object({ summary: externalSummarySchema, markdown: z.string(), truncated: z.boolean(), stale: z.boolean(), fetchedAt: z.string() }),
});
/** Card artifacts: references to files and links (CARD-ARTIFACTS-SPEC §3). */
export const createArtifact = defineRpc({
  name: "artifacts.create",
  input: artifactInput,
  output: artifactSchema,
});
export const updateArtifact = defineRpc({
  name: "artifacts.update",
  input: artifactEdit,
  output: artifactSchema,
});
export const deleteArtifact = defineRpc({
  name: "artifacts.delete",
  input: z.strictObject({ id: z.string().min(1) }),
  output: z.object({ id: z.string() }),
});
/** Workpad edits by a person and HEAD refresh (WORKPAD-SPEC §6.3). */
export const checkWorkpad = defineRpc({
  name: "workpads.check",
  input: workpadCheck,
  output: workpadSchema,
});
export const resolveConfusion = defineRpc({
  name: "workpads.resolve-confusion",
  input: z.strictObject({ taskId: z.string().min(1), itemId: workpadItemId }),
  output: workpadSchema,
});
export const refreshWorkpad = defineRpc({
  name: "workpads.refresh",
  input: z.strictObject({ taskId: z.string().min(1) }),
  output: z.object({ head: gitHeadSchema.nullable() }),
});
/** Ids of a card's file artifacts that no longer exist (CARD-ARTIFACTS-SPEC §9). */
export const artifactStatus = defineRpc({
  name: "artifacts.status",
  input: z.strictObject({ taskId: z.string().min(1) }),
  output: z.object({ missing: z.array(z.string()) }),
});
export const previewArtifact = defineRpc({
  name: "artifacts.preview",
  input: z.strictObject({ id: z.string().min(1) }),
  output: z.discriminatedUnion("type", [
    z.object({ type: z.literal("image"), dataUri: z.string() }),
    z.object({ type: z.literal("text"), text: z.string(), markdown: z.boolean() }),
    z.object({
      type: z.literal("directory"),
      entries: z.array(z.object({ name: z.string(), directory: z.boolean() })),
      more: z.boolean(),
    }),
    z.object({ type: z.literal("unsupported"), size: z.number() }),
  ]),
});
export const deleteTask = defineRpc({
  name: "tasks.delete",
  input: taskDeletion,
  output: z.object({
    id: z.string(),
    backup: z.string(),
    /** Set when `archive` was requested. */
    archived: z.object({ sessions: z.number().int(), workspace: z.boolean() }).optional(),
  }),
});
export const moveTask = defineRpc({
  name: "tasks.move",
  input: z.object({
    id: z.string(),
    revision: z.number(),
    direction: z.enum(["up", "down"]),
  }),
  output: taskSchema,
});
export const placeTask = defineRpc({
  name: "tasks.place",
  input: taskPlacement,
  output: taskSchema,
});
export const listResources = defineRpc({
  name: "resources.list",
  input: z.object({}),
  output: z.object({
    projects: z.array(
      z.object({ id: z.string(), name: z.string(), path: z.string() }),
    ),
    workspaces: z.array(
      z.object({
        id: z.string(),
        projectId: z.string(),
        name: z.string(),
        path: z.string(),
        status: z.string(),
        repoPaths: z.array(z.string()),
        owner: z.string(),
      }),
    ),
  }),
});
export const readResourcesChanged = defineRpc({
  name: "resources.read-changed",
  input: etagInput,
  output: z.object({ etag: z.string(), value: listResources.output.optional() }),
});
export const taskContext = defineRpc({
  name: "tasks.context",
  input: z.object({ id: z.string() }),
  output: z.object({
    available: z.boolean(),
    reason: z.string(),
    context: z.string(),
    owner: z.string(),
    workspaceRepoPaths: z.array(z.string()),
    directories: z.array(z.object({ repo: z.string(), directory: z.string() })),
  }),
});
export const toolsHealth = defineRpc({
  name: "tools.health",
  input: z.object({}),
  output: healthSchema,
});
export const prepareSession = defineRpc({
  name: "tools.prepare-session",
  input: z.object({ id: z.string(), operationId: z.string().min(1).max(200) }),
  output: preparationSchema,
});
export const prepareExisting = defineRpc({
  name: "tools.prepare-existing",
  input: z.object({ id: z.string(), agentId: z.string() }),
  output: preparationSchema,
});
export const accessState = defineRpc({
  name: "tools.access-state",
  input: z.object({ id: z.string(), agentId: z.string() }),
  output: healthSchema.extend({
    methods: z.array(z.string()),
    lastSuccessAt: z.string().nullable(),
    lastAction: z.string().nullable(),
  }),
});
export const wrapupCheckSchema = z.object({
  taskId: z.string(),
  revision: z.number().int(),
  workspace: z
    .object({ id: z.string(), kind: z.string(), directory: z.string() })
    .nullable(),
  archiveWorkspace: z.boolean(),
  sessions: z.number().int(),
  git: z
    .object({
      branch: z.string(),
      uncommitted: z.number().int(),
      unpushed: z.number().int(),
    })
    .nullable(),
  blockers: z.array(z.string()),
  warnings: z.array(z.string()),
});
export type WrapupCheck = z.infer<typeof wrapupCheckSchema>;
export const wrapupResultSchema = z.object({
  archivedSessions: z.number().int(),
  archivedWorkspace: z.boolean(),
  note: z.string(),
});
export type WrapupResult = z.infer<typeof wrapupResultSchema>;
export const wrapupCheck = defineRpc({
  name: "tasks.wrapup-check",
  input: z.strictObject({ id: z.string().min(1) }),
  output: wrapupCheckSchema,
});
export const wrapup = defineRpc({
  name: "tasks.wrapup",
  input: z.strictObject({
    id: z.string().min(1),
    revision: z.number().int().positive(),
    acknowledgeWarnings: z.boolean(),
    /** Archive the sessions/workspace but leave the card on the board (the prompt after a move to Done/Cancelled). */
    keepCard: z.boolean().optional(),
  }),
  output: wrapupResultSchema,
});
/** Preflight for archiving Paseo resources before a permanent delete. */
export const deleteCheck = defineRpc({
  name: "tasks.delete-check",
  input: z.strictObject({ id: z.string().min(1) }),
  output: wrapupCheckSchema,
});
export const managedSessions = defineRpc({
  name: "sessions.managed",
  input: z.strictObject({}),
  output: z.array(
    z.object({ agentId: z.string(), taskId: z.string(), workspaceId: z.string() }),
  ),
});
/** What the native session pane's Flowly chips need besides the board (NATIVE-SESSION-SPEC §8). */
export const nativeChips = defineRpc({
  name: "sessions.native-chips",
  input: z.strictObject({}),
  output: z.object({
    managed: z.array(z.object({ agentId: z.string(), taskId: z.string(), workspaceId: z.string() })),
    /** The Ideas switch (IDEAS-INBOX-SPEC §10): off hides the Ideas chip. */
    ideas: z.boolean(),
    /** Auto wrap up (MULTITASK-SPEC): on, Move to Done on the Next moves card asks nothing. */
    autoWrapup: z.boolean(),
    /** What tapping a message suggestion on the Next moves card does (NATIVE-SESSION-SPEC §6.4). */
    nextMoveTap: z.enum(["fill", "copy"]),
  }),
});
export const configureSession = defineRpc({
  name: "sessions.configure",
  input: z
    .strictObject({
      taskId: z.string().min(1).max(200),
      // IDs become CLI arguments: never allow a leading "-" (option injection).
      agentId: z.string().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/),
      thinkingOptionId: z.string().min(1).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/).optional(),
      modeId: z.string().min(1).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/).optional(),
      stop: z.boolean().optional(),
      /** New display name of the session; a single line. */
      title: z.string().trim().min(1).max(200).regex(/^[^\u0000-\u001f\u007f]+$/, "A title is a single line.").optional(),
    })
    .refine((i) => i.thinkingOptionId || i.modeId || i.stop || i.title, { message: "Nothing to change." }),
  output: z.object({ applied: z.array(z.string()) }),
});
export const readComposer = defineRpc({
  name: "composer.read",
  input: z.strictObject({}),
  output: composerStateSchema,
});
export const saveDraft = defineRpc({
  name: "composer.draft",
  input: composerTarget.extend({ text: z.string().max(20000) }),
  output: z.object({ ok: z.boolean() }),
});
export const queueMessage = defineRpc({
  name: "composer.queue",
  input: composerTarget
    .extend({ text: z.string().trim().max(20000), images: z.array(outgoingImageSchema).max(maxImages).optional() })
    .refine((v) => !!v.text || !!v.images?.length, "Write a message or attach an image."),
  output: queuedMessageSchema,
});
export const unqueueMessage = defineRpc({
  name: "composer.unqueue",
  input: z.strictObject({ agentId: z.string().min(1).max(200), id: z.string().min(1).max(200) }),
  output: z.object({ ok: z.boolean() }),
});
export const sendQueuedNow = defineRpc({
  name: "composer.send-now",
  input: composerTarget.extend({ id: z.string().min(1).max(200) }),
  output: z.object({ sent: z.boolean() }),
});
export const sessionImage = defineRpc({
  name: "sessions.image",
  input: z.strictObject({
    taskId: z.string().min(1).max(200),
    agentId: z.string().min(1).max(200),
    src: z.string().min(1).max(4096),
  }),
  output: z.object({ dataUri: z.string() }),
});
export const moveProject = defineRpc({
  name: "projects.move",
  input: z
    .strictObject({
      id: z.string().min(1).max(200),
      direction: z.enum(["up", "down", "top"]).optional(),
      /** Target index in the ordered list (drag and drop). */
      to: z.number().int().min(0).max(10000).optional(),
    })
    .refine((v) => (v.direction === undefined) !== (v.to === undefined), "Give either direction or to."),
  output: z.array(z.string()),
});
export const readSummaries = defineRpc({
  name: "summaries.read",
  input: z.strictObject({}),
  output: summaryOverviewSchema,
});
export const readSummariesChanged = defineRpc({
  name: "summaries.read-changed",
  input: etagInput,
  output: z.object({ etag: z.string(), value: summaryOverviewSchema.optional() }),
});
export const sessionTail = defineRpc({
  name: "sessions.tail",
  input: z.strictObject({
    taskId: z.string().min(1).max(200),
    agentId: z.string().min(1).max(200),
    limit: z.number().int().min(1).max(100),
  }),
  output: z.object({ entries: z.array(tailEntrySchema) }),
});
export const archivedSessions = defineRpc({
  name: "sessions.archived",
  input: z.strictObject({ taskId: z.string().min(1).max(200) }),
  // Paseo agent snapshots, passed through as the daemon returns them.
  output: z.array(z.looseObject({ id: z.string(), archivedAt: z.string().nullish() })),
});
export const summaryHistory = defineRpc({
  name: "summaries.history",
  input: z.strictObject({ taskId: z.string().min(1) }),
  output: z.array(summaryEntrySchema),
});
export const refreshSummary = defineRpc({
  name: "summaries.refresh",
  input: z.strictObject({ taskId: z.string().min(1) }),
  output: z.object({ queued: z.boolean() }),
});
export const taskUsage = defineRpc({
  name: "usage.task",
  input: z.strictObject({ taskId: z.string().min(1) }),
  output: taskUsageSchema,
});

/** Project Insights (PROJECT-INSIGHTS-SPEC §8). `tz` is the client's IANA zone. */
const insightsDay = {
  projectId: z.string().min(1),
  tz: z.string().max(100),
};
export const projectInsights = defineRpc({
  name: "insights.project",
  input: z.strictObject({ ...insightsDay, day: z.string().max(10).optional(), etag: z.string().max(200).optional() }),
  output: z.object({ etag: z.string(), value: insightsWithHabitsSchema.optional() }),
});
export const projectDigest = defineRpc({
  name: "insights.digest",
  input: z.strictObject({ ...insightsDay, day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  output: digestViewSchema,
});
export const refreshDigest = defineRpc({
  name: "insights.digest-refresh",
  input: z.strictObject({ ...insightsDay, day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  output: z.object({ queued: z.boolean() }),
});
export const projectTokens = defineRpc({
  name: "insights.tokens",
  input: z.strictObject({ ...insightsDay, day: z.string().max(10).optional(), etag: z.string().max(200).optional() }),
  output: z.object({ etag: z.string(), value: tokenInsightsSchema.optional() }),
});
