import { useEffect, useRef } from "react";
import { useRpc } from "@getpaseo/plugin/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as rpc from "../shared/rpc";
import type { ComposerEntry, ComposerState, OutgoingImage } from "../shared/composer";
import { t } from "../shared/i18n";

const key = ["flowly", "composer"] as const;

/**
 * Queued messages shown before the daemon confirmed them. Until the last is confirmed no read may land, as it would
 * predate them and drop their rows from view: polling and focus, reconnect or mount refetches wait, refreshes are
 * skipped, and the last answer refreshes once.
 */
let unconfirmed = 0;
const settled = () => unconfirmed === 0;
/** Daemon id → the temporary id a queued message was first shown under, so its row keeps one key (no re-entry). */
const rowKeys = new Map<string, string>();
/** The React key for a queued message's row: stable from the moment it is queued until it is sent or removed. */
export const queuedRowKey = (id: string) => rowKeys.get(id) ?? id;

/**
 * Daemon-persisted drafts and queued follow-ups (survive plugin reload / app
 * refresh). Mutations update the cache optimistically, then reconcile.
 */
export function useComposer(enabled = true) {
  const client = useQueryClient();
  const read = useRpc(rpc.readComposer),
    save = useRpc(rpc.saveDraft),
    push = useRpc(rpc.queueMessage),
    unqueue = useRpc(rpc.unqueueMessage),
    sendNow = useRpc(rpc.sendQueuedNow);
  const query = useQuery({
    queryKey: key,
    queryFn: () => read({}),
    refetchInterval: () => (settled() ? 3000 : false),
    refetchOnWindowFocus: settled,
    refetchOnReconnect: settled,
    refetchOnMount: settled,
    enabled,
  });
  const patch = (update: (state: ComposerState) => ComposerState) =>
    client.setQueryData<ComposerState>(key, (current) => update(current ?? { version: 1, sessions: {} }));
  const refresh = () => {
    if (settled()) void client.invalidateQueries({ queryKey: key });
  };
  const timers = useRef(new Map<string, { timer: ReturnType<typeof setTimeout>; flush(): void }>());
  useEffect(
    () => () => {
      // Flush pending draft saves on unmount so nothing typed is lost.
      timers.current.forEach(({ timer, flush }) => {
        clearTimeout(timer);
        flush();
      });
      timers.current.clear();
    },
    [],
  );
  return {
    query,
    state: query.data,
    entry: (agentId: string) => query.data?.sessions[agentId],
    /** Debounced draft persistence (keyed per session). */
    saveDraft(taskId: string, agentId: string, text: string, immediate = false) {
      const pending = timers.current.get(agentId);
      if (pending) clearTimeout(pending.timer);
      const flush = () => {
        timers.current.delete(agentId);
        void save({ taskId, agentId, text }).catch(() => undefined);
      };
      if (immediate) return flush();
      timers.current.set(agentId, { timer: setTimeout(flush, 500), flush });
    },
    async queue(taskId: string, agentId: string, text: string, images: OutgoingImage[] = []) {
      const temp: ComposerEntry["queue"][number] = {
        id: `pending-${Date.now()}`,
        text,
        at: new Date().toISOString(),
        ...(images.length ? { images: images.map((image, i) => ({ file: `pending-${i}.png`, mimeType: image.mimeType })) } : {}),
      };
      // Until the daemon answers, no poll may land: one already in flight is cancelled (its result predates this
      // message and would wipe it from view), and polling pauses.
      unconfirmed++;
      try {
        await client.cancelQueries({ queryKey: key });
        patch((s) => ({
          ...s,
          sessions: {
            ...s.sessions,
            [agentId]: {
              ...(s.sessions[agentId] ?? { taskId, draft: "", draftAt: null, lastError: null }),
              queue: [...(s.sessions[agentId]?.queue || []), temp],
            },
          },
        }));
        const item = await push({ taskId, agentId, text, ...(images.length ? { images } : {}) });
        // The confirmed message takes the temporary one's place and its row key, so the row is not rebuilt.
        rowKeys.set(item.id, temp.id);
        patch((s) => {
          const e = s.sessions[agentId];
          return e ? { ...s, sessions: { ...s.sessions, [agentId]: { ...e, queue: e.queue.map((m) => (m.id === temp.id ? item : m)) } } } : s;
        });
        return item;
      } finally {
        unconfirmed--;
        refresh();
      }
    },
    async remove(agentId: string, id: string) {
      patch((s) => {
        const e = s.sessions[agentId];
        return e ? { ...s, sessions: { ...s.sessions, [agentId]: { ...e, queue: e.queue.filter((m) => m.id !== id) } } } : s;
      });
      try {
        await unqueue({ agentId, id });
      } finally {
        refresh();
      }
    },
    async sendNow(taskId: string, agentId: string, id: string) {
      try {
        await sendNow({ taskId, agentId, id });
      } finally {
        refresh();
      }
    },
  };
}
