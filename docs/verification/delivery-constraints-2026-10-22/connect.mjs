// Test harness only. Credentials stay in memory and are never part of evidence.
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DaemonClient } from '@getpaseo/client/internal/daemon-client';
import { createPaseoApi } from '@getpaseo/client';

export async function connect() {
  const home = join(homedir(), '.paseo');
  const { listen } = JSON.parse(await readFile(join(home, 'paseo.pid'), 'utf8'));
  const token = (await readFile(join(home, 'local-credential'), 'utf8')).trim();
  const client = new DaemonClient({ url: `ws://${listen.replace(/^tcp:\/\//, '')}/ws`, clientId: `delivery-test-${randomUUID()}`, clientType: 'cli', localCredential: () => token, connectTimeoutMs: 5000, reconnect: { enabled: false } });
  const api = createPaseoApi(client);
  try { await client.connect(); }
  catch (e) { await api.dispose(); await client.close(); throw e; }
  return { client, api, rpc: (method, input) => client.invokePluginRpc('flowly', method, input), close: async () => { await api.dispose(); await client.close(); } };
}
