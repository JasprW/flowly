import { describe, expect, it } from "vitest";
import { flowEntry, type FlowEntry } from "./insights";
import { FLAG_MIN, habits, matchPick, modellessAgents, startedByUser, turnPick, userTexts, withMoveDetails } from "./agent-habits";
import type { BoardEvent } from "./model";

// ---- Fixtures: one session unless a test says otherwise -----------------------------

let seq = 0;
const T0 = Date.parse("2026-10-19T10:00:00Z");
const MIN = 60_000;
type Extra = Partial<FlowEntry> & { minutes?: number };
function at(minutes: number) {
  return new Date(T0 + minutes * MIN).toISOString();
}
function ev(action: string, minutes: number, extra: Extra = {}): FlowEntry {
  const { minutes: _ignored, ...rest } = extra;
  return { id: `e${++seq}`, at: at(minutes), taskId: "t1", actor: "agent", action, agentId: "a1", ...rest };
}
const start = (m: number, x: Extra = {}) => ev("agent.turn_started", m, { actor: "system", ...x });
const end = (m: number, x: Extra = {}) => ev("agent.turn_ended", m, { actor: "system", outcome: "completed", ...x });
const moves = (m: number, x: Extra = {}) => ev("next_moves_suggested", m, { offered: 2, ...x });
const idea = (m: number, x: Extra = {}) => ev("idea_proposed", m, x);
const deliver = (m: number, x: Extra = {}) => ev("status_changed", m, { from: "development", to: "in_review", reportKind: "progress", ...x });
const result = (m: number, x: Extra = {}) => ev("progress_reported", m, { reportKind: "result", ...x });
const question = (m: number, x: Extra = {}) => ev("progress_reported", m, { reportKind: "question", ...x });
const toDone = (m: number, x: Extra = {}) => ev("status_changed", m, { actor: "human", agentId: undefined, from: "in_review", to: "done", ...x });

const DAY = "2026-10-19";
const view = (entries: FlowEntry[], extra: Partial<Parameters<typeof habits>[1]> = {}) => habits(entries, { day: DAY, tz: "UTC", ...extra });
const today = (entries: FlowEntry[], extra = {}) => view(entries, extra).days.at(-1)!;

describe("turn boundaries", () => {
  it("counts a turn that delivered with next moves once, however many times it called them", () => {
    const d = today([start(0), moves(1), idea(2), moves(3), deliver(4), end(5)]);
    expect(d).toMatchObject({ deliveries: 1, results: 0, questions: 0, moves: 1, movesAny: 1, ideas: 1 });
  });

  it("keeps each turn apart: moves in the first turn do not count for the second", () => {
    const d = today([start(0), moves(1), deliver(2), end(3), start(10), deliver(11), end(12)]);
    expect(d).toMatchObject({ deliveries: 2, moves: 1, movesAny: 1 });
  });

  it("gives an agent event after turn_ended to the turn that just ended", () => {
    const d = today([start(0), deliver(1), end(2), moves(3)]);
    expect(d).toMatchObject({ deliveries: 1, moves: 1 });
  });

  it("makes a turn of its own for events with no turn_started before them", () => {
    const d = today([moves(1), deliver(2), end(3)]);
    expect(d).toMatchObject({ deliveries: 1, moves: 1 });
  });

  it("does not let a turn_ended with no start overwrite the turn before it", () => {
    const out = view([start(0), deliver(1), end(2, { model: "m/one" }), end(5, { model: "m/two" })]);
    expect(out.models.map((m) => m.model)).toEqual(["m/one"]);
  });

  it("keeps sessions apart", () => {
    const b = { agentId: "b1", taskId: "t2" };
    const d = today([start(0), start(1, b), moves(2), deliver(3), end(4), deliver(5, b), end(6, b)]);
    expect(d).toMatchObject({ deliveries: 2, moves: 1 });
  });

  it("orders entries by time even when the log was appended out of order", () => {
    const d = today([moves(1), end(3), deliver(2), start(0)]);
    expect(d).toMatchObject({ deliveries: 1, moves: 1 });
  });

  it("ignores events a rule or a person made", () => {
    const d = today([start(0), ev("status_changed", 1, { actor: "system", rule: "A1", to: "in_review" }), ev("idea_proposed", 2, { actor: "human" }), end(3)]);
    expect(d).toMatchObject({ deliveries: 0, ideas: 0 });
  });
});

