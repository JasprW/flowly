import { memo, useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import { Icon, ScrollView } from "@getpaseo/plugin/client/react-native";
import { useRpc } from "@getpaseo/plugin/client";
import { useQueryClient } from "@tanstack/react-query";
import * as rpc from "../shared/rpc";
import type { Project, Status, Task } from "../shared/model";
import { priorityLabels } from "./status";
import { addDays, type Insight } from "../shared/insights";
import { MIN_CARDS, WINDOW_DAYS, type CardTokens, type WorkflowStats } from "../shared/workflow-stats";
import type { DigestItem, DigestView } from "../shared/digest";
import { compactNumber, percent } from "../shared/usage";
import { modelLabel } from "../shared/summary";
import { Collapse, Disclosure } from "./disclosure";
import { Enter } from "./motion";
import { localZone, useDigestHeadlinesQuery, useDigestQuery, useInsightsQuery, useTokensQuery, useWorkflowInsightsQuery } from "./queries";
import { usageIn, type Finding, type FindingTarget, type WorkflowView } from "../shared/workflow-insights";
import { AiMark, Button, IconButton, Label, Notice, TurnChevron, font, message, noFocusRing, radius, relativeTime, space, touch, useTheme, verticalContent, verticalScroll } from "./ui";
import { formatLocale, msg, t, tn } from "../shared/i18n";
import { AgentHabits, habitsSummary } from "./agent-habits";

const HOUR_MS = 3_600_000;
/** "7m" / "3h" / "2d": how long something has waited. */
function waitedLabel(ms: number) {
  const h = ms / HOUR_MS;
  if (h < 1) return t("{n}m", { n: Math.max(1, Math.round(ms / 60_000)) });
  if (h < 48) return t("{n}h", { n: Math.round(h) });
  return t("{n}d", { n: Math.round(h / 24) });
}
/** Like waitedLabel, with one decimal for short hours and days ("1.5h", "2.3d"). */
function durationLabel(ms: number) {
  const h = ms / HOUR_MS;
  const one = (n: number) => (n < 10 ? n.toFixed(1).replace(/\.0$/, "") : String(Math.round(n)));
  if (h < 1) return t("{n}m", { n: Math.max(ms > 0 ? 1 : 0, Math.round(ms / 60_000)) });
  if (h < 48) return t("{n}h", { n: one(h) });
  return t("{n}d", { n: one(h / 24) });
}

/** A suggestion in the user's language, from the rule and the values the daemon sent. */
function suggestionText(item: Insight): string {
  const a = item.args;
  if (!a) return item.text;
  const wait = typeof a.waitMs === "number" ? waitedLabel(a.waitMs) : "";
  const n = Number(a.n ?? 0);
  switch (item.rule) {
    case "R1":
      return tn(n, "{n} card waiting for your review (oldest {wait}). Last 7 days: {into} in, {out} out.", "{n} cards waiting for your review (oldest {wait}). Last 7 days: {into} in, {out} out.", { wait, into: Number(a.into ?? 0), out: Number(a.out ?? 0) });
    case "R2":
      return a.title !== undefined
        ? t("“{title}” has had no activity for {wait}. Resume it or move it back.", { title: String(a.title), wait })
        : t("{n} cards in work lanes have had no activity for 2+ days. Resume them or move them back.", { n });
    case "R3":
      return t("“{title}” went back from review {n} times. The request may need clarifying.", { title: String(a.title), n });
    case "R4":
      return t("“{title}” ({priority}) has waited {wait} while lower-priority cards started.", { title: String(a.title), priority: priorityLabels[a.priority as keyof typeof priorityLabels] ?? String(a.priority), wait });
    case "R5":
      return t("{n} cards in progress, but about {rate} finish per day. Finish some before starting more.", { n, rate: String(a.rate) });
    case "R6":
      return t("“{title}” had {n} failed turns in the last 24h.", { title: String(a.title), n });
    case "R7":
      return t("Nothing is running. Next up: {titles}.", { titles: String(a.titles) });
    default:
      return item.text;
  }
}

/** Project Insights (INSIGHTS-REDESIGN-SPEC §5): how the workflow does, by week, against the project's own past. */
export const InsightsPage = memo(function InsightsPage({
  project,
  tasks,
  revision,
  compact,
  active,
  onOpenTask,
  onBack,
  onCreateFromFinding,
  onOpenSettings,
}: {
  project: Project;
  tasks: readonly Task[];
  revision: number;
  compact: boolean;
  active: boolean;
  nameOf(status: Status): string;
  onOpenTask(id: string): void;
  onBack(): void;
  /** Opens the new-task form prefilled from a workflow-insights suggestion. */
  onCreateFromFinding(finding: Finding): void;
  /** Settings → AI features, where workflow insights are configured. */
  onOpenSettings(): void;
}) {
  const { colors } = useTheme();
  const [end, setEnd] = useState<string | null>(null);
  const insights = useInsightsQuery(project.id, end, revision, active);
  const data = insights.data;
  const flow = data?.workflow;
  // The placeholder can hold the previous window while the new one loads.
  const stale = !!flow && end !== null && flow.window.to !== end;
  const tokens = useTokensQuery(project.id, end, active);
  const workflow = useWorkflowInsightsQuery(project.id, active);
  const titleOf = (id: string) => tasks.find((x) => x.id === id)?.title || t("Removed card");
  const step = (direction: -1 | 1) => {
    if (!flow || !data) return;
    const next = addDays(flow.window.to, direction * WINDOW_DAYS);
    setEnd(next >= data.today ? null : next);
  };
  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], paddingHorizontal: space[3], height: touch ? 48 : 40, borderBottomWidth: 1, borderColor: colors.border }}>
        <Button quiet icon="ChevronLeft" label={t("Back to board (Esc)")} onPress={onBack}>
          {t("Board")}
        </Button>
        <View style={{ flex: 1 }} />
        <IconButton icon="ChevronLeft" label={t("Earlier")} onPress={() => step(-1)} disabled={!flow} />
        <View style={{ minWidth: compact ? 100 : 132, alignItems: "center" }}>
          <Label bold size={font.md} lines={1} selectable={false}>
            {flow && data ? windowLabel(flow.window.from, flow.window.to, data.today) : "…"}
          </Label>
        </View>
        <IconButton icon="ChevronRight" label={t("Later")} onPress={() => step(1)} disabled={!flow || flow.window.current} />
      </View>
      <ScrollView
        {...verticalScroll}
        style={{ flex: 1, minHeight: 0 }}
        contentContainerStyle={{ ...verticalContent, padding: space[3], paddingBottom: space[6] * 2, alignItems: "center" }}
      >
        <View style={{ width: "100%", maxWidth: 760, gap: space[5] }}>
          {insights.error && !data ? (
            <Notice>{message(insights.error)}</Notice>
          ) : !data || !flow ? (
            <Label muted>{t("Loading insights…")}</Label>
          ) : (
            <View style={{ gap: space[5], opacity: stale ? 0.55 : 1 }}>
              <Headline flow={flow} />
              {flow.anomalies.length > 0 && <Anomalies insights={flow.anomalies} titleOf={titleOf} onOpenTask={onOpenTask} />}
              <Attention flow={flow} />
              <TimeSpent flow={flow} titleOf={titleOf} onOpenTask={onOpenTask} />
              <Cost flow={flow} tokens={tokens.data} tokensError={tokens.error ? message(tokens.error) : ""} />
              <Models flow={flow} tokens={tokens.data} />
              <Weeks flow={flow} tokens={tokens.data} today={data.today} compact={compact} />
              <WorkflowInsights projectId={project.id} view={workflow.data} error={workflow.error} titleOf={titleOf} onOpenTask={onOpenTask} onCreate={onCreateFromFinding} onOpenSettings={onOpenSettings} />
              <Section title={t("Agent habits")} detail={[t("Last 7 days"), habitsSummary(data.habits)].filter(Boolean).join(" · ")}>
                <AgentHabits habits={data.habits} today={data.today} compact={compact} titleOf={titleOf} onOpenTask={onOpenTask} />
              </Section>
              <DailyRecord projectId={project.id} from={flow.window.from} to={flow.window.to} today={data.today} active={active} titleOf={titleOf} onOpenTask={onOpenTask} />
              <Label muted size={font.xs}>
                {[
                  t("Interventions count messages, permission requests and card moves, not the time they took; Flowly cannot judge what a card was worth."),
                  flow.byUserSince ? t("Messages are recorded from {date}.", { date: shortDate(flow.byUserSince) }) : t("Messages are recorded from now on."),
                  flow.incomplete ? tn(flow.incomplete, "{n} card started before the full history was kept and is left out.", "{n} cards started before the full history was kept and are left out.") : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              </Label>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
});

export function dayLabel(day: string, today: string) {
  if (day === today) return t("Today");
  if (day === addDays(today, -1)) return t("Yesterday");
  const d = new Date(`${day}T12:00:00Z`);
  return d.toLocaleDateString(formatLocale(), { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

const shortDate = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString(formatLocale(), { month: "short", day: "numeric", timeZone: "UTC" });
const windowLabel = (from: string, to: string, today: string) => `${shortDate(from)} – ${to === today ? t("Today") : shortDate(to)}`;

function Section({ title, detail, ai, trailing, children }: { title: string; detail?: string; ai?: boolean; trailing?: ReactNode; children: ReactNode }) {
  return (
    <Enter distance={4}>
      <View style={{ gap: space[2] }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], minHeight: 28 }}>
          <View style={{ flexShrink: 0 }}>
            <Label bold size={font.md} lines={1} selectable={false}>
              {title}
            </Label>
          </View>
          {ai && <AiMark label={t("AI generated")} />}
          {!!detail && (
            <View style={{ flexShrink: 1 }}>
              <Label muted size={font.sm} lines={2} selectable={false}>
                {detail}
              </Label>
            </View>
          )}
          <View style={{ flex: 1 }} />
          {trailing}
        </View>
        {children}
      </View>
    </Enter>
  );
}

function Panel({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface1, overflow: "hidden" }}>{children}</View>;
}

/** A Panel row: label, a muted note, the value on the right. */
function StatRow({ first, label, value, note, onPress, a11y }: { first: boolean; label: string; value: string; note?: string; onPress?(): void; a11y?: string }) {
  const { colors } = useTheme();
  const body = (
    <>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Label size={font.md} lines={1} selectable={false}>
          {label}
        </Label>
      </View>
      {!!note && (
        <View style={{ flexShrink: 1 }}>
          <Label muted size={font.sm} lines={1} selectable={false}>
            {note}
          </Label>
        </View>
      )}
      <View style={{ minWidth: 48, alignItems: "flex-end" }}>
        <Label medium size={font.md} selectable={false}>
          {value}
        </Label>
      </View>
    </>
  );
  const style = { flexDirection: "row" as const, alignItems: "center" as const, gap: space[3], paddingHorizontal: space[3], minHeight: touch ? 44 : 36, borderTopWidth: first ? 0 : 1, borderColor: colors.border };
  if (!onPress)
    return (
      <View accessibilityLabel={a11y ?? `${label}: ${value}${note ? `, ${note}` : ""}`} style={style}>
        {body}
      </View>
    );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y ?? `${label}: ${value}`}
      onPress={onPress}
      style={(state) => ({ ...noFocusRing, ...style, backgroundColor: (state as { hovered?: boolean }).hovered || state.pressed ? colors.surface2 : "transparent" })}
    >
      {body}
    </Pressable>
  );
}

