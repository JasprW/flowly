import { Pressable, View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { PaseoAgent } from "@getpaseo/client";
import type { BoardEvent } from "../shared/model";
import { Dot, Label, font, relativeTime, space, tint, touch, useTheme, noFocusRing } from "./ui";
import { sessionState } from "./session-state";
import { sessionTone } from "./status";
import { PulseDot } from "./motion";
import { RunningDots } from "./running-motion";
import type { sessionAttention } from "../shared/session-attention";
import { t } from "../shared/i18n";

/** One row of the drawer's session list group. */
export function SessionCard({
  agent,
  events,
  highlighted,
  attention,
  readStateUnavailable,
  first = true,
  nested = false,
  onPress,
  menu,
}: {
  agent: PaseoAgent;
  events: BoardEvent[];
  highlighted?: boolean;
  attention?: ReturnType<typeof sessionAttention>;
  readStateUnavailable?: boolean;
  first?: boolean;
  /** A subagent under its main session: indented, a little shorter. */
  nested?: boolean;
  onPress(): void;
  /** Context-menu handlers (right-click / long-press). */
  menu?: object;
}) {
  const { colors } = useTheme();
  const state = sessionState(agent, events);
  const unread = !readStateUnavailable && !!attention?.unread && !agent.archivedAt;
  const tone = sessionTone(colors, state, unread);
  const readText = readStateUnavailable
    ? ""
    : !attention?.readKnown
      ? t("Read state unknown")
      : "";
  const model = [agent.provider, agent.model].filter(Boolean).join(" · ");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${t("Preview {title}: {state}", { title: agent.title || agent.id, state: t(state.label) })}${unread ? `, ${t("unread")}` : ""}${!readStateUnavailable && attention?.needsAttention ? `, ${t("needs attention")}` : ""}`}
      onPress={onPress}
      {...(menu || {})}
      style={(pressState) => {
        const { pressed, hovered: hover, focused } = pressState as typeof pressState & { hovered?: boolean; focused?: boolean };
        const hovered = hover;
        return {
          ...noFocusRing,
          flexDirection: "row",
          alignItems: "center",
          gap: space[3],
          minHeight: nested ? (touch ? 52 : 44) : touch ? 64 : 56,
          paddingVertical: nested ? space[1.5] : space[2] + 2,
          paddingLeft: nested ? space[3] + 22 : space[3],
          paddingRight: space[2],
          borderTopWidth: first ? 0 : 1,
          borderColor: colors.border,
          backgroundColor: highlighted
            ? tint(colors.accent, 0.08)
            : hovered || pressed
              ? colors.surface1
              : colors.surface0,
          opacity: agent.archivedAt ? 0.6 : 1,
        };
      }}
    >
      {state.active && !agent.archivedAt && <RunningDots color={tone} seed={agent.id} />}
      <View style={{ width: 10, alignItems: "center" }}>
        <PulseDot color={tone} size={8} active={state.active} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Label size={font.base} medium bold={unread} lines={1} selectable={false}>
          {agent.title || t("Untitled session")}
        </Label>
        <Label muted size={font.sm} lines={1} selectable={false}>
          <Label
            size={font.sm}
            medium
            color={state.label === "Idle" || state.label === "Ready" || state.label === "Archived" || state.label === "Closed" ? colors.foregroundMuted : tone}
            selectable={false}
          >
            {unread && !state.active && state.label !== "Error" && !("waiting" in state) ? `${t(state.label)} · ${t("Unread")}` : t(state.label)}
          </Label>
          {model ? ` · ${model}` : ""}
          {readText ? ` · ${readText}` : ""}
          {agent.providerUnavailable ? ` · ${t("Provider unavailable")}` : ""}
        </Label>
      </View>
      {/* Last activity, centered on the whole row (beside the chevron); never squeezed by a long title. */}
      <View style={{ flexShrink: 0 }}>
        <Label muted size={font.xs} lines={1} selectable={false}>
          {relativeTime(agent.updatedAt)}
        </Label>
      </View>
      <Icon name="ChevronRight" size={16} color={colors.foregroundMuted} />
    </Pressable>
  );
}
