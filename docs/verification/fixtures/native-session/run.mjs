// Native session live fixture. Run `setup` to create and retain, `check-context` for A2,
// and `cleanup` after UI checks. All created resources are recorded before dependent work.
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { DaemonClient } from '@getpaseo/client/internal/daemon-client';
import { createPaseoApi } from '@getpaseo/client';

const model = 'claude/claude-haiku-5-5';
const out = new URL('./evidence.json', import.meta.url);
const idsPath = '/Users/bofan.wang/Developer/personal/paseo-utlra-kanban/docs/promo/ids.json';
const saved = async () => { try { return JSON.parse(await readFile(out, 'utf8')); } catch { return null; } };
const ev = await saved() ?? { model, startedAt: new Date().toISOString(), steps: [], created: {} };
const client = new DaemonClient({ url: 'ws://127.0.0.1:6767/ws', clientId: `ns-${randomUUID()}`, clientType: 'cli', appVersion: '0.11.2', connectTimeoutMs: 10000, reconnect: { enabled: false } });
const api = createPaseoApi(client);
const rpc = (m, i = {}) => client.invokePluginRpc('flowly', m, i);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = async (step, data = {}) => { ev.steps.push({ at: new Date().toISOString(), step, ...data }); await writeFile(out, JSON.stringify(ev, null, 2)); console.log(step, JSON.stringify(data)); };
const snap = async (id) => (await api.agents.ref(id).refresh())?.agent;
const timeline = async (id) => (await api.agents.ref(id).timeline.refetch({ direction: 'tail', limit: 50, projection: 'projected' })).entries ?? [];
const mode = process.argv[2] ?? 'setup';

