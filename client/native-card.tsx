import type { ReactNode } from "react";
import { View } from "react-native";
import { AiMark, Label, font, space } from "./ui";

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

/** The Next steps section (its chips, or the wrap-up question after Move to Done): the heading, then the content straight under it, no card around it (user decision 2026-10-21). */
export function NativeCardSection({ title, trailing, testID, children }: { title: string; trailing?: ReactNode; testID?: string; children: ReactNode }) {
  return (
    <View testID={testID} style={{ gap: space[1.5] }}>
      <NativeCardHeading title={title} trailing={trailing} />
      {children}
    </View>
  );
}
