import { open } from './lib.mjs';
const { paseo, close } = await open();
try {
  const all = (await paseo.agents.list({ filter: { includeArchived: true, includeBackground: true } })).entries.map((e) => e.agent ?? e);
  for (const a of all.filter((x) => /HELLO/.test(x.title ?? ''))) console.log(a.id.slice(0, 8), a.title, 'bg', a.background, 'parent', a.parentAgentId?.slice(0, 8), 'ws', a.workspaceId, JSON.stringify(a.labels));
} finally { await close(); }
