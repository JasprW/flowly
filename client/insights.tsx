import { memo, useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import { Icon, ScrollView } from "@getpaseo/plugin/client/react-native";
import { useRpc } from "@getpaseo/plugin/client";
import { useQueryClient } from "@tanstack/react-query";
import * as rpc from "../shared/rpc";
import { enabledStatuses } from "../shared/lanes";
import { isWorkStatus, type Project, type Status, type Task } from "../shared/model";
import { priorityLabels } from "./status";
import { addDays, type Insight, type ProjectInsights, type TokenInsights } from "../shared/insights";
import type { DigestItem, DigestView } from "../shared/digest";
import { cacheHitRate, compactDuration, compactNumber, percent, totalTokens } from "../shared/usage";
import { modelLabel } from "../shared/summary";
import type { AttentionItem } from "./attention";
import { Disclosure } from "./disclosure";
import { Enter } from "./motion";
import { localZone, useDigestQuery, useInsightsQuery, useTokensQuery, useWorkflowInsightsQuery } from "./queries";
import { usageIn, type Finding, type FindingTarget, type WorkflowView } from "../shared/workflow-insights";
import { StatusIcon } from "./status";
import { AiMark, Button, Dot, IconButton, Label, Notice, font, message, noFocusRing, radius, relativeTime, space, touch, useTheme, verticalContent, verticalScroll } from "./ui";
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


/** Project Insights page (PROJECT-INSIGHTS-SPEC §9): replaces the board area while open. */
export const InsightsPage = memo(function InsightsPage({
  project,
  tasks,
  attention,
  revision,
  compact,
  active,
  nameOf,
  onOpenTask,
  onBack,
  onCreateFromFinding,
  onOpenSettings,
}: {
  project: Project;
  tasks: readonly Task[];
  attention: readonly AttentionItem[];
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
  const [day, setDay] = useState<string | null>(null);
  const insights = useInsightsQuery(project.id, day, revision, active);
  const data = insights.data;
  const shownDay = data?.day || day;
  const isToday = !!data && data.day === data.today;
  const digest = useDigestQuery(project.id, shownDay, active && !!data);
  const tokens = useTokensQuery(project.id, day, active);
  // Only show tokens for the day on screen (the placeholder may hold the previous day).
  const dayTokens = tokens.data && data && tokens.data.day === data.day ? tokens.data : undefined;
  const titleOf = (id: string) => tasks.find((t) => t.id === id)?.title || t("Removed card");
  const lanes = enabledStatuses(project);
  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: space[2],
          paddingHorizontal: space[3],
          height: touch ? 48 : 40,
          borderBottomWidth: 1,
          borderColor: colors.border,
        }}
      >
        <Button quiet icon="ChevronLeft" label={t("Back to board (Esc)")} onPress={onBack}>
          {t("Board")}</Button>
        <View style={{ flex: 1 }} />
        <IconButton icon="ChevronLeft" label={t("Previous day")} onPress={() => data && setDay(addDays(data.day, -1))} disabled={!data} />
        <View style={{ minWidth: compact ? 88 : 120, alignItems: "center" }}>
          <Label bold size={font.md} selectable={false}>
            {data ? dayLabel(data.day, data.today) : "…"}
          </Label>
        </View>
        <IconButton
          icon="ChevronRight"
          label={t("Next day")}
          onPress={() => data && setDay(addDays(data.day, 1) >= data.today ? null : addDays(data.day, 1))}
          disabled={!data || isToday}
        />
        {!isToday && !!data && (
          <Button quiet small onPress={() => setDay(null)}>
            {t("Today")}</Button>
        )}
      </View>
      <ScrollView
        {...verticalScroll}
        style={{ flex: 1, minHeight: 0 }}
        contentContainerStyle={{ ...verticalContent, padding: space[3], paddingBottom: space[6] * 2, alignItems: "center" }}
      >
        <View style={{ width: "100%", maxWidth: 760, gap: space[5] }}>
          {insights.error && !data ? (
            <Notice>{message(insights.error)}</Notice>
          ) : !data ? (
            <Label muted>{t("Loading insights…")}</Label>
          ) : (
            <>
              <Numbers data={data} tokens={dayTokens} tokensError={tokens.error ? message(tokens.error) : ""} compact={compact} />
              {isToday && <Waiting data={data} attention={attention} titleOf={titleOf} nameOf={nameOf} onOpenTask={onOpenTask} />}
              {isToday && <Suggestions insights={data.insights} titleOf={titleOf} onOpenTask={onOpenTask} />}
              <Digest projectId={project.id} day={data.day} isToday={isToday} view={digest.data} error={digest.error} titleOf={titleOf} onOpenTask={onOpenTask} />
              <WorkflowInsights projectId={project.id} active={active} titleOf={titleOf} onOpenTask={onOpenTask} onCreate={onCreateFromFinding} onOpenSettings={onOpenSettings} />
              <Section title={t("Agent habits")} detail={habitsSummary(data.habits)}>
                <AgentHabits habits={data.habits} today={data.today} compact={compact} titleOf={titleOf} onOpenTask={onOpenTask} />
              </Section>
              <TokenUse tokens={dayTokens} titleOf={titleOf} onOpenTask={onOpenTask} />
              <Trend data={data} tokens={dayTokens} lanes={lanes} nameOf={nameOf} compact={compact} />
              {data.incomplete > 0 && (
                <Label muted size={font.xs}>
                  {tn(data.incomplete, "{n} card started before the full history was kept, so older numbers may be low.", "{n} cards started before the full history was kept, so older numbers may be low.")}
                </Label>
              )}
            </>
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

function Section({ title, detail, ai, trailing, children }: { title: string; detail?: string; ai?: boolean; trailing?: ReactNode; children: ReactNode }) {
  return (
    <Enter distance={4}>
      <View style={{ gap: space[2] }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], minHeight: 28 }}>
          <Label bold size={font.md} selectable={false}>
            {title}
          </Label>
          {ai && <AiMark label={t("AI generated")} />}
          {!!detail && (
            <Label muted size={font.sm} selectable={false}>
              {detail}
            </Label>
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
  return (
    <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface1, overflow: "hidden" }}>{children}</View>
  );
}

const fmt = (n: number) => (n >= 10 || Number.isInteger(n) ? String(Math.round(n)) : n.toFixed(1));

function Numbers({ data, tokens, tokensError, compact }: { data: ProjectInsights; tokens: TokenInsights | undefined; tokensError: string; compact: boolean }) {
  const { colors } = useTheme();
  const s = data.stats,
    a = data.average;
  const turns = s.turns.completed + s.turns.failed + s.turns.canceled;
  const tiles: { label: string; value: string; avg: string; hint?: string }[] = [
    { label: t("Done"), value: String(s.done), avg: fmt(a.done) },
    { label: t("New"), value: String(s.created), avg: fmt(a.created) },
    { label: t("Rework"), value: String(s.rework), avg: fmt(a.rework) },
    { label: t("Turns"), value: String(turns), avg: fmt(a.turns), hint: s.turns.failed ? t("{n} failed", { n: s.turns.failed }) : undefined },
    { label: t("Agent time"), value: s.agentMs ? compactDuration(s.agentMs) : "0", avg: a.agentMs ? compactDuration(a.agentMs) : "0", hint: s.peakSessions > 1 ? t("up to {peakSessions} at once", { peakSessions: s.peakSessions }) : undefined },
    { label: t("Commits"), value: data.git.repos ? String(s.commits) : "—", avg: data.git.repos ? fmt(a.commits) : "", hint: s.commits ? `+${s.added} −${s.deleted}` : undefined },
    tokens
      ? {
          label: t("Tokens"),
          value: compactNumber(totalTokens(tokens.tokens)),
          avg: compactNumber(tokens.average),
          hint: cacheHitRate(tokens.tokens) !== null ? t("{rate} cached", { rate: percent(cacheHitRate(tokens.tokens)!) }) : undefined,
        }
      : { label: t("Tokens"), value: tokensError ? "—" : "…", avg: "", hint: tokensError ? t("Unavailable") : t("Reading logs") },
  ];
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
      {tiles.map((tile) => (
        <View
          key={tile.label}
          accessibilityLabel={tile.avg ? t("{label}: {value}, 7-day average {avg}", { label: tile.label, value: tile.value, avg: tile.avg }) : `${tile.label}: ${tile.value}`}
          style={{
            flexGrow: 1,
            flexBasis: compact ? "30%" : "13%",
            minWidth: compact ? 96 : 100,
            padding: space[3],
            gap: 2,
            borderRadius: radius.lg,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.surface1,
          }}
        >
          <Label muted size={font.xs} selectable={false}>
            {tile.label}
          </Label>
          <Label bold size={font.xl} selectable={false}>
            {tile.value}
          </Label>
          <Label muted size={font.xs} lines={1} selectable={false}>
            {[tile.hint, tile.avg ? t("avg {avg}/day", { avg: tile.avg }) : ""].filter(Boolean).join(" · ") || " "}
          </Label>
        </View>
      ))}
    </View>
  );
}

type WaitingRowData = { key: string; taskId: string; kind: string; tone: "warning" | "danger" | "info" | "muted"; status?: Status; since: string };

function Waiting({
  data,
  attention,
  titleOf,
  nameOf,
  onOpenTask,
}: {
  data: ProjectInsights;
  attention: readonly AttentionItem[];
  titleOf(id: string): string;
  nameOf(status: Status): string;
  onOpenTask(id: string): void;
}) {
  const rows: WaitingRowData[] = [
    ...attention.filter((i) => i.permissions).map((i) => ({ key: `p${i.task.id}`, taskId: i.task.id, kind: t("Permission"), tone: "warning" as const, since: i.updatedAt })),
    ...attention.filter((i) => i.questions).map((i) => ({ key: `q${i.task.id}`, taskId: i.task.id, kind: t("Question"), tone: "warning" as const, since: i.updatedAt })),
    ...attention.filter((i) => i.errors).map((i) => ({ key: `e${i.task.id}`, taskId: i.task.id, kind: t("Error"), tone: "danger" as const, since: i.updatedAt })),
    ...data.review.map((r) => ({ key: `r${r.taskId}`, taskId: r.taskId, kind: nameOf("in_review"), tone: "info" as const, status: "in_review" as Status, since: r.since })),
    ...data.blocked.map((r) => ({ key: `b${r.taskId}`, taskId: r.taskId, kind: nameOf("blocked"), tone: "muted" as const, status: "blocked" as Status, since: r.since })),
  ];
  return (
    <Section title={t("Waiting on you")} detail={rows.length ? String(rows.length) : undefined}>
      {rows.length ? (
        <Panel>
          {rows.map((row, i) => (
            <WaitingRow key={row.key} row={row} first={i === 0} title={titleOf(row.taskId)} onOpenTask={onOpenTask} />
          ))}
        </Panel>
      ) : (
        <Label muted size={font.sm}>
          {t("Nothing is waiting on you.")}</Label>
      )}
    </Section>
  );
}

function WaitingRow({ row, first, title, onOpenTask }: { row: WaitingRowData; first: boolean; title: string; onOpenTask(id: string): void }) {
  const { colors } = useTheme();
  const color =
    row.tone === "warning" ? colors.statusWarning : row.tone === "danger" ? colors.statusDanger : row.tone === "info" ? colors.accent : colors.foregroundMuted;
  const age = waitedLabel(Math.max(0, Date.now() - Date.parse(row.since)));
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("{kind}: {title}, waiting {age}. Open card", { kind: row.kind, title, age })}
      onPress={() => onOpenTask(row.taskId)}
      style={(state) => {
        const { hovered, pressed } = state as typeof state & { hovered?: boolean };
        return {
          ...noFocusRing,
          flexDirection: "row",
          alignItems: "center",
          gap: space[2],
          paddingHorizontal: space[3],
          minHeight: touch ? 48 : 40,
          borderTopWidth: first ? 0 : 1,
          borderColor: colors.border,
          backgroundColor: hovered || pressed ? colors.surface2 : "transparent",
        };
      }}
    >
      {row.status ? <StatusIcon status={row.status} size={14} /> : <Dot size={8} color={color} />}
      <View style={{ width: touch ? 78 : 88 }}>
        <Label size={font.sm} color={color} medium lines={1} selectable={false}>
          {row.kind}
        </Label>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Label size={font.md} lines={1} selectable={false}>
          {title}
        </Label>
      </View>
      <Label muted size={font.sm} selectable={false}>
        {age}
      </Label>
    </Pressable>
  );
}

