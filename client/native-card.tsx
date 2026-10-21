import type { ReactNode } from "react";
import { View } from "react-native";
import { cardFrameStyle } from "./content-card";
import { AiMark, Label, font, space, useTheme } from "./ui";

/**
 * The small heading above a Flowly card in Paseo's own timeline (NATIVE-SESSION-SPEC §5.3, §6.3): the AI mark and the
 * title, muted. `trailing` (the Next steps card's hide button) sits at the right end; its negative margin keeps the
 * row as high as the title, so both cards keep the same gap between heading and card.
 */
export function NativeCardHeading({ title, trailing }: { title: string; trailing?: ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space[1.5] }}>
      <AiMark />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Label muted medium size={font.sm} selectable={false}>
          {title}
        </Label>
      </View>
      {trailing ? <View style={{ marginVertical: -space[2] }}>{trailing}</View> : null}
    </View>
  );
}

/** A heading with a framed card under it that is not clamped text (Next steps, its wrap-up question): the same frame and 12 pt padding as Progress. */
export function NativeCardFrame({ title, trailing, testID, children }: { title: string; trailing?: ReactNode; testID?: string; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View testID={testID} style={{ gap: space[1.5] }}>
      <NativeCardHeading title={title} trailing={trailing} />
      <View style={{ ...cardFrameStyle(colors), padding: space[3], gap: space[2] }}>{children}</View>
    </View>
  );
}
