import { useEffect, useState } from "react";
import { usePaseo } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import type { AgentModel } from "../shared/agent-defaults";
import { modelOptions, providerOptions } from "./options";
import { SettingSelect, SettingsGroup } from "./settings-ui";
import { t } from "../shared/i18n";

/**
 * Provider, model and reasoning effort of a default model, as one card of rows.
 * "None" (first provider choice) clears it: `noneLabel` says what then applies.
 */
export function ModelDefaultGroup({
  title,
  description,
  value,
  onChange,
  noneLabel,
  noneDetail,
  disabled = false,
}: {
  title?: string;
  description?: string;
  value: AgentModel | null;
  onChange(next: AgentModel | null): void;
  noneLabel: string;
  noneDetail?: string;
  disabled?: boolean;
}) {
  const paseo = usePaseo();
  // A provider can be picked before its model is: the model row follows it.
  const [provider, setProvider] = useState(value?.provider ?? "");
  useEffect(() => setProvider(value?.provider ?? ""), [value?.provider]);
  const providers = useQuery({ queryKey: ["flowly", "providers"], queryFn: () => paseo.providers.listAvailable() });
  const providerInfo = useQuery({ queryKey: ["flowly", "providerSnapshot"], queryFn: () => paseo.providers.snapshot(), staleTime: 60000 });
  const models = useQuery({
    queryKey: ["flowly", "default-models", provider],
    queryFn: async () => {
      const result = await paseo.providers.listModels(provider);
      if (result.error) throw new Error(result.error);
      return result;
    },
    enabled: !!provider,
  });
  const modes = useQuery({
    queryKey: ["flowly", "default-modes", provider],
    queryFn: async () => {
      const result = await paseo.providers.listModes(provider);
      if (result.error) throw new Error(result.error);
      return result;
    },
    enabled: !!provider,
  });
  const selectable = (models.data?.models || []).filter((m) => m.isSelectable !== false);
  const sameProvider = !!value && value.provider === provider;
  const model = sameProvider ? value!.model : "";
  // Choosing a provider also chooses its default model, so the default is always complete.
  useEffect(() => {
    if (!provider || model || !models.isSuccess || !selectable.length) return;
    const pick = selectable.find((m) => m.isDefault) || selectable[0];
    onChange({ provider, model: pick.id });
  }, [provider, model, models.isSuccess, selectable.length]);
  const thinkingOptions = selectable.find((m) => m.id === model)?.thinkingOptions || [];
  const thinking = sameProvider && value!.thinking && thinkingOptions.some((o) => o.id === value!.thinking) ? value!.thinking! : "";
  const defaultThinking = selectable.find((m) => m.id === model)?.defaultThinkingOptionId;
  const defaultThinkingLabel = thinkingOptions.find((o) => o.id === defaultThinking)?.label;
  const modeList = modes.data?.modes || [];
  const mode = sameProvider && value!.mode && modeList.some((m) => m.id === value!.mode) ? value!.mode! : "";
  const modelDefault = defaultThinkingLabel ? t("Model default ({defaultLabel})", { defaultLabel: defaultThinkingLabel }) : t("Model default");
  return (
    <SettingsGroup title={title} description={description}>
      <SettingSelect
        title={t("Provider")}
        value={provider}
        placeholder={noneLabel}
        disabled={disabled}
        loading={providers.isPending}
        options={[{ value: "", label: noneLabel, detail: noneDetail }, ...providerOptions(providers.data?.providers || [], providerInfo.data?.entries || [])]}
        onChange={(next) => {
          setProvider(next);
          if (!next) onChange(null);
        }}
      />
      {!!provider && (
        <SettingSelect
          title={t("Model")}
          value={model}
          placeholder={t("Choose a model")}
          disabled={disabled}
          loading={models.isPending}
          options={modelOptions(models.data?.models || [])}
          onChange={(next) => onChange({ provider, model: next, ...(mode ? { mode } : {}) })}
        />
      )}
      {!!provider && !!model && thinkingOptions.length > 0 && (
        <SettingSelect
          title={t("Reasoning")}
          value={thinking}
          placeholder={modelDefault}
          disabled={disabled}
          options={[
            { value: "", label: modelDefault, detail: t("Use the model's default reasoning effort") },
            ...thinkingOptions.map((o) => ({ value: o.id, label: o.label, detail: o.description })),
          ]}
          onChange={(next) => onChange({ provider, model, ...(next ? { thinking: next } : {}), ...(mode ? { mode } : {}) })}
        />
      )}
      {!!provider && !!model && modeList.length > 0 && (
        <SettingSelect
          title={t("Permissions")}
          value={mode}
          placeholder={t("Provider default")}
          disabled={disabled}
          options={[
            { value: "", label: t("Provider default"), detail: t("Use the provider's configured permission mode") },
            ...modeList.map((m) => ({ value: m.id, label: m.label, detail: m.description })),
          ]}
          onChange={(next) => onChange({ provider, model, ...(thinking ? { thinking } : {}), ...(next ? { mode: next } : {}) })}
        />
      )}
    </SettingsGroup>
  );
}
