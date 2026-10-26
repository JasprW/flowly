import { createContext } from "react";

/** Only retained board card outputs consume this; visible detail queries are independent. */
export const BoardOutputActive = createContext(true);

export function boardIsActive(compact: boolean, taskId: string, page: string | null, formOpen: boolean) {
  return !compact || (!taskId && !page && !formOpen);
}

/** The open card polls its own detail in every layout (LOADING-R2-SPEC §2A); a wide drawer stays visible beside a session preview. */
export function drawerNeedsBoard(compact: boolean, active: boolean, selected: string) {
  return active && (!compact || !selected);
}
