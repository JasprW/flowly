/**
 * The titles of Codex async questions (`request_user_input_async`) as they were asked, by session and call id
 * (GUARDRAILS-SPEC E2, AUTO-REVIEW-SPEC §4.2). Paseo's timeline keeps these questions only as plain text, so the auto
 * review reads them from the permission request each one raises (`agent.permission.before`). Held in memory only and
 * never written: after a plugin reload or daemon restart the titles are gone and the answers message stays whole.
 */
export const asyncQuestionLimits = { sessions: 200, perSession: 20, title: 500 } as const;

const PERMISSION_PREFIX = "permission-";

type Request = { id?: unknown; name?: unknown; kind?: unknown; input?: unknown };

export class AsyncQuestionTitles {
  private readonly bySession = new Map<string, Map<string, string[]>>();

  /** Keeps the titles of a Codex async question request; anything else is ignored. */
  remember(agentId: string, request: Request): void {
    if (request.name !== "request_user_input_async" || request.kind !== "question" || typeof request.id !== "string") return;
    const callId = request.id.startsWith(PERMISSION_PREFIX) ? request.id.slice(PERMISSION_PREFIX.length) : request.id;
    const questions = (request.input as { questions?: unknown } | undefined)?.questions;
    if (!callId || !Array.isArray(questions) || !questions.length) return;
    const titles: string[] = [];
    for (const q of questions) {
      const title = typeof (q as { question?: unknown })?.question === "string" ? ((q as { question: string }).question).trim() : "";
      if (!title || title.length > asyncQuestionLimits.title) return;
      titles.push(title);
    }
    let session = this.bySession.get(agentId);
    if (session) this.bySession.delete(agentId);
    else session = new Map();
    this.bySession.set(agentId, session);
    session.delete(callId);
    session.set(callId, titles);
    while (session.size > asyncQuestionLimits.perSession) session.delete(session.keys().next().value!);
    while (this.bySession.size > asyncQuestionLimits.sessions) this.bySession.delete(this.bySession.keys().next().value!);
  }

  /** The session's questions, newest first, as [callId, titles]. */
  asked(agentId: string): [string, readonly string[]][] {
    return [...(this.bySession.get(agentId) ?? new Map<string, string[]>())].reverse();
  }
}
