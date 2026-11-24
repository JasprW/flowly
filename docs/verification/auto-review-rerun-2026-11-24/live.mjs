// Live check of AUTO-REVIEW-SPEC §3.5 on the Tinylink fixture: one temporary card, removed by `cleanup`.
// Tinylink's Auto review settings are changed for the run and restored by `cleanup` (original values in the state file).
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
const file = join(repo, '.test-data/ar-rerun-live-state.json');
const scratch = join(repo, '.test-data/ar-rerun-live');
const gate = join(scratch, 'pass');
const LABEL = 'ar-rerun-20261124';
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
const view = (t, b) => t && ({ status: t.status, revision: t.revision, waiting: t.reviewWaiting ? t.reviewWaiting.eventId : null, review: t.review && { state: t.review.state, round: t.review.round, startedAt: t.review.startedAt, finishedAt: t.review.finishedAt, handledAt: t.review.handledAt ?? null, items: t.review.items?.map((i) => `${i.name}:${i.state}`) }, dismissal: b?.attentionDismissals?.find((d) => d.taskId === t.id)?.signals ?? null, lastEvents: b?.events.filter((e) => e.taskId === t.id).slice(-4).map((e) => `${e.actor}/${e.action}${e.rule ? '/' + e.rule : ''}${e.from ? ` ${e.from}->${e.to}` : ''}${e.note ? ' · ' + e.note.slice(0, 60) : ''}`) });
const show = async (tag) => { const b = await board(); const out = { tag, at: new Date().toISOString(), attentionCount: (await rpc('attention.count')).count, card: view(b.tasks.find((t) => t.id === state.card.id), b) }; console.log(JSON.stringify(out, null, 1)); (state.log ??= []).push(out); await save(); return out; };
async function until(test, what, ms = 240000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const t = await card(); if (test(t)) return t; await new Promise((r) => setTimeout(r, 1500)); }
  throw new Error('Timed out waiting for ' + what);
}
try {
  const mode = process.argv[2];
  if (mode === 'setup') {
    // Any record left by an earlier run (even a partial setup) is kept until its cleanup is verified.
    if (Object.keys(state).length && !state.cleanup?.verified) throw new Error('Earlier fixture state is not cleaned up; run cleanup first');
    state = {};
    await mkdir(scratch, { recursive: true });
    const b = await board();
    const p = b.projects.find((p) => p.title === 'Tinylink' && !p.archivedAt);
    const before = await rpc('guardrails.read', { projectId: p.id });
    state.project = { id: p.id, paseo: p.paseoProjectId, original: p.autoReview, originalGuardrails: (before.value?.entries || []).map((e) => e.id) }; await save();
    const updated = await rpc('projects.update', { id: p.id, revision: p.revision, autoReview: { ...p.autoReview, enabled: true, maxRounds: 0 } });
    state.project.changed = true; await save();
    const code = `process.exit(require('node:fs').existsSync(${JSON.stringify(gate)})?0:1)`;
    const guard = await rpc('guardrails.create', { projectId: p.id, kind: 'command', text: 'QA gate (temporary)', argv: [process.execPath, '-e', code], timeoutSec: 60 });
    state.guardrail = { id: guard.id }; await save();
    const task = await rpc('tasks.create', { projectId: p.id, operationId: `${LABEL}-${randomUUID()}`, title: 'QA review rerun (temporary)', description: 'Disposable verification card for AUTO-REVIEW-SPEC §3.5. No implementation work; it is deleted after the test.', status: 'test', type: 'chore', tags: ['testing'], mode: 'directory' });
    state.card = { id: task.id, workspaceId: task.workspaceId }; await save();
    const prep = await rpc('tools.prepare-session', { id: task.id, operationId: `${LABEL}-${randomUUID()}` });
    Object.assign(state.card, { agentId: prep.agentId, contextFile: prep.contextFile, cliPath: prep.cliPath }); await save();
    const agent = await api.workspaces.ref(task.workspaceId).agents.create({ agentId: prep.agentId, idempotencyKey: prep.agentId, title: 'QA review rerun', config: { provider: 'claude/claude-haiku-5-5', modeId: 'bypassPermissions', systemPrompt: prep.instructions }, labels: { 'flowly-qa': LABEL } });
    await agent.refresh();
    const ctx = await cli(['current']);
    await action(['workpad', '--workpad-revision', String(ctx.workpad?.revision ?? 0), '--workpad', JSON.stringify({ acceptance: [{ text: 'Disposable verification fixture', done: true }] })]);
    console.log(JSON.stringify({ project: p.id, autoReview: updated.autoReview, guardrail: guard.id, card: state.card.id, workspace: task.workspaceId, agent: prep.agentId }));
  } else if (mode === 'deliver') {
    await action(['status', 'in_review', '--note', 'QA disposable delivery', '--no-outputs', '--no-moves']);
    await show('delivered');
    await until((t) => t.status === 'blocked' && t.review?.state === 'failed', 'Blocked + failed');
    await show('failed-to-blocked');
  } else if (mode === 'rerun') {
    const before = await card();
    await rpc('reviews.rerun', { taskId: state.card.id });
    await show('rerun-accepted');
    const t = await until((t) => !t.reviewWaiting && t.review && t.review.startedAt !== before.review.startedAt && t.review.state !== 'running', 'rerun finished');
    await show(`rerun-finished-${t.review.state}`);
  } else if (mode === 'rerun-refused') {
    const before = JSON.stringify(view(await card()));
    const err = await rpc('reviews.rerun', { taskId: state.card.id }).then(() => null, (e) => e.message);
    const after = JSON.stringify(view(await card()));
    console.log(JSON.stringify({ refused: err, unchanged: before === after }));
  } else if (mode === 'message') {
    await api.agents.ref(state.card.agentId).send(process.argv[3] || 'Reply with the single word OK. Do not call any tools and do not report to Kanban.');
    await show('message-sent');
    await new Promise((r) => setTimeout(r, 3000));
    const end = Date.now() + 180000;
    for (;;) {
      const a = (await client.fetchAgents({ filter: { labels: { 'flowly-qa': LABEL } }, page: { limit: 10 } })).entries.map((e) => e.agent ?? e).find((a) => a.id === state.card.agentId);
      if (a && a.status !== 'running') break;
      if (Date.now() > end) throw new Error('turn did not end');
      await new Promise((r) => setTimeout(r, 1500));
    }
    await new Promise((r) => setTimeout(r, 2500));
    await show('turn-ended');
  } else if (mode === "codex") {
    const prep = await rpc("tools.prepare-session", { id: state.card.id, operationId: `${LABEL}-${randomUUID()}` });
    (state.card.extraAgents ??= []).push(state.card.agentId);
    Object.assign(state.card, { agentId: prep.agentId, contextFile: prep.contextFile, cliPath: prep.cliPath }); await save();
    const agent = await api.workspaces.ref(state.card.workspaceId).agents.create({ agentId: prep.agentId, idempotencyKey: prep.agentId, title: "QA review rerun codex", config: { provider: "codex/gpt-6-luna", modeId: "full-access", thinkingOptionId: "low", systemPrompt: prep.instructions }, labels: { "flowly-qa": LABEL } });
    await agent.refresh();
    console.log("codex session", prep.agentId);
  } else if (mode === "gate") {
    await writeFile(gate, 'pass');
    console.log('gate open');
  } else if (mode === 'status') {
    await show(process.argv[3] || 'status');
  } else if (mode === 'cleanup') {
    const remains = {};
    for (const id of [state.card?.agentId, ...(state.card?.extraAgents || [])].filter(Boolean)) await client.deleteAgent(id).catch((e) => console.log("agent cleanup", id, e.message));
    let b = await board();
    const t = state.card && b.tasks.find((t) => t.id === state.card.id);
    if (t) {
      const r = await rpc('tasks.delete', { id: t.id, revision: t.revision, archive: true, acknowledgeWarnings: true });
      console.log('deleted card', JSON.stringify(r));
    }
    if (state.guardrail) {
      const g = await rpc("guardrails.read", { projectId: state.project.id });
      for (const id of [state.guardrail.id, ...(state.extraGuardrails || [])]) {
        const e = g.value?.entries?.find((e) => e.id === id);
        if (e) await rpc("guardrails.delete", { id: e.id, revision: e.revision });
      }
    }
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
      guardrail: (g.value?.entries || []).map((e) => e.id),
      autoReview: b.projects.find((p) => p.id === state.project.id).autoReview,
      nativeAgents: agents.entries.map((e) => (e.agent ?? e).id),
      activeWorkspace: ws.entries.filter((w) => w.id === state.card?.workspaceId && !w.archivedAt).map((w) => w.id),
      tinylinkCards: b.tasks.filter((t) => t.projectId === state.project.id && !t.archivedAt).length,
    });
    state.cleanup = { at: new Date().toISOString(), ...remains }; await save();
    console.log(JSON.stringify(remains, null, 1));
    const restored = JSON.stringify(remains.autoReview) === JSON.stringify(state.project.original);
    if (remains.card || remains.dismissal || remains.guardrail.some((id) => !(state.project.originalGuardrails || []).includes(id)) || !restored || remains.nativeAgents.length || remains.activeWorkspace.length) throw new Error('Fixture resources remain');
    await rm(scratch, { recursive: true, force: true });
    state.cleanup.verified = true; await save();
    console.log('cleanup verified');
  } else throw new Error('mode?');
} finally { await api.dispose().catch(() => {}); await client.close().catch(() => {}); }
