import { msg } from "../shared/i18n";
import type { Link, Task } from "../shared/model";
import { isResolved, linkFor, samePair, type LinkView, type Relation } from "../shared/links";

/** Drawer groups, in order (CARD-LINKS-SPEC §5.2). "Was waiting on" holds resolved blockers. */
export type Group = "waiting" | "blocks" | "follow_up_of" | "follow_up" | "related" | "waited";
export const groups: { id: Group; title: string }[] = [
  { id: "waiting", title: msg("Waiting on") },
  { id: "blocks", title: msg("Blocks") },
  { id: "follow_up_of", title: msg("Follow-up of") },
  { id: "follow_up", title: msg("Follow-ups") },
  { id: "related", title: msg("Related") },
  { id: "waited", title: msg("Was waiting on") },
];

export const groupOf = (view: Pick<LinkView<Pick<Task, "status" | "archivedAt">>, "relation" | "other">): Group =>
  view.relation === "blocked_by" ? (isResolved(view.other) ? "waited" : "waiting") : view.relation;

/**
 * Cards `task` can be linked to (CARD-LINKS-SPEC §5.4): same project, live,
 * not itself, title containing `query`. `linked` marks cards the server would
 * refuse as already linked for `relation`.
 */
export function linkCandidates<T extends Pick<Task, "id" | "projectId" | "title" | "archivedAt">>(tasks: readonly T[], links: readonly Link[], task: Task, relation: Relation, query: string) {
  const needle = query.trim().toLowerCase();
  return tasks
    .filter((t) => t.projectId === task.projectId && t.id !== task.id && !t.archivedAt)
    .filter((t) => !needle || t.title.toLowerCase().includes(needle))
    .map((t) => {
      // Mirrors the server (CARD-LINKS-SPEC §2.3): Related needs no link at all between the
      // cards; Blocks / Follow-up need none of the same kind, in either direction.
      const kind = linkFor(relation, task.id, t.id).kind;
      const linked = links.some((l) => samePair(l, task.id, t.id) && (kind === "related" || l.kind === kind));
      return { task: t, linked };
    });
}
