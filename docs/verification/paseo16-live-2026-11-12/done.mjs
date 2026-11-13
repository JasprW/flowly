import { open, ids, helpers, sleep } from './lib.mjs';
const fx = await ids();
const { paseo, rpc, close } = await open();
try {
  let task = (await rpc('board.read', {})).tasks.find((t) => t.id === fx.card);
  task = await rpc('tasks.update', { id: fx.card, revision: task.revision, status: 'done' });
  console.log('moved', task.status, 'rev', task.revision);
  await sleep(4000);
  console.log('wrapup-check', JSON.stringify(await rpc('tasks.wrapup-check', { id: fx.card })));
  const t2 = (await rpc('board.read', {})).tasks.find((t) => t.id === fx.card);
  console.log('archived?', t2.archivedAt, 'wrap', JSON.stringify(t2.wrapup ?? t2.wrappedUp ?? null));
  const w = await rpc('tasks.wrapup', { id: fx.card, revision: t2.revision, acknowledgeWarnings: true }).catch((e) => 'refused: ' + e.message);
  console.log('wrapup', typeof w === 'string' ? w : JSON.stringify(w).slice(0, 200));
  for (let i = 0; i < 12; i++) { const h = await helpers(paseo); console.log(JSON.stringify(h)); if (h.all.some((x) => /memory/i.test(x[1]) && x[3] === 'archived')) break; await sleep(10000); }
} finally { await close(); }
