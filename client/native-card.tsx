import type { ReactNode } from "react";
import { View } from "react-native";
import { cardFrameStyle } from "./content-card";
import { AiMark, Label, font, space, touch, useTheme } from "./ui";

/**
 * The header every Flowly card in Paseo's own timeline shares (NATIVE-SESSION-SPEC §6.3): the AI mark and the title on
 * the left, the card's one action on the right (Open card on Progress, Hide on Next steps). One fixed height, so the
 * cards line up whether the action is a button or an icon.
 */
export function NativeCardHeader({ title, trailing }: { title: string; trailing?: ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space[1.5], minHeight: touch ? 32 : 28 }}>
      <AiMark />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Label muted medium size={font.sm} selectable={false}>
          {title}
        </Label>
      </View>
      {trailing}
    </View>
  );
}

/** A card that is not clamped text (Next steps, its wrap-up question): the same frame and padding as Progress. */
export function NativeCardFrame({ title, trailing, testID, children }: { title: string; trailing?: ReactNode; testID?: string; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View testID={testID} style={{ ...cardFrameStyle(colors), padding: space[3], gap: space[2] }}>
      <NativeCardHeader title={title} trailing={trailing} />
      {children}
    </View>
  );
}
