import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { ToolSecrets } from "./tool-context";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "flowly-ctx-"));
  dirs.push(dir);
  const secrets = new ToolSecrets(dir);
  await secrets.initialize();
  const a = { agentId: "a-live", taskId: "live", workspaceId: "w1" };
  const b = { agentId: "b-live", taskId: "live", workspaceId: "w1" };
  const c = { agentId: "c-gone", taskId: "gone", workspaceId: "w2" };
  for (const identity of [a, b, c]) await secrets.writeContext(identity);
  return { dir, secrets, a, b, c };
}
const ids = (list: { agentId: string }[]) => list.map((s) => s.agentId).sort();

test("managedSessions leaves out bindings of cards that no longer exist", async () => {
  const x = await setup();
  expect(ids(await x.secrets.managedSessions())).toEqual(["a-live", "b-live", "c-gone"]);
  expect(ids(await x.secrets.managedSessions(new Set(["live"])))).toEqual(["a-live", "b-live"]);
});

test("pruneContexts deletes only deleted cards' bindings and keeps live sessions working", async () => {
  const x = await setup();
  expect(await x.secrets.pruneContexts(new Set(["live"]))).toBe(1);
  expect((await readdir(join(x.dir, "sessions"))).sort()).toEqual(["a-live.json", "b-live.json"]);
  expect(await x.secrets.managedIdentity("c-gone")).toBeNull();
  // A live session keeps its binding and its credential, and can still be rewritten.
  expect(await x.secrets.managedIdentity("a-live")).toEqual(x.a);
  await expect(x.secrets.writeContext(x.a, "mcp")).resolves.toContain("a-live.json");
  expect(await x.secrets.pruneContexts(new Set(["live"]))).toBe(0);
});

test("pruneContexts preserves unreadable files", async () => {
  const x = await setup();
  await writeFile(join(x.dir, "sessions", "broken.json"), "{not json");
  await x.secrets.pruneContexts(new Set(["live"]));
  expect(await readdir(join(x.dir, "sessions"))).toContain("broken.json");
});
