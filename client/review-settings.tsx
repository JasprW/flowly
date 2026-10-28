import { View } from "react-native";
import { Choices, Toggle, space } from "./ui";
import { t } from "../shared/i18n";

export type ReviewEdit = { on: boolean; rounds: string };

/**
 * Edit project → Auto review (GUARDRAILS-SPEC §8): the switch and the rework rounds. What is checked lives in the
 * project's guardrails. Phase B kept only what the narrowed project settings still hold; phase C owns this layout.
 */
export function AutoReviewSection({ value, onChange }: { value: ReviewEdit; onChange(next: ReviewEdit): void }) {
  const set = (patch: Partial<ReviewEdit>) => onChange({ ...value, ...patch });
  return (
    <View style={{ gap: space[3] }}>
      <Toggle
        title={t("Auto review")}
        detail={`${t("When an agent delivers a card to In review, Flowly runs these checks in the card's workspace. A failure sends the card back to its work stage with a rework message to that session; past the limit it goes to Blocked.")} ${t("Every delivery runs an LLM review and uses tokens.")}`}
        value={value.on}
        onChange={(on) => set({ on })}
      />
      {value.on && (
        <Choices
          title={t("Max rework rounds")}
          value={value.rounds}
          options={["0", "1", "2", "3", "4", "5"].map((v) => ({ value: v, label: v }))}
          onChange={(rounds) => set({ rounds })}
        />
      )}
    </View>
  );
}
