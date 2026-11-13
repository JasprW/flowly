import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile as exec } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DaemonClient } from '@getpaseo/client/internal/daemon-client';
import { createPaseoApi } from '@getpaseo/client';
const run = promisify(exec), out = new URL('./', import.meta.url).pathname;
const file = join(out, 'live-ids.json');
let state = existsSync(file) ? JSON.parse(await readFile(file, 'utf8')) : { title: 'Review status QA 20261113-503c', root: join(process.cwd(), '.auto-review-status-fixture-503c'), cards: [] };
const save = () => writeFile(file, JSON.stringify(state, null, 2));
const credential = (await readFile(join(homedir(), '.paseo/local-credential'), 'utf8')).trim();
const client = new DaemonClient({ url: 'ws://127.0.0.1:6767/ws', localCredential: () => credential, clientId: `review-status-qa-${randomUUID()}`, clientType: 'cli', reconnect: { enabled: false }, connectTimeoutMs: 10000 });
await client.connect();
const api = createPaseoApi(client), rpc = (name, input = {}) => client.invokePluginRpc('flowly', name, input);
const board = () => rpc('board.read');
const cli = async (c, args) => {
  const result = await run(process.execPath, [c.cliPath, '--context-file', c.contextFile, ...args], { env: { ...process.env, PASEO_AGENT_ID: c.agentId }, maxBuffer: 5e6 });
  return JSON.parse(result.stdout);
};
async function action(c, args) {
  const request = join(state.root, `request-${c.id}.json`);
  const current = await cli(c, ['current', '--save-request', request]);
  const result = await cli(c, [...args, '--request-file', request]);
  return result;
}
try {
  const mode = process.argv[2];
  if (mode === 'setup') {
    if (state.projectId) throw new Error('Fixture already exists; use status/cleanup');
    await mkdir(state.root, { recursive: false }); await save();
    await writeFile(join(state.root, 'README.md'), '# Review status disposable fixture\n');
    await run('git', ['init', state.root]);
    await run('git', ['-C', state.root, 'add', 'README.md']);
    await run('git', ['-C', state.root, '-c', 'core.hooksPath=/dev/null', '-c', 'user.name=Flowly QA', '-c', 'user.email=qa@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture']);
    const project = await rpc('projects.create', { title: state.title, primaryPath: state.root });
    state.projectId = project.id; state.nativeProjectId = project.paseoProjectId; await save();
    await rpc('projects.update', { id: project.id, revision: project.revision, autoReview: { enabled: true, maxRounds: 1 }, memory: false, workflowInsights: false });
    const code = "const fs=require('node:fs');const gate=" + JSON.stringify(join(state.root, 'release')) + ";console.log('QA command running');const t=setInterval(()=>{if(fs.existsSync(gate)){clearInterval(t);process.exit(0)}},250);setTimeout(()=>process.exit(0),240000);";
    const guard = await rpc('guardrails.create', { projectId: project.id, kind: 'command', text: 'QA controlled check', argv: [process.execPath, '-e', code], timeoutSec: 300 });
    state.guardrailId = guard.id; await save();
    for (const key of ['Queue blocker', 'Waiting review']) {
      const task = await rpc('tasks.create', { projectId: project.id, operationId: `review-status-qa-${randomUUID()}`, title: key, description: 'Disposable UI verification card. No implementation work.', status: 'test', type: 'chore', tags: ['testing'], mode: 'directory' });
      const c = { id: task.id, workspaceId: task.workspaceId, title: key }; state.cards.push(c); await save();
      const prep = await rpc('tools.prepare-session', { id: task.id, operationId: `review-status-qa-${randomUUID()}` });
      c.agentId = prep.agentId; c.contextFile = prep.contextFile; c.cliPath = prep.cliPath; await save();
      const agent = await api.workspaces.ref(task.workspaceId).agents.create({ agentId: prep.agentId, idempotencyKey: prep.agentId, title: `QA ${key}`, config: { provider: 'claude/claude-haiku-5-5', modeId: 'bypassPermissions', systemPrompt: prep.instructions }, labels: { 'flowly-qa': 'review-status-503c' } });
      await agent.refresh();
      const ctx = await cli(c, ['current']);
      await action(c, ['workpad', '--workpad-revision', String(ctx.workpad?.revision ?? 0), '--workpad', JSON.stringify({ acceptance: [{ text: 'Disposable status verification fixture', done: true }] })]);
    }
    console.log(JSON.stringify({ project: state.projectId, cards: state.cards.map(({ id, workspaceId, agentId }) => ({ id, workspaceId, agentId })) }));
  } else if (mode === 'deliver' || mode === 'redeliver') {
    for (const c of state.cards) {
      if (mode === 'redeliver') await action(c, ['status', 'test', '--note', 'QA redelivery to verify old result is hidden']);
      await action(c, ['status', 'in_review', '--note', 'QA disposable delivery', '--no-outputs', '--no-moves']);
    }
  } else if (mode === 'rerun') {
    await rpc('reviews.rerun', { taskId: state.cards[1].id });
  } else if (mode === 'release') {
    await writeFile(join(state.root, 'release'), 'release');
  } else if (mode === 'status') {
    const b = await board();
    console.log(JSON.stringify(b.tasks.filter(t => state.cards.some(c => c.id === t.id)).map(({ id, status, reviewWaiting, review }) => ({ id, status, waiting: !!reviewWaiting, review: review && { state: review.state, reason: review.reason, items: review.items?.map(i => ({ name:i.name, state:i.state })) } })), null, 2));
  } else if (mode === 'cleanup') {
    if (existsSync(state.root)) await writeFile(join(state.root, 'release'), 'release');
    for (const c of state.cards) {
      if (c.agentId) await client.deleteAgent(c.agentId).catch(e => console.log('agent cleanup', c.agentId, e.message));
    }
    const b = await board();
    const p = b.projects.find(p => p.id === state.projectId);
    if (p) {
      const result = await rpc('projects.remove', { id: p.id, revision: p.revision, alsoPaseo: true });
      if (result.paseo && !result.paseo.removed) throw new Error('Native project removal failed: ' + result.paseo.error);
    }
    const after = await board();
    const projects = await client.listProjects();
    const workspaces = await api.workspaces.list({ filter: { projectId: state.nativeProjectId, includeInternal: true, includeBackground: true }, includeBackground: true, page: { limit: 100 } });
    const agents = await client.fetchAgents({ filter: { labels: { 'flowly-qa': 'review-status-503c' }, includeArchived: true, includeBackground: true }, includeBackground: true, page: { limit: 100 } });
    const remains = { nativeAgents: agents.entries.map(e => e.agent?.id ?? e.id), boardProject: after.projects.some(p => p.id === state.projectId), boardCards: after.tasks.filter(t => state.cards.some(c => c.id === t.id)).map(t => t.id), nativeProject: JSON.stringify(projects).includes(state.nativeProjectId), nativeWorkspaces: workspaces.entries.filter(w => state.cards.some(c => c.workspaceId === w.id)).map(w => w.id) };
    state.cleanup = { at: new Date().toISOString(), ...remains }; await save();
    if (remains.nativeAgents.length || remains.boardProject || remains.boardCards.length || remains.nativeProject || remains.nativeWorkspaces.length) throw new Error('Fixture resources remain: ' + JSON.stringify(remains));
    await rm(state.root, { recursive: true, force: true }); console.log('cleanup verified', JSON.stringify(remains));
  }
} finally { await api.dispose().catch(() => {}); await client.close().catch(() => {}); }
