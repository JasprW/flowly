/**
 * Codex async questions (`request_user_input_async`) as they were asked and answered, by session and call id
 * (GUARDRAILS-SPEC E2, AUTO-REVIEW-SPEC §4.2). Paseo's timeline keeps these questions and their answers only as plain
 * text, so the auto review takes them from the permission hooks: the titles from the request each question raises
 * (`agent.permission.before`), the answers from its resolution (`agent.permission.after`, the request that was actually
 * answered). Held in memory only and never written: after a plugin reload or daemon restart they are gone and the
 * answers message stays whole.
 */
import { CODEX_ANSWERS_PREFIX } from "../shared/memory";

export const asyncQuestionLimits = { sessions: 200, perSession: 20, title: 500 } as const;

const PERMISSION_PREFIX = "permission-";

type Request = { id?: unknown; name?: unknown; kind?: unknown; input?: unknown };
type Resolution = { behavior?: unknown; updatedInput?: unknown };
/**
 * The session's timeline epoch read when the question was asked, and when that read finished (ms since epoch). A rewind
 * gives the timeline a new epoch and an epoch never comes back, so the same one read later means no rewind since `at`
 * (§4.2 ⑥).
 */
export type AskedEpoch = { epoch: string; at: number };
/**
 * One answered question call: what the user answered to each title, the message Paseo sent for it, when the hook saw the
 * answer (ms since epoch; Paseo sends the message at the same moment, §4.2 ⑤), and the epoch read when it was asked, if
 * that read finished before the answer (§4.2 ⑥).
 */
export type AnsweredQuestions = { callId: string; message: string; pairs: { ask: string; text: string }[]; answeredAt: number; asked: AskedEpoch | null };
/**
 * What the hooks know of one session's question calls: the answered ones, newest first, and whether a call's outcome is
 * known at all (asked since the plugin started and still held: open, answered, or closed without an answer). A call it
 * does not know (asked before a reload, titles too long to keep, dropped by the limits) may have sent any message.
 */
export type SessionQuestions = { answered: readonly AnsweredQuestions[]; known: (callId: string) => boolean };

const callIdOf = (requestId: string) => (requestId.startsWith(PERMISSION_PREFIX) ? requestId.slice(PERMISSION_PREFIX.length) : requestId);

/** The answers message Paseo's CodexAsyncQuestions sends for these titles and answers. */
export function codexAnswersMessage(pairs: readonly { ask: string; text: string }[]): string {
  return `${CODEX_ANSWERS_PREFIX}\n\n${pairs.map((p) => `${p.ask}\n${p.text}`).join("\n\n")}`;
}

export class AsyncQuestionTitles {
  /** Asked and not yet answered: session → call id → titles, and the epoch read when asked. */
  private readonly pending = new Map<string, Map<string, { titles: string[]; asked: AskedEpoch | null }>>();
  /** Answered: session → call id → answers, oldest first. */
  private readonly answered = new Map<string, Map<string, AnsweredQuestions>>();
  /** Closed without an answer (dismissed, interrupted, removed by a rewind while open): session → call id. */
  private readonly closed = new Map<string, Map<string, true>>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Keeps the titles of a Codex async question request; anything else is ignored. True when it was kept. */
  remember(agentId: string, request: Request): boolean {
    if (request.name !== "request_user_input_async" || request.kind !== "question" || typeof request.id !== "string") return false;
    const callId = callIdOf(request.id);
    const questions = (request.input as { questions?: unknown } | undefined)?.questions;
    if (!callId || !Array.isArray(questions) || !questions.length) return false;
    const titles: string[] = [];
    for (const q of questions) {
      const title = typeof (q as { question?: unknown })?.question === "string" ? (q as { question: string }).question.trim() : "";
      if (!title || title.length > asyncQuestionLimits.title) return false;
      titles.push(title);
    }
    put(this.pending, agentId, callId, { titles, asked: null });
    return true;
  }

  /**
   * The session's timeline epoch, read after the question was asked (§4.2 ⑥). Kept only while the question is still
   * open, so the read finished before the answer; the first one counts.
   */
  askedIn(agentId: string, requestId: string, epoch: string): void {
    const open = this.pending.get(agentId)?.get(callIdOf(requestId));
    if (open && !open.asked && epoch) open.asked = { epoch, at: this.now() };
  }

  /**
   * Pairs the answers of the request that was actually answered with its titles; a dismissal closes the request. True
   * when it was kept as answered.
   */
  resolved(agentId: string, requestId: string, resolution: Resolution): boolean {
    const callId = callIdOf(requestId);
    const open = this.pending.get(agentId)?.get(callId);
    if (!open) return false;
    this.pending.get(agentId)!.delete(callId);
    const { titles, asked } = open;
    const answers = resolution.behavior === "allow" ? (resolution.updatedInput as { answers?: unknown } | undefined)?.answers : undefined;
    const pairs: { ask: string; text: string }[] = [];
    // Paseo reads the answers as "Question <n>" and trims them, and refuses a missing one (CodexAsyncQuestions.prepareResponse).
    for (const [i, ask] of titles.entries()) {
      const value = answers && typeof answers === "object" ? (answers as Record<string, unknown>)[`Question ${i + 1}`] : undefined;
      const text = typeof value === "string" ? value.trim() : "";
      if (!text) {
        put(this.closed, agentId, callId, true);
        return false;
      }
      pairs.push({ ask, text });
    }
    put(this.answered, agentId, callId, { callId, message: codexAnswersMessage(pairs), pairs, answeredAt: this.now(), asked });
    return true;
  }

  /** The session's calls as the auto review pairs them (§4.2). */
  session(agentId: string): SessionQuestions {
    return {
      answered: this.answers(agentId),
      known: (callId) => [this.pending, this.answered, this.closed].some((store) => store.get(agentId)?.has(callId) ?? false),
    };
  }

  /** The session's answered question calls, newest first. */
  answers(agentId: string): AnsweredQuestions[] {
    return [...(this.answered.get(agentId)?.values() ?? [])].reverse();
  }
}

function put<T>(store: Map<string, Map<string, T>>, agentId: string, callId: string, value: T): void {
  let session = store.get(agentId);
  if (session) store.delete(agentId);
  else session = new Map();
  store.set(agentId, session);
  session.delete(callId);
  session.set(callId, value);
  while (session.size > asyncQuestionLimits.perSession) session.delete(session.keys().next().value!);
  while (store.size > asyncQuestionLimits.sessions) store.delete(store.keys().next().value!);
}
