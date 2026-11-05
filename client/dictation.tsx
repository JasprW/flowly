import { useQuery } from "@tanstack/react-query";
import { useRpc } from "@getpaseo/plugin/client";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator } from "react-native";
import { IconButton, useTheme } from "./ui";
import { dictationAvailable, maxDictationBase64, transcribeDictation } from "../shared/dictation";
import { t } from "../shared/i18n";

// The side chat's mic (shared/dictation.ts): press to record, press again to stop; the transcript is
// added to the draft, never sent. Hidden where the client cannot record or the daemon has no
// speech-to-text configured.

type Recorder = {
  state: string;
  mimeType: string;
  start(): void;
  stop(): void;
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
};
type Stream = { getTracks(): { stop(): void }[] };
type RecorderConstructor = { new (stream: Stream): Recorder; isTypeSupported?(type: string): boolean };
type MediaDevices = { getUserMedia(constraints: { audio: boolean }): Promise<Stream> };
// The browser's recording API, typed loosely: this project's lib types are React Native's.
const BrowserBlob = globalThis.Blob as unknown as new (parts: Blob[], options: { type: string }) => Blob;

function mediaDevices(): MediaDevices | undefined {
  return (globalThis as { navigator?: { mediaDevices?: MediaDevices } }).navigator?.mediaDevices;
}

function recorderClass(): RecorderConstructor | undefined {
  return (globalThis as { MediaRecorder?: RecorderConstructor }).MediaRecorder;
}

/** Whether this client has a microphone API at all (desktop and web, not the native apps). */
export function canRecord(): boolean {
  return typeof recorderClass() === "function" && typeof mediaDevices()?.getUserMedia === "function";
}

async function blobBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function DictationButton({
  size,
  disabled,
  onText,
  onError,
}: {
  size: number;
  disabled: boolean;
  onText(text: string): void;
  onError(message: string): void;
}) {
  const { colors } = useTheme();
  const available = useRpc(dictationAvailable);
  const transcribe = useRpc(transcribeDictation);
  const supported = canRecord();
  const enabled = useQuery({
    queryKey: ["flowly", "dictationAvailable"],
    queryFn: async () => (await available({})).available,
    enabled: supported,
    staleTime: Infinity,
    retry: false,
  });
  const [state, setState] = useState<"idle" | "recording" | "transcribing">("idle");
  const recorder = useRef<Recorder | null>(null);
  const stream = useRef<Stream | null>(null);
  // Leaving the pane stops the microphone.
  useEffect(() => () => {
    if (recorder.current?.state === "recording") recorder.current.stop();
    stream.current?.getTracks().forEach((track) => track.stop());
  }, []);
  if (!supported || !enabled.data) return null;

  const start = async () => {
    const Recorder = recorderClass()!;
    try {
      const media = await mediaDevices()!.getUserMedia({ audio: true });
      stream.current = media;
      const rec = new Recorder(media);
      const chunks: Blob[] = [];
      rec.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      rec.onstop = () => {
        media.getTracks().forEach((track) => track.stop());
        stream.current = null;
        recorder.current = null;
        void finish(new BrowserBlob(chunks, { type: rec.mimeType || "audio/webm" }));
      };
      recorder.current = rec;
      rec.start();
      setState("recording");
    } catch (e) {
      setState("idle");
      onError(t("Could not use the microphone: {reason}", { reason: e instanceof Error ? e.message : String(e) }));
    }
  };

  const finish = async (blob: Blob) => {
    if (!blob.size) return setState("idle");
    setState("transcribing");
    try {
      const base64 = await blobBase64(blob);
      if (base64.length > maxDictationBase64) return onError(t("The recording is too long."));
      const result = await transcribe({ base64, mimeType: blob.type || "audio/webm" });
      if (!result.ok) return onError(t("Could not transcribe the recording."));
      if (result.text) onText(result.text);
    } catch (e) {
      onError(t("Could not transcribe the recording."));
    } finally {
      setState("idle");
    }
  };

  if (state === "transcribing") return <ActivityIndicator size="small" color={colors.foregroundMuted} />;
  return (
    <IconButton
      icon={state === "recording" ? "Square" : "Mic"}
      size={size}
      active={state === "recording"}
      label={state === "recording" ? t("Stop recording") : t("Dictate")}
      disabled={disabled && state !== "recording"}
      onPress={() => (state === "recording" ? recorder.current?.stop() : void start())}
    />
  );
}
