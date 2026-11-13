import { open, ids, helpers, sleep } from './lib.mjs';
const fx = await ids();
const { paseo, rpc, close } = await open();
const seen = new Set();
try {
  for (let i = 0; i < Number(process.argv[2] ?? 40); i++) {
    const s = (await paseo.agents.list({ filter: { includeArchived: true } })).entries.map((e) => e.agent ?? e).find((a) => a.id === fx.session) ?? {};
    const board = await rpc('board.read', {});
    const task = board.tasks.find((t) => t.id === fx.card);
    const ctx = { task };
    const h = await helpers(paseo, fx.project);
    for (const v of h.visible) seen.add('VISIBLE ' + v.join(' '));
    const line = { t: new Date().toISOString().slice(11, 19), status: s.status, bgWork: s.backgroundWork?.count, card: ctx?.task?.status, review: task?.review?.state, helpersVisible: h.visible.length, helpers: h.all };
    console.log(JSON.stringify(line));
    if (process.argv[3] && line.review && !['running', 'pending', 'queued'].includes(line.review) && line.card === 'in_review') break;
    await sleep(8000);
  }
  console.log('ever visible:', [...seen]);
} finally { await close(); }
