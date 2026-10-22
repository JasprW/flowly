import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { audit, calibrate, evidence, options, parseTurns, scriptCalls, summarize } from './audit-core.mjs';

const t0 = '2026-10-21T00:00:00.000Z', t1 = '2026-10-22T00:00:00.000Z', t2 = '2026-10-22T01:00:00.000Z';
const o = { since: t1, until: t2, testSessions: [], realSessions: [] };
const s = { id: 's', taskId: 't', model: 'sonnet', provider: 'claude', createdAt: t0 };
const pr = 'https://github.com/owner/repo/pull/7';
const artifact = { id: 'a', taskId: 't', role: 'output', target: pr };
const receipt = { agentId: 's', taskId: 't', eventId: 'e', at: '2026-10-22T00:02:00.000Z', action: 'status', status: 'in_review', artifactIds: ['a'] };
const user = (at, text = 'do work') => ({ type: 'user', timestamp: at, message: { content: text } });
const tool = (id, name, input = {}) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } });
const reply = (id, value, is_error = false) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: typeof value === 'string' ? value : JSON.stringify(value), is_error }] } });
const flow = (id, input) => tool(id, 'mcp__flowly__flowly_update_status', { status: 'in_review', ...input });
const created = [tool('p', 'Bash', { command: 'gh pr create --title fixture' }), reply('p', pr)];
const parsed = (rows, board = {}, opts = o) => calibrate(parseTurns(rows, s), board, opts);

