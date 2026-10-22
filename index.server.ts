import type { PluginServerContext } from "@getpaseo/plugin/server";
import type { PaseoApi } from "@getpaseo/client";
import { BoardStore, columnOrder } from "./server/store";
import { BoardService, dataDirectory, migrateLegacyPluginData } from "./server/service";
import { NativeDirectoryPicker, detectNativePicker, listDirectories } from "./server/directories";
import * as rpc from "./shared/rpc";
import { performanceLogOn, performanceSettings, boardViewSettings, ideasSettings, languageSettings, languageSettingsValues, aiLanguageSettings, aiLanguageSettingsValues, deviceLanguageSettings, deviceLanguageValue, modelSettings, onboardingSettings, ideasSettingsValues, statusSettings, statusSettingsValues, wrapupSettings, wrapupSettingsValues, nativeSessionSettings, nativeSessionSettingsValues } from "./shared/settings";
import { ToolServer } from "./server/tool-server";
import { SessionReadStore, SessionReadService, daemonNativeAttention } from "./server/session-reads";
import { WrapupService } from "./server/wrapup";
import { WorkspaceRestoreService } from "./server/workspace-restore";
import { SessionImageService } from "./server/session-images";
import { SessionTailService } from "./server/session-tail";
import { ArchivedSessionsService } from "./server/archived-sessions";
import { ifChanged } from "./server/etag";
import { BoardDeltas } from "./server/board-delta";
import { perfLine } from "./shared/perf";
import { catalogs } from "./shared/i18n-all";
import { deviceLocale, type LocaleCode } from "./shared/i18n";
import { resolveAiLanguage } from "./shared/ai-language";
import { ComposerService, ComposerStore } from "./server/composer";
import { adoptIdea } from "./server/ideas";
import { createLink, deleteLink } from "./server/links";
import { ArtifactService } from "./server/artifacts";
import { WorkpadService } from "./server/workpad";
import { ConnectorService, migrateTicketDirectory, refKey } from "./server/connectors/service";
import { projectRepos } from "./server/connectors/repos";
import { join } from "node:path";
import { SessionSettingsService } from "./server/session-settings";
import { applyTurnEnded, applyTurnStarted, recordLifecycle } from "./server/progress-rules";
import { NextMoveRows } from "./server/next-move-rows";
import { SessionInsightService, SessionInsightStore } from "./server/session-insights";
import { SummaryService, SummaryStore } from "./server/summaries";
import { UsageService } from "./server/usage";
import { summarySettings, summarySettingsValues } from "./shared/summary";
import { FlowLog } from "./server/flow-log";
import { ProjectFolders, snapshotPath } from "./server/project-folder";
import { GitStats } from "./server/git-stats";
import { DigestStore, InsightsService } from "./server/insights";
import { CommandLog } from "./server/command-log";
import { WorkflowInsightsService, WorkflowStore } from "./server/workflow-insights";
import { workflowInsightsSettings, workflowSettingsValues } from "./shared/workflow-insights";
import { sessionModel } from "./server/agent-model";
import { turnPick, userTexts } from "./shared/agent-habits";

