import type { ReactNode } from "react";
import { Animated, Modal as NativeModal, Pressable, StyleSheet, View } from "react-native";
import { ScrollView } from "@getpaseo/plugin/client/react-native";
import { t } from "../shared/i18n";
import { Modal } from "./modal";
import { MotionBridge, lerp, useMotionPresence, useReducedMotion } from "./motion";
import { IconButton, Label, Theme, font, noFocusRing, radius, space, useTheme, verticalContent, verticalScroll } from "./ui";

const contentStyle = { padding: space[3], gap: space[1] };

export function ProjectChooserDialog({ open, nativeWide, onClose, children }: {
  open: boolean; nativeWide: boolean; onClose(): void; children: ReactNode;
}) {
  const title = t("Projects");
  if (nativeWide) return <WideNativeDialog open={open} title={title} onClose={onClose}>{children}</WideNativeDialog>;
  return (
    <Modal open={open} title={title} onOpenChange={(next) => { if (!next) onClose(); }}>
      <Modal.Content contentContainerStyle={contentStyle}>{children}</Modal.Content>
    </Modal>
  );
}

function WideNativeDialog({ open, title, onClose, children }: {
  open: boolean; title: string; onClose(): void; children: ReactNode;
}) {
  const theme = useTheme();
  const { colors } = theme;
  const reduced = useReducedMotion();
  const { item, active, progress } = useMotionPresence(open, open ? "projects" : "");
  if (!item) return null;
  // The host's wide sheet moves its full-window surface. Animate only the card
  // here, and leave native presentation unanimated so the dim stays in place.
  return (
    <NativeModal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      {/* Native modals render outside Flowly's context tree on mobile hosts. */}
      <Theme.Provider value={theme}>
        <MotionBridge reduced={reduced}>
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: space[4] }}>
            <Animated.View pointerEvents={active ? "auto" : "none"} style={[
              StyleSheet.absoluteFillObject,
              { backgroundColor: "rgba(0,0,0,0.55)", opacity: progress },
            ]}>
              <Pressable accessible={false} importantForAccessibility="no" onPress={onClose} style={{ ...noFocusRing, ...StyleSheet.absoluteFillObject }} />
            </Animated.View>
            <Animated.View accessibilityViewIsModal={active} importantForAccessibility={active ? "auto" : "no-hide-descendants"}
              pointerEvents={active ? "auto" : "none"}
              style={{
                width: "100%", maxWidth: 520, maxHeight: "85%", flexShrink: 1, minHeight: 0,
                overflow: "hidden", borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border,
                backgroundColor: colors.surface0, transform: [{ translateY: lerp(progress, [24, 0]) }],
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", minHeight: 56, paddingLeft: space[4], paddingRight: space[2], borderBottomWidth: 1, borderColor: colors.border }}>
                <View style={{ flex: 1, minWidth: 0 }}><Label bold size={font.lg} selectable={false}>{title}</Label></View>
                <IconButton icon="X" label={t("Close")} onPress={onClose} />
              </View>
              <ScrollView {...verticalScroll} style={{ flexShrink: 1, minHeight: 0 }} keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ ...verticalContent, ...contentStyle }}>
                {children}
              </ScrollView>
            </Animated.View>
          </View>
        </MotionBridge>
      </Theme.Provider>
    </NativeModal>
  );
}
