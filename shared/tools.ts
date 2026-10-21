import { z } from "zod";
import { relations } from "./links";
import { connectorProviderSchema, itemTypeSchema } from "./connectors";
import {
  taskSchema,
  projectSchema,
  eventSchema,
  receiptSchema,
  statusSchema,
  legacyStatus,
  ideaLimits,
  ideaStatuses,
  artifactLimits,
  artifactRoles,
  artifactKinds,
  prioritySchema,
  taskTypeSchema,
  tagLimits,
  tagInputList,
  nextMoveLimits,
  nextMoveTargets,
  workpadLimits,
  workpadItemId,
  checkStates,
  acceptanceItemSchema,
  validationItemSchema,
  confusionItemSchema,
  gitHeadSchema,
  planStatuses,
} from "./model";

export const agentStatuses = ["design", "development", "test", "blocked", "in_review"] as const;
export const revisionSchema = z.strictObject({
  task: z.number().int().positive(),
  project: z.number().int().positive(),
});
export const requestSchema = z.strictObject({
  id: z.string().min(1).max(4096),
  issuedAt: z.string().datetime(),
});
/**
 * A set of 0-3 suggested next messages (NEXT-MOVES-SPEC §2, §7, §8.2), the same on every entry: flowly_suggest_next_moves
 * and the optional nextMoves of flowly_update_status / flowly_report_progress. An empty list is the explicit
 * "nothing for the user this turn".
 */
const nextMoveList = z
  .array(
    z.strictObject({
      label: z
        .string()
        .trim()
        .min(1)
        .max(nextMoveLimits.label)
        .describe("Button text: a short verb phrase in the user's language, e.g. \"Verify with Luna\" or \"Commit and push\"."),
      prompt: z
        .string()
        .trim()
        .min(1)
        .max(nextMoveLimits.prompt)
        .optional()
        .describe("The message pre-filled into the user's message box when they pick it, written as the user's instruction to you and understandable on its own. Required unless moveTo is set."),
      moveTo: z
        .enum(nextMoveTargets)
        .optional()
        .describe("\"done\": picking it moves the card to Done (the user's decision; nothing is sent, no prompt). Only when all work is delivered and committed and pushed. At most one per call."),
    }),
  )
  .max(nextMoveLimits.count)
  .superRefine((moves, ctx) => {
    moves.forEach((m, i) => {
      if (!m.moveTo && !m.prompt) ctx.addIssue({ code: "custom", path: [i, "prompt"], message: "prompt is required unless moveTo is set" });
      if (m.moveTo && moves.findIndex((x) => x.moveTo === m.moveTo) !== i)
        ctx.addIssue({ code: "custom", path: [i, "moveTo"], message: "at most one move per moveTo target" });
    });
  });
/** nextMoves on flowly_update_status / flowly_report_progress (NEXT-MOVES-SPEC §8): recorded in the same write. */
const deliveryMoves = nextMoveList
  .optional()
  .describe(
    "The next steps for the user, recorded with this call: 1-3 messages they are most likely to send you next, the one you recommend first; [] when nothing needs the user this turn. Leave it out to record nothing. A moveTo=\"done\" move is only accepted together with in_review.",
  );