export default function contribute(server: PluginServerContext) {
  server.registerSettings(boardViewSettings);
  const languagePrefs = server.registerSettings(languageSettings);
  const aiLanguagePrefs = server.registerSettings(aiLanguageSettings);
  const devicePrefs = server.registerSettings(deviceLanguageSettings);
  server.registerSettings(modelSettings);
  server.registerSettings(onboardingSettings);
  const summaryPrefs = server.registerSettings(summarySettings);
  const wrapupPrefs = server.registerSettings(wrapupSettings);
  const statusPrefs = server.registerSettings(statusSettings);
  const ideasPrefs = server.registerSettings(ideasSettings);
  const nativePrefs = server.registerSettings(nativeSessionSettings);
  const workflowPrefs = server.registerSettings(workflowInsightsSettings);
  const perfPrefs = server.registerSettings(performanceSettings);
  // The global switch for rules A1/A1r; unreadable settings keep the default (on).
  const autoStatusOn = async () => {
    const state = await statusPrefs.read().catch(() => null);
    return statusSettingsValues(state?.status === "ready" ? state.values : {}).autoStatus;
  };
  if (!process.env.FLOWLY_DATA_DIR && !process.env.ULTRA_KANBAN_DATA_DIR) migrateLegacyPluginData();
  const store = new BoardStore(dataDirectory());
  // The Next moves card in Paseo's own timeline (NATIVE-SESSION-SPEC §6.1).
  const nextRows = new NextMoveRows(store);
  // The language of everything AI writes (AI-LANGUAGE-SPEC §3); unreadable settings fall back along the chain.
  const aiLanguage = async () => {
    const [ai, interfaceLanguage, device] = await Promise.all([aiLanguagePrefs.read().catch(() => null), languagePrefs.read().catch(() => null), devicePrefs.read().catch(() => null)]);
    return resolveAiLanguage({
      ai: aiLanguageSettingsValues(ai?.status === "ready" ? ai.values : {}).aiLanguage,
      interface: languageSettingsValues(interfaceLanguage?.status === "ready" ? interfaceLanguage.values : {}).language,
      reported: deviceLanguageValue(device?.status === "ready" ? device.values : {}),
      host: deviceLocale(),
    });
  };
  const summaries = new SummaryService(
    store,
    new SummaryStore(store.directory),
    async () => {
      const state = await summaryPrefs.read().catch(() => null);
      return summarySettingsValues(state?.status === "ready" ? state.values : {});
    },
    aiLanguage,
  );
  // Progress, next steps and ideas for sessions Flowly does not manage (NATIVE-SESSION-SPEC §12); off by default.
  const nativeValues = async () => {
    const state = await nativePrefs.read().catch(() => null);
    return nativeSessionSettingsValues(state?.status === "ready" ? state.values : {});
  };
  const sessionInsights = new SessionInsightService(new SessionInsightStore(store.directory), nextRows, async () => {
    const [native, summary] = await Promise.all([nativeValues(), summaries.settings()]);
    return {
      enabled: native.outside,
      parts: { progress: native.outsideProgress, nextMoves: native.outsideNextMoves, ideas: native.outsideIdeas },
      model: summary.summaryModel,
    };
  }, aiLanguage);
  // Untrimmed event log + project insights (PROJECT-INSIGHTS-SPEC).
  const flow = new FlowLog(store.directory);
  store.flow = flow;
  const insights = new InsightsService(store, flow, new GitStats(), summaries.store, new DigestStore(store.directory), summaries.settings, aiLanguage);
  void insights.reconcile().catch((e) => console.error("Kanban flow log backfill failed:", e instanceof Error ? e.message : String(e)));
  server.handle(rpc.projectInsights, async ({ etag, ...input }, { paseo }) => ifChanged(await insights.project(input, paseo), etag));
  server.handle(rpc.projectDigest, (input, { paseo }) => insights.digest(input, paseo));
  server.handle(rpc.projectTokens, async ({ etag, ...input }, { paseo }) => ifChanged(await insights.tokens(input, paseo), etag));
  server.handle(rpc.refreshDigest, (input, { paseo }) => insights.refresh(input, paseo));
  server.handle(rpc.readSummaries, () => summaries.overview());
  server.handle(rpc.readSummariesChanged, async (input) => ifChanged(await summaries.overview(), input.etag));
  const usage = new UsageService(store);
  insights.usage = usage;
  server.handle(rpc.taskUsage, (input, { paseo }) => usage.task(input.taskId, paseo));
  server.handle(rpc.summaryHistory, (input) => summaries.store.history(input.taskId));
  // Workflow insights (WORKFLOW-INSIGHTS-SPEC): command log, scheduled analysis, suggestions.
  const workflowValues = async () => {
    const state = await workflowPrefs.read().catch(() => null);
    return workflowSettingsValues(state?.status === "ready" ? state.values : {});
  };
  const commands = new CommandLog(store.directory);
  const workflow = new WorkflowInsightsService(store, commands, new WorkflowStore(store.directory), flow, workflowValues, summaries.settings, aiLanguage);
  workflow.start();
  // Turning the switch on reads the last week of sessions once (§3.3).
  let workflowWasOn: boolean | null = null;
  const stopWorkflowPrefs = workflowPrefs.subscribe((state) => {
    const on = workflowSettingsValues(state.status === "ready" ? state.values : {}).enabled;
    if (workflowWasOn === false && on) workflow.requestBackfillAll();
    workflowWasOn = on;
  });
  void workflowValues().then((v) => {
    if (workflowWasOn === null) workflowWasOn = v.enabled;
  });
  server.handle(rpc.workflowInsights, async ({ projectId, etag }, { paseo }) => {
    workflow.attach(paseo);
    return ifChanged(await workflow.view(projectId), etag);
  });
  server.handle(rpc.runWorkflowInsights, (input, { paseo }) => workflow.run(input.projectId, paseo, true));
  server.handle(rpc.setWorkflowFinding, (input) => workflow.setStatus(input));
  server.handle(rpc.workflowInsightsOverview, () => workflow.overview());
  server.handle(rpc.purgeWorkflowCommands, async () => ({ deletedProjects: await workflow.purge() }));
  const service = new BoardService(store);
  service.insightFindings = { check: (p, id) => workflow.check(p, id), accept: (p, id, taskId) => workflow.accept(p, id, taskId) };
  // Read-only external inputs (CONNECTORS-SPEC): credentials and requests stay in the daemon.
  try {
    migrateTicketDirectory(store.directory);
  } catch (e) {
    console.error("Flowly connector data not moved:", e instanceof Error ? e.message : String(e));
  }
  const connectors = new ConnectorService(join(store.directory, "connectors"));
  connectors.projectRepos = async (projectId, connection) => {
    const project = (await store.read()).projects.find((p) => p.id === projectId);
    return project ? projectRepos(project.primaryPath, connection.baseUrl) : [];
  };
  service.connectors = connectors;
  // Each project's board copy in `<root>/.flowly/` (PROJECT-FOLDER-SPEC).
  const folders = new ProjectFolders(() => store.read(), async () => (await summaries.store.read()).entries);
  store.onCommit = () => folders.schedule();
  // Existing projects get their folder copy on the first start after the upgrade (and failed ones on every start).
  void folders.migrate(store.directory).catch((e) =>
    console.error("Flowly project folder migration failed:", e instanceof Error ? e.message : String(e)),
  );
  server.handle(rpc.restoreProjectCheck, (input) => service.restoreCheck(input.path));
  server.handle(rpc.restoreProject, async (input, { paseo }) => {
    const { snapshot, ...restored } = await service.restoreProject(input, paseo);
    flow.remember(restored.project.id, snapshot.tasks.map((t) => t.id));
    commands.remember(restored.project.id, snapshot.tasks.map((t) => t.id));
    await summaries.store.restoreEntries(snapshot.summaries).catch((e) =>
      console.error("Kanban summaries not restored:", e instanceof Error ? e.message : String(e)),
    );
    void insights.reconcile().catch(() => undefined);
    folders.forget(restored.project.id);
    folders.schedule();
    return restored;
  });
  server.handle(rpc.projectFolderState, async (input) => {
    const project = (await store.read()).projects.find((p) => p.id === input.id);
    if (!project) throw new Error("Project not found.");
    const state = folders.state(project.id);
    return { path: snapshotPath(project.primaryPath), savedAt: state?.savedAt ?? "", error: state?.error ?? "" };
  });
  const sessionReads = new SessionReadStore(store.directory);
  const readService = new SessionReadService(store, sessionReads, daemonNativeAttention());
  // Sessions read in Flowly before read state synced (or whose sync failed) are
  // cleared in Paseo too; retried once if the daemon is not reachable yet.
  const syncReads = (retry: boolean) =>
    readService.syncNative().catch((e) => {
      console.error("Flowly read-state sync failed:", e instanceof Error ? e.message : String(e));
      if (retry) setTimeout(() => void syncReads(false), 30_000).unref?.();
    });
  void syncReads(true);
  server.handle(rpc.readSessionReceipts, () => sessionReads.read());
  server.handle(rpc.markSessionRead, (input, { paseo }) =>
    readService.mark(input, paseo),
  );
  server.handle(rpc.markSessionUnread, (input, { paseo }) => readService.markUnread(input, paseo));
  const composer = new ComposerService(new ComposerStore(store.directory), store);
  server.handle(rpc.readComposer, (_, { paseo }) => {
    void composer.drainAll(paseo).catch(() => undefined);
    return composer.read();
  });
  server.handle(rpc.saveDraft, (input) => composer.saveDraft(input));
  server.handle(rpc.queueMessage, (input, { paseo }) => composer.push(input, paseo));
  server.handle(rpc.unqueueMessage, (input) => composer.remove(input));
  server.handle(rpc.sendQueuedNow, (input, { paseo }) => composer.sendNow(input, paseo));
  const images = new SessionImageService(store);
  server.handle(rpc.sessionImage, (input, { paseo }) => images.read(input, paseo));
  const tails = new SessionTailService(store);
  const archived = new ArchivedSessionsService(store);
  server.handle(rpc.archivedSessions, (input, { paseo }) => archived.list(input.taskId, paseo));
  server.handle(rpc.archivedSessionRefs, (_, { paseo }) => archived.refs(paseo));
  server.handle(rpc.sessionTail, (input, { paseo }) => tails.tail(input, paseo));
  const wrapups = new WrapupService(store, undefined, (taskId) => summaries.settled(taskId));
  const restores = new WorkspaceRestoreService(store);
  const sessionSettings = new SessionSettingsService(store);
  server.handle(rpc.configureSession, (input, { paseo }) => sessionSettings.apply(input, paseo));
  server.handle(rpc.wrapupCheck, (input, { paseo }) =>
    wrapups.check(input.id, paseo),
  );
  server.handle(rpc.wrapup, (input, { paseo }) => wrapups.run(input, paseo));
  const tools = new ToolServer(store);
  tools.agents.connectors = connectors;
  // Unreadable settings keep the default (on).
  tools.agents.ideasOn = async () => {
    const state = await ideasPrefs.read().catch(() => null);
    return ideasSettingsValues(state?.status === "ready" ? state.values : {}).ideas;
  };
  tools.agents.aiLanguage = aiLanguage;
  tools.agents.artifactsOn = async () => {
    const state = await ideasPrefs.read().catch(() => null);
    return ideasSettingsValues(state?.status === "ready" ? state.values : {}).artifacts;
  };
  void tools
    .start()
    .catch((e) =>
      console.error(
        "Kanban tools unavailable:",
        e instanceof Error ? e.message : String(e),
      ),
    );
  server.handle(rpc.readBoard, (_, { paseo }) => {
    tools.attach(paseo);
    return store.view();
  });
  const boardDeltas = new BoardDeltas(32, (reason, info) => {
    // Developer timing log (PERFORMANCE-SPEC): say why a read sent the whole board.
    void perfPrefs.read().then((state) => {
      if (state?.status === "ready" && performanceLogOn(state.values)) console.log(`[perf] board.read.full reason=${reason} events=${info.events} remembered=${info.remembered}${info.heldEvents === undefined ? "" : ` held=${info.heldEvents} heldLastAt=${info.heldLastAt}`}`);
    }).catch(() => undefined);
  });
  server.handle(rpc.i18nCatalog, ({ locale }) => (catalogs[locale as LocaleCode] ?? {}) as Record<string, string | Record<string, string>>);
  server.handle(rpc.perfReport, async (input) => {
    const state = await perfPrefs.read().catch(() => null);
    if (state?.status !== "ready" || !performanceLogOn(state.values)) return { logged: false };
    console.log(perfLine(input));
    return { logged: true };
  });
  server.handle(rpc.readBoardChanged, async (input, { paseo }) => {
    tools.attach(paseo);
    return boardDeltas.read(await store.view(), input);
  });
  server.handle(rpc.managedSessions, () => tools.managedSessions());
  server.handle(rpc.nativeChips, async () => {
    const [wrap, native] = await Promise.all([wrapupPrefs.read().catch(() => null), nativePrefs.read().catch(() => null)]);
    const values = nativeSessionSettingsValues(native?.status === "ready" ? native.values : {});
    return {
      managed: await tools.managedSessions(),
      ideas: await tools.agents.ideasOn(),
      autoWrapup: wrapupSettingsValues(wrap?.status === "ready" ? wrap.values : {}).autoWrapup,
      nextMoveTap: values.nextMoveTap,
      outside: { enabled: values.outside, progress: values.outsideProgress, nextMoves: values.outsideNextMoves, ideas: values.outsideIdeas },
    };
  });
  server.handle(rpc.sessionInsights, async (input) => ifChanged(await sessionInsights.view(), input.etag));
  server.handle(rpc.runSessionIdea, (input, { paseo }) => sessionInsights.runIdea(input, paseo));
  server.handle(rpc.dismissSessionIdea, async (input) => {
    await sessionInsights.dismissIdea(input);
    return { ok: true as const };
  });
  server.handle(rpc.refreshSummary, async (input, { paseo }) => {
    const managed = (await tools.managedSessions()).filter((s) => s.taskId === input.taskId);
    return summaries.refresh(input.taskId, managed.map((s) => s.agentId), paseo);
  });
  server.handle(rpc.toolsHealth, async (_, { paseo }) => {
    tools.attach(paseo);
    await tools.start().catch(() => undefined);
    return tools.health();
  });
  server.handle(rpc.prepareSession, (input, { paseo }) =>
    tools.prepareSession(input.id, input.operationId, paseo),
  );
  server.handle(rpc.prepareExisting, (input, { paseo }) =>
    tools.prepareExisting(input.id, input.agentId, paseo),
  );
  server.handle(rpc.accessState, (input, { paseo }) =>
    tools.accessState(input.id, input.agentId, paseo),
  );
  server.handle(rpc.listResources, (_, { paseo }) => service.resources(paseo));
  server.handle(rpc.readResourcesChanged, async (input, { paseo }) => ifChanged(await service.resources(paseo), input.etag));
  server.handle(rpc.createProject, (input, { paseo }) =>
    service.createProject(input, paseo),
  );
  server.handle(rpc.createTask, (input, { paseo }) =>
    service.createTask(input, paseo),
  );
  server.handle(rpc.taskContext, (input, { paseo }) =>
    service.context(input.id, paseo),
  );
  // With auto wrap-up on, moving a card into Done/Cancelled archives its own
  // workspace in the background when the preflight is clean; the status write
  // never waits for it. With it off, the client asks instead.
  const finished = (status: string | undefined) => status === "done" || status === "cancelled";
  // Moving a card back out of Done/Cancelled restores the workspace its
  // wrap-up archived (WORKSPACE-RESTORE-SPEC), also in the background.
  const afterStatus = (previous: string | undefined, task: { id: string; status: string }, paseo: PaseoApi) => {
    if (finished(previous) && !finished(task.status)) {
      void restores.restoreAfterReopen(task.id).catch((e) =>
        console.error("Kanban workspace restore failed:", e instanceof Error ? e.message : String(e)),
      );
      return;
    }
    if (!finished(task.status) || finished(previous)) return;
    void (async () => {
      const prefs = await wrapupPrefs.read().catch(() => null);
      if (!wrapupSettingsValues(prefs?.status === "ready" ? prefs.values : {}).autoWrapup) return;
      await wrapups.autoArchive(task.id, paseo);
    })().catch((e) =>
      console.error("Kanban auto wrap-up failed:", e instanceof Error ? e.message : String(e)),
    );
  };
  const statusOf = async (id: string) => (await store.read()).tasks.find((t) => t.id === id)?.status;
  server.handle(rpc.updateTask, async (input, { paseo }) => {
    const previous = input.status ? await statusOf(input.id) : undefined;
    const task = await store.editTask(input);
    if (input.status) afterStatus(previous, task, paseo);
    return task;
  });
  server.handle(rpc.updateTaskTags, (input) => store.editTags(input));
  server.handle(rpc.placeTask, async (input, { paseo }) => {
    const previous = await statusOf(input.id);
    const task = await store.placeTask(input);
    afterStatus(previous, task, paseo);
    return task;
  });
  server.handle(rpc.moveProject, (input) => store.moveProject(input));
  server.handle(rpc.updateProject, async (input, { paseo }) => {
    const before = (await store.read()).projects.find((p) => p.id === input.id);
    const project = await store.updateProject(input);
    // Included again: read its last week once, like turning the switch on (§3.3).
    if (before?.workflowInsights === false && project.workflowInsights !== false && (await workflowValues()).enabled)
      void workflow.backfill(project.id, paseo).catch(() => undefined);
    return project;
  });
  server.handle(rpc.removeProject, async (input, { paseo }) => {
    const taskIds = new Set((await store.read()).tasks.filter((t) => t.projectId === input.id).map((t) => t.id));
    const removed = await service.removeProject(input, paseo);
    await summaries.store.removeTasks(input.id, taskIds).catch((e) =>
      console.error("Kanban summaries not removed:", e instanceof Error ? e.message : String(e)),
    );
    await tools.pruneContexts().catch((e) =>
      console.error("Kanban session bindings not cleaned:", e instanceof Error ? e.message : String(e)),
    );
    await Promise.all([flow.removeProject(input.id), insights.digests.removeProject(input.id), workflow.removeProject(input.id)]).catch((e) =>
      console.error("Kanban insights data not removed:", e instanceof Error ? e.message : String(e)),
    );
    return removed;
  });
  server.handle(rpc.deleteCheck, (input, { paseo }) => wrapups.check(input.id, paseo, "delete"));
  // Archiving comes first: a failed or refused archive leaves the card in place.
  server.handle(rpc.updateIdea, (input) => store.updateIdea(input));
  server.handle(rpc.dismissAttention, (input) => store.dismissAttention(input));
  server.handle(rpc.restoreAttention, (input) => store.restoreAttention(input));
  server.handle(rpc.adoptIdea, (input, { paseo }) => adoptIdea(store, (message, api) => composer.push(message, api), input, paseo));
  server.handle(rpc.createLink, (input) => createLink(store, input));
  server.handle(rpc.deleteLink, (input) => deleteLink(store, input));
  const artifacts = new ArtifactService(store, connectors);
  const workpads = new WorkpadService(store);
  server.handle(rpc.listConnections, async () => ({ connections: await connectors.list() }));
  server.handle(rpc.saveConnection, (input) => connectors.save(input));
  server.handle(rpc.testConnection, (input) => connectors.test(input));
  server.handle(rpc.deleteConnection, (input) => connectors.remove(input.id));
  server.handle(rpc.searchExternal, (input) => connectors.search(input));
  server.handle(rpc.cardExternals, async (input) => {
    const list = (await store.read()).artifacts.filter((a) => a.taskId === input.taskId && a.external);
    const located = await connectors.locate(list);
    const refs = [...located.values()].filter((r): r is NonNullable<typeof r> => !!r);
    const found = refs.length ? await connectors.badges(refs, input.refresh) : new Map();
    return {
      items: list.flatMap((a) => {
        const ref = located.get(a.id);
        const hit = ref && found.get(refKey(ref));
        return hit ? [{ artifactId: a.id, summary: hit.summary, stale: hit.stale }] : [];
      }),
      removed: list.filter((a) => !located.get(a.id)).map((a) => a.id),
    };
  });
  server.handle(rpc.readExternal, async (input) => {
    const artifact = (await store.read()).artifacts.find((a) => a.id === input.artifactId);
    if (!artifact?.external) throw new Error("This external input no longer exists.");
    const ref = (await connectors.locate([artifact])).get(artifact.id);
    if (!ref) throw new Error("This connection was removed. Add it again in Settings → Connections to read the item here; Open in the browser still works.");
    const { summary, markdown, truncated, stale, fetchedAt } = await connectors.detail(ref, input.refresh);
    return { summary, markdown, truncated, stale, fetchedAt };
  });
  server.handle(rpc.createArtifact, (input, { paseo }) => artifacts.create(input, paseo));
  server.handle(rpc.updateArtifact, (input) => artifacts.update(input));
  server.handle(rpc.deleteArtifact, (input) => artifacts.delete(input));
  server.handle(rpc.artifactStatus, (input, { paseo }) => artifacts.status(input, paseo));
  server.handle(rpc.previewArtifact, (input, { paseo }) => artifacts.preview(input, paseo));
  server.handle(rpc.checkWorkpad, (input, { paseo }) => workpads.check(input, paseo));
  server.handle(rpc.resolveConfusion, (input) => workpads.resolveConfusion(input));
  server.handle(rpc.refreshWorkpad, (input, { paseo }) => workpads.refresh(input, paseo));
  server.handle(rpc.deleteTask, async (input, { paseo }) => {
    const archived = input.archive
      ? await wrapups.run({ ...input, keepCard: true, purpose: "delete" }, paseo)
      : null;
    const projectId = (await store.read()).tasks.find((t) => t.id === input.id)?.projectId;
    const deleted = await store.deleteTask(input);
    if (projectId)
      await flow.removeTask(projectId, deleted.id).catch((e) =>
        console.error("Kanban flow log not cleaned:", e instanceof Error ? e.message : String(e)),
      );
    if (projectId)
      await workflow.removeTask(projectId, deleted.id).catch((e) =>
        console.error("Workflow insights data not cleaned:", e instanceof Error ? e.message : String(e)),
      );
    await summaries.store.removeTasks(`task-${deleted.id}`, new Set([deleted.id])).catch((e) =>
      console.error("Kanban summaries not removed:", e instanceof Error ? e.message : String(e)),
    );
    await tools.pruneContexts().catch((e) =>
      console.error("Kanban session bindings not cleaned:", e instanceof Error ? e.message : String(e)),
    );
    return archived ? { ...deleted, archived: { sessions: archived.archivedSessions, workspace: archived.archivedWorkspace } } : deleted;
  });
  server.handle(rpc.removeProjectCheck, (input, { paseo }) => service.removeCheck(input.id, paseo));
  server.handle(rpc.createLinkedProject, (input, { paseo }) => service.createLinked(input, paseo));
  server.handle(rpc.setProjectLinks, (input) => service.setLinks(input));
  const picker = new NativeDirectoryPicker(detectNativePicker());
  server.handle(rpc.listDirectories, async (input) => listDirectories(input.path, await picker.available()));
  server.handle(rpc.pickNativeDirectory, (input) => picker.pick(input.multiple));
  // Menu up/down shares the drag placement path: one ordering rule, and only
  // the moved card's revision changes.
  server.handle(rpc.moveTask, async (input) => {
    const board = await store.read();
    const task = board.tasks.find((t) => t.id === input.id);
    if (!task) throw new Error("Task not found.");
    const visible = board.tasks
      .filter(
        (t) =>
          t.projectId === task.projectId &&
          t.status === task.status &&
          !t.archivedAt,
      )
      .sort(columnOrder);
    const index = visible.findIndex((t) => t.id === task.id);
    const other = visible[index + (input.direction === "up" ? -1 : 1)];
    if (!other) {
      if (task.revision !== input.revision)
        throw new Error("Revision conflict: reload before moving.");
      return task;
    }
    return store.placeTask({
      id: task.id,
      revision: input.revision,
      status: task.status,
      beforeId: input.direction === "up" ? other.id : null,
      afterId: input.direction === "up" ? null : other.id,
    });
  });
  // Lifecycle facts are recorded, and status rules run, only for
  // Kanban-managed sessions (AUTO-STATUS-SPEC).
  const managedTask = async (agent: { id: string; workspaceId: string | null }) => {
    const identity = await tools.secrets.managedIdentity(agent.id);
    if (!identity || identity.workspaceId !== agent.workspaceId) return null;
    return identity;
  };
  server.on("agent.turn_started", async (event, { paseo }) => {
    tools.attach(paseo);
    const identity = await managedTask(event.agent);
    if (!identity) {
      // A session Flowly does not manage: its Next moves card goes and its suggestion ends (NATIVE-SESSION-SPEC §12.2).
      void sessionInsights.turnStarted(event.agent.id, paseo);
      return;
    }
    // The previous turn's Next moves card goes (in place) as this turn starts; never blocks the hook.
    void nextRows.turnStarted(identity.agentId, paseo);
    const auto = await autoStatusOn();
    await store.mutate((board) => {
      recordLifecycle(store, board, identity, "agent.turn_started");
      if (auto) applyTurnStarted(store, board, identity, event.agent.title);
    });
  });
  server.on("agent.turn_ended", async (event, { paseo }) => {
    // Before any await: a turn of this session that starts later skips its summary row (NATIVE-SESSION-SPEC §5.1).
    const endedAt = new Date().toISOString();
    tools.attach(paseo);
    const identity = await managedTask(event.agent);
    if (!identity) {
      // A session Flowly does not manage (NATIVE-SESSION-SPEC §12): insights after a completed turn, when switched on.
      if (event.outcome.kind === "completed")
        void sessionInsights.enqueue(event.agent, event.timeline, paseo, endedAt).catch((e) =>
          console.error("Flowly session insight failed:", e instanceof Error ? e.message : String(e)),
        );
      return;
    }
    // This turn's suggested next steps as a card under the reply in Paseo's timeline. First thing, before the
    // settings read, the model lookup (up to 2 s) and the board write: the suggestion is already in the board's
    // events and none of those steps changes it, so the card waits for nothing. Never blocks the hook.
    if (event.outcome.kind === "completed") void nextRows.turnEnded(identity, paseo);
    const auto = await autoStatusOn();
    // Agent habits (WORKFLOW-INSIGHTS-SPEC §12.4): the model this turn ran on, and whether the user's message took one of the suggestions that were open.
    const model = await sessionModel(paseo, event.agent);
    const texts = userTexts(event.timeline);
    await store.mutate((board) => {
      recordLifecycle(store, board, identity, "agent.turn_ended", event.outcome, { model, pick: turnPick(board.events, identity.agentId, texts) });
      if (auto) applyTurnEnded(store, board, identity, event.outcome);
    });
    // The session's plan and the workspace HEAD for the workpad (WORKPAD-SPEC §2.2, §5.2); never blocks the hook.
    void workpads.recordTurn(identity, event.timeline, paseo).catch((e) =>
      console.error("Kanban workpad plan not recorded:", e instanceof Error ? e.message : String(e)),
    );
    // Progress summary (TASK-SUMMARY-SPEC): runs after the hook returns, never blocks it.
    if (event.outcome.kind === "completed" && (await summaries.settings()).summaryEnabled)
      void summaries.enqueue(identity.taskId, identity.agentId, event.timeline, paseo, endedAt);
  });
  // Queued follow-ups go out when any session's turn ends (Paseo "queue").
  server.on("agent.turn_ended", async (event, { paseo }) => {
    if (event.outcome.kind !== "failed") await composer.drain(event.agent.id, paseo).catch(() => undefined);
  });
  // Shell calls of any card-workspace session (WORKFLOW-INSIGHTS-SPEC §3.1); after the hook, never blocking it.
  server.on("agent.turn_ended", (event, { paseo }) => {
    void workflow.recordTurn(event.agent, event.timeline, paseo).catch((e) =>
      console.error("Workflow insights commands not recorded:", e instanceof Error ? e.message : String(e)),
    );
  });
  server.on("agent.permission_requested", async (event, { paseo }) => {
    tools.attach(paseo);
    const identity = await managedTask(event.agent);
    if (!identity) return;
    await store.mutate((board) =>
      recordLifecycle(store, board, identity, "agent.permission_requested"),
    );
  });
  console.log("Flowly store ready:", store.directory);
  server.before("agent.session_open", async ({ request }, { paseo }) => {
    tools.attach(paseo);
    if (request.purpose !== "interactive") return;
    try {
      const contextFile = await tools.sessionContext(
        request.agentId,
        request.workspaceId,
        paseo,
      );
      if (contextFile)
        return {
          ...request,
          env: {
            ...request.env,
            FLOWLY_CONTEXT_FILE: contextFile,
            FLOWLY_CLI: store.directory + "/flowly.mjs",
            FLOWLY_SKILL: store.directory + "/SKILL.md",
          },
        };
    } catch (e) {
      console.error(
        "Kanban session CLI unavailable:",
        e instanceof Error ? e.message : String(e),
      );
    }
  });
  return () => {
    workflow.stop();
    stopWorkflowPrefs();
    folders.stop();
    tools.stop();
  };
}
