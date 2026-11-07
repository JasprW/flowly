import { expect, test, vi } from "vitest";
import { dictationEndpoint, transcribe } from "./dictation";

const env = { OPENAI_STT_BASE_URL: "http://stt.local/v1/", STT_MODEL: "whisper-x", PASEO_DICTATION_LANGUAGE: "es" };

test("no endpoint without OPENAI_STT_BASE_URL", async () => {
  expect(dictationEndpoint({})).toBeNull();
  expect(await transcribe({ base64: "AQID", mimeType: "audio/webm" }, {})).toEqual({ ok: false, reason: "unavailable" });
});

test("posts the recording with the daemon's model and language, and returns the text", async () => {
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ text: " hola mundo " }), { status: 200 }));
  expect(await transcribe({ base64: "AQID", mimeType: "audio/webm;codecs=opus" }, env, fetchImpl as never)).toEqual({ ok: true, text: "hola mundo" });
  const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, { body: { get(name: string): unknown } }];
  expect(url).toBe("http://stt.local/v1/audio/transcriptions");
  expect(init.body.get("model")).toBe("whisper-x");
  expect(init.body.get("language")).toBe("es");
  expect((init.body.get("file") as { name: string }).name).toBe("dictation.webm");
});

test("an HTTP error is reported, not thrown", async () => {
  const fetchImpl = vi.fn(async () => new Response("no", { status: 500 }));
  expect(await transcribe({ base64: "AQID", mimeType: "audio/webm" }, env, fetchImpl as never)).toEqual({ ok: false, reason: "failed", detail: "HTTP 500" });
});
