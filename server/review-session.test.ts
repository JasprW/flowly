import { expect, test } from "vitest";
import { parseReviewOutput, reviewPrompt } from "./review-session";

test("review output: lenient JSON, unknown ids and bad entries dropped, one verdict per id", () => {
  const text = 'Here you go:\n```json\n{"rules":[{"id":"a","verdict":"fail","detail":"Missing test","file":"x.ts","line":4},{"id":"zzz","verdict":"pass","detail":""},{"id":"b","verdict":"maybe","detail":""},{"id":"a","verdict":"pass","detail":"dup"},{"id":"c","verdict":"na","detail":"n/a","line":0}]}\n```';
  expect(parseReviewOutput(text, ["a", "b", "c"])).toEqual([
    { id: "a", verdict: "fail", detail: "Missing test", file: "x.ts", line: 4 },
    { id: "c", verdict: "na", detail: "n/a" },
  ]);
  expect(() => parseReviewOutput("no json here", ["a"])).toThrow(/not JSON/);
  expect(() => parseReviewOutput('{"x":1}', ["a"])).toThrow(/no rules list/);
});

test("review prompt carries the card, workpad, note, guidance, rules and diff", () => {
  const prompt = reviewPrompt({
    task: { id: "t", title: "Add login", description: "Desc", type: "feature", workspaceId: "w" },
    rules: [{ id: "acc", name: "Acceptance", prompt: "Every criterion is met." }],
    guidance: "TypeScript, no deps.",
    workpad: null,
    deliveryNote: "Done",
    outputs: ["https://pr"],
    commands: ["Tests: passed"],
    diff: "DIFF",
    parentAgentId: "a",
  });
  for (const part of ["Title: Add login", "Delivery note (the agent's own report, context only)\nDone", "- https://pr", "Tests: passed", "TypeScript, no deps.", "id: acc", "Every criterion is met.", "## Diff\nDIFF", "Read-only"])
    expect(prompt).toContain(part);
});

test("P3: the built-in check's input: the user's words in order, or a note when they could not be read; nothing for other rules", () => {
  const base = { task: { id: "t", title: "T", description: "", workspaceId: "w" }, rules: [{ id: "goal", name: "Does what you asked", prompt: "p" }], workpad: null, deliveryNote: "", outputs: [], commands: [], diff: "", parentAgentId: "a" };
  const said = reviewPrompt({ ...base, conversation: ["Do A.", "A can wait."] });
  expect(said).toContain("## What the user said in this card's sessions (oldest first)\n[1] Do A.\n\n[2] A can wait.");
  expect(reviewPrompt({ ...base, conversation: null })).toContain("(conversation unavailable)");
  expect(reviewPrompt(base)).not.toContain("What the user said");
  // A shared directory: the built-in check is told other cards' changes may be in the diff (§4.2).
  expect(reviewPrompt({ ...base, shared: true })).toContain("may belong to another card");
  expect(reviewPrompt(base)).not.toContain("may belong to another card");
  expect(reviewPrompt({ ...base, shared: true, rules: [{ id: "x", name: "X", prompt: "p" }] })).not.toContain("may belong to another card");
});
