import { useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { autoReviewLimits, taskTypeLabels, taskTypes, type ReviewRule, type TaskType } from "../shared/model";
import { GOAL_ID, joinCommand, ruleId, splitCommand } from "../shared/auto-review";
import { Button, Choices, Field, Label, Toggle, font, noFocusRing, radius, space, tint, useTheme } from "./ui";
import { t } from "../shared/i18n";

/**
 * The project's review rules as the settings form edits them (AUTO-REVIEW-SPEC §12.6): a command is one line split like
 * a command line (no shell), a prompt is free text. Turned back into rules on save; empty ones are reported, not saved.
 */
export type EditRule = { id: string; name: string; kind: "command" | "llm"; command: string; prompt: string; types: TaskType[]; off: boolean; timeoutSec?: number };

export const toEditRules = (rules: readonly ReviewRule[]): EditRule[] =>
  rules.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    command: r.kind === "command" ? joinCommand(r.argv) : "",
    prompt: r.kind === "llm" ? r.prompt : "",
    types: [...(r.types || [])],
    off: !!r.off,
    ...(r.kind === "command" && r.timeoutSec ? { timeoutSec: r.timeoutSec } : {}),
  }));

/** Rules from the editor, or the first problem to show. */
export function fromEditRules(rules: readonly EditRule[]): { rules: ReviewRule[] } | { problem: string } {
  const out: ReviewRule[] = [];
  for (const r of rules) {
    const name = r.name.trim();
    if (!name) return { problem: t("Every check needs a name.") };
    const base = { id: r.id, name: name.slice(0, autoReviewLimits.name), ...(r.types.length ? { types: r.types } : {}), ...(r.off ? { off: true as const } : {}) };
    if (r.kind === "command") {
      const argv = splitCommand(r.command);
      if (!argv.length) return { problem: t("{name} needs a command.", { name }) };
      out.push({ ...base, kind: "command", argv, ...(r.timeoutSec ? { timeoutSec: r.timeoutSec } : {}) });
    } else {
      const prompt = r.prompt.trim();
      if (!prompt) return { problem: t("{name} needs a prompt.", { name }) };
      out.push({ ...base, kind: "llm", prompt: prompt.slice(0, autoReviewLimits.prompt) });
    }
  }
  if (out.filter((r) => r.kind === "command").length > autoReviewLimits.commandRules) return { problem: t("At most 10 command checks.") };
  if (out.filter((r) => r.kind === "llm").length > autoReviewLimits.llmRules) return { problem: t("At most 10 LLM checks.") };
  return { rules: out };
}

function RuleEditor({ rule, onChange, onRemove }: { rule: EditRule; onChange(next: EditRule): void; onRemove(): void }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: space[3], paddingLeft: space[5], paddingBottom: space[2] }}>
      <Field title={t("Name")} value={rule.name} onChange={(name) => onChange({ ...rule, name })} />
      <Choices
        title={t("Kind")}
        value={rule.kind}
        options={[
          { value: "command", label: t("Command") },
          { value: "llm", label: t("LLM") },
        ]}
        onChange={(kind) => onChange({ ...rule, kind })}
      />
      {rule.kind === "command" ? (
        <Field title={t("Command")} value={rule.command} onChange={(command) => onChange({ ...rule, command })} placeholder="npm test" />
      ) : (
        <Field title={t("Prompt")} value={rule.prompt} onChange={(prompt) => onChange({ ...rule, prompt })} multiline />
      )}
      <View style={{ gap: space[1.5] }}>
        <Label medium size={font.sm} muted>
          {t("Card types")}
        </Label>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[1.5] }}>
          {taskTypes.map((type) => {
            const on = rule.types.includes(type);
            return (
              <Pressable
                key={type}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                onPress={() => onChange({ ...rule, types: on ? rule.types.filter((x) => x !== type) : [...rule.types, type] })}
                style={{
                  ...noFocusRing,
                  paddingHorizontal: space[2],
                  paddingVertical: 3,
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderColor: on ? colors.accent : colors.border,
                  backgroundColor: on ? tint(colors.accent, 0.1) : undefined,
                }}
              >
                <Label size={font.sm} color={on ? colors.accent : undefined} selectable={false}>
                  {taskTypeLabels[type]}
                </Label>
              </Pressable>
            );
          })}
        </View>
      </View>
      <Toggle title={t("Paused")} value={rule.off} onChange={(off) => onChange({ ...rule, off })} />
      <View style={{ flexDirection: "row" }}>
        <Button quiet small danger onPress={onRemove}>
          {t("Remove check")}
        </Button>
      </View>
    </View>
  );
}

