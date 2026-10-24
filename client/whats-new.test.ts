import { describe, expect, test } from "vitest";
import { WHATS_NEW_FROM, WHATS_NEW_MAX_ITEMS, compareVersions, latestRelease, seenAfter, stepRelease, validVersion, versionLabel, whatsNew, whatsNewDecision, whatsNewVersion, type WhatsNewRelease } from "./whats-new";
import { onboardingSettingsValues } from "../shared/settings";

const release: WhatsNewRelease = { version: "1.6.0", items: [{ icon: "Bell", text: "Something changed." }] };
const base = { settingsStatus: "ready", boardLoaded: true, welcomeSeen: true, whatsNewSeen: "1.5.0", release, blocked: false };

describe("What's new decision (WHATS-NEW-SPEC §2, §3)", () => {
  test("an existing user sees a release newer than the one last seen", () => {
    expect(whatsNewDecision(base)).toBe("show");
    expect(whatsNewDecision({ ...base, whatsNewSeen: "" })).toBe("show");
  });
  test("only once: closing stores this release, after which it is not shown again", () => {
    const stored = seenAfter(base.whatsNewSeen, release);
    expect(stored).toBe("1.6.0");
    expect(whatsNewDecision({ ...base, whatsNewSeen: stored })).toBe("none");
    // A later reinstall of an older build never shows an older release again.
    expect(whatsNewDecision({ ...base, whatsNewSeen: "1.7.0" })).toBe("none");
  });
  test("a release without items is never shown", () => {
    expect(whatsNewDecision({ ...base, release: null })).toBe("none");
    expect(whatsNewDecision({ ...base, release: { version: "1.6.0", items: [] } })).toBe("none");
    expect(seenAfter("1.5.0", null)).toBe("1.5.0");
  });
  test("a new user is not shown it, and closing the first-run tour marks this release seen", () => {
    expect(whatsNewDecision({ ...base, welcomeSeen: false, whatsNewSeen: "" })).toBe("none");
    // What the first-run tour's close stores next to welcomeSeen (onboarding-state markWelcomeSeen).
    expect(whatsNewDecision({ ...base, welcomeSeen: true, whatsNewSeen: seenAfter("", release) })).toBe("none");
  });
  test("waits for settings and the board, and while something else is open", () => {
    for (const settingsStatus of ["loading", "error", "invalid"]) expect(whatsNewDecision({ ...base, settingsStatus })).toBe("wait");
    expect(whatsNewDecision({ ...base, boardLoaded: false })).toBe("wait");
    expect(whatsNewDecision({ ...base, blocked: true })).toBe("wait");
  });
});

test("versions compare by number, and an empty or malformed value is older than any release", () => {
  expect(compareVersions("1.10.0", "1.9.0")).toBeGreaterThan(0);
  expect(compareVersions("1.6.0", "1.6.0")).toBe(0);
  expect(compareVersions("2.0.0", "1.99.99")).toBeGreaterThan(0);
  expect(compareVersions("1.0.0", "")).toBeGreaterThan(0);
  expect(compareVersions("1.0.0", "v1")).toBeGreaterThan(0);
  expect(seenAfter("1.7.0", release)).toBe("1.7.0");
  expect(versionLabel("1.6.0")).toBe("1.6");
  expect(versionLabel("1.6.2")).toBe("1.6.2");
});

test("the shipped releases are well formed: newest first, none before 1.5.0 (§4, §6)", () => {
  expect(whatsNew.length).toBeGreaterThan(0);
  whatsNew.forEach((release, index) => {
    expect(validVersion(release.version)).toBe(true);
    expect(compareVersions(release.version, WHATS_NEW_FROM)).toBeGreaterThanOrEqual(0);
    if (index > 0) expect(compareVersions(whatsNew[index - 1].version, release.version)).toBeGreaterThan(0);
    expect(release.items.length).toBeGreaterThanOrEqual(1);
    expect(release.items.length).toBeLessThanOrEqual(WHATS_NEW_MAX_ITEMS);
    for (const item of release.items) expect(item.text.trim()).not.toBe("");
    // Fits the stored setting.
    expect(onboardingSettingsValues({ whatsNewSeen: release.version }).whatsNewSeen).toBe(release.version);
  });
  expect(whatsNew.at(-1)?.version).toBe(WHATS_NEW_FROM);
});

test("only the newest release decides the automatic open; older pages never reopen it (§4)", () => {
  expect(latestRelease).toBe(whatsNew[0]);
  expect(whatsNewVersion(latestRelease)).toBe(whatsNew[0].version);
  // Someone who saw the newest release is not shown it again, whatever older releases exist.
  expect(whatsNewDecision({ ...base, release: latestRelease, whatsNewSeen: whatsNew[0].version })).toBe("none");
  // Someone who last saw an older release gets the newest one.
  expect(whatsNewDecision({ ...base, release: latestRelease, whatsNewSeen: WHATS_NEW_FROM })).toBe(whatsNew.length > 1 ? "show" : "none");
});

test("paging stays inside the releases: Newer stops at the newest, Older at the oldest", () => {
  expect(stepRelease(0, -1, 2)).toBe(0);
  expect(stepRelease(0, 1, 2)).toBe(1);
  expect(stepRelease(1, 1, 2)).toBe(1);
  expect(stepRelease(1, -1, 2)).toBe(0);
  expect(stepRelease(0, 1, 1)).toBe(0);
});

test("settings stored before What's new read as never seen", () => {
  expect(onboardingSettingsValues({ welcomeSeen: true, tipsSeen: [] }).whatsNewSeen).toBe("");
});
