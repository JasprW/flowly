import { z } from "zod";
import { firstObject } from "./summary";
import { outputLanguageRule } from "./ai-language";
import type { LocaleCode } from "./i18n";

/** A project's daily change digest, written by a cheap model (PROJECT-INSIGHTS-SPEC §7). */
export const DIGEST_DAYS = 60;
export const DIGEST_INPUT_LIMIT = 12000;
export const DIGEST_ITEMS = 5;
const ITEM_LIMIT = 1000;

export const digestItemSchema = z.object({ text: z.string().max(ITEM_LIMIT), taskId: z.string().optional() });
export type DigestItem = z.infer<typeof digestItemSchema>;
export const digestFields = z.object({
  headline: z.string().max(ITEM_LIMIT),
  done: z.array(digestItemSchema).max(DIGEST_ITEMS),
  progressed: z.array(digestItemSchema).max(DIGEST_ITEMS),
  issues: z.array(digestItemSchema).max(DIGEST_ITEMS),
  next: z.array(digestItemSchema).max(DIGEST_ITEMS),
});
export const digestEntrySchema = digestFields.extend({
  projectId: z.string(),
  day: z.string(),
  tz: z.string(),
  at: z.string(),
  model: z.string(),
});
export type DigestEntry = z.infer<typeof digestEntrySchema>;
export const digestErrorSchema = z.object({ projectId: z.string(), day: z.string(), at: z.string(), message: z.string().max(500) });
export const digestStateSchema = z.object({
  version: z.literal(1),
  entries: z.array(digestEntrySchema),
  errors: z.array(digestErrorSchema),
});
export type DigestState = z.infer<typeof digestStateSchema>;
export const emptyDigests = (): DigestState => ({ version: 1, entries: [], errors: [] });

export const digestViewSchema = z.object({
  entry: digestEntrySchema.nullable(),
  running: z.boolean(),
  error: digestErrorSchema.nullable(),
  enabled: z.boolean(),
  /** The day had no card, turn or commit activity: nothing to summarize. */
  empty: z.boolean(),
});
export type DigestView = z.infer<typeof digestViewSchema>;

const item = { type: "object", additionalProperties: false, required: ["text", "taskId"], properties: { text: { type: "string" }, taskId: { type: "string" } } };
const list = { type: "array", items: item };
export const digestJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "done", "progressed", "issues", "next"],
  properties: { headline: { type: "string" }, done: list, progressed: list, issues: list, next: list },
} as const;

/** Lenient: plain strings for items, "" task ids, unknown ids dropped, extra items cut. */
export function parseDigest(text: string | null | undefined, taskIds: ReadonlySet<string>): z.infer<typeof digestFields> {
  const json = text ? firstObject(text) : null;
  if (!json) throw new Error("The digest model returned no JSON.");
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error("The digest model returned invalid JSON.");
  }
  const items = (value: unknown): DigestItem[] => {
    if (!Array.isArray(value)) return [];
    return value
      .map((v): DigestItem | null => {
        if (typeof v === "string") return v.trim() ? { text: v.trim() } : null;
        if (!v || typeof v !== "object") return null;
        const o = v as Record<string, unknown>;
        const text = typeof o.text === "string" ? o.text.trim() : "";
        if (!text) return null;
        const id = typeof o.taskId === "string" && taskIds.has(o.taskId) ? o.taskId : undefined;
        return id ? { text, taskId: id } : { text };
      })
      .filter((v): v is DigestItem => !!v)
      .slice(0, DIGEST_ITEMS);
  };
  const out = {
    headline: typeof raw.headline === "string" ? raw.headline.trim() : "",
    done: items(raw.done),
    progressed: items(raw.progressed),
    issues: items(raw.issues),
    next: items(raw.next),
  };
  if (!out.headline) throw new Error("The digest model returned no headline.");
  const parsed = digestFields.safeParse(out);
  if (!parsed.success) throw new Error("The digest model's output was too long.");
  return parsed.data;
}

export function digestPrompt(input: { project: string; day: string; today: boolean; material: string; language: LocaleCode }): string {
  return [
    `You write a short daily digest of a software project managed on a Kanban board, where AI coding agents work on cards with one person.`,
    `Summarize ${input.today ? "today so far" : "the day"} (${input.day}) from the material below. Do not use any tools; answer only with the JSON object.`,
    "",
    "Rules:",
    '- "headline": one sentence: the most important outcome of the day.',
    '- "done": cards finished, with what they delivered. "progressed": cards that moved forward and where they stand. "issues": problems, rework, failures, open questions. "next": what the person should look at or start next.',
    `- Each list has at most ${DIGEST_ITEMS} items. Each item is { "text": one short sentence (at most 20 words or 40 Chinese characters), "taskId": the card id from the material, or "" }.`,
    "- Only use facts from the material. Skip empty categories (empty list). No file paths unless they are the point.",
    `- ${outputLanguageRule(input.language)}`,
    "",
    `Project: ${input.project}`,
    "",
    input.material,
  ].join("\n");
}

/** Keeps the start of over-long material; card sections come first, commits last. */
export function clipMaterial(text: string, limit = DIGEST_INPUT_LIMIT) {
  return text.length <= limit ? text : text.slice(0, limit - 40) + "\n[… material truncated …]";
}