describe("delivery kinds", () => {
  it("counts in_review deliveries and result reports as the base, and questions apart", () => {
    const d = today([start(0), deliver(1), end(2), start(10), result(11), end(12), start(20), question(21), end(22)]);
    expect(d).toMatchObject({ deliveries: 1, results: 1, questions: 1 });
  });

  it("counts a turn with a delivery and a result once, as a delivery", () => {
    const d = today([start(0), result(1), deliver(2), end(3)]);
    expect(d).toMatchObject({ deliveries: 1, results: 0 });
  });

  it("counts a turn that asked after reporting a result as a result", () => {
    const d = today([start(0), question(1), result(2), end(3)]);
    expect(d).toMatchObject({ results: 1, questions: 0 });
  });

  it("does not count next moves on a question turn in the rate, only in movesAny", () => {
    const d = today([start(0), question(1), moves(2), end(3)]);
    expect(d).toMatchObject({ questions: 1, moves: 0, movesAny: 1 });
  });

  it("does not count turns that reported nothing", () => {
    expect(today([start(0), moves(1), end(2)])).toMatchObject({ deliveries: 0, results: 0, questions: 0, moves: 0, movesAny: 1 });
  });
});

describe("explicit none", () => {
  const none = (m: number, x: Extra = {}) => ev("next_moves_suggested", m, { offered: 0, ...x });

  it("counts a delivery that said none apart from one that suggested moves", () => {
    const d = today([start(0), none(1), deliver(2), end(3), start(10), moves(11), deliver(12), end(13), start(20), deliver(21), end(22)]);
    expect(d).toMatchObject({ deliveries: 3, moves: 1, none: 1, movesAny: 1 });
  });

  it("lets the last call of the turn decide", () => {
    expect(today([start(0), moves(1), none(2), deliver(3), end(4)])).toMatchObject({ moves: 0, none: 1, movesAny: 0 });
    expect(today([start(0), none(1), moves(2), deliver(3), end(4)])).toMatchObject({ moves: 1, none: 0, movesAny: 1 });
  });

  it("counts none only on deliveries and results", () => {
    expect(today([start(0), question(1), none(2), end(3)])).toMatchObject({ questions: 1, none: 0 });
  });

  it("offers nothing to pick, and clears what the turn offered before", () => {
    const d = today([start(0), moves(1), none(2), deliver(3), end(4), start(10), deliver(11), end(12, { pick: 0 })]);
    expect(d).toMatchObject({ offered: 0, picked: 0 });
  });

  it("does not count an old entry without offered as none", () => {
    expect(today([start(0), ev("next_moves_suggested", 1), deliver(2), end(3)])).toMatchObject({ moves: 1, none: 0 });
  });
});

describe("days", () => {
  it("returns the seven days ending at the day, oldest first, with a total", () => {
    const out = view([start(0), deliver(1), end(2)]);
    expect(out.days.map((d) => d.day)).toEqual(["2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18", "2026-10-19"]);
    expect(out.total.deliveries).toBe(1);
  });

  it("puts a turn on the day of its last event", () => {
    // Starts 23:50 UTC on the 18th, delivers and ends after midnight.
    const late = (m: number) => m - 10 * 60 - 10;
    const out = view([start(late(0)), deliver(late(20)), end(late(25))]);
    expect(out.days.find((d) => d.day === "2026-10-19")!.deliveries).toBe(1);
    expect(out.days.find((d) => d.day === "2026-10-18")!.deliveries).toBe(0);
  });

  it("cuts days in the given zone", () => {
    const entries = [start(0), deliver(1), end(2)]; // 10:00Z on the 19th
    expect(view(entries, { tz: "UTC" }).days.at(-1)!.deliveries).toBe(1);
    // 10:00Z is 18:00 on the 19th in Shanghai, but 00:00 on the 20th at UTC+14, which is past the window.
    expect(view(entries, { tz: "Asia/Shanghai" }).days.at(-1)!.deliveries).toBe(1);
    expect(view(entries, { tz: "Pacific/Kiritimati" }).days.at(-1)!.deliveries).toBe(0);
  });

  it("leaves out turns older than the window", () => {
    const old = (m: number) => m - 9 * 24 * 60;
    const out = view([start(old(0)), deliver(old(1)), end(old(2))]);
    expect(out.total.deliveries).toBe(0);
  });
});

