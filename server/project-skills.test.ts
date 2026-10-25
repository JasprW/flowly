import { afterEach, expect, test } from "vitest";
import { lstat, mkdir, mkdtemp, readFile, readlink, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanSkills, writeSkill } from "./project-skills";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
async function root() {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "flowly-skills-")));
  roots.push(dir);
  return dir;
}
const skill = { name: "flowly-ship", description: "Use when shipping.", body: "## Steps\n1. Push." };

test("writes the skill under .agents and links it for Claude Code", async () => {
  const dir = await root();
  const result = await writeSkill(dir, skill, "new");
  expect(result).toEqual({ path: ".agents/skills/flowly-ship/SKILL.md", linked: true });
  expect(await readFile(join(dir, ".agents/skills/flowly-ship/SKILL.md"), "utf8")).toBe('---\nname: flowly-ship\ndescription: "Use when shipping."\n---\n\n## Steps\n1. Push.\n');
  expect(await readlink(join(dir, ".claude/skills/flowly-ship"))).toBe("../../.agents/skills/flowly-ship");
  expect(await readFile(join(dir, ".claude/skills/flowly-ship/SKILL.md"), "utf8")).toContain("name: flowly-ship");
  // One copy: scanning both folders finds it once.
  expect((await scanSkills(dir)).map((s) => s.name)).toEqual(["flowly-ship"]);
});

test("a new skill refuses an existing folder and writes nothing", async () => {
  const dir = await root();
  await mkdir(join(dir, ".agents/skills/flowly-ship"), { recursive: true });
  await expect(writeSkill(dir, skill, "new")).rejects.toThrow("SKILL_EXISTS");
  await expect(lstat(join(dir, ".claude"))).rejects.toThrow();
});

test("an update needs the file and overwrites it; the link stays", async () => {
  const dir = await root();
  await expect(writeSkill(dir, skill, "update")).rejects.toThrow("SKILL_MISSING");
  await writeSkill(dir, skill, "new");
  const result = await writeSkill(dir, { ...skill, body: "New body" }, "update");
  expect(result.linked).toBe(true);
  expect(await readFile(join(dir, ".agents/skills/flowly-ship/SKILL.md"), "utf8")).toContain("New body");
});

test("leaves a foreign .claude entry alone and reports it", async () => {
  const dir = await root();
  await mkdir(join(dir, ".claude/skills/flowly-ship"), { recursive: true });
  await writeFile(join(dir, ".claude/skills/flowly-ship/SKILL.md"), "mine");
  const result = await writeSkill(dir, skill, "new");
  expect(result).toMatchObject({ linked: false, notice: ".claude/skills/flowly-ship already exists; Claude Code keeps using it." });
  expect(await readFile(join(dir, ".claude/skills/flowly-ship/SKILL.md"), "utf8")).toBe("mine");
});

test("a link that cannot be made is reported, never replaced by a copy", async () => {
  const dir = await root();
  const result = await writeSkill(dir, skill, "new", async () => {
    throw new Error("EPERM");
  });
  expect(result).toMatchObject({ linked: false, notice: "Could not link .claude/skills/flowly-ship; Claude Code will not see this skill." });
  await expect(lstat(join(dir, ".claude/skills/flowly-ship"))).rejects.toThrow();
});

test("an existing link to the same folder counts as linked", async () => {
  const dir = await root();
  await mkdir(join(dir, ".claude/skills"), { recursive: true });
  await symlink("../../.agents/skills/flowly-ship", join(dir, ".claude/skills/flowly-ship"));
  expect((await writeSkill(dir, skill, "new")).linked).toBe(true);
});

test("refuses a missing project folder and a bad name", async () => {
  await expect(writeSkill("/nonexistent/flowly", skill, "new")).rejects.toThrow("PROJECT_ROOT_MISSING");
  await expect(writeSkill(await root(), { ...skill, name: "../x" }, "new")).rejects.toThrow("SKILL_INVALID");
});

test("scans both folders and reads descriptions", async () => {
  const dir = await root();
  await mkdir(join(dir, ".claude/skills/hand"), { recursive: true });
  await writeFile(join(dir, ".claude/skills/hand/SKILL.md"), "---\nname: hand\ndescription: Hand written\n---\nBody");
  await writeSkill(dir, skill, "new");
  expect((await scanSkills(dir)).map((s) => [s.name, s.description])).toEqual([
    ["flowly-ship", "Use when shipping."],
    ["hand", "Hand written"],
  ]);
});
