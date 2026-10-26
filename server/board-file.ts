import { constants } from "node:fs";
import { copyFile, mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { upgradeBoard } from "./migrate";
import { emptyBoard, type Board } from "../shared/model";

/** The board cannot be read or written; `code` is the tool error code (SQLITE-STORAGE-SPEC §10). */
export class StoreInvalidError extends Error {
  constructor(
    message: string,
    readonly code = "STORE_INVALID",
    readonly retryable = false,
  ) {
    super(message);
  }
}

/** Where the board lives: `board.json` or `flowly.sqlite` (SQLITE-STORAGE-SPEC §5). */
export interface BoardPersistence {
  /** A board the caller may change; already checked by {@link assertBoardInvariants}. */
  load(): Promise<Board>;
  /** Stores a board that already passed `storageSchema.parse`. Fails without a partial write. */
  save(board: Board): Promise<void>;
}

export function assertBoardInvariants(board: Board) {
  if (new Set(board.agentReceipts.map((r) => r.key)).size !== board.agentReceipts.length) throw new Error("Duplicate agent receipt.");
  const nativeIds = new Set<string>(),
    workspaces = new Set<string>(),
    operations = new Set<string>();
  for (const p of board.projects) {
    if (nativeIds.has(p.paseoProjectId)) throw new Error("Paseo project is already linked to a board project.");
    if (!p.repos.includes(p.primaryPath)) throw new Error("The primary directory must remain in the project.");
    nativeIds.add(p.paseoProjectId);
  }
  for (const t of board.tasks) {
    const project = board.projects.find((p) => p.id === t.projectId);
    if (!project || !project.repos.includes(t.sourcePath) || t.repoPaths.some((p) => !project.repos.includes(p)) || new Set(t.repoPaths).size !== t.repoPaths.length)
      throw new Error("Task source directory must belong to its project.");
    if (workspaces.has(t.workspaceId)) throw new Error("Workspace is already bound to another card.");
    if (operations.has(t.operationId)) throw new Error("Duplicate task operation.");
    workspaces.add(t.workspaceId);
    operations.add(t.operationId);
    if (t.tags && new Set(t.tags.map((x) => x.tag)).size !== t.tags.length) throw new Error("Duplicate tag on a card.");
  }
}

/** What `board.json` holds once the board moved to SQLite: older versions refuse it instead of starting empty. */
export const retiredMarker = (at: string) => ({
  version: 0,
  storage: "sqlite",
  database: "flowly.sqlite",
  movedAt: at,
  note: "Flowly keeps this board in flowly.sqlite. The original board.json is in migrations/. To go back to an older Flowly version, use Settings > Storage > Export to JSON first.",
});
export const isRetiredMarker = (raw: unknown) => typeof raw === "object" && raw !== null && (raw as { storage?: unknown }).storage === "sqlite" && (raw as { version?: unknown }).version === 0;

/** Writes through a temporary file and renames it into place, flushed to disk. */
export async function writeFileAtomic(path: string, data: string) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFileDurable(temporary, data, "w");
  await rename(temporary, path);
  await syncDirectory(dirname(path));
}
/** Writes and flushes a file; `wx` refuses to overwrite one that exists. */
export async function writeFileDurable(path: string, data: string, flag: "w" | "wx") {
  const handle = await open(path, flag, 0o600);
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
}
export async function syncFile(path: string) {
  const handle = await open(path, "r+");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
/** Makes a rename in `directory` durable; Windows cannot open directories, where the rename itself is the best available. */
export async function syncDirectory(directory: string) {
  if (process.platform === "win32") return;
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** The board in `board.json`, read and written whole (the storage before SQLite, and its fallback). */
export class JsonBoardFile implements BoardPersistence {
  constructor(readonly directory: string) {}
  get path() {
    return join(this.directory, "board.json");
  }
  async load(): Promise<Board> {
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(this.path, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyBoard();
      throw this.invalid(error);
    }
    if (isRetiredMarker(raw))
      throw new StoreInvalidError(
        `Flowly's board is stored in ${join(this.directory, "flowly.sqlite")}, which this Paseo cannot open. Update Paseo, or restore board.json from ${join(this.directory, "migrations")}.`,
        "STORAGE_UNSUPPORTED",
      );
    try {
      if ((raw as { version?: unknown } | null)?.version !== 5) await this.keepPreUpgradeCopy((raw as { version?: unknown } | null)?.version);
      const board = upgradeBoard(raw);
      assertBoardInvariants(board);
      return board;
    } catch (error) {
      throw this.invalid(error);
    }
  }
  async save(board: Board) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(board, null, 2), { mode: 0o600 });
    try {
      await copyFile(this.path, `${this.path}.bak`);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    await rename(temporary, this.path);
  }
  private invalid(error: unknown) {
    return new StoreInvalidError(
      `Board data is invalid; preserved at ${this.path}. Restore a valid backup before continuing. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  /**
   * One-time copy of older data before an upgrade is first persisted: pre-v4 before the
   * status split (WORKFLOW-STAGES-SPEC), v4 before the `external` rename (CONNECTORS-SPEC §3.1).
   */
  private async keepPreUpgradeCopy(version: unknown) {
    try {
      await copyFile(this.path, join(this.directory, version === 4 ? "board.pre-v5.json" : "board.pre-v4.json"), constants.COPYFILE_EXCL);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
}
