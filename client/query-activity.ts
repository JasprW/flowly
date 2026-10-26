import { createContext } from "react";

/** Only retained board card outputs consume this; visible detail queries are independent. */
export const BoardOutputActive = createContext(true);

export function boardIsActive(compact: boolean, taskId: string, page: string | null, formOpen: boolean) {
  return !compact || (!taskId && !page && !formOpen);
}

/** The open card polls its own detail in every layout: the board root reads only the overview (LOADING-R2-SPEC §2A). */
export function drawerNeedsBoard(active: boolean, selected: string) {
  return active && !selected;
}
