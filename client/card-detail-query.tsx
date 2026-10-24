import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { useRpc } from "@getpaseo/plugin/client";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import * as rpc from "../shared/rpc";
import { CARD_UNAVAILABLE, cardDetail, projectCardIndex, type CardDetail, type ProjectCardIndex } from "../shared/card-detail";
import type { Board } from "./board-read";
import { createChangedReader, boardKey } from "./queries";

export const detailKey = (hostId: string, taskId: string, workspaceId: string) => ["flowly", "card-detail", hostId, 1, taskId, workspaceId] as const;
export const projectIndexKey = (hostId: string, projectId: string) => ["flowly", "project-card-index", hostId, 1, projectId] as const;
export const projectIdeasKey = (hostId: string, projectId: string) => ["flowly", "project-ideas", hostId, 1, projectId] as const;
export type DetailRead = (input: { taskId: string; workspaceId: string; etag?: string }) => Promise<{ etag: string; value?: CardDetail }>;
const readDetailChanged = createChangedReader(), readIndexChanged = createChangedReader(), readIdeasChanged = createChangedReader();
export function detailQueryOptions(client: QueryClient, hostId: string, taskId: string, workspaceId: string, read: DetailRead, pollOnly = false) {
  const key = detailKey(hostId, taskId, workspaceId);
  return { queryKey: key, queryFn: async () => {
    const value = await readDetailChanged(client, key, etag => read({ taskId, workspaceId, ...(etag ? { etag } : {}) }));
    if (value.task.id !== taskId || value.task.workspaceId !== workspaceId || value.project.id !== value.task.projectId) throw new Error(CARD_UNAVAILABLE);
    return value;
  }, staleTime: 0, retry: false as const, ...(pollOnly ? { notifyOnChangeProps: [] } : {}) };
}
export const detailUnavailable = (error: unknown) => error instanceof Error && error.message.includes(CARD_UNAVAILABLE);
export function useCardDetailQuery(hostId: string, taskId: string, workspaceId: string, enabled: boolean, interval?: number, pollOnly = false) {
  const client = useQueryClient(), read = useRpc(rpc.readCardDetailChanged);
  return useQuery({ ...detailQueryOptions(client, hostId, taskId, workspaceId, read, pollOnly), enabled: enabled && !!taskId && !!workspaceId, refetchInterval: interval, refetchOnMount: interval ? false : true });
}
export function useProjectIndexQuery(hostId: string, projectId: string, enabled: boolean) {
  const client = useQueryClient(), read = useRpc(rpc.readProjectCardIndexChanged), key = projectIndexKey(hostId, projectId);
  return useQuery({ queryKey: key, queryFn: () => readIndexChanged(client, key, etag => read({ projectId, ...(etag ? { etag } : {}) })), enabled: enabled && !!projectId, staleTime: 0, retry: false });
}
export function useProjectIdeasQuery(hostId: string, projectId: string, enabled: boolean) {
  const client = useQueryClient(), read = useRpc(rpc.readProjectIdeasChanged), key = projectIdeasKey(hostId, projectId);
  return useQuery({ queryKey: key, queryFn: () => readIdeasChanged(client, key, etag => read({ projectId, ...(etag ? { etag } : {}) })), enabled: enabled && !!projectId, refetchInterval: enabled ? 3000 : undefined, staleTime: 0, retry: false });
}
/** Refresh the appropriate active display readers; disabled full observers do not fetch. */
export async function invalidateCardViews(client: QueryClient) {
  await Promise.all([boardKey, ["flowly", "card-detail"], ["flowly", "overview"], ["flowly", "project-card-index"], ["flowly", "project-ideas"]].map(queryKey => client.invalidateQueries({ queryKey })));
}
export type CardDetailState = { hostId: string; native: boolean; detail?: CardDetail; index?: ProjectCardIndex; error: unknown; indexError: unknown; pending: boolean; retry(): void; retryIndex(): void };
export const CardDetailContext = createContext<CardDetailState | null>(null);
export function useTaskDetail() {
  const value = useContext(CardDetailContext);
  if (!value) throw new Error("Card detail provider is missing.");
  return value;
}
/** Web adapts its complete Board here. Native never creates a complete-board observer. */
export function CardDetailProvider({ hostId, task, native, active, fullBoard, initialRead = true, children }: { hostId: string; task: { id: string; workspaceId: string; projectId: string }; native: boolean; active: boolean; fullBoard?: Board; initialRead?: boolean; children: ReactNode }) {
  const query = useCardDetailQuery(hostId, task.id, task.workspaceId, native && active && initialRead);
  const index = useProjectIndexQuery(hostId, task.projectId, native && active);
  const webDetail = useMemo(() => !native && fullBoard && fullBoard.tasks.some(t => t.id === task.id && t.workspaceId === task.workspaceId) && fullBoard.projects.some(p => p.id === task.projectId) ? cardDetail(fullBoard, { taskId: task.id, workspaceId: task.workspaceId }) : undefined, [native, fullBoard, task.id, task.workspaceId]);
  const webIndex = useMemo(() => !native && fullBoard?.projects.some(p => p.id === task.projectId) ? projectCardIndex(fullBoard, task.projectId) : undefined, [native, fullBoard, task.projectId]);
  const retry = useCallback(() => void query.refetch(), [query.refetch]);
  const retryIndex = useCallback(() => void index.refetch(), [index.refetch]);
  const detail = native ? (detailUnavailable(query.error) ? undefined : query.data) : webDetail;
  const cards = native ? index.data : webIndex;
  const error = native ? query.error : null, indexError = native ? index.error : null;
  const pending = native && query.isPending;
  const value = useMemo<CardDetailState>(() => ({ hostId, native, detail, index: cards, error, indexError, pending, retry, retryIndex }),
    [hostId, native, detail, cards, error, indexError, pending, retry, retryIndex]);
  return <CardDetailContext.Provider value={value}>{children}</CardDetailContext.Provider>;
}
