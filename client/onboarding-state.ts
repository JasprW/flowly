import { useEffect, useRef, useState } from "react";
import { useSettings } from "@getpaseo/plugin/client";
import { onboardingSettings, onboardingSettingsValues, type OnboardingSettings } from "../shared/settings";
import { tipIds, withTipSeen, type TipId } from "./onboarding-logic";
import { latestRelease, seenAfter } from "./whats-new";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Host-scoped onboarding state with safe writes: a save against a stale
 * revision is merged into the latest values and retried, and a change shows at
 * once (optimistic) until the stored values agree.
 */
export function useOnboarding() {
  const settings = useSettings(onboardingSettings);
  const latest = useRef(settings);
  latest.current = settings;
  const stored = settings.status === "ready" ? onboardingSettingsValues(settings.values) : null;
  const [overlay, setOverlay] = useState<Partial<OnboardingSettings>>({});
  useEffect(() => {
    if (!stored) return;
    setOverlay((current) => {
      const left = Object.fromEntries(
        Object.entries(current).filter(([key, value]) => JSON.stringify(stored[key as keyof OnboardingSettings]) !== JSON.stringify(value)),
      );
      return Object.keys(left).length === Object.keys(current).length ? current : left;
    });
  }, [settings.status === "ready" ? settings.revision : ""]);
  const values: OnboardingSettings | null = stored ? { ...stored, ...overlay } : null;
  const valuesRef = useRef(values);
  valuesRef.current = values;

  async function update(change: (current: OnboardingSettings) => Partial<OnboardingSettings>) {
    if (valuesRef.current) {
      const patch = change(valuesRef.current);
      setOverlay((current) => ({ ...current, ...patch }));
    }
    for (let attempt = 0; attempt < 4; attempt++) {
      const current = latest.current;
      if (current.status !== "ready" || current.revision === undefined) {
        await wait(150);
        continue;
      }
      const base = onboardingSettingsValues(current.values);
      const next = { ...base, ...change(base) };
      if (JSON.stringify(next) === JSON.stringify(base)) return true;
      if (await current.save(next, current.revision)) return true;
      await current.reload();
      await wait(50 * (attempt + 1));
    }
    // Give up visibly rather than show a value that was not stored.
    setOverlay({});
    return false;
  }

  return {
    status: settings.status,
    values,
    /** The tour covers this release's What's new, so a new user is not shown it next (WHATS-NEW-SPEC §2). */
    markWelcomeSeen: () => update((current) => ({ welcomeSeen: true, whatsNewSeen: seenAfter(current.whatsNewSeen, latestRelease) })),
    markWhatsNewSeen: () => update((current) => ({ whatsNewSeen: seenAfter(current.whatsNewSeen, latestRelease) })),
    /** Someone who already uses the board: no tour and no first-time tips. */
    markExistingUserSeen: () => update(() => ({ welcomeSeen: true, tipsSeen: [...tipIds] })),
    markTipSeen: (id: TipId) => update((current) => ({ tipsSeen: withTipSeen(current.tipsSeen, id) })),
    /** Show every one-time tip again. The welcome tour is reopened by hand; resetting it would only make the board re-mark existing users. */
    resetTips: () => update(() => ({ tipsSeen: [] })),
  };
}
