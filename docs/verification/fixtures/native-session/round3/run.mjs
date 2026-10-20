// Round 3 D7 fixture harness. Run from the worktree root with setup-a, reopen-a,
// setup-b, or cleanup. All created IDs are written immediately to evidence.json.
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { DaemonClient } from '@getpaseo/client/internal/daemon-client';
import { createPaseoApi } from '@getpaseo/client';

const out = new URL('./evidence.json', import.meta.url);
const sourceIds = '/Users/bofan.wang/Developer/personal/paseo-utlra-kanban/docs/promo/ids.json';
const model = 'claude/claude-haiku-5-5';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let ev;
try { ev = JSON.parse(await readFile(out, 'utf8')); } catch {}
ev ??= {
  round: 3,
  testSessionId: 'e63b5616-a0db-47cd-9b11-4c3691dcde10',
  testSessionModel: 'codex/gpt-6-luna',
  testSessionMode: 'full-access',
  fixtureModel: model,
  settingsBeforeFile: 'settings-before.json',
  startedAt: new Date().toISOString(),
  steps: [],
};
const client = new DaemonClient({ url: 'ws://127.0.0.1:6767/ws', clientId: `native-r3-${randomUUID()}`, clientType: 'cli', appVersion: '0.11.2', connectTimeoutMs: 10000, reconnect: { enabled: false } });
const api = createPaseoApi(client);
const rpc = (name, input = {}) => client.invokePluginRpc('flowly', name, input);
const save = async () => writeFile(out, JSON.stringify(ev, null, 2));
const log = async (step, data = {}) => { ev.steps.push({ at: new Date().toISOString(), step, ...data }); await save(); console.log(step, JSON.stringify(data)); };
const snap = async (id) => (await api.agents.ref(id).refresh())?.agent;
const timeline = async (id) => (await api.agents.ref(id).timeline.refetch({ direction: 'tail', limit: 100, projection: 'projected' })).entries ?? [];
const waitIdle = async (id, timeout = 300000) => {
  const deadline = Date.now() + timeout;
  let state;
  do { state = await snap(id); if (state?.status === 'idle' || state?.archivedAt) return state; await sleep(1000); } while (Date.now() < deadline);
  throw new Error(`Timed out waiting for idle: ${id} ${state?.status}`);
};
const movesReady = (entries) => entries.map((x) => x.item).filter((x) => x?.type === 'plugin' && x.kind === 'flowly-next-moves' && x.data?.status === 'ready');
const waitReadyMove = async (agentId, timeout = 90000) => {
  const deadline = Date.now() + timeout;
  let row;
  do { row = movesReady(await timeline(agentId)).at(-1); if (row?.data?.moves?.some((move) => move.moveTo === 'done')) return row; await sleep(500); } while (Date.now() < deadline);
  return null;
};
const donePrompt = 'No file edits. Use flowly_update_status to deliver this card to in_review with a short note and exactly [{label:"Move to Done", moveTo:"done"}] as nextMoves. Set acknowledgeOpen:true only if required. Do not move the card to Done yourself.';

async function createCard(slot, initialPrompt = donePrompt) {
  const ids = JSON.parse(await readFile(sourceIds, 'utf8'));
  const title = `[test] native session round 3 ${slot} ${randomUUID().slice(0, 8)}`;
  const card = await rpc('tasks.create', {
    projectId: ids.project.id,
    operationId: `native-session-r3-${slot}-${randomUUID()}`,
    mode: 'directory', status: 'todo', priority: 'normal', title,
    description: `Round 3 D7 fixture ${slot}. No source file edits; owned temporary workspace.`,
  });
  ev.fixtures ??= {};
  ev.fixtures[slot] = { cardId: card.id, projectId: ids.project.id, workspaceId: card.workspaceId, title, mode: 'directory', createdAt: new Date().toISOString() };
  await save();
  await log(`card-${slot}-created`, ev.fixtures[slot]);
  const prepared = await rpc('tools.prepare-session', { id: card.id, operationId: `native-session-r3-${slot}-managed-${randomUUID()}` });
  ev.fixtures[slot].managedAgentId = prepared.agentId;
  await save();
  const agent = await api.workspaces.ref(card.workspaceId).agents.create({
    agentId: prepared.agentId,
    idempotencyKey: `ultra-kanban-session:${prepared.agentId}`,
    title: `[test] native session round 3 ${slot}`,
    labels: { 'flowly-task': card.id },
    config: { provider: model, modeId: 'bypassPermissions', systemPrompt: prepared.instructions, mcpServers: { 'ultra-kanban': prepared.mcp } },
    env: { ULTRA_KANBAN_CONTEXT_FILE: prepared.contextFile, ULTRA_KANBAN_CLI: prepared.cliPath, ULTRA_KANBAN_SKILL: prepared.skillPath },
    prompt: initialPrompt,
  });
  ev.fixtures[slot].managedAgentId = agent.id;
  await save();
  await log(`session-${slot}-created`, { agentId: agent.id, model, modeId: 'bypassPermissions' });
  await waitIdle(agent.id);
  const row = await waitReadyMove(agent.id);
  ev.fixtures[slot].moveRowId = row?.id ?? null;
  ev.fixtures[slot].eventId = row?.data?.eventId ?? null;
  ev.fixtures[slot].moves = row?.data?.moves ?? [];
  await log(`move-${slot}-ready`, { row, task: (await rpc('board.read', {})).tasks.find((x) => x.id === card.id) ?? null });
  if (!row) throw new Error(`Move to Done row not ready for fixture ${slot}`);
  return ev.fixtures[slot];
}

