import { useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useRpc } from "@getpaseo/plugin/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as rpc from "../shared/rpc";
import type { Project } from "../shared/model";
import { joinCommand, ruleId, GOAL_ID } from "../shared/auto-review";
import { ReviewRuleList, type EditRule } from "./review-rules";
import { ReviewDraftBlock } from "./task-review";
import { invalidateCardViews } from "./card-detail-query";
import { Button, Choices, Field, Label, Notice, Toggle, font, message, noFocusRing, radius, space, useTheme } from "./ui";
import { t } from "../shared/i18n";

export type ReviewEdit = {
  on: boolean;
  goal: boolean;
  rules: EditRule[];
  guidance: string;
  rounds: string;
};

/**
 * Edit project → Auto review (AUTO-REVIEW-SPEC §9.3): the switch, the draft, the commands found in the repository when
 * there are none yet (§6.1), the checks, Suggest checks from past cards (§6.2), Adjust with AI, guidance and rounds.
 */
export function AutoReviewSection({
  project,
  value,
  onChange,
  analyze,
  onAdjust,
  adjusting,
  onApplied,
  onOpenTask,
}: {
  project: Project;
  value: ReviewEdit;
  onChange(next: ReviewEdit): void;
  /** Opened from What's new or the Insights nudge: start the history analysis right away. */
  analyze?: boolean;
  onAdjust(): void;
  adjusting: boolean;
  onApplied(): void;
  onOpenTask?: (taskId: string) => void;
}) {
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const detect = useRpc(rpc.detectReviewCommands);
  const start = useRpc(rpc.analyzeReviewHistory);
  const readStatus = useRpc(rpc.reviewAnalysisStatus);
  const [insufficient, setInsufficient] = useState(false);
  const [startError, setStartError] = useState("");
  const [used, setUsed] = useState(false);
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const set = (patch: Partial<ReviewEdit>) => onChange({ ...value, ...patch });
  const hasCommands = value.rules.some((r) => r.kind === "command");
  const status = useQuery({
    queryKey: ["flowly", "review-analysis", project.id],
    queryFn: () => readStatus({ projectId: project.id }),
    staleTime: 0,
    // Only while a run is going: it ends in a draft, which the board read brings.
    refetchInterval: (q) => (q.state.data?.state === "running" ? 3000 : false),
  });
  const running = status.data?.state === "running";
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !running) void invalidateCardViews(queryClient);
    wasRunning.current = running;
  }, [running, queryClient]);
  // §6.2: with the switch off, an analysis draft lists the found commands with its checks behind one button.
  const merged = !value.on && !!project.reviewDraft && "analysis" in project.reviewDraft.by;
  // §6.1: commands from the repository, when the switch is on and no command check exists yet, or for the analysis view.
  const wantDetect = !used && !hasCommands && (value.on || !!analyze || insufficient || merged);
  const found = useQuery({
    queryKey: ["flowly", "review-detect", project.id],
    queryFn: () => detect({ projectId: project.id }),
    enabled: wantDetect,
    staleTime: 60_000,
  });
  const runAnalysis = async () => {
    setStartError("");
    try {
      const result = await start({ projectId: project.id });
      setInsufficient(result.status === "insufficient");
      await status.refetch();
    } catch (e) {
      setStartError(message(e));
    }
  };
  const asked = useRef(false);
  useEffect(() => {
    if (analyze && !asked.current) {
      asked.current = true;
      void runAnalysis();
    }
    // Once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analyze]);
  const commands = found.data?.commands ?? [];
  const isTicked = (i: number) => ticked[i] ?? commands[i]!.checked;
  const useThese = () => {
    const taken = new Set([GOAL_ID, ...value.rules.map((r) => r.id)]);
    const have = new Set(value.rules.filter((r) => r.kind === "command").map((r) => r.command));
    const added: EditRule[] = [];
    commands.forEach((c, i) => {
      const command = joinCommand(c.argv);
      if (!isTicked(i) || have.has(command)) return;
      const id = ruleId(c.name, taken);
      taken.add(id);
      added.push({ id, name: c.name, kind: "command", command, prompt: "", types: [], off: false });
    });
    set({ on: true, rules: [...value.rules, ...added] });
    setUsed(true);
  };
  const judged = value.goal || value.rules.some((r) => r.kind === "llm" && !r.off);
  return (
    <View style={{ gap: space[3] }}>
      <Toggle
        title={t("Auto review")}
        detail={`${t("When an agent delivers a card to In review, Flowly runs these checks in the card's workspace. A failure sends the card back to its work stage with a rework message to that session; past the limit it goes to Blocked.")}${judged ? ` ${t("Every delivery runs an LLM review and uses tokens.")}` : ""}`}
        value={value.on}
        onChange={(on) => set({ on })}
      />
      {project.reviewDraft && <ReviewDraftBlock project={project} onApplied={onApplied} onOpenTask={onOpenTask} commands={merged && wantDetect ? commands : undefined} />}
      {running && (
        <Label size={font.sm} muted selectable={false}>
          {t("Analyzing past cards… uses tokens")}
        </Label>
      )}
      {status.data?.state === "failed" && !running && (
        <Notice tone="warning">{t("The analysis failed: {error}", { error: status.data.error || t("unknown error") })}</Notice>
      )}
      {!!startError && <Notice tone="warning">{startError}</Notice>}
      {insufficient && !running && <Notice tone="info">{t("Not enough past deliveries in this project yet.")}</Notice>}
      {wantDetect && !merged && commands.length > 0 && (
        <View style={{ gap: space[1.5], padding: space[3], borderRadius: radius.md, borderWidth: 1, borderColor: colors.border }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
            <Icon name="Target" size={15} color={colors.foregroundMuted} />
            <Label size={font.md}>{t("Does what you asked")}</Label>
          </View>
          {commands.map((c, i) => (
            <Pressable
              key={joinCommand(c.argv)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: isTicked(i) }}
              onPress={() => setTicked({ ...ticked, [i]: !isTicked(i) })}
              style={{ ...noFocusRing, flexDirection: "row", alignItems: "center", gap: space[2] }}
            >
              <Icon name={isTicked(i) ? "SquareCheck" : "Square"} size={15} color={isTicked(i) ? colors.accent : colors.foregroundMuted} />
              <Label size={font.md}>{c.name}</Label>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Label size={font.sm} muted mono lines={1}>
                  {joinCommand(c.argv)}
                </Label>
              </View>
            </Pressable>
          ))}
          <View style={{ flexDirection: "row" }}>
            <Button small primary onPress={useThese}>
              {t("Use these")}
            </Button>
          </View>
        </View>
      )}
      {value.on && (
        <ReviewRuleList
          rules={value.rules}
          onChange={(rules) => set({ rules })}
          goal={value.goal}
          onGoal={(goal) => set({ goal })}
          actions={
            <>
              {status.data?.eligible && (
                <Button quiet small icon="History" disabled={running} onPress={() => void runAnalysis()}>
                  {status.data?.state === "failed" ? t("Retry") : t("Suggest checks from past cards")}
                </Button>
              )}
              <Button quiet small icon="Sparkles" disabled={adjusting} onPress={onAdjust}>
                {t("Adjust with AI")}
              </Button>
            </>
          }
        />
      )}
      {!value.on && (
        <View style={{ flexDirection: "row" }}>
          <Button quiet small icon="Sparkles" disabled={adjusting} onPress={onAdjust}>
            {t("Adjust with AI")}
          </Button>
        </View>
      )}
      {value.on && judged && <Field title={t("Review guidance")} value={value.guidance} onChange={(guidance) => set({ guidance })} multiline />}
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