function Suggestions({ insights, titleOf, onOpenTask }: { insights: readonly Insight[]; titleOf(id: string): string; onOpenTask(id: string): void }) {
  const { colors } = useTheme();
  if (!insights.length)
    return (
      <Section title={t("Suggestions")}>
        <Label muted size={font.sm}>
          {t("No suggestions right now.")}</Label>
      </Section>
    );
  return (
    <Section title={t("Suggestions")}>
      <View style={{ gap: space[2] }}>
        {insights.map((item, index) => (
          <View
            key={`${item.rule}-${index}`}
            style={{
              flexDirection: "row",
              gap: space[2],
              padding: space[3],
              borderRadius: radius.lg,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.surface1,
            }}
          >
            <View style={{ paddingTop: 2 }}>
              <Icon name={item.severity === "warning" ? "TriangleAlert" : "Lightbulb"} size={15} color={item.severity === "warning" ? colors.statusWarning : colors.foregroundMuted} />
            </View>
            <View style={{ flex: 1, minWidth: 0, gap: space[1.5] }}>
              <Label size={font.md}>{suggestionText(item)}</Label>
              {item.taskIds.length > 1 && (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[1] }}>
                  {item.taskIds.slice(0, 6).map((id) => (
                    <TaskChip key={id} title={titleOf(id)} onPress={() => onOpenTask(id)} />
                  ))}
                  {item.taskIds.length > 6 && (
                    <Label muted size={font.sm} selectable={false}>
                      +{item.taskIds.length - 6}
                    </Label>
                  )}
                </View>
              )}
            </View>
            {item.taskIds.length === 1 && <Button quiet small icon="ArrowUpRight" label={t("Open {title}", { title: titleOf(item.taskIds[0]) })} onPress={() => onOpenTask(item.taskIds[0])}>{t("Open")}</Button>}
          </View>
        ))}
      </View>
    </Section>
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
        <Label muted size={font.sm}>
          {error ? message(error) : t("Loading…")}
        </Label>
      ) : view.empty ? (
        <Label muted size={font.sm}>
          {t("No activity on this day.")}</Label>
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
        <Label muted size={font.sm}>
          {t("Writing the summary…")}</Label>
      ) : (
        <Label muted size={font.sm}>
          {isToday
            ? t("Generate a summary of today so far.")
            : view.enabled
              ? t("No summary for this day yet.")
              : t("Daily digest is off in settings. Generate one here.")}
        </Label>
      )}
      {!!(failed || (view?.error && !running)) && (
        <Label muted size={font.sm}>
          {failed || t("Last attempt failed: {message}", { message: view?.error?.message ?? "" })}
        </Label>
      )}
    </Section>
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
  active,
  titleOf,
  onOpenTask,
  onCreate,
  onOpenSettings,
}: {
  projectId: string;
  active: boolean;
  titleOf(id: string): string;
  onOpenTask(id: string): void;
  onCreate(finding: Finding): void;
  onOpenSettings(): void;
}) {
  const query = useWorkflowInsightsQuery(projectId, active);
  const run = useRpc(rpc.runWorkflowInsights);
  const setStatus = useRpc(rpc.setWorkflowFinding);
  const client = useQueryClient();
  const [failed, setFailed] = useState("");
  const [showDismissed, setShowDismissed] = useState(false);
  const view = query.data;
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
    <Section title={t("Workflow insights")} ai detail={open.length ? String(open.length) : undefined} trailing={trailing}>
      {!view ? (
        <Label muted size={font.sm}>
          {query.error ? message(query.error) : t("Loading…")}
        </Label>
      ) : (
        <View style={{ gap: space[2] }}>
          {!view.enabled && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], flexWrap: "wrap" }}>
              <View style={{ flex: 1, minWidth: 200 }}>
                <Label muted size={font.sm}>
                  {t("Off. When on, a model reads the shell commands agents ran on this project's cards every few days and suggests scripts, tools and rules worth keeping.")}
                </Label>
              </View>
              <Button small onPress={onOpenSettings}>
                {t("Turn on")}
              </Button>
            </View>
          )}
          {view.enabled && !view.projectEnabled && (
            <Label muted size={font.sm}>
              {t("This project is left out of workflow insights in its settings. Run now still works.")}
            </Label>
          )}
          {view.backfilling && (
            <Label muted size={font.sm}>
              {t("Reading recent sessions…")}
            </Label>
          )}
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
          {!!runReason(view) && (
            <Label muted size={font.sm}>
              {runReason(view)}
            </Label>
          )}
          {!!failed && (
            <Label muted size={font.sm}>
              {failed}
            </Label>
          )}
          {open.map((f) => (
            <FindingCard key={f.id} finding={f} titleOf={titleOf} onOpenTask={onOpenTask} onCreate={() => onCreate(f)} onDismiss={() => void change(f, "dismissed")} />
          ))}
          {accepted.map((f) => (
            <FindingCard key={f.id} finding={f} titleOf={titleOf} onOpenTask={onOpenTask} />
          ))}
          {view.enabled && !open.length && !accepted.length && last?.status === "ok" && !runReason(view) && (
            <Label muted size={font.sm}>
              {t("No open suggestions.")}
            </Label>
          )}
          {dismissed.length > 0 && (
            <Disclosure title={t("Dismissed ({n})", { n: dismissed.length })} open={showDismissed} onChange={setShowDismissed}>
              <View style={{ gap: space[2] }}>
                {dismissed.map((f) => (
                  <FindingCard key={f.id} finding={f} titleOf={titleOf} onOpenTask={onOpenTask} onRestore={() => void change(f, "open")} />
                ))}
              </View>
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

function FindingCard({
  finding,
  titleOf,
  onOpenTask,
  onCreate,
  onDismiss,
  onRestore,
}: {
  finding: Finding;
  titleOf(id: string): string;
  onOpenTask(id: string): void;
  onCreate?(): void;
  onDismiss?(): void;
  onRestore?(): void;
}) {
  const { colors } = useTheme();
  const [proposal, setProposal] = useState(false);
  return (
    <View style={{ padding: space[3], gap: space[2], borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface1, opacity: finding.status === "dismissed" ? 0.75 : 1 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], flexWrap: "wrap" }}>
        <View style={{ paddingHorizontal: space[2], height: touch ? 24 : 20, justifyContent: "center", borderRadius: radius.full, backgroundColor: colors.surface2 }}>
          <Label size={font.xs} selectable={false}>
            {t(targetLabels[finding.target])}
          </Label>
        </View>
        <Label muted size={font.xs} selectable={false}>
          {t(confidenceLabels[finding.confidence])}
        </Label>
        {(finding.seen ?? 1) > 1 && (
          <Label muted size={font.xs} selectable={false}>
            {tn(finding.seen, "Seen in {n} run", "Seen in {n} runs")}
          </Label>
        )}
      </View>
      <Label bold size={font.base}>
        {finding.title}
      </Label>
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
    </View>
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

function TokenUse({ tokens, titleOf, onOpenTask }: { tokens: TokenInsights | undefined; titleOf(id: string): string; onOpenTask(id: string): void }) {
  const { colors } = useTheme();
  if (!tokens) return null;
  const usage = tokens.tokens;
  return (
    <Section title={t("Token use")} detail={compactNumber(totalTokens(usage))}>
      <Panel>
        <View style={{ padding: space[3], gap: space[2] }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: space[4], rowGap: space[1] }}>
            {[
              [t("Input"), usage.input],
              [t("Cache read"), usage.cacheRead],
              [t("Cache write"), usage.cacheWrite],
              [t("Output"), usage.output],
            ].map(([label, value]) => (
              <Label key={label} muted size={font.sm} selectable={false}>
                {label} <Label size={font.sm}>{compactNumber(value as number)}</Label>
              </Label>
            ))}
            {cacheHitRate(usage) !== null && (
              <Label muted size={font.sm} selectable={false}>
                {t("Cached")}{" "}<Label size={font.sm}>{percent(cacheHitRate(usage)!)}</Label>
              </Label>
            )}
          </View>
          {tokens.tasks.map((row) => (
            <Pressable
              key={row.taskId}
              accessibilityRole="button"
              accessibilityLabel={t("{title}: {n} tokens. Open card", { title: titleOf(row.taskId), n: compactNumber(totalTokens(row.tokens)) })}
              onPress={() => onOpenTask(row.taskId)}
              style={(state) => {
                const { hovered, pressed } = state as typeof state & { hovered?: boolean };
                return {
                  ...noFocusRing,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space[2],
                  minHeight: touch ? 40 : 30,
                  paddingHorizontal: space[1],
                  borderRadius: radius.md,
                  backgroundColor: hovered || pressed ? colors.surface2 : "transparent",
                };
              }}
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                <Label size={font.md} lines={1} selectable={false}>
                  {titleOf(row.taskId)}
                </Label>
              </View>
              {cacheHitRate(row.tokens) !== null && (
                <Label muted size={font.sm} selectable={false}>
                  {t("{rate} cached", { rate: percent(cacheHitRate(row.tokens)!) })}
                </Label>
              )}
              <View style={{ minWidth: 52, alignItems: "flex-end" }}>
                <Label medium size={font.sm} selectable={false}>
                  {compactNumber(totalTokens(row.tokens))}
                </Label>
              </View>
            </Pressable>
          ))}
          {!tokens.tasks.length && (
            <Label muted size={font.sm}>
              {t("No tokens recorded on this day.")}</Label>
          )}
          <Label muted size={font.xs} selectable={false}>
            {t("From local Claude Code / Codex logs; tokens only, progress summaries included.")}
            {tokens.missing ? ` ${t("{missing} of {sessions} sessions have no local log.", { missing: tokens.missing, sessions: tokens.sessions })}` : ""}
          </Label>
        </View>
      </Panel>
    </Section>
  );
}

function Trend({ data, tokens, lanes, nameOf, compact }: { data: ProjectInsights; tokens: TokenInsights | undefined; lanes: readonly Status[]; nameOf(status: Status): string; compact: boolean }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(!compact);
  const max = Math.max(1, ...data.trend.flatMap((d) => [d.created, d.done]));
  const total = data.trend.reduce((s, d) => s + d.done, 0);
  const dwell = lanes.filter((s) => data.dwell[s] !== undefined && s !== "done" && s !== "cancelled");
  const barHeight = 72;
  return (
    <Disclosure title={t("Last 7 days")} summary={t("{n} done", { n: total })} open={open} onChange={setOpen}>
      <View style={{ gap: space[4], paddingTop: space[1] }}>
        <View style={{ gap: space[2] }}>
          <View style={{ flexDirection: "row", gap: space[3] }}>
            <Legend color={colors.foregroundMuted} label={t("New")} />
            <Legend color={colors.accent} label={t("Done")} />
            <Label muted size={font.xs} selectable={false}>
              {t("In progress at end of day below")}</Label>
          </View>
          <View style={{ flexDirection: "row", alignItems: "flex-end", gap: space[2] }}>
            {data.trend.map((d) => (
              <View key={d.day} accessibilityLabel={t("{day}: {created} new, {done} done, {work} in progress", { day: d.day, created: d.created, done: d.done, work: d.work })} style={{ flex: 1, alignItems: "center", gap: space[1] }}>
                <View style={{ height: barHeight, flexDirection: "row", alignItems: "flex-end", gap: 3 }}>
                  <Bar value={d.created} max={max} height={barHeight} color={colors.foregroundMuted} />
                  <Bar value={d.done} max={max} height={barHeight} color={colors.accent} />
                </View>
                <Label muted size={font.xs} selectable={false}>
                  {d.day === data.today ? t("Today") : new Date(`${d.day}T12:00:00Z`).toLocaleDateString(formatLocale(), { weekday: "short", timeZone: "UTC" })}
                </Label>
                <Label size={font.xs} selectable={false}>
                  {d.work}
                </Label>
              </View>
            ))}
          </View>
        </View>
        {!!tokens && (
          <View style={{ gap: space[2] }}>
            <Label muted size={font.xs} selectable={false}>
              {t("Tokens per day")}</Label>
            <View style={{ flexDirection: "row", alignItems: "flex-end", gap: space[2] }}>
              {tokens.trend.map((d) => (
                <View key={d.day} accessibilityLabel={t("{day}: {n} tokens", { day: d.day, n: compactNumber(d.total) })} style={{ flex: 1, alignItems: "center", gap: space[1] }}>
                  <View style={{ height: 48, justifyContent: "flex-end" }}>
                    <Bar value={d.total} max={Math.max(1, ...tokens.trend.map((x) => x.total))} height={48} color={colors.statusSuccess} />
                  </View>
                  <Label muted size={font.xs} selectable={false}>
                    {d.total ? compactNumber(d.total) : "0"}
                  </Label>
                </View>
              ))}
            </View>
          </View>
        )}
        {dwell.length > 0 && (
          <View style={{ gap: space[1] }}>
            <Label muted size={font.xs} selectable={false}>
              {t("Median time in each lane (cards that left it in these 7 days)")}</Label>
            {dwell.map((s) => (
              <View key={s} style={{ flexDirection: "row", alignItems: "center", gap: space[2], minHeight: 22 }}>
                <StatusIcon status={s} size={13} />
                <View style={{ flex: 1 }}>
                  <Label size={font.sm} selectable={false}>
                    {nameOf(s)}
                  </Label>
                </View>
                <Label size={font.sm} color={isWorkStatus(s) || s === "in_review" ? undefined : colors.foregroundMuted} selectable={false}>
                  {waitedLabel(data.dwell[s])}
                </Label>
              </View>
            ))}
          </View>
        )}
        {(data.git.topFiles.length > 0 || data.git.error) && (
          <View style={{ gap: space[1] }}>
            <Label muted size={font.xs} selectable={false}>
              {t("Most changed files")}</Label>
            {data.git.topFiles.map((f) => (
              <View key={f.path} style={{ flexDirection: "row", gap: space[2], minHeight: 20 }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Label size={font.sm} mono lines={1}>
                    {f.path}
                  </Label>
                </View>
                <Label muted size={font.sm} selectable={false}>
                  {tn(f.commits, "{n} commit", "{n} commits")}
                </Label>
              </View>
            ))}
            {!!data.git.error && (
              <Label muted size={font.xs}>
                {t("Git: {error}", { error: data.git.error })}
              </Label>
            )}
          </View>
        )}
      </View>
    </Disclosure>
  );
}

function Bar({ value, max, height, color }: { value: number; max: number; height: number; color: string }) {
  return <View style={{ width: 8, height: Math.max(value ? 3 : 1, Math.round((value / max) * height)), borderRadius: 2, backgroundColor: color, opacity: value ? 1 : 0.3 }} />;
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space[1] }}>
      <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: color }} />
      <Label muted size={font.xs} selectable={false}>
        {label}
      </Label>
    </View>
  );
}