describe("models", () => {
  const s = (agentId: string, model?: string): Extra => ({ agentId, taskId: `t-${agentId}`, ...(model ? { model } : {}) });

  it("groups turns by the model stamped on turn_ended", () => {
    const out = view([
      start(0, s("a1")),
      moves(1, s("a1")),
      deliver(2, s("a1")),
      end(3, s("a1", "codex/gpt-6-luna")),
      start(10, s("a2")),
      deliver(11, s("a2")),
      end(12, s("a2", "claude/claude-sonnet-5")),
    ]);
    const by = Object.fromEntries(out.models.map((m) => [m.model, m]));
    expect(by["codex/gpt-6-luna"]).toMatchObject({ deliveries: 1, moves: 1 });
    expect(by["claude/claude-sonnet-5"]).toMatchObject({ deliveries: 1, moves: 0 });
  });

  it("uses the fallback for turns without a model, and groups the rest as unknown", () => {
    const out = view([start(0, s("a1")), deliver(1, s("a1")), end(2, s("a1")), start(10, s("a2")), deliver(11, s("a2")), end(12, s("a2"))], {
      modelOf: (id) => (id === "a1" ? "codex/gpt-6-astra" : undefined),
    });
    expect(out.models.map((m) => m.model).sort()).toEqual(["", "codex/gpt-6-astra"]);
  });

  it("prefers the stamped model over the fallback", () => {
    const out = view([start(0, s("a1")), deliver(1, s("a1")), end(2, s("a1", "codex/gpt-6-luna"))], { modelOf: () => "codex/gpt-6-astra" });
    expect(out.models.map((m) => m.model)).toEqual(["codex/gpt-6-luna"]);
  });

  it("orders models by their base, largest first", () => {
    const out = view([
      start(0, s("a1")), deliver(1, s("a1")), end(2, s("a1", "m/one")),
      start(10, s("a2")), deliver(11, s("a2")), end(12, s("a2", "m/two")),
      start(20, s("a2")), deliver(21, s("a2")), end(22, s("a2", "m/two")),
    ]);
    expect(out.models.map((m) => m.model)).toEqual(["m/two", "m/one"]);
  });

  it("lists the agents with turns in the window and no model, so the caller can look them up", () => {
    const entries = [start(0, s("a1")), deliver(1, s("a1")), end(2, s("a1", "m/one")), start(10, s("a2")), deliver(11, s("a2")), end(12, s("a2"))];
    expect([...modellessAgents(entries, { day: DAY, tz: "UTC" })]).toEqual(["a2"]);
  });
});