/**
 * The check list (AUTO-REVIEW-SPEC §9.3): the built-in check first (it can only be paused), then a row per rule, tap to
 * edit; Add check and the caller's other actions at the end.
 */
export function ReviewRuleList({
  rules,
  onChange,
  goal,
  onGoal,
  actions,
}: {
  rules: EditRule[];
  onChange(next: EditRule[]): void;
  goal: boolean;
  onGoal(next: boolean): void;
  actions?: ReactNode;
}) {
  const { colors } = useTheme();
  const [editing, setEditing] = useState<string | null>(null);
  const update = (id: string, next: EditRule) => onChange(rules.map((r) => (r.id === id ? next : r)));
  return (
    <View style={{ gap: space[2] }}>
      <Label medium size={font.sm} muted>
        {t("Checks")}
      </Label>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], opacity: goal ? 1 : 0.55 }}>
        <Icon name="Target" size={15} color={colors.foregroundMuted} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Label size={font.md} lines={1}>
            {t("Does what you asked")}
          </Label>
        </View>
        <Button quiet small onPress={() => onGoal(!goal)}>
          {goal ? t("Pause") : t("Resume")}
        </Button>
      </View>
      {rules.map((rule) => {
        const summary = [rule.kind === "command" ? rule.command : rule.prompt.split("\n")[0], rule.types.map((x) => taskTypeLabels[x]).join(", ")].filter(Boolean).join(" · ");
        return (
          <View key={rule.id} style={{ gap: space[2], opacity: rule.off ? 0.55 : 1 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: editing === rule.id }}
              accessibilityLabel={t("Edit {name}", { name: rule.name || rule.id })}
              onPress={() => setEditing(editing === rule.id ? null : rule.id)}
              style={{ ...noFocusRing, flexDirection: "row", alignItems: "center", gap: space[2] }}
            >
              <Icon name={rule.kind === "command" ? "SquareTerminal" : "Sparkles"} size={15} color={colors.foregroundMuted} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Label size={font.md} lines={1}>
                  {rule.name || rule.id}
                </Label>
                {!!summary && (
                  <Label size={font.sm} muted mono={rule.kind === "command"} lines={1}>
                    {summary}
                  </Label>
                )}
              </View>
              <Icon name={editing === rule.id ? "ChevronUp" : "ChevronDown"} size={15} color={colors.foregroundMuted} />
            </Pressable>
            {editing === rule.id && (
              <RuleEditor
                rule={rule}
                onChange={(next) => update(rule.id, next)}
                onRemove={() => {
                  onChange(rules.filter((r) => r.id !== rule.id));
                  setEditing(null);
                }}
              />
            )}
          </View>
        );
      })}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
        <Button
          quiet
          small
          icon="Plus"
          disabled={rules.length >= autoReviewLimits.commandRules + autoReviewLimits.llmRules}
          onPress={() => {
            const id = ruleId("check", new Set([GOAL_ID, ...rules.map((r) => r.id)]));
            onChange([...rules, { id, name: "", kind: "command", command: "", prompt: "", types: [], off: false }]);
            setEditing(id);
          }}
        >
          {t("Add check")}
        </Button>
        {actions}
      </View>
    </View>
  );
}
