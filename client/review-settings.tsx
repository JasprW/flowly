import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useRpc } from "@getpaseo/plugin/client";
import { useQueryClient } from "@tanstack/react-query";
import * as rpc from "../shared/rpc";
import type { AutoReviewInput, Project } from "../shared/model";
import { guardrailCountsKey, guardrailsKey, useGuardrailsQuery } from "./queries";
import { Choices, Label, Toggle, font, message, space } from "./ui";
import { t } from "../shared/i18n";

export type ReviewEdit = { on: boolean; rounds: string };

/** phase B: `projects.update` takes `autoReview: { enabled, maxRounds }` only; this branch's input still lists `rules`. */
export const autoReviewPatch = (edit: ReviewEdit) => ({ enabled: edit.on, maxRounds: Number(edit.rounds) }) as AutoReviewInput;

/**
 * New project / Edit project → Auto review (GUARDRAILS-SPEC §8): the switch with its cost, one line of the check
 * commands found in the project, and Max rework rounds. Switching it on in Edit project detects the commands, which
 * join as observing (§4.5); a new project detects them when it is created.
 */
export function AutoReviewSection({
  project,
  value,
  onChange,
  switchOn,
}: {
  project?: Project;
  value: ReviewEdit;
  onChange(next: ReviewEdit): void;
  /** Opened from What's new: switch it on at once, as if pressed. */
  switchOn?: boolean;
}) {
  const queryClient = useQueryClient();
  const detect = useRpc(rpc.detectGuardrails);
  const [found, setFound] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  // The project's commands, when it already has them (§4.5).
  const store = useGuardrailsQuery(project?.id ?? "", !!project && value.on && found === null).data;
  const commands = found ?? (store?.entries ?? []).filter((e) => e.kind === "command" && (e.state === "active" || e.state === "observing")).map((e) => e.text);
  const set = (patch: Partial<ReviewEdit>) => onChange({ ...value, ...patch });
  const turn = async (on: boolean) => {
    set({ on });
    if (!on || !project || found !== null) return;
    setError("");
    try {
      setFound((await detect({ projectId: project.id })).found);
      void queryClient.invalidateQueries({ queryKey: guardrailsKey(project.id) });
      void queryClient.invalidateQueries({ queryKey: guardrailCountsKey });
    } catch (e) {
      setError(message(e));
    }
  };
  const asked = useRef(false);
  useEffect(() => {
    if (!switchOn || asked.current) return;
    asked.current = true;
    if (!value.on) void turn(true);
    // Once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [switchOn]);
  return (
    <View style={{ gap: space[3] }}>
      <Toggle title={t("Auto review")} detail={t("Every delivery runs a review and uses tokens.")} value={value.on} onChange={(on) => void turn(on)} />
      {value.on && !!commands.length && (
        <Label size={font.sm} muted selectable>
          {t("Checks found: {names}", { names: commands.join(", ") })}
        </Label>
      )}
      {value.on && !!error && (
        <Label size={font.sm} muted selectable>
          {error}
        </Label>
      )}
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