describe("matchPick", () => {
  const prompts = [{ prompt: "Run the full test suite and report any failures." }, { prompt: "Commit and push the change." }, { label: "Move to Done" }];

  it("matches the exact prompt", () => {
    expect(matchPick(prompts, ["Commit and push the change."])).toBe(1);
  });

  it("matches after the user's own text, as the composer appends a pick", () => {
    expect(matchPick(prompts, ["thanks, also\n\nRun the full test suite and report any failures."])).toBe(0);
  });

  it("ignores whitespace differences", () => {
    expect(matchPick(prompts, ["  Commit   and push\nthe change.  "])).toBe(1);
  });

  it("matches a prompt the user edited a little", () => {
    expect(matchPick(prompts, ["Run the full test suite and report any failures, then commit."])).toBe(0);
    expect(matchPick(prompts, ["Run the full test suite and report any failure"])).toBe(0);
  });

  it("does not match an unrelated message", () => {
    expect(matchPick(prompts, ["Why did the build take so long?"])).toBe(-1);
  });

  it("does not match when the user rewrote most of it", () => {
    expect(matchPick(prompts, ["Run the tests"])).toBe(-1);
  });

  it("works for text without spaces", () => {
    const zh = [{ prompt: "把 next move 功能的改动提交成一个 commit，只暂存本功能相关文件。" }];
    expect(matchPick(zh, ["把 next move 功能的改动提交成一个 commit，只暂存本功能相关文件。另外别推送"])).toBe(0);
    expect(matchPick(zh, ["先看一下测试结果"])).toBe(-1);
  });

  it("needs the whole text for a short prompt", () => {
    const short = [{ prompt: "Yes" }, { prompt: "Continue" }];
    expect(matchPick(short, ["Yes"])).toBe(0);
    expect(matchPick(short, ["Yes, but only for the board"])).toBe(-1);
  });

  it("picks the closest of several and the first on a tie", () => {
    const two = [{ prompt: "Verify the change on desktop and compact layouts." }, { prompt: "Verify the change on desktop and compact layouts, then commit." }];
    expect(matchPick(two, ["Verify the change on desktop and compact layouts, then commit."])).toBe(1);
    const same = [{ prompt: "Do the same thing here please." }, { prompt: "Do the same thing here please." }];
    expect(matchPick(same, ["Do the same thing here please."])).toBe(0);
  });

  it("returns -1 for action moves only and for no message", () => {
    expect(matchPick([{ label: "Move to Done" }], ["Move to Done"])).toBe(-1);
    expect(matchPick(prompts, [])).toBe(-1);
    expect(matchPick(prompts, ["   "])).toBe(-1);
  });

  it("looks at every message of the turn", () => {
    expect(matchPick(prompts, ["hello", "Commit and push the change."])).toBe(1);
  });
});

describe("turnPick", () => {
  const board = (...list: Partial<BoardEvent>[]) => list.map((e, i) => ({ id: String(i), taskId: "t1", actor: "agent", at: at(i), ...e })) as BoardEvent[];
  const offered = { action: "next_moves_suggested", agentId: "a1", moves: [{ label: "Verify", prompt: "Verify the change on desktop and compact layouts." }] };

  it("decides on the moves open when the turn started", () => {
    const events = board({ action: "agent.turn_started", agentId: "a1" }, offered, { action: "agent.turn_ended", agentId: "a1" }, { action: "agent.turn_started", agentId: "a1" });
    expect(turnPick(events, "a1", ["Verify the change on desktop and compact layouts."])).toBe(0);
    expect(turnPick(events, "a1", ["something else entirely"])).toBe(-1);
  });

  it("is undefined when nothing was open", () => {
    const events = board({ action: "agent.turn_started", agentId: "a1" }, { action: "agent.turn_ended", agentId: "a1" }, { action: "agent.turn_started", agentId: "a1" });
    expect(turnPick(events, "a1", ["anything"])).toBeUndefined();
  });

  it("does not count moves the turn itself suggested", () => {
    const events = board({ action: "agent.turn_started", agentId: "a1" }, offered);
    expect(turnPick(events, "a1", ["Verify the change on desktop and compact layouts."])).toBeUndefined();
  });

  it("ignores another session's moves", () => {
    const events = board({ action: "agent.turn_started", agentId: "a2" }, { ...offered, agentId: "a2" }, { action: "agent.turn_ended", agentId: "a2" }, { action: "agent.turn_started", agentId: "a1" });
    expect(turnPick(events, "a1", ["Verify the change on desktop and compact layouts."])).toBeUndefined();
  });

  it("is undefined without a message to compare", () => {
    const events = board({ action: "agent.turn_started", agentId: "a1" }, offered, { action: "agent.turn_ended", agentId: "a1" }, { action: "agent.turn_started", agentId: "a1" });
    expect(turnPick(events, "a1", [])).toBeUndefined();
    expect(turnPick(events, "a1", [" "])).toBeUndefined();
  });
});

