import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gradeTurn } from '../../../benchmarks/constraints/grade.mjs';
import { command, ownedDirectory } from '../../../benchmarks/constraints/io.mjs';

const at = n => `2026-10-22T00:00:${String(n).padStart(2, '0')}.000Z`;
const session = { id: 's', cardId: 'c', model: 'gpt-6-luna', filename: 'docs/file.txt', repository: 'owner/repo', checkCommand: 'node /fixture/check.mjs', checkId: 'check-id' };

function completeTurn(state = 'VALID') {
  const check = session.checkCommand;
  const ctx = {
    task: { type: 'docs', tags: [{ tag: 'tests' }] },
    workpad: { acceptance: [{ done: true }], validation: [{ command: check, state: 'pass', sha: 'abc1234', dirty: true }] },
  };
  return {
    id: 'T1', state, startedAt: at(0), endedAt: at(9), complete: true,
    receiptsComplete: true, flowComplete: true, timelineComplete: true,
    before: { task: { status: 'development' }, head: { sha: 'abc1234' } },
    after: {
      head: { sha: 'abc1234' }, workpad: ctx.workpad,
      artifacts: [{ id: 'a', role: 'output', target: './docs/file.txt' }],
    },
    calls: [
      { id: 'get', action: 'get_task', status: 'completed', seq: 1, endSeq: 2, at: at(1), contexts: [ctx] },
      { id: 'edit', kind: 'edit', seq: 5, endSeq: 6, at: at(3) },
      { id: 'check', kind: 'check', status: 'completed', seq: 8, endSeq: 9, at: at(5), proofs: [{ flowlyBenchmarkCheck: session.checkId, exitCode: 0, sha: 'abc1234', dirty: true }] },
    ],
    receipts: [{ eventId: 'delivery', action: 'status', status: 'in_review', artifactIds: ['a'], agentId: 's', taskId: 'c', at: at(7) }],
    events: [
      { id: 'dev', action: 'status_changed', to: 'development', at: at(2) },
      { id: 'test', action: 'status_changed', to: 'test', at: at(4) },
      { id: 'delivery', action: 'status_changed', to: 'in_review', at: at(7) },
      { id: 'moves', action: 'next_moves_suggested', agentId: 's', taskId: 'c', offered: 0, at: at(8) },
    ],
  };
}

test('INVALID turn with complete-looking evidence cannot earn a final PASS', () => {
  const result = gradeTurn(completeTurn('INVALID'), session);
  assert.equal(result.finalVerdict, 'UNKNOWN', 'INVALID execution must remain outside the passing denominator');
});

test('missing workspaceDirectory must fail before a subprocess can inherit process cwd', async () => {
  const cwd = await command('pwd', [], undefined);
  assert.equal(cwd, process.cwd(), 'execFile treats undefined cwd as the runner cwd');
  const owned = { workspaceId: 'w', branch: 'bench-constraints-run-model' };
  assert.throws(() => ownedDirectory({ id: 'w', projectId: 'p', workspaceKind: 'worktree', projectRootPath: '/repo' }, owned, 'p', '/repo'), /directory unavailable/);
  assert.equal(ownedDirectory({ id: 'w', projectId: 'p', workspaceKind: 'worktree', projectRootPath: '/repo', workspaceDirectory: '/repo/.worktrees/task' }, owned, 'p', '/repo'), '/repo/.worktrees/task');
  const source = await readFile(new URL('../../../benchmarks/constraints/runtime.mjs', import.meta.url), 'utf8');
  const refresh = source.indexOf('const workspace=await x.api.workspaces.ref(task.workspaceId).refresh()');
  const validation = source.indexOf('ownedDirectory(workspace,owned,state.baseline.projectId,c.repoPath)', refresh);
  const git = source.indexOf("command('git',['symbolic-ref','--short','HEAD'],owned.directory)", refresh);
  assert(refresh >= 0 && validation > refresh && git > validation,
    'validate the SDK directory before any subprocess receives cwd=undefined');
});

test('cleanup keeps a frozen local branch expectation instead of replacing it with the current ref', async () => {
  const source = await readFile(new URL('../../../benchmarks/constraints/runtime.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('export async function cleanup(');
  const end = source.indexOf('\n}', start);
  const cleanup = source.slice(start, end);
  assert.match(cleanup, /o\.branchExpected\s*&&\s*o\.branchExpected\s*!==\s*observed/);
  assert.match(cleanup, /o\.branchExpected\s*\?\?=\s*observed/);
  assert.doesNotMatch(cleanup, /o\.branchExpected\s*=\s*observed/,
    'a cleanup retry must preserve a previously frozen expected ref value');
});
