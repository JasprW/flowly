// Read-only recovery of owned, completed sessions. Never sends messages or changes resources.
import path from 'node:path';import {readFile,readdir} from 'node:fs/promises';
import {connect,timeline} from '../../../benchmarks/constraints/runtime.mjs';
import {json,save,command} from '../../../benchmarks/constraints/io.mjs';
import {hash,normalizeTimeline,mergeCalls,providerFailure,publicEvent,parseFlow,flowIntegrity} from '../../../benchmarks/constraints/facts.mjs';
const dir=path.resolve('docs/verification/constraint-benchmark/20261022150226138-4f8bce');
const facts=await json(path.join(dir,'initial-facts.json')),ownership=await json(path.join(dir,'ownership.json')),manifest=await json(path.join(dir,'manifest.json'));
const x=await connect();try {
 const names=await readdir(path.join(x.data,'removed'));const log=await readFile(path.join(x.data,'flow',manifest.config.projectId+'.jsonl'),'utf8');
 for(const s of facts.sessions){const o=ownership.owned.find(v=>v.id===s.id);if(!o)throw Error('Owned session missing');s.checkHash=o.checkHash;
  const a=x.api.agents.ref(s.id),trace=await timeline(a);const name=names.find(n=>n.startsWith('task-'+s.cardId+'-')&&n.endsWith('.json'));const backup=name?await json(path.join(x.data,'removed',name)):null;
  const board=(backup?.events??[]).filter(e=>e.taskId===s.cardId).map(publicEvent);const flowName=names.find(n=>n.startsWith('task-'+s.cardId+'-flow-')&&n.endsWith('.jsonl'));const removedLog=flowName?await readFile(path.join(x.data,'removed',flowName),'utf8'):'';const flow=parseFlow(log+'\n'+removedLog,s.cardId,s.id);
  for(const t of s.turns){if(!t.endedAt)continue;const entries=trace.entries.filter(e=>e.timestamp>=t.startedAt&&e.timestamp<=t.endedAt);
   const unavailable=providerFailure(entries);if(unavailable){t.state='INVALID';t.reason=unavailable;t.providerFailure={code:unavailable,source:'canonical-assistant-message'};}
   const calls=normalizeTimeline(entries,{sessionId:s.id,cardId:s.cardId,filename:s.filename,checkCommand:s.checkCommand});t.calls=mergeCalls(calls,t.calls.filter(c=>c.name!=='agent_message'));
   t.before.boardEvents=board.filter(e=>e.at<t.startedAt);t.after.boardEvents=board.filter(e=>e.at<=t.endedAt);
   t.flowComplete=flowIntegrity(flow,t.after,t.before,t.startedAt);t.complete=t.flowComplete&&trace.complete;t.timelineComplete=trace.complete;
   t.events=[...new Map([...flow.events,...t.after.boardEvents].filter(e=>e.at>=t.startedAt&&e.at<=t.endedAt).map(e=>[e.id,e])).values()].sort((a,b)=>a.at.localeCompare(b.at));
   for(const p of t.prs??[]){const n=p.url.match(/\/pull\/(\d+)$/)?.[1];if(!n)continue;const pr=JSON.parse(await command('gh',['pr','view',n,'--repo',s.repository,'--json','mergeCommit,headRefOid']));
    for(const [field,ref] of [['headFileHash',pr.headRefOid],['mergedFileHash',pr.mergeCommit?.oid]])if(ref){const content=JSON.parse(await command('gh',['api',`repos/${s.repository}/contents/${s.filename}?ref=${ref}`]));p[field]=hash(Buffer.from(content.content,'base64'));}}
  }
 }
 const code=await readFile(import.meta.filename);facts.supplement={at:new Date().toISOString(),sourceHash:hash(code),method:'Read-only canonical timeline, owned removed backup events and GitHub content; initial facts/report retained. No subject re-run.',missingHistoricalFields:['execution-time scriptHash and checkInput snapshots unavailable in original collector; do not invent them']};
 await save(path.join(dir,'supplemented-facts-'+hash(code).slice(0,12)+'.json'),facts);await save(path.join(dir,'supplemented-facts.json'),facts);await save(path.join(dir,'facts.json'),facts);
}finally{await x.close()}
