// Stop the session's background work, recheck Wrap up, then run the digest and workflow insights.
import { open, ids, sleep, helpers } from './lib.mjs';
const x = await ids();
const { paseo, rpc, close } = await open();
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
try {
  const work = paseo.agents.ref(x.session).backgroundWork;
  const items = await work.list();
  log('background work', JSON.stringify(items.map((i) => [i.kind ?? i.type, i.title ?? i.description])));
  for (const i of items) await work.stop(i);
  for (let n = 0; n < 15; n++) { const left = await work.list(); if (!left.length) break; await sleep(2000); }
  log('after stop', (await work.list()).length);
  await sleep(3000);
  log('wrapup-check', JSON.stringify(await rpc('tasks.wrapup-check', { id: x.card })));
  const tz = 'Asia/Singapore', day = new Date().toLocaleDateString('en-CA', { timeZone: tz });
  log('digest', JSON.stringify(await rpc('insights.digest-refresh', { projectId: x.project, tz, day })));
  log('workflow', JSON.stringify(await rpc('workflow-insights.run', { projectId: x.project })));
  const seen = new Set();
  let ever = new Set();
  const workspacesVisible = new Set();
  for (let n = 0; n < 60; n++) {
    const h = await helpers(paseo);
    h.visible.forEach(([id]) => ever.add(id));
    const key = JSON.stringify(h.all.filter((a) => !seen.has(a[0] + a[3])));
    h.all.forEach((a) => seen.add(a[0] + a[3]));
    if (key !== '[]') log('helpers', key);
    // The default list is what the sidebar shows; a failed read is recorded, never taken as "none visible".
    const ws = await paseo.workspaces.list().catch((e) => (workspacesVisible.add(`list failed: ${e}`), null));
    for (const w of ws ? (ws.entries ?? ws) : []) { const v = w.workspace ?? w; if (/Flowly background/i.test(v.title ?? v.name ?? '')) workspacesVisible.add(v.id); }
    if (n > 5 && h.all.filter((a) => a[3] === 'live').length === 0) break;
    await sleep(5000);
  }
  log('ever visible helpers', JSON.stringify([...ever]), 'visible "Flowly background" workspaces', JSON.stringify([...workspacesVisible]));
  const wf = await rpc('workflow-insights.get', { projectId: x.project });
  log('workflow view', JSON.stringify(wf.value ? { lastRun: wf.value.lastRun ?? wf.value.run ?? null, findings: (wf.value.findings ?? []).length, error: wf.value.error ?? null } : null).slice(0, 400));
} finally { await close(); }
