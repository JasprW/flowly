import { expect, test } from "vitest";
import { insightJsonSchema, insightPrompt, parseInsightOutput, sessionIdeaInstruction } from "./session-insights";

const parts = { progress: true, nextMoves: true, ideas: true };

test("parses progress, moves and ideas; caps moves at 3 and ideas at 2; tolerates fences and missing optional parts", () => {
  const out = parseInsightOutput(
    "```json\n" +
      JSON.stringify({
        update: "true",
        state: "Fix in review",
        target: "Goal: ship the fix",
        recap: ["login fixed", "tests added"],
        next: "Wait for review",
        moves: [1, 2, 3, 4].map((n) => ({ label: `M${n}`, prompt: `Do ${n}` })),
        ideas: [1, 2, 3].map((n) => ({ title: `I${n}`, detail: "d", rationale: "r", scope: n === 1 ? "here" : "new" })),
      }) +
      "\n```",
    parts,
  );
  expect(out.progress).toMatchObject({ update: true, state: "Fix in review", target: "ship the fix", recap: "- login fixed\n- tests added" });
  expect(out.moves.map((m) => m.label)).toEqual(["M1", "M2", "M3"]);
  expect(out.ideas.map((i) => [i.title, i.scope])).toEqual([["I1", "here"], ["I2", "new"]]);
  // A disabled part is ignored even if the model returns it; missing lists read as empty.
  const only = parseInsightOutput(JSON.stringify({ update: false, moves: [{ label: "x", prompt: "y" }] }), { progress: true, nextMoves: false, ideas: false });
  expect(only.moves).toEqual([]);
  expect(only.ideas).toEqual([]);
  expect(only.progress?.update).toBe(false);
});

test("drops malformed moves and ideas instead of failing the whole run; rejects missing JSON", () => {
  const out = parseInsightOutput(JSON.stringify({ moves: [{ label: "" }, { label: "Ok", prompt: "Go" }, "bad"], ideas: [{ title: "" }, { title: "T", detail: "D" }] }), { progress: false, nextMoves: true, ideas: true });
  expect(out.moves).toEqual([{ label: "Ok", prompt: "Go" }]);
  expect(out.ideas).toEqual([{ title: "T", detail: "D", rationale: "", scope: "new" }]);
  expect(() => parseInsightOutput("no json here", parts)).toThrow(/no JSON/);
});

test("the prompt and schema only ask for enabled parts; open idea titles are listed to avoid repeats; a full idea list asks for none", () => {
  const base = { title: "Fix login", cwd: "/repo", previous: null, transcript: "User: fix it", openIdeas: ["Add rate limit"], openIdeaCount: 1, language: "en" as const };
  const all = insightPrompt({ ...base, parts });
  expect(all).toContain('"moves"');
  expect(all).toContain('"ideas"');
  expect(all).toContain("Add rate limit");
  const noIdeas = insightPrompt({ ...base, parts: { ...parts, ideas: false } });
  expect(noIdeas).not.toContain('"ideas"');
  const full = insightPrompt({ ...base, openIdeaCount: 5, parts });
  expect(full).toContain('"ideas": always an empty list');
  expect(Object.keys(insightJsonSchema({ progress: false, nextMoves: true, ideas: false }).properties)).toEqual(["moves"]);
});

test("an idea becomes the same instruction as a card idea", () => {
  expect(sessionIdeaInstruction({ title: "T", detail: "D", rationale: "R" })).toBe("Good idea — go ahead with it in this task: T\n\nD\n\nWhy: R");
});
