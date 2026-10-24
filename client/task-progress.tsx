import { useTaskDetail } from "./card-detail-query";
import { perfStart, perfEnd, usePerfRender } from "./perf";
import { useState } from "react";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { useRpc } from "@getpaseo/plugin/client";
import { useQueryClient } from "@tanstack/react-query";
import * as rpc from "../shared/rpc";
import { modelLabel, targetText, type SummaryEntry, type SummaryOverview } from "../shared/summary";
import { CardBody, CardField, CardFootnote, CardHeadline, ContentCard } from "./content-card";
import { Section, type SectionState } from "./disclosure";
import { summariesKey, useSummariesQuery } from "./queries";
import { workpadEnabled, workpadOf } from "../shared/workpad";
import { Button, Label, font, message, relativeTime } from "./ui";
import { t } from "../shared/i18n";

export { summariesKey };

/** Latest summary per card, runs in flight and errors (TASK-SUMMARY-SPEC §6). Shared by board and drawer. */
export const useSummaries = useSummariesQuery;

export function cardProgress(overview: SummaryOverview | undefined, taskId: string) {
  return overview?.latest.find((e) => e.taskId === taskId) || null;
}

/** Drawer "Progress": state, recap and next step, with refresh. */
export function TaskProgress({ taskId, active, section }: { taskId: string; active: boolean; section: SectionState }) {
  usePerfRender("switch.progress.commit");
  const switchStart = perfStart();
  const toast = useToast();
  const queryClient = useQueryClient();
  const overview = useSummaries(active);
  // The workpad's acceptance criteria replace the summary's Target (WORKPAD-SPEC §6.2).
  const { detail } = useTaskDetail();
  const hideTarget =
    workpadEnabled(detail?.project) && !!detail?.workpad?.acceptance.length;
  const refreshRpc = useRpc(rpc.refreshSummary);
  const [requesting, setRequesting] = useState(false);
  const latest = cardProgress(overview.data, taskId);
  const running = !!overview.data?.running.includes(taskId);
  const error = overview.data?.errors.find((e) => e.taskId === taskId);
  const refresh = async () => {
    setRequesting(true);
    try {
      await refreshRpc({ taskId });
      await queryClient.invalidateQueries({ queryKey: summariesKey });
    } catch (e) {
      toast.show(message(e), { variant: "error" });
    } finally {
      setRequesting(false);
    }
  };
  perfEnd("switch.progress.own", switchStart);
  return (
    <Section
      id={taskId}
      title={t("Progress")}
      ai
      open={section.open}
      onToggle={section.onToggle}
      summary={running ? t("Updating…") : latest?.state}
      actions={
        <Button quiet icon="RefreshCw" disabled={!active || running || requesting} onPress={() => void refresh()}>
          {running ? t("Updating…") : t("Refresh")}
        </Button>
      }
    >
      {latest ? (
        <ContentCard footer={<CardFootnote>{t("Updated {time}", { time: relativeTime(latest.at) })} · {modelLabel(latest.model)}</CardFootnote>}>
          <SummaryBody entry={hideTarget ? { ...latest, target: "" } : latest} />
        </ContentCard>
      ) : (
        <Label muted size={font.sm}>
          {running
            ? t("Writing the first summary…")
            : overview.data && !overview.data.enabled
              ? t("Auto summary is off. Turn it on with the settings button at the bottom left of the board, or press Refresh.")
              : t("Updates after each agent turn.")}
        </Label>
      )}
      {!!error && (
        <Label muted size={font.sm}>
          {t("Last update failed {time}: {error}", { time: relativeTime(error.at), error: error.message })}
        </Label>
      )}
    </Section>
  );
}

/** Each field in full: brevity comes from the prompt, never from cutting text (TASK-SUMMARY-SPEC §3, §7). */
export function SummaryBody({ entry }: { entry: Pick<SummaryEntry, "state" | "target" | "recap" | "next"> }) {
  return (
    <CardBody>
      {!!entry.state && <CardHeadline>{entry.state}</CardHeadline>}
      {!!entry.target && <CardField title={t("Target")} text={targetText(entry.target)} />}
      {!!entry.recap && <CardField title={t("Recap")} text={entry.recap} />}
      {!!entry.next && <CardField title={t("Next")} text={entry.next} />}
    </CardBody>
  );
}
