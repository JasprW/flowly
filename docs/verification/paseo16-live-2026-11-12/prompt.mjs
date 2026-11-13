import { open } from './lib.mjs';
const { dc, paseo, close } = await open();
try {
  const all = (await paseo.agents.list({ filter: { includeArchived: true, includeBackground: true } })).entries.map((e) => e.agent ?? e);
  const a = all.find((x) => x.id.startsWith(process.argv[2]));
  const r = await dc.fetchAgentTimeline(a.id, { direction: 'tail', limit: 50 });
  const text = JSON.stringify(r);
  const i = text.indexOf('Background tasks still running');
  console.log(a.title, 'bg=', a.background, i < 0 ? 'NO SECTION' : text.slice(i, i + 500).replace(/\\n/g, '\n'));
} finally { await close(); }
