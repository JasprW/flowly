// Round 2 live fixture. Run from the worktree root with `setup`, `observe`,
// `deliver-done`, or `cleanup`. IDs are persisted as soon as each resource exists.
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { DaemonClient } from '@getpaseo/client/internal/daemon-client';
import { createPaseoApi } from '@getpaseo/client';

const out = new URL('./evidence.json', import.meta.url);
const sourceIds = '/Users/bofan.wang/Developer/personal/paseo-utlra-kanban/docs/promo/ids.json';
const model = 'claude/claude-haiku-5-5';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let ev;
try { ev = JSON.parse(await readFile(out, 'utf8')); } catch {}
ev ??= {
  round: 2,
  testSessionId: 'e63b5616-a0db-47cd-9b11-4c3691dcde10',
  testSessionModel: 'codex/gpt-6-luna',
  testSessionMode: 'full-access',
  fixtureModel: model,
  startedAt: new Date().toISOString(),
  steps: [],
};
const client = new DaemonClient({ url: 'ws://127.0.0.1:6767/ws', clientId: `native-r2-${randomUUID()}`, clientType: 'cli', appVersion: '0.11.2', connectTimeoutMs: 10000, reconnect: { enabled: false } });
const api = createPaseoApi(client);
const rpc = (name, input = {}) => client.invokePluginRpc('flowly', name, input);
const save = async () => writeFile(out, JSON.stringify(ev, null, 2));
const log = async (step, data = {}) => { ev.steps.push({ at: new Date().toISOString(), step, ...data }); await save(); console.log(step, JSON.stringify(data)); };
const snap = async (id) => (await api.agents.ref(id).refresh())?.agent;
const timeline = async (id) => (await api.agents.ref(id).timeline.refetch({ direction: 'tail', limit: 100, projection: 'projected' })).entries ?? [];
const pluginRows = (entries, kind) => entries.map((x) => x.item).filter((x) => x?.type === 'plugin' && x.kind === kind);
const waitIdle = async (ids, timeout = 300000) => {
  const deadline = Date.now() + timeout;
  let states = [];
  while (Date.now() < deadline) {
    states = await Promise.all(ids.map(async (id) => ({ id, state: await snap(id) })));
    if (states.every(({ state }) => state?.status === 'idle' || state?.archivedAt)) return states;
    await sleep(1500);
  }
  throw new Error(`Timed out waiting for idle: ${JSON.stringify(states.map(({ id, state }) => ({ id, status: state?.status })))}`);
};

