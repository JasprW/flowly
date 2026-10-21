import { z } from "zod";
import { nextMoveLimits } from "./model";
import { ideaInstruction } from "./ideas";
import { DESCRIPTION_LIMIT, FIELD_LIMIT, firstObject, targetText } from "./summary";

/**
 * Progress, suggested next steps and ideas for Paseo sessions Flowly does not manage (NATIVE-SESSION-SPEC §12): kept
 * per session in `session-insights.json`, never under a project or card.
 */
export const SESSION_IDEAS_MAX = 20;
export const SESSION_OPEN_IDEAS_MAX = 5;
export const SESSION_INSIGHTS_MAX = 300;
export const IDEAS_PER_RUN = 2;

export type InsightParts = { progress: boolean; nextMoves: boolean; ideas: boolean };

const str = (max: number) => z.string().max(max);
export const sessionIdeaSchema = z.object({
  id: z.string(),
  title: str(120),
  detail: str(FIELD_LIMIT),
  rationale: str(1000),
  scope: z.enum(["here", "new"]),
  status: z.enum(["open", "dismissed", "adopted"]),
  adopted: z
    .object({ target: z.enum(["here", "session", "workspace"]), agentId: z.string().optional(), workspaceId: z.string().optional() })
    .optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SessionIdea = z.infer<typeof sessionIdeaSchema>;

export const sessionMoveSchema = z.object({ label: str(nextMoveLimits.label).min(1), prompt: str(nextMoveLimits.prompt).min(1) });
export const sessionSuggestionSchema = z.object({
  id: z.string(),
  at: z.string(),
  moves: z.array(sessionMoveSchema).min(1).max(nextMoveLimits.count),
  /** False once the session's next turn started. */
  current: z.boolean(),
});
export type SessionSuggestion = z.infer<typeof sessionSuggestionSchema>;

export const sessionSummarySchema = z.object({
  id: z.string(),
  at: z.string(),
  model: z.string(),
  state: str(FIELD_LIMIT),
  target: str(FIELD_LIMIT),
  recap: str(FIELD_LIMIT),
  next: str(FIELD_LIMIT),
});
export type SessionSummary = z.infer<typeof sessionSummarySchema>;

export const sessionInsightSchema = z.object({
  agentId: z.string(),
  workspaceId: z.string(),
  title: z.string(),
  updatedAt: z.string(),
  summary: sessionSummarySchema.nullable(),
  suggestion: sessionSuggestionSchema.nullable(),
  ideas: z.array(sessionIdeaSchema),
  error: z.object({ at: z.string(), message: z.string().max(500) }).nullable(),
});
export type SessionInsight = z.infer<typeof sessionInsightSchema>;
export const sessionInsightsStateSchema = z.object({ version: z.literal(1), sessions: z.array(sessionInsightSchema) });
export type SessionInsightsState = z.infer<typeof sessionInsightsStateSchema>;
export const emptySessionInsights = (): SessionInsightsState => ({ version: 1, sessions: [] });

/** What the client's chip refresh reads: per session, the current suggestion and the open ideas. */
export const sessionInsightViewSchema = z.object({
  agentId: z.string(),
  workspaceId: z.string(),
  suggestion: sessionSuggestionSchema.nullable(),
  ideas: z.array(sessionIdeaSchema),
});
export type SessionInsightView = z.infer<typeof sessionInsightViewSchema>;

// Lenient like the card summarizer's output: small models quote booleans, return bullet arrays, or drop fields.
const text = z
  .union([z.string(), z.array(z.string())])
  .nullish()
  .transform((s) => (Array.isArray(s) ? s.map((line) => `- ${line.trim().replace(/^[-*•]\s*/, "")}`).join("\n") : s || "").trim())
  .refine((s) => s.length <= FIELD_LIMIT, "too long");
const progressOutput = z.object({
  update: z.union([z.boolean(), z.enum(["true", "false"]).transform((v) => v === "true")]).default(true),
  state: text,
  target: text.transform(targetText),
  recap: text,
  next: text,
});
const moveOutput = z.object({ label: z.string().trim().min(1).max(nextMoveLimits.label), prompt: z.string().trim().min(1).max(nextMoveLimits.prompt) });
const ideaOutput = z.object({
  title: z.string().trim().min(1).max(120),
  detail: z.string().trim().max(FIELD_LIMIT).default(""),
  rationale: z.string().trim().max(1000).default(""),
  scope: z.enum(["here", "new"]).catch("new").default("new"),
});
export type InsightOutput = {
  progress: z.infer<typeof progressOutput> | null;
  moves: z.infer<typeof moveOutput>[];
  ideas: z.infer<typeof ideaOutput>[];
};

/** Items that do not parse are dropped one by one: a bad idea never costs the run its progress. */
function items<T extends z.ZodType>(raw: unknown, schema: T, max: number): z.infer<T>[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const parsed = schema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  }).slice(0, max);
}

