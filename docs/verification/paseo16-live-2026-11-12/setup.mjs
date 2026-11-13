import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { open, save } from './lib.mjs';
const { paseo, rpc, close } = await open();
const git = (a, cwd) => execFileSync('git', a, { cwd, encoding: 'utf8' });
try {
  const d = await mkdtemp(join(tmpdir(), 'p16live-'));
  await writeFile(join(d, 'README.md'), '# p16 live fixture\n');
  git(['init', '-q', '-b', 'main'], d); git(['config', 'user.name', 'Fixture'], d); git(['config', 'user.email', 'fixture@example.invalid'], d);
  git(['add', '.'], d); git(['commit', '-q', '-m', 'init'], d);
  const fx = { directory: d };
  await save(fx);
  const project = await rpc('projects.create', { title: 'p16 live e2e', description: 'Temporary fixture (background agents test).', primaryPath: d });
  fx.project = project.id; await save(fx);
  console.log('project', project.id, 'autoReview', JSON.stringify(project.autoReview));
  const card = await rpc('tasks.create', { projectId: project.id, operationId: `p16-${randomUUID()}`, title: 'Write HELLO.md', description: 'Create HELLO.md containing the word hello.', status: 'todo', priority: 'normal', type: 'chore', mode: 'directory' });
  fx.card = card.id; fx.workspace = card.workspaceId; await save(fx);
  const prep = await rpc('tools.prepare-session', { id: card.id, operationId: `p16-session-${randomUUID()}` });
  const prompt = [
    'Do exactly these steps, in order, and nothing else.',
    '1. Start `sleep 900` as a BACKGROUND task (Bash tool with run_in_background: true). Do not wait for it and do not stop it.',
    '2. Create HELLO.md containing the single word hello.',
    '3. With the Flowly tools: set tags ["fixture"], write a workpad with one acceptance item "HELLO.md exists" marked done, set stage development.',
    '4. Deliver with flowly_update_status status in_review, note "HELLO.md created; tests still running in the background.", outputs [] and nextMoves [].',
    'Then reply in one short sentence. Leave the background sleep running.',
  ].join('\n');
  const s = await paseo.workspaces.ref(card.workspaceId).agents.create({
    agentId: prep.agentId, idempotencyKey: `p16:${prep.agentId}`, title: 'Haiku · Write HELLO.md',
    config: { provider: 'claude/claude-haiku-5-5', modeId: 'bypassPermissions', systemPrompt: prep.instructions },
    env: { FLOWLY_CONTEXT_FILE: prep.contextFile, FLOWLY_CLI: prep.cliPath, FLOWLY_SKILL: prep.skillPath },
    prompt,
  });
  fx.session = s.id; await save(fx);
  console.log(JSON.stringify(fx));
} finally { await close(); }
