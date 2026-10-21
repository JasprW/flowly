import { localeCodes, type LanguagePreference, type LocaleCode } from "./i18n";

/** Stored AI output language (AI-LANGUAGE-SPEC §2): follow the interface language, or one fixed language. */
export type AiLanguagePreference = "interface" | LocaleCode;
export const aiLanguageChoices = ["interface", ...localeCodes] as const;

/** English names for prompts and tool results: the model reads these, so they are never translated. */
export const aiLanguageNames: Record<LocaleCode, string> = {
  en: "English",
  "zh-CN": "Simplified Chinese",
  "zh-TW": "Traditional Chinese",
  ja: "Japanese",
  ko: "Korean",
  es: "Spanish",
  fr: "French",
  de: "German",
  "pt-BR": "Brazilian Portuguese",
  ru: "Russian",
};

const isLocale = (value: unknown): value is LocaleCode => localeCodes.includes(value as LocaleCode);

/**
 * The language every AI-written text uses (AI-LANGUAGE-SPEC §3): the AI setting, else the interface
 * language, else (interface "auto") the device language a client reported, else the daemon host's, else English.
 */
export function resolveAiLanguage(input: {
  ai?: AiLanguagePreference | string | null;
  interface?: LanguagePreference | string | null;
  reported?: string | null;
  host?: string | null;
}): LocaleCode {
  if (isLocale(input.ai)) return input.ai;
  if (isLocale(input.interface)) return input.interface;
  if (isLocale(input.reported)) return input.reported;
  if (isLocale(input.host)) return input.host;
  return "en";
}

/** What `flowly_get_task` returns as `outputLanguage`. */
export function outputLanguage(code: LocaleCode) {
  return { code, name: aiLanguageNames[code] };
}

/** The one line every prompt carries instead of guessing the language from its material. */
export function outputLanguageRule(code: LocaleCode): string {
  return `Write every title and text in ${aiLanguageNames[code]}, whatever language the material below is in. Keep commands, code, file names, IDs and JSON keys as they are.`;
}
