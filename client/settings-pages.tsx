import { useEffect, useState } from "react";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { usePaseo, useSettings } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { AUTO_MODELS, modelLabel, summarySettings, summarySettingsValues } from "../shared/summary";
import {
  boardViewSettings,
  boardViewValues,
  ideasSettings,
  ideasSettingsValues,
  nativeSessionSettings,
  nativeSessionSettingsValues,
  languageSettings,
  languageSettingsValues,
  modelSettings,
  modelSettingsValues,
  statusSettings,
  statusSettingsValues,
  wrapupSettings,
  wrapupSettingsValues,
} from "../shared/settings";
import { agentModelFromValues, type AgentModel } from "../shared/agent-defaults";
import { deviceLocale, locales, t, tn } from "../shared/i18n";
import { hideFinishedChoices } from "./finished-cards";
import { modelOptions, providerOptions } from "./options";
import { ModelDefaultGroup } from "./model-default";
import { SettingRow, SettingSelect, SettingSwitch, SettingsGroup, SettingsPage } from "./settings-ui";
import { useOnboarding } from "./onboarding";
import { Notice, useTheme } from "./ui";

const AUTO = "";

/** Stored values and a patch-and-save that reloads when another writer got there first. */
// The SDK's settings state is generic in the definition; the pages only need this shape.
type Stored<T> = { status: string; values?: unknown; revision?: number; saving: boolean; error?: string; saveError?: string; save(values: T, revision: never): Promise<unknown>; reload(): Promise<unknown> | void };
function useStored<T extends object>(settings: unknown, parse: (values: unknown) => T) {
  const s = settings as Stored<T>;
  const values = s.status === "ready" ? parse(s.values) : null;
  return {
    values,
    busy: !values || s.saving,
    problem: s.status === "error" || s.status === "invalid" ? s.error : s.saveError,
    save(patch: Partial<T>) {
      if (!values || s.saving) return;
      void (s.save as (v: T, r: unknown) => Promise<unknown>)({ ...values, ...patch }, s.revision).then((saved) => {
        if (!saved) void s.reload();
      });
    },
  };
}

function Problem({ text }: { text?: string }) {
  return text ? <Notice>{text}</Notice> : null;
}

/** General: interface language and the welcome tour. */
export function GeneralPage({ onTour }: { onTour(): void }) {
  const language = useStored(useSettings(languageSettings), languageSettingsValues);
  const onboarding = useOnboarding();
  const [reset, setReset] = useState(false);
  const deviceName = locales.find((l) => l.code === deviceLocale())?.name ?? "English";
  const autoLabel = t("Device ({language})", { language: deviceName });
  return (
    <SettingsPage title={t("General")} description={t("Language and the welcome tour.")}>
      <Problem text={language.problem} />
      <SettingsGroup
        title={t("Language")}
        description={t("The language of Flowly's buttons and messages. Agent instructions, error details from the daemon and AI-written summaries are not affected.")}
      >
        <SettingSelect
          title={t("Interface language")}
          value={language.values?.language ?? "auto"}
          placeholder={autoLabel}
          disabled={language.busy}
          options={[{ value: "auto", label: autoLabel }, ...locales.map((l) => ({ value: l.code as string, label: l.name }))]}
          onChange={(next) => language.save({ language: next as NonNullable<typeof language.values>["language"] })}
        />
      </SettingsGroup>
      <SettingsGroup
        title={t("Welcome tour")}
        description={t("A short tour of projects, cards and sessions and how they map to Paseo. One-time tips appear as you use the board.")}
      >
        <SettingRow title={t("Show welcome tour")} onPress={onTour} trailing={<ChevronRight />} />
        <SettingRow
          title={t("Show tips again")}
          detail={reset ? t("Tips will show again") : undefined}
          disabled={!onboarding.values || reset}
          onPress={() => {
            setReset(true);
            void onboarding.resetTips();
          }}
          trailing={<ChevronRight />}
        />
      </SettingsGroup>
    </SettingsPage>
  );
}

function ChevronRight() {
  const { colors } = useTheme();
  return <Icon name="ChevronRight" size={16} color={colors.foregroundMuted} />;
}

/** Models: the default model of new sessions, and the one that writes summaries. */
export function ModelsPage({ active }: { active: boolean }) {
  const models = useStored(useSettings(modelSettings), modelSettingsValues);
  const current = agentModelFromValues(models.values);
  return (
    <SettingsPage title={t("Models")} description={t("Which model new sessions start with, and which one writes summaries.")}>
      <Problem text={models.problem} />
      <ModelDefaultGroup
        title={t("Default model")}
        description={t("New sessions, and “Start an agent now” on a new task, start with this model. A project can set its own in its settings; that one wins.")}
        value={current}
        disabled={models.busy}
        noneLabel={t("Automatic")}
        noneDetail={t("Start from the latest session's settings")}
        onChange={(next: AgentModel | null) => models.save({ defaultProvider: next?.provider ?? "", defaultModel: next?.model ?? "", defaultThinking: next?.thinking ?? "" })}
      />
      <SummaryModelGroup active={active} />
    </SettingsPage>
  );
}