function Empty({ children }: { children: string }) {
  return (
    <Label muted size={font.sm}>
      {children}
    </Label>
  );
}

/** Medians: whole numbers as they are, others to one decimal. */
const fmt = (n: number | null) => (n === null ? "—" : Number.isInteger(n) || n >= 10 ? String(Math.round(n)) : n.toFixed(1));

// ---- Sections ---------------------------------------------------------------------

/** One plain paragraph: what the window looked like and what the weeks before looked like (§5.1). */
function Headline({ flow }: { flow: WorkflowStats }) {
  const g = flow.now,
    b = flow.baseline;
  if (!g.finished) return <Label size={font.md}>{t("No cards were finished in these 7 days.")}</Label>;
  const parts = [
    tn(g.finished, "{n} card finished in these 7 days.", "{n} cards finished in these 7 days."),
    g.attention !== null
      ? t("A card took a median of {attention} interventions and {rounds} review rounds; {onePass} of them went through in one pass.", { attention: fmt(g.attention), rounds: fmt(g.rounds), onePass: g.onePass })
      : t("A card took a median of {rounds} review rounds; {onePass} of them went through in one pass.", { rounds: fmt(g.rounds), onePass: g.onePass }),
    b.finished
      ? g.attention !== null && b.attention !== null
        ? t("In the 4 weeks before: {attention} interventions and {rounds} rounds.", { attention: fmt(b.attention), rounds: fmt(b.rounds) })
        : t("In the 4 weeks before: {rounds} rounds.", { rounds: fmt(b.rounds) })
      : "",
  ];
  return (
    <View style={{ gap: space[1] }}>
      <Label size={font.md}>{parts.filter(Boolean).join(" ")}</Label>
      {g.finished < MIN_CARDS && (
        <Label muted size={font.sm}>
          {t("Only a few cards were finished, so these numbers say little.")}
        </Label>
      )}
    </View>
  );
}

