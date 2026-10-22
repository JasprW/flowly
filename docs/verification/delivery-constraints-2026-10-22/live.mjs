// Explicitly owned fixtures only; never edits the permanent Tinylink checkout or existing cards.
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { connect } from './connect.mjs';
const stateFile = new URL('./live-state.json', import.meta.url);
const root = '/Users/bofan.wang/Developer/personal/paseo-utlra-kanban';
const projectId = '3db2ad5b-e6c4-4054-b2ed-a13a8dfa0663';
const repo = 'JasprW/flowly-delivery-fixture-20261022-036d';
const parent = '036d5d2b-d2b0-4b54-9ef7-d80c04a0896f';
const save = (s) => writeFile(stateFile, JSON.stringify(s, null, 2) + '\n');
const x = await connect();
try {
  const command = process.argv[2];
  if (command === 'setup') {
    const existing = await readFile(stateFile, 'utf8').catch(() => null);
    if (existing) throw new Error('State exists: do not recreate fixtures.');
    const board = await x.rpc('board.read', {});
    const state = { startedAt: new Date().toISOString(), repo, retainRepo: true, projectId, sessions: [], cards: [], before: board.tasks.filter(t => t.projectId === projectId).map(t => ({ id: t.id, revision: t.revision, status: t.status, workspaceId: t.workspaceId })), sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: '/Users/bofan.wang/Developer/personal/flowly-test/tinylink', encoding: 'utf8' }).trim() };
    await save(state);
    // Independent Luna review owns only its evidence; it must not implement or rerun broad suites.
    const auditId = randomUUID();
    state.audit = { id: auditId, provider: 'codex/gpt-6-luna', mode: 'full-access', workspaceId: 'wks_e56a74f6e1bc6cd6' };
    await save(state);
    await x.api.workspaces.ref(state.audit.workspaceId).agents.create({ agentId: auditId, idempotencyKey: `delivery-review-${auditId}`, title: 'Luna · delivery contract verification', parent, config: { provider: 'codex/gpt-6-luna', modeId: 'full-access', thinkingOptionId: 'medium' }, prompt: `You are the independent testing session required by AGENTS.md for the Flowly delivery constraints change. You are sharing the codebase: preserve every other session's edits, do not edit implementation files, do not create child agents. Own only docs/verification/delivery-constraints-2026-10-22/luna-review.md and temporary fixtures you explicitly record and clean. Read docs/DELIVERY-CONSTRAINTS-SPEC.md and inspect the current diff in shared/tools.ts, shared/model.ts, server/agent-service.ts, server/delivery-gate.ts, server/reminders.ts, server/cli-source.ts, server/tool-server.ts, both skill copies and index.server.ts. Typecheck and full suite already passed 931 tests; do not repeat broad suites. Look for invariant violations, atomicity/replay/gate issues, contract drift. You may add a targeted evidence-only test under your evidence directory and run it explicitly if needed, cleaning all fixtures. Do not touch desktop windows or existing Paseo resources. Write your PASS/FAIL/UNRUN report including your full session ID, provider/model/mode. If a bug is found, report exact file/trigger and leave implementation to the parent. The parent runs Sonnet+GPT Tinylink scenarios and cleans those fixtures; do not duplicate them. End with a concise verdict.` });
    for (const [key, provider, mode] of [['sonnet', 'claude/claude-sonnet-5-5', 'bypassPermissions'], ['codex', 'codex/gpt-6-luna', 'full-access']]) {
      const branch = `test/delivery-${key}-036d`;
      const filename = `docs/flowly-delivery-${key}-036d.txt`;
      const card = await x.rpc('tasks.create', { projectId, operationId: `delivery-${key}-${randomUUID()}`, title: `Delivery fixture · ${key} · 036d`, description: `Test-only documentation change. Create ${filename} with one short sentence identifying this as a Flowly delivery test, verify it is nonempty, and deliver for review. Leave the file uncommitted for the next user instruction. Do not edit any other files.`, type: 'docs', tags: ['agent-tools'], mode: 'worktree', baseRef: 'main', branchName: branch });
      state.cards.push({ id: card.id, workspaceId: card.workspaceId, branch, filename, key });
      await save(state);
      const prep = await x.rpc('tools.prepare-session', { id: card.id, operationId: `delivery-session-${randomUUID()}` });
      const session = { id: prep.agentId, key, provider, mode, cardId: card.id, workspaceId: card.workspaceId, branch, filename };
      state.sessions.push(session); await save(state);
      await x.api.workspaces.ref(card.workspaceId).agents.create({ agentId: prep.agentId, idempotencyKey: `delivery-${prep.agentId}`, title: `Delivery fixture · ${key}`, parent, labels: { 'flowly-task': card.id, 'flowly-project': projectId }, config: { provider, modeId: mode, thinkingOptionId: 'medium', systemPrompt: prep.instructions, mcpServers: { flowly: prep.mcp } }, env: { FLOWLY_CONTEXT_FILE: prep.contextFile, FLOWLY_CLI: prep.cliPath, FLOWLY_SKILL: prep.skillPath }, prompt: `Add ${filename} containing a short sentence that identifies it as a Flowly delivery test, verify it is nonempty, and deliver for review. Leave the file uncommitted for my next instruction. Only edit that file. You are sharing a codebase; preserve all existing resources. Do not create child agents. For the next instruction the approved GitHub target is ${repo} (private reusable test repository); the permanent Tinylink checkout has no remote, so when asked to push use the explicit URL https://github.com/${repo}.git and --repo ${repo} for gh. Do not add a remote or change repository config. All native resources and files you create must remain in this dedicated fixture workspace. Do not start PR work until I ask.` });
    }
    console.log(JSON.stringify({ audit: state.audit, sessions: state.sessions }));
  } else {
    const state = JSON.parse(await readFile(stateFile, 'utf8'));
    if (command === 'round2') {
      if (state.sessions.some(s => s.key.endsWith('-r2'))) throw new Error('Round 2 already exists.');
      for (const [key, provider, mode] of [['sonnet-r2', 'claude/claude-sonnet-5-5', 'bypassPermissions'], ['codex-r2', 'codex/gpt-6-luna', 'full-access']]) {
        const branch = `test/delivery-${key}-036d`;
        const filename = `docs/flowly-delivery-${key}-036d.txt`;
        const card = await x.rpc('tasks.create', { projectId, operationId: `delivery-${key}-${randomUUID()}`, title: `Delivery fixture · ${key} · 036d`, description: `Create ${filename} with one short sentence identifying it as a Flowly delivery test, verify it is nonempty, and deliver for review. Leave it uncommitted for the next user instruction. Only edit that file.`, type: 'docs', tags: ['agent-tools'], mode: 'worktree', baseRef: 'main', branchName: branch });
        state.cards.push({ id: card.id, workspaceId: card.workspaceId, branch, filename, key }); await save(state);
        const prep = await x.rpc('tools.prepare-session', { id: card.id, operationId: `delivery-session-${randomUUID()}` });
        state.sessions.push({ id: prep.agentId, key, provider, mode, cardId: card.id, workspaceId: card.workspaceId, branch, filename }); await save(state);
        await x.api.workspaces.ref(card.workspaceId).agents.create({ agentId: prep.agentId, idempotencyKey: `delivery-${prep.agentId}`, title: `Delivery fixture · ${key}`, parent, labels: { 'flowly-task': card.id, 'flowly-project': projectId }, config: { provider, modeId: mode, thinkingOptionId: 'medium', systemPrompt: prep.instructions, mcpServers: { flowly: prep.mcp } }, env: { FLOWLY_CONTEXT_FILE: prep.contextFile, FLOWLY_CLI: prep.cliPath, FLOWLY_SKILL: prep.skillPath }, prompt: `Add ${filename} containing a short sentence that identifies it as a Flowly delivery test, verify it is nonempty, and deliver for review. Leave the file uncommitted for my next instruction. Only edit that file. You are sharing a codebase; preserve all existing resources and do not create child agents. For the next instruction the approved GitHub target is ${repo} (private reusable test repository); the permanent Tinylink checkout has no remote, so when asked to push use the explicit URL https://github.com/${repo}.git and --repo ${repo} for gh. Do not add a remote or change repository config. All native resources and files you create must remain in this dedicated fixture workspace. Do not start PR work until I ask.` });
      }
      console.log(JSON.stringify(state.sessions.filter(s => s.key.endsWith('-r2'))));
    } else if (command === 'status') {
      const out = [];
      for (const s of [...(state.audit ? [state.audit] : []), ...state.sessions]) {
        const current = (await x.api.agents.ref(s.id).refresh())?.agent;
        out.push({ id: s.id, key: s.key || 'audit', status: current?.status, pending: current?.pendingPermissions?.length, lastError: current?.lastError });
      }
      const board = await x.rpc('board.read', {});
      console.log(JSON.stringify({ sessions: out, cards: state.cards.map(c => ({ id: c.id, status: board.tasks.find(t => t.id === c.id)?.status, artifacts: board.artifacts.filter(a => a.taskId === c.id).map(a => ({ target: a.target, role: a.role })) })) }, null, 2));
    } else if (command === 'followup') {
      const key = process.argv[3];
      const s = state.sessions.find(s => s.key === key);
      if (!s) throw new Error('Unknown owned session.');
      if (s.followupAt) throw new Error('Follow-up already sent.');
      const agent = x.api.agents.ref(s.id); await agent.refresh();
      if (agent.status !== 'idle') throw new Error('Session is not idle.');
      await agent.send('创建 PR 并合入');
      s.followupAt = new Date().toISOString(); await save(state);
      console.log(JSON.stringify({ sent: s.id }));
    } else if (command === 'cleanup') {
      state.cleanup = state.cleanup || [];
      for (const card of state.cards) {
        const board = await x.rpc('board.read', {});
        const task = board.tasks.find(t => t.id === card.id);
        if (!task) continue;
        if (task.projectId !== projectId || task.workspaceId !== card.workspaceId) throw new Error('Fixture ownership mismatch.');
        const check = await x.rpc('tasks.delete-check', { id: card.id });
        if (check.blockers.length) throw new Error(JSON.stringify(check.blockers));
        if (!check.workspace || check.workspace.id !== card.workspaceId) throw new Error('Fixture workspace missing or mismatched.');
        const changes = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: check.workspace.directory, encoding: 'utf8' }).trim();
        // The Codex rerun used a temporary Git database for its merged PR. Its one original test
        // document can remain untracked; it is explicitly owned here. Preserve any other dirty path.
        if (changes && changes !== `?? ${card.filename}`) throw new Error('Preserving uncommitted fixture changes: ' + card.key);
        const result = await x.rpc('tasks.delete', { id: card.id, revision: task.revision, archive: true, acknowledgeWarnings: true });
        state.cleanup.push({ key: card.key, check, result }); await save(state);
      }
      const reviewer = x.api.agents.ref(state.audit.id); await reviewer.refresh();
      if (reviewer.status === 'running' || reviewer.status === 'initializing') throw new Error('Reviewer still running; preserve it.');
      if (!reviewer.archivedAt) await reviewer.archive();
      const board = await x.rpc('board.read', {});
      const remainingTasks = board.tasks.filter(t => state.cards.some(c => c.id === t.id));
      const preserved = board.tasks.filter(t => state.before.some(b => b.id === t.id)).map(t => ({ id: t.id, revision: t.revision, status: t.status, workspaceId: t.workspaceId }));
      if (JSON.stringify(preserved) !== JSON.stringify(state.before)) throw new Error('Permanent cards changed; investigate without restoring or overwriting.');
      const native = await x.api.workspaces.list({ filter: { projectId: 'prj_63a70119e68a1973' }, page: { limit: 200 } });
      const remainingWorkspaces = native.entries.filter(w => state.cards.some(c => c.workspaceId === w.id));
      const sessions = [];
      for (const s of [...state.sessions, state.audit]) { const a = x.api.agents.ref(s.id); await a.refresh(); sessions.push({ id: s.id, status: a.status, archivedAt: a.archivedAt }); }
      const result = { at: new Date().toISOString(), remainingTasks: remainingTasks.map(t => t.id), remainingWorkspaces: remainingWorkspaces.map(w => w.id), permanentCardsPreserved: true, originalWorkspacesPresent: state.before.every(b => native.entries.some(w => w.id === b.workspaceId)), sessions, nativePage: native.pageInfo, retainedRepo: repo };
      await writeFile(new URL('./cleanup.json', import.meta.url), JSON.stringify(result, null, 2));
      if (remainingTasks.length || remainingWorkspaces.length || sessions.some(s => !s.archivedAt)) throw new Error('Cleanup incomplete; inspect cleanup.json.');
      console.log(JSON.stringify(result));
    } else if (command === 'events') {
      const board = await x.rpc('board.read', {});
      const evidence = { at: new Date().toISOString(), tasks: board.tasks.filter(t => state.cards.some(c => c.id === t.id)), artifacts: board.artifacts.filter(a => state.cards.some(c => c.id === a.taskId)), events: board.events.filter(e => state.cards.some(c => c.id === e.taskId)), workpads: board.workpads.filter(w => state.cards.some(c => c.id === w.taskId)) };
      await writeFile(new URL('./live-events.json', import.meta.url), JSON.stringify(evidence, null, 2));
      console.log(JSON.stringify({ events: evidence.events.length, artifacts: evidence.artifacts.map(a => ({ target: a.target, role: a.role })) }));
    } else throw new Error('Unknown command.');
  }
} finally { await x.close(); }
