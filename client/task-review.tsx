import { memo, useState } from "react";
import { Pressable, View } from "react-native";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { useRpc } from "@getpaseo/plugin/client";
import { useQueryClient } from "@tanstack/react-query";
import * as rpc from "../shared/rpc";
import type { Project, Review, ReviewDraft, ReviewRule, RuleResult, Task } from "../shared/model";
import { GOAL_ID, autoReviewOf, autoReviewRuns, draftDiff, draftTaskId, outputTail, reviewProgress, rulePassed, ruleSummary } from "../shared/auto-review";
import { invalidateCardViews } from "./card-detail-query";
import { Section } from "./disclosure";
import { Button, IconButton, Label, Notice, font, message, noFocusRing, space, useTheme } from "./ui";
import { t, tn } from "../shared/i18n";

/** The review state on the card face and in the drawer header (AUTO-REVIEW-SPEC §7, §12.6). */
export function reviewLabel(review: Review): string {
  switch (review.state) {
    case "running": {
      const { done, total } = reviewProgress(review);
      return total ? t("Reviewing {done}/{total}", { done, total }) : t("Reviewing");
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

function ruleResultText(r: RuleResult): string {
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
function RuleRow({ rule }: { rule: RuleResult }) {
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
            {rule.id === GOAL_ID ? t("Does what you asked") : rule.name}
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

function RuleGroup({ title, rules }: { title: string; rules: RuleResult[] }) {
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
          {rules.every((r) => r.state === "skipped") ? t("Skipped") : `${ended.filter(rulePassed).length}/${rules.length}`}
        </Label>
      </View>
      {rules.map((rule) => (
        <RuleRow key={rule.id} rule={rule} />
      ))}
    </View>
  );
}

function DraftRule({ rule, before }: { rule: ReviewRule; before?: ReviewRule }) {
  return (
    <View style={{ gap: 1 }}>
      <Label size={font.md} lines={1}>
        {rule.name}
      </Label>
      {!!before && (
        <Label size={font.sm} muted mono lines={2}>
          {`− ${ruleSummary(before)}`}
        </Label>
      )}
      <Label size={font.sm} muted mono lines={2}>
        {before ? `+ ${ruleSummary(rule)}` : ruleSummary(rule)}
      </Label>
    </View>
  );
}

const cardRef = (id: string) => `#${id.slice(0, 4)}`;

/**
 * A proposed rule set waiting for Apply (AUTO-REVIEW-SPEC §6.4): from an agent, what it adds, changes and removes with
 * its note; from the history analysis (§6.2), the gate summary and the new checks, each of which can be left out.
 * Shown in the project settings and in the drawer of the card that proposed it.
 */
export function ReviewDraftBlock({
  project,
  onApplied,
  onOpenTask,
  commands,
}: {
  project: Project;
  onApplied?: () => void;
  onOpenTask?: (taskId: string) => void;
  /** Commands found in the repository, listed with the analysis's checks and added on Apply when ticked (§6.2). */
  commands?: readonly { name: string; argv: string[]; checked: boolean }[];
}) {
  const { colors } = useTheme();
  const draft = project.reviewDraft as ReviewDraft | undefined;
  const queryClient = useQueryClient();
  const toast = useToast();
  const applyRpc = useRpc(rpc.applyReviewDraft);
  const discardRpc = useRpc(rpc.discardReviewDraft);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  // The draft was replaced or removed after it was shown (§6.4): show the new one and say so.
  const [replaced, setReplaced] = useState<string | null>(null);
  const [left, setLeft] = useState<Record<string, boolean>>({});
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  if (!draft) return null;
  const current = autoReviewOf(project);
  const analysis = "analysis" in draft.by;
  const diff = draftDiff(current.rules, draft.rules);
  const byId = new Map(current.rules.map((r) => [r.id, r]));
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
      await invalidateCardViews(queryClient);
    } catch (e) {
      toast.show(message(e), { variant: "error" });
    } finally {
      setBusy(false);
    }
  };
  const stale = () => {
    setConfirm(false);
    setReplaced(draft.at);
  };
  const exclude = Object.keys(left).filter((id) => left[id]);
  const commandOn = (c: { argv: string[]; checked: boolean }) => ticked[c.argv.join(" ")] ?? c.checked;
  const add = (commands || []).filter(commandOn).map((c) => ({ name: c.name, argv: [...c.argv] }));
  const apply = (force: boolean) =>
    run(async () => {
      const result = await applyRpc({ projectId: project.id, at: draft.at, confirm: force, ...(exclude.length ? { exclude } : {}), ...(add.length ? { add } : {}) });
      if (result.status === "stale") return stale();
      if (result.status === "confirm") return setConfirm(true);
      setConfirm(false);
      onApplied?.();
    });
  const discard = () =>
    run(async () => {
      const result = await discardRpc({ projectId: project.id, at: draft.at });
      if (result.status === "stale") return stale();
      setConfirm(false);
    });
  const refs = (cards: readonly string[]) => (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[1.5] }}>
      {cards.slice(0, 6).map((id) => (
        <Pressable key={id} accessibilityRole="link" disabled={!onOpenTask} onPress={() => onOpenTask?.(id)} style={noFocusRing}>
          <Label size={font.sm} mono color={onOpenTask ? colors.accent : undefined} selectable={false}>
            {cardRef(id)}
          </Label>
        </Pressable>
      ))}
    </View>
  );
  const groups: [string, ReviewRule[], boolean][] = [
    [t("Added"), draft.rules.filter((r) => diff.added.includes(r.id)), false],
    [t("Changed"), draft.rules.filter((r) => diff.changed.includes(r.id)), true],
    [t("Removed"), current.rules.filter((r) => diff.removed.includes(r.id)), false],
  ];
  const goalChange = draft.goal !== undefined && draft.goal !== current.goal;
  return (
    <View style={{ gap: space[2] }}>
      <Label medium size={font.md} selectable={false}>
        {analysis ? t("Checks from past cards") : t("Proposed checks")}
      </Label>
      {analysis && draft.summary && (
        <View style={{ gap: space[1.5] }}>
          <Label size={font.sm} selectable>
            {t("{delivered} cards delivered in the last 90 days; you sent {reworked} back after delivery.", { delivered: draft.summary.delivered, reworked: draft.summary.reworked })}
          </Label>
          {!!draft.summary.dropped && (
            <Label size={font.sm} muted selectable={false}>
              {tn(draft.summary.dropped, "{n} suggested check did not fit: a project holds at most 10 of each kind.", "{n} suggested checks did not fit: a project holds at most 10 of each kind.")}
            </Label>
          )}
          {draft.summary.reasons.map((r) => (
            <View key={r.title} style={{ gap: 2 }}>
              <Label size={font.sm} selectable>
                {`${r.title} · ${tn(r.cards.length, "{n} card", "{n} cards")}`}
              </Label>
              {refs(r.cards)}
              {!!r.quote && (
                <Label size={font.sm} muted selectable>
                  {`「${r.quote}」`}
                </Label>
              )}
            </View>
          ))}
        </View>
      )}
      {!analysis && !!draft.note && (
        <Label size={font.sm} muted selectable>
          {draft.note}
        </Label>
      )}
      {analysis && !!commands && (draft.goal ?? current.goal) && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
          <Icon name="Target" size={15} color={colors.foregroundMuted} />
          <Label size={font.md}>{t("Does what you asked")}</Label>
        </View>
      )}
      {analysis &&
        (commands || []).map((c) => {
          const on = commandOn(c);
          const key = c.argv.join(" ");
          return (
            <Pressable
              key={key}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              onPress={() => setTicked({ ...ticked, [key]: !on })}
              style={{ ...noFocusRing, flexDirection: "row", alignItems: "center", gap: space[2] }}
            >
              <Icon name={on ? "SquareCheck" : "Square"} size={15} color={on ? colors.accent : colors.foregroundMuted} />
              <Label size={font.md}>{c.name}</Label>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Label size={font.sm} muted mono lines={1}>
                  {key}
                </Label>
              </View>
            </Pressable>
          );
        })}
      {analysis &&
        (draft.added || []).map((a) => {
          const rule = draft.rules.find((r) => r.id === a.id);
          if (!rule) return null;
          const on = !left[a.id];
          return (
            <View key={a.id} style={{ gap: 2 }}>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                onPress={() => setLeft({ ...left, [a.id]: on })}
                style={{ ...noFocusRing, flexDirection: "row", alignItems: "center", gap: space[2] }}
              >
                <Icon name={on ? "SquareCheck" : "Square"} size={15} color={on ? colors.accent : colors.foregroundMuted} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Label size={font.md} lines={1}>
                    {rule.name}
                  </Label>
                  <Label size={font.sm} muted mono lines={2}>
                    {ruleSummary(rule)}
                  </Label>
                </View>
                <Label size={font.sm} muted selectable={false}>
                  {tn(a.cards.length, "{n} card", "{n} cards")}
                </Label>
              </Pressable>
              <Label size={font.sm} muted selectable>
                {a.why}
              </Label>
            </View>
          );
        })}
      {analysis && !(draft.added || []).length && (
        <Label size={font.sm} muted selectable={false}>
          {t("No new checks from past cards.")}
        </Label>
      )}
      {!analysis &&
        groups.map(([title, rules, changed]) =>
          rules.length ? (
            <View key={title} style={{ gap: space[1] }}>
              <Label medium size={font.sm} muted selectable={false}>
                {title}
              </Label>
              {rules.map((rule) => (
                <DraftRule key={rule.id} rule={rule} before={changed ? byId.get(rule.id) : undefined} />
              ))}
            </View>
          ) : null,
        )}
      {!analysis && goalChange && (
        <Label size={font.sm} selectable={false}>
          {draft.goal ? t("Resumes Does what you asked.") : t("Pauses Does what you asked.")}
        </Label>
      )}
      {!analysis && !diff.added.length && !diff.changed.length && !diff.removed.length && !goalChange && (
        <Label size={font.sm} muted selectable={false}>
          {t("Same checks as now.")}
        </Label>
      )}
      {!!replaced && replaced !== draft.at && <Notice tone="warning">{t("The agent proposed a new draft. Review it before applying.")}</Notice>}
      {confirm && <Notice tone="warning">{t("The rules changed after this draft was proposed. Applying it replaces those changes.")}</Notice>}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
        <Button primary small disabled={busy} onPress={() => void apply(confirm)}>
          {confirm ? t("Apply anyway") : analysis ? (current.enabled ? t("Use these") : t("Use these and turn on")) : current.enabled ? t("Apply") : t("Apply and turn on")}
        </Button>
        <Button quiet small disabled={busy} onPress={() => void discard()}>
          {t("Discard")}
        </Button>
      </View>
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
  const ownDraft = draftTaskId(project.reviewDraft) === task.id;
  if (!review && !ownDraft) return null;
  const canRerun = !!review && !disabled && task.status === "in_review" && review.state !== "running" && autoReviewRuns(project, task);
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
      summary={review ? reviewLabel(review) : t("Proposed checks")}
      actions={canRerun ? <IconButton icon="RefreshCw" label={t("Rerun")} disabled={busy} onPress={() => void rerun()} /> : undefined}
    >
      {ownDraft && !disabled && <ReviewDraftBlock project={project} />}
      {!!review?.reason && (
        <Label size={font.sm} muted selectable>
          {review.reason}
        </Label>
      )}
      {review?.shared && (
        <Label size={font.sm} muted selectable={false}>
          {t("Ran in a shared workspace, with other cards' uncommitted changes.")}
        </Label>
      )}
      {!!review && <RuleGroup title={t("Commands")} rules={review.rules.filter((r) => r.kind === "command")} />}
      {!!review && <RuleGroup title={t("LLM review")} rules={review.rules.filter((r) => r.kind === "llm")} />}
    </Section>
  );
});