function Anomalies({ insights, titleOf, onOpenTask }: { insights: readonly Insight[]; titleOf(id: string): string; onOpenTask(id: string): void }) {
  const { colors } = useTheme();
  return (
    <Section title={t("Workflow issues")}>
      <Panel>
        {insights.map((item, index) => (
          <View key={`${item.rule}-${index}`} style={{ flexDirection: "row", gap: space[2], alignItems: "flex-start", padding: space[3], borderTopWidth: index ? 1 : 0, borderColor: colors.border }}>
            <View style={{ paddingTop: 2 }}>
              <Icon name={item.severity === "warning" ? "TriangleAlert" : "Info"} size={14} color={item.severity === "warning" ? colors.statusWarning : colors.foregroundMuted} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Label size={font.md}>{suggestionText(item)}</Label>
            </View>
            {item.taskIds.length === 1 && (
              <Button quiet small icon="ArrowUpRight" label={t("Open {title}", { title: titleOf(item.taskIds[0]) })} onPress={() => onOpenTask(item.taskIds[0])}>
                {t("Open")}
              </Button>
            )}
          </View>
        ))}
      </Panel>
    </Section>
  );
}

function Attention({ flow }: { flow: WorkflowStats }) {
  const g = flow.now;
  if (!g.finished) return null;
  const parts =
    g.messages !== null
      ? t("{messages} messages · {permissions} permissions · {moves} moves", { messages: fmt(g.messages), permissions: fmt(g.permissions), moves: fmt(g.moves) })
      : t("{permissions} permissions · {moves} moves; messages not recorded yet", { permissions: fmt(g.permissions), moves: fmt(g.moves) });
  return (
    <Section title={t("Attention per card")} detail={t("Medians")}>
      <Panel>
        <StatRow first label={t("Interventions")} value={fmt(g.attention)} note={parts} />
        <StatRow
          first={false}
          label={t("Review rounds")}
          value={fmt(g.rounds)}
          note={[g.roundsP75 !== null ? t("P75 {value}", { value: fmt(g.roundsP75) }) : "", t("{n} in one pass", { n: g.onePass })].filter(Boolean).join(" · ")}
        />
        <StatRow first={false} label={t("Questions from the agent")} value={fmt(g.questions)} />
      </Panel>
    </Section>
  );
}

