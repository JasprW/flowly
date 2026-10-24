import { cardDetail, projectCardIndex, projectIdeas } from "../shared/card-detail";
import type { boardSchema } from "../shared/model";
import type { z } from "zod";
import { etagOf } from "./etag";
type Board = z.infer<typeof boardSchema>;
/** Distinct content-hash domains; validation always precedes the etag comparison. */
function changed<T>(domain: string, value: T, etag?: string) {
  const tag = etagOf([domain, value]);
  return tag === etag ? { etag: tag } : { etag: tag, value };
}
export const readCardDetail = (board: Board, input: { taskId: string; workspaceId: string; etag?: string }) => changed(`detail-v1/${input.taskId}/${input.workspaceId}`, cardDetail(board, input), input.etag);
export const readProjectCardIndex = (board: Board, input: { projectId: string; etag?: string }) => changed(`index-v1/${input.projectId}`, projectCardIndex(board, input.projectId), input.etag);
export const readProjectIdeas = (board: Board, input: { projectId: string; etag?: string }) => changed(`project-ideas-v1/${input.projectId}`, projectIdeas(board, input.projectId), input.etag);