const mode = process.argv[2] ?? 'setup-a';
try {
  await client.connect();
  if (mode === 'setup-a') {
    if (ev.fixtures?.a?.cardId) throw new Error(`Fixture A already exists: ${ev.fixtures.a.cardId}`);
    const before = JSON.parse(await readFile(new URL('./settings-before.json', import.meta.url), 'utf8')).settings;
    const current = await rpc('sessions.native-chips', {});
    if (current.autoWrapup !== before.autoWrapup || current.nextMoveTap !== before.nextMoveTap) throw new Error(`Current settings do not match recorded baseline: ${JSON.stringify({ current, before })}`);
    const fixture = await createCard('a');
    const entries = await timeline(fixture.managedAgentId);
    await log('fixture-a-initialized', { managedAgentId: fixture.managedAgentId, readyMoveRow: movesReady(entries).at(-1) ?? null, autoWrapupAtSetup: current.autoWrapup, nextMoveTapAtSetup: current.nextMoveTap });
  } else if (mode === 'reopen-a') {
    const f = ev.fixtures?.a;
    if (!f?.managedAgentId) throw new Error('Fixture A is missing');
    const task = (await rpc('board.read', {})).tasks.find((x) => x.id === f.cardId);
    const updated = await rpc('tasks.update', { id: task.id, revision: task.revision, status: 'development' });
    await log('fixture-a-reopened', { before: task.status, after: updated.status, revision: updated.revision });
    await waitIdle(f.managedAgentId);
    const previousRowId = f.moveRowId;
    const turn = await api.agents.ref(f.managedAgentId).run(donePrompt);
    await waitIdle(f.managedAgentId);
    let row = null; const deadline = Date.now() + 60000;
    while (!row && Date.now() < deadline) {
      row = movesReady(await timeline(f.managedAgentId)).find((x) => x.id !== previousRowId && x.data?.moves?.some((move) => move.moveTo === 'done')) ?? null;
      if (!row) await sleep(500);
    }
    f.secondMoveRowId = row?.id ?? null;
    f.secondEventId = row?.data?.eventId ?? null;
    await log('fixture-a-second-move-ready', { turnStatus: turn.status, row, task: (await rpc('board.read', {})).tasks.find((x) => x.id === f.cardId) ?? null });
    if (!row) throw new Error('Second Move to Done row not ready for fixture A');
  } else if (mode === 'record-current-a') {
    const f = ev.fixtures?.a;
    if (!f?.managedAgentId) throw new Error('Fixture A is missing');
    const entries = await timeline(f.managedAgentId);
    const rows = entries.map((x) => x.item).filter((x) => x?.type === 'plugin' && x.kind === 'flowly-next-moves');
    const row = rows.find((x) => x.id !== f.moveRowId && x.data?.status === 'ready' && x.data?.moves?.some((move) => move.moveTo === 'done')) ?? null;
    f.secondMoveRowId = row?.id ?? null; f.secondEventId = row?.data?.eventId ?? null;
    await log('fixture-a-second-move-readback', { rows, selected: row });
    if (!row) throw new Error('Second Move to Done row not found for fixture A');
  } else if (mode === 'setup-b') {
    if (ev.fixtures?.b?.cardId) throw new Error(`Fixture B already exists: ${ev.fixtures.b.cardId}`);
    await createCard('b');
  } else if (mode === 'cleanup') {
    for (const [slot, f] of Object.entries(ev.fixtures ?? {})) {
      if (!f?.cardId) continue;
      const task = (await rpc('board.read', {})).tasks.find((x) => x.id === f.cardId);
      if (task) await log(`cleanup-${slot}-delete`, await rpc('tasks.delete', { id: task.id, revision: task.revision, archive: true, acknowledgeWarnings: true }));
    }
    await sleep(2500);
    const board = await rpc('board.read', {});
    const checks = {};
    for (const [slot, f] of Object.entries(ev.fixtures ?? {})) {
      const session = f.managedAgentId ? await snap(f.managedAgentId) : null;
      const workspaceRows = execFileSync('paseo', ['workspace', 'ls'], { encoding: 'utf8' });
      checks[slot] = { cardAbsent: !board.tasks.some((x) => x.id === f.cardId), sessionArchived: !!session?.archivedAt, sessionStatus: session?.status, workspaceAbsent: !workspaceRows.includes(f.workspaceId) };
    }
    await log('cleanup-verify', checks);
  } else throw new Error(`Unknown mode: ${mode}`);
} catch (error) {
  await log('error', { mode, message: String(error?.stack ?? error) });
  process.exitCode = 1;
} finally {
  ev.updatedAt = new Date().toISOString();
  await save();
  await api.dispose().catch(() => {});
  await client.close().catch(() => {});
}
