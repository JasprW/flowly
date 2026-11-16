import { z } from "zod";
import { toolContextSchema, toolResultSchema, type ToolContext } from "./tools";

/** Presentation only: never part of a mutation's input hash (AGENT-OUTPUT-SPEC). */
export const outputDetailShape = {
  responseDetail: z.enum(["compact", "full"]).optional().describe("Default compact; full returns the previous complete context when you need omitted fields."),
};
export const outputDetailSchema = z.strictObject(outputDetailShape);
export const agentCallSchema = z.looseObject(outputDetailShape);
const acceptance = z.object({ id: z.string(), text: z.string(), done: z.boolean() });
const compactTask = toolContextSchema.shape.task.omit({
  sourcePath: true, repoPaths: true, position: true, revision: true, operationId: true,
  createdAt: true, updatedAt: true, archivedAt: true, review: true,
}).extend({ tags: z.array(z.object({ tag: z.string(), by: z.enum(["human", "agent"]) })).optional() });
const compactProject = toolContextSchema.shape.project.pick({
  id: true, title: true, description: true, paseoProjectId: true, primaryPath: true,
});
const compactActivity = toolContextSchema.shape.activity.element.pick({
  actor: true, action: true, at: true, agentId: true, note: true, from: true, to: true, reportKind: true,
});
const compactArtifact = toolContextSchema.shape.artifacts.element.omit({ missing: true, unread: true, ticket: true }).extend({
  missing: z.literal(true).optional(), unread: z.literal(true).optional(),
});
const compactWorkpad = z.object({ revision: z.number(), acceptance: z.array(acceptance) }).nullable();
const compactReadSchema = toolContextSchema.extend({
  toolVersion: z.literal(2), task: compactTask, project: compactProject,
  activity: z.array(compactActivity), artifacts: z.array(compactArtifact), workpad: compactWorkpad.optional(),
});
/** Object root for MCP outputSchema, with both supported presentations nested. */
export const agentReadSchema = compactReadSchema.extend({
  toolVersion: z.union([z.literal(1), z.literal(2)]),
  task: z.union([toolContextSchema.shape.task, compactTask]),
  project: z.union([toolContextSchema.shape.project, compactProject]),
  activity: z.array(z.union([toolContextSchema.shape.activity.element, compactActivity])),
  artifacts: z.array(z.union([toolContextSchema.shape.artifacts.element, compactArtifact])),
  workpad: z.union([toolContextSchema.shape.workpad, compactWorkpad]).optional(),
});
export const continuationSchema = toolContextSchema.pick({
  identity: true, revision: true, request: true, setup: true, writable: true, reason: true, workpadEnabled: true,
}).extend({
  toolVersion: z.literal(2),
  task: toolContextSchema.shape.task.pick({ id: true, status: true }),
  workpad: compactWorkpad,
});
export const agentWriteSchema = toolResultSchema.extend({
  current: z.union([toolContextSchema, continuationSchema]).nullable(),
});
export type Continuation = z.infer<typeof continuationSchema>;
export type AgentWriteResult = z.infer<typeof agentWriteSchema>;

export function actionableEvent(event: { action: string }) {
  return !event.action.startsWith("agent.") && event.action !== "next_moves_suggested";
}
export function acceptanceOutput(items: readonly { id: string; text: string; done: boolean }[]) {
  return items.map(({ id, text, done }) => ({ id, text, done }));
}
/** Parse the dedicated projection rather than exposing persisted model bookkeeping. */
export function compactRead(context: ToolContext) {
  const { tags, ...task } = context.task;
  return compactReadSchema.parse({
    ...context, toolVersion: 2,
    task: { ...task, ...(tags ? { tags: tags.map(({ tag, by }) => ({ tag, by })) } : {}) },
    artifacts: context.artifacts.map(({ missing, unread, ticket: _ticket, ...artifact }) => ({
      ...artifact, ...(missing ? { missing: true } : {}), ...(unread ? { unread: true } : {}),
    })),
  });
}
