// Live check for PROJECT-MEMORY-SPEC §4.2: the finished-card review's child session is hard-deleted, not archived.
// Creates one Tinylink card (own workspace) + one Haiku session whose first message becomes a clue, moves the card
// to Done, runs **Find memories**, polls the native registry (archived included) for the review session by its labels,
// and checks it is gone afterwards. Removes the card and its session in finally.
// Usage (repo root): node docs/verification/fixtures/memory-retro-delete/run.mjs
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { DaemonClient } from '@getpaseo/client/internal/daemon-client';
import { createPaseoApi } from '@getpaseo/client';

const out = new URL('./evidence.json', import.meta.url);
const ids = JSON.parse(await readFile(new URL('../../../promo/ids.json', import.meta.url), 'utf8'));
const client = new DaemonClient({ url: 'ws://127.0.0.1:6767/ws', clientId: `mac-${randomUUID()}`, clientType: 'cli', appVersion: '0.11.2', connectTimeoutMs: 10000, reconnect: { enabled: false } });
const api = createPaseoApi(client);
const rpc = (m, i) => client.invokePluginRpc('flowly', m, i);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = { startedAt: new Date().toISOString(), steps: [] };
const log = (step, data) => { ev.steps.push({ at: new Date().toISOString(), step, ...data }); console.log(step, JSON.stringify(data)); };
const save = () => writeFile(out, JSON.stringify(ev, null, 2));
const memoryFile = join(process.env.FLOWLY_DATA_DIR || join(homedir(), '.paseo', 'plugin-data', 'flowly'), 'memory.json');
const memory = async () => JSON.parse(await readFile(memoryFile, 'utf8'));
// Every native session (archived included) carrying the review's labels for this card.
const reviewSessions = async (taskId) => {
  const found = [];
  let cursor;
  do {
    const page = await client.fetchAgents({ filter: { includeArchived: true, labels: { 'flowly-memory': 'retro', 'flowly-task': taskId } }, page: { limit: 200, cursor } });
    for (const e of page.entries) {
      const a = e.agent ?? e;
      if (a.labels?.['flowly-memory'] === 'retro' && a.labels?.['flowly-task'] === taskId) found.push({ id: a.id, status: a.status, archivedAt: a.archivedAt ?? null });
    }
    cursor = page.pageInfo?.nextCursor ?? undefined;
  } while (cursor);
  return found;
};
let card, agentId;
try {
  await client.connect();
  card = await rpc('tasks.create', {
    projectId: ids.project.id, operationId: `mac-${randomUUID()}`, mode: 'directory', status: 'todo', priority: 'normal',
    title: '[test] Review session hard delete',
    description: 'Fixture card. Do not edit files. Reply with one short sentence and end your turn.',
  });
  ev.card = { id: card.id, workspaceId: card.workspaceId }; await save();
  log('card-created', ev.card);
  const prep = await rpc('tools.prepare-session', { id: card.id, operationId: `mac-session-${randomUUID()}` });
  agentId = prep.agentId; ev.agentId = agentId; await save();
  await api.workspaces.ref(card.workspaceId).agents.create({
    agentId, idempotencyKey: `ultra-kanban-session:${agentId}`, title: '[test] review hard delete',
    labels: { 'flowly-task': card.id },
    config: { provider: 'claude/claude-haiku-5-5', modeId: 'bypassPermissions', systemPrompt: prep.instructions, mcpServers: { flowly: prep.mcp } },
    env: { FLOWLY_CONTEXT_FILE: prep.contextFile, FLOWLY_CLI: prep.cliPath, FLOWLY_SKILL: prep.skillPath },
    prompt: 'Decision for this project: short links never expire unless the owner sets an expiry. Acknowledge in one sentence; do not call any tools.',
  });
  log('session-created', { agentId });
  let clues = [];
  for (let i = 0; i < 90; i++) {
    await sleep(2000);
    clues = (await memory()).clues.filter((c) => c.taskId === card.id);
    const a = (await api.agents.ref(agentId).refresh())?.agent;
    if (a?.status === 'idle' && clues.length) break;
  }
  log('clues', { count: clues.length, kinds: clues.map((c) => c.kind) });
  if (!clues.length) throw new Error('No clue recorded; the review would have no material');
  const t = (await rpc('board.read', {})).tasks.find((x) => x.id === card.id);
  await rpc('tasks.update', { id: card.id, revision: t.revision, status: 'done' });
  log('moved-done', {});
  log('retro-queued', await rpc('memory.retro', { taskId: card.id }));
  const seen = new Map();
  let retro;
  for (let i = 0; i < 180; i++) {
    await sleep(1000);
    for (const s of await reviewSessions(card.id)) if (!seen.has(s.id)) { seen.set(s.id, s); log('review-session-seen', s); }
    const state = await memory();
    retro = state.retros.find((r) => r.taskId === card.id);
    const error = state.errors.find((e) => e.taskId === card.id);
    if (retro || error) { log('retro-finished', { retro: retro ?? null, error: error ?? null }); break; }
  }
  // finally { removeAgent } runs right after the output is read; give the delete a moment.
  let left = [];
  for (let i = 0; i < 10; i++) { await sleep(1000); left = await reviewSessions(card.id); if (!left.length) break; }
  ev.check = { reviewSessionsSeen: [...seen.keys()], leftAfterRun: left, hardDeleted: seen.size > 0 && left.length === 0 };
  log('check', ev.check);
  // The automatic review on entering Done waits 30 s and must skip (same material); confirm no second session.
  await sleep(40000);
  ev.check.afterAutoDelay = await reviewSessions(card.id);
  log('after-auto-delay', { sessions: ev.check.afterAutoDelay, retros: (await memory()).retros.filter((r) => r.taskId === card.id).length });
  await save();
} catch (e) {
  log('error', { message: String(e?.message || e) }); await save(); process.exitCode = 1;
} finally {
  try {
    if (card) {
      const state = await memory();
      const own = state.entries.filter((e) => e.source?.taskId === card.id && e.status !== 'deleted');
      for (const e of own) log('cleanup-memory', await rpc('memory.delete', { id: e.id, revision: e.revision }).catch((x) => ({ error: String(x) })));
      const t = (await rpc('board.read', {})).tasks.find((x) => x.id === card.id);
      if (t) log('cleanup-delete', await rpc('tasks.delete', { id: card.id, revision: t.revision, archive: true, acknowledgeWarnings: true }));
      const board = await rpc('board.read', {});
      const after = await memory();
      log('cleanup-verify', {
        cardOnBoard: board.tasks.some((x) => x.id === card.id),
        tinylinkCards: board.tasks.filter((x) => x.projectId === ids.project.id).length,
        sessionArchived: agentId ? !!(await api.agents.ref(agentId).refresh())?.agent?.archivedAt : null,
        cluesLeft: after.clues.filter((c) => c.taskId === card.id).length,
        entriesLeft: after.entries.filter((e) => e.source?.taskId === card.id).length,
        reviewSessionsLeft: (await reviewSessions(card.id)).length,
      });
    }
  } catch (e) { log('cleanup-error', { message: String(e?.message || e) }); process.exitCode = 1; }
  ev.endedAt = new Date().toISOString(); await save();
  await api.dispose().catch(() => {}); await client.close().catch(() => {});
}
