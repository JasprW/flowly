// Live check for BACKGROUND-WORKSPACE-SPEC: two manual "Find memories" runs on a Done Flowly card.
// Records whether the "Flowly background" workspace appears, is archived after each run, is reused by id,
// and whether any review session or tab target is left in a card workspace. Usage: node <this file> <taskId>
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { DaemonClient } from '@getpaseo/client/internal/daemon-client';

const home = join(homedir(), '.paseo');
const lock = JSON.parse(await readFile(join(home, 'paseo.pid'), 'utf8'));
const token = (await readFile(join(home, 'local-credential'), 'utf8')).trim();
const client = new DaemonClient({ url: `ws://${lock.listen.replace(/^tcp:\/\//, '')}/ws`, clientId: 'background-workspace-verification', clientType: 'cli', localCredential: () => token, reconnect: { enabled: false } });
const taskId = process.argv[2];
const rpc = (m, i) => client.invokePluginRpc('flowly', m, i);
const stored = async () => JSON.parse(await readFile(join(home, 'plugin-data/flowly/background-workspaces.json'), 'utf8').catch(() => '{"projects":{}}')).projects;
const workspaces = async () => {
  const out = [];
  let cursor;
  do {
    const page = await client.fetchWorkspaces({ page: { limit: 200, cursor } });
    out.push(...page.entries);
    cursor = page.pageInfo.nextCursor ?? undefined;
  } while (cursor);
  return out;
};
const reviewAgents = async () => {
  const out = [];
  let cursor;
  do {
    const page = await client.fetchAgents({ filter: { includeArchived: true }, page: { limit: 200, cursor } });
    for (const { agent } of page.entries)
      if ((agent.title || '').startsWith('Flowly memory review')) out.push({ id: agent.id, workspaceId: agent.workspaceId, archivedAt: agent.archivedAt });
    cursor = page.pageInfo.nextCursor ?? undefined;
  } while (cursor);
  return out;
};

const evidence = { taskId, at: new Date().toISOString(), runs: [] };
try {
  await client.connect();
  const board = JSON.parse(await readFile(join(home, 'plugin-data/flowly/board.json'), 'utf8'));
  const task = board.tasks.find((t) => t.id === taskId);
  const cardWorkspaces = new Set(board.tasks.filter((t) => t.projectId === task.projectId).map((t) => t.workspaceId));
  for (let run = 1; run <= 2; run++) {
    const before = (await stored())[task.projectId] ?? null;
    const queued = await rpc('memory.retro', { taskId });
    const seen = new Map();
    const reviews = new Map();
    const started = Date.now();
    let running = true;
    while (running && Date.now() - started < 300_000) {
      await new Promise((r) => setTimeout(r, 1000));
      for (const w of await workspaces()) if (w.name === 'Flowly background' || w.title === 'Flowly background') seen.set(w.id, { id: w.id, dir: w.workspaceDirectory, projectId: w.projectId });
      for (const a of await reviewAgents()) reviews.set(a.id, a);
      running = (await rpc('memory.read', { projectId: task.projectId })).value.running.includes(taskId);
    }
    await new Promise((r) => setTimeout(r, 2000));
    const after = (await stored())[task.projectId] ?? null;
    const liveAfter = (await workspaces()).filter((w) => w.id === after);
    evidence.runs.push({
      run,
      queued,
      durationMs: Date.now() - started,
      storedBefore: before,
      storedAfter: after,
      backgroundSeenDuringRun: [...seen.values()],
      backgroundListedAfterRun: liveAfter.map((w) => ({ id: w.id, status: w.status })),
      reviewSessions: [...reviews.values()].map((a) => ({ ...a, inCardWorkspace: cardWorkspaces.has(a.workspaceId) })),
      reviewSessionsLeft: await reviewAgents(),
      inspectAfter: after ? await client.inspectWorkspaceRecovery(after).catch((e) => ({ error: String(e) })) : null,
    });
  }
  const view = await rpc('memory.read', { projectId: task.projectId });
  evidence.errors = view.value.errors.filter((e) => e.taskId === taskId);
} finally {
  await writeFile(new URL('./background-workspace-2026-10-23-live.json', import.meta.url), JSON.stringify(evidence, null, 2));
  await client.close().catch(() => {});
}
console.log(JSON.stringify(evidence, null, 2));