const mode = process.argv[2] ?? 'setup';
try {
  await client.connect();
  if (mode === 'setup') {
    if (ev.fixture?.cardId) throw new Error(`Round 2 fixture already exists: ${ev.fixture.cardId}`);
    const ids = JSON.parse(await readFile(sourceIds, 'utf8'));
    const card = await rpc('tasks.create', {
      projectId: ids.project.id,
      operationId: `native-session-r2-${randomUUID()}`,
      mode: 'directory', status: 'todo', priority: 'normal',
      title: `[test] native session round 2 ${randomUUID().slice(0, 8)}`,
      description: 'Round 2 disposable fixture for native next-moves timeline cards and message-box fill/copy. No source edits.',
    });
    ev.fixture = { cardId: card.id, workspaceId: card.workspaceId, title: card.title, mode: 'directory', projectId: ids.project.id, createdAt: new Date().toISOString() };
    await save();
    await log('card-created', ev.fixture);

    const prepared = await rpc('tools.prepare-session', { id: card.id, operationId: `native-session-r2-managed-${randomUUID()}` });
    ev.fixture.managedAgentId = prepared.agentId;
    await save();
    const managed = await api.workspaces.ref(card.workspaceId).agents.create({
      agentId: prepared.agentId,
      idempotencyKey: `ultra-kanban-session:${prepared.agentId}`,
      title: '[test] native session round 2 managed',
      labels: { 'flowly-task': card.id },
      config: { provider: model, modeId: 'bypassPermissions', systemPrompt: prepared.instructions, mcpServers: { 'ultra-kanban': prepared.mcp } },
      env: { ULTRA_KANBAN_CONTEXT_FILE: prepared.contextFile, ULTRA_KANBAN_CLI: prepared.cliPath, ULTRA_KANBAN_SKILL: prepared.skillPath },
      prompt: 'For this disposable fixture only: make no file edits. Use Flowly tools to set the card stage to in_progress, propose exactly one idea with flowly_propose_idea titled "Document native timeline behavior" with scope here, then deliver with flowly_report_progress kind=result and exactly these two message nextMoves: label "Inspect row", prompt "Inspect the native timeline row and verify its event id."; label "Verify fill", prompt "Verify that this prompt fills the correct session input." Do not include moveTo. Finish the tool work and report briefly.',
    });
    ev.fixture.managedAgentId = managed.id;
    await save();
    await log('managed-session-created', { agentId: managed.id, provider: model, modeId: 'bypassPermissions' });

    const unmanaged = await api.workspaces.ref(card.workspaceId).agents.create({
      title: '[test] native session round 2 unmanaged',
      config: { provider: model, modeId: 'bypassPermissions' },
      prompt: 'Reply OK.',
    });
    ev.fixture.unmanagedAgentId = unmanaged.id;
    await save();
    await log('unmanaged-session-created', { agentId: unmanaged.id, provider: model });

    await waitIdle([managed.id, unmanaged.id]);
    const deadline = Date.now() + 180000;
    let board, summaries, managedEntries, unmanagedEntries, summary, readyRow;
    while (Date.now() < deadline) {
      board = await rpc('board.read', {});
      summaries = await rpc('summaries.read', {});
      summary = summaries.latest?.find((x) => x.taskId === card.id) ?? null;
      managedEntries = await timeline(managed.id);
      unmanagedEntries = await timeline(unmanaged.id);
      readyRow = pluginRows(managedEntries, 'flowly-next-moves').find((x) => x.data?.status === 'ready') ?? null;
      if (summary && readyRow && pluginRows(managedEntries, 'flowly-summary').length) break;
      await sleep(1000);
    }
    board ??= await rpc('board.read', {});
    const ideas = board.ideas.filter((x) => x.taskId === card.id);
    const openIdea = ideas.find((x) => x.status === 'open') ?? null;
    const lastAssistantIndex = managedEntries.map((x) => x.item).reduce((found, item, i) => item?.type === 'assistant_message' ? i : found, -1);
    const nextRowIndex = managedEntries.findIndex((x) => x.item?.type === 'plugin' && x.item.id === readyRow?.id);
    const chips = await rpc('sessions.native-chips', {});
    ev.fixture.summaryEntryId = summary?.id ?? null;
    ev.fixture.initialIdea = openIdea ? { id: openIdea.id, title: openIdea.title } : null;
    ev.fixture.nextMoveEventId = readyRow?.data?.eventId ?? null;
    ev.fixture.nextMoveRowId = readyRow?.id ?? null;
    ev.fixture.nextMoves = readyRow?.data?.moves ?? [];
    ev.round2InitialSettings = { nextMoveTap: chips.nextMoveTap, autoWrapup: chips.autoWrapup, ideas: chips.ideas };
    await log('initial-ready-state', {
      managedStatus: (await snap(managed.id))?.status,
      unmanagedStatus: (await snap(unmanaged.id))?.status,
      summary,
      summaryRows: pluginRows(managedEntries, 'flowly-summary').map((x) => ({ id: x.id, data: x.data })),
      readyRow,
      unmanagedNextRows: pluginRows(unmanagedEntries, 'flowly-next-moves'),
      nextMovesRowAfterLastAssistantReply: nextRowIndex > lastAssistantIndex,
      idea: ev.fixture.initialIdea,
      nativeChipState: { managedListed: chips.managed.some((x) => x.agentId === managed.id), unmanagedListed: chips.managed.some((x) => x.agentId === unmanaged.id), ideas: chips.ideas, autoWrapup: chips.autoWrapup, nextMoveTap: chips.nextMoveTap },
    });
    if (!summary || !readyRow || !openIdea || readyRow.data?.moves?.filter((x) => x.prompt).length !== 2) throw new Error('Fixture did not reach the required initial state');
  } else if (mode === 'observe') {
    const f = ev.fixture;
    if (!f?.managedAgentId) throw new Error('No Round 2 fixture');
    const board = await rpc('board.read', {});
    const summaries = await rpc('summaries.read', {});
    const managedEntries = await timeline(f.managedAgentId);
    const unmanagedEntries = await timeline(f.unmanagedAgentId);
    const chips = await rpc('sessions.native-chips', {});
    await log('observe', {
      task: board.tasks.find((x) => x.id === f.cardId) ?? null,
      ideas: board.ideas.filter((x) => x.taskId === f.cardId),
      summary: summaries.latest?.find((x) => x.taskId === f.cardId) ?? null,
      managedNextRows: pluginRows(managedEntries, 'flowly-next-moves'),
      unmanagedNextRows: pluginRows(unmanagedEntries, 'flowly-next-moves'),
      managedProgressRows: pluginRows(managedEntries, 'flowly-summary'),
      nativeChipState: { managedListed: chips.managed.some((x) => x.agentId === f.managedAgentId), unmanagedListed: chips.managed.some((x) => x.agentId === f.unmanagedAgentId), ideas: chips.ideas, autoWrapup: chips.autoWrapup, nextMoveTap: chips.nextMoveTap },
      managedState: await snap(f.managedAgentId),
      unmanagedState: await snap(f.unmanagedAgentId),
    });
  } else if (mode === 'deliver-done') {
    const f = ev.fixture;
    if (!f?.managedAgentId) throw new Error('No Round 2 fixture');
    await waitIdle([f.managedAgentId]);
    const turn = await api.agents.ref(f.managedAgentId).run('No file edits. Use flowly_update_status to deliver the card to in_review with a short note and nextMoves exactly [{label:"Move to Done", moveTo:"done"}]. Set acknowledgeOpen:true if the tool requires it. Do not move the card to Done yourself.');
    await waitIdle([f.managedAgentId]);
    let entries = await timeline(f.managedAgentId);
    let row = pluginRows(entries, 'flowly-next-moves').filter((x) => x.data?.status === 'ready').at(-1) ?? null;
    const deadline = Date.now() + 60000;
    while (!row && Date.now() < deadline) { await sleep(1000); entries = await timeline(f.managedAgentId); row = pluginRows(entries, 'flowly-next-moves').filter((x) => x.data?.status === 'ready').at(-1) ?? null; }
    f.doneMoveRowId = row?.id ?? null;
    await log('move-to-done-ready', { turnStatus: turn.status, row, task: (await rpc('board.read', {})).tasks.find((x) => x.id === f.cardId) ?? null });
    if (!row?.data?.moves?.some((x) => x.moveTo === 'done')) throw new Error('Move to Done row not ready');
  } else if (mode === 'deliver-moves-again') {
    const f = ev.fixture;
    if (!f?.managedAgentId) throw new Error('No Round 2 fixture');
    await waitIdle([f.managedAgentId]);
    const turn = await api.agents.ref(f.managedAgentId).run('For compact-layout verification only, make no file edits. Use flowly_update_status to deliver the card to in_review with a short note and exactly two message nextMoves: label "Compact first", prompt "Compact layout first prompt."; label "Compact second", prompt "Compact layout second prompt.". Do not include moveTo.');
    await waitIdle([f.managedAgentId]);
    const entries = await timeline(f.managedAgentId);
    const row = pluginRows(entries, 'flowly-next-moves').filter((x) => x.data?.status === 'ready').at(-1) ?? null;
    await log('compact-ready-state', { turnStatus: turn.status, row, task: (await rpc('board.read', {})).tasks.find((x) => x.id === f.cardId) ?? null });
    if (!row || row.data?.moves?.filter((x) => x.prompt).length !== 2) throw new Error('Compact layout moves row not ready');
  } else if (mode === 'reopen-for-compact') {
    const f = ev.fixture;
    if (!f?.cardId) throw new Error('No Round 2 fixture');
    const task = (await rpc('board.read', {})).tasks.find((x) => x.id === f.cardId);
    const updated = await rpc('tasks.update', { id: task.id, revision: task.revision, status: 'in_review' });
    await log('reopened-for-compact', { before: task.status, after: updated.status, revision: updated.revision });
  } else if (mode === 'cleanup') {
    const f = ev.fixture;
    if (f?.cardId) {
      const board = await rpc('board.read', {});
      const task = board.tasks.find((x) => x.id === f.cardId);
      if (task) await log('cleanup-delete', await rpc('tasks.delete', { id: task.id, revision: task.revision, archive: true, acknowledgeWarnings: true }));
      await sleep(2500);
      const after = await rpc('board.read', {});
      const states = {};
      for (const id of [f.managedAgentId, f.unmanagedAgentId].filter(Boolean)) {
        const state = await snap(id);
        states[id] = { status: state?.status, archivedAt: state?.archivedAt ?? null };
      }
      const workspaceRows = (await import('node:child_process')).execFileSync('paseo', ['workspace', 'ls'], { encoding: 'utf8' });
      await log('cleanup-verify', { cardAbsent: !after.tasks.some((x) => x.id === f.cardId), sessions: states, workspaceAbsent: !workspaceRows.includes(f.workspaceId), workspaceId: f.workspaceId });
    } else await log('cleanup-verify', { fixtureCreated: false });
  } else throw new Error(`Unknown mode: ${mode}`);
} catch (error) {
  await log('error', { message: String(error?.message ?? error) });
  process.exitCode = 1;
} finally {
  ev.endedAt = new Date().toISOString();
  await save();
  await api.dispose().catch(() => {});
  await client.close().catch(() => {});
}
