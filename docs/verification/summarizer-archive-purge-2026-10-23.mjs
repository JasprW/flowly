// One-off cleanup the user confirmed on 2026-10-23 (card "memory review session修复"): hard-delete the
// archived Flowly summarizer sessions left from before hard delete existed (Kanban summary, workflow
// insights, ...). Only sessions labelled flowly=summarizer AND archived are touched; the id list is
// written to summarizer-archive-purge-2026-10-23.json before anything is deleted.
// Usage: node <this file> [--delete]   (without --delete it only lists)
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { DaemonClient } from '@getpaseo/client/internal/daemon-client';

const home = join(homedir(), '.paseo');
const lock = JSON.parse(await readFile(join(home, 'paseo.pid'), 'utf8'));
const token = (await readFile(join(home, 'local-credential'), 'utf8')).trim();
const client = new DaemonClient({ url: `ws://${lock.listen.replace(/^tcp:\/\//, '')}/ws`, clientId: 'flowly-summarizer-purge', clientType: 'cli', localCredential: () => token, reconnect: { enabled: false } });
const evidenceFile = new URL('./summarizer-archive-purge-2026-10-23.json', import.meta.url);

const targets = async () => {
  const out = [];
  let cursor;
  do {
    const page = await client.fetchAgents({ filter: { includeArchived: true }, page: { limit: 200, cursor } });
    for (const { agent } of page.entries)
      if (agent.labels?.flowly === 'summarizer' && agent.archivedAt)
        out.push({ id: agent.id, title: agent.title ?? '', workspaceId: agent.workspaceId ?? null, createdAt: agent.createdAt, archivedAt: agent.archivedAt, labels: agent.labels });
    cursor = page.pageInfo.nextCursor ?? undefined;
  } while (cursor);
  return out;
};

try {
  await client.connect();
  const list = await targets();
  const evidence = { at: new Date().toISOString(), rule: 'labels.flowly === "summarizer" && archivedAt', count: list.length, sessions: list, deleted: [], failed: [] };
  await writeFile(evidenceFile, JSON.stringify(evidence, null, 2));
  console.log(`matched ${list.length}`);
  if (process.argv.includes('--delete')) {
    for (const s of list) {
      try {
        await client.deleteAgent(s.id);
        evidence.deleted.push(s.id);
      } catch (e) {
        evidence.failed.push({ id: s.id, error: e instanceof Error ? e.message : String(e) });
      }
    }
    evidence.remaining = (await targets()).map((s) => s.id);
    await writeFile(evidenceFile, JSON.stringify(evidence, null, 2));
    console.log(`deleted ${evidence.deleted.length}, failed ${evidence.failed.length}, remaining ${evidence.remaining.length}`);
  }
} finally {
  await client.close().catch(() => {});
}
