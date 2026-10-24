import { useEffect, useState } from "react";
import { Animated, Modal as RNModal, Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { Icon, ScrollView } from "@getpaseo/plugin/client/react-native";
import { Enter, motionDuration, useMotionValue, lerp } from "./motion";
import type { PluginTheme } from "@getpaseo/plugin";
import { useShortcutBlock } from "./shortcuts";
import { AiPage, GeneralPage, ModelsPage, WorkflowPage } from "./settings-pages";
import { CardsPage } from "./card-settings";
import { ConnectionsPage } from "./connectors";
import { Button, IconButton, Label, Theme, font, noFocusRing, radius, space, tint, touch, useTheme } from "./ui";
import { msg, t } from "../shared/i18n";

/** The settings window is wider than the host modal (about 520 px) so the two columns have room. */
const modalMaxWidth = 900;

/**
 * Floating bottom-left settings button: a rounded square that rises in on mount,
 * lifts on hover, presses in, and stays highlighted while its modal is open.
 */
export function SettingsFab({
  open = false,
  hint,
  onHintDismiss,
  onPress,
}: {
  open?: boolean;
  /** One-time callout above the button (ONBOARDING-SETUP-SPEC §5); the button is outlined while it shows. */
  hint?: string;
  onHintDismiss?(): void;
  onPress(): void;
}) {
  const { colors } = useTheme();
  const [hovered, setHovered] = useState(false),
    [pressed, setPressed] = useState(false),
    [focused, setFocused] = useState(false);
  const lit = open || hovered;
  const shown = useMotionValue(1, motionDuration.forward, 0);
  const lift = useMotionValue(pressed ? 0.94 : lit ? 1.04 : 1);
  const turn = useMotionValue(open ? 1 : hovered ? 0.5 : 0, motionDuration.forward);
  const size = touch ? 44 : 36;
  return (
    <>
    {!!hint && (
      // A sibling, not a child: the button's box would clip it on Android.
      <Enter
        distance={6}
        style={{
          position: "absolute",
          left: space[3],
          bottom: space[3] + size + space[2],
          width: 280,
          maxWidth: "80%",
          flexDirection: "row",
          alignItems: "center",
          gap: space[2],
          paddingLeft: space[3],
          paddingRight: space[1.5],
          paddingVertical: space[2],
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: tint(colors.accent, 0.45),
          backgroundColor: colors.surface2,
          shadowColor: "#000",
          shadowOpacity: 0.16,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 4 },
          elevation: 4,
        }}
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <Label size={font.md}>{hint}</Label>
        </View>
        <View style={{ flexShrink: 0 }}>
          <Button small quiet onPress={() => onHintDismiss?.()}>
            {t("Got it")}
          </Button>
        </View>
      </Enter>
    )}
    <Animated.View
      style={{
        position: "absolute",
        left: space[3],
        bottom: space[3],
        opacity: shown,
        transform: [
          { translateY: lerp(shown, [8, 0]) },
          { scale: lift },
        ],
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("Flowly settings")}
        accessibilityState={{ expanded: open }}
        onPress={onPress}
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          ...noFocusRing,
          width: size,
          height: size,
          borderRadius: radius.lg,
          alignItems: "center",
          justifyContent: "center",
          borderWidth: 1,
          borderColor: open || hint ? colors.accent : hovered ? tint(colors.foregroundMuted, 0.45) : colors.border,
          backgroundColor: lit ? colors.surface2 : colors.surface1,
          shadowColor: "#000",
          shadowOpacity: lit ? 0.16 : 0.08,
          shadowRadius: lit ? 10 : 6,
          shadowOffset: { width: 0, height: lit ? 4 : 2 },
          elevation: lit ? 4 : 2,
        }}
      >
        <Animated.View style={{ transform: [{ rotate: lerp(turn, ["0deg", "90deg"]) }] }}>
          <Icon name="Settings" size={17} color={lit ? colors.foreground : colors.foregroundMuted} />
        </Animated.View>
        {!!hint && (
          // Outline that says "here", drawn outside the button so its size does not change.
          <View pointerEvents="none" style={{ position: "absolute", top: -4, left: -4, right: -4, bottom: -4, borderRadius: radius.lg + 4, borderWidth: 2, borderColor: tint(colors.accent, 0.5) }} />
        )}
      </Pressable>
    </Animated.View>
    </>
  );
}

export type SettingsSection = "general" | "cards" | "models" | "workflow" | "ai" | "connections";
/** Settings grouped by what they are for; each group is one page of the two-column layout. */
const settingsSections: { id: SettingsSection; icon: string; label: string }[] = [
  { id: "general", icon: "SlidersHorizontal", label: msg("General") },
  { id: "cards", icon: "LayoutList", label: msg("Cards") },
  { id: "models", icon: "Cpu", label: msg("Models") },
  { id: "workflow", icon: "Workflow", label: msg("Workflow") },
  { id: "ai", icon: "Sparkles", label: msg("AI features") },
  { id: "connections", icon: "Plug", label: msg("Connections") },
];

