import { join } from "node:path";
import type { PaseoApi } from "@getpaseo/client";
import type { BoardStore } from "./store";
import type { FlowLog } from "./flow-log";
import type { BackgroundWorkspaces } from "./background-workspace";
import type { RemoveAgent } from "./summarizer-remove";
import { logFailure } from "./error-report";
import { commandsSection, readText } from "./workflow-insights";
import { detectProjectCommands } from "./review-detect";
import { SUMMARIZER_LABELS } from "../shared/summary";
import { autoReviewOf, joinCommand, nextDraftAt, reviewConfigHash, ruleFits } from "../shared/auto-review";
import {
  ANALYSIS_DAYS,
  ANALYSIS_MIN_DELIVERIES,
  analysisJsonSchema,
  analysisLimits,
  analysisMaterial,
  analysisPrompt,
  deliveryStats,
  parseAnalysis,
  reworkQuotes,
  validateAnalysis,
  windowFrom,
  type DeliveryStats,
} from "../shared/review-history";
import type { Project } from "../shared/model";

export type AnalysisStatus = { state: "idle" | "running" | "failed"; error?: string; startedAt?: string; eligible: boolean };

export type ReviewHistoryDeps = {
  /** The project's background workspace (BACKGROUND-WORKSPACE-SPEC); never a card's. */
  background: BackgroundWorkspaces;
  /** Hard-deletes the analysis session when done; archives it if that fails (AGENTS.md exception). */
  removeAgent: RemoveAgent;
  /** The model Insights runs with. */
  model: (paseo: PaseoApi) => Promise<string>;
  summaries: () => Promise<readonly { taskId: string; recap?: string; at: string }[]>;
  memory: () => Promise<{ clues: readonly { taskId: string; kind: string; text: string; at: string }[] }>;
  memoryOn: (project: Project) => boolean;
  now?: () => number;
  timeoutMs?: number;
};

/**
 * The auto review history analysis (AUTO-REVIEW-SPEC §6.2): the daemon counts deliveries and rework after delivery,
 * one temporary session in the project's background workspace groups the reasons and proposes checks, and the result
 * becomes the project's draft for the user's Apply. One run per project at a time; its state lives only in memory.
 */
export class ReviewHistory {
  private states = new Map<string, { state: "running" | "failed"; error?: string; startedAt: string }>();
  private readonly now: () => number;
  constructor(
    readonly store: BoardStore,
    readonly flow: FlowLog,
    readonly deps: ReviewHistoryDeps,
  ) {
    this.now = deps.now ?? (() => Date.now());
  }

  async stats(projectId: string, days: number): Promise<DeliveryStats> {
    const now = this.now();
    const entries = await this.flow.read(projectId).catch((e) => {
      logFailure("Flowly auto review could not read the flow log:", e);
      return [];
    });
    return deliveryStats(entries, windowFrom(now, days), now);
  }

  async status(projectId: string): Promise<AnalysisStatus> {
    const eligible = (await this.stats(projectId, ANALYSIS_DAYS)).deliveries >= ANALYSIS_MIN_DELIVERIES;
    const s = this.states.get(projectId);
    return s ? { state: s.state, ...(s.error ? { error: s.error } : {}), startedAt: s.startedAt, eligible } : { state: "idle", eligible };
  }

  /** Starts the analysis unless one runs or the project has too few deliveries; the model is never called then. */
  async analyze(projectId: string, paseo: PaseoApi): Promise<{ status: "started" | "running" | "insufficient" }> {
    if (this.states.get(projectId)?.state === "running") return { status: "running" };
    const project = (await this.store.read()).projects.find((p) => p.id === projectId && !p.archivedAt);
    if (!project) throw new Error("Project not found.");
    const stats = await this.stats(projectId, ANALYSIS_DAYS);
    if (stats.deliveries < ANALYSIS_MIN_DELIVERIES) return { status: "insufficient" };
    const startedAt = new Date(this.now()).toISOString();
    this.states.set(projectId, { state: "running", startedAt });
    void this.run(project, stats, paseo).then(
      () => this.states.delete(projectId),
      (e) => {
        const error = (e instanceof Error ? e.message : String(e)).slice(0, 300);
        logFailure("Flowly auto review history analysis failed:", e, projectId);
        this.states.set(projectId, { state: "failed", error, startedAt });
      },
    );
    return { status: "started" };
  }

