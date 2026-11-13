import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { DaemonClient } from '@getpaseo/client/internal/daemon-client';
import { createPaseoApi } from '@getpaseo/client';
export const idsFile = new URL('./ids.json', import.meta.url);
export async function open() {
  const dc = new DaemonClient({ url: 'ws://127.0.0.1:6767/ws', clientId: `p16live-${randomUUID()}`, clientType: 'cli', appVersion: '0.16.0-beta.2', connectTimeoutMs: 10000, reconnect: { enabled: false } });
  await dc.connect();
  const paseo = createPaseoApi(dc);
  const rpc = (m, i) => dc.invokePluginRpc('flowly', m, i);
  const close = async () => { await paseo.dispose().catch(() => {}); await dc.close().catch(() => {}); };
  return { dc, paseo, rpc, close };
}
export const ids = async () => JSON.parse(await readFile(idsFile, 'utf8'));
export const save = (x) => writeFile(idsFile, JSON.stringify(x, null, 2));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** This fixture's Flowly helper agents (summarizer labels, fixture titles) visible in the default list vs only with includeBackground. */
const FIXTURE_TITLE = /Write HELLO\.md|p16 live e2e/;
export async function helpers(paseo) {
  const pick = (r) => r.entries.map((e) => e.agent ?? e).filter((a) => a.labels?.flowly === 'summarizer' && FIXTURE_TITLE.test(a.title ?? ''));
  const visible = pick(await paseo.agents.list({ filter: { includeArchived: true } }));
  const all = pick(await paseo.agents.list({ filter: { includeArchived: true, includeBackground: true } }));
  return { visible: visible.map((a) => [a.id, a.title]), all: all.map((a) => [a.id.slice(0, 8), a.title, a.background, a.archivedAt ? 'archived' : 'live']) };
}
