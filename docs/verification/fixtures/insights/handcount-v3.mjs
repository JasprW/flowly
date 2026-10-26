// Independent hand count for INSIGHTS-REDESIGN-SPEC v3 (last 7 calendar days, Asia/Shanghai; does not import shared code). Edit the cutoff date. Read only.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
const dir = `${homedir()}/.paseo/plugin-data/flowly`;
const projectId = '154c66d4-9d96-4ff1-b810-205a5d016330';
const tz = 'Asia/Shanghai';
const lines = readFileSync(`${dir}/flow/${projectId}.jsonl`, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).sort((a, b) => a.at.localeCompare(b.at));
const drop = new Set(); const last = new Map();
for (const e of lines.filter((x) => x.action === 'status_changed')) { const p = last.get(e.taskId); if (e.rule === 'A1r' && p?.rule === 'A1' && p.from === e.to) { drop.add(p.id); drop.add(e.id); } last.set(e.taskId, e); }
const entries = lines.filter((e) => !drop.has(e.id));
const byTask = new Map(); for (const e of entries) { if (!byTask.has(e.taskId)) byTask.set(e.taskId, []); byTask.get(e.taskId).push(e); }
const cutoff = Date.parse("2026-10-20T00:00:00+08:00");
const rounds = [];
for (const [, es] of byTask) {
  if (!es.some((e) => e.action === 'created')) continue;
  const done = es.find((e) => e.action === 'status_changed' && e.to === 'done'); if (!done) continue;
  if (Date.parse(done.at) < cutoff) continue;
  rounds.push(es.filter((e) => e.at <= done.at && e.action === 'status_changed' && e.from === 'in_review' && e.to && !['done', 'cancelled', 'in_review'].includes(e.to)).length);
}
const median = (v) => { const s = [...v].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
console.log('cards', rounds.length, 'median rounds', median(rounds), 'one pass', ((rounds.filter((x) => !x).length / rounds.length) * 100).toFixed(1) + '%');
// turns per day (agent.turn_ended) in tz, last 10 days
const day = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(iso));
const perDay = new Map(); const cardsDay = new Map();
for (const e of entries) if (e.action === 'agent.turn_ended') { const d = day(e.at); perDay.set(d, (perDay.get(d) ?? 0) + 1); if (!cardsDay.has(d)) cardsDay.set(d, new Set()); cardsDay.get(d).add(e.taskId); }
for (const [d, n] of [...perDay].sort().slice(-10)) console.log(d, 'turns', n, 'cards', cardsDay.get(d).size);
