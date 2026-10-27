import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { PaseoApi } from "@getpaseo/client";
import { lstat, mkdir, mkdtemp, readdir, readlink, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BoardStore } from "./store";
import { BoardService, folderName } from "./service";
import { listDirectories, NativeDirectoryPicker } from "./directories";
import { linkedProjectInput } from "../shared/model";

let root = "";
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "ultra-linked-")));
  process.env.ULTRA_KANBAN_LINKED_DIR = join(root, "linked");
});
afterEach(async () => {
  delete process.env.ULTRA_KANBAN_LINKED_DIR;
  await rm(root, { recursive: true, force: true });
});

/** Fake native registry: a created project appears in projects.list with the given root. */
function fakePaseo() {
  const projects: { projectId: string; projectRootPath: string; projectDisplayName: string }[] = [];
  return {
    projects,
    paseo: { projects: { list: async () => ({ projects }) } } as unknown as PaseoApi,
  };
}

async function setup() {
  const repoA = join(root, "work", "api"),
    repoB = join(root, "other", "api"),
    web = join(root, "web");
  for (const d of [repoA, repoB, web]) await mkdir(d, { recursive: true });
  const service = new BoardService(new BoardStore(join(root, "data")));
  return { repoA, repoB, web, service };
}

// The service shells out to `paseo project create`; register the fixture instead.
vi.mock("node:child_process", async (original) => {
  const actual = await original<typeof import("node:child_process")>();
  return {
    ...actual,
    execFile: (file: string, args: string[], options: unknown, callback: (e: unknown, r?: unknown) => void) => {
      const cb = typeof options === "function" ? (options as typeof callback) : callback;
      // The resolved CLI: bare `paseo` or the installed app's.
      if (/(^|\/)paseo$/.test(file) && args[0] === "project" && args[1] === "create") {
        registry.projects.push({ projectId: `native-${registry.projects.length}`, projectRootPath: args[2], projectDisplayName: args[2] });
        cb(null, { stdout: "{}", stderr: "" });
        return;
      }
      return (actual.execFile as Function)(file, args, options, callback);
    },
  };
});
let registry = fakePaseo();
beforeEach(() => {
  registry = fakePaseo();
});

test("linked project creates a new root with one symlink per directory and registers it", async () => {
  const x = await setup();
  const project = await x.service.createLinked(
    linkedProjectInput.parse({ title: "Shop Stack", links: [x.repoA, x.repoB, x.web] }),
    registry.paseo,
  );
  expect(project.primaryPath).toBe(join(root, "linked", "Shop-Stack"));
  expect(project.repos).toEqual([project.primaryPath]);
  expect(project.links).toEqual([
    { name: "api", target: x.repoA },
    { name: "api-2", target: x.repoB },
    { name: "web", target: x.web },
  ]);
  expect(registry.projects[0].projectRootPath).toBe(project.primaryPath);
  for (const l of project.links!) expect(await readlink(join(project.primaryPath, l.name))).toBe(l.target);
  // Same title again: a fresh directory, never the existing one.
  const again = await x.service.createLinked(
    linkedProjectInput.parse({ title: "Shop Stack", links: [x.web] }),
    registry.paseo,
  );
  expect(again.primaryPath).toBe(join(root, "linked", "Shop-Stack-2"));
});

test("invalid or duplicate targets create nothing", async () => {
  const x = await setup();
  await expect(
    x.service.createLinked(linkedProjectInput.parse({ title: "Bad", links: [x.web, join(root, "missing")] }), registry.paseo),
  ).rejects.toThrow("Not an existing directory");
  await expect(
    x.service.createLinked(linkedProjectInput.parse({ title: "Dup", links: [x.web, `${x.web}/`] }), registry.paseo),
  ).rejects.toThrow("added twice");
  await expect(readdir(join(root, "linked")).catch(() => [])).resolves.toEqual([]);
  expect(registry.projects).toEqual([]);
});

test("a failure before native registration removes only what the call created", async () => {
  const x = await setup();
  const broken = { projects: { list: async () => { throw new Error("daemon down"); } } } as unknown as PaseoApi;
  await expect(
    x.service.createLinked(linkedProjectInput.parse({ title: "Down", links: [x.web] }), broken),
  ).rejects.toThrow("daemon down");
  expect(await readdir(join(root, "linked"))).toEqual([]);
  expect((await lstat(x.web)).isDirectory()).toBe(true);
});

test("setLinks adds and removes only Kanban-created links, with CAS", async () => {
  const x = await setup();
  const project = await x.service.createLinked(
    linkedProjectInput.parse({ title: "Edit", links: [x.repoA, x.web] }),
    registry.paseo,
  );
  await expect(x.service.setLinks({ id: project.id, revision: project.revision + 1, links: [x.web] })).rejects.toThrow(
    "Revision conflict",
  );
  // A user-made entry with the name the new link would take is skipped, not overwritten.
  await writeFile(join(project.primaryPath, "api-2"), "mine");
  const added = await x.service.setLinks({ id: project.id, revision: project.revision, links: [x.repoA, x.web, x.repoB] });
  expect(added.links?.map((l) => l.name)).toEqual(["api", "web", "api-3"]);
  const edited = await x.service.setLinks({ id: project.id, revision: added.revision, links: [x.web, x.repoB] });
  expect(edited.links).toEqual([
    { name: "web", target: x.web },
    { name: "api-3", target: x.repoB },
  ]);
  expect(edited.revision).toBe(project.revision + 2);
  expect((await readdir(project.primaryPath)).sort()).toEqual(["api-2", "api-3", "web"]);
  expect((await lstat(x.repoA)).isDirectory()).toBe(true);
  // A recorded link replaced by something else is not deleted.
  await rm(join(project.primaryPath, "web"));
  await symlink(x.repoA, join(project.primaryPath, "web"));
  await expect(x.service.setLinks({ id: project.id, revision: edited.revision, links: [x.repoB] })).rejects.toThrow(
    "no longer the link",
  );
});

test("folder names keep letters and digits and are never empty or hidden", () => {
  expect(folderName("优化 project 系统")).toBe("优化-project-系统");
  expect(folderName("../..")).toBe("project");
  expect(folderName(".hidden")).toBe("hidden");
});

test("listDirectories lists visible child directories, marks Git repos and follows symlinks", async () => {
  await mkdir(join(root, "b", ".git"), { recursive: true });
  await mkdir(join(root, "a"));
  await mkdir(join(root, ".secret"));
  await writeFile(join(root, "file.txt"), "");
  await symlink(join(root, "a"), join(root, "link-a"));
  await symlink(join(root, "missing"), join(root, "dangling"));
  const page = await listDirectories(root, null);
  expect(page.path).toBe(root);
  expect(page.parent).toBe(join(root, ".."));
  expect(page.entries).toEqual([
    { name: "a", path: join(root, "a"), git: false },
    { name: "b", path: join(root, "b"), git: true },
    { name: "link-a", path: join(root, "link-a"), git: false },
  ]);
  await expect(listDirectories(join(root, "file.txt"), null)).rejects.toThrow("existing directory");
});

test("native picker reports unavailability instead of hanging", async () => {
  await expect(new NativeDirectoryPicker(Promise.resolve(null)).pick(false)).rejects.toThrow("No system folder dialog");
});
