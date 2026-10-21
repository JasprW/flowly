// Round 4 session-insights fixture harness; run from the worktree root.
// Modes: setup-f1, run-f1, setup-f2, run-f2, setup-managed, observe-f1,
// observe-f2, cleanup. The settings baseline is captured before any fixtures.
import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { access, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DaemonClient } from '@getpaseo/client/internal/daemon-client';
import { createPaseoApi } from '@getpaseo/client';

const out = new URL('./evidence.json', import.meta.url);
const tinylinkPath = '/Users/bofan.wang/Developer/personal/flowly-test/tinylink';
const tinylinkProjectId = '3db2ad5b-e6c4-4054-b2ed-a13a8dfa0663';
const model = 'claude/claude-haiku-5-5';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let ev;
try { ev = JSON.parse(await readFile(out, 'utf8')); } catch {}
ev ??= {
  round: 4,
  testSessionId: 'e63b5616-a0db-47cd-9b11-4c3691dcde10',
  testSessionModel: 'codex/gpt-6-luna',
  testSessionMode: 'full-access',
  fixtureModel: model,
  settingsBeforeFile: 'settings-before.json',
  startedAt: new Date().toISOString(),
  steps: [],
};
const client = new DaemonClient({ url: 'ws://127.0.0.1:6767/ws', clientId: `native-r4-${randomUUID()}`, clientType: 'cli', appVersion: '0.11.2', connectTimeoutMs: 10000, reconnect: { enabled: false } });
const api = createPaseoApi(client);
const rpc = (name, input = {}) => client.invokePluginRpc('flowly', name, input);
const save = async () => writeFile(out, JSON.stringify(ev, null, 2));
const log = async (step, data = {}) => { ev.steps.push({ at: new Date().toISOString(), step, ...data }); await save(); console.log(step, JSON.stringify(data)); };
const snap = async (id) => (await api.agents.ref(id).refresh())?.agent ?? null;
const timeline = async (id) => (await api.agents.ref(id).timeline.refetch({ direction: 'tail', limit: 100, projection: 'projected' })).entries ?? [];
const rows = async (id) => (await timeline(id)).map((x) => x.item).filter((x) => x?.type === 'plugin');
const insight = async (id) => (await rpc('sessions.insights', {})).value?.find((x) => x.agentId === id) ?? null;
async function allAgents(includeArchived = true) {
  const found = []; let cursor;
  do { const page = await api.agents.list({ filter: { includeArchived }, page: { limit: 200, cursor } }); found.push(...page.entries.map((x) => x.agent)); cursor = page.pageInfo.nextCursor ?? undefined; } while (cursor);
  return found;
}
async function waitIdle(agentId, timeout = 300000) {
  const deadline = Date.now() + timeout; let state;
  do { state = await snap(agentId); if (state?.status === 'idle' || state?.archivedAt) return state; await sleep(1000); } while (Date.now() < deadline);
  throw new Error(`Timed out waiting for ${agentId}: ${state?.status}`);
}
async function runCompletedTurn(agentId, prompt, timeout = 300000) {
  const before = await timeline(agentId); const userCount = before.filter((x) => x.item?.type === 'user_message').length;
  const startedAt = new Date().toISOString(); const dispatched = await api.agents.ref(agentId).run(prompt);
  const deadline = Date.now() + timeout; let state = null; let latest = [];
  do {
    state = await snap(agentId); latest = await timeline(agentId);
    const userItems = latest.map((x, index) => ({ item: x.item, index })).filter((x) => x.item?.type === 'user_message');
    const newUser = userItems.length > userCount ? userItems.at(-1) : null;
    const assistantAfter = newUser ? latest.slice(newUser.index + 1).some((x) => x.item?.type === 'assistant_message') : false;
    if (newUser && assistantAfter && state?.status === 'idle' && !(state.pendingPermissions?.length)) return { startedAt, dispatchStatus: dispatched.status, userMessage: newUser.item.text, timeline: latest };
    await sleep(400);
  } while (Date.now() < deadline);
  throw new Error(`Timed out waiting for a completed turn: ${agentId} state=${state?.status}`);
}
const pluginRows = (entries, kind) => entries.map((x) => x.item).filter((x) => x?.type === 'plugin' && x.kind === kind);
const recordRepoState = () => {
  const status = execFileSync('git', ['status', '--porcelain'], { cwd: tinylinkPath, encoding: 'utf8' });
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: tinylinkPath, encoding: 'utf8' }).trim();
  return { statusHash: createHash('sha256').update(status).digest('hex'), head };
};
function parseJson(text) {
  const objectStart = text.indexOf('{'); const arrayStart = text.indexOf('[');
  const start = objectStart < 0 ? arrayStart : arrayStart < 0 ? objectStart : Math.min(objectStart, arrayStart);
  const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
  if (start < 0 || end < start) throw new Error(`Expected JSON output, got: ${text.slice(0, 300)}`);
  return JSON.parse(text.slice(start, end + 1));
}
async function workspaceDetails(workspaceId) {
  const ref = api.workspaces.ref(workspaceId);
  const result = await ref.refresh().catch(() => null);
  return result?.workspace ?? result ?? null;
}
async function createF1() {
  const baseline = JSON.parse(await readFile(new URL('./settings-before.json', import.meta.url), 'utf8')).settings;
  const settings = await rpc('sessions.native-chips', {});
  if (JSON.stringify(settings.outside) !== JSON.stringify({ enabled: baseline.sessionsOutsideFlowly, progress: baseline.progress, nextMoves: baseline.suggestedNextSteps, ideas: baseline.ideas }) || settings.nextMoveTap !== baseline.tappingSuggestedNextStep)
    throw new Error(`Live settings differ from the baseline recorded via UI: ${JSON.stringify({ live: settings.outside, nextMoveTap: settings.nextMoveTap, baseline })}`);
  const before = await rpc('board.read', {});
  if (!before.projects.some((p) => p.id === tinylinkProjectId)) throw new Error('Tinylink project ID not found in Flowly board.');
  const existingTinylinkTasks = before.tasks.filter((t) => t.projectId === tinylinkProjectId).map((t) => ({ id: t.id, title: t.title, status: t.status })).sort((a, b) => a.id.localeCompare(b.id));
  const tinylinkCount = existingTinylinkTasks.length;
  const repoState = recordRepoState();
  const title = `[test] outside native session r4 card-folder ${randomUUID().slice(0, 8)}`;
  const card = await rpc('tasks.create', { projectId: tinylinkProjectId, operationId: `native-r4-f1-${randomUUID()}`, mode: 'directory', status: 'todo', priority: 'normal', title, description: 'Round 4 disposable card-folder session-insights fixture. The agent is instructed not to edit the Tinylink repository.' });
  ev.f1 = { cardId: card.id, title: card.title, projectId: card.projectId, workspaceId: card.workspaceId, mode: 'directory', createdAt: new Date().toISOString(), tinylinkCountBefore: tinylinkCount, existingTinylinkTasks, tinylinkRepoBefore: repoState };
  await save(); await log('f1-card-created', ev.f1);
  const agent = await api.workspaces.ref(card.workspaceId).agents.create({
    title: '[test] outside r4 card-folder',
    config: { provider: model, modeId: 'bypassPermissions' },
    prompt: 'Read this repository without changing any files. Identify three concrete, distinct improvements that would make it easier to maintain, using filenames or evidence where possible. Summarize them in your reply and ask me which one to explore first. Do not call Flowly tools and do not create or edit files; this is the permanent Tinylink repository.',
  });
  ev.f1.agentId = agent.id; ev.f1.model = model; ev.f1.modeId = 'bypassPermissions'; await save(); await log('f1-plain-session-created', { agentId: agent.id, workspaceId: card.workspaceId, noPrepareSession: true, labels: agent.labels ?? {} });
  await waitIdle(agent.id);
  const current = await rpc('sessions.native-chips', {});
  const items = await rows(agent.id);
  const children = (await allAgents(true)).filter((x) => x.parentAgentId === agent.id || x.labels?.['flowly-session'] === agent.id);
  await log('e1-off-observation', { outsideSettings: current.outside, managedListing: current.managed.some((x) => x.agentId === agent.id), insightChildren: children.map((x) => ({ id: x.id, labels: x.labels, archivedAt: x.archivedAt ?? null })), progressRows: items.filter((x) => x.kind === 'flowly-summary'), nextRows: items.filter((x) => x.kind === 'flowly-next-moves'), insightsView: await rpc('sessions.insights', {}), settingsBaseline: baseline });
}
async function runF1(kind) {
  const f = ev.f1; if (!f?.agentId) throw new Error('F1 session missing.');
  const prompts = {
    e2: 'Continue the read-only review. Pick the highest-value item from your prior three ideas and give me two concise next messages I could send you to pursue it. Do not edit files. If you see a separate worthwhile follow-up, describe it as a distinct idea; then ask which direction to take.',
    progress: 'Continue the read-only review with a concise progress update and two useful next requests. Do not edit files. Ask which request I want to pursue.',
    next: 'Continue the read-only review. Summarize one concrete observation and ask me which of two next requests to try. Do not edit files.',
    ideas: 'Continue the read-only review. Give me one concise status update and two possible next requests. Do not edit files; ask which to pursue.',
    e6: 'Please acknowledge the selected idea instruction, then stop and ask which step I want next. Do not edit files.',
  };
  if (!prompts[kind]) throw new Error(`Unknown F1 turn ${kind}`);
  const startedAt = new Date().toISOString();
  const turn = await api.agents.ref(f.agentId).run(prompts[kind]);
  await log(`f1-turn-${kind}-started`, { turnStatus: turn.status, prompt: prompts[kind], startedAt });
  await waitIdle(f.agentId);
  await observe(`f1-turn-${kind}-finished`, f.agentId);
}
async function createF2() {
  if (ev.f2?.agentId) throw new Error(`F2 already exists: ${ev.f2.agentId}`);
  const path = `/tmp/flowly-native-r4-${randomUUID()}`;
  ev.f2 = { tempDirectory: path, branch: 'r4-base', title: '[test] outside native session r4 F2', createdAt: new Date().toISOString() };
  await save(); await log('f2-path-recorded-before-create', { tempDirectory: path, branch: ev.f2.branch });
  await mkdir(path, { recursive: false });
  await writeFile(join(path, 'README.md'), '# Temporary outside-session fixture\n\nA tiny repository used only to verify Flowly insights for sessions outside Flowly.\n');
  execFileSync('git', ['init', '-b', ev.f2.branch], { cwd: path, stdio: 'pipe' });
  execFileSync('git', ['add', 'README.md'], { cwd: path, stdio: 'pipe' });
  execFileSync('git', ['-c', 'user.name=Round Four Fixture', '-c', 'user.email=round4-fixture@example.invalid', 'commit', '-m', 'Create disposable outside-session fixture'], { cwd: path, stdio: 'pipe' });
  ev.f2.gitHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: path, encoding: 'utf8' }).trim(); await save();
  const project = parseJson(execFileSync('paseo', ['project', 'create', '--json', path], { encoding: 'utf8' }));
  ev.f2.projectId = project.id ?? project.projectId; ev.f2.projectCreatedAt = new Date().toISOString(); await save(); await log('f2-native-project-created', { project });
  const workspace = parseJson(execFileSync('paseo', ['workspace', 'create', '--json', '--isolation', 'local', '--path', path, '--project', ev.f2.projectId, '--title', ev.f2.title, '--no-background'], { encoding: 'utf8' }));
  const workspaceId = workspace.id ?? workspace.workspaceId;
  ev.f2.workspaceId = workspaceId; ev.f2.workspace = workspace; ev.f2.workspaceIds = [workspaceId]; await save(); await log('f2-local-workspace-created', { workspaceId, workspace });
  const agent = await api.workspaces.ref(workspaceId).agents.create({ title: ev.f2.title, config: { provider: model, modeId: 'bypassPermissions' }, prompt: 'Read README.md. Create notes.md with exactly three concise, distinct, concrete improvement ideas for this tiny repository. Do not implement any of the ideas. In your final reply, summarize the three ideas and ask me which one to do first.' });
  ev.f2.agentId = agent.id; ev.f2.model = model; ev.f2.modeId = 'bypassPermissions'; await save(); await log('f2-plain-session-created', { agentId: agent.id, workspaceId, noPrepareSession: true, labels: agent.labels ?? {} });
  await waitIdle(agent.id); await observe('f2-first-turn-finished', agent.id);
}
async function observe(label, agentId) {
  const agent = await snap(agentId); const timelineItems = await rows(agentId); const insightResult = await rpc('sessions.insights', {});
  const view = insightResult.value?.find((x) => x.agentId === agentId) ?? null;
  const children = (await allAgents(true)).filter((x) => x.parentAgentId === agentId || x.labels?.['flowly-session'] === agentId);
  const summaryRows = timelineItems.filter((x) => x.kind === 'flowly-summary');
  const moveRows = timelineItems.filter((x) => x.kind === 'flowly-next-moves');
  const assistants = (await timeline(agentId)).map((x) => x.item);
  const assistantIndex = assistants.reduce((n, x, i) => x?.type === 'assistant_message' ? i : n, -1);
  const moveIndex = assistants.findIndex((x) => x?.type === 'plugin' && x.kind === 'flowly-next-moves' && x.data?.status === 'ready');
  const result = {
    agentId, state: { status: agent?.status, archivedAt: agent?.archivedAt ?? null, workspaceId: agent?.workspaceId, parentAgentId: agent?.parentAgentId ?? null, labels: agent?.labels ?? {} },
    settings: (await rpc('sessions.native-chips', {})).outside,
    view,
    summaryRows: summaryRows.map((x) => ({ id: x.id, data: x.data })),
    moveRows: moveRows.map((x) => ({ id: x.id, data: x.data })),
    latestMoveAfterAssistant: moveIndex > assistantIndex,
    insightChildren: children.map((x) => ({ id: x.id, title: x.title, labels: x.labels, archivedAt: x.archivedAt ?? null, parentAgentId: x.parentAgentId ?? null })),
  };
  await log(label, result); return result;
}
async function setupManaged() {
  const f = ev.f1; const current = await rpc('board.read', {}); const task = current.tasks.find((x) => x.id === f.cardId); if (!task) throw new Error('F1 Flowly card missing.');
  const prepared = await rpc('tools.prepare-session', { id: task.id, operationId: `native-r4-managed-${randomUUID()}` });
  f.managedAgentId = prepared.agentId; await save();
  const agent = await api.workspaces.ref(task.workspaceId).agents.create({
    agentId: prepared.agentId, idempotencyKey: `ultra-kanban-session:${prepared.agentId}`, title: '[test] native r4 managed session', labels: { 'flowly-task': task.id },
    config: { provider: model, modeId: 'bypassPermissions', systemPrompt: prepared.instructions, mcpServers: { 'ultra-kanban': prepared.mcp } },
    env: { ULTRA_KANBAN_CONTEXT_FILE: prepared.contextFile, ULTRA_KANBAN_CLI: prepared.cliPath, ULTRA_KANBAN_SKILL: prepared.skillPath },
    prompt: 'For this fixture only, make no file edits. Use flowly_update_status to set this card to in_progress, then use flowly_report_progress kind=result with a brief note and nextMoves exactly [{label:"Inspect summary",prompt:"Check the managed progress summary card."}]. Do not include moveTo. Report briefly.',
  });
  f.managedAgentId = agent.id; await save(); await log('managed-session-created-for-e7', { agentId: agent.id, workspaceId: task.workspaceId }); await waitIdle(agent.id);
  let found; const deadline = Date.now() + 150000;
  do { found = await observe('e7-managed-observation', agent.id); if (found.summaryRows.length) break; await sleep(1000); } while (Date.now() < deadline);
}
async function cleanup() {
  const clean = { f1: null, f2: null, tinylink: null, settings: 'verified separately in UI' };
  if (ev.f1?.cardId) {
    const ownedIds=[ev.f1.agentId,ev.f1.managedAgentId,...(ev.f1.extraSessionIds??[])].filter(Boolean);
    for(const id of ownedIds){const state=await snap(id);if(state&&!state.archivedAt&&(state.status==='running'||state.status==='initializing')){execFileSync('paseo',['agent','stop',id],{encoding:'utf8'});const deadline=Date.now()+20000;let stopped=await snap(id);while(stopped&&!stopped.archivedAt&&(stopped.status==='running'||stopped.status==='initializing')&&Date.now()<deadline){await sleep(300);stopped=await snap(id);}await log('cleanup-stop-running-f1-session',{agentId:id,statusAfterStop:stopped?.status,archivedAt:stopped?.archivedAt??null});}}
    const board = await rpc('board.read', {}); const task = board.tasks.find((x) => x.id === ev.f1.cardId);
    if (task) await log('cleanup-f1-delete', await rpc('tasks.delete', { id: task.id, revision: task.revision, archive: true, acknowledgeWarnings: true }));
  }
  if (ev.f2?.projectId) {
    const workspaceDescriptors = [];
    for (const id of ev.f2.workspaceIds ?? (ev.f2.workspaceId ? [ev.f2.workspaceId] : [])) {
      const descriptor = await workspaceDetails(id);
      if (descriptor) workspaceDescriptors.push({ id, directory: descriptor.workspaceDirectory ?? descriptor.directory ?? null, kind: descriptor.kind ?? null, projectId: descriptor.projectId ?? null });
    }
    ev.f2.workspaceDescriptorsBeforeDelete = workspaceDescriptors; await save();
    const result = execFileSync('paseo', ['project', 'delete', ev.f2.projectId, '--json'], { encoding: 'utf8' });
    await log('cleanup-f2-project-delete', { projectId: ev.f2.projectId, output: result.trim() });
    for (const descriptor of workspaceDescriptors) {
      if (descriptor.kind !== 'worktree' || !descriptor.directory) continue;
      const candidate = descriptor.directory; const resolved = await realpath(candidate).catch(() => null);
      if (resolved && resolved.startsWith('/Users/bofan.wang/.paseo/worktrees/')) {
        await rm(resolved, { recursive: true, force: true });
        await log('cleanup-generated-worktree-directory', { workspaceId: descriptor.id, path: resolved, removed: true });
      }
    }
    const temp = ev.f2.tempDirectory;
    if (typeof temp === 'string' && temp.startsWith('/tmp/flowly-native-r4-')) {
      await rm(temp, { recursive: true, force: true }); await log('cleanup-f2-temp-directory', { path: temp, removed: true });
    } else throw new Error(`Unsafe or missing F2 temp path: ${String(temp)}`);
  }
  await sleep(1500);
  const finalBoard = await rpc('board.read', {});
  const projects = parseJson(execFileSync('paseo', ['project', 'ls', '--json'], { encoding: 'utf8' }));
  const workspaces = parseJson(execFileSync('paseo', ['workspace', 'ls', '--json'], { encoding: 'utf8' }));
  const agents = await allAgents(true);
  const repoAfter = recordRepoState();
  const f1session = ev.f1?.agentId ? await snap(ev.f1.agentId) : null;
  const f2session = ev.f2?.agentId ? await snap(ev.f2.agentId) : null;
  const f1TaskPresent = finalBoard.tasks.some((x) => x.id === ev.f1?.cardId);
  const f2ProjectPresent = (Array.isArray(projects) ? projects : projects.projects ?? []).some((x) => x.id === ev.f2?.projectId);
  const workspaceArray = Array.isArray(workspaces) ? workspaces : workspaces.workspaces ?? [];
  const f2WorkspaceIds = ev.f2?.workspaceIds ?? (ev.f2?.workspaceId ? [ev.f2.workspaceId] : []);
  const f1Extra=await Promise.all((ev.f1?.extraSessionIds??[]).map(async id=>{const s=await snap(id);return{id,archived:!!s?.archivedAt,status:s?.status};}));
  const f2Extra=await Promise.all((ev.f2?.extraSessionIds??[]).map(async id=>{const s=await snap(id);return{id,archived:!!s?.archivedAt,status:s?.status};}));
  clean.f1 = { cardAbsent: !f1TaskPresent, sessionArchived: !!f1session?.archivedAt, sessionStatus: f1session?.status, extraSessions:f1Extra };
  clean.f2 = { projectAbsent: !f2ProjectPresent, workspaceIdsAbsent: f2WorkspaceIds.every((id) => !workspaceArray.some((x) => x.id === id)), sessionArchived: !!f2session?.archivedAt, sessionStatus: f2session?.status, extraSessions:f2Extra, tempDirectoryAbsent: ev.f2?.tempDirectory ? !await access(ev.f2.tempDirectory).then(() => true).catch(() => false) : true };
  const finalTinylinkTasks = finalBoard.tasks.filter((x) => x.projectId === tinylinkProjectId).map((x) => ({ id: x.id, title: x.title, status: x.status })).sort((a, b) => a.id.localeCompare(b.id));
  const baselineTasks=ev.f1?.existingTinylinkTasks??[];const finalById=new Map(finalTinylinkTasks.map(x=>[x.id,x]));const missingBaseline=baselineTasks.filter(x=>!finalById.has(x.id));const changedBaseline=baselineTasks.filter(x=>{const y=finalById.get(x.id);return y&&(y.title!==x.title||y.status!==x.status)});const addedUnowned=finalTinylinkTasks.filter(x=>!baselineTasks.some(b=>b.id===x.id)&&x.id!==ev.f1?.cardId);
  clean.tinylink = { cardCount: finalTinylinkTasks.length, baselineCardCount:baselineTasks.length, projectPresent: finalBoard.projects.some((x) => x.id === tinylinkProjectId), originalCardsPreserved:missingBaseline.length===0&&changedBaseline.length===0, missingBaseline, changedBaseline, addedUnownedCards:addedUnowned, finalCards: finalTinylinkTasks, repoStateAfter: repoAfter, repoStateMatchesBefore: ev.f1?.tinylinkRepoBefore?.head === repoAfter.head && ev.f1?.tinylinkRepoBefore?.statusHash === repoAfter.statusHash };
  await log('cleanup-verification', clean);
  if (clean.f1?.cardAbsent !== true || clean.f1?.sessionArchived !== true || clean.f1?.extraSessions?.some(x=>!x.archived) || clean.f2?.projectAbsent !== true || clean.f2?.workspaceIdsAbsent !== true || clean.f2?.tempDirectoryAbsent !== true || clean.f2?.extraSessions?.some(x=>!x.archived) || clean.tinylink?.originalCardsPreserved !== true || clean.tinylink?.repoStateMatchesBefore !== true) throw new Error(`Cleanup verification failed: ${JSON.stringify(clean)}`);
}

