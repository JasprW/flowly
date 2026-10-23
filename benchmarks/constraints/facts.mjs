// Pure, bounded projections. Never evaluate provider code or export signed requests.
import { createHash } from 'node:crypto';
export function providerFailure(entries) {return entries.some(e=>e.item?.type==='assistant_message'&&typeof e.item.text==='string'&&/^You've hit your weekly limit(?: ·|$)/.test(e.item.text.trim()))?'provider-weekly-quota':null;}
export const hash = value => createHash('sha256').update(value).digest('hex');
export const pick = (v, keys) => Object.fromEntries(keys.filter(k => v && Object.hasOwn(v, k)).map(k => [k, v[k]]));
export function checkInvoked(actual,expected) {
  const parse=s=>typeof s==='string'?s.trim().match(/^node\s+(?:'([^']*)'|"([^"$`\\]*)"|([^\s;&|<>$`]+))$/):null;
  const a=parse(actual),b=parse(expected);return !!a&&!!b&&(a[1]??a[2]??a[3])===(b[1]??b[2]??b[3]);
}
export const publicReceipt = r => pick(r, ['agentId','taskId','eventId','action','status','at','artifactId','artifactIds','workpadRevision','taskRevision','projectRevision']);
export const publicArtifact = a => pick(a, ['id','taskId','role','kind','target','createdBy','agentId']);
export function publicPad(p) {
  if (!p) return null;
  return { revision:p.revision, head:p.head ? pick(p.head,['sha','branch','dirty']):null,
    acceptance:(p.acceptance??[]).map(a=>pick(a,['id','text','done'])),
    validation:(p.validation??[]).map(c=>({...pick(c,['id','command','state','sha','dirty']),textHash:hash(c.text??'')})) };
}
export function publicTask(t) { return t ? pick(t,['id','projectId','workspaceId','type','tags','status','revision']):null; }
export function prUrl(value) {
  try { const u=new URL(value);return ['https:','http:'].includes(u.protocol)&&/\/pull\/\d+\/?$/.test(u.pathname)?u.origin+u.pathname.replace(/\/$/,''):null; } catch { return null; }
}
export function extract(raw) {
  const receipts=[],contexts=[],errors=[],proofs=[],refusals=[];const seen=new Set();
  function walk(v,depth=0) {
    if(depth>14||v==null)return;
    if(typeof v==='string') {
      if(v.length>4_000_000)return;
      try { walk(JSON.parse(v),depth+1); } catch {
        for(const line of v.split('\n')) { if(!line.trim().startsWith('{'))continue;try {walk(JSON.parse(line),depth+1);}catch{} }
      } return;
    }
    if(typeof v!=='object'||seen.has(v))return;seen.add(v);
    if(Array.isArray(v)){v.forEach(x=>walk(x,depth+1));return;}
    if(v.eventId&&v.action)receipts.push(publicReceipt(v));
    if(v.identity?.agentId&&v.task?.id)contexts.push({ identity:pick(v.identity,['agentId','taskId']), task:publicTask(v.task),setup:v.setup?pick(v.setup,['missing']):null,workpad:publicPad(v.workpad),artifacts:(v.artifacts??[]).map(publicArtifact) });
    if(typeof v.code==='string'&&/^[A-Z_]+$/.test(v.code))errors.push(v.code);
    if(['WORKPAD_OPEN','SETUP_INCOMPLETE'].includes(v.code)&&typeof v.message==='string') {
      const lines=v.message.split('\n');const stale=lines.flatMap(l=>{const m=l.match(/^- check out of date \(ran on ([a-f0-9]+), HEAD is now ([a-f0-9]+)\):/);return m?[{ran:m[1],head:m[2],textHash:hash(l.slice(m[0].length).trim())}]:[];});
      const total=Number(v.message.match(/(\d+) workpad items? (?:is|are) still open:/)?.[1]);
      refusals.push({code:v.code,stale,total:Number.isFinite(total)?total:null,unchecked:lines.filter(l=>l.startsWith('- acceptance not met:')).length,failed:lines.filter(l=>l.startsWith('- check failed:')).length,unrun:lines.filter(l=>l.startsWith('- check not run:')).length,setup:v.message.includes('Card setup is incomplete:')});
    }
    if(v.flowlyBenchmarkCheck&&typeof v.fileHash==='string')proofs.push(pick(v,['flowlyBenchmarkCheck','fileHash','sha','dirty','inputHash','scriptHash','exitCode','node']));
    for(const k of ['receipt','receipts','current','error','content','structuredContent','result','output','text'])if(k in v)walk(v[k],depth+1);
  }
  walk(raw);return {receipts,contexts,errors:[...new Set(errors)],proofs,refusals};
}
export function safeInput(v) {
  if(!v||typeof v!=='object')return {};
  return { ...pick(v,['status','kind','acknowledgeOpen']),
    ...(v.expectedRevision?{expectedRevision:pick(v.expectedRevision,['task','project'])}:{}),
    ...(typeof v.note==='string'?{note:v.note.slice(0,8000)}:{}),
    ...(Object.hasOwn(v,'nextMoves')?{nextMovesDeclared:Array.isArray(v.nextMoves)}:{}),
    ...(Object.hasOwn(v,'outputs')?{outputsDeclared:Array.isArray(v.outputs)}:{}) };
}
export function normalizeTimeline(entries, {checkCommand,filename,sessionId,cardId}) {
  return entries.filter(e=>e.item?.type==='tool_call'&&e.item.name!=='agent_message').map(e=>{
    const i=e.item,d=i.detail??{},m=i.metadata??{},x=extract([d.output,d.text,m.output,m.result]);
    const command=d.type==='shell'?d.command:(m.input?.cmd??m.input?.command);
    const exactCheck=checkInvoked(command,checkCommand);
    const edit=['edit','write'].includes(d.type)&&typeof d.filePath==='string'&&d.filePath.endsWith('/'+filename)||['edit','write'].includes(d.type)&&d.filePath===filename;
    const shell=commandFacts(command);const flowly=i.name?.match(/flowly_(get_task|update_status|report_progress|update_workpad|add_artifact|suggest_next_moves|set_type|set_tags)$/)?.[1]??shell.action;
    return {id:i.callId,at:e.timestamp,seq:e.seqStart,endSeq:e.seqEnd,status:i.status,name:i.name,
      kind:edit?'edit':exactCheck?'check':flowly?'flowly':shell.kind??'opaque',action:flowly,
      ...(exactCheck?{command:checkCommand,exitCode:Number.isInteger(d.exitCode)?d.exitCode:processExit(d.output)}:{}),
      input:{...shell.input,...safeInput(m.input??d.input)},receipts:x.receipts.filter(r=>r.agentId===sessionId&&r.taskId===cardId),
      contexts:x.contexts.filter(c=>c.identity.agentId===sessionId&&c.task.id===cardId),errors:x.errors,refusals:x.refusals,
      proofs:exactCheck?x.proofs:[],sourceHash:hash(JSON.stringify(i)) };
  });
}
export function parseFlow(text, cardId, sessionId) {
  const events=[],diagnostics=[];
  text.split('\n').forEach((l,n)=>{if(!l.trim())return;try{const e=JSON.parse(l);if(e.taskId===cardId&&(!e.agentId||e.agentId===sessionId))events.push(pick(e,['id','at','taskId','agentId','action','actor','from','to','reportKind','offered']));}catch{diagnostics.push(`Malformed flow line ${n+1}`);}});
  return {events,diagnostics};
}

// A single explicitly-owned provider session; callers resolve the path, never scan message content.
export function providerCalls(text,provider,options) {
  const uses=new Map(),rows=text.split('\n');let malformed=0;
  rows.forEach((line,index)=>{
    if(!line.trim())return;let r;try{r=JSON.parse(line);}catch{malformed++;return;}
    if(provider==='claude') {
      const content=r.message?.content;if(!Array.isArray(content))return;
      for(const v of content) {
        if(v.type==='tool_use'){const old=uses.get(v.id);uses.set(v.id,{id:v.id,at:old?.at??r.timestamp,input:v.input,name:v.name,result:old?.result??null,finished:old?.finished??false,index});}
        if(v.type==='tool_result'&&uses.has(v.tool_use_id)){const u=uses.get(v.tool_use_id);u.result=v.content;u.finished=true;u.isError=v.is_error;}
      }
    }else {
      const p=r.payload??{};
      if(['function_call','custom_tool_call'].includes(p.type)) {
        let input=p.arguments??p.input;try{input=JSON.parse(input);}catch{}uses.set(p.call_id,{id:p.call_id,at:r.timestamp,input,name:p.name,result:null,finished:false,index});
      }
      if(['function_call_output','custom_tool_call_output'].includes(p.type)&&uses.has(p.call_id)){const u=uses.get(p.call_id);u.result=p.output;u.finished=true;}
    }
  });
  const calls=[...uses.values()].map(u=>{
    const inp=u.input&&typeof u.input==='object'?u.input:{};const command=inp.command??inp.cmd;const exact=checkInvoked(command,options.checkCommand);
    const file=inp.file_path??inp.path;const edit=['Write','Edit'].includes(u.name)&&(file===options.filename||file?.endsWith('/'+options.filename));
    const shell=commandFacts(command);const action=u.name?.match(/flowly_(get_task|update_status|report_progress|update_workpad|add_artifact|suggest_next_moves|set_type|set_tags)$/)?.[1]??shell.action;
    const e=extract(u.result);
    return {id:u.id,at:u.at,name:u.name,kind:edit?'edit':exact?'check':action?'flowly':shell.kind??'opaque',action,status:u.finished&&!u.isError?'completed':u.finished?'failed':'running',input:{...shell.input,...safeInput(inp)},...(exact?{command:options.checkCommand,exitCode:processExit(u.result)}:{}),receipts:e.receipts.filter(r=>r.agentId===options.sessionId&&r.taskId===options.cardId),contexts:e.contexts.filter(c=>c.identity.agentId===options.sessionId&&c.task.id===options.cardId),proofs:exact?e.proofs:[],errors:e.errors,refusals:e.refusals,sourceHash:hash(JSON.stringify([u.name,u.input,u.result]))};
  });return {calls,complete:malformed===0,diagnostics:malformed?[`Malformed provider rows: ${malformed}`]:[]};
}
export function mergeCalls(native,fallback) {
  const byId=new Map(fallback.map(c=>[c.id,c]));
  return native.map(n=>{
    const f=byId.get(n.id);if(!f)return n;
    const conflicts=[];if(Number.isInteger(n.exitCode)&&Number.isInteger(f.exitCode)&&n.exitCode!==f.exitCode)conflicts.push('exit-code');
    if(['completed','failed'].includes(n.status)&&['completed','failed'].includes(f.status)&&n.status!==f.status)conflicts.push('terminal-status');
    const np=n.proofs??[],fp=f.proofs??[];
    if(np.length&&fp.length&&hash(JSON.stringify(np))!==hash(JSON.stringify(fp)))conflicts.push('proof');
    const proofs=[...new Map([...np,...fp].map(p=>[hash(JSON.stringify(p)),p])).values()];
    return {...n,...f,seq:n.seq,endSeq:n.endSeq,at:n.at,
      kind:n.kind!=='opaque'?n.kind:f.kind,action:n.action??f.action,
      exitCode:Number.isInteger(n.exitCode)?n.exitCode:f.exitCode,
      status:['completed','failed'].includes(n.status)?n.status:f.status,proofs,evidenceConflicts:conflicts,
      input:{...n.input,...f.input},receipts:[...new Map([...(n.receipts??[]),...(f.receipts??[])].map(r=>[r.eventId,r])).values()],
      contexts:f.contexts?.length?f.contexts:n.contexts,errors:[...new Set([...(n.errors??[]),...(f.errors??[])])],refusals:f.refusals?.length?f.refusals:n.refusals};
  });
}

export function processExit(raw) {
  if(typeof raw==='string'){try{return processExit(JSON.parse(raw));}catch{const m=raw.match(/^Process exited with code (-?\d+)$/m);return m?Number(m[1]):null;}}
  if(raw&&typeof raw==='object'&&Number.isInteger(raw.exit_code))return raw.exit_code;
  return null;
}

export function publicEvent(e) {return {...pick(e,['id','at','taskId','agentId','action','actor','from','to','reportKind','offered']),...(Array.isArray(e.moves)?{offered:e.moves.length}:{})};}
export function flowIntegrity(flow,after,before,startedAt) {
  const checkpoint=before?.boardEvents?.at(-1)?.id;
  const coverage=!!checkpoint&&after.boardEvents?.some(e=>e.id===checkpoint);
  const relevant=(after.boardEvents??[]).filter(e=>e.at>=startedAt);
  return !flow.diagnostics.length&&coverage&&after.receipts.every(r=>flow.events.some(e=>e.id===r.eventId))&&relevant.every(e=>flow.events.some(f=>f.id===e.id))&&flow.events.some(e=>e.action==='agent.turn_started'&&e.at>=startedAt)&&flow.events.some(e=>e.action==='agent.turn_ended'&&e.at>=startedAt);
}
// Only literal single commands. No eval, substitutions, pipelines or script-body inference.
export function commandFacts(command) {
  if(typeof command!=='string')return {};
  const token=/\s*(?:'([^']*)'|"([^"$`\\]*)"|([^\s'"$`\\;&|<>]+))/y;const args=[];let end=0;
  while(end<command.length){token.lastIndex=end;const m=token.exec(command);if(!m){if(!command.slice(end).trim())break;return {};}args.push(m[1]??m[2]??m[3]);end=token.lastIndex;}
  if(args[0]==='node'&&args[1]?.endsWith('/flowly.mjs')&&args[2]==='--context-file'&&args[3]) {
    const map={current:'get_task',status:'update_status',note:'report_progress',workpad:'update_workpad',artifact:'add_artifact','next-moves':'suggest_next_moves','set-type':'set_type',tags:'set_tags'};
    const action=map[args[4]];if(!action)return {};
    if(action==='get_task'&&args.length!==5&&!(args.length===7&&args[5]==='--save-request'))return {};
    const note=args.indexOf('--note');return {action,kind:'flowly',input:{...(action==='update_status'?{status:args[5]}:{}),...(args.includes('--acknowledge-open')?{acknowledgeOpen:true}:{}),...(note>=0?{note:args[note+1]?.slice(0,8000)}:{})}};
  }
  if(args.length===1&&args[0]==='pwd')return {kind:'read'};
  if(args[0]==='git'&&['commit','push','merge','cherry-pick','rebase'].includes(args[1])||args[0]==='gh'&&args[1]==='pr'&&['create','merge'].includes(args[2]))return {kind:'business'};
  return {};
}
