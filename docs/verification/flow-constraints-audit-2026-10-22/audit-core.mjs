// Offline audit only. Never evaluate transcript code or write plugin data.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';

const defaultProject = '154c66d4-9d96-4ff1-b810-205a5d016330';
const prPattern = /https?:\/\/[^\s<>"'`\\]+/g;
export function prUrl(value) {
  try {
    const u = new URL(value);
    if (!['https:', 'http:'].includes(u.protocol) || !/\/(?:pull|merge_requests)\/\d+\/?$/.test(u.pathname)) return null;
    return u.origin + u.pathname.replace(/\/$/, '');
  } catch { return null; }
}
const urls = (text) => [...new Set((text.match(prPattern) ?? []).map(prUrl).filter(Boolean))];
const date = (v) => typeof v === 'string' && Number.isFinite(Date.parse(v));
const instant = (v) => new Date(v).toISOString();

export function options(args, provider) {
  const o = { provider, home: os.homedir(), project: defaultProject,
    since: '2026-10-21T06:00:00Z',
    until: new Date().toISOString(), testSessions: [], realSessions: [] };
  const flags = new Map([['--since','since'], ['--until','until'], ['--project','project'], ['--home','home'], ['--data','data'], ['--test-sessions','testFile']]);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--json' || a === '--turns') { o[a.slice(2)] = true; continue; }
    const key = a === '--test-session' ? 'testSessions' : a === '--real-session' ? 'realSessions' : flags.get(a);
    // Retained for compatibility; repository-wide PR counts are no longer mixed into turn statistics.
    if (!key && a !== '--repo') throw new Error(`Unknown argument: ${a}`);
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${a}`);
    if (a === '--repo') continue;
    if (Array.isArray(o[key])) o[key].push(value); else o[key] = value;
  }
  if (!date(o.since) || !date(o.until) || Date.parse(o.since) >= Date.parse(o.until)) throw new Error('Expected a valid since < until interval.');
  o.since = instant(o.since); o.until = instant(o.until);
  o.data ??= path.join(o.home, '.paseo/plugin-data/flowly');
  if (o.testFile) {
    const ids = JSON.parse(fs.readFileSync(o.testFile, 'utf8'));
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) throw new Error('test-sessions must be a JSON array of full session IDs.');
    o.testSessions.push(...ids);
  }
  if (o.testSessions.some((id) => o.realSessions.includes(id))) throw new Error('A session cannot be both real and test.');
  return o;
}

function files(dir, suffix, recursive = true) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? recursive ? files(p, suffix) : [] : e.name.endsWith(suffix) ? [p] : [];
  });
}
function jsonl(file, diagnostics) {
  return fs.readFileSync(file, 'utf8').split('\n').flatMap((line, i) => {
    if (!line.trim()) return [];
    try { return [JSON.parse(line)]; }
    catch { diagnostics.push(`Malformed JSONL line ${i + 1} in ${path.basename(file)}`); return []; }
  });
}

// Read literal data only. No eval, shell or VM.
export function scriptCalls(source) {
  const file = ts.createSourceFile('audit.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  function literal(n, depth = 0) {
    if (!n || depth > 8) return undefined;
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
    if (n.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (n.kind === ts.SyntaxKind.FalseKeyword) return false;
    // Variables may be shadowed or mutated; do not guess their runtime values.
    if (ts.isIdentifier(n)) return undefined;
    if (ts.isArrayLiteralExpression(n)) return n.elements.map((x) => literal(x, depth + 1));
    if (ts.isObjectLiteralExpression(n)) {
      const v = {};
      for (const p of n.properties) {
        if (ts.isPropertyAssignment(p)) v[p.name.getText(file).replace(/^["']|["']$/g, '')] = literal(p.initializer, depth + 1);
        else if (ts.isShorthandPropertyAssignment(p)) v[p.name.text] = literal(p.name, depth + 1);
        else if (ts.isSpreadAssignment(p)) v.dynamic = true;
      }
      return v;
    }
    return undefined;
  }
  const calls = [];
  function visit(n) {
    if (ts.isCallExpression(n)) {
      const name = n.expression.getText(file);
      const m = name.match(/(?:^|\.)mcp__flowly__flowly_([a-z_]+)$/);
      const a = literal(n.arguments[0]);
      if (m) calls.push({ name: m[1], input: a ?? { dynamic: true } });
      else if (/(?:^|\.)(?:exec_command|apply_patch|write_stdin|shell_command|shell)$/.test(name)) {
        calls.push({ name: name.split('.').at(-1), input: a ?? { dynamic: true }, shell: true });
      }
    }
    ts.forEachChild(n, visit);
  }
  visit(file);
  return calls;
}

function cliCall(source) {
  // Tokenize literal argv without interpreting shell code. Operators/expansions remain unknown.
  const words = [];
  let word = '', started = false, quote = '', dynamic = false;
  const push = () => { if (started) words.push(word); word = ''; started = false; };
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '\\' && quote !== "'") { started = true; word += source[++i] ?? ''; continue; }
    if (quote) {
      if (c === quote) quote = '';
      else { if (quote === '"' && /[$`]/.test(c)) dynamic = true; word += c; }
    } else if (c === "'" || c === '"') { quote = c; started = true; }
    else if (/\s/.test(c)) push();
    else if (/[;&|<>]/.test(c)) { push(); words.push(c); dynamic = true; }
    else { if (/[$`]/.test(c)) dynamic = true; started = true; word += c; }
  }
  push();
  if (quote) dynamic = true;
  const index = words.findIndex((w, i) => /(?:^|\/)flowly\.mjs$/.test(w) && (i === 0 || /(?:^|\/)node$/.test(words[i - 1])));
  if (index < 0) return null;
  let i = index + 1;
  if (words[i] === '--context-file') i += 2;
  const action = words[i++];
  if (!/^(current|status|note|workpad|artifact(?:-remove)?|tags|set-type|idea|next-moves|external|recall|remember)$/.test(action ?? ''))
    return { name: 'cli:unknown', input: { dynamic: true } };
  const status = action === 'status' ? words[i++] : undefined;
  let acknowledgeOpen = false;
  for (; i < words.length; i++) {
    if (words[i] === '--acknowledge-open') acknowledgeOpen = true;
    else if (['--no-outputs','--no-moves'].includes(words[i])) continue;
    else if (/^--[^=]+$/.test(words[i])) i++; // consume a value, including a quoted note containing flag names
    else if (!words[i].startsWith('--')) dynamic = true;
  }
  return { name: 'cli:' + action, input: { status, acknowledgeOpen, dynamic } };
}
function shellInfo(source) {
  return { pr: /\b(?:gh\s+pr|glab\s+mr)\s+create\b/.test(source),
    edits: /\b(?:sed -i|apply_patch|writeFile)|\bcat\s*>>?/.test(source),
    flowly: cliCall(source) };
}

// Export only public evidence, never raw responses or requests.
export function evidence(raw) {
  const result = { receipts: [], artifacts: [], errors: [] };
  function walk(v, depth = 0) {
    if (depth > 12 || v == null) return;
    if (typeof v === 'string') {
      try { walk(JSON.parse(v), depth + 1); }
      catch {
        const start = v.indexOf('{'), end = v.lastIndexOf('}');
        if (start >= 0 && end > start && v.slice(start, end + 1) !== v) {
          try { walk(JSON.parse(v.slice(start, end + 1)), depth + 1); } catch { /* unknown/truncated */ }
        }
      }
      return;
    }
    if (Array.isArray(v)) { v.forEach((x) => walk(x, depth + 1)); return; }
    if (typeof v !== 'object') return;
    if (typeof v.exit_code === 'number' && v.exit_code !== 0) result.errors.push('SHELL_EXIT_NONZERO');
    if (typeof v.code === 'string' && /^[A-Z_]+$/.test(v.code)) result.errors.push(v.code);
    if (typeof v.eventId === 'string' && typeof v.action === 'string') {
      result.receipts.push(Object.fromEntries(['eventId','agentId','taskId','action','status','at','artifactId','artifactIds'].filter((k) => k in v).map((k) => [k, v[k]])));
    }
    if (Array.isArray(v.artifacts)) for (const a of v.artifacts) {
      if (a && typeof a.id === 'string') result.artifacts.push({ id: a.id, role: a.role, target: prUrl(a.target) });
    }
    for (const key of ['receipt','receipts','current','error','content','structuredContent','result','output','text']) if (key in v) walk(v[key], depth + 1);
  }
  walk(raw);
  return result;
}

function userText(row, provider, eventUsers) {
  if (row.isMeta || row.isSidechain || row.isCompactSummary || row.promptSource === 'system'
    || row.turnOrigin === 'task_notification' || row.origin?.kind === 'task-notification') return '';
  let value;
  if (provider === 'claude' && row.type === 'user') value = row.message?.content;
  if (provider === 'codex' && eventUsers && row.type === 'event_msg' && row.payload?.type === 'user_message') value = row.payload.message;
  if (provider === 'codex' && !eventUsers && row.payload?.type === 'message' && row.payload.role === 'user') value = row.payload.content;
  let text = typeof value === 'string' ? value : Array.isArray(value) ? value.filter((c) => c.type === 'text' || c.type === 'input_text').map((c) => c.text ?? '').join('\n') : '';
  const image = Array.isArray(value) && value.some((c) => ['image','input_image'].includes(c.type))
    || provider === 'codex' && row.type === 'event_msg' && row.payload?.type === 'user_message'
      && (row.payload.images?.length || row.payload.local_images?.length);
  if (!text && image) text = '[image-only user turn]';
  return /^(?:<paseo-system|<task-notification|<local-command|<command-name>|<command-message|<ide_opened_file|<ide_selection|<chat-history-summary|\[Request interrupted|# AGENTS\.md|<environment_context>)/.test(text.trim()) ? '' : text;
}

export function parseTurns(rows, session) {
  const turns = [], pending = new Map();
  const eventUsers = rows.some((r) => r.type === 'event_msg' && r.payload?.type === 'user_message');
  let turn;
  function attempt(call) {
    turn.flowly.push(call.name);
    const a = call.input;
    if (['update_status','cli:status'].includes(call.name) && (a.status === 'in_review' || a.dynamic && a.status === undefined)) {
      const kind = a.dynamic ? 'unknown' : a.acknowledgeOpen === true ? turn.refused ? 'after-refusal' : 'upfront'
        : turn.refused ? turn.repaired ? 'repaired' : 'after-refusal-no-ack' : 'none';
      turn.acknowledgements.push({ kind });
    }
  }
  function call(id, list) {
    let pr = false, flowly = false, registration = false;
    const ackStart = turn.acknowledgements.length;
    for (const c of list) {
      if (!c.shell) {
        attempt(c); flowly = true;
        if (['add_artifact','update_status','report_progress'].includes(c.name)) registration = true;
        continue;
      }
      let cmd = typeof c.input === 'string' ? c.input : c.input?.cmd ?? c.input?.command;
      if (['exec_command','shell_command','shell'].includes(c.name) && (c.input?.dynamic === true || cmd === undefined)) {
        turn.unknownShellCalls++; continue;
      }
      if (Array.isArray(cmd)) {
        if (cmd.length === 3 && /(?:^|\/)(?:bash|sh|zsh)$/.test(cmd[0]) && ['-lc','-c'].includes(cmd[1]) && typeof cmd[2] === 'string') cmd = cmd[2];
        else { turn.unknownShellCalls++; continue; }
      }
      if (typeof cmd !== 'string') { turn.unknownShellCalls++; continue; }
      const info = shellInfo(cmd);
      if (info.pr) { turn.prAttempts++; pr = true; }
      if (info.edits || c.name === 'apply_patch') turn.edits++;
      if (info.flowly) {
        attempt(info.flowly); flowly = true;
        if (['cli:artifact','cli:status','cli:note','cli:unknown'].includes(info.flowly.name)) registration = true;
      }
    }
    // Multiple calls in an exec may be parallel/conditional: source order is not execution order.
    if (list.filter((c) => !c.shell).length > 1)
      for (const a of turn.acknowledgements.slice(ackStart)) a.kind = 'unknown';
    pending.set(id, { turn, pr, flowly, registration, answered: false });
  }
  function response(id, raw, failed = false) {
    const use = pending.get(id);
    if (!use) return;
    use.answered = true;
    const ev = evidence(raw), t = use.turn;
    t.receipts.push(...ev.receipts); t.artifacts.push(...ev.artifacts); t.errors.push(...ev.errors);
    if (use.registration && !ev.receipts.some((r) => ['status','progress','artifact'].includes(r.action)) && !ev.errors.length)
      t.unverifiedRegistration = true;
    for (const r of ev.receipts) if (!t.receiptArtifacts[r.eventId] && ev.artifacts.length)
      t.receiptArtifacts[r.eventId] = ev.artifacts;
    if (use.flowly && ev.errors.some((c) => c === 'WORKPAD_OPEN' || c === 'SETUP_INCOMPLETE')) t.refused = true;
    if (t.refused && ev.receipts.some((r) => r.action === 'workpad')) t.repaired = true;
    if (use.pr && !failed && !ev.errors.length) {
      t.openedPrUrls.push(...urls(typeof raw === 'string' ? raw : JSON.stringify(raw)));
    }
  }
  for (const row of rows) {
    const text = userText(row, session.provider, eventUsers);
    if (text && date(row.timestamp)) {
      if (turn) turn.until = instant(row.timestamp);
      turn = { session: session.id, taskId: session.taskId, model: session.model, provider: session.provider,
        at: instant(row.timestamp), until: null, first: turns.length === 0, createdAt: session.createdAt,
        flowly: [], prAttempts: 0, edits: 0, unknownShellCalls: 0, openedPrUrls: [], receipts: [], artifacts: [], receiptArtifacts: {}, errors: [], acknowledgements: [], refused: false, repaired: false };
      turns.push(turn); continue;
    }
    if (!turn) continue;
    if (session.provider === 'claude') {
      const content = row.message?.content;
      if (!Array.isArray(content)) continue;
      for (const c of content) {
        if (row.type === 'assistant' && c.type === 'tool_use') {
          if (c.name?.startsWith('mcp__flowly__flowly_')) call(c.id, [{ name: c.name.replace(/^mcp__flowly__flowly_/, ''), input: c.input ?? {} }]);
          else if (c.name === 'Bash') call(c.id, [{ name: 'exec_command', input: c.input, shell: true }]);
          else if (['Write','Edit','MultiEdit','NotebookEdit'].includes(c.name)) turn.edits++;
        } else if (c.type === 'tool_result') response(c.tool_use_id, c.content, c.is_error);
      }
    } else {
      const p = row.payload ?? {};
      if (p.type === 'function_call' || p.type === 'custom_tool_call') {
        if (/mcp__flowly__flowly_/.test(p.name ?? '')) {
          let a; try { a = JSON.parse(p.arguments ?? p.input); } catch { a = { dynamic: true }; }
          call(p.call_id, [{ name: p.name.replace(/^.*mcp__flowly__flowly_/, ''), input: a }]);
        } else if (/^(?:functions\.)?exec$/.test(p.name ?? '')) call(p.call_id, scriptCalls(p.input ?? p.arguments ?? ''));
        else if (/(?:^|\.)(?:exec_command|apply_patch|write_stdin|shell_command|shell)$/.test(p.name ?? '')) {
          let a; try { a = JSON.parse(p.arguments ?? p.input); } catch { a = p.input ?? p.arguments; }
          call(p.call_id, [{ name: p.name.split('.').at(-1), input: a, shell: true }]);
        }
      } else if (p.type === 'function_call_output' || p.type === 'custom_tool_call_output') response(p.call_id, p.output);
    }
  }
  for (const p of pending.values()) if (p.registration && !p.answered) p.turn.unresolvedRegistration = true;
  return turns;
}

export function calibrate(turns, board, o) {
  const known = new Map((board.artifacts ?? []).map((a) => [a.id, a]));
  for (const t of turns) for (const a of t.artifacts) known.set(a.id, a);
  return turns.filter((t) => t.at >= o.since && t.at < o.until).map((t) => {
    const until = t.until && t.until < o.until ? t.until : o.until;
    const receipts = [...t.receipts, ...(board.agentReceipts ?? []).filter((r) => r.agentId === t.session && r.taskId === t.taskId)];
    const unique = new Map(receipts.filter((r) => date(r.at) && instant(r.at) >= t.at && instant(r.at) < until && (!r.agentId || r.agentId === t.session) && (!r.taskId || r.taskId === t.taskId))
      .map((r) => [r.eventId || JSON.stringify([r.agentId,r.taskId,r.action,r.at,r.artifactId,r.artifactIds]), r]));
    const flowly = t.flowly.length ? t.flowly : [...new Set([...unique.values()].map((r) => 'receipt:' + r.action))];
    const registeredPrUrls = new Set(), unknownArtifactIds = new Set();
    for (const r of unique.values()) for (const id of [...(r.artifactIds ?? []), ...(r.artifactId ? [r.artifactId] : [])]) {
      // Prefer the role at delivery time over a later human promotion/demotion.
      const a = t.receiptArtifacts[r.eventId]?.find((v) => v.id === id) ?? known.get(id);
      if (!a) unknownArtifactIds.add(id);
      else if (a.role === 'output' && prUrl(a.target)) registeredPrUrls.add(prUrl(a.target));
    }
    const openedPrUrls = [...new Set(t.openedPrUrls)];
    const missing = openedPrUrls.filter((url) => !registeredPrUrls.has(url));
    return { session: t.session, taskId: t.taskId, model: t.model, provider: t.provider, at: t.at, first: t.first,
      age: date(t.createdAt) ? instant(t.createdAt) < o.since ? 'old' : 'new' : 'unknown',
      sample: o.testSessions.includes(t.session) ? 'test' : o.realSessions.includes(t.session) ? 'real' : 'unclassified',
      flowly, edits: t.edits, unknownShellCalls: t.unknownShellCalls, prAttempts: t.prAttempts, openedPrUrls, registeredPrUrls: [...registeredPrUrls],
      unknownArtifactIds: [...unknownArtifactIds], errors: t.errors, acknowledgements: t.acknowledgements,
      receipts: [...unique.values()].map((r) => ({ eventId: r.eventId, action: r.action, status: r.status, at: r.at })),
      prRegistration: !t.prAttempts ? 'not-applicable' : !openedPrUrls.length ? 'unknown-creation'
        : !missing.length ? 'pass' : unknownArtifactIds.size || t.unresolvedRegistration || t.unverifiedRegistration || t.unknownShellCalls ? 'unknown-registration' : 'missing', missingPrUrls: missing };
  });
}

export function summarize(turns) {
  const later = turns.filter((t) => !t.first), pr = turns.filter((t) => t.openedPrUrls.length && t.prAttempts);
  return { turns: turns.length, first: turns.length - later.length, later: later.length,
    laterObservable: later.filter((t) => t.flowly.length || !t.unknownShellCalls).length,
    laterNoFlowly: later.filter((t) => !t.flowly.length && !t.unknownShellCalls).length,
    laterUnknownFlowly: later.filter((t) => !t.flowly.length && t.unknownShellCalls).length,
    laterUnknownShell: later.filter((t) => t.unknownShellCalls).length,
    editedLater: later.filter((t) => t.edits).length, editedLaterNoFlowly: later.filter((t) => t.edits && !t.flowly.length).length,
    prAttemptTurns: turns.filter((t) => t.prAttempts).length, confirmedPrTurns: pr.length,
    allPrsRegistered: pr.filter((t) => t.prRegistration === 'pass').length,
    unknownPrTurns: turns.filter((t) => t.prRegistration.startsWith('unknown')).length,
    missingPrTurns: turns.filter((t) => t.prRegistration === 'missing').length,
    deliveries: turns.reduce((n,t) => n + t.receipts.filter((r) => r.status === 'in_review' && r.action === 'status').length, 0),
    acknowledgements: turns.flatMap((t) => t.acknowledgements).reduce((a, k) => ({ ...a, [k.kind]: (a[k.kind] ?? 0) + 1 }), {}) };
}

export function audit(o) {
  const diagnostics = [], board = JSON.parse(fs.readFileSync(path.join(o.data, 'board.json'), 'utf8'));
  const flowFile = path.join(o.data, 'flow', o.project + '.jsonl');
  const flow = fs.existsSync(flowFile) ? jsonl(flowFile, diagnostics) : [];
  if (!fs.existsSync(flowFile)) diagnostics.push('Full project flow log missing; deleted-card project membership is unavailable.');
  const tasks = new Map((board.tasks ?? []).map((t) => [t.id, t]));
  const historicalTasks = new Set(flow.map((e) => e.taskId));
  const roots = o.provider === 'claude' ? [path.join(o.home, '.claude/projects')]
    : [path.join(o.home, '.codex/sessions'), path.join(o.home, '.codex/archived_sessions')];
  const transcripts = new Map();
  for (const f of roots.flatMap((root) => files(root, '.jsonl'))) {
    const m = path.basename(f).match(/([\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12})\.jsonl$/i);
    if (m) transcripts.set(m[1], f);
  }
  const turns = [];
  let sessions = 0;
  for (const f of files(path.join(o.home, '.paseo/agents'), '.json')) {
    let a; try { a = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { diagnostics.push('Malformed agent metadata: ' + path.basename(f)); continue; }
    const taskId = a.labels?.['flowly-task'];
    if (a.provider !== o.provider || !taskId || a.labels?.['paseo.parent-agent-id']) continue;
    if (tasks.has(taskId) ? tasks.get(taskId).projectId !== o.project : !historicalTasks.has(taskId)) continue;
    const transcript = transcripts.get(a.persistence?.sessionId);
    if (!transcript) { diagnostics.push('Missing transcript for session ' + a.id); continue; }
    sessions++;
    turns.push(...parseTurns(jsonl(transcript, diagnostics), { id: a.id, taskId, createdAt: a.createdAt, model: a.config?.model ?? '?', provider: o.provider }));
  }
  const selected = calibrate(turns, board, o).sort((a,b) => a.at.localeCompare(b.at));
  const groups = new Map();
  for (const t of selected) {
    const key = JSON.stringify([t.model, t.sample, t.age]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  return { method: 'v2: turn-time window; shell commands and Codex call expressions are source observations, not execution proof; registration requires a receipt and matching output artifact',
    provider: o.provider, project: o.project, since: o.since, until: o.until, sessionsRead: sessions,
    sessionsInWindow: new Set(selected.map((t) => t.session)).size, summary: summarize(selected),
    groups: [...groups.values()].map((g) => ({ model: g[0].model, sample: g[0].sample, age: g[0].age, ...summarize(g) })),
    diagnostics, turns: selected };
}

export function runAudit(provider) {
  try {
    const o = options(process.argv.slice(2), provider), result = audit(o);
    if (o.json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`# ${provider} Flowly audit v2, turns in [${o.since}, ${o.until})\n${result.method}`);
      console.log(`sessions in window: ${result.sessionsInWindow}; ${JSON.stringify(result.summary)}`);
      for (const g of result.groups) console.log(JSON.stringify(g));
      for (const d of result.diagnostics) console.log('UNVERIFIED: ' + d);
      if (o.turns) for (const t of result.turns) console.log(JSON.stringify(t));
    }
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
