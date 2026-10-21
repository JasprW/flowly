import { describe, expect, test } from "vitest";
import { aiLanguageNames, outputLanguage, outputLanguageRule, resolveAiLanguage } from "./ai-language";
import { localeCodes } from "./i18n";
import { digestPrompt } from "./digest";
import { insightPrompt } from "./session-insights";
import { summaryPrompt } from "./summary";
import { workflowPrompt } from "./workflow-insights";
import { aiLanguageSettingsValues, deviceLanguageValue } from "./settings";

describe("resolveAiLanguage (AI-LANGUAGE-SPEC §3)", () => {
  test("a fixed AI language wins over the interface language and the device", () => {
    expect(resolveAiLanguage({ ai: "ja", interface: "de", reported: "fr", host: "es" })).toBe("ja");
  });
  test("'interface' follows a fixed interface language", () => {
    expect(resolveAiLanguage({ ai: "interface", interface: "zh-CN", reported: "fr", host: "es" })).toBe("zh-CN");
  });
  test("interface 'auto' uses the language a client reported, then the host's, then English", () => {
    expect(resolveAiLanguage({ ai: "interface", interface: "auto", reported: "zh-TW", host: "es" })).toBe("zh-TW");
    expect(resolveAiLanguage({ ai: "interface", interface: "auto", reported: "", host: "es" })).toBe("es");
    expect(resolveAiLanguage({ ai: "interface", interface: "auto", reported: "", host: "" })).toBe("en");
    expect(resolveAiLanguage({})).toBe("en");
  });
  test("invalid values are ignored, not trusted", () => {
    expect(resolveAiLanguage({ ai: "klingon", interface: "elvish", reported: "xx", host: "ko" })).toBe("ko");
  });
  test("every supported language has a name and a rule line that names it", () => {
    for (const code of localeCodes) {
      expect(aiLanguageNames[code]).toBeTruthy();
      expect(outputLanguageRule(code)).toContain(`in ${aiLanguageNames[code]},`);
    }
    expect(outputLanguage("zh-CN")).toEqual({ code: "zh-CN", name: "Simplified Chinese" });
  });
});

describe("settings", () => {
  test("default follows the interface; unreadable values fall back to the default", () => {
    expect(aiLanguageSettingsValues({}).aiLanguage).toBe("interface");
    expect(aiLanguageSettingsValues({ aiLanguage: "nope" }).aiLanguage).toBe("interface");
    expect(aiLanguageSettingsValues({ aiLanguage: "de" }).aiLanguage).toBe("de");
    expect(deviceLanguageValue({ locale: "ru" })).toBe("ru");
    expect(deviceLanguageValue({ locale: "nope" })).toBe("");
    expect(deviceLanguageValue(undefined)).toBe("");
  });
});

// One test per prompt builder: it states the resolved language and no longer leaves the choice to the model.
const OLD_WORDING = [/language the cards/i, /language the person uses/i, /language most card titles/i, /user's language/i];
const rule = outputLanguageRule("zh-CN");

describe("every prompt states the output language", () => {
  const expectRule = (prompt: string) => {
    expect(prompt).toContain(rule);
    expect(prompt).toContain("Simplified Chinese");
    for (const old of OLD_WORDING) expect(prompt).not.toMatch(old);
  };
  test("card summary", () => {
    expectRule(summaryPrompt({ title: "t", description: "", lane: "Todo", previous: null, transcript: "", language: "zh-CN" }));
  });
  test("daily digest", () => {
    expectRule(digestPrompt({ project: "P", day: "2026-10-21", today: false, material: "m", language: "zh-CN" }));
  });
  test("session insights", () => {
    expectRule(
      insightPrompt({
        title: "t",
        cwd: "/r",
        previous: null,
        transcript: "",
        openIdeas: [],
        openIdeaCount: 0,
        parts: { progress: true, nextMoves: true, ideas: true },
        language: "zh-CN",
      }),
    );
  });
  test("workflow insights", () => {
    expectRule(workflowPrompt(7, "material", "zh-CN"));
  });
  test("another language changes the line, not the rest", () => {
    expect(workflowPrompt(7, "material", "de")).toContain(outputLanguageRule("de"));
    expect(workflowPrompt(7, "material", "de")).not.toContain("Simplified Chinese");
  });
});
