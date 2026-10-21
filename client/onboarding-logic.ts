/** Pure decisions for first-run guidance (ONBOARDING-SPEC). No React, no storage. */

export const welcomePageCount = 4;

/** Page index after a Back/Next step, kept inside the tour. */
export function stepPage(page: number, direction: 1 | -1): number {
  return Math.max(0, Math.min(welcomePageCount - 1, page + direction));
}

export type WelcomeDecision = "wait" | "show" | "mark-seen" | "none";

/**
 * What to do with the welcome tour once settings and the board are known.
 * Unknown state never shows it; a user who already has a project is marked
 * as seen without being interrupted; only an empty board gets the tour.
 */
export function welcomeDecision(input: {
  settingsStatus: string;
  welcomeSeen: boolean;
  boardLoaded: boolean;
  projectCount: number;
  /** Another dialog or an open card is in the way. */
  blocked: boolean;
}): WelcomeDecision {
  if (input.settingsStatus !== "ready" || !input.boardLoaded) return "wait";
  if (input.welcomeSeen) return "none";
  if (input.projectCount > 0) return "mark-seen";
  return input.blocked ? "wait" : "show";
}

export const tipIds = ["first-card", "needs-you", "first-idea", "first-done", "first-artifact", "first-tag", "agent-question", "older-finished", "next-move", "first-ticket", "jira-connect", "project-menu", "first-workpad", "subagents", "card-display", "first-workflow-insight", "attention-dismiss", "sidebar-order", "connectors", "session-history", "ai-language"] as const;
export type TipId = (typeof tipIds)[number];

export interface TipFacts {
  /** The current project has at least one card. */
  hasCard: boolean;
  /** Some card is waiting for the user (question, approval or error). */
  needsYou: boolean;
  /** The Ideas inbox has an open item and the feature is on. */
  openIdea: boolean;
  /** The user just moved a card into Done or Cancelled. */
  movedToFinished: boolean;
  /** A card of the current project has an artifact (CARD-ARTIFACTS-SPEC). */
  hasArtifact: boolean;
  /** A card of the current project has a tag an agent added (CARD-TAGS-SPEC §6.5). */
  hasAgentTag: boolean;
  /** A session of the current project is waiting on an agent question (SESSION-QUESTION-SPEC). */
  agentQuestion: boolean;
  /** Old Done/Cancelled cards are folded under "Show older" in the current project. */
  olderHidden: boolean;
  /** A session of the current project suggested next steps for this turn (NEXT-MOVES-SPEC). */
  nextMove: boolean;
  /** A card of the current project has an external input (EXTERNAL-TRACKER-SPEC, CONNECTORS-SPEC). */
  hasTicket: boolean;
  /** The current project has cards and no connection is configured (known, not loading). */
  noConnection: boolean;
  /** A card's sidebar is open, so its Artifacts + is in view (CONNECTORS-SPEC §8.5). */
  cardOpen: boolean;
  /** Desktop project tabs show two or more projects and no card is open (PROJECT-TABS-SPEC). */
  projectTabs: boolean;
  /** A card of the current project has a workpad (WORKPAD-SPEC §8). */
  hasWorkpad: boolean;
  /** A session of the current project has a live Paseo child agent (SUBAGENTS-SPEC §7). */
  hasSubagent: boolean;
  /** The current project has 6 or more active cards and no card is open (CARD-DISPLAY-SPEC §5). */
  busyBoard: boolean;
  /** Workflow insights has an open suggestion for the current project (WORKFLOW-INSIGHTS-SPEC §8). */
  workflowSuggestion: boolean;
  /** Three or more cards are in Attention, none of them dismissed yet (ATTENTION-DISMISS-SPEC §6). */
  crowdedAttention: boolean;
  /** A card's sidebar is open and shows at least one artifact or idea, so it has several sections (DRAWER-SPEC, Section order). */
  fullSidebar: boolean;
  /** A card's sidebar is open and the card has a session, so its session output is one tap away (SESSION-PANE-SPEC §1). */
  cardWithSession: boolean;
  /** A card of the current project has an AI progress summary, so AI-written text is in view (AI-LANGUAGE-SPEC §7). */
  hasSummary: boolean;
}

const tipFact: Record<TipId, keyof TipFacts> = {
  "first-card": "hasCard",
  "needs-you": "needsYou",
  "first-idea": "openIdea",
  "first-done": "movedToFinished",
  "first-artifact": "hasArtifact",
  "first-tag": "hasAgentTag",
  "agent-question": "agentQuestion",
  "older-finished": "olderHidden",
  "next-move": "nextMove",
  "first-ticket": "hasTicket",
  "jira-connect": "noConnection",
  "project-menu": "projectTabs",
  "first-workpad": "hasWorkpad",
  subagents: "hasSubagent",
  "card-display": "busyBoard",
  "first-workflow-insight": "workflowSuggestion",
  "attention-dismiss": "crowdedAttention",
  "sidebar-order": "fullSidebar",
  connectors: "cardOpen",
  "session-history": "cardWithSession",
  "ai-language": "hasSummary",
};

/** The one tip to show now: first in priority order whose fact holds and that was not shown before. */
export function nextTip(input: { tipsSeen: readonly string[]; facts: TipFacts; blocked: boolean }): TipId | null {
  if (input.blocked) return null;
  // Waiting for the user outranks introductions; the answer-in-session tip is the more specific one.
  const order: TipId[] = ["agent-question", "needs-you", "attention-dismiss", "first-done", "older-finished", "next-move", "first-workpad", "subagents", "first-idea", "first-workflow-insight", "ai-language", "first-artifact", "first-ticket", "first-tag", "first-card", "card-display", "connectors", "session-history", "sidebar-order", "project-menu", "jira-connect"];
  return order.find((id) => input.facts[tipFact[id]] && !input.tipsSeen.includes(id)) ?? null;
}

/**
 * The setting's bound. Far above the number of tips: when the list was capped
 * at 20 with 20 tips, each new tip pushed out the oldest, which then showed again.
 */
export const TIPS_SEEN_MAX = 100;

/** Stored tips with `id` added once (bounded like the setting). */
export function withTipSeen(tipsSeen: readonly string[], id: string): string[] {
  return tipsSeen.includes(id) ? [...tipsSeen] : [...tipsSeen, id].slice(-TIPS_SEEN_MAX);
}
