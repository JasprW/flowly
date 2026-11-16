import { createContext } from "react";

/** Only retained board card outputs consume this; visible detail queries are independent. */
export const BoardOutputActive = createContext(true);

export function boardIsActive(compact: boolean, taskId: string, page: string | null, formOpen: boolean) {
  return !compact || (!taskId && !page && !formOpen);
}

/**
 * The open card's detail poll (NATIVE-OVERVIEW-SPEC §5), in every layout and also while a session preview
 * covers the card: the preview's turn state and Next moves come from the card's events. Closed: no poll.
 */
export function drawerDetailPoll(active: boolean, pushLive = false): number | undefined {
  return active && !pushLive ? 3000 : undefined;
}

/** True while "the board changed" pushes arrive (PASEO-0.16-SPEC §3.5): the board's etag reads stop polling. */
export const BoardPushLive = createContext(false);
