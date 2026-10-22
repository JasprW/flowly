// Live check for PROJECT-MEMORY-SPEC §4.0: a Claude session on a fresh Tinylink card asks through
// AskUserQuestion, the question is answered the way the card drawer answers it, and when the turn ends
// memory.json holds an `answer` clue with the question as `ask`. Based on ../native-question/run.mjs.
// Creates one card (own workspace) + one session, removes both in finally and checks the clues went too.
// Usage (repo root): node docs/verification/fixtures/memory-answer-clue/run.mjs [provider/model]
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { DaemonClient } from '@getpaseo/client/internal/daemon-client';
import { createPaseoApi } from '@getpaseo/client';

const model = process.argv[2] || 'claude/claude-sonnet-5-5';
const out = new URL('./evidence.json', import.meta.url);
const ids = JSON.parse(await readFile(new URL('../../../promo/ids.json', import.meta.url), 'utf8'));
const client = new DaemonClient({ url: 'ws://127.0.0.1:6767/ws', clientId: `mac-${randomUUID()}`, clientType: 'cli', appVersion: '0.11.2', connectTimeoutMs: 10000, reconnect: { enabled: false } });
const api = createPaseoApi(client);
const rpc = (m, i) => client.invokePluginRpc('flowly', m, i);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = { model, startedAt: new Date().toISOString(), steps: [] };
const log = (step, data) => { ev.steps.push({ at: new Date().toISOString(), step, ...data }); console.log(step, JSON.stringify(data)); };
const save = () => writeFile(out, JSON.stringify(ev, null, 2));
const cardEvents = async (id) => (await rpc('board.read', {})).events.filter((e) => e.taskId === id);
const snap = async (id) => (await api.agents.ref(id).refresh())?.agent;
// Read-only look at the plugin's memory data (clues are not exposed over RPC).
const memoryFile = join(process.env.FLOWLY_DATA_DIR || join(homedir(), '.paseo', 'plugin-data', 'flowly'), 'memory.json');
const cluesOf = async (taskId) => JSON.parse(await readFile(memoryFile, 'utf8')).clues.filter((c) => c.taskId === taskId);
let card, agentId;
try {
  await client.connect();
  card = await rpc('tasks.create', {
    projectId: ids.project.id, operationId: `mac-${randomUUID()}`, mode: 'directory', status: 'todo', priority: 'normal',
    title: '[test] Default short-code format',
    description: 'Decide the default format of new short codes before anything is built. Two independent decisions are the user\'s to make: the code length (6 or 8 characters) and the alphabet (base62, or base58 without look-alike characters such as 0/O and l/I). Do not edit any files: this card only records the decision. Once both are decided, report the result on the card.',
  });
  ev.card = { id: card.id, workspaceId: card.workspaceId }; await save();
  log('card-created', ev.card);
  const prep = await rpc('tools.prepare-session', { id: card.id, operationId: `mac-session-${randomUUID()}` });
  agentId = prep.agentId; ev.agentId = agentId; await save();
  await api.workspaces.ref(card.workspaceId).agents.create({
    agentId, idempotencyKey: `ultra-kanban-session:${agentId}`, title: '[test] memory answer clue',
    labels: { 'flowly-task': card.id },
    config: { provider: model, modeId: 'bypassPermissions', systemPrompt: prep.instructions, mcpServers: { flowly: prep.mcp } },
    env: { FLOWLY_CONTEXT_FILE: prep.contextFile, FLOWLY_CLI: prep.cliPath, FLOWLY_SKILL: prep.skillPath },
    prompt: 'Work on this card.',
  });
  log('session-created', { agentId });
  // Wait for a pending question, or for the turn to end without one.
  let a, q;
  for (let i = 0; i < 150; i++) {
    await sleep(2000);
    a = await snap(agentId);
    q = (a?.pendingPermissions || []).find((r) => r.kind === 'question');
    if (q) break;
    if (i > 5 && a?.status === 'idle') break;
  }
  const atAsk = await cardEvents(card.id);
  log('asked', {
    status: a?.status, pendingQuestion: !!q, request: q ? { id: q.id, name: q.name, questions: q.input?.questions } : null,
    // sessionAttention: permission && asksQuestion → question → card "Needs you" (client/card.tsx).
    attentionQuestion: !!q && a?.status !== undefined && !a?.archivedAt,
    kanbanQuestionReports: atAsk.filter((e) => e.actor === 'agent' && e.reportKind === 'question').length,
    turnStarts: atAsk.filter((e) => e.action === 'agent.turn_started').length,
    turnEnds: atAsk.filter((e) => e.action === 'agent.turn_ended').length,
    cardStatus: (await rpc('board.read', {})).tasks.find((t) => t.id === card.id)?.status,
  });
  await save();
  if (!q) throw new Error('No AskUserQuestion request appeared');
  // Same reply as the card drawer's form (shared/permission-question.ts answerReply): first option of each question.
  const answers = {};
  for (const x of q.input.questions) answers[x.header] = x.options[0].label;
  await api.agents.ref(agentId).respondToPermission({ requestId: q.id, response: { behavior: 'allow', updatedInput: { ...q.input, answers } } });
  log('answered', { answers });
  for (let i = 0; i < 150; i++) {
    await sleep(2000);
    a = await snap(agentId);
    const evs = await cardEvents(card.id);
    if (a?.status === 'idle' && evs.some((e) => e.action === 'agent.turn_ended')) break;
  }
  // recordTurn runs after the turn_ended hook returns; give it a moment.
  let clues = [];
  for (let i = 0; i < 15; i++) {
    await sleep(1000);
    clues = await cluesOf(card.id);
    if (clues.some((c) => c.kind === 'answer')) break;
  }
  log('clues', { clues: clues.map(({ kind, ask, text, id }) => ({ kind, ask, text, id })) });
  ev.answerClue = clues.some((c) => c.kind === 'answer' && c.ask && Object.values(answers).includes(c.text));
  log('check', { answerClueWithAsk: ev.answerClue });
  const end = await cardEvents(card.id);
  const tail = await rpc('sessions.tail', { taskId: card.id, agentId, limit: 20 }).catch((e) => ({ error: String(e) }));
  log('finished', {
    status: a?.status, pendingAfter: (a?.pendingPermissions || []).length,
    kanbanQuestionReports: end.filter((e) => e.actor === 'agent' && e.reportKind === 'question').length,
    turnStarts: end.filter((e) => e.action === 'agent.turn_started').length,
    turnEnds: end.filter((e) => e.action === 'agent.turn_ended').length,
    agentEvents: end.filter((e) => e.actor === 'agent').map((e) => ({ action: e.action, kind: e.reportKind, to: e.to, note: e.note?.slice(0, 300) })),
    lastText: (tail.entries || []).filter((x) => x.kind === 'assistant' || x.role === 'assistant').slice(-1)[0] ?? null,
  });
  await save();
} catch (e) {
  log('error', { message: String(e?.message || e) }); await save(); process.exitCode = 1;
} finally {
  try {
    if (card) {
      const t = (await rpc('board.read', {})).tasks.find((x) => x.id === card.id);
      if (t) log('cleanup-delete', await rpc('tasks.delete', { id: card.id, revision: t.revision, archive: true, acknowledgeWarnings: true }));
      const board = await rpc('board.read', {});
      const s = agentId ? await snap(agentId) : null;
      log('cleanup-verify', { cardOnBoard: board.tasks.some((x) => x.id === card.id), sessionArchived: !!s?.archivedAt, cluesLeft: (await cluesOf(card.id)).length });
    }
  } catch (e) { log('cleanup-error', { message: String(e?.message || e) }); process.exitCode = 1; }
  ev.endedAt = new Date().toISOString(); await save();
  await api.dispose().catch(() => {}); await client.close().catch(() => {});
}