function TimeSpent({ flow, titleOf, onOpenTask }: { flow: WorkflowStats; titleOf(id: string): string; onOpenTask(id: string): void }) {
  const { working, waiting, idle, activeMedian, topTools, topAskers } = flow.time;
  const all = working + waiting + idle;
  if (!flow.now.finished) return null;
  const part = (n: number) => (all ? percent(n / all) : "–");
  return (
    <Section title={t("Where time goes")} detail={t("Agents working {working} · waiting for review or a reply {waiting} · idle {idle}", { working: part(working), waiting: part(waiting), idle: part(idle) })}>
      <Panel>
        <StatRow first label={t("Active time per card")} value={activeMedian === null ? "—" : durationLabel(activeMedian)} note={t("From the first work lane to Done, median")} />
        {topTools.map((x) => (
          <StatRow key={`tool-${x.tool}`} first={false} label={x.tool} value={String(x.count)} note={t("Permission requests")} />
        ))}
        {topAskers.map((x) => (
          <StatRow key={`ask-${x.taskId}`} first={false} label={titleOf(x.taskId)} value={String(x.count)} note={t("Questions")} onPress={() => onOpenTask(x.taskId)} />
        ))}
      </Panel>
    </Section>
  );
}

function Cost({ flow, tokens, tokensError }: { flow: WorkflowStats; tokens: CardTokens | undefined; tokensError: string }) {
  const q = flow.quality;
  return (
    <Section title={t("Cost and quality")}>
      <Panel>
        <StatRow
          first
          label={t("Tokens per card")}
          value={tokens ? (tokens.perCard === null ? "—" : compactNumber(tokens.perCard)) : tokensError ? "—" : "…"}
          note={tokens ? (tokens.cacheRate !== null ? t("{rate} cached", { rate: percent(tokens.cacheRate) }) : "") : tokensError ? t("Unavailable") : t("Reading logs")}
        />
        <StatRow first={false} label={t("Agent time per card")} value={flow.agentMs === null ? "—" : durationLabel(flow.agentMs)} />
        <StatRow first={false} label={t("Failed turns")} value={q.failedShare === null ? "—" : percent(q.failedShare)} note={q.turns ? t("{failed} of {turns}", { failed: q.failed, turns: q.turns }) : ""} />
        <StatRow first={false} label={t("Reopened cards")} value={String(q.reopened)} />
      </Panel>
    </Section>
  );
}

function Models({ flow, tokens }: { flow: WorkflowStats; tokens: CardTokens | undefined }) {
  if (flow.models.length < 2) return null;
  const tokensOf = (model: string) => tokens?.models.find((m) => m.model === model)?.perCard ?? null;
  return (
    <Section title={t("By model")} detail={t("Medians per card, by the model most turns ran on")}>
      <Panel>
        {flow.models.map((m, i) => (
          <StatRow
            key={m.model || "other"}
            first={i === 0}
            label={m.model ? modelLabel(m.model) : t("Other")}
            value={tn(m.finished, "{n} card", "{n} cards")}
            note={[
              m.attention !== null ? t("{n} interventions", { n: fmt(m.attention) }) : "",
              t("{n} rounds", { n: fmt(m.rounds) }),
              tokensOf(m.model) !== null ? t("{n} tokens", { n: compactNumber(tokensOf(m.model)!) }) : "",
            ]
              .filter(Boolean)
              .join(" · ")}
          />
        ))}
      </Panel>
    </Section>
  );
}