describe("picked share", () => {
  // Turn one offers moves; turn two is the user's reply, ending with `pick`.
  const round = (offer: number, reply: number, pick: number | undefined, x: Extra = {}) => [
    start(offer),
    moves(offer + 1, x),
    deliver(offer + 2),
    end(offer + 3),
    start(reply),
    deliver(reply + 1),
    end(reply + 2, pick === undefined ? {} : { pick }),
  ];

  it("counts a reply that matched a move as picked", () => {
    expect(today(round(0, 10, 1))).toMatchObject({ offered: 1, picked: 1 });
  });

  it("counts index 0 as picked", () => {
    expect(today(round(0, 10, 0))).toMatchObject({ offered: 1, picked: 1 });
  });

  it("counts a reply that matched nothing as answered, not picked", () => {
    expect(today(round(0, 10, -1))).toMatchObject({ offered: 1, picked: 0 });
  });

  it("leaves a reply with no verdict out of the share", () => {
    expect(today(round(0, 10, undefined))).toMatchObject({ offered: 0, picked: 0 });
  });

  it("leaves a set nobody answered out of the share", () => {
    expect(today([start(0), moves(1), deliver(2), end(3)])).toMatchObject({ offered: 0, picked: 0 });
  });

  it("does not count a set the same turn replaced", () => {
    const out = today([start(0), moves(1), moves(2), deliver(3), end(4), start(10), deliver(11), end(12, { pick: 0 })]);
    expect(out).toMatchObject({ offered: 1, picked: 1 });
  });

  it("counts a card moved to Done while a Move to Done suggestion was open as picked", () => {
    const out = today([start(0), moves(1, { offersDone: true }), deliver(2), end(3), toDone(5)]);
    expect(out).toMatchObject({ offered: 1, picked: 1 });
  });

  it("does not count a move to Done when no such suggestion was open", () => {
    const out = today([start(0), moves(1), deliver(2), end(3), toDone(5)]);
    expect(out).toMatchObject({ offered: 0, picked: 0 });
  });

  it("does not count a Done move after the user had already replied", () => {
    const out = today([...round(0, 10, -1, { offersDone: true }), toDone(20)]);
    expect(out).toMatchObject({ offered: 1, picked: 0 });
  });

  it("books the set on the day and model of the turn that offered it", () => {
    const yesterday = (m: number) => m - 24 * 60;
    const out = view([
      start(yesterday(0)), moves(yesterday(1)), deliver(yesterday(2)), end(yesterday(3), { model: "m/one" }),
      start(5), deliver(6), end(7, { pick: 0, model: "m/two" }),
    ]);
    expect(out.days.find((d) => d.day === "2026-10-18")).toMatchObject({ offered: 1, picked: 1 });
    expect(out.days.at(-1)).toMatchObject({ offered: 0, picked: 0 });
    expect(out.models.find((m) => m.model === "m/one")).toMatchObject({ offered: 1, picked: 1 });
    expect(out.models.find((m) => m.model === "m/two")).toMatchObject({ offered: 0, picked: 0 });
  });
});