/** One entry of the section list: a row in the left column, a compact chip when the modal is narrow. */
function SettingsNavRow({ icon, label, selected, stacked, onPress }: { icon: string; label: string; selected: boolean; stacked: boolean; onPress(): void }) {
  const { colors } = useTheme();
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={{
        ...noFocusRing,
        flexDirection: "row",
        alignItems: "center",
        gap: space[2],
        minHeight: touch ? 44 : 34,
        paddingVertical: space[1.5],
        paddingHorizontal: space[3],
        borderRadius: radius.lg,
        backgroundColor: selected ? colors.surface2 : hovered ? colors.surface1 : "transparent",
        ...(stacked ? { borderWidth: 1, borderColor: selected ? colors.accent : colors.border } : {}),
      }}
    >
      <Icon name={icon} size={16} color={selected ? colors.foreground : colors.foregroundMuted} />
      <Label medium={selected} size={font.md} color={selected ? colors.foreground : colors.foregroundMuted} selectable={false}>
        {label}
      </Label>
    </Pressable>
  );
}

/** Left column of sections, right column with the selected section's settings; the sections become a strip on top in narrow windows. */
function SettingsPanes({ open, initial, onTour, onWhatsNew }: { open: boolean; initial?: SettingsSection; onTour(): void; onWhatsNew(): void }) {
  const { colors } = useTheme();
  const { width, height } = useWindowDimensions();
  const stacked = Math.min(modalMaxWidth, width - 32) < 560;
  const [section, setSection] = useState<SettingsSection>(initial || "general");
  // Opened for a section (Sort menu → Card display…): show it, also when the panes stayed mounted.
  useEffect(() => {
    if (open && initial) setSection(initial);
  }, [open, initial]);
  const bodyHeight = Math.min(560, Math.max(340, height - 200));
  const pane =
    section === "general" ? (
      <GeneralPage onTour={onTour} onWhatsNew={onWhatsNew} />
    ) : section === "cards" ? (
      <CardsPage />
    ) : section === "models" ? (
      <ModelsPage active={open} />
    ) : section === "workflow" ? (
      <WorkflowPage />
    ) : section === "connections" ? (
      <ConnectionsPage />
    ) : (
      <AiPage />
    );
  const rows = settingsSections.map((entry) => (
    <SettingsNavRow key={entry.id} icon={entry.icon} label={t(entry.label)} selected={entry.id === section} stacked={stacked} onPress={() => setSection(entry.id)} />
  ));
  const content = (
    <ScrollView style={{ flex: 1, minWidth: 0 }} contentContainerStyle={{ padding: space[5], paddingBottom: space[6] }}>
      <Enter key={section} distance={4}>
        <View style={{ maxWidth: 680, width: "100%" }}>{pane}</View>
      </Enter>
    </ScrollView>
  );
  return stacked ? (
    <View style={{ height: bodyHeight }}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0, borderBottomWidth: 1, borderBottomColor: colors.border }}
        contentContainerStyle={{ padding: space[2], gap: space[2] }}
        accessibilityLabel={t("Settings sections")}
      >
        {rows}
      </ScrollView>
      {content}
    </View>
  ) : (
    <View style={{ height: bodyHeight, flexDirection: "row" }}>
      <View accessibilityLabel={t("Settings sections")} style={{ width: 156, padding: space[2], gap: 2, borderRightWidth: 1, borderRightColor: colors.border }}>
        {rows}
      </View>
      {content}
    </View>
  );
}

/** Flowly settings, in two columns: sections on the left (language and guide, card workflow, AI summaries, ideas), their settings on the right. */
export function SettingsModal({ open, section, theme, onClose, onTour, onWhatsNew }: { open: boolean; section?: SettingsSection; theme: PluginTheme; onClose(): void; onTour(): void; onWhatsNew(): void }) {
  useShortcutBlock(open);
  return (
    <RNModal visible={open} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Theme.Provider value={theme}>
        <SettingsWindow open={open} section={section} onClose={onClose} onTour={onTour} onWhatsNew={onWhatsNew} />
      </Theme.Provider>
    </RNModal>
  );
}

/** Own window instead of the host Modal, whose width is fixed: backdrop, title bar and the two-column body. */
function SettingsWindow({ open, section, onClose, onTour, onWhatsNew }: { open: boolean; section?: SettingsSection; onClose(): void; onTour(): void; onWhatsNew(): void }) {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: space[4] }}>
      <Pressable accessible={false} importantForAccessibility="no" onPress={onClose} style={{ ...noFocusRing, ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.45)" }} />
      <View
        accessibilityViewIsModal
        style={{
          width: Math.min(modalMaxWidth, width - 32),
          maxWidth: "100%",
          borderRadius: radius.xl,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.surface0,
          overflow: "hidden",
          shadowColor: "#000",
          shadowOpacity: 0.25,
          shadowRadius: 24,
          shadowOffset: { width: 0, height: 8 },
          elevation: 12,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingLeft: space[5], paddingRight: space[3], minHeight: 56, borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <Label bold size={font.lg} selectable={false}>
            {t("Flowly settings")}
          </Label>
          <IconButton icon="X" label={t("Close")} onPress={onClose} />
        </View>
        <SettingsPanes open={open} initial={section} onTour={onTour} onWhatsNew={onWhatsNew} />
      </View>
    </View>
  );
}

