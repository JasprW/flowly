import { afterEach, expect, test } from "vitest";
import type { PaseoApi } from "@getpaseo/client";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_TITLE, BackgroundWorkspaces, type Revival } from "./background-workspace";
import type { Project } from "../shared/model";
import { resetBackgroundAgents } from "./background-agent";

const roots: string[] = [];
afterEach(async () => {
  resetBackgroundAgents(null);
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

/** A host with background agents (PASEO-0.16-SPEC §3.1): a hidden workspace, kept open and reused. */
async function hiddenSetup(listed: (id: string) => object | null = () => ({})) {
  const dir = await mkdtemp(join(tmpdir(), "flowly-bg-"));
  roots.push(dir);
  const log: string[] = [];
  let made = 0;
  const paseo = {
    workspaces: {
      create: async (o: { title: string; background?: boolean; source: { path: string } }) => {
        made++;
        log.push(`create ${o.title} background=${o.background} ${o.source.path}`);
        return { id: `hidden-${made}` };
      },
      archive: async (id: string) => void log.push(`archive ${id}`),
      ref: (id: string) => ({ refresh: async () => (log.push(`refresh ${id}`), listed(id)) }),
    },
  } as unknown as PaseoApi;
  const revive = async (id: string) => (log.push(`revive ${id}`), "live" as const);
  resetBackgroundAgents(true);
  return { dir, log, paseo, bg: new BackgroundWorkspaces(dir, revive) };
}

test("with background agents the project's workspace is a background one, never archived or restored, and reused", async () => {
  const x = await hiddenSetup();
  await x.bg.use(project, x.paseo, async (id) => void x.log.push(`run ${id}`));
  await x.bg.use(project, x.paseo, async (id) => void x.log.push(`run ${id}`));
  expect(x.log).toEqual([`create ${BACKGROUND_TITLE} background=true /repo`, "run hidden-1", "refresh hidden-1", "run hidden-1"]);
  expect(JSON.parse(await readFile(join(x.dir, "background-workspaces.json"), "utf8"))).toEqual({ version: 1, projects: {}, hidden: { p: "hidden-1" } });
});

test("a stored background workspace Paseo no longer lists is replaced; the old visible one is left alone", async () => {
  const x = await hiddenSetup((id) => (id === "stale" ? null : {}));
  await writeFile(join(x.dir, "background-workspaces.json"), JSON.stringify({ version: 1, projects: { p: "old-visible" }, hidden: { p: "stale" } }));
  await x.bg.use(project, x.paseo, async (id) => void x.log.push(`run ${id}`));
  expect(x.log).toEqual(["refresh stale", `create ${BACKGROUND_TITLE} background=true /repo`, "run hidden-1"]);
  expect(JSON.parse(await readFile(join(x.dir, "background-workspaces.json"), "utf8"))).toEqual({ version: 1, projects: { p: "old-visible" }, hidden: { p: "hidden-1" } });
});

test("after a plugin start, before support is known, a project's stored background workspace is used, not a visible one", async () => {
  const x = await hiddenSetup();
  resetBackgroundAgents(null);
  await writeFile(join(x.dir, "background-workspaces.json"), JSON.stringify({ version: 1, projects: { p: "old-visible" }, hidden: { p: "hidden-0" } }));
  await x.bg.use(project, x.paseo, async (id) => void x.log.push(`run ${id}`));
  expect(x.log).toEqual(["refresh hidden-0", "run hidden-0"]);
  // Support belongs to the host: another project's first run is hidden too.
  await x.bg.use({ ...project, id: "q" }, x.paseo, async (id) => void x.log.push(`run ${id}`));
  expect(x.log.slice(2)).toEqual([`create ${BACKGROUND_TITLE} background=true /repo`, "run hidden-1"]);
});

test("before support is known, a host that refuses a background workspace gets the visible one", async () => {
  const x = await hiddenSetup(() => null);
  resetBackgroundAgents(null);
  (x.paseo.workspaces as { create: unknown }).create = async (o: { background?: boolean }) => {
    if (o.background) throw new Error("Update the host to use background workspaces.");
    x.log.push("create visible");
    return { id: "visible-1" };
  };
  await writeFile(join(x.dir, "background-workspaces.json"), JSON.stringify({ version: 1, projects: {}, hidden: { p: "hidden-0" } }));
  await x.bg.use(project, x.paseo, async (id) => void x.log.push(`run ${id}`));
  expect(x.log).toEqual(["refresh hidden-0", "create visible", "run visible-1", "archive visible-1"]);
});
