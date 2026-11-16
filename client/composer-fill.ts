import type { PluginClientContext, PluginComposer } from "@getpaseo/plugin/client";
import { copyText } from "@getpaseo/plugin/client/react-native";
import { nextMoveDraft } from "../shared/next-moves";
import { composersOf } from "./host-support";
import { fillComposer } from "./web-composer";

/**
 * Puts a suggested next step from the timeline in a session's Paseo message box (NATIVE-SESSION-SPEC §6.4, PASEO-0.16-SPEC §3.3):
 * after anything already typed, separated by a blank line, with the cursor at its end. Nothing is sent and nothing
 * hidden is added. On a 0.16 host through the composer API (web, desktop and phones); `focus()` brings the session's
 * composer on screen. When it refuses, the earlier text is put back and the caller copies instead. On a 0.15 host the
 * web-only DOM path (`client/web-composer.ts`) stays.
 */
export async function fillPluginComposer(composer: PluginComposer, text: string): Promise<boolean> {
  const before = composer.prompt;
  const next = nextMoveDraft(text, before);
  try {
    composer.setPrompt(next);
  } catch {
    // A locked composer throws; nothing changed.
    return false;
  }
  try {
    await composer.focus({ selection: { start: next.length, end: next.length } });
    return true;
  } catch {
    try {
      composer.setPrompt(before);
    } catch {
      // Leave it: the text is the user's to keep or clear.
    }
    return false;
  }
}

/** Fills the message box of `agentId`. False: not filled (copy instead). */
export async function fillSessionComposer(client: Partial<Pick<PluginClientContext, "composers">> | null, agentId: string, text: string): Promise<boolean> {
  const composers = composersOf(client);
  if (!composers) return fillComposer(agentId, text);
  let composer: PluginComposer | undefined;
  try {
    composer = composers({ agentId })[0];
  } catch {
    composer = undefined;
  }
  return composer ? fillPluginComposer(composer, text) : false;
}

/** A message suggestion picked in Paseo's session view: filled in (setting `fill`) or copied. Rejects only when copying fails. */
export async function applyMessageMove(input: {
  client: Partial<Pick<PluginClientContext, "composers">> | null;
  agentId: string;
  prompt: string;
  tap: "fill" | "copy";
}): Promise<"filled" | "copied"> {
  if (input.tap === "fill" && (await fillSessionComposer(input.client, input.agentId, input.prompt))) return "filled";
  await copyText(input.prompt);
  return "copied";
}
