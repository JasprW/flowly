import { open, ids } from './lib.mjs';
const x = await ids();
const { paseo, close } = await open();
try {
  for (const f of [{}, { includeBackground: true }]) {
    const r = await paseo.workspaces.list(Object.keys(f).length ? { filter: f } : undefined).catch((e) => ({ err: String(e) }));
    if (r.err) { console.log('err', r.err); continue; }
    const list = (r.entries ?? r).map((w) => w.workspace ?? w).filter((w) => /Flowly background/i.test(w.title ?? w.name ?? ''));
    console.log(JSON.stringify(f), list.map((w) => [w.id, w.projectId === x.project ? 'THIS' : w.projectId?.slice(0, 8), 'bg', w.background, w.archivedAt ? 'archived' : 'active']));
  }
} finally { await close(); }
