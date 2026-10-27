import { afterEach, expect, test } from "vitest";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listDirectories } from "./directories";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});

test("a missing or non-folder path is a plain answer, not a system error", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "flowly-dirs-")));
  roots.push(root);
  await writeFile(join(root, "file.txt"), "x");
  for (const path of [join(root, "gone"), join(root, "file.txt"), join(root, "file.txt", "below")]) {
    const error = await listDirectories(path, null).catch((e: unknown) => e);
    expect((error as Error).message).toBe("Expected an existing directory.");
    expect((error as NodeJS.ErrnoException).code).toBeUndefined();
  }
  expect((await listDirectories(root, null)).path).toBe(root);
});
