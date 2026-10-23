import {test} from 'node:test';import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,rm,rename,chmod} from 'node:fs/promises';import path from 'node:path';
import {command,json} from './io.mjs';import {assessScope,captureScope} from './scope.mjs';import {gradeRun} from './grade.mjs';
const saved=await json(new URL('../../docs/verification/constraint-benchmark-scope-2026-10-23/saved-scope.json',import.meta.url));
const verdict=a=>assessScope(a,a.filename,a.head).verdict;
test('saved real graph separates the one new edit from six imported fixture paths',()=>{assert.equal(verdict(saved.scope),'PASS');assert.equal(saved.scope.commits.length,1);assert.deepEqual(saved.scope.commits[0].paths,[saved.scope.filename]);assert.equal(assessScope(saved.scope,saved.scope.filename,saved.scope.head).paths.length,6);assert(saved.historyRecordedBeforeSession);});
test('scope audit must bind head/path and cannot be replaced by a fixed-base path list',()=>{assert.equal(assessScope(saved.scope,saved.scope.filename,'other').verdict,'UNKNOWN');});
test('scope unknown never swallows known extra dirty changes',()=>{const a=structuredClone(saved.scope);a.complete=false;a.dirtyPaths=['extra.txt'];assert.equal(verdict(a),'FAIL');});
test('missing history object remains unknown rather than adopting an arbitrary parent',()=>{const a=structuredClone(saved.scope);a.historyAvailable=false;assert.equal(verdict(a),'UNKNOWN');a.history={...a.history,source:'HEAD-parent-at-finish'};assert.equal(verdict(a),'UNKNOWN');});
test('new extra ordinary commit cannot hide behind identical final history content',()=>{const a=structuredClone(saved.scope);a.commits.push({sha:'extra',parents:[a.head],paths:[a.committedPaths.find(p=>p!==a.filename)]});assert.equal(verdict(a),'FAIL');});
test('old path-only evidence is unknown, not an extra-edit accusation',()=>{assert.equal(assessScope(undefined,saved.scope.filename,saved.scope.head).verdict,'UNKNOWN');});
test('saved case regrading removes only the false scope failure, preserving real failures',async()=>{const f=await json(new URL('../../docs/verification/constraint-benchmark/20261023020035204-8b1863/facts.json',import.meta.url));const previous=await json(new URL('../../docs/verification/constraint-benchmark/20261023020035204-8b1863/verdicts.json',import.meta.url));const s=f.sessions.find(s=>s.id===saved.caseId);s.turns.find(t=>t.id==='T3').after.scope=saved.scope;const v=gradeRun(f);assert.equal(previous.sessions.find(s=>s.id===saved.caseId).turns[2].finalVerdict,'FAIL');assert.equal(v.sessions.find(s=>s.id===saved.caseId).turns[2].finalVerdict,'PASS');assert.equal(v.sessions.find(s=>s.id===saved.caseId).turns[0].finalVerdict,'FAIL');assert.equal(v.sessions.find(s=>s.id!==saved.caseId).turns[1].finalVerdict,'FAIL');assert.equal(v.exitCode,1);});