export function parseInsightOutput(textOut: string | null | undefined, parts: InsightParts): InsightOutput {
  const json = textOut ? firstObject(textOut) : null;
  if (!json) throw new Error("The insight model returned no JSON.");
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(json) as Record<string, unknown>;
  } catch {
    throw new Error("The insight model returned invalid JSON.");
  }
  let progress: InsightOutput["progress"] = null;
  if (parts.progress) {
    const parsed = progressOutput.safeParse(raw);
    if (parsed.success && (!parsed.data.update || parsed.data.state)) progress = parsed.data;
  }
  return {
    progress,
    moves: parts.nextMoves ? items(raw.moves, moveOutput, nextMoveLimits.count) : [],
    ideas: parts.ideas ? items(raw.ideas, ideaOutput, IDEAS_PER_RUN) : [],
  };
}

/** JSON Schema handed to the insight session: only the enabled parts. */
export function insightJsonSchema(parts: InsightParts) {
  const properties: Record<string, unknown> = {};
  if (parts.progress)
    Object.assign(properties, {
      update: { type: "boolean" },
      state: { type: "string" },
      target: { type: "string" },
      recap: { type: "string" },
      next: { type: "string" },
    });
  if (parts.nextMoves)
    properties.moves = {
      type: "array",
      maxItems: nextMoveLimits.count,
      items: { type: "object", additionalProperties: false, required: ["label", "prompt"], properties: { label: { type: "string" }, prompt: { type: "string" } } },
    };
  if (parts.ideas)
    properties.ideas = {
      type: "array",
      maxItems: IDEAS_PER_RUN,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "detail", "rationale", "scope"],
        properties: { title: { type: "string" }, detail: { type: "string" }, rationale: { type: "string" }, scope: { type: "string", enum: ["here", "new"] } },
      },
    };
  return { type: "object", additionalProperties: false, required: Object.keys(properties), properties };
}

const clip = (s: string, max: number) => (s.length > max ? s.slice(0, max - 1) + "…" : s);

export function insightPrompt(input: {
  title: string;
  cwd: string;
  previous: Pick<SessionSummary, "state" | "target" | "recap" | "next"> | null;
  transcript: string;
  openIdeas: readonly string[];
  openIdeaCount: number;
  parts: InsightParts;
}): string {
  const { parts } = input;
  const ideasFull = input.openIdeaCount >= SESSION_OPEN_IDEAS_MAX;
  return [
    "You help a person follow an AI coding agent's session. Read the latest conversation and answer only with the JSON object. Do not use any tools.",
    "",
    "Rules:",
    ...(parts.progress
      ? [
          '- "update": false when the conversation adds no real progress, decision or change of plan (greetings, thanks, idle questions). Otherwise true.',
          input.previous ? "- When updating, revise the current summary rather than starting over." : '- There is no summary yet, so "update" must be true.',
          '- "state": where the work stands now, one short phrase of at most 15 words (or 30 Chinese characters).',
          '- "target": what the person is trying to get done: first line the goal as a plain sentence with no label, then at most 4 "- " lines with the agreed points. Keep it stable; change it only when the goal changes.',
          '- "recap": the outcomes that matter so far: at most 4 "- " lines, each at most 15 words (or 30 Chinese characters); decisions and results, not routine steps.',
          '- "next": the single next step, or who is being waited on, in one sentence of at most 20 words (or 40 Chinese characters).',
          '- These values are single strings, never arrays.',
        ]
      : []),
    ...(parts.nextMoves
      ? [
          `- "moves": the 0-${nextMoveLimits.count} messages the person is most likely to send the agent next, most likely first. Each has a "label" (a short verb phrase, at most 60 characters) and a "prompt" (the full message, written as the person's instruction to the agent, understandable on its own). Use an empty list when there is no clear next step (for example the agent is waiting for an answer only the person knows).`,
        ]
      : []),
    ...(parts.ideas
      ? [
          ideasFull
            ? '- "ideas": always an empty list (the person already has enough open ideas).'
            : `- "ideas": 0-${IDEAS_PER_RUN} follow-ups worth doing that go beyond what the person is doing now (a bug noticed on the way, a refactor, a separate feature). Each has "title" (at most 120 characters), "detail" (what to do and how to tell it is done), "rationale" (why) and "scope" ("here" when it extends the current goal, else "new"). Most turns have none: only propose something clearly worth it, and never repeat an open idea below.`,
        ]
      : []),
    "- Write in the language the person uses in the conversation. Be concrete and terse.",
    "",
    `Session: ${clip(input.title || "(untitled)", 200)}`,
    `Working directory: ${clip(input.cwd, 300)}`,
    ...(parts.progress
      ? [
          "",
          input.previous
            ? `Current summary:\nState: ${input.previous.state}\nTarget: ${input.previous.target || "(not set yet)"}\nRecap: ${input.previous.recap}\nNext: ${input.previous.next}`
            : "Current summary: (none yet)",
        ]
      : []),
    ...(parts.ideas && input.openIdeas.length ? ["", "Open ideas:", ...input.openIdeas.map((t) => `- ${clip(t, 120)}`)] : []),
    "",
    "Latest conversation:",
    clip(input.transcript || "(empty)", DESCRIPTION_LIMIT * 6),
  ].join("\n");
}

/** The same instruction a card idea sends to a session (IDEAS-SPEC §6.2). */
export function sessionIdeaInstruction(idea: Pick<SessionIdea, "title" | "detail" | "rationale">): string {
  return ideaInstruction({ title: idea.title, detail: idea.detail, rationale: idea.rationale, context: "" });
}