  private async run(project: Project, stats: DeliveryStats, paseo: PaseoApi) {
    const board = await this.store.read();
    const config = autoReviewOf(project);
    const [summaries, memory, detected, agentsMd, claudeMd] = await Promise.all([
      this.deps.summaries().catch(() => []),
      this.deps.memory().catch(() => ({ clues: [] })),
      detectProjectCommands(project.primaryPath).catch(() => []),
      readText(join(project.primaryPath, "AGENTS.md")),
      readText(join(project.primaryPath, "CLAUDE.md")),
    ]);
    const memoryOn = this.deps.memoryOn(project);
    const recap = new Map<string, string>();
    for (const s of summaries) if (s.recap) recap.set(s.taskId, s.recap);
    const cards = stats.delivered
      .map((id) => board.tasks.find((t) => t.id === id))
      .filter((t): t is NonNullable<typeof t> => !!t)
      .map((t) => {
        const turns = stats.reworked.get(t.id) || [];
        const quotes = memoryOn
          ? reworkQuotes(memory.clues, t.id, turns)
              .slice(0, analysisLimits.quotesPerCard)
              .map((text) => text.slice(0, analysisLimits.quote))
          : [];
        return { id: t.id, title: t.title, type: t.type, tags: (t.tags || []).map((x) => x.tag), recap: recap.get(t.id) || "", reworked: turns.length > 0, quotes };
      });
    const counts = new Map<string, Set<string>>();
    for (const w of board.workpads)
      if (stats.delivered.includes(w.taskId))
        for (const v of w.validation)
          if (v.command) {
            const set = counts.get(v.command) || new Set<string>();
            set.add(w.taskId);
            counts.set(v.command, set);
          }
    const material = analysisMaterial({
      cards,
      memoryOn,
      workpadCommands: [...counts].map(([command, set]) => ({ command, cards: set.size })).sort((a, b) => b.cards - a.cards).slice(0, 40),
      detected: detected.map((d) => joinCommand(d.argv)),
      agentsCommands: commandsSection(agentsMd || "") || commandsSection(claudeMd || ""),
      rules: config.rules,
    });
    const model = await this.deps.model(paseo);
    const reply = await this.deps.background.use(project, paseo, async (workspaceId) => {
      const agent = await paseo.workspaces.ref(workspaceId).agents.create({
        config: { provider: model },
        title: `Flowly auto review analysis · ${project.title}`.slice(0, 120),
        labels: { ...SUMMARIZER_LABELS, "flowly-project": project.id, "flowly-review-history": "1" },
        prompt: analysisPrompt(material),
        outputSchema: analysisJsonSchema as unknown as Record<string, unknown>,
      });
      try {
        const result = await agent.waitForFinish(this.deps.timeoutMs ?? 15 * 60_000);
        if (result.status !== "idle")
          throw new Error(result.status === "timeout" ? "The analysis timed out." : result.status === "permission" ? "The analysis asked for a permission." : result.error || "The analysis failed.");
        return result.lastMessage;
      } finally {
        await this.deps.removeAgent(agent);
      }
    });
    const parsed = parseAnalysis(reply);
    if (!parsed) throw new Error("The analysis returned no JSON.");
    const reworkedIds = new Set(stats.reworked.keys());
    const valid = validateAnalysis(parsed, { cards: cards.map((c) => c.id), reworked: reworkedIds, existing: config.rules });
    await this.writeDraft(project.id, {
      delivered: stats.delivered.length,
      reworked: [...reworkedIds].filter((id) => stats.delivered.includes(id)).length,
      ...valid,
    });
  }

  /** The analysis's result as the project's draft (§6.4): current rules plus the new checks, numbers from the daemon. */
  private writeDraft(projectId: string, result: { delivered: number; reworked: number } & ReturnType<typeof validateAnalysis>) {
    return this.store.transaction((b) => {
      const p = b.projects.find((x) => x.id === projectId);
      if (!p || p.archivedAt) return { value: null, changed: false };
      const current = autoReviewOf(p);
      // Suggestions that do not fit the 10-per-kind limit are left out and counted, never failing the analysis (§6.2).
      const rules = [...current.rules];
      const kept: typeof result.checks = [];
      for (const c of result.checks)
        if (ruleFits(rules, c.rule.kind)) {
          rules.push(c.rule);
          kept.push(c);
        }
      const dropped = result.checks.length - kept.length;
      p.reviewDraft = {
        rules,
        note: kept.length ? "" : "No new checks from past cards.",
        by: { analysis: true },
        added: kept.map((c) => ({ id: c.rule.id, cards: c.cards, why: c.why })),
        summary: { delivered: result.delivered, reworked: result.reworked, reasons: result.reasons, ...(dropped ? { dropped } : {}) },
        at: nextDraftAt(p.reviewDraft, this.now()),
        baseRevision: p.revision,
        baseHash: reviewConfigHash(current),
      };
      return { value: null, changed: true };
    });
  }
}