/** The trend (§3.6): one row per week, newest first, no chart. */
function Weeks({ flow, tokens, today, compact }: { flow: WorkflowStats; tokens: CardTokens | undefined; today: string; compact: boolean }) {
  const { colors } = useTheme();
  const tokensOf = (week: string) => tokens?.weeks.find((w) => w.week === week)?.perCard ?? null;
  const columns = [
    { key: "week", label: t("Week"), flex: 1.4 },
    ...(compact ? [] : [{ key: "cards", label: t("Cards"), flex: 0.8 }]),
    { key: "attention", label: t("Interventions"), flex: 1 },
    { key: "rounds", label: t("Rounds"), flex: 0.8 },
    ...(compact ? [] : [{ key: "pass", label: t("One pass"), flex: 0.9 }]),
    { key: "tokens", label: t("Tokens"), flex: 0.9 },
  ];
  const cell = (key: string, w: WorkflowStats["weeks"][number]) => {
    switch (key) {
      case "week":
        return w.partial ? t("{date} (so far)", { date: shortDate(w.week) }) : shortDate(w.week);
      case "cards":
        return String(w.finished);
      case "attention":
        return w.finished ? fmt(w.attention) : "—";
      case "rounds":
        return w.finished ? fmt(w.rounds) : "—";
      case "pass":
        return w.onePassShare === null ? "—" : percent(w.onePassShare);
      default: {
        const n = tokensOf(w.week);
        return n === null ? "—" : compactNumber(n);
      }
    }
  };
  const row = (children: ReactNode, key: string, first: boolean, faded = false) => (
    <View key={key} style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: space[3], minHeight: touch ? 40 : 32, borderTopWidth: first ? 0 : 1, borderColor: colors.border, opacity: faded ? 0.55 : 1 }}>
      {children}
    </View>
  );
  return (
    <Section title={t("By week")} detail={t("Medians per finished card; pale weeks have fewer than 3 cards")}>
      <Panel>
        {row(
          columns.map((c) => (
            <View key={c.key} style={{ flex: c.flex, alignItems: c.key === "week" ? "flex-start" : "flex-end" }}>
              <Label muted size={font.xs} lines={1} selectable={false}>
                {c.label}
              </Label>
            </View>
          )),
          "head",
          true,
        )}
        {flow.weeks.map((w) => (
          <View key={w.week}>
            {row(
              columns.map((c) => (
                <View key={c.key} style={{ flex: c.flex, alignItems: c.key === "week" ? "flex-start" : "flex-end" }}>
                  <Label size={font.sm} lines={1} selectable={false}>
                    {cell(c.key, w)}
                  </Label>
                </View>
              )),
              w.week,
              false,
              w.partial || w.finished < MIN_CARDS,
            )}
            {w.landed.length > 0 && (
              <View style={{ paddingHorizontal: space[3], paddingBottom: space[2] }}>
                <Label muted size={font.xs}>
                  {t("Landed this week: {titles}", { titles: w.landed.join(" · ") })}
                </Label>
              </View>
            )}
          </View>
        ))}
      </Panel>
      {!flow.weeks.some((w) => w.week <= today && w.finished) && <Empty>{t("No finished cards in these weeks yet.")}</Empty>}
    </Section>
  );
}

// ---- Daily record -----------------------------------------------------------------

/** AI day headlines for the window, collapsed by default; a day opens its full summary (§5.9). */
function DailyRecord({
  projectId,
  from,
  to,
  today,
  active,
  titleOf,
  onOpenTask,
}: {
  projectId: string;
  from: string;
  to: string;
  today: string;
  active: boolean;
  titleOf(id: string): string;
  onOpenTask(id: string): void;
}) {
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState<string | null>(null);
  const headlines = useDigestHeadlinesQuery(projectId, from, to, active && open);
  const digest = useDigestQuery(projectId, day, active && open && !!day);
  const byDay = new Map((headlines.data?.entries || []).map((e) => [e.day, e.headline]));
  const days = Array.from({ length: WINDOW_DAYS }, (_, i) => addDays(to, -i)).filter((d) => d >= from);
  return (
    <Disclosure title={t("Daily record")} summary={t("AI summary of each day")} open={open} onChange={setOpen}>
      <View style={{ gap: space[3], paddingTop: space[1] }}>
        <Panel>
          {days.map((d, i) => (
            <SummaryRow key={d} first={i === 0} label={dayLabel(d, today)} headline={byDay.get(d) || ""} onPress={() => setDay((x) => (x === d ? null : d))} />
          ))}
        </Panel>
        {!!day && <Digest projectId={projectId} day={day} isToday={day === today} view={digest.data} error={digest.error} titleOf={titleOf} onOpenTask={onOpenTask} />}
      </View>
    </Disclosure>
  );
}

function TaskChip({ title, onPress }: { title: string; onPress(): void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("Open {title}", { title })}
      onPress={onPress}
      hitSlop={touch ? 6 : 0}
      style={(state) => {
        const { hovered, pressed } = state as typeof state & { hovered?: boolean };
        return {
          ...noFocusRing,
          maxWidth: 220,
          paddingHorizontal: space[2],
          height: touch ? 28 : 22,
          justifyContent: "center",
          borderRadius: radius.full,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: hovered || pressed ? colors.surface2 : colors.surface0,
        };
      }}
    >
      <Label size={font.sm} lines={1} selectable={false}>
        {title}
      </Label>
    </Pressable>
  );
}

function SummaryRow({ first, label, headline, onPress }: { first: boolean; label: string; headline: string; onPress(): void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("{day}: open the day", { day: label })}
      onPress={onPress}
      style={(state) => {
        const { hovered, pressed } = state as typeof state & { hovered?: boolean };
        return {
          ...noFocusRing,
          flexDirection: "row",
          alignItems: "center",
          gap: space[3],
          paddingVertical: space[2],
          paddingHorizontal: space[3],
          minHeight: touch ? 44 : 36,
          borderTopWidth: first ? 0 : 1,
          borderColor: colors.border,
          backgroundColor: hovered || pressed ? colors.surface2 : "transparent",
        };
      }}
    >
      <View style={{ width: touch ? 84 : 110 }}>
        <Label medium size={font.sm} lines={1} selectable={false}>
          {label}
        </Label>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Label size={font.md} muted={!headline} lines={2} selectable={false}>
          {headline || t("No summary")}
        </Label>
      </View>
      <Icon name="ChevronRight" size={14} color={colors.foregroundMuted} />
    </Pressable>
  );
}

