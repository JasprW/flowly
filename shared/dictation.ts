import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

// Dictation in the side chat's composer. The plugin SDK exposes no dictation, so Flowly records on the
// client and transcribes on its server with the daemon's own speech-to-text settings (OPENAI_STT_*), the
// same service Paseo's voice mode uses.

/** About two minutes of Opus speech; a ceiling against runaway recordings. */
export const maxDictationBase64 = 4 * 1024 * 1024;

export const dictationAvailable = defineRpc({
  name: "dictation.available",
  input: z.strictObject({}),
  output: z.strictObject({ available: z.boolean() }),
});

export const transcribeDictation = defineRpc({
  name: "dictation.transcribe",
  input: z.strictObject({ base64: z.string().min(1).max(maxDictationBase64), mimeType: z.string().min(1).max(100) }),
  output: z.discriminatedUnion("ok", [
    z.strictObject({ ok: z.literal(true), text: z.string() }),
    z.strictObject({ ok: z.literal(false), reason: z.enum(["unavailable", "failed"]), detail: z.string().optional() }),
  ]),
});