/** Provider and model of the summarizer (TASK-SUMMARY-SPEC §4); "Auto" prefers Claude's cheap model, then Codex's. */
function SummaryModelGroup({ active }: { active: boolean }) {
  const paseo = usePaseo();
  const summary = useStored(useSettings(summarySettings), summarySettingsValues);
  const stored = summary.values?.summaryModel || AUTO;
  const storedProvider = stored ? stored.slice(0, stored.indexOf("/")) : AUTO;
  // The provider shown can run ahead of the stored model until a model is picked.
  const [provider, setProvider] = useState(storedProvider);
  useEffect(() => setProvider(storedProvider), [storedProvider]);
  const providers = useQuery({ queryKey: ["flowly", "providers"], queryFn: () => paseo.providers.listAvailable(), enabled: active });
  const providerInfo = useQuery({ queryKey: ["flowly", "providerSnapshot"], queryFn: () => paseo.providers.snapshot(), enabled: active, staleTime: 60000 });
  const models = useQuery({
    queryKey: ["flowly", "summary-models", provider],
    queryFn: async () => {
      const result = await paseo.providers.listModels(provider);
      if (result.error) throw new Error(result.error);
      return result;
    },
    enabled: active && provider !== AUTO,
  });
  const autoLabel = t("Auto ({models})", { models: AUTO_MODELS.map(modelLabel).join(t(", then ")) });
  const storedModel = stored && provider === storedProvider ? stored.slice(stored.indexOf("/") + 1) : "";
  return (
    <>
      <Problem text={summary.problem} />
      <SettingsGroup title={t("Summary model")} description={t("Writes the task progress summaries and the daily digest. A cheap, fast model is enough.")}>
        <SettingSelect
          title={t("Provider")}
          value={provider}
          placeholder={autoLabel}
          disabled={summary.busy}
          loading={providers.isPending}
          options={[{ value: AUTO, label: autoLabel, detail: t("Uses Claude when available, otherwise Codex") }, ...providerOptions(providers.data?.providers || [], providerInfo.data?.entries || [])]}
          onChange={(next) => {
            setProvider(next);
            if (next === AUTO) summary.save({ summaryModel: "" });
          }}
        />
        {provider !== AUTO && (
          <SettingSelect
            title={t("Model")}
            value={storedModel}
            placeholder={t("Choose a model")}
            disabled={summary.busy}
            loading={models.isPending}
            options={modelOptions(models.data?.models || [])}
            onChange={(model) => summary.save({ summaryModel: `${provider}/${model}` })}
          />
        )}
      </SettingsGroup>
      {provider !== AUTO && !storedModel && (
        <Notice tone="info">{t("Pick a model to use this provider. Until then the stored choice stays: {choice}.", { choice: stored ? stored : autoLabel })}</Notice>
      )}
      {models.error && <Notice tone="warning">{t("Could not list models: {error}", { error: String((models.error as Error).message || models.error) })}</Notice>}
    </>
  );
}

/** Workflow: when cards move by themselves and what happens when they finish. */
export function WorkflowPage() {
  const status = useStored(useSettings(statusSettings), statusSettingsValues);
  const wrapup = useStored(useSettings(wrapupSettings), wrapupSettingsValues);
  const view = useStored(useSettings(boardViewSettings), boardViewValues);
  const hideAfter = view.values?.hideFinishedAfterDays ?? 14;
  const dayLabel = (days: number) => (days ? tn(days, "After {n} day", "After {n} days") : t("Never"));
  const hideOptions = [...new Set<number>([...hideFinishedChoices, hideAfter])]
    .sort((a, b) => a - b)
    .map((days) => ({ value: String(days), label: dayLabel(days) }));
  return (
    <SettingsPage title={t("Workflow")} description={t("How cards move through the board and what happens when they are done.")}>
      <Problem text={status.problem || wrapup.problem || view.problem} />
      <SettingsGroup title={t("Moving cards")} description={t("Agents always set their own work stage and deliver to review. These rules react to session activity on top of that.")}>
        <SettingSwitch
          title={t("Auto-update status from sessions")}
          detail={t("A Kanban session resuming after review moves the card to Development, after a blocker back to its previous stage; a turn that ends without a report puts a reviewed card back. A project can still turn this off in its settings.")}
          value={status.values?.autoStatus ?? true}
          disabled={status.busy}
          onChange={(autoStatus) => status.save({ autoStatus })}
        />
      </SettingsGroup>
      <SettingsGroup title={t("Finishing cards")} description={t("When a card moves to Done or Cancelled, you are asked whether to wrap it up: archive its workspace and sessions. The card stays on the board.")}>
        <SettingSwitch
          title={t("Auto wrap up")}
          detail={t("Archive without asking when nothing blocks it: no running session, no uncommitted or unpushed work. Otherwise the card is left for manual Wrap up.")}
          value={wrapup.values?.autoWrapup ?? false}
          disabled={wrapup.busy}
          onChange={(autoWrapup) => wrapup.save({ autoWrapup })}
        />
        <SettingSwitch
          title={t("Auto archive on delete")}
          detail={t("When you delete a card, also archive its sessions (and its own workspace) without asking, when nothing blocks it. Otherwise the delete dialog asks.")}
          value={wrapup.values?.archiveOnDelete ?? false}
          disabled={wrapup.busy}
          onChange={(archiveOnDelete) => wrapup.save({ archiveOnDelete })}
        />
        <SettingSelect
          title={t("Hide old finished cards")}
          detail={t("Done and Cancelled cards that finished longer ago fold under “Show older” at the bottom of their lane. They are not archived.")}
          value={String(hideAfter)}
          placeholder={dayLabel(hideAfter)}
          disabled={view.busy}
          options={hideOptions}
          onChange={(next) => view.save({ hideFinishedAfterDays: Number(next) })}
        />
      </SettingsGroup>
    </SettingsPage>
  );
}