const base = {
  expectedRevision: revisionSchema,
  request: requestSchema,
  note: z.string().trim().min(1).max(10000),
};
export const statusInputSchema = z.strictObject({
  ...base,
  status: z
    .enum([...agentStatuses, legacyStatus])
    .describe(
      "One of allowedStatuses. in_progress is a deprecated alias kept for older sessions: it keeps the current work stage, else Development.",
    ),
  acknowledgeOpen: z
    .boolean()
    .optional()
    .describe(
      "Deliver to in_review although workpad items are still open (WORKPAD_OPEN). Only with a note that explains every open item.",
    ),
  nextMoves: deliveryMoves,
});
export const progressInputSchema = z.strictObject({
  ...base,
  kind: z.enum(["progress", "blocker", "result", "question"]).default("progress"),
  nextMoves: deliveryMoves,
});
/** flowly_propose_idea (IDEAS-SPEC §3): a follow-up outside this card's scope. */
export const ideaInputSchema = z.strictObject({
  expectedRevision: revisionSchema,
  request: requestSchema,
  title: z.string().trim().min(1).max(ideaLimits.title).describe("Short task title for the follow-up card."),
  detail: z
    .string()
    .trim()
    .min(1)
    .max(ideaLimits.detail)
    .describe("What the follow-up task should do and how to tell it is done."),
  rationale: z
    .string()
    .trim()
    .min(1)
    .max(ideaLimits.rationale)
    .describe("Why it is worth doing and what in this card's work led to it."),
  context: z
    .string()
    .trim()
    .max(ideaLimits.context)
    .default("")
    .describe("Files, branches and findings the new task needs; its agent cannot see this conversation."),
  type: taskTypeSchema.optional(),
  priority: prioritySchema.optional(),
  tags: tagInputList.optional().describe("Suggested module/direction tags for the follow-up card; reuse projectTags."),
  scope: z
    .enum(["here", "new"])
    .default("new")
    .describe(
      "here: an extension of this card's goal that this card's session can continue with its current context; new: divergent work that deserves its own card.",
    ),
});
/** flowly_set_tags (CARD-TAGS-SPEC §4.1): tag this card with modules and directions. */
export const tagsInputSchema = z.strictObject({
  expectedRevision: revisionSchema,
  request: requestSchema,
  add: z
    .array(z.string().max(200))
    .max(tagLimits.perCall)
    .default([])
    .describe('Tags to add, e.g. "drawer", "session-composer", "performance", "a11y". Lowercase letters, numbers, "-", "." and "/"; at most 32 characters.'),
  remove: z
    .array(z.string().max(200))
    .max(tagLimits.perCall)
    .default([])
    .describe("Tags to remove. Only tags an agent added can be removed."),
});
/** flowly_set_type (CARD-TYPE-SPEC §2): classify a card that has no type yet. */
export const typeInputSchema = z.strictObject({
  expectedRevision: revisionSchema,
  request: requestSchema,
  type: taskTypeSchema.describe(
    "feature: new behavior; bugfix: wrong behavior fixed; research: investigation or analysis without a shipped change; refactor: restructuring without behavior change; docs: documentation only; chore: build, tooling, dependencies, maintenance.",
  ),
});
/** flowly_suggest_next_moves (NEXT-MOVES-SPEC §2): the session's candidate next messages for the user. */
export const nextMovesInputSchema = z.strictObject({
  expectedRevision: revisionSchema,
  request: requestSchema,
  moves: nextMoveList.describe("0-3 next steps, the one you recommend first. Pass [] when nothing needs the user this turn."),
});
const itemId = workpadItemId
  .optional()
  .describe("Keep the id from get_task when you update an item; omit it for a new one.");