describe("flags", () => {
  const sessionTurns = (agentId: string, n: number, opts: { moves?: boolean; ideas?: boolean; model?: string } = {}) =>
    Array.from({ length: n }, (_, i) => {
      const m = i * 10 + (agentId === "b1" ? 3 : 0);
      const x = { agentId, taskId: `t-${agentId}` };
      return [
        start(m, x),
        ...(opts.moves && i === 0 ? [moves(m + 1, x)] : []),
        ...(opts.ideas && i === 0 ? [idea(m + 1, x)] : []),
        deliver(m + 2, x),
        end(m + 3, { ...x, ...(opts.model ? { model: opts.model } : {}) }),
      ];
    }).flat();

  it(`flags a model and a session with no next moves over ${FLAG_MIN} deliveries`, () => {
    const out = view(sessionTurns("a1", FLAG_MIN, { ideas: true, model: "codex/gpt-6-astra" }));
    expect(out.flags).toContainEqual({ kind: "model", miss: "moves", model: "codex/gpt-6-astra", n: FLAG_MIN });
    expect(out.flags).toContainEqual({ kind: "session", miss: "moves", model: "codex/gpt-6-astra", n: FLAG_MIN, agentId: "a1", taskId: "t-a1" });
    expect(out.flags.some((f) => f.miss === "ideas")).toBe(false);
  });

  it("does not flag below the threshold", () => {
    expect(view(sessionTurns("a1", FLAG_MIN - 1, { model: "m/one" })).flags).toEqual([]);
  });

  it("does not flag a model that made any next moves", () => {
    const out = view(sessionTurns("a1", FLAG_MIN, { moves: true, ideas: true, model: "m/one" }));
    expect(out.flags).toEqual([]);
  });

  it("does not flag next moves when the model said none instead", () => {
    const said = Array.from({ length: FLAG_MIN }, (_, i) => [start(i * 10), ev("next_moves_suggested", i * 10 + 1, { offered: 0 }), idea(i * 10 + 2), deliver(i * 10 + 3), end(i * 10 + 4, { model: "m/one" })]).flat();
    expect(view(said).flags.filter((f) => f.miss === "moves")).toEqual([]);
  });

  it("flags no ideas separately", () => {
    const out = view(sessionTurns("a1", FLAG_MIN, { moves: true, model: "m/one" }));
    expect(out.flags.map((f) => [f.kind, f.miss])).toEqual([
      ["model", "ideas"],
      ["session", "ideas"],
    ]);
  });

  it("counts result reports for the next-move threshold but not for the ideas one", () => {
    const results = Array.from({ length: FLAG_MIN }, (_, i) => [start(i * 10), result(i * 10 + 1), end(i * 10 + 2, { model: "m/one" })]).flat();
    const out = view(results);
    expect(out.flags.map((f) => [f.kind, f.miss])).toEqual([
      ["model", "moves"],
      ["session", "moves"],
    ]);
  });

  it("judges a session by the whole window, not by one day", () => {
    const spread = Array.from({ length: FLAG_MIN }, (_, i) => {
      const m = (i - FLAG_MIN) * 24 * 60 + 5; // one delivery per day going back; some outside the window
      return [start(m), deliver(m + 1), end(m + 2, { model: "m/one" })];
    }).flat();
    expect(view(spread).flags).toEqual([]); // only 6 of the 10 fall inside the window
  });

  it("lists model flags before session flags", () => {
    const out = view([...sessionTurns("a1", FLAG_MIN, { ideas: true, model: "m/one" }), ...sessionTurns("b1", FLAG_MIN, { ideas: true, model: "m/two" })]);
    expect(out.flags.map((f) => f.kind)).toEqual(["model", "model", "session", "session"]);
  });
});

describe("flow log entries", () => {
  it("keep what the counters need", () => {
    const e = flowEntry({
      id: "x",
      at: at(0),
      taskId: "t1",
      actor: "agent",
      action: "next_moves_suggested",
      agentId: "a1",
      note: "A · B",
      moves: [{ label: "A", prompt: "a" }, { label: "B", moveTo: "done" }],
    } as never);
    expect(e).toMatchObject({ offered: 2, offersDone: true });
    expect(JSON.stringify(e)).not.toContain("prompt");
    const ended = flowEntry({ id: "y", at: at(1), taskId: "t1", actor: "system", action: "agent.turn_ended", agentId: "a1", outcome: "completed", model: "m/one", pick: 0 } as never);
    expect(ended).toMatchObject({ model: "m/one", pick: 0 });
    const none = flowEntry({ id: "z", at: at(1), taskId: "t1", actor: "system", action: "agent.turn_ended", agentId: "a1", pick: -1 } as never);
    expect(none.pick).toBe(-1);
  });

  it("keep an explicit none as offered 0", () => {
    const e = flowEntry({ id: "x", at: at(0), taskId: "t1", actor: "agent", action: "next_moves_suggested", agentId: "a1", moves: [] } as never);
    expect(e.offered).toBe(0);
    expect(e.offersDone).toBeUndefined();
  });

  it("stay as they were for events without the new fields", () => {
    const e = flowEntry({ id: "x", at: at(0), taskId: "t1", actor: "system", action: "agent.turn_started", agentId: "a1" });
    expect(e).toEqual({ id: "x", at: at(0), taskId: "t1", actor: "system", action: "agent.turn_started", agentId: "a1" });
  });
});

