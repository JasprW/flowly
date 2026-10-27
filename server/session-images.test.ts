import { afterEach, expect, test } from "vitest";
import type { PaseoApi } from "@getpaseo/client";
import { mkdtemp, realpath, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BoardStore } from "./store";
import { SessionImageService } from "./session-images";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});

async function setup(transcript: string, workspaceId = "w") {
  const root = await realpath(await mkdtemp(join(tmpdir(), "ultra-images-")));
  roots.push(root);
  const store = new BoardStore(join(root, "data"));
  const now = new Date().toISOString();
  await store.mutate((b) => {
    b.projects.push({ id: "p", paseoProjectId: "n", title: "P", description: "", primaryPath: root, repos: [root], revision: 1, createdAt: now, updatedAt: now, archivedAt: null });
    b.tasks.push({ id: "t", projectId: "p", workspaceId: "w", sourcePath: root, repoPaths: [root], title: "T", description: "", status: "todo", priority: "normal", position: 0, revision: 1, operationId: "o", createdAt: now, updatedAt: now, archivedAt: null });
  });
  const png = join(root, "shot.png");
  await writeFile(png, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  await writeFile(join(root, "secret.txt"), "nope");
  const paseo = {
    agents: {
      ref: () => ({
        refresh: async () => ({ agent: { id: "a", workspaceId } }),
        timeline: { refetch: async () => ({ entries: [{ item: { type: "user_message", text: transcript.replace("$PNG", png) } }] }) },
      }),
    },
  } as unknown as PaseoApi;
  return { service: new SessionImageService(store), paseo, png, root };
}

test("serves an image referenced by the session's transcript as a data URI", async () => {
  const x = await setup("see [Image: source: $PNG]");
  const { dataUri } = await x.service.read({ taskId: "t", agentId: "a", src: x.png }, x.paseo);
  expect(dataUri).toBe("data:image/png;base64,iVBORw==");
});

test("refuses images not in the transcript, other workspaces and non-images", async () => {
  const x = await setup("nothing here");
  await expect(x.service.read({ taskId: "t", agentId: "a", src: x.png }, x.paseo)).rejects.toThrow(/not part of this session/);
  const y = await setup("see $PNG", "other");
  await expect(y.service.read({ taskId: "t", agentId: "a", src: y.png }, y.paseo)).rejects.toThrow(/different workspace/);
  await expect(y.service.read({ taskId: "t", agentId: "a", src: join(y.root, "secret.txt") }, y.paseo)).rejects.toThrow(/Not a local image/);
  await expect(y.service.read({ taskId: "t", agentId: "a", src: "https://x/y.png" }, y.paseo)).rejects.toThrow(/Not a local image/);
});

test("an image file that is gone is a plain answer, not a system error", async () => {
  const x = await setup("see [Image: source: $PNG]");
  await unlink(x.png);
  const error = await x.service.read({ taskId: "t", agentId: "a", src: x.png }, x.paseo).catch((e: unknown) => e);
  expect((error as Error).message).toBe("The image file no longer exists.");
  expect((error as NodeJS.ErrnoException).code).toBeUndefined();
});
