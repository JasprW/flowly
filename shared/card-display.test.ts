import { expect, test } from "vitest";
import { activityLines, cardDisplay, withCardField } from "./card-display";

test("everything shows by default; hidden ids hide their field and unknown ids are ignored", () => {
  expect(cardDisplay(null)).toMatchObject({ activity: "auto", priority: true, type: true, external: true, tags: true, sessions: true, workpad: true, ideas: true });
  expect(cardDisplay({ cardHidden: ["tags", "ideas", "later"], cardActivity: "none" })).toMatchObject({ activity: "none", tags: false, ideas: false, type: true });
  expect(cardDisplay({ cardActivity: "bogus" }).activity).toBe("auto");
});

test("the ticket field's old id still hides the external key (CONNECTORS-SPEC §3.3)", () => {
  expect(cardDisplay({ cardHidden: ["ticket"] }).external).toBe(false);
  expect(withCardField(["ticket", "later"], "external", true)).toEqual(["later"]);
});

test("toggling a field keeps ids from newer clients", () => {
  expect(withCardField(["later"], "tags", false)).toEqual(["later", "tags"]);
  expect(withCardField(["later", "tags"], "tags", true)).toEqual(["later"]);
  expect(withCardField(["tags"], "tags", false)).toEqual(["tags"]);
});

test("auto shows the progress summary and falls back to the latest output", () => {
  expect(activityLines("auto", true, true)).toEqual({ progress: true, output: false });
  expect(activityLines("auto", false, true)).toEqual({ progress: false, output: true });
  expect(activityLines("both", true, true)).toEqual({ progress: true, output: true });
  expect(activityLines("progress", false, true)).toEqual({ progress: false, output: false });
  expect(activityLines("output", true, true)).toEqual({ progress: false, output: true });
  expect(activityLines("none", true, true)).toEqual({ progress: false, output: false });
});
