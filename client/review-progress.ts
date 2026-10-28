import type { Review } from "../shared/model";

/**
 * phase B: `reviewProgress(review)` moves to shared/auto-review.ts with this shape (GUARDRAILS-SPEC §7.1.1); replace
 * this file's imports with it at the merge and delete the file. Gating items only; `na` counts as passed.
 */
export type ReviewProgress = { passed: number; failed: number; total: number; phase: "starting" | "running" | "judging" | "done"; current?: string; judging?: number };

export function reviewProgress(review: Pick<Review, "items" | "state">): ReviewProgress {
  const items = review.items ?? [];
  const gating = items.filter((i) => i.gating);
  const passed = gating.filter((i) => i.state === "passed" || i.state === "na").length;
  const failed = gating.filter((i) => i.state === "failed").length;
  const base = { passed, failed, total: gating.length };
  if (review.state !== "running") return { ...base, phase: "done" };
  const command = items.find((i) => i.kind === "command" && i.state === "running");
  if (command) return { ...base, phase: "running", current: command.name };
  const judging = items.filter((i) => i.kind !== "command" && i.state === "running").length;
  if (judging) return { ...base, phase: "judging", judging };
  return { ...base, phase: "starting" };
}
