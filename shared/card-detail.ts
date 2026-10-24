import { z } from "zod";
import { attentionDismissalSchema } from "./attention-dismiss";
import { artifactSchema, boardSchema, eventSchema, ideaSchema, linkSchema, planSnapshotSchema, projectSchema, taskSchema, workpadSchema } from "./model";
import { projectTagStats } from "./tags";

export const cardReferenceSchema = taskSchema.pick({ id: true, projectId: true, title: true, status: true, archivedAt: true, position: true, type: true, priority: true, workspaceId: true });
export type CardReference = z.infer<typeof cardReferenceSchema>;
export const cardDetailSchema = z.strictObject({
  version: z.literal(1), revision: z.number().int().nonnegative(), task: taskSchema, project: projectSchema,
  events: z.array(eventSchema), ideas: z.array(ideaSchema), artifacts: z.array(artifactSchema),
  workpad: workpadSchema.nullable(), plans: z.array(planSnapshotSchema), links: z.array(linkSchema),
  relatedTasks: z.array(cardReferenceSchema), attentionDismissal: attentionDismissalSchema.nullable(),
});
export type CardDetail = z.infer<typeof cardDetailSchema>;
export const projectCardIndexSchema = z.strictObject({
  version: z.literal(1), projectId: z.string(), revision: z.number().int().nonnegative(), cards: z.array(cardReferenceSchema),
  tags: z.array(z.strictObject({ tag: z.string(), count: z.number().int().nonnegative(), lastUsedAt: z.string() })),
});
export type ProjectCardIndex = z.infer<typeof projectCardIndexSchema>;
export const projectIdeasSchema = z.strictObject({ version: z.literal(1), projectId: z.string(), revision: z.number().int().nonnegative(), ideas: z.array(ideaSchema) });
export type ProjectIdeas = z.infer<typeof projectIdeasSchema>;
export const CARD_UNAVAILABLE = "This session's linked card is unavailable. Refresh the session chip or open Flowly.";
type Board = z.infer<typeof boardSchema>;
export const cardReference = (task: Board["tasks"][number]): CardReference => cardReferenceSchema.parse(task);
/** Complete stored bodies for one card; never masquerades as a Board. Also used by the web adapter. */
export function cardDetail(board: Board, input: { taskId: string; workspaceId: string }): CardDetail {
  const task = board.tasks.find(t => t.id === input.taskId && t.workspaceId === input.workspaceId);
  const project = task && board.projects.find(p => p.id === task.projectId);
  if (!task || !project) throw new Error(CARD_UNAVAILABLE);
  const links = board.links.filter(l => l.from === task.id || l.to === task.id);
  const ideas = board.ideas.filter(i => i.taskId === task.id);
  const ids = new Set([task.id, ...(task.origin ? [task.origin.taskId] : []), ...links.flatMap(l => [l.from, l.to]), ...ideas.flatMap(i => i.acceptedTaskId ? [i.acceptedTaskId] : [])]);
  return { version: 1, revision: board.revision, task, project, links, ideas,
    events: board.events.filter(e => e.taskId === task.id), artifacts: board.artifacts.filter(a => a.taskId === task.id),
    workpad: board.workpads.find(w => w.taskId === task.id) ?? null, plans: board.plans.filter(p => p.taskId === task.id),
    relatedTasks: board.tasks.filter(t => ids.has(t.id)).map(cardReference),
    attentionDismissal: board.attentionDismissals.find(a => a.taskId === task.id) ?? null };
}
export function projectCardIndex(board: Board, projectId: string): ProjectCardIndex {
  if (!board.projects.some(p => p.id === projectId)) throw new Error("Project is unavailable.");
  return { version: 1, projectId, revision: board.revision, cards: board.tasks.filter(t => t.projectId === projectId).map(cardReference), tags: projectTagStats(board.tasks, projectId) };
}
export function projectIdeas(board: Board, projectId: string): ProjectIdeas {
  if (!board.projects.some(p => p.id === projectId)) throw new Error("Project is unavailable.");
  return { version: 1, projectId, revision: board.revision, ideas: board.ideas.filter(i => i.projectId === projectId) };
}
