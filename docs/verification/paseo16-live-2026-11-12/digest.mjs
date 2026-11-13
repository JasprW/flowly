import { open } from './lib.mjs';
const { dc, paseo, close } = await open();
try {
  const all = (await paseo.agents.list({ filter: { includeArchived: true, includeBackground: true } })).entries.map((e) => e.agent ?? e);
  const d = all.find((a) => /Kanban digest · p16 live e2e/.test(a.title ?? ''));
  const t = await dc.fetchAgentTimeline(d.id, { direction: 'tail', limit: 20 });
  const items = (t.entries ?? t.items ?? t.timeline ?? []).map((e) => e.item ?? e);
  const last = items.filter((i) => i.type === 'assistant_message').pop();
  console.log(d.id.slice(0, 8), d.status, items.length, 'items; last reply:', (last?.text ?? JSON.stringify(last)).slice(0, 300));
} finally { await close(); }
