import type { z } from "zod";
import type { transcribeDictation } from "../shared/dictation";

type Output = z.input<typeof transcribeDictation.output>;
type Env = Record<string, string | undefined>;

const timeoutMs = 60_000;

// Node's fetch globals, typed loosely: this project's lib types are React Native's, not Node's web ones.
type Form = { append(name: string, value: unknown, filename?: string): void };
const NodeFormData = (globalThis as unknown as { FormData: new () => Form }).FormData;
const NodeBlob = globalThis.Blob as unknown as new (parts: unknown[], options: { type: string }) => unknown;
const timeoutSignal = (ms: number) => (AbortSignal as unknown as { timeout(ms: number): AbortSignal }).timeout(ms);

/** The OpenAI-compatible transcription endpoint the daemon was configured with, if any. */
export function dictationEndpoint(env: Env = process.env): { url: string; model: string; key?: string; language?: string } | null {
  const base = env.OPENAI_STT_BASE_URL?.trim();
  if (!base) return null;
  return {
    url: `${base.replace(/\/+$/, "")}/audio/transcriptions`,
    model: env.STT_MODEL?.trim() || "whisper-1",
    ...(env.OPENAI_STT_API_KEY?.trim() ? { key: env.OPENAI_STT_API_KEY.trim() } : {}),
    ...(env.PASEO_DICTATION_LANGUAGE?.trim() ? { language: env.PASEO_DICTATION_LANGUAGE.trim() } : {}),
  };
}

function extension(mimeType: string): string {
  if (mimeType.includes("webm")) return "webm";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("mp4") || mimeType.includes("m4a")) return "m4a";
  if (mimeType.includes("wav")) return "wav";
  return "mp3";
}

export async function transcribe(
  input: { base64: string; mimeType: string },
  env: Env = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<Output> {
  const endpoint = dictationEndpoint(env);
  if (!endpoint) return { ok: false, reason: "unavailable" };
  const form = new NodeFormData();
  form.append("file", new NodeBlob([Buffer.from(input.base64, "base64")], { type: input.mimeType }), `dictation.${extension(input.mimeType)}`);
  form.append("model", endpoint.model);
  form.append("response_format", "json");
  if (endpoint.language) form.append("language", endpoint.language);
  try {
    const response = await fetchImpl(endpoint.url, {
      method: "POST",
      body: form as never,
      headers: endpoint.key ? { authorization: `Bearer ${endpoint.key}` } : {},
      signal: timeoutSignal(timeoutMs),
    });
    if (!response.ok) return { ok: false, reason: "failed", detail: `HTTP ${response.status}` };
    const body = (await response.json()) as { text?: unknown };
    return { ok: true, text: typeof body.text === "string" ? body.text.trim() : "" };
  } catch (e) {
    return { ok: false, reason: "failed", detail: e instanceof Error ? e.message : String(e) };
  }
}