describe("startedByUser (INSIGHTS-REDESIGN-SPEC §7.1)", () => {
  it("is true for a real message, false for injections only, undefined without a timeline", () => {
    expect(startedByUser([{ type: "user_message", text: "Fix the bug" }, { type: "assistant_message", text: "ok" }])).toBe(true);
    expect(startedByUser([{ type: "user_message", text: "  <task-notification>done</task-notification>" }, { type: "user_message", text: "<system-reminder>x" }])).toBe(false);
    expect(startedByUser([{ type: "user_message", text: "<task-notification>x" }, { type: "user_message", text: "and also this" }])).toBe(true);
    expect(startedByUser([{ type: "assistant_message", text: "hi" }])).toBe(false);
    expect(startedByUser([])).toBe(false);
    expect(startedByUser(undefined)).toBeUndefined();
  });
  it("keeps byUser (false too) and tool in the flow log", () => {
    const ended = flowEntry({ id: "b", at: at(1), taskId: "t1", actor: "system", action: "agent.turn_ended", agentId: "a1", byUser: false } as never);
    expect(ended.byUser).toBe(false);
    const asked = flowEntry({ id: "c", at: at(1), taskId: "t1", actor: "system", action: "agent.permission_requested", agentId: "a1", tool: "Bash" } as never);
    expect(asked.tool).toBe("Bash");
  });
});

describe("userTexts", () => {
  it("takes the text of the turn's user messages and nothing else", () => {
    const items = [
      { type: "user_message", text: "first" },
      { type: "assistant_message", text: "hello" },
      { type: "tool_call", name: "Bash" },
      { type: "user_message", text: "   " },
      { type: "user_message", text: 42 },
      { type: "user_message", text: "second" },
    ];
    expect(userTexts(items)).toEqual(["first", "second"]);
    expect(userTexts([])).toEqual([]);
  });
});

describe("withMoveDetails", () => {
  const board = [
    { id: "m1", taskId: "t1", actor: "agent", action: "next_moves_suggested", at: at(1), moves: [{ label: "A", prompt: "a" }, { label: "Done", moveTo: "done" }] },
    { id: "m2", taskId: "t1", actor: "agent", action: "next_moves_suggested", at: at(2), moves: [{ label: "A", prompt: "a" }] },
  ] as BoardEvent[];

  it("fills the move counts of older flow entries from the board's events", () => {
    const old = [ev("next_moves_suggested", 1, { id: "m1" }), ev("next_moves_suggested", 2, { id: "m2" })];
    const out = withMoveDetails(old, board);
    expect(out[0]).toMatchObject({ offered: 2, offersDone: true });
    expect(out[1]).toMatchObject({ offered: 1 });
    expect(out[1].offersDone).toBeUndefined();
  });

  it("reads an empty list on the board as none", () => {
    const withNone = [{ id: "n1", taskId: "t1", actor: "agent", action: "next_moves_suggested", at: at(1), moves: [] }] as BoardEvent[];
    expect(withMoveDetails([ev("next_moves_suggested", 1, { id: "n1" })], withNone)[0].offered).toBe(0);
  });

  it("keeps entries that already have them, and entries the board no longer holds", () => {
    const known = ev("next_moves_suggested", 1, { id: "m1", offered: 3 });
    const gone = ev("next_moves_suggested", 3, { id: "deleted" });
    const out = withMoveDetails([known, gone, start(0)], board);
    expect(out[0].offered).toBe(3);
    expect(out[1].offered).toBeUndefined();
    expect(out[2].offered).toBeUndefined();
  });

  it("lets a Move to Done suggestion from an old entry count once the card is moved", () => {
    const old = [start(0), ev("next_moves_suggested", 1, { id: "m1" }), deliver(2), end(3), toDone(5)];
    expect(today(withMoveDetails(old, board))).toMatchObject({ offered: 1, picked: 1 });
    expect(today(old)).toMatchObject({ offered: 0, picked: 0 });
  });
});
