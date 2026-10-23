import { memo } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { NextMove } from "../shared/model";
import { CueRing, IconButton, Label, font, noFocusRing, space, tint, touch, useTheme } from "./ui";
import { Enter } from "./motion";
import { t } from "../shared/i18n";

/**
 * The session's suggested next messages for this turn (NEXT-MOVES-SPEC §4):
 * one row of chips above the composer. Picking one only fills the composer.
 */
export const NextMoves = memo(function NextMoves({
  moves,
  disabled,
  onPick,
  onDismiss,
  cue = -1,
}: {
  moves: readonly NextMove[];
  disabled: boolean;
  /** Index of a step to ring (the welcome tour's autoplay); -1 for none. */
  cue?: number;
  /** Called for message moves (fill the composer) and action moves (`moveTo`) alike. */
  onPick(move: NextMove): void;
  onDismiss(): void;
}) {
  const { colors } = useTheme();
  if (!moves.length) return null;
  const height = touch ? 32 : 26;
  return (
    <Enter distance={6}>
      <View testID="session-next-moves" style={{ flexDirection: "row", alignItems: "center", gap: space[1.5], minWidth: 0 }}>
        <Icon name="Sparkles" size={14} color={colors.accent} />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          style={{ flex: 1, minWidth: 0 }}
          contentContainerStyle={{ gap: space[1.5], alignItems: "center" }}
        >
          {moves.map((move, index) => {
            const action = !!move.moveTo;
            return (
            <Pressable
              key={`${index}:${move.label}`}
              accessibilityRole="button"
              accessibilityLabel={t("Suggested next step: {label}", { label: move.label })}
              accessibilityHint={action ? t("Moves this card to Done.") : t("Fills the message box. Nothing is sent until you send it.")}
              accessibilityState={{ disabled }}
              disabled={disabled}
              onPress={() => onPick(move)}
              style={(state) => {
                const { pressed, hovered, focused } = state as typeof state & { hovered?: boolean; focused?: boolean };
                return {
                  ...noFocusRing,
                  height,
                  maxWidth: 280,
                  flexDirection: "row",
                  alignItems: "center",
                  paddingHorizontal: space[2] + 2,
                  borderRadius: height / 2,
                  borderWidth: 1,
                  borderColor: action ? tint(colors.statusSuccess, 0.55) : index === 0 ? tint(colors.accent, 0.5) : colors.border,
                  backgroundColor: pressed || hovered ? colors.surface2 : index === 0 ? tint(colors.accent, 0.08) : colors.surface0,
                  opacity: disabled ? 0.45 : 1,
                };
              }}
            >
              {action && (
                <View style={{ marginRight: space[1] }}>
                  <Icon name="Check" size={13} color={colors.statusSuccess} />
                </View>
              )}
              <Label size={font.sm} medium lines={1} selectable={false}>
                {move.label}
              </Label>
              {cue >= 0 && <CueRing on={cue === index} radius={height / 2} />}
            </Pressable>
            );
          })}
        </ScrollView>
        <IconButton icon="X" size={height} label={t("Hide suggestions")} onPress={onDismiss} />
      </View>
    </Enter>
  );
});
