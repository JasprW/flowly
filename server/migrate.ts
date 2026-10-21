import {
  legacyBoardSchema,
  legacyStatus,
  previousBoardSchema,
  storageSchema,
  v3BoardSchema,
  v4BoardSchema,
  type Board,
} from "../shared/model";
import { originLinks } from "../shared/links";

type Loose = Record<string, unknown>;
const isObject = (v: unknown): v is Loose => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Board v4 replaced In progress with Design/Development/Test (WORKFLOW-STAGES-SPEC):
 * cards in progress become Development, and a configured In progress lane expands
 * in place into the three stages (on/off kept, a custom name moves to Development).
 * History (events, receipts) keeps the retired status as written.
 */
export function splitInProgress(raw: Loose): Loose {
  const tasks = Array.isArray(raw.tasks)
    ? raw.tasks.map((t) => (isObject(t) && t.status === legacyStatus ? { ...t, status: "development" } : t))
    : raw.tasks;
  const projects = Array.isArray(raw.projects)
    ? raw.projects.map((p) => {
        if (!isObject(p) || !Array.isArray(p.lanes)) return p;
        const lanes = p.lanes.flatMap((lane) => {
          if (!isObject(lane) || lane.status !== legacyStatus) return [lane];
          const { name, ...rest } = lane;
          return [
            { ...rest, status: "design" },
            { ...rest, status: "development", ...(typeof name === "string" && name.trim() ? { name } : {}) },
            { ...rest, status: "test" },
          ];
        });
        return { ...p, lanes };
      })
    : raw.projects;
  return { ...raw, tasks, projects };
}

/**
 * Board v5 renamed the artifact field `ticket` to `external` (CONNECTORS-SPEC §3.1):
 * the value moves unchanged; an artifact that somehow has both keeps `external`.
 */
export function renameTicketField(raw: Loose): Loose {
  if (!Array.isArray(raw.artifacts)) return raw;
  const artifacts = raw.artifacts.map((a) => {
    if (!isObject(a) || !("ticket" in a)) return a;
    const { ticket, ...rest } = a;
    return "external" in rest ? rest : { ...rest, external: ticket };
  });
  return { ...raw, artifacts };
}

/** Parses stored board data of any known version into the current (v5) shape. */
export function upgradeBoard(raw: unknown): Board {
  const board = parseBoard(raw);
  // Files written before card links: the idea origins become derived links, once (CARD-LINKS-SPEC §2.2).
  if (!isObject(raw) || !Array.isArray(raw.links)) board.links = originLinks(board.tasks);
  return board;
}

function parseBoard(raw: unknown): Board {
  if (!isObject(raw) || raw.version === 5) return storageSchema.parse(raw);
  const renamed = renameTicketField(raw);
  if (raw.version === 4)
    return storageSchema.parse({ ...v4BoardSchema.extend({ agentReceipts: storageSchema.shape.agentReceipts }).parse(renamed), version: 5 });
  const split = splitInProgress(renamed);
  if (raw.version === 1) {
    const old = legacyBoardSchema.parse(split);
    return storageSchema.parse({ ...old, version: 5, agentReceipts: [], tasks: old.tasks.map((t) => ({ ...t, repoPaths: [] })) });
  }
  if (raw.version === 2)
    return storageSchema.parse({ ...previousBoardSchema.parse(split), version: 5, agentReceipts: [] });
  if (raw.version === 3)
    return storageSchema.parse({ ...v3BoardSchema.extend({ agentReceipts: storageSchema.shape.agentReceipts }).parse(split), version: 5 });
  return storageSchema.parse(raw);
}