function Digest({
  projectId,
  day,
  isToday,
  view,
  error,
  titleOf,
  onOpenTask,
}: {
  projectId: string;
  day: string;
  isToday: boolean;
  view: DigestView | undefined;
  error: unknown;
  titleOf(id: string): string;
  onOpenTask(id: string): void;
}) {
  const refresh = useRpc(rpc.refreshDigest);
  const client = useQueryClient();
  const [failed, setFailed] = useState("");
  const running = !!view?.running;
  const run = async () => {
    setFailed("");
    try {
      await refresh({ projectId, tz: localZone(), day });
      await client.invalidateQueries({ queryKey: ["flowly", "digest", projectId, day] });
      await client.invalidateQueries({ queryKey: ["flowly", "digest-headlines", projectId] });
    } catch (e) {
      setFailed(message(e));
    }
  };
  const entry = view?.entry;
  const groups: { title: string; items: DigestItem[] }[] = entry
    ? [
        { title: t("Done"), items: entry.done },
        { title: t("Progressed"), items: entry.progressed },
        { title: t("Issues"), items: entry.issues },
        { title: t("Next"), items: entry.next },
      ].filter((g) => g.items.length)
    : [];
  return (
    <Section
      title={t("Summary")}
      ai
      trailing={
        view && !view.empty ? (
          <Button quiet small icon="RefreshCw" disabled={running} label={t("Regenerate the summary")} onPress={() => void run()}>
            {running ? t("Generating…") : entry ? t("Refresh") : t("Generate")}
          </Button>
        ) : null
      }
    >
      {!view ? (
        <Empty>{error ? message(error) : t("Loading…")}</Empty>
      ) : view.empty ? (
        <Empty>{t("No activity on this day.")}</Empty>
      ) : entry ? (
        <Panel>
          <View style={{ padding: space[3], gap: space[3] }}>
            <Label bold size={font.base}>
              {entry.headline}
            </Label>
            {groups.map((g) => (
              <View key={g.title} style={{ gap: space[1] }}>
                <Label muted size={font.xs} selectable={false}>
                  {g.title}
                </Label>
                {g.items.map((item, i) => (
                  <DigestLine key={i} item={item} title={item.taskId ? titleOf(item.taskId) : ""} onOpenTask={onOpenTask} />
                ))}
              </View>
            ))}
            <Label muted size={font.xs} selectable={false}>
              {t("Updated {time}", { time: relativeTime(entry.at) })} · {modelLabel(entry.model)}
            </Label>
          </View>
        </Panel>
      ) : running ? (
        <Empty>{t("Writing the summary…")}</Empty>
      ) : (
        <Empty>{isToday ? t("Generate a summary of today so far.") : view.enabled ? t("No summary for this day yet.") : t("Daily digest is off in settings. Generate one here.")}</Empty>
      )}
      {!!(failed || (view?.error && !running)) && <Empty>{failed || t("Last attempt failed: {message}", { message: view?.error?.message ?? "" })}</Empty>}
    </Section>
  );
}

