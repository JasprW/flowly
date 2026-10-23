// Offline projection only: existing saved PR proof and local Git objects, no fetch/resources/models.
import path from 'node:path';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {json,save} from '../../../benchmarks/constraints/io.mjs';import {hash} from '../../../benchmarks/constraints/facts.mjs';import {captureScope,assessScope} from '../../../benchmarks/constraints/scope.mjs';
const source='docs/verification/constraint-benchmark/20261023020035204-8b1863',out=path.dirname(import.meta.filename);
const f=await json(source+'/facts.json'),m=await json(source+'/manifest.json'),o=await json(source+'/ownership.json'),review=await json(source+'/operator-cleanup-review.json');
const gpt=f.sessions.find(s=>s.model==='gpt-6-luna'),gptOwned=o.owned.find(s=>s.id===gpt.id),t=gpt.turns.find(t=>t.id==='T3');
const sonnet=f.sessions.find(s=>s.model==='claude-sonnet-5-5'),prior=sonnet.turns.find(t=>t.id==='T3'),pr=prior.prs[0];
assert.equal(pr.state,'MERGED');assert.equal(pr.repository,m.config.repository);assert(prior.endedAt<gptOwned.startedAt);assert.equal(pr.mergeCommit,review.parent);assert.equal(t.after.head.sha,review.head);assert.equal(t.after.head.dirty,false);
assert(review.prs.some(p=>p.url===pr.url&&p.head===pr.head&&p.mergeCommit===pr.mergeCommit));
const history={sha:pr.mergeCommit,source:'saved-verified-pr',repository:pr.repository,observedAt:prior.endedAt,proof:source+'/operator-cleanup-review.json'};
const scope=await captureScope(m.config.repoPath,{base:m.config.baseCommit,head:t.after.head.sha,filename:gpt.filename,history,dirtyPaths:[]});
assert.equal(assessScope(scope,gpt.filename,t.after.head.sha).verdict,'PASS');
const sourceHashes={};for(const name of ['facts.json','manifest.json','ownership.json','operator-cleanup-review.json','verdicts.json'])sourceHashes[name]=hash(await readFile(source+'/'+name));
await save(out+'/saved-scope.json',{source,sourceHashes,caseId:gpt.id,historyRecordedBeforeSession:history.observedAt<gptOwned.startedAt,scope});
console.log(JSON.stringify({scope:'PASS',commits:scope.commits.length,imported:assessScope(scope,gpt.filename,scope.head).paths.length}));
const scopes=[];
for(const session of f.sessions){
 const own=o.owned.find(v=>v.id===session.id);
 const caseHistory=session.id===gpt.id?history:{sha:o.baseline.remoteMain.split(/\s+/)[0],source:'remote-main-before-session',repository:m.config.repository,observedAt:o.createdAt};
 assert(caseHistory.observedAt<own.startedAt);
 for(const turn of session.turns){
  const after=turn.after;if(!after)continue;
  const dirty=after.head.dirty?(after.head.sha===m.config.baseCommit||after.changePaths.every(p=>p===session.filename)?after.changePaths:null):[];
  assert(dirty,'Saved dirty/committed paths cannot be separated');
  const audit=await captureScope(m.config.repoPath,{base:m.config.baseCommit,head:after.head.sha,filename:session.filename,history:caseHistory,dirtyPaths:dirty});
  assert.equal(assessScope(audit,session.filename,after.head.sha).verdict,'PASS');scopes.push({sessionId:session.id,turnId:turn.id,scope:audit});
 }
}
await save(out+'/saved-scopes.json',{source,sourceHashes,scopes});
console.log(JSON.stringify({savedTurnAudits:scopes.length}));
