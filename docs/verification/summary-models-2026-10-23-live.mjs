import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { DaemonClient } from '@getpaseo/client/internal/daemon-client';
import { createPaseoApi } from '@getpaseo/client';

// Read the same local endpoint/credential as the existing CLI; never print credentials.
const home = process.env.PASEO_HOME || join(homedir(), '.paseo');
const lock = JSON.parse(await readFile(join(home, 'paseo.pid'), 'utf8'));
const token = (await readFile(join(home, 'local-credential'), 'utf8')).trim();
const client = new DaemonClient({ url: `ws://${lock.listen.replace(/^tcp:\/\//, '')}/ws`, clientId: 'summary-fallback-verification', clientType: 'cli', localCredential: () => token, reconnect: { enabled: false } });
const taskId = 'e5ea7edb-8453-4c19-8882-14aecc50c770';
let original, ownedRevision;
const evidence = { at: new Date().toISOString(), taskId, children: [], observations: [] };
await client.connect();
const api = createPaseoApi(client);
try {
  const settings = await client.invokePluginRpc('flowly', 'settings.task-summary.read', {});
  original = settings;
  evidence.settings = settings;
  console.log(JSON.stringify({ settings }));
  if (process.argv.includes('--read-only')) process.exitCode = 0;
  else {
    assert.equal(settings.status, 'ready');
    const saved = await client.invokePluginRpc('flowly', 'settings.task-summary.write', { revision: settings.revision, values: { ...settings.values, summaryModel: '', summaryModels: ['unavailable/skip', 'codex/gpt-6-luna', 'claude/claude-haiku-5-5'] } });
    assert.equal(saved.status, 'saved');
    ownedRevision = saved.revision;
    evidence.configured = saved.values.summaryModels;
    const before = await client.invokePluginRpc('flowly', 'summaries.history', { taskId });
    evidence.beforeIds = before.map(e => e.id);
    evidence.refresh = await client.invokePluginRpc('flowly', 'summaries.refresh', { taskId });
    const deadline = Date.now() + 150000;
    const seen = new Set();
    while (Date.now() < deadline) {
      const [overview, listing] = await Promise.all([
        client.invokePluginRpc('flowly', 'summaries.read', {}),
        api.agents.list({ filter: { includeArchived: true, labels: { 'flowly-task': taskId, flowly: 'summarizer' } }, page: { limit: 100 } }),
      ]);
      for (const { agent: a } of listing.entries) {
        if (a.labels?.['flowly-task'] === taskId && a.labels?.flowly === 'summarizer' && !seen.has(a.id)) {
          seen.add(a.id);
          const child = { id: a.id, provider: a.provider, model: a.model, status: a.status, observedAt: new Date().toISOString() };
          evidence.children.push(child);
          console.log(JSON.stringify({ child }));
        }
      }
      const latest = overview.latest.find(e => e.taskId === taskId);
      const error = overview.errors.find(e => e.taskId === taskId);
      const running = overview.running.includes(taskId);
      evidence.observations.push({ at: new Date().toISOString(), running, latestId: latest?.id, model: latest?.model, error });
      if (!running) {
        evidence.result = { latest, error };
        assert.equal(error, undefined);
        assert.equal(latest?.model, 'codex/gpt-6-luna');
        assert(!evidence.beforeIds.includes(latest.id));
        assert.equal(evidence.children[0]?.model, 'gpt-6-luna');
        console.log(JSON.stringify({ result: evidence.result }));
        break;
      }
      await new Promise(r => setTimeout(r, 300));
    }
    assert(evidence.result, 'live summary did not finish');
    evidence.childrenAfter = [];
    for (const child of evidence.children) {
      const snapshot = await api.agents.ref(child.id).refresh();
      evidence.childrenAfter.push({ id: child.id, exists: !!snapshot?.agent });
      assert(!snapshot?.agent);
    }
  }
} catch (e) {
  evidence.failure = String(e);
  console.error(String(e));
  process.exitCode = 1;
} finally {
  if (ownedRevision) {
    const current = await client.invokePluginRpc('flowly', 'settings.task-summary.read', {});
    assert.equal(current.revision, ownedRevision, 'another writer changed settings; do not overwrite');
    const restored = await client.invokePluginRpc('flowly', 'settings.task-summary.write', { revision: current.revision, values: original.values });
    assert.equal(restored.status, 'saved');
    assert.deepEqual((await client.invokePluginRpc('flowly', 'settings.task-summary.read', {})).values, original.values);
    evidence.restore = 'PASS: original values restored exactly';
  }
  await writeFile(new URL('./summary-models-2026-10-23-live.json', import.meta.url), JSON.stringify(evidence, null, 2));
  await client.close();
}
