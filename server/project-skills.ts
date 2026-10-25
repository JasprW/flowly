import { lstat, mkdir, readFile, readdir, readlink, realpath, rename, symlink, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { SKILL_NAME, skillBody, skillDescription, skillFile } from "../shared/workflow-insights";

/**
 * Skills in a project directory (INSIGHTS-REDESIGN-SPEC §4): the real file lives in
 * `.agents/skills/<name>/SKILL.md` (Codex reads it), `.claude/skills/<name>` is a relative
 * link to it (Claude Code reads that). One copy only: a link that cannot be made is
 * reported, never replaced by a copy. Never runs git.
 */

export const agentsSkillDir = (root: string, name: string) => join(root, ".agents", "skills", name);
export const claudeSkillLink = (root: string, name: string) => join(root, ".claude", "skills", name);
export const skillPath = (root: string, name: string) => join(agentsSkillDir(root, name), "SKILL.md");

const exists = (path: string) =>
  lstat(path).then(
    () => true,
    () => false,
  );

export type FoundSkill = { name: string; description: string; file: string; text: string };

/** Every SKILL.md under `.agents/skills/*` and `.claude/skills/*`, the same real file listed once. */
export async function scanSkills(root: string): Promise<FoundSkill[]> {
  const out: FoundSkill[] = [];
  const seen = new Set<string>();
  for (const base of [join(root, ".agents", "skills"), join(root, ".claude", "skills")]) {
    const names = await readdir(base).catch(() => [] as string[]);
    for (const name of names.sort()) {
      const file = join(base, name, "SKILL.md");
      const real = await realpath(file).catch(() => null);
      if (!real || seen.has(real)) continue;
      seen.add(real);
      const text = await readFile(real, "utf8").catch(() => null);
      if (text === null) continue;
      out.push({ name, description: skillDescription(text), file, text });
    }
  }
  return out;
}

/** The body of the project's `.agents/skills/<name>/SKILL.md`; null when it is not there. */
export async function readSkillBody(root: string, name: string): Promise<string | null> {
  const text = await readFile(skillPath(root, name), "utf8").catch(() => null);
  return text === null ? null : skillBody(text);
}

export class SkillInstallError extends Error {
  constructor(
    readonly code: "PROJECT_ROOT_MISSING" | "SKILL_EXISTS" | "SKILL_MISSING" | "SKILL_INVALID",
    message: string,
  ) {
    super(`${code}: ${message}`);
  }
}

export type InstallResult = { path: string; linked: boolean; notice?: string };

/**
 * Writes the skill (atomically) and links it for Claude Code (§4.2, §4.3). A new skill
 * refuses an existing directory; an update needs the file to be there.
 */
export async function writeSkill(
  root: string,
  skill: { name: string; description: string; body: string },
  mode: "new" | "update",
  link: (target: string, path: string) => Promise<void> = (target, path) => symlink(target, path, "dir"),
): Promise<InstallResult> {
  if (!SKILL_NAME.test(skill.name)) throw new SkillInstallError("SKILL_INVALID", `${skill.name} is not a valid skill name.`);
  const rootStat = await lstat(root).catch(() => null);
  if (!rootStat) throw new SkillInstallError("PROJECT_ROOT_MISSING", `The project folder ${root} does not exist.`);
  const dir = agentsSkillDir(root, skill.name);
  const file = skillPath(root, skill.name);
  if (mode === "new" && (await exists(dir))) throw new SkillInstallError("SKILL_EXISTS", `A skill named ${skill.name} is already in the project.`);
  if (mode === "update" && !(await exists(file))) throw new SkillInstallError("SKILL_MISSING", `.agents/skills/${skill.name}/SKILL.md is no longer in the project.`);
  await mkdir(dir, { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, skillFile(skill), "utf8");
  await rename(temp, file);

  const path = relative(root, file);
  const linkPath = claudeSkillLink(root, skill.name);
  const target = relative(dirname(linkPath), dir); // ../../.agents/skills/<name>
  const current = await lstat(linkPath).catch(() => null);
  if (current) {
    const points = current.isSymbolicLink() ? resolve(dirname(linkPath), await readlink(linkPath).catch(() => "")) : null;
    if (points === resolve(dir)) return { path, linked: true };
    return { path, linked: false, notice: `.claude/skills/${skill.name} already exists; Claude Code keeps using it.` };
  }
  try {
    await mkdir(dirname(linkPath), { recursive: true });
    await link(target, linkPath);
    return { path, linked: true };
  } catch {
    return { path, linked: false, notice: `Could not link .claude/skills/${skill.name}; Claude Code will not see this skill.` };
  }
}
