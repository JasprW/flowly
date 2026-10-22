import { expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import { skillText } from "./skill-source";
import { turnChecklist } from "../shared/turn-checklist";

test("the installed skill source contains the exact live checklist before details", async () => {
  const core = skillText.split("## Start of every turn\n")[1]!.split("## Details")[0]!;
  for (const [index, rule] of turnChecklist.entries())
    expect(core).toContain(`${index + 1}. ${rule}`);
  expect(turnChecklist).toHaveLength(6);
  expect(turnChecklist.join("\n").length).toBeLessThan(1800);
  expect(skillText).not.toContain("before starting a work phase");
  expect(skillText).not.toMatch(/Start of every turn, step \d/);
  expect(await readFile(new URL("../skills/flowly/SKILL.md", import.meta.url), "utf8")).toBe(skillText);
});
