import { rm } from 'node:fs/promises';
import { open, ids, sleep } from './lib.mjs';
const x = await ids();
const { paseo, rpc, close } = await open();
try {
  const board = await rpc('board.read', {});
  const project = (board.projects ?? []).find((p) => p.id === x.project);
  console.log('project', project?.id, 'rev', project?.revision, 'nativeProjectId', project?.paseoProjectId ?? project?.nativeProjectId);
  if (project) console.log('remove', JSON.stringify(await rpc('projects.remove', { id: x.project, revision: project.revision, alsoPaseo: true })));
  await sleep(3000);
  await rm(x.directory, { recursive: true, force: true });
  const b2 = await rpc('board.read', {});
  console.log('board: project left', (b2.projects ?? []).some((p) => p.id === x.project), 'card left', (b2.tasks ?? []).some((t) => t.id === x.card));
  const agents = (await paseo.agents.list({ filter: { includeArchived: true, includeBackground: true } })).entries.map((e) => e.agent ?? e);
  const mine = agents.filter((a) => [x.workspace, 'wks_86ac3b8c778b5b26'].includes(a.workspaceId) || a.cwd?.includes('p16live'));
  console.log('agents left', mine.map((a) => [a.id.slice(0, 8), a.title, a.archivedAt ? 'archived' : 'live']));
  const ws = (await paseo.workspaces.list({ filter: { includeBackground: true, includeArchived: true } })).entries.map((w) => w.workspace ?? w);
  console.log('workspaces left', ws.filter((w) => [x.workspace, 'wks_86ac3b8c778b5b26'].includes(w.id) || (w.directory ?? w.cwd ?? '').includes('p16live')).map((w) => [w.id, w.title, w.archivedAt ? 'archived' : 'active']));
  const projs = await paseo.projects.list().catch((e) => String(e));
  console.log('native projects with p16live', JSON.stringify((projs.entries ?? projs).filter?.((p) => JSON.stringify(p).includes('p16live')) ?? projs).slice(0, 300));
} finally { await close(); }