/** flowly_update_workpad (WORKPAD-SPEC §3): replace the card's acceptance criteria, checks and confusions. */
export const workpadInputSchema = z.strictObject({
  expectedRevision: revisionSchema,
  request: requestSchema,
  workpadRevision: z
    .number()
    .int()
    .nonnegative()
    .describe("workpad.revision from get_task; 0 when the card has no workpad yet."),
  acceptance: z
    .array(
      z.strictObject({
        id: itemId,
        text: z.string().trim().min(1).max(workpadLimits.text),
        done: z.boolean(),
      }),
    )
    .max(workpadLimits.acceptance)
    .describe("Acceptance criteria: what must be true for the card to be done."),
  validation: z
    .array(
      z.strictObject({
        id: itemId,
        text: z.string().trim().min(1).max(workpadLimits.text).describe("What the check verifies."),
        command: z.string().trim().max(workpadLimits.command).optional().describe("The exact command, e.g. npm test."),
        state: z.enum(checkStates).describe("pass or fail only after you actually ran it; unrun otherwise."),
        sha: z
          .string()
          .trim()
          .regex(/^[0-9a-fA-F]{4,40}$/)
          .optional()
          .describe("The commit it ran on (git rev-parse --short HEAD). Omitted: the previous one when unchanged, else the current HEAD."),
        dirty: z.boolean().optional().describe("It ran with uncommitted changes."),
        evidence: z.string().trim().max(workpadLimits.evidence).optional().describe("Short output summary or the failure."),
      }),
    )
    .max(workpadLimits.validation)
    .describe("Validation checks with their state."),
  confusions: z
    .array(z.strictObject({ id: itemId, text: z.string().trim().min(1).max(workpadLimits.confusion) }))
    .max(workpadLimits.confusions)
    .describe("What in the card was unclear and what you assumed."),
});
/** flowly_add_artifact (CARD-ARTIFACTS-SPEC §4.1): register an input or a deliverable of this card. */
export const artifactInputSchema = z.strictObject({
  expectedRevision: revisionSchema,
  request: requestSchema,
  role: z.enum(artifactRoles).describe("input: material this card worked from; output: something it delivered."),
  target: z
    .string()
    .trim()
    .min(1)
    .max(artifactLimits.target)
    .describe("An http(s) link, or a file/directory path (absolute, or relative to the workspace directory) inside this card's directories."),
  title: z.string().trim().max(artifactLimits.title).optional().describe("Short title; defaults to the file name or link."),
  note: z.string().trim().max(artifactLimits.note).optional().describe("One line on what it is for."),
});
/** flowly_read_external (CONNECTORS-SPEC §9; alias flowly_read_ticket): read an external input of this card. */
export const readExternalInputSchema = z.strictObject({
  artifactId: z.string().min(1).describe("Id of an external input in get_task artifacts (one with an external field)."),
  refresh: z.boolean().default(false).describe("Bypass the 60-second cache."),
});
export const externalReadSchema = z.object({
  artifactId: z.string(),
  key: z.string(),
  url: z.string(),
  status: z.string(),
  /** The item as Markdown: metadata, description or page content, latest comments; for PR/MR also branches and changed file names. */
  markdown: z.string(),
  truncated: z.boolean(),
  /** The service could not be reached; this is the cached copy from fetchedAt. */
  stale: z.boolean(),
  fetchedAt: z.string(),
});
export type ReadExternalInput = z.input<typeof readExternalInputSchema>;
const externalContextSchema = z.object({
  provider: connectorProviderSchema,
  itemType: itemTypeSchema,
  key: z.string(),
  summary: z.string(),
  /** "" for Confluence pages. */
  status: z.string(),
  type: z.string(),
  priority: z.string(),
  assignee: z.string(),
  /** Repository path, Confluence space or Jira project. */
  container: z.string(),
  updated: z.string(),
  /** The service could not be reached; values are from the last successful read. */
  stale: z.boolean(),
  /** removed: the user removed this service's connection in Flowly; the item can't be read until they add it again. */
  connection: z.enum(["ok", "removed"]),
});
export type ExternalContext = z.infer<typeof externalContextSchema>;
/** flowly_remove_artifact: only artifacts an agent added. */
export const artifactRemovalSchema = z.strictObject({
  expectedRevision: revisionSchema,
  request: requestSchema,
  id: z.string().min(1).describe("Artifact id from get_task."),
});
export const identitySchema = z.strictObject({
  agentId: z.string().min(1),
  taskId: z.string().min(1),
  workspaceId: z.string().min(1),
});
export type ToolIdentity = z.infer<typeof identitySchema>;
export const toolContextSchema = z.object({
  identity: identitySchema,
  task: taskSchema,
  project: projectSchema,
  revision: revisionSchema,
  request: requestSchema,
  toolVersion: z.literal(1),
  writable: z.boolean(),
  reason: z.string(),
  allowedStatuses: z.array(z.enum(agentStatuses)),
  /** The project's lanes (its workflow), in order, with display names. */
  lanes: z.array(z.object({ status: statusSchema, name: z.string() })),
  scope: z.object({
    mode: z.enum(["all", "selected"]),
    repoPaths: z.array(z.string()),
    directories: z.array(z.object({ repo: z.string(), directory: z.string() })),
  }),
  workspace: z.object({
    id: z.string(),
    directory: z.string(),
    nativeOwner: z.string(),
    status: z.string(),
    repoPaths: z.array(z.string()),
  }),
  sessions: z.object({
    entries: z.array(
      z.object({ id: z.string(), title: z.string(), status: z.string() }),
    ),
    partial: z.boolean(),
    unavailableReason: z.string(),
  }),
  activity: z.array(eventSchema),
  /** Ideas proposed on this card (IDEAS-SPEC §3), to avoid proposing duplicates. */
  ideas: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      status: z.enum(ideaStatuses),
      scope: z.enum(["here", "new"]).optional(),
      acceptedTaskId: z.string().optional(),
      acceptedAgentId: z.string().optional(),
    }),
  ),
  /** Scripts in the project root's paseo.json (WORKFLOW-INSIGHTS-SPEC §5.4); absent when it has none. */
  projectScripts: z.array(z.object({ name: z.string(), type: z.enum(["script", "service"]) })).optional(),
  /** The project's most used tags (CARD-TAGS-SPEC §2.3); reuse one when it fits. */
  projectTags: z.array(z.object({ tag: z.string(), count: z.number() })).optional(),
  /** The card's inputs and deliverables (CARD-ARTIFACTS-SPEC §4.2). `absolutePath` only for files. */
  artifacts: z.array(
    z.object({
      id: z.string(),
      role: z.enum(artifactRoles),
      kind: z.enum(artifactKinds),
      target: z.string(),
      absolutePath: z.string().optional(),
      title: z.string(),
      note: z.string(),
      createdBy: z.enum(["human", "agent"]),
      missing: z.boolean(),
      /** Added or edited since this session last called flowly_get_task (never for its own additions), or its external item's content changed. */
      unread: z.boolean(),
      /** An external input (CONNECTORS-SPEC §9): read its content with flowly_read_external. Status is for reference only. */
      external: externalContextSchema.optional(),
      /** Deprecated copy of `external` for Jira tickets, for sessions started with the older skill (CONNECTORS-SPEC §3.3). */
      ticket: externalContextSchema.optional(),
    }),
  ),
  /** false: the user turned the workpad off for this project (WORKPAD-SPEC §9); flowly_update_workpad returns WORKPAD_DISABLED. */
  workpadEnabled: z.boolean().optional(),
  /** The card's workpad (WORKPAD-SPEC §4.1); `fresh` is null for unrun checks. */
  workpad: z
    .object({
      revision: z.number(),
      acceptance: z.array(acceptanceItemSchema),
      validation: z.array(validationItemSchema.extend({ fresh: z.enum(["fresh", "stale", "unknown"]).nullable() })),
      confusions: z.array(confusionItemSchema),
      env: z.object({ host: z.string(), path: z.string(), head: gitHeadSchema.nullable() }).nullable(),
      head: gitHeadSchema.nullable(),
      open: z.object({ unchecked: z.number(), failed: z.number(), unrun: z.number(), stale: z.number(), total: z.number() }),
    })
    .nullable()
    .optional(),
  /** Each session's plan from its own todo list, this session first. */
  plan: z
    .array(
      z.object({
        agentId: z.string(),
        own: z.boolean(),
        items: z.array(z.object({ text: z.string(), status: z.enum(planStatuses) })),
        at: z.string(),
      }),
    )
    .optional(),
  /** Linked cards, read-only (CARD-LINKS-SPEC §4). `resolved` only for blocked_by. */
  links: z.array(
    z.object({
      relation: z.enum(relations),
      taskId: z.string(),
      title: z.string(),
      status: statusSchema,
      laneName: z.string(),
      archived: z.boolean(),
      resolved: z.boolean().optional(),
    }),
  ),
});
export const toolResultSchema = z.object({
  receipt: receiptSchema.omit({
    key: true,
    payloadHash: true,
    expiresAt: true,
  }),
  replayed: z.boolean(),
  /**
   * Calls the agent left out of this delivery, ask or result (NEXT-MOVES-SPEC §9): plain text, the write already
   * succeeded. Absent when there is nothing to remind.
   */
  reminders: z.array(z.string()).optional(),
  /** The proposed idea, for flowly_propose_idea. */
  ideaId: z.string().optional(),
  /** For flowly_add_artifact: the write succeeded but not as asked (an entry the user added keeps its role). */
  notice: z.string().optional(),
  /** The added, updated or removed artifact, for the artifact tools. */
  artifactId: z.string().optional(),
  current: toolContextSchema.nullable(),
  contextError: z.string().optional(),
});
export const healthSchema = z.object({
  listening: z.boolean(),
  sdkReady: z.boolean(),
  ready: z.boolean(),
  reason: z.string(),
  version: z.literal(1),
});
export const preparationSchema = z.object({
  agentId: z.string(),
  contextFile: z.string(),
  cliPath: z.string(),
  skillPath: z.string(),
  instructions: z.string(),
  mcp: z.object({
    type: z.literal("http"),
    url: z.string(),
    headers: z.record(z.string(), z.string()),
  }),
});
export type ToolContext = z.infer<typeof toolContextSchema>;
export type ToolResult = z.infer<typeof toolResultSchema>;
export type ToolPreparation = z.infer<typeof preparationSchema>;
export type StatusInput = z.infer<typeof statusInputSchema>;
export type ProgressInput = z.infer<typeof progressInputSchema>;
export type IdeaInput = z.infer<typeof ideaInputSchema>;
export type TagsToolInput = z.infer<typeof tagsInputSchema>;
export type TypeToolInput = z.infer<typeof typeInputSchema>;
export type NextMovesInput = z.infer<typeof nextMovesInputSchema>;
export type ArtifactToolInput = z.infer<typeof artifactInputSchema>;
export type ArtifactRemovalInput = z.infer<typeof artifactRemovalSchema>;
export type WorkpadInput = z.infer<typeof workpadInputSchema>;