test('window selects turns in old sessions without relabelling them as first', () => {
  const turns = parsed([user(t0), tool('g','mcp__flowly__flowly_get_task'), user(t1), ...created, user(t2)]);
  assert.equal(turns.length, 1);
  assert.equal(turns[0].first, false);
  assert.equal(turns[0].age, 'old');
  assert.equal(summarize(turns).laterNoFlowly, 1);
});
test('outputs receipt plus matching output artifact confirms success; replays deduplicate', () => {
  const rows = [user(t1), ...created, flow('d',{ outputs: [{ target: pr }] }), reply('d', { receipt, current: { artifacts: [artifact] } }), flow('r',{}), reply('r', { receipt })];
  const [t] = parsed(rows, { agentReceipts: [receipt], artifacts: [artifact] });
  assert.equal(t.prRegistration, 'pass');
  assert.equal(t.receipts.length, 1);
  assert.deepEqual(t.registeredPrUrls, [pr]);
});
test('failed output attempt and unrelated PR output are not success', () => {
  const [t] = parsed([user(t1), ...created, flow('d',{outputs:[{target:pr}]}), reply('d',{code:'EXTERNAL_UNAVAILABLE'}, true)]);
  assert.equal(t.prRegistration, 'missing');
  assert.deepEqual(t.errors, ['EXTERNAL_UNAVAILABLE']);
  const [other] = parsed([user(t1), ...created, flow('d',{}), reply('d',{receipt})], { artifacts:[{...artifact,target:pr.replace('/7','/8')}] });
  assert.equal(other.prRegistration, 'missing');
});
test('standalone artifact and CLI receipts use artifactId; input role cannot count', () => {
  const r = { ...receipt, action: 'artifact', artifactIds: undefined, artifactId: 'a' };
  const rows = [user(t1), ...created, tool('a','Bash',{command:"node '/x/flowly.mjs' --context-file '/x/context' artifact --role output --target '" + pr + "'"}), reply('a',{receipt:r})];
  assert.equal(parsed(rows,{artifacts:[artifact]})[0].prRegistration,'pass');
  assert.equal(parsed(rows,{artifacts:[{...artifact,role:'input'}]})[0].prRegistration,'missing');
});
test('missing historical artifact is unknown; previous-turn receipt cannot prove registration this turn', () => {
  const rows = [user(t1), ...created, flow('d',{}), reply('d',{receipt})];
  assert.equal(parsed(rows)[0].prRegistration,'unknown-registration');
  // A stale board replay cannot override the current successful response.
  assert.equal(parsed(rows,{artifacts:[artifact],agentReceipts:[{...receipt,at:t0}]})[0].prRegistration,'pass');
  const [old] = parsed([user(t1),...created,flow('d',{}),reply('d',{receipt:{...receipt,at:t0}})],{artifacts:[artifact]});
  assert.equal(old.prRegistration,'missing');
});
test('all opened full URLs must match, not just one PR number', () => {
  const other = 'https://git.example/team/repo/-/merge_requests/7';
  const [t] = parsed([user(t1),tool('p','Bash',{command:'glab mr create'}),reply('p', pr+'\n'+other),flow('d',{}),reply('d',{receipt})],{artifacts:[artifact]});
  assert.equal(t.prRegistration,'missing');
  assert.deepEqual(t.missingPrUrls,[other]);
});
test('a later artifact role change cannot turn an input-only delivery into historical success', () => {
  const [t]=parsed([user(t1),...created,flow('d',{}),reply('d',{receipt,current:{artifacts:[{...artifact,role:'input'}]}})],{artifacts:[artifact]});
  assert.equal(t.prRegistration,'missing');
});
test('failed shell commands and noncanonical links cannot confirm PR creation', () => {
  const [failed]=parsed([user(t1),tool('p','Bash',{command:'gh pr create'}),reply('p',{exit_code:1,output:pr})]);
  assert.equal(failed.prRegistration,'unknown-creation');
  const [noncanonical]=parsed([user(t1),tool('p','Bash',{command:'gh pr create'}),reply('p',pr+'/files')]);
  assert.equal(noncanonical.prRegistration,'unknown-creation');
});
test('an unanswered registration attempt stays unknown', () => {
  const [t]=parsed([user(t1),...created,flow('d',{outputs:[{target:pr}]})]);
  assert.equal(t.prRegistration,'unknown-registration');
});
test('unrelated shell error text does not establish a delivery refusal', () => {
  const [t]=parsed([user(t1),tool('cat','Bash',{command:'cat report.json'}),reply('cat',{code:'WORKPAD_OPEN'}),flow('d',{acknowledgeOpen:true})]);
  assert.equal(t.acknowledgements[0].kind,'upfront');
});
test('successful CLI receipt prevents a false zero-call classification when script arguments are dynamic', () => {
  const [t]=parsed([user(t1),tool('cli','Bash',{command:'python3 ./wrapper.py'}),reply('cli',{receipt})]);
  assert.deepEqual(t.flowly,['receipt:status']);
});
test('Luna: image-only Claude and Codex messages start their own turns', () => {
  const image={type:'user',timestamp:t1,message:{content:[{type:'image',source:{data:'private-image'}}]}};
  const [t]=parsed([user(t0),image,tool('g','mcp__flowly__flowly_get_task')]);
  assert.equal(t.at,t1);assert.equal(t.first,false);
  const rows=[{type:'event_msg',timestamp:t0,payload:{type:'user_message',message:'text'}},
    {type:'event_msg',timestamp:t1,payload:{type:'user_message',message:'',images:['private-image']}},
    {type:'response_item',payload:{type:'custom_tool_call',name:'functions.exec',call_id:'g',input:'await tools.mcp__flowly__flowly_get_task({});'}}];
  assert.equal(calibrate(parseTurns(rows,{...s,provider:'codex'}),{},o)[0].at,t1);
  assert.equal(parsed([{...image,isMeta:true}]).length,0);
});
test('Luna: quoted note content cannot impersonate CLI flags or status', () => {
  const cmd="node '/x/flowly.mjs' status in_review --note 'Use --acknowledge-open only after refusal' --outputs '[]'";
  assert.equal(parsed([user(t1),tool('d','Bash',{command:cmd})])[0].acknowledgements[0].kind,'none');
  assert.equal(parsed([user(t1),tool('d','Bash',{command:cmd+' --acknowledge-open'})])[0].acknowledgements[0].kind,'upfront');
  const dynamic="node '/x/flowly.mjs' status in_review --note \"$NOTE\"";
  assert.equal(parsed([user(t1),tool('d','Bash',{command:dynamic})])[0].acknowledgements[0].kind,'unknown');
});
test('Luna: unanswered CLI artifact/status/note calls remain unknown', () => {
  for (const action of ['artifact --role output','status in_review','note --kind result']) {
    const [t]=parsed([user(t1),...created,tool('d','Bash',{command:"node '/x/flowly.mjs' "+action+" --target '"+pr+"'"})]);
    assert.equal(t.prRegistration,'unknown-registration');
  }
});
test('Luna: evidence never exports URL query credentials or userinfo', () => {
  const raw={receipt,current:{artifacts:[{...artifact,target:'https://user:secret@github.com/owner/repo/pull/7?access_token=secret#token'}]}};
  const result=evidence(raw);assert.equal(result.artifacts[0].target,pr);
  assert.equal(JSON.stringify(result).includes('secret'),false);
  assert.equal(evidence({artifacts:[{...artifact,target:'https://host/private?token=secret'}]}).artifacts[0].target,null);
});
test('no-op artifact receipts with empty event IDs retain all distinct PRs', () => {
  const other={...artifact,id:'b',target:pr.replace('/7','/8')};
  const rows=[user(t1),tool('p','Bash',{command:'gh pr create'}),reply('p',pr+'\n'+other.target)];
  const board={artifacts:[artifact,other],agentReceipts:[{...receipt,eventId:'',action:'artifact',artifactIds:undefined,artifactId:'a'},
    {...receipt,eventId:'',action:'artifact',artifactIds:undefined,artifactId:'b'}]};
  assert.equal(parsed(rows,board)[0].prRegistration,'pass');
});
test('upfront acknowledge, post-refusal confirmation, repair, and new-turn reset are distinct', () => {
  const rows = [user(t1),flow('a',{acknowledgeOpen:true}),reply('a',{code:'WORKPAD_OPEN'},true),flow('b',{acknowledgeOpen:true}),reply('b',{receipt}),
    tool('w','mcp__flowly__flowly_update_workpad'),reply('w',{receipt:{...receipt,eventId:'w',action:'workpad'}}),flow('c',{}),user('2026-10-22T00:10:00Z'),flow('d',{acknowledgeOpen:true})];
  assert.deepEqual(parsed(rows).map((t)=>t.acknowledgements.map((a)=>a.kind)),[['upfront','after-refusal','repaired'],['upfront']]);
});
test('Codex AST ignores strings/comments and keeps dynamic values or batch order unknown', () => {
  const source = `// tools.mcp__flowly__flowly_update_status({status:'in_review'})
  text("tools.mcp__flowly__flowly_get_task({})");
  await tools.mcp__flowly__flowly_update_status({...context,status:'in_review',acknowledgeOpen:true});`;
  assert.equal(scriptCalls(source).length,1);
  const session={...s,provider:'codex'};
  const rows=[{type:'event_msg',timestamp:t1,payload:{type:'user_message',message:'work'}},
    {type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'work'}]}},
    {type:'response_item',payload:{type:'custom_tool_call',name:'functions.exec',call_id:'a',input:source}},
    {type:'response_item',payload:{type:'custom_tool_call_output',call_id:'a',output:JSON.stringify({content:[{type:'text',text:JSON.stringify({receipt,current:{artifacts:[artifact]}})}]})}}];
  const turns=calibrate(parseTurns(rows,session),{},o);
  assert.equal(turns.length,1);
  assert.deepEqual(turns[0].flowly,['update_status']);
  assert.deepEqual(turns[0].registeredPrUrls,[pr]);
  assert.equal(turns[0].acknowledgements[0].kind,'unknown');
});
test('evidence strips credentials/messages and preserves nested CLI/MCP result evidence', () => {
  const raw={request:{token:'secret'},text:JSON.stringify({receipt,current:{artifacts:[artifact],request:{signature:'secret'}}})};
  const result=evidence(raw);
  assert.equal(result.receipts.length,1);
  assert.equal(JSON.stringify(result).includes('secret'),false);
});
test('intervals and conflicting cohort flags fail rather than silently changing denominators', () => {
  assert.throws(()=>options(['--since'],'claude'),/Missing value/);
  assert.throws(()=>options(['--since','bad'],'claude'),/interval/);
  assert.throws(()=>options(['--since',t2,'--until',t1],'claude'),/interval/);
  assert.throws(()=>options(['--test-session','s','--real-session','s'],'claude'),/both/);
  assert.equal(options([],'claude').since,options([],'codex').since);
});
test('Fable F1: background and system notifications neither start nor split real turns', () => {
  const prefixes=['<task-notification>','<local-command-stdout>','<ide_opened_file>','<ide_selection>','<chat-history-summary>','<command-message>'];
  for(const prefix of prefixes) {
    const rows=[user(t0),user(t1),tool('g','mcp__flowly__flowly_get_task'),user('2026-10-22T00:05:00Z',prefix),tool('e','Edit')];
    const [t]=parsed(rows);assert.equal(parsed(rows).length,1);assert.equal(t.edits,1);assert.deepEqual(t.flowly,['get_task']);
  }
  for(const attrs of [{promptSource:'system'},{turnOrigin:'task_notification'},{origin:{kind:'task-notification'}}])
    assert.equal(parsed([user(t1),{...user('2026-10-22T00:05:00Z','notification'),...attrs}]).length,1);
});
test('Fable F2: answered but unprinted/unparseable registration remains unknown, until a board receipt proves it', () => {
  for(const raw of ['', 'saved; result not printed', '{"receipt": [truncated']) {
    const rows=[user(t1),...created,flow('d',{outputs:[{target:pr}]}),reply('d',raw)];
    assert.equal(parsed(rows)[0].prRegistration,'unknown-registration');
    assert.equal(parsed(rows,{artifacts:[artifact],agentReceipts:[receipt]})[0].prRegistration,'pass');
  }
  const cli=[user(t1),...created,tool('d','Bash',{command:"node '/x/flowly.mjs' status in_review --outputs '[]' > /dev/null"}),reply('d','')];
  assert.equal(parsed(cli)[0].prRegistration,'unknown-registration');
  const rows=[{type:'event_msg',timestamp:t1,payload:{type:'user_message',message:'work'}},
    {type:'response_item',payload:{type:'custom_tool_call',name:'functions.exec',call_id:'p',input:'await tools.exec_command({cmd:"gh pr create"});'}},
    {type:'response_item',payload:{type:'custom_tool_call_output',call_id:'p',output:pr}},
    {type:'response_item',payload:{type:'custom_tool_call',name:'functions.exec',call_id:'d',input:`await tools.mcp__flowly__flowly_update_status({status:'in_review',outputs:[{target:'${pr}'}]});`}},
    {type:'response_item',payload:{type:'custom_tool_call_output',call_id:'d',output:''}}];
  assert.equal(calibrate(parseTurns(rows,{...s,provider:'codex'}),{},o)[0].prRegistration,'unknown-registration');
});
test('Fable F2/F3: old Codex shell tools and code-mode aliases keep PR/CLI attempts visible', () => {
  for(const name of ['shell_command','shell','exec_command']) {
    const command=name==='shell'?['bash','-lc','gh pr create --fill']:'gh pr create --fill';
    const rows=[{type:'event_msg',timestamp:t1,payload:{type:'user_message',message:'work'}},
      {type:'response_item',payload:{type:'function_call',name,call_id:'p',arguments:JSON.stringify({command})}},
      {type:'response_item',payload:{type:'function_call_output',call_id:'p',output:pr}},
      {type:'response_item',payload:{type:'custom_tool_call',name:'functions.exec',call_id:'d',input:`await tools.${name}({command: ${JSON.stringify(name==='shell'?['sh','-c',"node '/x/flowly.mjs' status in_review"]:"node '/x/flowly.mjs' status in_review")}});`}},
      {type:'response_item',payload:{type:'custom_tool_call_output',call_id:'d',output:''}}];
    const [t]=calibrate(parseTurns(rows,{...s,provider:'codex'}),{},o);
    assert.equal(t.prAttempts,1);assert.deepEqual(t.flowly,['cli:status']);assert.equal(t.prRegistration,'unknown-registration');
  }
  const rows=[{type:'event_msg',timestamp:t0,payload:{type:'user_message',message:'earlier work'}},{type:'event_msg',timestamp:t1,payload:{type:'user_message',message:'work'}},
    {type:'response_item',payload:{type:'function_call',name:'shell',call_id:'s',arguments:JSON.stringify({command:['unknown-runner','script']})}}];
  const selected=calibrate(parseTurns(rows,{...s,provider:'codex'}),{},o);
  assert.equal(selected[0].unknownShellCalls,1);
  assert.equal(summarize(selected).laterUnknownFlowly,1);
  assert.equal(summarize(selected).laterNoFlowly,0);
});
test('Fable R1: dynamic code-mode commands are unknown rather than zero Flowly calls', () => {
  for(const source of [
    'await tools.exec_command({cmd: `node ${cli} --context-file ${ctx} current`});',
    'await tools.exec_command({cmd: command});',
    'await tools.shell_command(input);',
    'await tools.shell({command: commands});',
  ]) {
    const rows=[{type:'event_msg',timestamp:t0,payload:{type:'user_message',message:'first'}},
      {type:'event_msg',timestamp:t1,payload:{type:'user_message',message:'follow-up'}},
      {type:'response_item',payload:{type:'custom_tool_call',name:'functions.exec',call_id:'s',input:source}}];
    const selected=calibrate(parseTurns(rows,{...s,provider:'codex'}),{},o);
    assert.equal(selected[0].unknownShellCalls,1);
    assert.equal(summarize(selected).laterUnknownFlowly,1);
    assert.equal(summarize(selected).laterNoFlowly,0);
    assert.equal(summarize(selected).laterObservable,0);
  }
});
test('both CLI entrypoints isolate project membership, exclude children, and expose cohort groups', () => {
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'flowly-audit-'));
  try {
    const write=(rel,value)=>{const p=path.join(home,rel);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,value);};
    write('.paseo/plugin-data/flowly/board.json',JSON.stringify({tasks:[{id:'t',projectId:'p'},{id:'foreign',projectId:'other'}]}));
    write('.paseo/plugin-data/flowly/flow/p.jsonl','');
    for(const provider of ['claude','codex']) {
      const sid=provider==='claude'?'11111111-1111-1111-1111-111111111111':'22222222-2222-2222-2222-222222222222';
      const a={id:provider,provider,createdAt:t0,config:{model:provider},labels:{'flowly-task':'t'},persistence:{sessionId:sid}};
      for(const [id,attrs] of [['main',{}],['child',{labels:{'flowly-task':'t','paseo.parent-agent-id':'parent'}}],['foreign',{labels:{'flowly-task':'foreign'}}]]) write('.paseo/agents/fixture/'+provider+id+'.json',JSON.stringify({...a,...attrs}));
      const row=(at)=>provider==='claude'?user(at):{type:'event_msg',timestamp:at,payload:{type:'user_message',message:'fixture'}};
      write((provider==='claude'?'.claude/projects/p/':'.codex/sessions/')+sid+'.jsonl',[row(t0),row(t1)].map(JSON.stringify).join('\n'));
      const filename=provider==='claude'?'audit.mjs':'audit-codex.mjs';
      const stdout=execFileSync(process.execPath,[path.join(import.meta.dirname,filename),'--home',home,'--project','p','--since',t1,'--until',t2,'--test-session',provider,'--json'],{encoding:'utf8'});
      const result=JSON.parse(stdout);
      assert.equal(result.sessionsRead,1);assert.equal(result.summary.turns,1);
      assert.equal(result.groups[0].sample,'test');assert.equal(result.groups[0].age,'old');assert.equal(result.groups[0].later,1);
    }
    const invalid=spawnSync(process.execPath,[path.join(import.meta.dirname,'audit.mjs'),'--since'],{encoding:'utf8'});
    assert.equal(invalid.status,1);
  } finally {fs.rmSync(home,{recursive:true,force:true});}
});
