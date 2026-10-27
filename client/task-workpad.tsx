import { useTaskDetail, invalidateCardViews } from "./card-detail-query";
import { perfStart, perfEnd, usePerfRender } from "./perf";
import { memo, useEffect, useMemo, useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { useRpc } from "@getpaseo/plugin/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as rpc from "../shared/rpc";
import type { AcceptanceItem, CheckState, ConfusionItem, PlanSnapshot, Task, ValidationItem, Workpad } from "../shared/model";
import { plansOf, validationFreshness, workpadOf } from "../shared/workpad";
import { useLiveAgents } from "./queries";
import { Collapse, PagedRows, Section, ShowMore, pageSize, type SectionState } from "./disclosure";
import { FocusTarget, limitFor, useFocusTarget } from "./drawer-focus";
import { AiMark, IconButton, Label, font, message, radius, relativeTime, space, touch, useTheme, noFocusRing } from "./ui";
import { t } from "../shared/i18n";

const firstPage = { acceptance: pageSize, checks: pageSize, confusions: pageSize };

/** What needs a look first: failed, out of date, not run, then passed (stable within each). */
function checkOrder<T extends ValidationItem>(checks: readonly T[], head: Workpad["head"]): T[] {
  return checks
    .map((item, index) => ({ item, index, rank: item.state === "fail" ? 0 : item.state === "unrun" ? 2 : validationFreshness(item, head) === "stale" ? 1 : 3 }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((x) => x.item);
}

/** The next state when a person taps a check's status (WORKPAD-SPEC §6.3). */
const nextState: Record<CheckState, CheckState> = { unrun: "pass", pass: "fail", fail: "unrun" };

/** Home directory shortened for display; the full path stays selectable in the stamp. */
const shortPath = (path: string) => path.replace(/^\/(Users|home)\/[^/]+/, "~");

/**
 * Drawer "Workpad" (WORKPAD-SPEC §6.2): the agent's acceptance criteria and
 * checks, the plan from its own todo list and what confused it. People can
 * tick criteria, set a check's state and resolve confusions; edits are
 * optimistic and never change the task revision.
 */
export const TaskWorkpad = memo(function TaskWorkpad({ task, disabled, active, section }: { task: Task; disabled: boolean; active: boolean; section: SectionState }) {
  usePerfRender("switch.workpad.commit");
  const switchStart = perfStart();
  const { detail } = useTaskDetail();
  const toast = useToast();
  const queryClient = useQueryClient();
  const checkRpc = useRpc(rpc.checkWorkpad);
  const resolveRpc = useRpc(rpc.resolveConfusion);
  const refreshRpc = useRpc(rpc.refreshWorkpad);
  const workpad = detail?.workpad ?? undefined;
  const plans = useMemo(() => plansOf(detail?.plans || [], task.id), [detail?.plans, task.id]);
  // Optimistic edits by item id until the board shows them.
  const [pending, setPending] = useState<ReadonlyMap<string, Partial<Pick<AcceptanceItem, "done"> & Pick<ValidationItem, "state">> | "removed">>(
    () => new Map(),
  );
  const agentIds = plans.map((p) => p.agentId).concat(workpad?.agentId ? [workpad.agentId] : []);
  const titleKey = useLiveAgents({
    poll: false,
    select: (agents) => JSON.stringify(agents.filter((a) => agentIds.includes(a.id)).map((a) => [a.id, a.title || a.id])),
  }).data;
  const titles = useMemo(() => new Map<string, string>(titleKey ? JSON.parse(titleKey) : []), [titleKey]);
  // A fresh HEAD when the section shows, so out-of-date checks are current (§5.2).
  const head = useQuery({
    queryKey: ["flowly", "workpad-head", task.id],
    queryFn: () => refreshRpc({ taskId: task.id }),
    enabled: active && !!workpad?.validation.some((v) => v.state !== "unrun"),
    staleTime: 30_000,
    retry: false,
  });
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
    const groups: [keyof typeof firstPage, readonly { id: string }[]][] = [
      ["acceptance", workpad.acceptance],
      ["checks", checkOrder(workpad.validation, workpad.head)],
      ["confusions", workpad.confusions],
    ];
    for (const [group, list] of groups) {
      const at = list.findIndex((item) => item.id === id);
      if (at >= 0) setLimit((current) => ({ ...current, [group]: limitFor(at, current[group], pageSize) }));
    }
  }, [focusTarget, workpad]);
  const storedSha = workpad?.head?.sha || "",
    storedDirty = !!workpad?.head?.dirty;
  useEffect(() => {
    if (!head.data) return;
    if ((head.data.head?.sha || "") !== storedSha || !!head.data.head?.dirty !== storedDirty)
      void invalidateCardViews(queryClient);
  }, [head.data, storedSha, storedDirty, queryClient]);
  if (!workpad && !plans.length) return null;
  const edit = async (id: string, change: Partial<Pick<AcceptanceItem, "done"> & Pick<ValidationItem, "state">> | "removed", run: () => Promise<unknown>) => {
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
    return p && p !== "removed" && p.done !== undefined ? { ...a, done: p.done, by: "human" as const } : a;
  });
  const checks = (workpad?.validation || []).map((v) => {
    const p = pending.get(v.id);
    return p && p !== "removed" && p.state ? { ...v, state: p.state, by: "human" as const } : v;
  });
  const shownChecks = checkOrder(checks, workpad!.head);
  const confusions = (workpad?.confusions || []).filter((c) => pending.get(c.id) !== "removed");
  const updatedBy = !workpad
    ? ""
    : workpad.updatedBy === "human"
      ? t("Updated {time} by you", { time: relativeTime(workpad.updatedAt) })
      : t("Updated {time} by {session}", { time: relativeTime(workpad.updatedAt), session: titles.get(workpad.agentId || "") || t("an agent") });
  const stamp = workpad?.env
    ? `${workpad.env.host}:${shortPath(workpad.env.path)}${workpad.env.head?.sha ? `@${workpad.env.head.sha.slice(0, 7)}${workpad.env.head.dirty ? "*" : ""}` : ""}`
    : "";
  perfEnd("switch.workpad.own", switchStart);
  return (
    <Section
      id={task.id}
      focusId="workpad"
      title={t("Workpad")}
      open={section.open}
      onToggle={section.onToggle}
      summary={[
        acceptance.length ? t("Acceptance {done}/{total}", { done: acceptance.filter((a) => a.done).length, total: acceptance.length }) : "",
        checks.length ? t("Checks {done}/{total}", { done: checks.filter((c) => c.state === "pass").length, total: checks.length }) : "",
      ].filter(Boolean).join(" · ")}
    >
        {!!workpad && (
          <View>
            {!!stamp && (
              <Label size={font.sm} muted mono selectable lines={1}>
                {stamp}
              </Label>
            )}
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
        {!!checks.length && (
          <Group title={t("Checks")}>
            <PagedRows items={shownChecks} limit={limit.checks} render={(item) => (
              <FocusTarget key={item.id} id={`workpad:${item.id}`}>
              <CheckRow
                item={item}
                workpad={workpad!}
                disabled={disabled || pending.has(item.id)}
                onCycle={() =>
                  void edit(item.id, { state: nextState[item.state] }, () =>
                    checkRpc({ taskId: task.id, section: "validation", itemId: item.id, state: nextState[item.state] }),
                  )
                }
              />
              </FocusTarget>
            )} />
            {shownChecks.length > limit.checks && <ShowMore count={Math.min(pageSize, shownChecks.length - limit.checks)} onPress={() => more("checks")} />}
          </Group>
        )}
        {!!plans.length && (
          <Group title={t("Plan")} note={t("From the agent's todo list · updated at turn end")}>
            {plans.map((plan) => (
              <PlanList key={plan.agentId} plan={plan} title={plans.length > 1 ? titles.get(plan.agentId) || t("Session") : ""} />
            ))}
          </Group>
        )}
        {!!confusions.length && (
          <Group title={t("Confusions")}>
            <PagedRows items={confusions} limit={limit.confusions} render={(item) => (
              <FocusTarget key={item.id} id={`workpad:${item.id}`}>
              <ConfusionRow
                item={item}
                disabled={disabled || pending.has(item.id)}
                onResolve={() => void edit(item.id, "removed", () => resolveRpc({ taskId: task.id, itemId: item.id }))}
              />
              </FocusTarget>
            )} />
            {confusions.length > limit.confusions && <ShowMore count={Math.min(pageSize, confusions.length - limit.confusions)} onPress={() => more("confusions")} />}
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
        <Label size={font.md}>{item.text}</Label>
      </View>
      <ByYou by={item.by} />
    </Pressable>
  );
}

function stateLabel(item: ValidationItem, stale: boolean) {
  if (item.state === "fail") return t("failed");
  if (item.state === "unrun") return t("not run");
  return stale ? t("out of date") : t("passed");
}

function CheckRow({ item, workpad, disabled, onCycle }: { item: ValidationItem; workpad: Workpad; disabled: boolean; onCycle(): void }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const stale = validationFreshness(item, workpad.head) === "stale";
  const icon =
    item.state === "pass"
      ? { name: stale ? "TriangleAlert" : "CircleCheck", color: stale ? colors.statusWarning : colors.statusSuccess }
      : item.state === "fail"
        ? { name: "CircleX", color: colors.statusDanger }
        : { name: "CircleDashed", color: colors.foregroundMuted };
  const details = [
    item.sha ? `@${item.sha.slice(0, 7)}` : "",
    item.dirty ? t("on uncommitted changes") : "",
    item.ranAt && item.state !== "unrun" ? relativeTime(item.ranAt) : "",
  ].filter(Boolean);
  return (
    <View style={rowStyle()}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${item.text}: ${stateLabel(item, stale)}`}
        accessibilityHint={t("Changes the check: passed, failed, not run.")}
        accessibilityState={{ disabled }}
        disabled={disabled}
        hitSlop={8}
        onPress={onCycle}
        style={({ pressed }) => ({ ...noFocusRing, marginTop: 1, opacity: pressed ? 0.6 : 1 })}
      >
        <Icon name={icon.name} size={16} color={icon.color} />
      </Pressable>
      <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
        <Label size={font.md}>{item.text}</Label>
        {!!item.command && (
          // One line until the output is shown (or the command is tapped), so long commands don't fill the sidebar.
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)} style={noFocusRing}>
            <Label size={font.sm} muted mono selectable lines={open ? undefined : 1}>
              {item.command}
            </Label>
          </Pressable>
        )}
        {(details.length > 0 || stale) && (
          <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: space[1.5] }}>
            {stale && (
              <Label size={font.sm} color={colors.statusWarning} selectable={false}>
                {t("out of date")}
              </Label>
            )}
            {details.length > 0 && (
              <Label size={font.sm} muted selectable={false}>
                {details.join(" · ")}
              </Label>
            )}
          </View>
        )}
        {!!item.evidence && (
          <>
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)} style={noFocusRing}>
              <Label size={font.sm} color={colors.accent} selectable={false}>
                {open ? t("Hide output") : t("Show output")}
              </Label>
            </Pressable>
            <Collapse open={open} id="output">
              <Label size={font.sm} muted mono selectable>
                {item.evidence}
              </Label>
            </Collapse>
          </>
        )}
      </View>
      <ByYou by={item.by} />
    </View>
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

function ConfusionRow({ item, disabled, onResolve }: { item: ConfusionItem; disabled: boolean; onResolve(): void }) {
  const { colors } = useTheme();
  return (
    <View style={{ ...rowStyle(), alignItems: "center" }}>
      <Icon name="CircleHelp" size={14} color={colors.statusWarning} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Label size={font.md}>{item.text}</Label>
      </View>
      <IconButton icon="Check" size={touch ? 36 : 24} label={t("Mark resolved: {text}", { text: item.text })} disabled={disabled} onPress={onResolve} />
    </View>
  );
}
