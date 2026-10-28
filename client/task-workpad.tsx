import { useTaskDetail, invalidateCardViews } from "./card-detail-query";
import { perfStart, perfEnd, usePerfRender } from "./perf";
import { memo, useEffect, useMemo, useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { useRpc } from "@getpaseo/plugin/client";
import { useQueryClient } from "@tanstack/react-query";
import * as rpc from "../shared/rpc";
import type { AcceptanceItem, PlanSnapshot, Task } from "../shared/model";
import { plansOf } from "../shared/workpad";
import { useLiveAgents } from "./queries";
import { PagedRows, Section, ShowMore, pageSize, type SectionState } from "./disclosure";
import { FocusTarget, Marked, limitFor, useFocusTarget, useMark } from "./drawer-focus";
import { AiMark, Label, font, message, radius, relativeTime, space, touch, useTheme, noFocusRing } from "./ui";
import { t } from "../shared/i18n";

const firstPage = { acceptance: pageSize };

/**
 * Drawer "Workpad" (WORKPAD-SPEC §6.2, GUARDRAILS-SPEC §7.1): the agent's acceptance criteria and the plan from its
 * own todo list. People can tick criteria; edits are optimistic and never change the task revision.
 */
export const TaskWorkpad = memo(function TaskWorkpad({ task, disabled, active, section }: { task: Task; disabled: boolean; active: boolean; section: SectionState }) {
  usePerfRender("switch.workpad.commit");
  const switchStart = perfStart();
  const { detail } = useTaskDetail();
  const toast = useToast();
  const queryClient = useQueryClient();
  const checkRpc = useRpc(rpc.checkWorkpad);
  const workpad = detail?.workpad ?? undefined;
  const plans = useMemo(() => plansOf(detail?.plans || [], task.id), [detail?.plans, task.id]);
  // Optimistic edits by item id until the board shows them.
  const [pending, setPending] = useState<ReadonlyMap<string, Partial<Pick<AcceptanceItem, "done">>>>(
    () => new Map(),
  );
  const agentIds = plans.map((p) => p.agentId).concat(workpad?.agentId ? [workpad.agentId] : []);
  const titleKey = useLiveAgents({
    poll: false,
    select: (agents) => JSON.stringify(agents.filter((a) => agentIds.includes(a.id)).map((a) => [a.id, a.title || a.id])),
  }).data;
  const titles = useMemo(() => new Map<string, string>(titleKey ? JSON.parse(titleKey) : []), [titleKey]);
  // Long lists show 5 items, then Show more adds 5; per opening of the sidebar (DRAWER-SPEC, Section order).
  const [limit, setLimit] = useState(firstPage);
  useEffect(() => {
    if (active) setLimit(firstPage);
  }, [active]);
  const more = (group: keyof typeof firstPage) => setLimit((current) => ({ ...current, [group]: current[group] + pageSize }));
  // A search hit on an item past the first page shows the pages up to it (DRAWER-SPEC "Focus from search").
  const focusTarget = useFocusTarget();
  useEffect(() => {
    if (!focusTarget.startsWith("workpad:") || !workpad) return;
    const id = focusTarget.slice("workpad:".length);
    const groups: [keyof typeof firstPage, readonly { id: string }[]][] = [["acceptance", workpad.acceptance]];
    for (const [group, list] of groups) {
      const at = list.findIndex((item) => item.id === id);
      if (at >= 0) setLimit((current) => ({ ...current, [group]: limitFor(at, current[group], pageSize) }));
    }
  }, [focusTarget, workpad]);
  if (!workpad && !plans.length) return null;
  const edit = async (id: string, change: Partial<Pick<AcceptanceItem, "done">>, run: () => Promise<unknown>) => {
    setPending((current) => new Map(current).set(id, change));
    try {
      await run();
      await invalidateCardViews(queryClient);
    } catch (e) {
      toast.show(message(e), { variant: "error" });
    } finally {
      setPending((current) => {
        const next = new Map(current);
        next.delete(id);
        return next;
      });
    }
  };
  const acceptance = (workpad?.acceptance || []).map((a) => {
    const p = pending.get(a.id);
    return p && p.done !== undefined ? { ...a, done: p.done, by: "human" as const } : a;
  });
  const updatedBy = !workpad
    ? ""
    : workpad.updatedBy === "human"
      ? t("Updated {time} by you", { time: relativeTime(workpad.updatedAt) })
      : t("Updated {time} by {session}", { time: relativeTime(workpad.updatedAt), session: titles.get(workpad.agentId || "") || t("an agent") });
  perfEnd("switch.workpad.own", switchStart);
  return (
    <Section
      id={task.id}
      focusId="workpad"
      title={t("Workpad")}
      open={section.open}
      onToggle={section.onToggle}
      summary={acceptance.length ? t("Acceptance {done}/{total}", { done: acceptance.filter((a) => a.done).length, total: acceptance.length }) : ""}
    >
        {!!workpad && (
          <View>
            <Label size={font.sm} muted selectable={false}>
              {updatedBy}
            </Label>
          </View>
        )}
        {!!acceptance.length && (
          <Group title={t("Acceptance")}>
            <PagedRows items={acceptance} limit={limit.acceptance} render={(item) => (
              <FocusTarget key={item.id} id={`workpad:${item.id}`}>
              <AcceptanceRow
                item={item}
                disabled={disabled || pending.has(item.id)}
                onToggle={() =>
                  void edit(item.id, { done: !item.done }, () =>
                    checkRpc({ taskId: task.id, section: "acceptance", itemId: item.id, done: !item.done }),
                  )
                }
              />
              </FocusTarget>
            )} />
            {acceptance.length > limit.acceptance && <ShowMore count={Math.min(pageSize, acceptance.length - limit.acceptance)} onPress={() => more("acceptance")} />}
          </Group>
        )}
        {!!plans.length && (
          <Group title={t("Plan")} note={t("From the agent's todo list · updated at turn end")}>
            {plans.map((plan) => (
              <PlanList key={plan.agentId} plan={plan} title={plans.length > 1 ? titles.get(plan.agentId) || t("Session") : ""} />
            ))}
          </Group>
        )}
    </Section>
  );
});

function Group({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <View style={{ gap: 2 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[1.5] }}>
        <Label muted size={font.xs} bold selectable={false}>
          {title}
        </Label>
        {!!note && (
          <Label muted size={font.xs} lines={1} selectable={false}>
            {note}
          </Label>
        )}
      </View>
      {children}
    </View>
  );
}

const rowStyle = () => ({ flexDirection: "row", alignItems: "flex-start", gap: space[2], paddingVertical: 3 }) as const;

function Box({ checked }: { checked: boolean }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        width: 16,
        height: 16,
        marginTop: 1,
        borderRadius: radius.sm,
        borderWidth: 1.5,
        borderColor: checked ? colors.accent : colors.foregroundMuted,
        backgroundColor: checked ? colors.accent : "transparent",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {checked && <Icon name="Check" size={12} color={colors.accentForeground} />}
    </View>
  );
}

