import { View } from "react-native";
import { useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import * as rpc from "../shared/rpc";
import { cacheHitRate, compactDuration, compactNumber, percent, totalTokens, type SessionUsage, type TokenUsage } from "../shared/usage";
import { Section, type SectionState } from "./disclosure";
import { Label, font, message, radius, space, useTheme } from "./ui";
import { t, tn } from "../shared/i18n";

/** Drawer "Usage": token use read from local Claude Code / Codex logs (USAGE-STATS-SPEC). Collapsed by default. */
export function TaskUsage({ taskId, active, section }: { taskId: string; active: boolean; section: SectionState }) {
  const { colors } = useTheme();
  const open = section.open;
  const read = useRpc(rpc.taskUsage);
  const usage = useQuery({
    queryKey: ["flowly", "usage", taskId],
    queryFn: () => read({ taskId }),
    enabled: active,
    staleTime: 30_000,
    refetchInterval: open ? 30_000 : 120_000,
    placeholderData: (previous) => previous,
  });
  const data = usage.data;
  const total = data ? totalTokens(data.total) : 0;
  const summary = data
    ? total
      ? [t("{n} tokens", { n: compactNumber(total) }), cacheHitRate(data.total) !== null ? t("{rate} cached", { rate: percent(cacheHitRate(data.total)!) }) : "", data.turns ? tn(data.turns, "{n} turn", "{n} turns") : ""].filter(Boolean).join(" · ")
      : t("No token data")
    : usage.isPending
      ? t("Counting…")
      : "";
  const work = data?.sessions.filter((s) => !s.summarizer) || [];
  const summarizers = data?.sessions.filter((s) => s.summarizer) || [];
  return (
    <Section id={taskId} title={t("Usage")} summary={summary} open={open} onToggle={section.onToggle}>
      {usage.error && !data ? (
        <Label muted size={font.sm}>{message(usage.error)}</Label>
      ) : !data ? (
        <Label muted size={font.sm}>{t("Counting…")}</Label>
      ) : (
        <View style={{ gap: space[3] }}>
          <View style={{ padding: space[3], gap: space[1], borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface1 }}>
            <Breakdown tokens={data.total} />
            {(data.turns > 0 || data.activeMs > 0) && (
              <Label muted size={font.sm} selectable={false}>
                {tn(data.turns, "{n} turn", "{n} turns")} · {t("{time} running", { time: compactDuration(data.activeMs) })}
              </Label>
            )}
          </View>
          {work.length > 0 && (
            <View style={{ gap: space[1] }}>
              <Label muted size={font.xs} selectable={false}>{t("Sessions")}</Label>
              {work.map((s) => (
                <SessionLine key={s.agentId} session={s} />
              ))}
            </View>
          )}
          {summarizers.length > 0 && (
            <Line
              title={tn(summarizers.length, "Progress summaries · {n} run", "Progress summaries · {n} runs")}
              value={compactNumber(totalTokens(data.summarizer))}
            />
          )}
          <Label muted size={font.sm} selectable={false}>
            {t("From local Claude Code / Codex logs; tokens only. Output includes reasoning.")}</Label>
        </View>
      )}
    </Section>
  );
}

function Breakdown({ tokens }: { tokens: TokenUsage }) {
  return (
    <View style={{ gap: 2 }}>
      <Line title={t("Input")} value={compactNumber(tokens.input)} />
      <Line title={t("Cache read")} value={compactNumber(tokens.cacheRead)} />
      <Line title={t("Cache write")} value={compactNumber(tokens.cacheWrite)} />
      <Line
        title={t("Output")}
        value={`${compactNumber(tokens.output)}${tokens.reasoning ? ` (${t("{n} reasoning", { n: compactNumber(tokens.reasoning) })})` : ""}`}
      />
      <Line title={t("Total")} value={compactNumber(totalTokens(tokens))} strong />
      <Line title={t("Cache hit rate")} value={hitText(tokens)} />
    </View>
  );
}

const hitText = (tokens: TokenUsage) => {
  const rate = cacheHitRate(tokens);
  return rate === null ? "—" : percent(rate);
};

function SessionLine({ session }: { session: SessionUsage }) {
  const rate = session.tokens ? cacheHitRate(session.tokens) : null;
  const detail = session.tokens
    ? `${compactNumber(totalTokens(session.tokens))}${rate === null ? "" : ` · ${t("{rate} cached", { rate: percent(rate) })}`}`
    : session.note || "—";
  return (
    <Line
      title={`${session.title} · ${session.provider}`}
      value={detail}
      muted={!session.tokens}
    />
  );
}

function Line({ title, value, hint, strong = false, muted = false }: { title: string; value: string; hint?: string; strong?: boolean; muted?: boolean }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "baseline", gap: space[2] }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Label size={font.sm} muted={!strong} medium={strong} lines={1} selectable={false}>
          {title}
          {!!hint && <Label size={font.xs} muted selectable={false}>{`  ${hint}`}</Label>}
        </Label>
      </View>
      <View style={{ flexShrink: 1, maxWidth: "60%" }}>
        <Label size={font.md} muted={muted} medium={strong} lines={2} selectable>
          {value}
        </Label>
      </View>
    </View>
  );
}
