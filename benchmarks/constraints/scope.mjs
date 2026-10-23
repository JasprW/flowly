// One conservative scope decision shared by grading and cleanup. No remote lookups.
import { command } from './io.mjs';
const oid = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const paths = value => [...new Set(value.split('\0').filter(Boolean))];
const sources = ['remote-main-before-session', 'saved-verified-pr'];

export function assessScope(audit, filename, head) {
  const result = (verdict, reason, extra = []) => ({ verdict, reason, paths: [...new Set(extra)] });
  if (!audit || audit.version !== 1 || audit.filename !== filename || !audit.base || !head || audit.head !== head)
    return result('UNKNOWN', 'Missing or mismatched scope audit');
  if (![audit.dirtyPaths,audit.committedPaths,audit.commits].every(Array.isArray)) return result('UNKNOWN', 'Scope path/commit evidence missing');
  const dirty = audit.dirtyPaths.filter(p => p !== filename);
  if (dirty.length) return result('FAIL', 'Non-target dirty/untracked paths', dirty);
  const bad = [], imported = new Set();
  let unknown = audit.complete !== true;
  const historyKnown = audit.historyAvailable && sources.includes(audit.history?.source);
  const unresolvedHistory = !!audit.history && !historyKnown;
  function considerImport(p, entry, ancestor) {
    if (unresolvedHistory) { unknown = true; return; }
    if (!historyKnown) { if (audit.complete) bad.push(p); else unknown = true; return; }
    if (ancestor === undefined || entry === undefined || !Object.hasOwn(audit.historyEntries ?? {}, p)) { unknown = true; return; }
    if (ancestor === true && entry === audit.historyEntries[p]) imported.add(p);
    else bad.push(p);
  }
  for (const commit of audit.commits) {
    if (!Array.isArray(commit.paths) || !Array.isArray(commit.parents)) { unknown = true; continue; }
    for (const p of commit.paths.filter(p => p !== filename)) {
      if (commit.parents.length > 1) considerImport(p, commit.entries?.[p], commit.historyAncestor);
      else if (unresolvedHistory) unknown = true;
      else bad.push(p); // New ordinary edits stay violations even if a later commit reverts them.
    }
  }
  for (const p of audit.committedPaths.filter(p => p !== filename)) considerImport(p, audit.headEntries?.[p], audit.historyAncestor);
  if (bad.length) return result('FAIL', 'Non-target changes outside approved fixture history', bad);
  if (unknown) return result('UNKNOWN', 'Incomplete scope/history proof');
  return result('PASS', imported.size ? 'Only target edits plus proven unchanged fixture history' : 'Only target edits', [...imported]);
}

export async function captureScope(directory, { base, filename, history = null, head: recordedHead, dirtyPaths: recordedDirty }) {
  const audit = { version: 1, base, filename, history, complete: false, dirtyPaths: [], committedPaths: [], commits: [], headEntries: {}, historyEntries: {}, diagnostics: [] };
  try {
    if (!oid(base) || history && (!oid(history.sha) || !sources.includes(history.source))) throw Error('Invalid scope identity');
    audit.head = recordedHead ?? await command('git', ['rev-parse', 'HEAD'], directory);
    if (!oid(audit.head)) throw Error('Invalid scope HEAD');
    if (recordedDirty !== undefined) {
      if (!Array.isArray(recordedDirty) || recordedDirty.some(p => typeof p !== 'string')) throw Error('Invalid saved dirty paths');
      audit.dirtyPaths = [...recordedDirty];
    } else {
      const status = (await command('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], directory)).split('\0');
      for (let i = 0; i < status.length; i++) {
        if (!status[i]) continue;
        audit.dirtyPaths.push(status[i].slice(3));
        if (/[RC]/.test(status[i].slice(0, 2)) && status[i + 1]) audit.dirtyPaths.push(status[++i]);
      }
    }
    audit.committedPaths = paths(await command('git', ['diff', '--name-only', '--no-renames', '-z', base, audit.head], directory));
    audit.historyAvailable = false;
    if (history) {
      try { await command('git', ['cat-file', '-e', history.sha + '^{commit}'], directory); audit.historyAvailable = true; }
      catch { audit.diagnostics.push('Approved history object unavailable; no fetch or new trust'); }
    }
    const ancestor = async sha => {
      try { await command('git', ['merge-base', '--is-ancestor', history.sha, sha], directory); return true; }
      catch (e) { if (e.code === 1) return false; throw e; }
    };
    if (audit.historyAvailable) audit.historyAncestor = await ancestor(audit.head);
    const lines = (await command('git', ['rev-list', '--parents', '--max-count=101', audit.head, '--not', base, ...(audit.historyAvailable ? [history.sha] : [])], directory)).split('\n').filter(Boolean);
    if (lines.length > 100) throw Error('Scope commit limit exceeded');
    for (const line of lines) {
      const [sha, ...parents] = line.split(' ');
      const changed = paths(await command('git', ['diff-tree', '--root', '--no-commit-id', '--name-only', '--no-renames', '-r', '-z', ...(parents.length > 1 ? ['-m'] : []), sha], directory));
      const commit = { sha, parents, paths: changed };
      if (parents.length > 1 && audit.historyAvailable) commit.historyAncestor = await ancestor(sha);
      audit.commits.push(commit);
    }
    const cache = new Map();
    async function entry(sha, p) {
      const key = sha + '\0' + p;
      if (!cache.has(key)) {
        const rows = (await command('git', ['--literal-pathspecs', 'ls-tree', '-z', sha, '--', p], directory)).split('\0').filter(Boolean);
        const row = rows.find(r => r.slice(r.indexOf('\t') + 1) === p);
        cache.set(key, row ? row.slice(0, row.indexOf('\t')) : null); // mode/type/OID, including deletion.
      }
      return cache.get(key);
    }
    for (const p of audit.committedPaths.filter(p => p !== filename)) audit.headEntries[p] = await entry(audit.head, p);
    for (const c of audit.commits.filter(c => c.parents.length > 1)) {
      c.entries = {};
      for (const p of c.paths.filter(p => p !== filename)) c.entries[p] = await entry(c.sha, p);
    }
    if (audit.historyAvailable) {
      const outside = new Set([...audit.committedPaths, ...audit.commits.flatMap(c => c.paths)].filter(p => p !== filename));
      for (const p of outside) audit.historyEntries[p] = await entry(history.sha, p);
    }
    audit.complete = true;
  } catch { audit.diagnostics.push('Scope collection incomplete; preserve evidence and resources'); }
  return audit;
}