/** AI features: what the plugin writes for you, and the ideas agents propose. */
export function AiPage() {
  const summary = useStored(useSettings(summarySettings), summarySettingsValues);
  const ideas = useStored(useSettings(ideasSettings), ideasSettingsValues);
  const native = useStored(useSettings(nativeSessionSettings), nativeSessionSettingsValues);
  const tapOptions = [
    { value: "fill", label: t("Fill the message box") },
    { value: "copy", label: t("Copy") },
  ];
  return (
    <SettingsPage title={t("AI features")} description={t("What the board writes and suggests for you. The model is chosen under Models.")}>
      <Problem text={summary.problem || ideas.problem || native.problem} />
      <SettingsGroup
        title={t("Task progress summary")}
        description={t("After each agent turn on a card, a cheap model updates the card's state, recap and next step. It runs as a short child session that is archived right after.")}
      >
        <SettingSwitch
          title={t("Auto summary")}
          detail={t("Update after every completed turn. Refresh on a card always works.")}
          value={summary.values?.summaryEnabled ?? true}
          disabled={summary.busy}
          onChange={(summaryEnabled) => summary.save({ summaryEnabled })}
        />
        <SettingSwitch
          title={t("Daily digest")}
          detail={t("Write a past day's project summary when Insights opens it. Refresh in Insights always works.")}
          value={summary.values?.digestEnabled ?? true}
          disabled={summary.busy}
          onChange={(digestEnabled) => summary.save({ digestEnabled })}
        />
      </SettingsGroup>
      <SettingsGroup title={t("Ideas")} description={t("Agents suggest worthwhile next steps as ideas on their cards; you turn them into new tasks or dismiss them.")}>
        <SettingSwitch
          title={t("Ideas")}
          detail={t("Off: the Ideas page, the card sections and the lightbulb counts are hidden, and agents can no longer propose ideas. Existing ideas are kept and come back when you turn this on.")}
          value={ideas.values?.ideas ?? true}
          disabled={ideas.busy}
          onChange={(value) => ideas.save({ ideas: value })}
        />
      </SettingsGroup>
      <SettingsGroup
        title={t("Paseo's session view")}
        description={t("Flowly sessions opened in Paseo itself show the agent's suggested next steps as a card under its last reply.")}
      >
        <SettingSelect
          title={t("Tapping a suggested next step")}
          detail={t("Fill puts it in that session's message box on web and desktop; nothing is sent. Where that is not possible, and with Copy, it is copied for you to paste.")}
          value={native.values?.nextMoveTap ?? "fill"}
          placeholder={tapOptions.find((o) => o.value === (native.values?.nextMoveTap ?? "fill"))?.label ?? ""}
          disabled={native.busy}
          options={tapOptions}
          onChange={(next) => native.save({ nextMoveTap: next === "copy" ? "copy" : "fill" })}
        />
      </SettingsGroup>
      <SettingsGroup title={t("Artifacts")} description={t("Each card lists its inputs and outputs: files and links it worked from or delivered. You can always add them by hand.")}>
        <SettingSwitch
          title={t("Agent artifacts")}
          detail={t("Off: agents can no longer add or remove artifacts and list deliverables in their replies instead. Existing artifacts are kept.")}
          value={ideas.values?.artifacts ?? true}
          disabled={ideas.busy}
          onChange={(value) => ideas.save({ artifacts: value })}
        />
      </SettingsGroup>
    </SettingsPage>
  );
}
