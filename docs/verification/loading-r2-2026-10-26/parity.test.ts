// LOADING-R2-SPEC §4.1: on a copy of real data, the overview facts every layout now uses must give the
// same card results as the old whole-board derivations. Run: FLOWLY_PARITY_BOARD=<copy of board.json> npx vitest run docs/verification/loading-r2-2026-10-26
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { storageSchema } from "../../../shared/model";
import { upgradeBoard } from "../../../server/migrate";
import { boardOverview } from "../../../server/board-overview";
import { olderFinished, olderFinishedFromDates } from "../../../client/finished-cards";
import { latestTurnEnds } from "../../../shared/sort";
import { sessionAttentionSummary, sessionAttentionSummaryFromTurns, type AttentionAgent } from "../../../shared/session-attention";
import { allAttentionFromSources, attentionItemsWithFacts } from "../../../shared/attention";
import { cardQuestions } from "../../../shared/progress";
import { workpadSignal } from "../../../shared/workpad";
import { currentWrapup } from "../../../shared/wrapup-state";
import { hasOpenNextMoves } from "../../../shared/next-moves";
import { faceKey, familyOf } from "../../../shared/connectors";

const file = process.env.FLOWLY_PARITY_BOARD;

test.skipIf(!file)("overview facts match the whole-board derivations card by card", () => {
  const board = storageSchema.parse(upgradeBoard(JSON.parse(readFileSync(file!, "utf8"))));
  const view = boardOverview(board);
  const facts = new Map(view.cards.map(c => [c.taskId, c]));
  // Every session that ever wrote an event, bound to its card's workspace, in every attention state.
  const kinds: Partial<AttentionAgent>[] = [
    { status: "idle", requiresAttention: true, attentionReason: "finished" },
    { status: "idle" },
    { status: "running" },
    { status: "error", requiresAttention: true, attentionReason: "error" },
    { status: "idle", requiresAttention: true, attentionReason: "permission", pendingPermissions: [{}] },
  ];
  const seen = new Set<string>();
  const sessionsIn = (shift: number) => { seen.clear(); return board.events.flatMap(e => {
    const task = board.tasks.find(t => t.id === e.taskId);
    if (!e.agentId || !task || seen.has(e.agentId)) return [];
    seen.add(e.agentId);
    const kind = kinds[(seen.size + shift) % kinds.length];
    return [{ id: e.agentId, workspaceId: task.workspaceId, updatedAt: e.at, attentionTimestamp: kind.requiresAttention ? e.at : null, ...kind } as AttentionAgent & { updatedAt: string }];
  }); };
  const agents = sessionsIn(0);
  // Half the sessions already read, at their attention time.
  const receipts = agents.filter((_, i) => i % 2).flatMap(a => {
    const task = board.tasks.find(t => t.workspaceId === a.workspaceId);
    return task ? [{ taskId: task.id, agentId: a.id, readAt: a.updatedAt, token: a.attentionTimestamp || undefined }] : [];
  }) as never[];
  const byTask = new Map<string, typeof board.events>();
  for (const e of board.events) byTask.set(e.taskId, [...(byTask.get(e.taskId) || []), e]);
  const turnFacts = (taskId: string) => new Map((facts.get(taskId)?.sessions || []).map(s => [s.agentId, s]));

  // Card face facts, each as the old wide board derived it from the whole board (client/board.tsx before a5a4d9f).
  const workpads = new Map(board.workpads.map(w => [w.taskId, w]));
  const keys = new Map<string, { key: string; family: ReturnType<typeof familyOf> }[]>();
  for (const a of board.artifacts) {
    const key = a.external ? faceKey(a.external) : null;
    if (key) keys.set(a.taskId, [...(keys.get(a.taskId) || []), { key, family: familyOf(a.external!.provider) }]);
  }
  const varied = { questions: 0, workpad: 0, wrapped: 0, external: 0, nextMoves: 0, ideas: 0 };
  for (const task of board.tasks) {
    const own = byTask.get(task.id) || [], card = facts.get(task.id)!, list = keys.get(task.id);
    const old = {
      questions: cardQuestions(task, own).length,
      workpad: workpadSignal(task, workpads.get(task.id), own),
      wrapped: !!currentWrapup(own, task.id),
      external: list ? { text: list.length > 1 ? `${list[0].key} +${list.length - 1}` : list[0].key, family: list[0].family } : undefined,
      hasArtifacts: board.artifacts.some(a => a.taskId === task.id),
      hasExternal: board.artifacts.some(a => a.taskId === task.id && !!a.external),
      hasWorkpad: workpads.has(task.id),
      hasNextMoves: hasOpenNextMoves(own),
      openIdeas: board.ideas.filter(i => i.taskId === task.id && i.status === "open").length,
    };
    const now = { questions: card.questions, workpad: card.workpad, wrapped: card.wrapped, external: card.external, hasArtifacts: card.hasArtifacts, hasExternal: card.hasExternal, hasWorkpad: card.hasWorkpad, hasNextMoves: card.hasNextMoves, openIdeas: card.openIdeas };
    expect(now, task.id).toEqual(old);
    varied.questions += +!!old.questions; varied.workpad += +!!old.workpad; varied.wrapped += +old.wrapped;
    varied.external += +!!old.external; varied.nextMoves += +old.hasNextMoves; varied.ideas += +!!old.openIdeas;
  }
  // The data must exercise each fact, or the comparison proves nothing for it.
  for (const [name, n] of Object.entries(varied)) expect(n, name).toBeGreaterThan(0);

  let compared = 0;
  const oldTurns = latestTurnEnds(board.events);
  const newTurns = {
    byTask: new Map(view.cards.flatMap(c => c.turnEndedAt ? [[c.taskId, c.turnEndedAt] as const] : [])),
    agents: new Set(view.cards.flatMap(c => c.sessions.filter(s => s.hadTurnEnd).map(s => s.agentId))),
  };
  expect([...newTurns.byTask].sort()).toEqual([...oldTurns.byTask].filter(([id]) => facts.has(id)).sort());
  expect([...newTurns.agents].sort()).toEqual([...oldTurns.agents].filter(id => board.events.some(e => e.agentId === id && facts.has(e.taskId))).sort());

  for (const project of board.projects) {
    const tasks = board.tasks.filter(t => t.projectId === project.id);
    // Every cutoff from 6 hours to 30 days back from the newest event, so re-entered lanes straddle one.
    const now = Date.parse(board.events.map(e => e.at).sort().at(-1)!);
    for (let days = 0.25; days <= 30; days += 0.25) {
      expect([...olderFinishedFromDates(tasks, new Map(view.cards.map(c => [c.taskId, c.finishedAt])), days, now)].sort())
        .toEqual([...olderFinished(tasks, board.events, days, now)].sort());
    }
  }
  // Each session takes every attention state once.
  for (let shift = 0; shift < kinds.length; shift++) {
    const agents = sessionsIn(shift);
    for (const task of board.tasks) {
      const sessions = agents.filter(a => a.workspaceId === task.workspaceId);
      expect(sessionAttentionSummaryFromTurns(sessions, task, receipts, turnFacts(task.id)), task.id)
        .toEqual(sessionAttentionSummary(sessions, task, receipts, byTask.get(task.id) || []));
      compared++;
    }
    for (const readUnavailable of [false, true]) {
      const before = allAttentionFromSources({ board, agents, receipts, readUnavailable });
      const after = attentionItemsWithFacts(view, agents, receipts, readUnavailable, (task, agentId) => turnFacts(task.id).get(agentId));
      expect(after).toEqual(before);
      expect(after.length).toBeGreaterThan(0);
    }
  }
  expect(compared).toBe(board.tasks.length * kinds.length);
  console.log(JSON.stringify({ cards: board.tasks.length, events: board.events.length, sessions: agents.length, attention: allAttentionFromSources({ board, agents, receipts, readUnavailable: false })!.length, varied }));
});
