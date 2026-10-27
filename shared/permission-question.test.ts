import { expect, test } from "vitest";
import {
  allAnswered,
  answerReply,
  asksQuestion,
  buildAnswers,
  choose,
  dismissReply,
  emptyDraft,
  nextUnanswered,
  parseQuestions,
  pendingRequests,
  stepQuestion,
  typeOther,
  type PendingRequest,
} from "./permission-question";

// A Claude AskUserQuestion request as Paseo forwards it (allowOther added by the provider).
const request: PendingRequest = {
  id: "permission-1",
  name: "AskUserQuestion",
  kind: "question",
  input: {
    questions: [
      {
        question: "Which database should we use?",
        header: "Database",
        options: [{ label: "Postgres", description: "Relational" }, { label: "SQLite" }],
        multiSelect: false,
        allowOther: true,
      },
      {
        question: "Which features?",
        header: "Features",
        options: [{ label: "Auth" }, { label: "Search" }, { label: "Export" }],
        multiSelect: true,
        allowOther: true,
      },
    ],
  },
};
const questions = parseQuestions(request)!;

test("parses a question form and rejects other kinds or malformed input", () => {
  expect(questions.map((q) => [q.header, q.multiSelect, q.allowOther, q.options.length])).toEqual([
    ["Database", false, true, 2],
    ["Features", true, true, 3],
  ]);
  expect(parseQuestions({ ...request, kind: "tool" })).toBeNull();
  expect(parseQuestions({ ...request, input: { questions: [{ question: "q", options: [] }] } })).toBeNull();
  expect(parseQuestions({ ...request, input: { questions: [] } })).toBeNull();
});

test("single select replaces and clears typed text; multi select toggles", () => {
  let draft = emptyDraft(questions);
  draft = typeOther(draft, questions, 0, "MySQL");
  draft = choose(draft, questions, 0, 1);
  expect(draft.selected[0]).toEqual([1]);
  expect(draft.other[0]).toBe("");
  draft = choose(draft, questions, 0, 0);
  expect(draft.selected[0]).toEqual([0]);
  draft = choose(draft, questions, 1, 2);
  draft = choose(draft, questions, 1, 0);
  draft = choose(draft, questions, 1, 2);
  expect(draft.selected[1]).toEqual([0]);
  // Typing in a single-select question drops its option; multi-select keeps them.
  expect(typeOther(draft, questions, 0, "x").selected[0]).toEqual([]);
  expect(typeOther(draft, questions, 1, "x").selected[1]).toEqual([0]);
});

test("answers are keyed by header and match Paseo's encoding", () => {
  let draft = emptyDraft(questions);
  expect(allAnswered(questions, draft)).toBe(false);
  draft = choose(draft, questions, 0, 0);
  expect(allAnswered(questions, draft)).toBe(false);
  draft = choose(draft, questions, 1, 1);
  draft = choose(draft, questions, 1, 0);
  draft = typeOther(draft, questions, 1, "  Billing ");
  expect(allAnswered(questions, draft)).toBe(true);
  expect(buildAnswers(questions, draft)).toEqual({ Database: "Postgres", Features: "Auth, Search, Billing" });
  const reply = answerReply(request, questions, draft);
  expect(reply).toEqual({
    behavior: "allow",
    updatedInput: { ...request.input, answers: { Database: "Postgres", Features: "Auth, Search, Billing" } },
  });
  expect(buildAnswers(questions, typeOther(emptyDraft(questions), questions, 0, " Mongo "))).toEqual({ Database: "Mongo" });
});

test("dismiss denies, except empty-allowed free-text questions submit empty", () => {
  expect(dismissReply(request, questions, emptyDraft(questions))).toEqual({ behavior: "deny", message: "Dismissed by user" });
  const free: PendingRequest = {
    id: "p2",
    kind: "question",
    input: { questions: [{ question: "Anything else?", header: "Notes", options: [], allowEmpty: true }] },
  };
  const qs = parseQuestions(free)!;
  expect(allAnswered(qs, emptyDraft(qs))).toBe(true);
  expect(dismissReply(free, qs, emptyDraft(qs))).toEqual({ behavior: "allow", updatedInput: { ...free.input, answers: { Notes: "" } } });
});

test("pending requests tolerate missing or malformed host data", () => {
  expect(pendingRequests(null)).toEqual([]);
  expect(pendingRequests({ pendingPermissions: [null, {}, { id: "" }, request] })).toEqual([request]);
  expect(asksQuestion({ pendingPermissions: [request] })).toBe(true);
  expect(asksQuestion({ pendingPermissions: [{ id: "t", kind: "tool" }] })).toBe(false);
});

test("nextUnanswered moves to the next open question, wrapping, and -1 when all are answered", () => {
  const qs = [0, 1, 2].map((i) => ({ question: `Q${i}`, header: `H${i}`, options: [{ label: "A" }], multiSelect: false, allowOther: false, allowEmpty: false }));
  let draft = emptyDraft(qs);
  expect(nextUnanswered(qs, draft, 0)).toBe(1);
  draft = choose(draft, qs, 1, 0);
  expect(nextUnanswered(qs, draft, 0)).toBe(2);
  draft = choose(draft, qs, 2, 0);
  expect(nextUnanswered(qs, draft, 2)).toBe(0);
  draft = choose(draft, qs, 0, 0);
  expect(nextUnanswered(qs, draft, 0)).toBe(-1);
});

test("stepQuestion moves with plain arrow keys inside the bounds only", () => {
  expect(stepQuestion({ key: "ArrowRight" }, 0, 3)).toBe(1);
  expect(stepQuestion({ key: "ArrowLeft" }, 2, 3)).toBe(1);
  expect(stepQuestion({ key: "ArrowLeft" }, 0, 3)).toBeNull();
  expect(stepQuestion({ key: "ArrowRight" }, 2, 3)).toBeNull();
  expect(stepQuestion({ key: "ArrowRight", metaKey: true }, 0, 3)).toBeNull();
  expect(stepQuestion({ key: "ArrowRight", repeat: true }, 0, 3)).toBeNull();
  expect(stepQuestion({ key: "ArrowRight" }, 0, 1)).toBeNull();
  expect(stepQuestion({ key: "l" }, 0, 3)).toBeNull();
});
