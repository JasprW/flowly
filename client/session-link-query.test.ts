import { expect, test, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type { PaseoApi } from "@getpaseo/client";
import { boardKey, boardQueryOptions } from "./queries";
import type { Board } from "./board-read";
import { resolveSessionLink } from "./session-link";
import { BoardDeltas } from "../server/board-delta";

vi.mock("@getpaseo/plugin/client", () => ({ usePaseo: () => null, useRpc: () => null }));

const link = { taskId: "t", workspaceId: "w", sessionId: "a", requestId: "request" };
function fixture() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } } });
  let board = {
    version: 5, revision: 1, projects: [{ id: "p" }], tasks: [{ id: "t", projectId: "p", workspaceId: "w" }],
    events: [], plans: [], links: [], ideas: [], artifacts: [], workpads: [], attentionDismissals: [],
  } as unknown as Board;
  const deltas = new BoardDeltas();
  const read = vi.fn(async (input: { etag?: string }) => deltas.read(board, input));
  const refresh = vi.fn(async () => ({ agent: { id: "a", workspaceId: "w" } }) as { agent: { id: string; workspaceId: string; archivedAt?: string } } | null);
  const paseo = { agents: { ref: vi.fn(() => ({ refresh })) } } as unknown as PaseoApi;
  const fresh = () => client.fetchQuery({ ...boardQueryOptions(client, read), retry: false });
  return { client, read, refresh, paseo, fresh, board: () => board, change: (patch: Partial<Board>) => { board = { ...board, revision: board.revision + 1, ...patch }; } };
}

test("cold chip validation and board mount join one full read; warm links and the following poll keep the etag", async () => {
  const x = fixture();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const cold = x.read.getMockImplementation()!;
  x.read.mockImplementationOnce(async (input) => { await gate; return cold(input); });
  const route = resolveSessionLink(x.paseo, x.fresh, link);
  const boardMount = x.client.fetchQuery(boardQueryOptions(x.client, x.read));
  expect(x.read).toHaveBeenCalledTimes(1);
  release();
  const [target, mounted] = await Promise.all([route, boardMount]);
  expect(target.board).toBe(mounted);
  expect(x.client.getQueryData(boardKey)).toBe(mounted);
  expect(x.read.mock.calls[0][0]).toEqual({});
  // Even a same-tick cache with an Infinity default must be revalidated.
  await resolveSessionLink(x.paseo, x.fresh, { ...link, requestId: "next" });
  expect(x.read).toHaveBeenCalledTimes(2);
  expect(x.refresh).toHaveBeenCalledTimes(2);
  expect(x.read.mock.calls[1][0].etag).toBeTruthy();
  await x.client.fetchQuery(boardQueryOptions(x.client, x.read));
  expect(x.read).toHaveBeenCalledTimes(3);
  expect(x.read.mock.calls[2][0].etag).toBeTruthy();
  expect(x.client.getQueryData(boardKey)).toBe(mounted);
  x.client.clear();
});

test("a warm link observes server changes as a patch and rejects a removed or rebound card/project", async () => {
  for (const patch of [
    { tasks: [] },
    { tasks: [{ id: "t", projectId: "p", workspaceId: "other" }] },
    { projects: [] },
  ]) {
    const x = fixture();
    await x.fresh();
    x.change(patch as Partial<Board>);
    await expect(resolveSessionLink(x.paseo, x.fresh, link)).rejects.toThrow("linked card is unavailable");
    expect(x.read.mock.calls[1][0].etag).toBeTruthy();
    expect(x.client.getQueryData(boardKey)).toEqual(x.board());
    x.client.clear();
  }
});

test("each warm navigation refreshes the exact actor; missing, wrong id and moved actors fail closed", async () => {
  const x = fixture();
  await resolveSessionLink(x.paseo, x.fresh, link);
  for (const snapshot of [null, { agent: { id: "a", workspaceId: "other" } }, { agent: { id: "wrong", workspaceId: "w" } }]) {
    x.refresh.mockResolvedValueOnce(snapshot);
    await expect(resolveSessionLink(x.paseo, x.fresh, link)).rejects.toThrow("workspace changed");
  }
  expect(x.refresh).toHaveBeenCalledTimes(4);
  expect(x.paseo.agents.ref).toHaveBeenLastCalledWith("a");
  x.client.clear();
});

test("read and actor failures cannot fall back to a valid cached card; archived links still resolve", async () => {
  const x = fixture();
  await x.fresh();
  x.read.mockRejectedValueOnce(new Error("offline"));
  await expect(resolveSessionLink(x.paseo, x.fresh, link)).rejects.toThrow("Kanban board read failed: offline");
  x.refresh.mockRejectedValueOnce(new Error("lookup failed"));
  await expect(resolveSessionLink(x.paseo, x.fresh, link)).rejects.toThrow("Session lookup failed: lookup failed");
  x.change({ tasks: [{ ...x.board().tasks[0], archivedAt: "2026-10-23" }], projects: [{ ...x.board().projects[0], archivedAt: "2026-10-23" }] });
  x.refresh.mockResolvedValueOnce({ agent: { id: "a", workspaceId: "w", archivedAt: "2026-10-23" } });
  expect((await resolveSessionLink(x.paseo, x.fresh, link)).task.archivedAt).toBe("2026-10-23");
  x.client.clear();
});