try {
  await client.connect();
  if (mode === 'observe') {
    const c = ev.created;
    if (!c?.managedAgentId || !c?.unmanagedAgentId) throw new Error('Fixture is not ready');
    const board = await rpc('board.read', {});
    const summary = (await rpc('summaries.read', {})).latest?.find((x) => x.taskId === c.cardId) ?? null;
    const managedState = await snap(c.managedAgentId);
    const unmanagedState = await snap(c.unmanagedAgentId);
    const managedRows = await timeline(c.managedAgentId);
    const unmanagedRows = await timeline(c.unmanagedAgentId);
    const managedRow = managedRows.map((x) => x.item).filter((x) => x.type === 'plugin' && x.kind === 'flowly-summary').at(-1) ?? null;
    const unmanagedRow = unmanagedRows.map((x) => x.item).find((x) => x.type === 'plugin' && x.kind === 'flowly-summary') ?? null;
    const legacyManagedRows = managedRows.map((x) => x.item).filter((x) => x.type === 'plugin' && x.kind === 'flowly.summary').map((x) => x.id);
    const chips = await rpc('sessions.native-chips', {});
    const result = {
      cardPresent: board.tasks.some((x) => x.id === c.cardId),
      managedStatus: managedState?.status, unmanagedStatus: unmanagedState?.status,
      summary, managedRow, unmanagedRow,
      legacyManagedRows,
      managedRowMatchesSummary: !!summary && !!managedRow && managedRow.data?.entryId === summary.id && ['state', 'target', 'recap', 'next', 'model', 'at'].every((k) => managedRow.data?.[k] === summary[k]),
      managedAttentionAfterAppend: { requiresAttention: managedState?.requiresAttention ?? null, attentionReason: managedState?.attentionReason ?? null },
      nativeChipMembership: { managed: chips.managed.some((x) => x.agentId === c.managedAgentId), unmanaged: chips.managed.some((x) => x.agentId === c.unmanagedAgentId), ideasEnabled: chips.ideas, autoWrapup: chips.autoWrapup },
      ideaCount: board.ideas.filter((x) => x.taskId === c.cardId && x.status === 'open').length,
      taskEvents: board.events.filter((x) => x.taskId === c.cardId).map((x) => ({ id: x.id, action: x.action, reportKind: x.reportKind, kind: x.kind, note: x.note, data: x.data }))
    };
    ev.created.summaryEntryId = summary?.id ?? null;
    ev.testSessionId = 'e63b5616-a0db-47cd-9b11-4c3691dcde10';
    await log('fixture-observed', result);
  } else if (mode === 'regenerate') {
    const c = ev.created;
    if (!c?.managedAgentId || !c?.summaryEntryId) throw new Error('Fixture is not ready');
    const beforeEntries = (await rpc('summaries.read', {})).latest ?? [];
    const previous = beforeEntries.find((x) => x.taskId === c.cardId);
    const agent = api.agents.ref(c.managedAgentId);
    const turn = await agent.run('No file edits. Use flowly_report_progress to report a new result for this fixture, preserving two message moves: Verify → "Verify the native session summary and chips." and Commit → "Commit the verified changes." Do not set moveTo. Return a concise confirmation.');
    await log('regeneration-turn-returned', { status: turn.status, previousSummaryId: previous?.id ?? null });
    let beforeRowAttention = null, nextSummary = null, row = null, status;
    for (let i = 0; i < 180; i++) {
      await sleep(1000);
      const state = await snap(c.managedAgentId);
      status = state?.status;
      const rows = await timeline(c.managedAgentId);
      row = rows.map((x) => x.item).find((x) => x.type === 'plugin' && x.kind === 'flowly-summary' && x.data?.taskId === c.cardId) ?? null;
      nextSummary = (await rpc('summaries.read', {})).latest?.find((x) => x.taskId === c.cardId) ?? null;
      if (!beforeRowAttention && status === 'idle' && nextSummary?.id === previous?.id) beforeRowAttention = { requiresAttention: state?.requiresAttention ?? null, attentionReason: state?.attentionReason ?? null, at: new Date().toISOString() };
      if (nextSummary && nextSummary.id !== previous?.id && row?.data?.entryId === nextSummary.id) {
        const after = await snap(c.managedAgentId);
        c.previousSummaryId = previous?.id ?? null;
        c.summaryEntryId = nextSummary.id;
        c.beforeRowAttention = beforeRowAttention;
        c.afterRowAttention = { requiresAttention: after?.requiresAttention ?? null, attentionReason: after?.attentionReason ?? null, at: new Date().toISOString() };
        await log('new-kind-summary-row', { status, summary: nextSummary, row, beforeRowAttention, afterRowAttention: c.afterRowAttention, attentionUnchangedAcrossAppend: !!beforeRowAttention && beforeRowAttention.requiresAttention === c.afterRowAttention.requiresAttention && beforeRowAttention.attentionReason === c.afterRowAttention.attentionReason });
        break;
      }
    }
    if (!nextSummary || nextSummary.id === previous?.id || row?.data?.entryId !== nextSummary?.id) throw new Error('Timed out waiting for a new flowly-summary row');
  } else if (mode === 'setup') {
    if (ev.created.cardId) throw new Error(`Evidence already has fixture card ${ev.created.cardId}; cleanup it before setup.`);
    const ids = JSON.parse(await readFile(idsPath, 'utf8'));
    const card = await rpc('tasks.create', { projectId: ids.project.id, operationId: `native-session-${randomUUID()}`, mode: 'directory', status: 'todo', priority: 'normal', title: `[test] native session ${randomUUID().slice(0, 8)}`, description: 'Disposable native session acceptance fixture. No source edits.' });
    ev.created = { cardId: card.id, workspaceId: card.workspaceId, cardTitle: card.title, createdAt: new Date().toISOString() };
    await writeFile(out, JSON.stringify(ev, null, 2));
    await log('card-created', ev.created);

    const prep = await rpc('tools.prepare-session', { id: card.id, operationId: `native-session-managed-${randomUUID()}` });
    ev.created.managedAgentId = prep.agentId;
    await writeFile(out, JSON.stringify(ev, null, 2));
    const managed = await api.workspaces.ref(card.workspaceId).agents.create({
      agentId: prep.agentId, idempotencyKey: `ultra-kanban-session:${prep.agentId}`, title: '[test] native session managed',
      labels: { 'ultra-kanban-task': card.id },
      config: { provider: model, modeId: 'bypassPermissions', systemPrompt: prep.instructions, mcpServers: { 'ultra-kanban': prep.mcp } },
      env: { ULTRA_KANBAN_CONTEXT_FILE: prep.contextFile, ULTRA_KANBAN_CLI: prep.cliPath, ULTRA_KANBAN_SKILL: prep.skillPath },
      prompt: 'Use the Flowly tools for this fixture only. Make no file edits. Set the card stage to in_progress. Propose exactly one idea with flowly_propose_idea, scope here, titled "Verify native progress card". Then deliver using flowly_report_progress with kind=result and nextMoves containing exactly two message moves: label "Verify", prompt "Verify the native session summary and chips."; label "Commit", prompt "Commit the verified changes." Do not set moveTo. Report briefly when all tool calls are complete.'
    });
    ev.created.managedAgentId = managed.id;
    await writeFile(out, JSON.stringify(ev, null, 2));
    await log('managed-session-created', { agentId: managed.id });

    const unmanaged = await api.workspaces.ref(card.workspaceId).agents.create({
      title: '[test] native session unmanaged', config: { provider: model, modeId: 'bypassPermissions' }, prompt: 'Reply OK.'
    });
    ev.created.unmanagedAgentId = unmanaged.id;
    await writeFile(out, JSON.stringify(ev, null, 2));
    await log('unmanaged-session-created', { agentId: unmanaged.id });

    let managedState, unmanagedState, summary;
    for (let i = 0; i < 180; i++) {
      await sleep(2000);
      managedState = await snap(managed.id);
      unmanagedState = await snap(unmanaged.id);
      summary = (await rpc('summaries.read', {})).latest?.find((x) => x.taskId === card.id);
      const rows = await timeline(managed.id);
      const row = rows.map((x) => x.item).find((x) => x.type === 'plugin' && x.kind === 'flowly.summary');
      if (managedState?.status === 'idle' && unmanagedState?.status === 'idle' && summary && row) {
        ev.created.summaryEntryId = summary.id;
        const attention = { requiresAttention: managedState.requiresAttention ?? null, attentionReason: managedState.attentionReason ?? null };
        ev.created.attentionAfterAppend = attention;
        const chips = await rpc('sessions.native-chips', {});
        const matched = (chips.managed ?? []).filter((x) => x.agentId === managed.id || x.agentId === unmanaged.id);
        await log('initial-turn-and-summary', { managedStatus: managedState.status, unmanagedStatus: unmanagedState.status, summary, timelineRow: row, attention, managedChipMembership: matched, nativeChips: { ideas: chips.ideas, autoWrapup: chips.autoWrapup } });
        break;
      }
    }
    if (!summary || managedState?.status !== 'idle' || unmanagedState?.status !== 'idle') throw new Error('Timed out waiting for both sessions idle and summary version');
    ev.testSessionId = process.env.PASEO_AGENT_ID ?? null;
    await log('fixture-ready', { cardId: card.id, workspaceId: card.workspaceId, managedAgentId: managed.id, unmanagedAgentId: unmanaged.id, summaryEntryId: summary.id });
  } else if (mode === 'check-context') {
    const c = ev.created;
    if (!c?.managedAgentId || !c.summaryEntryId) throw new Error('Fixture is not ready');
    const before = (await rpc('summaries.read', {})).latest?.find((x) => x.id === c.summaryEntryId);
    const pre = await snap(c.managedAgentId);
    const preAttention = { requiresAttention: pre?.requiresAttention ?? null, attentionReason: pre?.attentionReason ?? null };
    const a = api.agents.ref(c.managedAgentId);
    const contextPrompt = 'Without using tools, list the items you remember from the previous user request. Do not guess or infer.';
    const turn = await a.run(contextPrompt);
    const post = await snap(c.managedAgentId);
    const rows = await timeline(c.managedAgentId);
    const items = rows.map((x) => x.item);
    const stateText = [before?.state, before?.target, before?.recap, before?.next].filter(Boolean);
    const assistantText = items.filter((x) => x.type === 'assistant_message').map((x) => x.text ?? '').filter(Boolean);
    const lastAssistantText = assistantText.at(-1) ?? '';
    const quotedSummaryInReply = stateText.some((s) => assistantText.slice(-5).some((reply) => reply.includes(s)));
    const promptIndex = items.map((x, i) => ({ x, i })).filter(({ x }) => x.type === 'user_message' && x.text === contextPrompt).at(-1)?.i ?? items.length;
    const toolCallsAfterPrompt = items.slice(promptIndex + 1).filter((x) => x.type === 'tool_call').map((x) => x.name);
    await log('context-echo-check', { runStatus: turn.status, preAttention, postAttention: { requiresAttention: post?.requiresAttention ?? null, attentionReason: post?.attentionReason ?? null }, summaryStateText: before?.state ?? null, lastAssistantText, toolCallsAfterPrompt, quotedSummaryInReply, note: 'Attention before/after append was checked during regenerate mode.' });
  } else if (mode === 'propose-second') {
    const c = ev.created;
    if (!c?.managedAgentId) throw new Error('Fixture is not ready');
    const agent = api.agents.ref(c.managedAgentId);
    const turn = await agent.run('No file edits. Use Flowly tools to propose exactly one additional idea for a new task. Title: "Document session summary troubleshooting". Detail: "Write a short troubleshooting guide for missing Progress cards in native Paseo sessions, including the managed-session requirement and the daemon restart limitation." Rationale: "Operators need to know whether a missing card indicates an unsupported session or a timeline rebuild." Context: "Docs only; no source edits." Scope: here. Do not update task status or report progress. Return only a short confirmation.');
    const board = await rpc('board.read', {});
    const ideas = board.ideas.filter((x) => x.taskId === c.cardId && x.status === 'open');
    c.secondIdeaId = ideas.find((x) => x.title === 'Document session summary troubleshooting')?.id ?? null;
    await log('second-idea-proposed', { turnStatus: turn.status, openIdeas: ideas.map((x) => ({ id: x.id, title: x.title, scope: x.scope })), secondIdeaId: c.secondIdeaId });
    if (!c.secondIdeaId) throw new Error('Second open idea was not created');
  } else if (mode === 'done-move') {
    const c = ev.created;
    if (!c?.managedAgentId) throw new Error('Fixture is not ready');
    const agent = api.agents.ref(c.managedAgentId);
    const turn = await agent.run('No file edits. Use flowly_update_status to deliver this fixture card to in_review with a concise note and nextMoves exactly [{label:"Move to Done", moveTo:"done"}]. Set acknowledgeOpen:true only if the tool requires it. Do not move the card to Done yourself; wait for the user to choose the suggestion.');
    const board = await rpc('board.read', {});
    const task = board.tasks.find((x) => x.id === c.cardId);
    const moves = board.events.filter((x) => x.taskId === c.cardId && x.action === 'next_moves_suggested').at(-1);
    await log('move-to-done-suggestion-ready', { turnStatus: turn.status, taskStatus: task?.status, taskRevision: task?.revision, latestMovesEvent: moves ? { id: moves.id, moves: moves.moves } : null, autoWrapup: (await rpc('sessions.native-chips', {})).autoWrapup });
    if (task?.status !== 'in_review' || !moves?.moves?.some((x) => x.label === 'Move to Done' && x.moveTo === 'done')) throw new Error('Move to Done suggestion was not stored as expected');
  } else if (mode === 'post-cleanup-readback') {
    const c = ev.created;
    const board = await rpc('board.read', {});
    const managedState = c?.managedAgentId ? await snap(c.managedAgentId) : null;
    const unmanagedState = c?.unmanagedAgentId ? await snap(c.unmanagedAgentId) : null;
    const managedRows = c?.managedAgentId ? await timeline(c.managedAgentId) : [];
    const unmanagedRows = c?.unmanagedAgentId ? await timeline(c.unmanagedAgentId) : [];
    const sendText = 'Edited in Paseo: verify the native summary card exactly.';
    const messages = managedRows.map((x) => x.item).filter((x) => x.type === 'user_message').map((x) => x.text ?? x.content ?? '');
    const flowlyRows = managedRows.map((x) => x.item).filter((x) => x.type === 'plugin' && x.kind === 'flowly-summary');
    const chips = await rpc('sessions.native-chips', {});
    const workspaceLs = (await import('node:child_process')).execFileSync('paseo', ['workspace', 'ls'], { encoding: 'utf8' });
    await log('post-cleanup-readback', {
      taskAbsentFromBoard: !board.tasks.some((x) => x.id === c.cardId),
      exactNextMoveMessageInNativeTimeline: messages.includes(sendText),
      exactNextMoveMessage: messages.find((x) => x === sendText) ?? null,
      newKindSummaryRows: flowlyRows.map((x) => ({ id: x.id, data: x.data })),
      unmanagedSummaryRows: unmanagedRows.map((x) => x.item).filter((x) => x.type === 'plugin' && x.kind === 'flowly-summary').map((x) => x.id),
      managedArchivedAt: managedState?.archivedAt ?? null,
      unmanagedArchivedAt: unmanagedState?.archivedAt ?? null,
      managedChipListedAfterCleanup: chips.managed.some((x) => x.agentId === c.managedAgentId),
      unmanagedChipListedAfterCleanup: chips.managed.some((x) => x.agentId === c.unmanagedAgentId),
      workspaceStillRegistered: workspaceLs.includes(c.workspaceId),
    });
  } else if (mode === 'final-board-check') {
    const board = await rpc('board.read', {});
    const workspaceLs = (await import('node:child_process')).execFileSync('paseo', ['workspace', 'ls'], { encoding: 'utf8' });
    await log('final-board-check', {
      cancelledIdeaTaskCreated: board.tasks.some((x) => x.title === 'Document session summary troubleshooting'),
      fixtureCardPresent: board.tasks.some((x) => x.id === ev.created.cardId),
      fixtureWorkspaceRegistered: workspaceLs.includes(ev.created.workspaceId),
      matchingProjectTaskCount: board.tasks.filter((x) => x.projectId === '3db2ad5b-e6c4-4054-b2ed-a13a8dfa0663').length,
    });
  } else if (mode === 'cleanup') {
    const c = ev.created;
    if (c?.cardId) {
      const board = await rpc('board.read', {});
      const task = board.tasks.find((x) => x.id === c.cardId);
      if (task) await log('cleanup-delete', await rpc('tasks.delete', { id: task.id, revision: task.revision, archive: true, acknowledgeWarnings: true }));
      await sleep(2500);
      const after = await rpc('board.read', {});
      const statuses = {};
      for (const id of [c.managedAgentId, c.unmanagedAgentId].filter(Boolean)) statuses[id] = { archivedAt: (await snap(id))?.archivedAt ?? null };
      const workspaceLs = await (await import('node:child_process')).execFileSync('paseo', ['workspace', 'ls'], { encoding: 'utf8' });
      ev.cleanup = { cardOnBoard: after.tasks.some((x) => x.id === c.cardId), sessions: statuses, workspaceListed: workspaceLs.includes(c.workspaceId), workspaceId: c.workspaceId, verifiedAt: new Date().toISOString() };
      await log('cleanup-verify', ev.cleanup);
    } else await log('cleanup-verify', { cardCreated: false });
  } else throw new Error(`Unknown mode ${mode}`);
} catch (e) {
  await log('error', { message: String(e?.message ?? e) });
  process.exitCode = 1;
} finally {
  ev.endedAt = new Date().toISOString();
  await writeFile(out, JSON.stringify(ev, null, 2));
  await api.dispose().catch(() => {});
  await client.close().catch(() => {});
}