function ByYou({ by }: { by: "agent" | "human" }) {
  return by === "human" ? (
    <Label size={font.sm} muted selectable={false}>
      {t("by you")}
    </Label>
  ) : null;
}

function AcceptanceRow({ item, disabled, onToggle }: { item: AcceptanceItem; disabled: boolean; onToggle(): void }) {
  const mark = useMark(`workpad:${item.id}`);
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={item.text}
      accessibilityState={{ checked: item.done, disabled }}
      aria-checked={item.done}
      disabled={disabled}
      onPress={onToggle}
      style={({ pressed }) => ({ ...noFocusRing, ...rowStyle(), minHeight: touch ? 36 : undefined, opacity: pressed ? 0.7 : 1 })}
    >
      <Box checked={item.done} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Label size={font.md}><Marked text={item.text} terms={mark?.terms} /></Label>
      </View>
      <ByYou by={item.by} />
    </Pressable>
  );
}

function PlanList({ plan, title }: { plan: PlanSnapshot; title: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: 1 }}>
      {!!title && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: space[1] }}>
          <AiMark size={11} />
          <Label size={font.xs} muted lines={1} selectable={false}>
            {title}
          </Label>
        </View>
      )}
      {plan.items.map((item, index) => (
        <View key={index} style={{ ...rowStyle(), paddingVertical: 1 }}>
          <View style={{ marginTop: 1 }}>
            <Icon
              name={item.status === "completed" ? "CircleCheck" : item.status === "in_progress" ? "CircleDot" : "Circle"}
              size={14}
              color={item.status === "completed" ? colors.statusSuccess : item.status === "in_progress" ? colors.accent : colors.foregroundMuted}
            />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Label size={font.md} muted={item.status === "completed"}>
              {item.text}
            </Label>
          </View>
        </View>
      ))}
    </View>
  );
}
