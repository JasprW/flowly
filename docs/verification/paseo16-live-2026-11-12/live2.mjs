// CodeRabbit PR #100: the first project-level run after a plugin start must not show a visible "Flowly background".
// Temp project + card; digest twice (support learned, hidden id stored), plugin reload, digest again while the
// default workspace list is polled. Cleans up its project, Paseo project and directory.
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { open, sleep } from './lib.mjs';
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const git = (a, cwd) => execFileSync('git', a, { cwd, encoding: 'utf8' });
const TITLE = 'p16 live2 restart';
const tz = 'Asia/Singapore', day = new Date().toLocaleDateString('en-CA', { timeZone: tz });
const state = () => readFile(join(homedir(), '.paseo/plugin-data/flowly/background-workspaces.json'), 'utf8').then(JSON.parse).catch(() => ({}));
const d = await mkdtemp(join(tmpdir(), 'p16live2-'));
let projectId = null, nativeId = null;
let c = await open();
try {
  await writeFile(join(d, 'README.md'), '# fixture\n');
  git(['init', '-q', '-b', 'main'], d); git(['config', 'user.name', 'Fixture'], d); git(['config', 'user.email', 'fixture@example.invalid'], d);
  git(['add', '.'], d); git(['commit', '-q', '-m', 'init'], d);
  const project = await c.rpc('projects.create', { title: TITLE, description: 'Temporary fixture.', primaryPath: d });
  projectId = project.id;
  await c.rpc('tasks.create', { projectId, operationId: `p16l2-${randomUUID()}`, title: 'Fixture card', description: 'Nothing to do.', status: 'todo', priority: 'normal', type: 'chore', mode: 'directory' });
  nativeId = (await c.rpc('board.read', {})).projects.find((p) => p.id === projectId).paseoProjectId;
  const digests = async (paseo) => (await paseo.agents.list({ filter: { includeArchived: true, includeBackground: true } })).entries.map((e) => e.agent ?? e).filter((a) => (a.title ?? '').includes(TITLE));
  const visibleBg = async (paseo) => {
    const r = await paseo.workspaces.list().catch((e) => ({ failed: String(e) }));
    if (r.failed) return [`list failed: ${r.failed}`];
    return (r.entries ?? r).map((w) => w.workspace ?? w).filter((w) => w.projectId === nativeId && /Flowly background/.test(w.title ?? '')).map((w) => w.id);
  };
  const runDigest = async (label) => {
    const before = (await digests(c.paseo)).length;
    log(label, JSON.stringify(await c.rpc('insights.digest-refresh', { projectId, tz, day })));
    const seen = new Set();
    for (let n = 0; n < 40; n++) {
      (await visibleBg(c.paseo)).forEach((id) => seen.add(id));
      const all = await digests(c.paseo);
      if (all.length > before && all.every((a) => a.archivedAt)) break;
      await sleep(3000);
    }
    log(label, 'helpers', JSON.stringify((await digests(c.paseo)).map((a) => [a.id.slice(0, 8), a.background, a.archivedAt ? 'archived' : 'live'])), 'visible Flowly background during run', JSON.stringify([...seen]));
  };
  await runDigest('digest1');
  await runDigest('digest2');
  log('stored', JSON.stringify({ projects: (await state()).projects?.[projectId] ?? null, hidden: (await state()).hidden?.[projectId] ?? null }));
  await c.close();
  log('reload', execFileSync('paseo', ['plugin', 'reload', 'flowly'], { encoding: 'utf8' }).split('\n').find((l) => l.includes('flowly'))?.replace(/\s+/g, ' ').slice(0, 40));
  await sleep(6000);
  c = await open();
  await runDigest('digest3-after-reload');
  const archivedBg = (await c.paseo.workspaces.list({ filter: { includeArchived: true } })).entries.map((w) => w.workspace ?? w).filter((w) => w.projectId === nativeId && /Flowly background/.test(w.title ?? '') && w.archivedAt);
  log('visible Flowly background workspaces in the archive', JSON.stringify(archivedBg.map((w) => w.id)));
} finally {
  if (projectId) {
    const p = (await c.rpc('board.read', {})).projects.find((x) => x.id === projectId);
    if (p) log('remove', JSON.stringify(await c.rpc('projects.remove', { id: projectId, revision: p.revision, alsoPaseo: true })).replace(/"backup":"[^"]*"/, '"backup":"…"'));
    const backups = execFileSync('ls', [join(homedir(), '.paseo/plugin-data/flowly/removed')], { encoding: 'utf8' }).split('\n').filter((f) => f.startsWith(projectId));
    for (const f of backups) await rm(join(homedir(), '.paseo/plugin-data/flowly/removed', f));
  }
  await rm(d, { recursive: true, force: true });
  await c.close();
}
