import { copyText } from "@getpaseo/plugin/client/react-native";
import { t } from "../shared/i18n";
import { providerSessionId, type SessionIdSource } from "../shared/session-ids";
import type { MenuEntry } from "./context-menu";
import { message } from "./ui";

type Toast = { show(text: string, options: { variant: "success" | "error" }): void };

/** Copy agent ID, plus Copy session ID when the provider's id differs (DRAWER-SPEC, Session menu: copy IDs). */
export function copyIdEntries(agent: SessionIdSource, toast: Toast): MenuEntry[] {
  const copy = (id: string, done: string) =>
    void copyText(id).then(
      () => toast.show(done, { variant: "success" }),
      (e) => toast.show(message(e), { variant: "error" }),
    );
  const sessionId = providerSessionId(agent);
  return [
    { kind: "separator", id: "copy-ids" },
    { id: "copy-agent", label: t("Copy agent ID"), icon: "Copy", onPress: () => copy(agent.id, t("Agent ID copied")) },
    ...(sessionId
      ? [{ id: "copy-session", label: t("Copy session ID"), icon: "Copy", onPress: () => copy(sessionId, t("Session ID copied")) }]
      : []),
  ];
}
