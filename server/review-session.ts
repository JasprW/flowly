import type { PaseoApi } from "@getpaseo/client";
import { SUMMARIZER_LABELS } from "../shared/summary";
import { autoReviewLimits } from "../shared/model";
import { GOAL_ID } from "../shared/auto-review";
import { daemonRemoveAgent, type RemoveAgent } from "./summarizer-remove";
import { runSummaryModels } from "./summary-models";
import type { LlmReview, LlmReviewInput, LlmVerdict } from "./auto-review";

/**
 * The L3 review session (AUTO-REVIEW-SPEC §12.4): a temporary session in the card's workspace that judges every LLM
 * rule at once, then is hard-deleted like the summarizer (AGENTS.md exception). Agent-facing English.
 */

export const reviewOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["rules"],
  properties: {
    rules: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "verdict", "detail"],
        properties: {
          id: { type: "string" },
          verdict: { type: "string", enum: ["pass", "fail", "na"] },
          detail: { type: "string" },
          file: { type: "string" },
          line: { type: "integer" },
        },
      },
    },
  },
} as const;

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

export function reviewPrompt(input: LlmReviewInput): string {
  const pad = input.workpad;
  const workpad = pad
    ? [
        "Acceptance criteria:",
        ...pad.acceptance.map((a) => `- [${a.done ? "x" : " "}] ${a.text}`),
        "Checks:",
        ...pad.validation.map((v) => `- ${v.state}: ${v.text}${v.command ? ` (${v.command})` : ""}${v.evidence ? ` — ${v.evidence}` : ""}`),
        ...(pad.confusions.length ? ["Confusions:", ...pad.confusions.map((c) => `- ${c.text}`)] : []),
      ].join("\n")
    : "(no workpad)";
  return [
    "You are Flowly's automatic reviewer for one delivered Kanban card. Judge each review rule below against this delivery.",
    "Read-only: do not edit, create or delete files and do not run commands that change anything. You may read files in the working directory to check details.",
    "Judge every rule on its own; one failing rule must not make others fail. Verdicts: pass (the rule is met), fail (it is not met; say exactly what is missing), na (the rule does not apply to this change, for example it is about UI text and the change has none).",
    "detail: one or two sentences a developer can act on. Add file and line when a specific place is at fault.",
    // §4.2: in a shared directory the diff can hold other cards' work.
    ...(input.shared && input.rules.some((r) => r.id === GOAL_ID)
      ? [
          'This workspace is shared with other cards (not a worktree): changes in the diff that have nothing to do with this card may belong to another card. Do not fail "goal" for them; fail it only when something the user asked for is missing or wrong.',
        ]
      : []),
    `Reply only with JSON: {"rules":[{"id","verdict","detail","file"?,"line"?}]}, one entry per rule id.`,
    "",
    `## Card\nTitle: ${input.task.title}\nType: ${input.task.type ?? "(none)"}\nDescription:\n${cut(input.task.description || "(none)", 4000)}`,
    // The built-in check's yardstick (§4.2): the user's own words, oldest first; a later one replaces an earlier one.
    ...(input.conversation !== undefined
      ? [
          `## What the user said in this card's sessions (oldest first)\n${
            input.conversation === null ? "(conversation unavailable)" : input.conversation.length ? input.conversation.map((m, i) => `[${i + 1}] ${m}`).join("\n\n") : "(no messages)"
          }`,
        ]
      : []),
    `## Workpad (the agent's own report, context only)\n${cut(workpad, 6000)}`,
    `## Delivery note (the agent's own report, context only)\n${cut(input.deliveryNote || "(none)", 3000)}`,
    `## Deliverables\n${input.outputs.length ? input.outputs.map((o) => `- ${o}`).join("\n") : "(none)"}`,
    `## Command rules\n${input.commands.length ? input.commands.map((c) => `- ${c}`).join("\n") : "(none)"}`,
    ...(input.guidance ? [`## Project guidance\n${input.guidance}`] : []),
    `## Review rules\n${input.rules.map((r) => `- id: ${r.id}\n  name: ${r.name}\n  rule: ${r.prompt}`).join("\n")}`,
    `## Diff\n${input.diff}`,
  ].join("\n\n");
}

/** Lenient: models sometimes wrap JSON in prose or a code fence. Unknown ids and bad entries are dropped. */
export function parseReviewOutput(text: string | null | undefined, ids: readonly string[]): LlmVerdict[] {
  if (!text) throw new Error("The review session returned nothing.");
  const start = text.indexOf("{"),
    end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("The review session's output is not JSON.");
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error("The review session's output is not valid JSON.");
  }
  const list = (raw as { rules?: unknown })?.rules;
  if (!Array.isArray(list)) throw new Error("The review session's output has no rules list.");
  const out: LlmVerdict[] = [];
  for (const item of list as Record<string, unknown>[]) {
    const id = typeof item?.id === "string" ? item.id : "";
    const verdict = item?.verdict;
    if (!ids.includes(id) || (verdict !== "pass" && verdict !== "fail" && verdict !== "na") || out.some((v) => v.id === id)) continue;
    out.push({
      id,
      verdict,
      detail: typeof item.detail === "string" ? item.detail.slice(0, autoReviewLimits.detail) : "",
      ...(typeof item.file === "string" && item.file ? { file: item.file } : {}),
      ...(typeof item.line === "number" && Number.isInteger(item.line) && item.line > 0 ? { line: item.line } : {}),
    });
  }
  return out;
}

/** The review runner: the Review model (Settings → Models), else the project's default model, else the summary models. */
export function llmReviewer(options: {
  reviewModel: () => Promise<string>;
  summaryModels: () => Promise<string[]>;
  remove?: RemoveAgent;
  timeoutMs?: number;
}): LlmReview {
  const remove = options.remove ?? daemonRemoveAgent();
  return async (input: LlmReviewInput, paseo: PaseoApi) => {
    const chosen = await options.reviewModel();
    const models = chosen ? [chosen] : input.projectModel ? [input.projectModel] : await options.summaryModels();
    const ids = input.rules.map((r) => r.id);
    const { model, output } = await runSummaryModels(paseo, models, {
      create: (model) =>
        paseo.workspaces.ref(input.task.workspaceId).agents.create({
          parent: input.parentAgentId,
          config: { provider: model },
          title: `Flowly review · ${input.task.title}`.slice(0, 120),
          labels: { ...SUMMARIZER_LABELS, "flowly-task": input.task.id, "flowly-review": "1" },
          prompt: reviewPrompt(input),
          outputSchema: reviewOutputSchema as unknown as Record<string, unknown>,
        }),
      parse: (text) => parseReviewOutput(text, ids),
      remove,
      timeoutMs: options.timeoutMs ?? 15 * 60 * 1000,
    });
    return { model, verdicts: output };
  };
}
