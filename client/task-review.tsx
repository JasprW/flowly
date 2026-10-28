import { memo, useState } from "react";
import { Pressable, View } from "react-native";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { useRpc } from "@getpaseo/plugin/client";
import { useQueryClient } from "@tanstack/react-query";
import * as rpc from "../shared/rpc";
import type { Project, Review, ReviewItem, Task } from "../shared/model";
import { autoReviewRuns, itemPassed, outputTail, reviewProgress } from "../shared/auto-review";
import { invalidateCardViews } from "./card-detail-query";
import { Section } from "./disclosure";
import { IconButton, Label, font, message, noFocusRing, space, useTheme } from "./ui";
import { t } from "../shared/i18n";

/** The review state on the card face and in the drawer header (AUTO-REVIEW-SPEC §7, §12.6). */
export function reviewLabel(review: Review): string {
  switch (review.state) {
    case "running": {
      const { passed, failed, total } = reviewProgress(review);
      return total ? t("Reviewing {done}/{total}", { done: passed + failed, total }) : t("Reviewing");
    }
    case "passed":
      return t("Review passed");
    case "rework":
      return t("Reworking {round}/{max}", { round: review.round, max: review.maxRounds });
    case "failed":
      return t("Review failed");
    case "unavailable":
      return t("Review unavailable");
    default:
      return t("Review cancelled");
  }
}

export function reviewIcon(review: Review): string {
  return review.state === "running" ? "Loader" : review.state === "passed" ? "ShieldCheck" : review.state === "rework" ? "RotateCcw" : review.state === "failed" ? "ShieldAlert" : "CircleHelp";
}

const seconds = (ms: number) => t("{n} s", { n: Math.max(1, Math.round(ms / 1000)) });

function ruleResultText(r: ReviewItem): string {
  switch (r.state) {
    case "queued":
    case "running":
      return "";
    case "na":
      return t("Not applicable");
    case "skipped":
      return t("Skipped");
    case "unavailable":
      return r.timedOut ? t("Timed out") : t("Unavailable");
    case "failed":
      if (r.kind === "command") return r.exitCode === null || r.exitCode === undefined ? t("Stopped") : t("Exit {code}", { code: r.exitCode });
      return r.ms ? seconds(r.ms) : "";
    default:
      return r.ms ? seconds(r.ms) : "";
  }
}

/** One rule's row (§12.6): icon, name, time or result; failures open with their output or reasoning. */
function RuleRow({ rule }: { rule: ReviewItem }) {
  const { colors } = useTheme();
  const body = rule.state === "failed" || rule.state === "unavailable" ? rule.tail || rule.detail || rule.reason : rule.detail || (rule.state === "skipped" ? rule.reason : undefined);
  // Unset until the user toggles, so a row that fails while the drawer is open still opens.
  const [toggled, setOpen] = useState<boolean | null>(null);
  const open = toggled ?? rule.state === "failed";
  const icon =
    rule.state === "passed"
      ? { name: "CircleCheck", color: colors.statusSuccess }
      : rule.state === "failed"
        ? { name: "CircleX", color: colors.statusDanger }
        : rule.state === "running"
          ? { name: "Loader", color: colors.accent }
          : rule.state === "na"
            ? { name: "CircleMinus", color: colors.foregroundMuted }
            : rule.state === "unavailable"
              ? { name: "CircleHelp", color: colors.statusWarning }
              : { name: "CircleDashed", color: colors.foregroundMuted };
  const where = rule.file ? `${rule.file}${rule.line ? `:${rule.line}` : ""}` : "";
  const result = ruleResultText(rule);
  return (
    <View style={{ gap: 2 }}>
      <Pressable
        accessibilityRole={body ? "button" : undefined}
        accessibilityState={body ? { expanded: open } : undefined}
        disabled={!body}
        onPress={() => setOpen(!open)}
        style={{ ...noFocusRing, flexDirection: "row", alignItems: "center", gap: space[1.5] }}
      >
        <Icon name={icon.name} size={16} color={icon.color} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Label size={font.md} lines={1}>
            {rule.kind === "goal" ? t("Does what you asked") : rule.name}
          </Label>
        </View>
        {!!result && (
          <Label size={font.sm} muted selectable={false}>
            {result}
          </Label>
        )}
      </Pressable>
      {open && !!body && (
        <View style={{ paddingLeft: 16 + space[1.5], gap: 2 }}>
          {!!where && (
            <Label size={font.sm} muted mono selectable>
              {where}
            </Label>
          )}
          <Label size={font.sm} muted mono={!!rule.tail} selectable>
            {rule.tail ? outputTail(rule.tail, 1500) : body}
          </Label>
        </View>
      )}
    </View>
  );
}

function RuleGroup({ title, rules }: { title: string; rules: ReviewItem[] }) {
  if (!rules.length) return null;
  const ended = rules.filter((r) => r.state !== "queued" && r.state !== "running" && r.state !== "skipped");
  return (
    <View style={{ gap: space[1.5] }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
        <View style={{ flex: 1 }}>
          <Label medium size={font.sm} muted selectable={false}>
            {title}
          </Label>
        </View>
        <Label size={font.sm} muted selectable={false}>
          {rules.every((r) => r.state === "skipped") ? t("Skipped") : `${ended.filter(itemPassed).length}/${rules.length}`}
        </Label>
      </View>
      {rules.map((rule) => (
        <RuleRow key={rule.id} rule={rule} />
      ))}
    </View>
  );
}

/**
 * Drawer "Auto review" below the Workpad (AUTO-REVIEW-SPEC §7, §12.6): the latest review's rules in two groups,
 * Commands and LLM review, Rerun while the card is in review, and the draft this card proposed.
 */
export const TaskReview = memo(function TaskReview({ task, project, disabled }: { task: Task; project: Project; disabled: boolean }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const rerunRpc = useRpc(rpc.rerunReview);
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const review = task.review;
  if (!review) return null;
  const canRerun = !disabled && task.status === "in_review" && review.state !== "running" && autoReviewRuns(project);
  const rerun = async () => {
    setBusy(true);
    try {
      await rerunRpc({ taskId: task.id });
      await invalidateCardViews(queryClient);
    } catch (e) {
      toast.show(message(e), { variant: "error" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section
      id={`${task.id}:review`}
      title={t("Auto review")}
      open={open}
      onToggle={() => setOpen(!open)}
      summary={reviewLabel(review)}
      actions={canRerun ? <IconButton icon="RefreshCw" label={t("Rerun")} disabled={busy} onPress={() => void rerun()} /> : undefined}
    >
      {!!review.reason && (
        <Label size={font.sm} muted selectable>
          {review.reason}
        </Label>
      )}
      {review.shared && (
        <Label size={font.sm} muted selectable={false}>
          {t("Ran in a shared workspace, with other cards' uncommitted changes.")}
        </Label>
      )}
      <RuleGroup title={t("Commands")} rules={review.items.filter((r) => r.kind === "command")} />
      <RuleGroup title={t("LLM review")} rules={review.items.filter((r) => r.kind !== "command")} />
    </Section>
  );
});
