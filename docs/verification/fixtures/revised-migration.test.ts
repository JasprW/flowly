import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BoardStore } from "../../../server/store";

const disposableDirectories: string[] = [];
afterEach(() => {
  for (const directory of disposableDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("Phase 2 v3 board migration evidence", () => {
  it("reads v1 cards as unrestricted without rewriting, then persists v3 and backs up v1", async () => {
    // Each run gets a fresh disposable store so repeated full-suite runs do not
    // overwrite prior fixture evidence or fail because a backup already exists.
    const evidenceDir = mkdtempSync(join(tmpdir(), "ultra-kanban-migration-v1-"));
    disposableDirectories.push(evidenceDir);
    const evidenceFile = join(evidenceDir, "board.json");
    const backupFile = `${evidenceFile}.bak`;
    const v1 = {
      version: 1,
      revision: 7,
      projects: [
        {
          id: "phase1-migration-project-id",
          title: "Ultra Kanban Acceptance Migration Fixture",
          description: "Disposable v1 to v3 migration fixture.",
          paseoProjectId: "phase1-migration-native-project-id",
          primaryPath: "/tmp/ultra-kanban-acceptance-20261013/repo-one",
          repos: [
            "/tmp/ultra-kanban-acceptance-20261013/repo-one",
            "/tmp/ultra-kanban-acceptance-20261013/repo-two",
          ],
          revision: 3,
          createdAt: "2026-10-13T00:00:00.000Z",
          updatedAt: "2026-10-13T00:00:00.000Z",
          archivedAt: null,
        },
      ],
      tasks: [
        {
          id: "phase1-migration-card-id",
          projectId: "phase1-migration-project-id",
          workspaceId: "phase1-migration-workspace-id",
          sourcePath: "/tmp/ultra-kanban-acceptance-20261013/repo-one",
          title: "Legacy v1 fixture card",
          description: "Legacy card with no repoPaths property.",
          status: "todo",
          priority: "normal",
          position: 0,
          revision: 5,
          operationId: "phase1-migration-operation-id",
          createdAt: "2026-10-13T00:00:00.000Z",
          updatedAt: "2026-10-13T00:00:00.000Z",
          archivedAt: null,
        },
      ],
      events: [
        {
          id: "phase1-migration-event-id",
          taskId: "phase1-migration-card-id",
          actor: "human",
          action: "created",
          at: "2026-10-13T00:00:00.000Z",
        },
      ],
    };
    const originalBytes = `${JSON.stringify(v1, null, 2)}\n`;
    writeFileSync(evidenceFile, originalBytes, { flag: "wx", mode: 0o600 });

    const store = new BoardStore(evidenceDir);
    const loaded = await store.read();
    expect(loaded.version).toBe(5);
    expect(loaded.projects[0].id).toBe("phase1-migration-project-id");
    expect(loaded.tasks[0]).toMatchObject({
      id: "phase1-migration-card-id",
      workspaceId: "phase1-migration-workspace-id",
      sourcePath: "/tmp/ultra-kanban-acceptance-20261013/repo-one",
      repoPaths: [],
    });
    expect(loaded.events.map((event) => event.id)).toEqual(["phase1-migration-event-id"]);
    expect(readFileSync(evidenceFile, "utf8")).toBe(originalBytes);

    await store.mutate(() => "first-v3-write");
    const persisted = JSON.parse(readFileSync(evidenceFile, "utf8"));
    const backupBytes = readFileSync(backupFile, "utf8");
    expect(persisted.version).toBe(5);
    expect(persisted.tasks[0]).toMatchObject({
      id: "phase1-migration-card-id",
      workspaceId: "phase1-migration-workspace-id",
      repoPaths: [],
    });
    expect(persisted.events.map((event: { id: string }) => event.id)).toEqual([
      "phase1-migration-event-id",
    ]);
    expect(backupBytes).toBe(originalBytes);
  });
});