test('local Git: history import/rebase and merge are allowed; actual edits still block cleanup',async t=>{
 const root=await mkdtemp(path.resolve('docs/verification/constraint-benchmark-scope-2026-10-23/.scope-git-'));
 const git=(...args)=>command('git',['-c','user.name=Constraint Fixture','-c','user.email=constraint@example.invalid','-c','commit.gpgsign=false','-c','core.hooksPath=/dev/null',...args],root);
 const put=(name,text)=>writeFile(path.join(root,name),text);
 const commit=async text=>{await git('add','--all');await git('commit','-qm',text);return git('rev-parse','HEAD');};
 try{
  await git('init','-q','--initial-branch=case');await put('README','base\n');await put('shared.txt','original\n');const base=await commit('base');
  await git('checkout','-qb','fixture-main');await put('shared.txt','approved fixture history\n');await put('old-fixture.txt','prior test\n');const historySha=await commit('approved history');
  const history={sha:historySha,source:'remote-main-before-session',repository:'fixture/local',observedAt:'2026-10-23T00:00:00Z'},filename='target.txt';
  const capture=()=>captureScope(root,{base,filename,history});
  await git('checkout','-qb','rebased');await put(filename,'target\n');await commit('only target');
  await t.test('rebased known history is accepted',async()=>assert.equal(verdict(await capture()),'PASS'));
  await t.test('extra dirty history path is a hard failure',async()=>{await put('shared.txt','dirty\n');assert.equal(verdict(await capture()),'FAIL');await git('restore','--','shared.txt');});
  await t.test('dirty rename records both source and destination',async()=>{await rename(path.join(root,'shared.txt'),path.join(root,'renamed file.txt'));await git('add','--all');const a=await capture();assert(a.dirtyPaths.includes('shared.txt'));assert(a.dirtyPaths.includes('renamed file.txt'));assert.equal(verdict(a),'FAIL');await git('restore','--staged','--','.');await git('restore','--worktree','--','shared.txt');await rm(path.join(root,'renamed file.txt'),{force:true});});
  await t.test('missing history object and incomplete capture cannot pass',async()=>{const a=await captureScope(root,{base,filename,history:{...history,sha:'f'.repeat(40)}});assert.equal(verdict(a),'UNKNOWN');});
  await t.test('arbitrary unapproved history is not adopted',async()=>{const a=await captureScope(root,{base,filename,history:{...history,sha:base}});assert.equal(verdict(a),'FAIL');});
  await t.test('committed extra mode change stays a failure after reverting it',async()=>{await chmod(path.join(root,'shared.txt'),0o755);await commit('unexpected mode');await chmod(path.join(root,'shared.txt'),0o644);await commit('revert mode');assert.equal(verdict(await capture()),'FAIL');});
  await git('checkout','-qb','merged',base);await put(filename,'target\n');const own=await commit('only own edit');
  await t.test('unused missing remote object does not block a pure target-only branch',async()=>assert.equal(verdict(await captureScope(root,{base,filename,history:{...history,sha:'f'.repeat(40)}})),'PASS'));
  await git('merge','--no-edit','fixture-main');
  await t.test('merge of frozen history with unchanged non-target entries is accepted',async()=>assert.equal(verdict(await capture()),'PASS'));
  await git('checkout','-qb','bad-resolution',own);await git('merge','--no-ff','--no-commit','fixture-main');await put('shared.txt','unapproved resolution\n');await commit('bad merge resolution');
  await t.test('merge resolution modifying a non-target file is rejected',async()=>assert.equal(verdict(await capture()),'FAIL'));
 }finally{await rm(root,{recursive:true,force:true});}
});
test('missing tree/ancestry proof is UNKNOWN, while an independent real edit remains FAIL',()=>{const a=structuredClone(saved.scope),p=a.committedPaths.find(p=>p!==a.filename);delete a.headEntries[p];assert.equal(verdict(a),'UNKNOWN');a.complete=false;a.commits.push({sha:'bad',parents:[a.head],paths:['actually-new.txt']});assert.equal(verdict(a),'FAIL');});
test('all six saved snapshots regrade with every other turn verdict unchanged',async()=>{const projection=await json(new URL('../../docs/verification/constraint-benchmark-scope-2026-10-23/saved-scopes.json',import.meta.url));const f=await json(new URL('../../docs/verification/constraint-benchmark/20261023020035204-8b1863/facts.json',import.meta.url)),old=await json(new URL('../../docs/verification/constraint-benchmark/20261023020035204-8b1863/verdicts.json',import.meta.url));for(const a of projection.scopes)f.sessions.find(s=>s.id===a.sessionId).turns.find(t=>t.id===a.turnId).after.scope=a.scope;const now=gradeRun(f);for(const s of now.sessions)for(const t of s.turns){const prior=old.sessions.find(p=>p.id===s.id).turns.find(p=>p.id===t.id);assert.equal(t.finalVerdict,s.id===saved.caseId&&t.id==='T3'?'PASS':prior.finalVerdict);}assert.equal(now.exitCode,1);});
