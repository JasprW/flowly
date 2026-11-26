// Live check of AUTO-REVIEW-SPEC §3.2 (needs_user) and §3.6 (A1/A1r keeps the result) on the Tinylink fixture.
// One temporary card and one temporary session, removed by `cleanup`; Tinylink's Auto review settings are changed for
// the run and restored by `cleanup` (original values in the state file).
// Modes: setup | deliver | cancel [sleepSeconds] | status [tag] | cleanup
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile as exec } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { DaemonClient } from '@getpaseo/client/internal/daemon-client';
import { createPaseoApi } from '@getpaseo/client';
const run = promisify(exec);
const repo = new URL('../../../', import.meta.url).pathname;
const file = join(repo, '.test-data/ar-convergence-live-state.json');
const scratch = join(repo, '.test-data/ar-convergence-live');
const LABEL = 'ar-convergence-20261126';
export const TITLE = 'QA review needs you (temporary)';
let state = existsSync(file) ? JSON.parse(await readFile(file, 'utf8')) : {};
const save = async () => { await mkdir(dirname(file), { recursive: true }); await writeFile(file, JSON.stringify(state, null, 2), { mode: 0o600 }); };
const credential = (await readFile(join(homedir(), '.paseo/local-credential'), 'utf8')).trim();
const client = new DaemonClient({ url: 'ws://127.0.0.1:6767/ws', localCredential: () => credential, clientId: `${LABEL}-${randomUUID()}`, clientType: 'cli', reconnect: { enabled: false }, connectTimeoutMs: 10000 });
await client.connect();
const api = createPaseoApi(client), rpc = (name, input = {}) => client.invokePluginRpc('flowly', name, input);
const board = () => rpc('board.read');
const cli = async (args) => {
  const c = state.card;
  const r = await run(process.execPath, [c.cliPath, '--context-file', c.contextFile, ...args], { env: { ...process.env, PASEO_AGENT_ID: c.agentId }, maxBuffer: 5e6 });
  return JSON.parse(r.stdout);
};
const action = async (args) => { const req = join(scratch, 'request.json'); await cli(['current', '--save-request', req]); return cli([...args, '--request-file', req]); };
const card = async () => (await board()).tasks.find((t) => t.id === state.card.id);
const view = (t, b) => t && ({
  status: t.status,
  reviewCount: t.reviewCount ?? 0,
  waiting: t.reviewWaiting ? t.reviewWaiting.eventId : null,
  review: t.review && { state: t.review.state, held: t.review.held ?? false, round: t.review.round, reason: t.review.reason ?? null, startedAt: t.review.startedAt, finishedAt: t.review.finishedAt ?? null, fingerprint: t.review.fingerprint ?? null, items: t.review.items?.map((i) => `${i.name}:${i.state}${i.severity ? '/' + i.severity : ''}`) },
  lastEvents: b?.events.filter((e) => e.taskId === t.id).slice(-6).map((e) => `${e.actor}/${e.action}${e.from ? ` ${e.from}->${e.to}` : ''}${e.note ? ' · ' + e.note.slice(0, 90) : ''}`),
});
const show = async (tag) => { const b = await board(); const out = { tag, at: new Date().toISOString(), attentionCount: (await rpc('attention.count')).count, card: view(b.tasks.find((t) => t.id === state.card.id), b) }; console.log(JSON.stringify(out, null, 1)); (state.log ??= []).push(out); await save(); return out; };
const key = (t) => `${t?.status}|${t?.review?.state}|${t?.review?.held ?? false}|${t?.review?.startedAt}`;
/** Polls the card and logs every distinct (status, review state, held) until `test` holds. */
async function watch(test, what, ms = 600000) {
  const end = Date.now() + ms;
  let last = '';
  while (Date.now() < end) {
    const t = await card();
    if (key(t) !== last) { last = key(t); await show(`seen ${last}`); }
    if (test(t)) return t;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('Timed out waiting for ' + what);
}
const agentStatus = async () => (await client.fetchAgents({ filter: { labels: { 'flowly-qa': LABEL } }, page: { limit: 10 } })).entries.map((e) => e.agent ?? e).find((a) => a.id === state.card.agentId)?.status;
const NOTE = 'Nothing in this repository can rotate the key: it has to be done in the hosting provider\'s dashboard, which only the owner can sign in to. No files were changed.';
try {
  const mode = process.argv[2];
  if (mode === 'setup') {
    if (Object.keys(state).length && !state.cleanup?.verified) throw new Error('Earlier fixture state is not cleaned up; run cleanup first');
    state = {};
    await mkdir(scratch, { recursive: true });
    const b = await board();
    const p = b.projects.find((p) => p.title === 'Tinylink' && !p.archivedAt);
    const before = await rpc('guardrails.read', { projectId: p.id });
    state.project = { id: p.id, paseo: p.paseoProjectId, original: p.autoReview, originalGuardrails: (before.value?.entries || []).map((e) => e.id) }; await save();
    const updated = await rpc('projects.update', { id: p.id, revision: p.revision, autoReview: { ...p.autoReview, enabled: true } });
    state.project.changed = true; await save();
    const task = await rpc('tasks.create', {
      projectId: p.id, operationId: `${LABEL}-${randomUUID()}`, title: TITLE, status: 'development', type: 'chore', tags: ['testing'], mode: 'directory',
      description: 'Rotate the Tinylink production API key in the hosting provider\'s dashboard (only the repository owner can sign in to that account) and confirm here when it is done. Disposable verification card for AUTO-REVIEW-SPEC §3.2; it is deleted after the test.',
    });
    state.card = { id: task.id, workspaceId: task.workspaceId }; await save();
    const prep = await rpc('tools.prepare-session', { id: task.id, operationId: `${LABEL}-${randomUUID()}` });
    Object.assign(state.card, { agentId: prep.agentId, contextFile: prep.contextFile, cliPath: prep.cliPath }); await save();
    const agent = await api.workspaces.ref(task.workspaceId).agents.create({ agentId: prep.agentId, idempotencyKey: prep.agentId, title: 'QA review needs you', config: { provider: 'codex/gpt-6-luna', modeId: 'full-access', thinkingOptionId: 'low', systemPrompt: prep.instructions }, labels: { 'flowly-qa': LABEL } });
    await agent.refresh();
    const ctx = await cli(['current']);
    await action(['workpad', '--workpad-revision', String(ctx.workpad?.revision ?? 0), '--workpad', JSON.stringify({ acceptance: [{ text: 'The production API key is rotated', done: false }] })]);
    console.log(JSON.stringify({ project: p.id, autoReview: updated.autoReview, card: state.card.id, workspace: task.workspaceId, agent: prep.agentId }));
  } else if (mode === 'deliver') {
    await action(['status', 'in_review', '--note', NOTE, '--no-outputs', '--no-moves']);
    await show('delivered');
    await watch((t) => !t.reviewWaiting && t.review && t.review.state !== 'running', 'review finished');
    await show('review-finished');
  } else if (mode === 'cancel') {
    // Deliver, wait until the review runs, then a person's message (A1). The turn runs `sleep N` so that, with a long
    // enough N, the review finishes while the card is out of In review (held) and A1r then applies it.
    const sleep = Number(process.argv[3] || 0);
    // A delivery while the card is already In review only records a note; the agent first moves it back to work.
    if ((await card()).status === 'in_review') await action(['status', 'development', '--note', 'Checking the delivery again']);
    const before = await card();
    await action(['status', 'in_review', '--note', NOTE, '--no-outputs', '--no-moves']);
    await show('delivered');
    await watch((t) => t.review && t.review.startedAt !== before.review?.startedAt && t.review.state === 'running', 'review running', 120000);
    const text = sleep
      ? `Run the shell command \`sleep ${sleep}\`, then reply with the single word OK. Do not change any files and do not report to Kanban.`
      : 'Reply with the single word OK. Do not call any tools and do not report to Kanban.';
    await api.agents.ref(state.card.agentId).send(text);
    await show('message-sent');
    const started = Date.now();
    let turnEnded = false;
    const end = Date.now() + 900000;
    let last = '';
    for (;;) {
      const t = await card();
      if (key(t) !== last) { last = key(t); await show(`seen ${last}`); }
      if (!turnEnded && Date.now() - started > 3000 && (await agentStatus()) !== 'running') { turnEnded = true; await show('turn-ended'); }
      if (turnEnded && t.review?.state !== 'running' && !t.review?.held) break;
      if (Date.now() > end) throw new Error('cancel did not settle');
      await new Promise((r) => setTimeout(r, 1000));
    }
    await new Promise((r) => setTimeout(r, 3000));
    await show('settled');
  } else if (mode === 'move') {
    // A person drags the card out of In review while its review runs: the review stops at once (no result).
    if ((await card()).status === 'in_review') await action(['status', 'development', '--note', 'Checking the delivery again']);
    const before = await card();
    await action(['status', 'in_review', '--note', NOTE, '--no-outputs', '--no-moves']);
    const t = await watch((t) => t.review && t.review.startedAt !== before.review?.startedAt && t.review.state === 'running', 'review running', 120000);
    const movedAt = Date.now();
    await rpc('tasks.place', { id: t.id, revision: t.revision, status: 'development', beforeId: null, afterId: null });
    await show('moved-by-person');
    const done = await watch((t) => t.review?.state !== 'running', 'review stopped', 60000);
    const agents = await client.fetchAgents({ filter: { labels: { 'flowly-review': '1', 'flowly-task': state.card.id }, includeBackground: true }, includeBackground: true, page: { limit: 20 } });
    await show(`stopped-after-${Date.now() - movedAt}ms`);
    console.log(JSON.stringify({ state: done.review.state, reason: done.review.reason, reviewAgentsLeft: agents.entries.map((e) => ({ id: (e.agent ?? e).id, status: (e.agent ?? e).status, archived: Boolean((e.agent ?? e).archivedAt) })) }));
  } else if (mode === 'status') {
    await show(process.argv[3] || 'status');
  } else if (mode === 'cleanup') {
    const remains = {};
    for (const id of [state.card?.agentId].filter(Boolean)) await client.deleteAgent(id).catch((e) => console.log('agent cleanup', id, e.message));
    let b = await board();
    const t = state.card && b.tasks.find((t) => t.id === state.card.id);
    if (t) console.log('deleted card', JSON.stringify(await rpc('tasks.delete', { id: t.id, revision: t.revision, archive: true, acknowledgeWarnings: true })));
    b = await board();
    const p = b.projects.find((p) => p.id === state.project.id);
    if (state.project?.changed) await rpc('projects.update', { id: p.id, revision: p.revision, autoReview: state.project.original });
    b = await board();
    const g = await rpc('guardrails.read', { projectId: state.project.id });
    const agents = await client.fetchAgents({ filter: { labels: { 'flowly-qa': LABEL }, includeArchived: true, includeBackground: true }, includeBackground: true, page: { limit: 50 } });
    const ws = await api.workspaces.list({ filter: { projectId: state.project.paseo, includeInternal: true }, page: { limit: 200 } });
    Object.assign(remains, {
      card: b.tasks.some((t) => t.id === state.card?.id),
      dismissal: (b.attentionDismissals || []).some((d) => d.taskId === state.card?.id),
      // Guardrails added since setup (e.g. the Tests command Auto review detects when it is switched on) are listed for a
      // person to check; this script created none.
      addedGuardrails: (g.value?.entries || []).filter((e) => !(state.project.originalGuardrails || []).includes(e.id)).map((e) => `${e.id} ${e.kind} ${e.text}`),
      autoReview: b.projects.find((p) => p.id === state.project.id).autoReview,
      nativeAgents: agents.entries.map((e) => (e.agent ?? e).id),
      activeWorkspace: ws.entries.filter((w) => w.id === state.card?.workspaceId && !w.archivedAt).map((w) => w.id),
      tinylinkCards: b.tasks.filter((t) => t.projectId === state.project.id && !t.archivedAt).length,
      // The old plugin code cannot read these review states; none may remain before it is reinstalled.
      newStatesOnBoard: b.tasks.filter((t) => t.review?.state === 'needs_user' || t.review?.held || t.review?.items?.some((i) => i.state === 'needs_user')).map((t) => t.id),
    });
    state.cleanup = { at: new Date().toISOString(), ...remains }; await save();
    console.log(JSON.stringify(remains, null, 1));
    const restored = JSON.stringify(remains.autoReview) === JSON.stringify(state.project.original);
    if (remains.card || remains.dismissal || !restored || remains.nativeAgents.length || remains.activeWorkspace.length) throw new Error('Fixture resources remain');
    await rm(scratch, { recursive: true, force: true });
    state.cleanup.verified = true; await save();
    console.log('cleanup verified');
  } else throw new Error('mode?');
} finally { await api.dispose().catch(() => {}); await client.close().catch(() => {}); }
