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
/** One answered question call: what the user answered to each title, and the message Paseo sent for it. */
export type AnsweredQuestions = { callId: string; message: string; pairs: { ask: string; text: string }[] };

const callIdOf = (requestId: string) => (requestId.startsWith(PERMISSION_PREFIX) ? requestId.slice(PERMISSION_PREFIX.length) : requestId);

/** The answers message Paseo's CodexAsyncQuestions sends for these titles and answers. */
export function codexAnswersMessage(pairs: readonly { ask: string; text: string }[]): string {
  return `${CODEX_ANSWERS_PREFIX}\n\n${pairs.map((p) => `${p.ask}\n${p.text}`).join("\n\n")}`;
}

export class AsyncQuestionTitles {
  /** Asked and not yet answered: session → call id → titles. */
  private readonly pending = new Map<string, Map<string, string[]>>();
  /** Answered: session → call id → answers, oldest first. */
  private readonly answered = new Map<string, Map<string, AnsweredQuestions>>();

  /** Keeps the titles of a Codex async question request; anything else is ignored. */
  remember(agentId: string, request: Request): void {
    if (request.name !== "request_user_input_async" || request.kind !== "question" || typeof request.id !== "string") return;
    const callId = callIdOf(request.id);
    const questions = (request.input as { questions?: unknown } | undefined)?.questions;
    if (!callId || !Array.isArray(questions) || !questions.length) return;
    const titles: string[] = [];
    for (const q of questions) {
      const title = typeof (q as { question?: unknown })?.question === "string" ? (q as { question: string }).question.trim() : "";
      if (!title || title.length > asyncQuestionLimits.title) return;
      titles.push(title);
    }
    put(this.pending, agentId, callId, titles);
  }

  /** Pairs the answers of the request that was actually answered with its titles; a dismissal drops the request. */
  resolved(agentId: string, requestId: string, resolution: Resolution): void {
    const callId = callIdOf(requestId);
    const titles = this.pending.get(agentId)?.get(callId);
    if (!titles) return;
    this.pending.get(agentId)!.delete(callId);
    const answers = resolution.behavior === "allow" ? (resolution.updatedInput as { answers?: unknown } | undefined)?.answers : undefined;
    if (!answers || typeof answers !== "object") return;
    // Paseo reads the answers as "Question <n>" and trims them (CodexAsyncQuestions.prepareResponse).
    const pairs: { ask: string; text: string }[] = [];
    for (const [i, ask] of titles.entries()) {
      const value = (answers as Record<string, unknown>)[`Question ${i + 1}`];
      const text = typeof value === "string" ? value.trim() : "";
      if (!text) return;
      pairs.push({ ask, text });
    }
    put(this.answered, agentId, callId, { callId, message: codexAnswersMessage(pairs), pairs });
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