const mode = process.argv[2] ?? 'setup-f1';
try {
  await client.connect();
  if (mode === 'setup-f1') await createF1();
  else if (mode === 'run-f1') await runF1(process.argv[3] ?? 'e2');
  else if (mode === 'wait-f1') { await waitIdle(ev.f1.agentId); await observe('f1-waited-idle', ev.f1.agentId); }
  else if (mode === 'setup-f2') await createF2();
  else if (mode === 'run-f2') {
    const f = ev.f2; if (!f?.agentId) throw new Error('F2 session missing.');
    const beforeItems = await rows(f.agentId); const previousReady = beforeItems.filter((x) => x.kind === 'flowly-next-moves' && x.data?.status === 'ready').at(-1) ?? null;
    const prompt = 'Continue the current task. Describe one useful observation and propose two concise next requests I could give you next. Do not edit any files. If there is a distinct follow-up worth doing, mention it separately; ask which direction I want.';
    const completed = await runCompletedTurn(f.agentId, prompt); await log('f2-followup-completed-turn', { startedAt: completed.startedAt, dispatchStatus: completed.dispatchStatus, userMessage: completed.userMessage, prompt });
    const afterItems = await rows(f.agentId); const previousAfter = previousReady ? afterItems.find((x) => x.id === previousReady.id) ?? null : null;
    await log('e6-f2-turn-start-dismissed', { previousRowId: previousReady?.id ?? null, previousRowBefore: previousReady?.data ?? null, previousRowAfter: previousAfter?.data ?? null, sameId: previousAfter?.id === previousReady?.id, rewrittenDismissed: previousAfter?.data?.status === 'dismissed' });
    await observe('f2-followup-finished', f.agentId);
  } else if (mode === 'e5-turn-f2') {
    const part = process.argv[3]; const f = ev.f2; if (!f?.agentId) throw new Error('F2 session missing.');
    const beforeTimeline = await timeline(f.agentId); const beforeProgress = pluginRows(beforeTimeline, 'flowly-summary').map((x) => x.id); const beforeMoves = pluginRows(beforeTimeline, 'flowly-next-moves').map((x) => x.id); const beforeView = await insight(f.agentId);
    const prompts = { progress: 'Continue this read-only fixture task. Give a short status and two possible next requests. Do not edit files.', nextMoves: 'Continue this read-only fixture task. Ask me to choose between two concise next requests. Do not edit files.', ideas: 'Continue this read-only fixture task. Give a short status and ask me what to do next. Do not edit files.' };
    if (!prompts[part]) throw new Error(`Unknown E5 part ${part}`);
    const completed = await runCompletedTurn(f.agentId, prompts[part]);
    const deadline = Date.now() + 120000; let newProgress = []; let newMoves = []; let afterView = null;
    do {
      const t = await timeline(f.agentId); newProgress = pluginRows(t, 'flowly-summary').filter((x) => !beforeProgress.includes(x.id)); newMoves = pluginRows(t, 'flowly-next-moves').filter((x) => x.data?.status === 'ready' && !beforeMoves.includes(x.id)); afterView = await insight(f.agentId);
      if ((part === 'progress' && newMoves.length) || (part === 'nextMoves' && newProgress.length) || (part === 'ideas' && (newProgress.length || newMoves.length))) break;
      await sleep(500);
    } while (Date.now() < deadline);
    const beforeIdeaIds=(beforeView?.ideas??[]).map(x=>x.id);const afterIdeaIds=(afterView?.ideas??[]).map(x=>x.id);
    await log(`e5-${part}-off-turn`, { startedAt: completed.startedAt, userMessage: completed.userMessage, settings: (await rpc('sessions.native-chips', {})).outside, before: { summaryRows: beforeProgress, moveRows: beforeMoves, ideas: beforeView?.ideas ?? [] }, after: { newProgressRows: newProgress.map((x) => ({ id: x.id, data: x.data })), newReadyMoves: newMoves.map((x) => ({ id: x.id, data: x.data })), ideas: afterView?.ideas ?? [], newIdeaIds:afterIdeaIds.filter(x=>!beforeIdeaIds.includes(x)), outsideView: afterView }, expected: { progressOff: part === 'progress', nextMovesOff: part === 'nextMoves', ideasOff: part === 'ideas' } });
    await observe(`f2-after-e5-${part}`, f.agentId);
  } else if (mode === 'setup-managed') await setupManaged();
  else if (mode === 'observe-f1') await observe('f1-observed', ev.f1.agentId);
  else if (mode === 'observe-f2') await observe('f2-observed', ev.f2.agentId);
  else if (mode === 'cleanup') await cleanup();
  else throw new Error(`Unknown mode: ${mode}`);
} catch (error) {
  await log('error', { mode, message: String(error?.stack ?? error) }); process.exitCode = 1;
} finally {
  ev.updatedAt = new Date().toISOString(); await save(); await api.dispose().catch(() => {}); await client.close().catch(() => {});
}
