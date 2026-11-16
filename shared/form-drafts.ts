import { z } from "zod";
import { imageMimeSchema, outgoingImageSchema } from "./composer";
import { cardImageLimit } from "./model";

/** New task / New session drafts (docs/FORM-DRAFTS-SPEC.md). */
export const formDraftImageLimit = Math.max(cardImageLimit, 4);
const segment = "[A-Za-z0-9][A-Za-z0-9_.-]{0,199}";
export const formDraftKeyPattern = new RegExp(`^(task|session):${segment}:(plain|(idea|insight|follow):${segment})$`);
export const formDraftKeySchema = z.string().max(500).regex(formDraftKeyPattern, "Invalid draft key.");

/** Longest text a saved draft field holds; a longer value is kept only in the open form. */
export const formDraftTextLimit = 20000;
export const formDraftValueSchema = z.union([
  z.string().max(formDraftTextLimit),
  z.boolean(),
  z.array(z.string().max(2000)).max(50),
]);
export const formDraftFieldsSchema = z
  .record(z.string().regex(/^[A-Za-z][A-Za-z0-9]{0,39}$/), formDraftValueSchema)
  .refine((fields) => Object.keys(fields).length <= 40, "Too many draft fields.");
export type FormDraftFields = z.infer<typeof formDraftFieldsSchema>;

const imageId = z.string().regex(/^[A-Za-z0-9-]{1,80}$/);
const imageName = z.string().max(300);

/** Stored on the daemon: the image lives in a file beside the JSON. */
export const storedDraftImageSchema = z.object({
  id: imageId,
  name: imageName,
  mimeType: imageMimeSchema,
  file: z.string().regex(/^[A-Za-z0-9-]+\.(png|jpg|gif|webp)$/),
});
export const storedDraftSchema = z.object({
  revision: z.number().int().positive(),
  updatedAt: z.string(),
  fields: formDraftFieldsSchema,
  images: z.array(storedDraftImageSchema).max(formDraftImageLimit),
});
export const formDraftStateSchema = z.object({
  version: z.literal(1),
  drafts: z.record(formDraftKeySchema, storedDraftSchema),
  /** Last revision of each cleared draft, so revisions never repeat and a stale window cannot save over a newer draft. */
  cleared: z.record(formDraftKeySchema, z.number().int().positive()).optional(),
});
export type FormDraftState = z.infer<typeof formDraftStateSchema>;
export type StoredDraft = z.infer<typeof storedDraftSchema>;

/** A saved image travels once with its data; later saves name it by id. */
export const draftImageInputSchema = z.strictObject({
  id: imageId,
  name: imageName,
  mimeType: imageMimeSchema,
  data: outgoingImageSchema.shape.data.optional(),
});
export type DraftImageInput = z.infer<typeof draftImageInputSchema>;

export const readDraftOutput = z.object({
  /** The revision the next save builds on (0 when the key has never been saved). */
  revision: z.number().int().min(0),
  draft: z
    .object({
      revision: z.number().int().positive(),
      fields: formDraftFieldsSchema,
      images: z.array(z.object({ id: imageId, name: imageName, mimeType: imageMimeSchema, data: z.string() })),
    })
    .nullable(),
});
export type ReadDraft = z.infer<typeof readDraftOutput>["draft"];

export const draftConflictMessage = "This draft was changed in another window.";

/** The key of a form's draft: one per project (New task) or card (New session) and prefill source. */
export function formDraftKey(
  kind: "task" | "session",
  scopeId: string,
  source?: { ideaId?: string; insightFindingId?: string; followUpOf?: string } | null,
) {
  const from = source?.ideaId
    ? `idea:${source.ideaId}`
    : source?.insightFindingId
      ? `insight:${source.insightFindingId}`
      : source?.followUpOf
        ? `follow:${source.followUpOf}`
        : "plain";
  const key = `${kind}:${scopeId}:${from}`;
  return formDraftKeyPattern.test(key) ? key : null;
}

export function parseFormDraftKey(key: string) {
  const [kind, scopeId] = key.split(":");
  return { kind: kind as "task" | "session", scopeId };
}

/** Typed reads of restored fields: anything of another type is ignored. */
export const draftField = {
  text: (fields: FormDraftFields | undefined, name: string) => (typeof fields?.[name] === "string" ? (fields[name] as string) : undefined),
  flag: (fields: FormDraftFields | undefined, name: string) => (typeof fields?.[name] === "boolean" ? (fields[name] as boolean) : undefined),
  list: (fields: FormDraftFields | undefined, name: string) => (Array.isArray(fields?.[name]) ? (fields[name] as string[]) : undefined),
};