function DigestLine({ item, title, onOpenTask }: { item: DigestItem; title: string; onOpenTask(id: string): void }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: "row", gap: space[2], alignItems: "flex-start" }}>
      <Label muted size={font.md} selectable={false}>
        •
      </Label>
      <View style={{ flex: 1, minWidth: 0, flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: space[1.5] }}>
        <Label size={font.md}>{item.text}</Label>
        {!!item.taskId && (
          <Pressable accessibilityRole="link" accessibilityLabel={t("Open {title}", { title })} onPress={() => onOpenTask(item.taskId!)} hitSlop={touch ? 6 : 0} style={noFocusRing}>
            <Label size={font.sm} color={colors.accent} lines={1} selectable={false}>
              {title.length > 40 ? title.slice(0, 39) + "…" : title}
            </Label>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const targetLabels: Record<FindingTarget, string> = {
  paseo_script: msg("paseo.json script"),
  worktree_setup: msg("Worktree setup"),
  repo_tool: msg("Repo tool"),
  agents_md: msg("AGENTS.md"),
  skill: msg("Skill"),
};
const confidenceLabels: Record<Finding["confidence"], string> = { high: msg("High confidence"), medium: msg("Medium confidence"), low: msg("Low confidence") };
const confidenceRank = { high: 0, medium: 1, low: 2 } as const;

/** The daemon's reasons are English identities; known ones read in the user's language. */
function runReason(view: WorkflowView): string {
  const run = view.lastRun;
  if (!run) return "";
  if (run.status === "error") return t("Last run failed: {message}", { message: run.reason || "" });
  if (run.reason === "Not enough new activity.") return t("Skipped: not enough new activity since the last run.");
  if (run.reason === "No commands collected yet.") return t("No commands collected yet. They are recorded as agents work on cards.");
  if (run.reason === "No suggestions this time.") return t("No new suggestions this time.");
  return "";
}

function usageLine(view: WorkflowView): string {
  const u = view.lastRun?.usage;
  if (!u) return "";
  const parts = [t("{n} in", { n: compactNumber(usageIn(u)) }), t("{n} out", { n: compactNumber(u.outputTokens ?? 0) })];
  if (typeof u.totalCostUsd === "number") parts.push(`$${u.totalCostUsd.toFixed(2)}`);
  return parts.join(" · ");
}

/** Workflow insights (WORKFLOW-INSIGHTS-SPEC §5.2): scheduled suggestions from the commands agents ran. */
function WorkflowInsights({
  projectId,
  view,
  error,
  titleOf,
  onOpenTask,
  onCreate,
  onOpenSettings,
}: {
  projectId: string;
  view: WorkflowView | undefined;
  error: unknown;
  titleOf(id: string): string;
  onOpenTask(id: string): void;
  onCreate(finding: Finding): void;
  onOpenSettings(): void;
}) {
  const run = useRpc(rpc.runWorkflowInsights);
  const setStatus = useRpc(rpc.setWorkflowFinding);
  const client = useQueryClient();
  const [failed, setFailed] = useState("");
  const [showDismissed, setShowDismissed] = useState(false);
  const refresh = () => client.invalidateQueries({ queryKey: ["flowly", "workflow-insights", projectId] });
  const runNow = async () => {
    setFailed("");
    try {
      await run({ projectId });
      await refresh();
    } catch (e) {
      setFailed(message(e));
    }
  };
  const change = async (finding: Finding, status: "open" | "dismissed") => {
    if (!view) return;
    setFailed("");
    try {
      await setStatus({ projectId, findingId: finding.id, status, expectedRevision: view.revision });
    } catch (e) {
      setFailed(message(e));
    }
    await refresh();
  };
  const busy = !!view && (view.running || view.backfilling);
  const trailing = view ? (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space[1] }}>
      {(view.enabled || view.lastRun) && (
        <Button quiet small icon="Play" disabled={busy} label={t("Analyze the last days now")} onPress={() => void runNow()}>
          {view.running ? t("Analyzing…") : t("Run now")}
        </Button>
      )}
      <IconButton icon="Settings" label={t("Workflow insights settings")} onPress={onOpenSettings} />
    </View>
  ) : null;
  const findings = view ? [...view.findings].sort((a, b) => confidenceRank[a.confidence] - confidenceRank[b.confidence] || b.createdAt.localeCompare(a.createdAt)) : [];
  const open = findings.filter((f) => f.status === "open");
  const accepted = findings.filter((f) => f.status === "accepted");
  const dismissed = findings.filter((f) => f.status === "dismissed");
  const last = view?.lastRun;
  return (
    <Section title={t("Workflow insights")} ai detail={open.length ? tn(open.length, "{n} open", "{n} open") : undefined} trailing={trailing}>
      {!view ? (
        <Empty>{error ? message(error) : t("Loading…")}</Empty>
      ) : (
        <View style={{ gap: space[2] }}>
          {!view.enabled && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], flexWrap: "wrap" }}>
              <View style={{ flex: 1, minWidth: 200 }}>
                <Empty>{t("Off. When on, a model reads the shell commands agents ran on this project's cards every few days and suggests scripts, tools and rules worth keeping.")}</Empty>
              </View>
              <Button small onPress={onOpenSettings}>
                {t("Turn on")}
              </Button>
            </View>
          )}
          {view.enabled && !view.projectEnabled && <Empty>{t("This project is left out of workflow insights in its settings. Run now still works.")}</Empty>}
          {view.backfilling && <Empty>{t("Reading recent sessions…")}</Empty>}
          {(last || view.nextRunAt) && (
            <Label muted size={font.xs} selectable={false}>
              {[
                last ? t("Last run {time}", { time: relativeTime(last.at) }) : "",
                last?.model ? modelLabel(last.model) : "",
                last ? tn(view.windowDays, "last {n} day", "last {n} days") : "",
                last ? usageLine(view) : "",
                view.nextRunAt && !view.running ? t("Next run {time}", { time: nextLabel(view.nextRunAt) }) : "",
              ]
                .filter(Boolean)
                .join(" · ")}
            </Label>
          )}
          {!!runReason(view) && <Empty>{runReason(view)}</Empty>}
          {!!failed && <Empty>{failed}</Empty>}
          {open.length + accepted.length > 0 && (
            <Panel>
              {open.map((f, i) => (
                <FindingRow key={f.id} first={i === 0} finding={f} titleOf={titleOf} onOpenTask={onOpenTask} onCreate={() => onCreate(f)} onDismiss={() => void change(f, "dismissed")} />
              ))}
              {accepted.map((f, i) => (
                <FindingRow key={f.id} first={!open.length && i === 0} finding={f} titleOf={titleOf} onOpenTask={onOpenTask} />
              ))}
            </Panel>
          )}
          {view.enabled && !open.length && !accepted.length && last?.status === "ok" && !runReason(view) && <Empty>{t("No open suggestions.")}</Empty>}
          {dismissed.length > 0 && (
            <Disclosure title={t("Dismissed ({n})", { n: dismissed.length })} open={showDismissed} onChange={setShowDismissed}>
              <Panel>
                {dismissed.map((f, i) => (
                  <FindingRow key={f.id} first={i === 0} finding={f} titleOf={titleOf} onOpenTask={onOpenTask} onRestore={() => void change(f, "open")} />
                ))}
              </Panel>
            </Disclosure>
          )}
        </View>
      )}
    </Section>
  );
}

