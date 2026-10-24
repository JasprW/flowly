import { createContext } from "react";

/** Only retained board card outputs consume this; visible detail queries are independent. */
export const BoardOutputActive = createContext(true);

export function boardIsActive(compact: boolean, taskId: string, page: string | null, formOpen: boolean) {
  return !compact || (!taskId && !page && !formOpen);
}

/** Wide roots already poll. A compact detail replaces its paused root. */
export function drawerNeedsBoard(compact: boolean, active: boolean, selected: string) {
  return compact && active && !selected;
}
