import { mkdir, readFile, writeFile, rename, copyFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { PaseoApi } from "@getpaseo/client";
import { backgroundWorkspaces, type BackgroundWorkspaces } from "./background-workspace";
import { daemonRemoveAgent, type RemoveAgent } from "./summarizer-remove";
import type { LocaleCode } from "../shared/i18n";
import type { BoardStore } from "./store";
import type { FlowLog } from "./flow-log";
import type { GitStats } from "./git-stats";
import type { SummaryStore } from "./summaries";
import { runSummaryModels } from "./summary-models";
import type { AgentLike, UsageService } from "./usage";
import { modelId } from "./agent-model";
import { laneName } from "../shared/lanes";
import { historyStatusLabel, type Board, type HistoryStatus, type Project } from "../shared/model";
import { SUMMARIZER_LABELS, isSummarizer, summaryModelsOf, type SummaryEntry, type SummarySettings } from "../shared/summary";
import {
  TREND_DAYS,
  addDays,
  analyze,
  dayKey,
  dayStart,
  isDay,
  tokenInsights,
  validZone,
  withoutRevertedResumes,
  type TokenInsights,
  type Commit,
  type FlowEntry,
  type ProjectInsights,
} from "../shared/insights";
import { habits, modellessAgents, withMoveDetails, type InsightsWithHabits } from "../shared/agent-habits";
import {
  DIGEST_DAYS,
  clipMaterial,
  digestJsonSchema,
  digestPrompt,
  digestStateSchema,
  emptyDigests,
  parseDigest,
  type DigestEntry,
  type DigestState,
  type DigestView,
} from "../shared/digest";

export const DIGEST_TIMEOUT_MS = 120_000;
type DayInput = { projectId: string; tz: string; day?: string };

/** `digests.json`: serialized writes, backup, atomic replacement; invalid data is preserved. */
export class DigestStore {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(readonly directory: string) {}
  get path() {
    return join(this.directory, "digests.json");
  }
  private async load(): Promise<DigestState> {
    try {
      return digestStateSchema.parse(JSON.parse(await readFile(this.path, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyDigests();
      throw new Error(`Digest data is invalid; preserved at ${this.path}. Restore a valid backup before continuing.`);
    }
  }
  async read() {
    await this.tail;
    return this.load();
  }
  update<T>(operation: (state: DigestState) => Promise<{ value: T; changed: boolean }> | { value: T; changed: boolean }): Promise<T> {
    const job = this.tail.then(async () => {
      const state = await this.load();
      const { value, changed } = await operation(state);
      if (!changed) return value;
      digestStateSchema.parse(state);
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const temporary = `${this.path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(state, null, 2), { mode: 0o600 });
        try {
          await copyFile(this.path, `${this.path}.bak`);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        await rename(temporary, this.path);
      } finally {
        await unlink(temporary).catch(() => undefined);
      }
      return value;
    });
    this.tail = job.then(
      () => undefined,
      () => undefined,
    );
    return job;
  }
  /** Replaces the project's digest for the day; keeps the newest DIGEST_DAYS days per project. */
  put(entry: DigestEntry) {
    return this.update((state) => {
      state.entries = state.entries.filter((e) => !(e.projectId === entry.projectId && e.day === entry.day));
      state.entries.push(entry);
      const mine = state.entries.filter((e) => e.projectId === entry.projectId).sort((a, b) => b.day.localeCompare(a.day));
      const drop = new Set(mine.slice(DIGEST_DAYS));
      state.entries = state.entries.filter((e) => !drop.has(e));
      state.errors = state.errors.filter((e) => !(e.projectId === entry.projectId && e.day === entry.day));
      return { value: entry, changed: true };
    });
  }
  setError(projectId: string, day: string, message: string, now = new Date()) {
    return this.update((state) => {
      state.errors = state.errors.filter((e) => !(e.projectId === projectId && e.day === day));
      state.errors.push({ projectId, day, at: now.toISOString(), message: message.slice(0, 500) });
      // Only the latest few errors per project matter.
      const mine = state.errors.filter((e) => e.projectId === projectId);
      if (mine.length > 10) state.errors = state.errors.filter((e) => e.projectId !== projectId || mine.slice(-10).includes(e));
      return { value: undefined, changed: true };
    });
  }
  /** Project Remove: back up then drop the project's digests. */
  removeProject(projectId: string, now = new Date()) {
    return this.update(async (state) => {
      const entries = state.entries.filter((e) => e.projectId === projectId);
      const errors = state.errors.filter((e) => e.projectId === projectId);
      if (!entries.length && !errors.length) return { value: null, changed: false };
      const folder = join(this.directory, "removed");
      await mkdir(folder, { recursive: true, mode: 0o700 });
      const backup = join(folder, `${projectId}-digests-${now.toISOString().replace(/[:.]/g, "-")}.json`);
      await writeFile(backup, JSON.stringify({ removedAt: now.toISOString(), entries, errors }, null, 2), { mode: 0o600, flag: "wx" });
      state.entries = state.entries.filter((e) => e.projectId !== projectId);
      state.errors = state.errors.filter((e) => e.projectId !== projectId);
      return { value: backup, changed: true };
    });
  }
}

/** Project Insights (PROJECT-INSIGHTS-SPEC): stats from the flow log, git and live sessions; the daily digest. */
export class InsightsService {
  private running = new Set<string>();
  /** Reads provider logs for tokens by day (§11). */
  usage: UsageService | null = null;
  private reconciled: Promise<unknown> | null = null;
  constructor(
    readonly board: BoardStore,
    readonly flow: FlowLog,
    readonly git: GitStats,
    readonly summaries: SummaryStore,
    readonly digests: DigestStore,
    readonly settings: () => Promise<SummarySettings>,
    readonly language: () => Promise<LocaleCode>,
    private timeoutMs = DIGEST_TIMEOUT_MS,
    private now = () => Date.now(),
    /** Where the digest runs: the project's background workspace, never a card's (§7). */
    private background: BackgroundWorkspaces = backgroundWorkspaces(board.directory),
    /** Hard-deletes the digest's session when done; archives it if that fails (AGENTS.md exception, §7). */
    private removeAgent: RemoveAgent = daemonRemoveAgent(),
  ) {}

  /** Appends board events the flow log lacks (startup backfill and missed appends). */
  async reconcile() {
    await this.flow.reconcile(await this.board.read());
  }

  private async context(projectId: string) {
    // One backfill at a time; later reads still reconcile, cheaply (ids are cached).
    await (this.reconciled ??= this.reconcile().finally(() => (this.reconciled = null)));
    const board = await this.board.read();
    const project = board.projects.find((p) => p.id === projectId);
    if (!project) throw new Error("Project not found.");
    const tasks = board.tasks.filter((t) => t.projectId === projectId);
    const entries = await this.flow.read(projectId);
    return { board, project, tasks, entries };
  }

  private async runningSessions(workspaces: ReadonlySet<string>, paseo: PaseoApi) {
    const agents = new Set<string>(),
      inWorkspaces = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await paseo.agents.list({ filter: { includeArchived: false }, page: { limit: 200, cursor } });
      for (const { agent } of page.entries)
        if (agent.workspaceId && workspaces.has(agent.workspaceId) && !agent.archivedAt && !isSummarizer(agent) && (agent.status === "running" || agent.status === "initializing")) {
          agents.add(agent.id);
          inWorkspaces.add(agent.workspaceId);
        }
      cursor = page.pageInfo.nextCursor ?? undefined;
    } while (cursor);
    return { agents, workspaces: inWorkspaces };
  }

  private async commits(project: Project, day: string, tz: string | undefined) {
    const since = dayStart(addDays(day, -(TREND_DAYS + 1)), tz);
    return this.git.commits(project.primaryPath, since, this.now());
  }

  /** Agent habits for the 7 days ending at `day` (WORKFLOW-INSIGHTS-SPEC §12); the agent list is read only for turns that carry no model. */
  private async habits(entries: readonly FlowEntry[], board: Board, tasks: readonly { workspaceId: string }[], day: string, tz: string | undefined, paseo: PaseoApi) {
    const full = withMoveDetails(entries, board.events);
    const wanted = modellessAgents(full, { day, tz });
    const models = new Map<string, string>();
    if (wanted.size) {
      const workspaces = new Set(tasks.map((t) => t.workspaceId));
      try {
        let cursor: string | undefined;
        do {
          const page = await paseo.agents.list({ filter: { includeArchived: true }, page: { limit: 200, cursor } });
          for (const { agent } of page.entries) {
            const model = wanted.has(agent.id) && agent.workspaceId && workspaces.has(agent.workspaceId) ? modelId(agent as Parameters<typeof modelId>[0]) : "";
            if (model) models.set(agent.id, model);
          }
          cursor = page.pageInfo.nextCursor ?? undefined;
        } while (cursor);
      } catch {
        // Turns without a model stay under "Unknown model".
      }
    }
    return habits(full, { day, tz, modelOf: (agentId) => models.get(agentId) });
  }

  async project(input: DayInput, paseo: PaseoApi): Promise<InsightsWithHabits> {
    const tz = validZone(input.tz);
    const now = this.now();
    const { board, project, tasks, entries } = await this.context(input.projectId);
    const day = input.day && isDay(input.day) ? input.day : dayKey(now, tz);
    const [running, git] = await Promise.all([
      this.runningSessions(new Set(tasks.map((t) => t.workspaceId)), paseo).catch(() => ({ agents: new Set<string>(), workspaces: new Set<string>() })),
      this.commits(project, day, tz),
    ]);
    const insights = analyze({
      tasks,
      entries,
      now,
      tz,
      day,
      runningAgents: running.agents,
      runningWorkspaces: running.workspaces,
      commits: git.commits,
      repos: git.repos,
      gitError: git.error,
    });
    return { ...insights, habits: await this.habits(entries, board, tasks, insights.day, tz, paseo) };
  }

  /**
   * Tokens by day for every session in the project's card workspaces (archived
   * and summarizer sessions included), read from local provider logs only.
   */
  async tokens(input: DayInput, paseo: PaseoApi): Promise<TokenInsights> {
    if (!this.usage) throw new Error("Token usage is not available.");
    const tz = validZone(input.tz);
    const { tasks } = await this.context(input.projectId);
    const owner = new Map(tasks.map((t) => [t.workspaceId, t.id]));
    const agents: (AgentLike & { taskId: string })[] = [];
    let cursor: string | undefined;
    do {
      const page = await paseo.agents.list({ filter: { includeArchived: true }, page: { limit: 200, cursor } });
      for (const { agent } of page.entries) {
        const taskId = agent.workspaceId ? owner.get(agent.workspaceId) : undefined;
        if (taskId) agents.push({ ...(agent as AgentLike), taskId });
      }
      cursor = page.pageInfo.nextCursor ?? undefined;
    } while (cursor);
    const usage = this.usage;
    const series = await Promise.all(
      agents.map(async (a) => ({ taskId: a.taskId, buckets: await usage.buckets(a).catch(() => null) })),
    );
    return tokenInsights({ series, now: this.now(), tz, day: input.day });
  }

  private key(input: DayInput) {
    return `${input.projectId}\n${input.day}`;
  }

  /** The day's digest; a past day without one is generated once when the setting is on. */
  async digest(input: DayInput & { day: string }, paseo: PaseoApi): Promise<DigestView> {
    const tz = validZone(input.tz);
    const today = dayKey(this.now(), tz);
    const [state, settings, material] = await Promise.all([this.digests.read(), this.settings(), this.material(input)]);
    const entry = state.entries.find((e) => e.projectId === input.projectId && e.day === input.day) || null;
    const error = state.errors.find((e) => e.projectId === input.projectId && e.day === input.day) || null;
    const empty = !material.text;
    if (!entry && !error && !empty && settings.digestEnabled && input.day < today && !this.running.has(this.key(input)))
      void this.start(input, paseo);
    return { entry, running: this.running.has(this.key(input)), error, enabled: settings.digestEnabled, empty };
  }

  refresh(input: DayInput & { day: string }, paseo: PaseoApi) {
    if (!this.running.has(this.key(input))) void this.start(input, paseo);
    return { queued: true as const };
  }

  private async start(input: DayInput & { day: string }, paseo: PaseoApi) {
    const key = this.key(input);
    this.running.add(key);
    try {
      await this.run(input, paseo);
    } catch (e) {
      await this.digests.setError(input.projectId, input.day, e instanceof Error ? e.message : String(e)).catch(() => undefined);
    } finally {
      this.running.delete(key);
    }
  }

  private async run(input: DayInput & { day: string }, paseo: PaseoApi) {
    const tz = validZone(input.tz);
    const { text, taskIds, project } = await this.material(input);
    if (!text) throw new Error("No activity on this day.");
    const settings = await this.settings();
    const prompt = digestPrompt({ project: project.title, day: input.day, today: input.day === dayKey(this.now(), tz), material: text, language: await this.language() });
    const { model, output } = await this.background.use(project, paseo, (workspaceId) => runSummaryModels(paseo, summaryModelsOf(settings), {
      create: (model) => paseo.workspaces.ref(workspaceId).agents.create({
        config: { provider: model },
        title: `Kanban digest · ${project.title} · ${input.day}`.slice(0, 120),
        labels: { ...SUMMARIZER_LABELS, "flowly-project": project.id },
        prompt,
        outputSchema: digestJsonSchema as unknown as Record<string, unknown>,
      }),
      parse: (text) => parseDigest(text, taskIds),
      remove: this.removeAgent,
      timeoutMs: this.timeoutMs,
    }));
    await this.digests.put({ ...output, projectId: project.id, day: input.day, tz: tz || "", at: new Date(this.now()).toISOString(), model });
  }

  /** The day's activity as plain text for the digest model; "" when nothing happened. */
  async material(input: DayInput & { day: string }) {
    const tz = validZone(input.tz);
    const { board, project, tasks, entries } = await this.context(input.projectId);
    const start = dayStart(input.day, tz),
      end = dayStart(addDays(input.day, 1), tz);
    const inDay = (iso: string) => {
      const t = Date.parse(iso);
      return t >= start && t < end;
    };
    const todays = withoutRevertedResumes(entries).filter((e) => inDay(e.at));
    const summaries = (await this.summaries.read()).entries;
    const git = await this.commits(project, input.day, tz).catch(() => ({ commits: [] as Commit[] }));
    const commits = git.commits.filter((c) => inDay(c.at));
    const time = (iso: string) => {
      const d = new Date(iso);
      return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
    };
    const active = tasks.filter((t) => inDay(t.createdAt) || todays.some((e) => e.taskId === t.id));
    const sections: string[] = [];
    for (const task of active) {
      const mine = todays.filter((e) => e.taskId === task.id);
      const lines = [`## Card ${task.id}: ${task.title}`, `Now in: ${laneName(project, task.status)}${task.archivedAt ? " (archived)" : ""} · priority ${task.priority}${task.type ? ` · ${task.type}` : ""}`];
      if (inDay(task.createdAt)) lines.push("Created this day.");
      for (const e of mine.filter((e) => e.action === "status_changed"))
        lines.push(`${time(e.at)} ${label(e.from)} → ${label(e.to)} (${e.rule ? "rule" : e.actor})`);
      const turns = mine.filter((e) => e.action === "agent.turn_ended");
      const failed = turns.filter((e) => e.outcome === "failed").length;
      if (turns.length) lines.push(`Agent turns: ${turns.length}${failed ? ` (${failed} failed)` : ""}`);
      const questions = mine.filter((e) => e.reportKind === "question").length,
        blockers = mine.filter((e) => e.reportKind === "blocker").length;
      if (questions || blockers) lines.push(`Agent questions: ${questions}, blockers: ${blockers}`);
      const versions = summaries.filter((s) => s.taskId === task.id);
      const last = lastIn(versions, (s) => inDay(s.at)),
        before = lastIn(versions, (s) => Date.parse(s.at) < start);
      if (before && last) lines.push(`State before: ${before.state}`);
      if (last) lines.push(`State at end of day: ${last.state}`, `Recap:\n${last.recap}`, `Next: ${last.next}`);
      sections.push(lines.join("\n"));
    }
    const material = [
      ...sections,
      commits.length ? `## Commits (${commits.length})\n` + commits.slice(0, 50).map((c) => `- ${c.subject}`).join("\n") : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    return { text: material ? clipMaterial(material) : "", taskIds: new Set(active.map((t) => t.id)), project, board };
  }
}

const label = (status: string | undefined) => (status ? historyStatusLabel(status as HistoryStatus) : "?");
function lastIn(list: readonly SummaryEntry[], test: (s: SummaryEntry) => boolean) {
  for (let i = list.length - 1; i >= 0; i--) if (test(list[i])) return list[i];
  return null;
}
