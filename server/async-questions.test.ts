import { expect, test } from "vitest";
import { AsyncQuestionTitles, asyncQuestionLimits } from "./async-questions";

const ask = (id: string, ...titles: string[]) => ({
  id: `permission-${id}`,
  name: "request_user_input_async",
  kind: "question",
  input: { questions: titles.map((question, i) => ({ id: String(i), header: `Question ${i + 1}`, question })) },
});

test("keeps a Codex async question's titles by session and call id, newest first, and ignores other requests", () => {
  const asked = new AsyncQuestionTitles();
  asked.remember("a1", ask("c1", "Which label?", "Where?"));
  asked.remember("a1", ask("c2", "  Keep it?  "));
  asked.remember("a1", { id: "permission-c3", name: "Bash", kind: "tool", input: { command: "ls" } });
  asked.remember("a1", { id: "permission-c4", name: "request_user_input_async", kind: "question", input: { questions: [] } });
  asked.remember("a1", { id: "permission-c5", name: "request_user_input_async", kind: "question", input: { questions: [{ question: "" }] } });
  expect(asked.asked("a1")).toEqual([
    ["c2", ["Keep it?"]],
    ["c1", ["Which label?", "Where?"]],
  ]);
  expect(asked.asked("a2")).toEqual([]);
});

test("holds a bounded number of questions per session and of sessions", () => {
  const asked = new AsyncQuestionTitles();
  for (let i = 0; i <= asyncQuestionLimits.perSession; i++) asked.remember("a1", ask(`c${i}`, `Q${i}?`));
  expect(asked.asked("a1")).toHaveLength(asyncQuestionLimits.perSession);
  expect(asked.asked("a1").at(-1)![0]).toBe("c1");
  for (let i = 0; i < asyncQuestionLimits.sessions; i++) asked.remember(`s${i}`, ask("c", "Q?"));
  expect(asked.asked("a1")).toEqual([]);
  expect(asked.asked("s0")).toHaveLength(1);
  // A title longer than the limit is not kept; the answers message then stays whole.
  asked.remember("long", ask("c", "x".repeat(asyncQuestionLimits.title + 1)));
  expect(asked.asked("long")).toEqual([]);
});
