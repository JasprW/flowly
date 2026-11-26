import { expect, test } from "vitest";
import { AsyncQuestionTitles, asyncQuestionLimits, codexAnswersMessage } from "./async-questions";

const ask = (id: string, ...titles: string[]) => ({
  id: `permission-${id}`,
  name: "request_user_input_async",
  kind: "question",
  input: { questions: titles.map((question, i) => ({ id: String(i), header: `Question ${i + 1}`, question })) },
});
const allow = (...answers: string[]) => ({ behavior: "allow", updatedInput: { answers: Object.fromEntries(answers.map((a, i) => [`Question ${i + 1}`, a])) } });

test("pairs the answers of the request actually answered with its titles, as the message Paseo sends", () => {
  const q = new AsyncQuestionTitles();
  q.remember("a1", ask("c1", "Which label?", "Where?"));
  q.remember("a1", ask("c2", "Which label?"));
  q.resolved("a1", "permission-c1", allow(" Rerun\n\nwith a hint ", "Drawer only"));
  expect(q.answers("a1")).toEqual([
    {
      callId: "c1",
      message: "Answers to your questions:\n\nWhich label?\nRerun\n\nwith a hint\n\nWhere?\nDrawer only",
      pairs: [
        { ask: "Which label?", text: "Rerun\n\nwith a hint" },
        { ask: "Where?", text: "Drawer only" },
      ],
    },
  ]);
  // The other request is still open and has no answers yet.
  q.resolved("a1", "permission-c2", allow("Retry"));
  expect(q.answers("a1").map((a) => a.callId)).toEqual(["c2", "c1"]);
  expect(codexAnswersMessage([{ ask: "Which label?", text: "Retry" }])).toBe("Answers to your questions:\n\nWhich label?\nRetry");
});

test("ignores other requests, dismissals, incomplete answers and requests it never saw", () => {
  const q = new AsyncQuestionTitles();
  q.remember("a1", { id: "permission-b", name: "Bash", kind: "tool", input: { command: "ls" } });
  q.resolved("a1", "permission-b", allow("yes"));
  q.remember("a1", { id: "permission-e", name: "request_user_input_async", kind: "question", input: { questions: [] } });
  q.remember("a1", ask("d", "Keep it?"));
  q.resolved("a1", "permission-d", { behavior: "deny" });
  q.remember("a1", ask("m", "One?", "Two?"));
  q.resolved("a1", "permission-m", allow("only one"));
  q.resolved("a1", "permission-unknown", allow("x"));
  q.resolved("a2", "permission-m", allow("x", "y"));
  expect(q.answers("a1")).toEqual([]);
  expect(q.answers("a2")).toEqual([]);
});

test("holds a bounded number of questions per session and of sessions", () => {
  const q = new AsyncQuestionTitles();
  for (let i = 0; i <= asyncQuestionLimits.perSession; i++) {
    q.remember("a1", ask(`c${i}`, `Q${i}?`));
    q.resolved("a1", `permission-c${i}`, allow("yes"));
  }
  expect(q.answers("a1")).toHaveLength(asyncQuestionLimits.perSession);
  expect(q.answers("a1").at(-1)!.callId).toBe("c1");
  for (let i = 0; i < asyncQuestionLimits.sessions; i++) {
    q.remember(`s${i}`, ask("c", "Q?"));
    q.resolved(`s${i}`, "permission-c", allow("yes"));
  }
  expect(q.answers("a1")).toEqual([]);
  expect(q.answers("s0")).toHaveLength(1);
  // A title longer than the limit is not kept; its answers message then stays whole.
  q.remember("long", ask("c", "x".repeat(asyncQuestionLimits.title + 1)));
  q.resolved("long", "permission-c", allow("yes"));
  expect(q.answers("long")).toEqual([]);
});

test("knows a call's outcome only while it holds the call: open, answered, or closed without an answer", () => {
  const q = new AsyncQuestionTitles();
  q.remember("a1", ask("open", "Now?"));
  q.remember("a1", ask("done", "Which?"));
  q.resolved("a1", "permission-done", allow("This one"));
  q.remember("a1", ask("d", "Keep it?"));
  q.resolved("a1", "permission-d", { behavior: "deny" });
  q.remember("a1", ask("m", "One?", "Two?"));
  q.resolved("a1", "permission-m", allow("only one"));
  q.remember("a1", ask("long", "x".repeat(asyncQuestionLimits.title + 1)));
  const s = q.session("a1");
  expect(s.answered.map((a) => a.callId)).toEqual(["done"]);
  for (const callId of ["open", "done", "d", "m"]) expect(s.known(callId)).toBe(true);
  // Asked before a plugin reload, or with titles too long to keep: its outcome is unknown.
  for (const callId of ["before-reload", "long"]) expect(s.known(callId)).toBe(false);
  expect(q.session("a2").known("done")).toBe(false);
});
