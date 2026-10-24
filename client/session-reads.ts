import { useQuery } from "@tanstack/react-query";
import { useRpc } from "@getpaseo/plugin/client";
import { readSessionReceipts, markSessionRead, markSessionUnread } from "../shared/rpc";
import type { MarkSessionReadInput, MarkSessionUnreadInput } from "../shared/session-attention";

const noReceipts: never[] = [];

export function useSessionReads(enabled = true) {
  const read = useRpc(readSessionReceipts),
    mark = useRpc(markSessionRead),
    unmark = useRpc(markSessionUnread);
  const query = useQuery({
    queryKey: ["flowly", "sessionReads"],
    queryFn: () => read({}),
    refetchInterval: 5000,
    enabled,
  });
  return {
    query,
    receipts: query.data?.receipts || noReceipts,
    async markRead(input: MarkSessionReadInput) {
      const receipt = await mark(input);
      await query.refetch();
      return receipt;
    },
    /** Keeps the session unread until it is read again. */
    async markUnread(input: MarkSessionUnreadInput) {
      const mark = await unmark(input);
      await query.refetch();
      return mark;
    },
  };
}