function nextLabel(iso: string) {
  const at = new Date(iso);
  if (at.getTime() - Date.now() < 15 * 60_000) return t("soon");
  return at.toLocaleString(formatLocale(), { weekday: "short", hour: "numeric", minute: "2-digit" });
}

/** One suggestion as a row; its evidence, cards, proposal and actions open below it. */
function FindingRow({
  first,
  finding,
  titleOf,
  onOpenTask,
  onCreate,
  onDismiss,
  onRestore,
}: {
  first: boolean;
  finding: Finding;
  titleOf(id: string): string;
  onOpenTask(id: string): void;
  onCreate?(): void;
  onDismiss?(): void;
  onRestore?(): void;
}) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const [proposal, setProposal] = useState(false);
  return (
    <View style={{ borderTopWidth: first ? 0 : 1, borderColor: colors.border, opacity: finding.status === "dismissed" ? 0.75 : 1 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={finding.title}
        onPress={() => setOpen((o) => !o)}
        style={(state) => {
          const { hovered } = state as typeof state & { hovered?: boolean };
          return {
            ...noFocusRing,
            flexDirection: "row",
            alignItems: "center",
            gap: space[2],
            paddingVertical: space[2],
            paddingHorizontal: space[3],
            minHeight: touch ? 44 : 36,
            backgroundColor: hovered ? colors.surface2 : "transparent",
          };
        }}
      >
        <TurnChevron open={open} size={14} color={colors.foregroundMuted} />
        <View style={{ paddingHorizontal: space[2], height: touch ? 22 : 20, justifyContent: "center", borderRadius: radius.full, backgroundColor: colors.surface2 }}>
          <Label size={font.xs} lines={1} selectable={false}>
            {t(targetLabels[finding.target])}
          </Label>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Label medium size={font.md} lines={open ? undefined : 1} selectable={false}>
            {finding.title}
          </Label>
        </View>
        {finding.status === "accepted" ? (
          <Label muted size={font.xs} selectable={false}>
            {t("Card created")}
          </Label>
        ) : (
          <Label muted size={font.xs} selectable={false}>
            {t(confidenceLabels[finding.confidence])}
          </Label>
        )}
      </Pressable>
      <Collapse open={open} id="finding" style={{ paddingLeft: space[6] + space[2], paddingRight: space[3], paddingBottom: space[3], gap: space[2] }}>
        {!!finding.benefit && <Label size={font.md}>{finding.benefit}</Label>}
        {!!finding.evidence && (
          <Label muted size={font.sm}>
            {finding.evidence}
          </Label>
        )}
        {finding.cards.length > 0 && (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[1] }}>
            {finding.cards.slice(0, 6).map((id) => (
              <TaskChip key={id} title={titleOf(id)} onPress={() => onOpenTask(id)} />
            ))}
            {finding.cards.length > 6 && (
              <Label muted size={font.sm} selectable={false}>
                +{finding.cards.length - 6}
              </Label>
            )}
          </View>
        )}
        <Disclosure title={t("Proposal")} open={proposal} onChange={setProposal}>
          <View style={{ padding: space[2], borderRadius: radius.md, backgroundColor: colors.surface0 }}>
            <Label mono size={font.sm}>
              {finding.proposal}
            </Label>
          </View>
        </Disclosure>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], flexWrap: "wrap" }}>
          {finding.status === "open" && onCreate && (
            <Button small primary icon="Plus" onPress={onCreate}>
              {t("Create card")}
            </Button>
          )}
          {finding.status === "open" && onDismiss && (
            <Button small quiet onPress={onDismiss}>
              {t("Dismiss")}
            </Button>
          )}
          {finding.status === "dismissed" && onRestore && (
            <Button small quiet icon="RotateCcw" onPress={onRestore}>
              {t("Restore")}
            </Button>
          )}
          {finding.status === "accepted" && (
            <Button
              small
              quiet
              icon="ArrowUpRight"
              disabled={!finding.acceptedTaskId}
              label={finding.acceptedTaskId ? t("Open {title}", { title: titleOf(finding.acceptedTaskId) }) : undefined}
              onPress={() => finding.acceptedTaskId && onOpenTask(finding.acceptedTaskId)}
            >
              {t("Card created")}
            </Button>
          )}
        </View>
      </Collapse>
    </View>
  );
}
