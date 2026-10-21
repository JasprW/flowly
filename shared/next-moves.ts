import type { BoardEvent, NextMove } from "./model";

/** The event an agent's flowly_suggest_next_moves records (NEXT-MOVES-SPEC §2). */
export const nextMovesAction = "next_moves_suggested";

/** The note stored with an empty suggestion, the agent's explicit "nothing for the user this turn" (NEXT-MOVES-SPEC §8.3). */
export const noMovesNote = "No next steps needed";

export type NextMovesEvent = BoardEvent & { moves: NextMove[] };

/** An explicit none (NEXT-MOVES-SPEC §8.5): a suggestion event whose list is empty, not one that has no list. */
export function isNoMoves(e: BoardEvent) {
  return e.action === nextMovesAction && Array.isArray(e.moves) && e.moves.length === 0;
}

/**
 * The session's suggested next messages for this turn (NEXT-MOVES-SPEC §3): its
 * latest suggestion, unless a turn of that session started after it.
 */
export function openNextMoves(events: readonly BoardEvent[], agentId: string): NextMovesEvent | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.agentId !== agentId) continue;
    if (e.action === "agent.turn_started") return null;
    if (e.action === nextMovesAction) return e.moves?.length ? (e as NextMovesEvent) : null;
  }
  return null;
}

/**
 * The session has not yet decided its next moves in the current turn on this card (NEXT-MOVES-SPEC §9.3): no
 * suggestion event of its own, an explicit none included, since its latest `agent.turn_started`. Events of other
 * cards and sessions are skipped, since the board holds all of them. Without a turn start (the lifecycle events
 * are missing) the retained history is one turn, which can only silence a reminder, never add one.
 */
export function needsNextMoves(events: readonly BoardEvent[], taskId: string, agentId: string) {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.taskId !== taskId || e.agentId !== agentId) continue;
    if (e.action === "agent.turn_started") return true;
    if (e.action === nextMovesAction) return false;
  }
  return true;
}

/** The moves to show: action moves (NEXT-MOVES-SPEC §7) go once the card is Done/Cancelled. */
export function shownMoves(moves: readonly NextMove[], cardFinished: boolean) {
  return cardFinished ? moves.filter((m) => !m.moveTo) : moves;
}

/** Composer text after picking a move: the prompt, after anything already typed (NEXT-MOVES-SPEC §4). */
export function nextMoveDraft(prompt: string, typed: string) {
  return typed.trim() ? `${typed.replace(/\s+$/, "")}\n\n${prompt}` : prompt;
}

/** Some session of the card has suggestions for this turn (the `next-move` tip, ONBOARDING-SPEC §5). */
export function hasOpenNextMoves(events: readonly BoardEvent[]) {
  const agents = new Set(events.filter((e) => e.action === nextMovesAction && e.agentId).map((e) => e.agentId!));
  return [...agents].some((agentId) => !!openNextMoves(events, agentId));
}

/**
 * The Next chip in Paseo's session view (NATIVE-SESSION-SPEC §6.1): the same
 * rules as Flowly's suggestion row. The session is idle, nothing waits for an
 * answer, the user has not written since, and this set was not hidden here.
 */
export function chipMoves(input: {
  events: readonly BoardEvent[];
  agent: {
    id: string;
    status: string;
    pendingPermissions?: readonly unknown[] | null;
    attentionReason?: string | null;
    lastUserMessageAt?: string | null;
    archivedAt?: string | null;
  };
  cardFinished: boolean;
  hidden: (eventId: string) => boolean;
}): { eventId: string; moves: NextMove[] } | null {
  const { agent } = input;
  if (agent.archivedAt || agent.status === "running" || agent.status === "initializing") return null;
  if (agent.pendingPermissions?.length || agent.attentionReason === "permission") return null;
  const suggestion = openNextMoves(input.events, agent.id);
  if (!suggestion || input.hidden(suggestion.id)) return null;
  if (agent.lastUserMessageAt && Date.parse(agent.lastUserMessageAt) > Date.parse(suggestion.at)) return null;
  const moves = shownMoves(suggestion.moves, input.cardFinished);
  return moves.length ? { eventId: suggestion.id, moves: [...moves] } : null;
}

/**
 * The Next moves card of a session Flowly does not manage (NATIVE-SESSION-SPEC §12.4): its stored suggestion, under the
 * same rules as `chipMoves` (idle, nothing waiting, no newer message from the person, not hidden here).
 */
export function sessionChipMoves(input: {
  suggestion: { id: string; at: string; moves: NextMove[]; current: boolean } | null;
  agent: Parameters<typeof chipMoves>[0]["agent"];
  hidden: (eventId: string) => boolean;
}): { eventId: string; moves: NextMove[] } | null {
  const { agent, suggestion } = input;
  if (!suggestion?.current || !suggestion.moves.length || input.hidden(suggestion.id)) return null;
  if (agent.archivedAt || agent.status === "running" || agent.status === "initializing") return null;
  if (agent.pendingPermissions?.length || agent.attentionReason === "permission") return null;
  if (agent.lastUserMessageAt && Date.parse(agent.lastUserMessageAt) > Date.parse(suggestion.at)) return null;
  return { eventId: suggestion.id, moves: [...suggestion.moves] };
}
