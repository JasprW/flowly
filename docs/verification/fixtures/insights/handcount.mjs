// Independent hand count for INSIGHTS-REDESIGN-SPEC §3.2 / §3.6 (does not import shared/workflow-stats.ts).
// Usage: node handcount.mjs [projectId] [tz]  — reads ~/.paseo/plugin-data/flowly (read only).
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
const dir = `${homedir()}/.paseo/plugin-data/flowly`;
const projectId = process.argv[2] || '154c66d4-9d96-4ff1-b810-205a5d016330';
const tz = process.argv[3] || 'Asia/Shanghai';
const lines = readFileSync(`${dir}/flow/${projectId}.jsonl`, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).sort((a, b) => a.at.localeCompare(b.at));
// Drop A1 → A1r pairs (a resume that the next rule undid).
const drop = new Set(); const last = new Map();
for (const e of lines.filter((x) => x.action === 'status_changed')) { const p = last.get(e.taskId); if (e.rule === 'A1r' && p?.rule === 'A1' && p.from === e.to) { drop.add(p.id); drop.add(e.id); } last.set(e.taskId, e); }
const entries = lines.filter((e) => !drop.has(e.id));
const byTask = new Map(); for (const e of entries) { if (!byTask.has(e.taskId)) byTask.set(e.taskId, []); byTask.get(e.taskId).push(e); }
const day = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(iso));
const monday = (d) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x.toISOString().slice(0, 10); };
const weeks = new Map();
for (const [taskId, es] of byTask) {
  if (!es.some((e) => e.action === 'created')) continue; // history cut
  const done = es.find((e) => e.action === 'status_changed' && e.to === 'done'); if (!done) continue;
  const rounds = es.filter((e) => e.at <= done.at && e.action === 'status_changed' && e.from === 'in_review' && e.to && !['done', 'cancelled', 'in_review'].includes(e.to)).length;
  const w = monday(day(done.at)); if (!weeks.has(w)) weeks.set(w, []); weeks.get(w).push(rounds);
}
const median = (v) => { const s = [...v].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
for (const [w, r] of [...weeks].sort((a, b) => b[0].localeCompare(a[0]))) console.log(w, 'cards', r.length, 'rounds median', median(r), 'one pass', `${((r.filter((x) => !x).length / r.length) * 100).toFixed(1)}%`);
