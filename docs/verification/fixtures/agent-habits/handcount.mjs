#!/usr/bin/env node
// Independent hand count for WORKFLOW-INSIGHTS-SPEC §12. It reads the project's flow log
// (the board keeps only the last 100 events per card, the flow log keeps all) and imports
// nothing from the plugin, so it checks the counters against a second implementation of
// the same definitions.
//
//   node handcount.mjs <flow.jsonl> <board.json | -> <YYYY-MM-DD> <IANA zone> [days=7]
//
// board.json is only used to learn which next-move sets offered "Move to Done" for entries
// the flow log wrote before it kept that fact (pass - to skip).
// Prints JSON: raw event counts per day, and per-turn counts per day and per session.
import { readFileSync } from "node:fs";

const [flowFile, boardFile, lastDay, zone = "UTC", daysArg = "7"] = process.argv.slice(2);
if (!flowFile || !boardFile || !lastDay) {
  console.error("usage: handcount.mjs <flow.jsonl> <board.json|-> <YYYY-MM-DD> <zone> [days]");
  process.exit(2);
}
const events = readFileSync(flowFile, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line))
  .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
if (boardFile !== "-") {
  const board = JSON.parse(readFileSync(boardFile, "utf8"));
  const moves = new Map(board.events.filter((e) => e.action === "next_moves_suggested").map((e) => [e.id, e.moves || []]));
  for (const e of events)
    if (e.action === "next_moves_suggested" && e.offered === undefined && moves.has(e.id)) {
      e.offered = moves.get(e.id).length;
      if (moves.get(e.id).some((m) => m.moveTo === "done")) e.offersDone = true;
    }
}

const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" });
const dayOf = (iso) => fmt.format(new Date(iso));
const days = Array.from({ length: Number(daysArg) }, (_, i) => {
  const d = new Date(`${lastDay}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (Number(daysArg) - 1 - i));
  return d.toISOString().slice(0, 10);
});

// ---- Raw events per day: what a person counts with a filter ------------------------------
const raw = Object.fromEntries(days.map((d) => [d, { nextMovesEvents: 0, ideaEvents: 0, inReviewByAgent: 0, resultReports: 0, questionReports: 0 }]));
for (const e of events) {
  const row = raw[dayOf(e.at)];
  if (!row) continue;
  if (e.action === "next_moves_suggested") row.nextMovesEvents++;
  if (e.action === "idea_proposed") row.ideaEvents++;
  if (e.actor === "agent" && e.action === "status_changed" && e.to === "in_review") row.inReviewByAgent++;
  if (e.actor === "agent" && e.reportKind === "result") row.resultReports++;
  if (e.actor === "agent" && e.reportKind === "question") row.questionReports++;
}

// ---- Turns: one pass per session; a turn runs from one turn_started to the next ----------------
const byAgent = new Map();
for (const e of events) if (e.agentId) (byAgent.get(e.agentId) ?? byAgent.set(e.agentId, []).get(e.agentId)).push(e);

const turns = [];
for (const [agentId, list] of byAgent) {
  let turn = null;
  const open = () => (turn = { agentId, taskId: list[0].taskId, last: list[0].at, delivered: false, result: false, question: false, moves: 0, ideas: 0, firstIndex: 0, doneSet: false, setAfter: null });
  for (const e of list) {
    if (e.action === "agent.turn_started") {
      open();
      turn.last = e.at;
      turns.push(turn);
      continue;
    }
    if (e.action === "agent.turn_ended") {
      if (!turn || turn.ended) {
        open();
        turns.push(turn);
      }
      turn.ended = true;
      turn.last = e.at;
      if (e.model) turn.model = e.model;
      continue;
    }
    if (e.actor !== "agent") continue;
    if (!turn) {
      open();
      turns.push(turn);
    }
    turn.last = e.at;
    if (e.action === "next_moves_suggested") {
      turn.moves++;
      turn.setAfter = e; // the latest call in the turn is the one the user sees
    }
    if (e.action === "idea_proposed") turn.ideas++;
    if (e.action === "status_changed" && e.to === "in_review") turn.delivered = true;
    if (e.reportKind === "result") turn.result = true;
    if (e.reportKind === "question") turn.question = true;
  }
}

for (const t of turns) {
  t.none = !!t.setAfter && t.setAfter.offered === 0; // an empty list is an explicit "none"
  t.suggested = !!t.setAfter && !t.none;
}

// Picked: a suggestion set is answered by the card going to Done (when the set offered Move to Done) or by
// the session's next turn, whose turn_ended carries `pick` (>= 0 taken, -1 answered with something else,
// absent unknown). Unanswered or unknown sets are left out.
for (const turn of turns) {
  if (!turn.suggested) continue;
  const list = byAgent.get(turn.agentId);
  const at = list.indexOf(turn.setAfter);
  const next = list.slice(at + 1).find((e) => e.action === "agent.turn_started");
  const limit = next ? Date.parse(next.at) : Infinity;
  const moved = events.some((e) => e.taskId === turn.taskId && e.actor === "human" && e.action === "status_changed" && e.to === "done" && Date.parse(e.at) > Date.parse(turn.setAfter.at) && Date.parse(e.at) < limit);
  if (turn.setAfter.offersDone && moved) {
    turn.offered = 1;
    turn.picked = 1;
    continue;
  }
  if (!next) continue;
  let ended = null;
  for (const e of list.slice(list.indexOf(next) + 1)) {
    if (e.action === "agent.turn_started") break;
    if (e.action === "agent.turn_ended") {
      ended = e;
      break;
    }
  }
  if (ended && typeof ended.pick === "number") {
    turn.offered = 1;
    turn.picked = ended.pick >= 0 ? 1 : 0;
  }
}

const blank = () => ({ deliveries: 0, results: 0, questions: 0, moves: 0, none: 0, movesAny: 0, ideas: 0, offered: 0, picked: 0 });
const add = (into, t) => {
  if (t.delivered) into.deliveries++;
  else if (t.result) into.results++;
  else if (t.question) into.questions++;
  if (t.suggested) {
    into.movesAny++;
    if (t.delivered || t.result) into.moves++;
  }
  if (t.none && (t.delivered || t.result)) into.none++;
  into.ideas += t.ideas;
  into.offered += t.offered || 0;
  into.picked += t.picked || 0;
};
const perDay = Object.fromEntries(days.map((d) => [d, blank()]));
const perSession = {};
const perModel = {};
for (const t of turns) {
  const d = dayOf(t.last);
  if (!perDay[d]) continue;
  add(perDay[d], t);
  add((perSession[t.agentId] ??= blank()), t);
  // A turn without a stamped model (everything before the stamp existed) is grouped as "history".
  add((perModel[t.model || "history"] ??= blank()), t);
}
const total = blank();
for (const d of days) for (const k of Object.keys(total)) total[k] += perDay[d][k];

console.log(JSON.stringify({ flowFile, zone, days, raw, perDay, perSession, perModel, total }, null, 2));
