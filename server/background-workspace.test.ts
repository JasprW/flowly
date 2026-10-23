import { afterEach, expect, test } from "vitest";
import type { PaseoApi } from "@getpaseo/client";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_TITLE, BackgroundWorkspaces, type Revival } from "./background-workspace";
import type { Project } from "../shared/model";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});

const project = { id: "p", paseoProjectId: "native", primaryPath: "/repo" } as Project;

async function setup(revival: Revival | Error = "live") {
  const dir = await mkdtemp(join(tmpdir(), "flowly-bg-"));
  roots.push(dir);
  const log: string[] = [];
  let made = 0;
  const paseo = {
    workspaces: {
      create: async (o: { title: string; source: { kind: string; path: string; projectId: string } }) => {
        made++;
        log.push(`create ${o.title} ${o.source.kind} ${o.source.path} ${o.source.projectId}`);
        return { id: `bg-${made}` };
      },
      archive: async (id: string) => {
        log.push(`archive ${id}`);
        return {};
      },
    },
  } as unknown as PaseoApi;
  const revive = async (id: string) => {
    log.push(`revive ${id}`);
    if (revival instanceof Error) throw revival;
    return revival;
  };
  return { dir, log, paseo, bg: new BackgroundWorkspaces(dir, revive) };
}

test("the first run makes the project's background workspace at its root and archives it afterwards", async () => {
  const x = await setup();
  const seen = await x.bg.use(project, x.paseo, async (id) => {
    x.log.push(`run ${id}`);
    return id;
  });
  expect(seen).toBe("bg-1");
  expect(x.log).toEqual([`create ${BACKGROUND_TITLE} directory /repo native`, "run bg-1", "archive bg-1"]);
  expect(JSON.parse(await readFile(join(x.dir, "background-workspaces.json"), "utf8"))).toEqual({ version: 1, projects: { p: "bg-1" } });
});

test("the next run restores the archived workspace and reuses it", async () => {
  const x = await setup("restored");
  await x.bg.use(project, x.paseo, async () => undefined);
  x.log.length = 0;
  await x.bg.use(project, x.paseo, async (id) => void x.log.push(`run ${id}`));
  expect(x.log).toEqual(["revive bg-1", "run bg-1", "archive bg-1"]);
});

test("a workspace Paseo cannot bring back is replaced by a new one", async () => {
  for (const outcome of ["gone", new Error("daemon unreachable")] as const) {
    const x = await setup(outcome);
    await writeFile(join(x.dir, "background-workspaces.json"), JSON.stringify({ version: 1, projects: { p: "old" } }));
    await x.bg.use(project, x.paseo, async (id) => void x.log.push(`run ${id}`));
    expect(x.log).toEqual(["revive old", `create ${BACKGROUND_TITLE} directory /repo native`, "run bg-1", "archive bg-1"]);
    expect(JSON.parse(await readFile(join(x.dir, "background-workspaces.json"), "utf8")).projects.p).toBe("bg-1");
  }
});

test("overlapping runs share one workspace; it is archived only after the last one ends", async () => {
  const x = await setup();
  let releaseFirst!: () => void;
  const first = x.bg.use(project, x.paseo, (id) => new Promise<void>((r) => {
    x.log.push(`start A ${id}`);
    releaseFirst = r;
  }));
  await new Promise((r) => setTimeout(r, 10));
  await x.bg.use(project, x.paseo, async (id) => void x.log.push(`run B ${id}`));
  expect(x.log).not.toContain("archive bg-1");
  releaseFirst();
  await first;
  expect(x.log.filter((l) => l.startsWith("create"))).toHaveLength(1);
  expect(x.log.slice(1)).toEqual(["start A bg-1", "run B bg-1", "archive bg-1"]);
});

test("a failed run still archives the workspace, and an archive failure does not fail the run", async () => {
  const x = await setup();
  await expect(x.bg.use(project, x.paseo, async () => Promise.reject(new Error("model failed")))).rejects.toThrow("model failed");
  expect(x.log.at(-1)).toBe("archive bg-1");
  (x.paseo.workspaces as unknown as { archive: () => Promise<never> }).archive = async () => Promise.reject(new Error("offline"));
  await expect(x.bg.use(project, x.paseo, async () => "ok")).resolves.toBe("ok");
});

test("invalid stored data is preserved and the run refuses rather than replacing it", async () => {
  const x = await setup();
  await writeFile(join(x.dir, "background-workspaces.json"), "{oops");
  await expect(x.bg.use(project, x.paseo, async () => "never")).rejects.toThrow("Background workspace data is invalid");
  expect(await readFile(join(x.dir, "background-workspaces.json"), "utf8")).toBe("{oops");
  expect(x.log).toEqual([]);
});
