import { expect, test } from "vitest";
import type { ReviewItem } from "../shared/model";
import { reviewProgress } from "./review-progress";

const item = (id: string, kind: ReviewItem["kind"], state: ReviewItem["state"], gating = true): ReviewItem => ({ id, kind, name: id, gating, state });

test("counts gating items only, na as passed, and names the running command", () => {
  const items = [item("tc", "command", "passed"), item("lint", "command", "running"), item("e2e", "command", "passed", false), item("goal", "goal", "queued"), item("g1", "guideline", "na")];
  expect(reviewProgress({ state: "running", items })).toEqual({ passed: 2, failed: 0, total: 4, phase: "running", current: "lint" });
});

test("judging counts the items the review session is checking; starting before any result", () => {
  const judging = [item("tc", "command", "failed"), item("goal", "goal", "running"), item("g1", "guideline", "running")];
  expect(reviewProgress({ state: "running", items: judging })).toMatchObject({ failed: 1, phase: "judging", judging: 2 });
  expect(reviewProgress({ state: "running", items: [item("tc", "command", "queued")] }).phase).toBe("starting");
  expect(reviewProgress({ state: "running", items: undefined }).phase).toBe("starting");
});

test("a finished review is done", () => {
  expect(reviewProgress({ state: "passed", items: [item("tc", "command", "passed")] })).toEqual({ passed: 1, failed: 0, total: 1, phase: "done" });
});
