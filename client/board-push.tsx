import { useCallback, useEffect, useRef, useState } from "react";
import { useSubscription } from "@getpaseo/plugin/client";
import { boardChanges } from "../shared/rpc";
import { pushRetryDelay } from "./push-retry";

/*
 * "The board changed" pushes on Paseo 0.16 (PASEO-0.16-SPEC §3.5). While the subscription is live, the board's
 * etag reads (overview, card detail, project ideas) stop polling and run once per pushed change instead; the event
 * itself carries no data. On a host without subscriptions (method A: the hook is missing on 0.15), when the
 * subscription fails or closes, and until its first event arrives (connecting), the polls run as before. A failed
 * subscription is tried again with a growing wait; Paseo itself re-subscribes after a reconnect, and the daemon's first event of
 * every subscription makes the board read once, which also brings what changed meanwhile.
 */

/** Whether this host's client can subscribe (method A). Read at render, never called at module load. */
export function canSubscribe() {
  return typeof useSubscription === "function";
}

type Props = {
  /** A pushed change (or the first event of a subscription): re-read what is shown. */
  onChange: () => void;
  /** true while pushes are arriving, so the polls can stop; false to poll. */
  onLive: (live: boolean) => void;
};

/** Renders nothing; mount once under the board screen. */
export function BoardPush(props: Props) {
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  if (!canSubscribe()) return null;
  return <Subscription key={attempt} {...props} attempt={attempt} retry={retry} />;
}

function Subscription({ onChange, onLive, attempt, retry }: Props & { attempt: number; retry: () => void }) {
  const [heard, setHeard] = useState(false);
  const latest = useRef({ onChange, onLive });
  latest.current = { onChange, onLive };
  const state = useSubscription(boardChanges, {}, (event) => {
    setHeard(true);
    // Outside-session insights matter to the session chips only.
    if (event.scope !== "sessions") latest.current.onChange();
  });
  const failed = state.status === "error" || state.status === "closed";
  const live = !failed && heard;
  useEffect(() => {
    latest.current.onLive(live);
  }, [live]);
  useEffect(() => {
    if (!failed) return;
    const timer = setTimeout(retry, pushRetryDelay(attempt));
    return () => clearTimeout(timer);
  }, [failed, attempt, retry]);
  useEffect(() => () => latest.current.onLive(false), []);
  return null;
}
