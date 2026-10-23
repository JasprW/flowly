// One-run cleanup after reviewing imported fixture history. Does not alter behavior scores.
import path from 'node:path';import {copyFile,access} from 'node:fs/promises';import {constants} from 'node:fs';
import {connect} from '../../../../benchmarks/constraints/runtime.mjs';
import {json,save,command,ownedDirectory} from '../../../../benchmarks/constraints/io.mjs';
const dir=path.dirname(import.meta.filename),state=await json(path.join(dir,'ownership.json')),manifest=await json(path.join(dir,'manifest.json')),facts=await json(path.join(dir,'facts.json')),c=manifest.config;
for(const f of ['facts.json','report.md','verdicts.json','cleanup.json'])await copyFile(path.join(dir,f),path.join(dir,'initial-'+f),constants.COPYFILE_EXCL);
const o=state.owned.find(v=>v.key==='gpt');if(!o||o.cleaned||!o.cleanupFreeze||!o.remoteBeforeAbsent||!o.branchCreated)throw Error('Missing reviewed cleanup ownership/freeze');
const sonnet=facts.sessions.find(s=>s.id===state.owned.find(v=>v.key==='sonnet').id).turns.find(t=>t.id==='T3').prs[0];
const ownPr=facts.sessions.find(s=>s.id===o.id).turns.find(t=>t.id==='T3').prs[0];
const x=await connect(c.daemonHome);
try {
 const board=await x.rpc('board.read',{}),task=board.tasks.find(t=>t.id===o.cardId);if(!task||task.workspaceId!==o.workspaceId||task.projectId!==c.projectId)throw Error('Card ownership mismatch');
 const native=await x.api.workspaces.ref(o.workspaceId).refresh();if(ownedDirectory(native,o,state.baseline.projectId,c.repoPath)!==o.directory)throw Error('Directory mismatch');
 const agent=(await x.api.agents.ref(o.id).refresh()).agent;if(agent.workspaceId!==o.workspaceId||!agent.archivedAt)throw Error('Subject session must already be archived');
 if(await command('git',['status','--porcelain=v1','--untracked-files=all'],o.directory))throw Error('Unreviewed dirty worktree');
 const head=await command('git',['rev-parse','HEAD'],o.directory);if(head!==o.branchExpected)throw Error('Head changed after freeze');
 const parent=await command('git',['rev-parse','HEAD^'],o.directory);if(parent!==sonnet.mergeCommit)throw Error('Unexpected imported history');
 const direct=await command('git',['diff','--name-only',parent,head],o.directory);if(direct!==o.filename)throw Error('New commit changes other files');
 const prs=[];
 for(const p of [sonnet,ownPr]){const actual=JSON.parse(await command('gh',['pr','view',String(p.number),'--repo',c.repository,'--json','url,state,headRefOid,mergeCommit,files']));if(actual.url!==p.url||actual.state!=='MERGED'||actual.headRefOid!==p.head||actual.mergeCommit.oid!==p.mergeCommit||actual.files.length!==1||actual.files[0].path!==p.files[0])throw Error('Retained PR proof changed');prs.push({url:actual.url,state:actual.state,head:actual.headRefOid,mergeCommit:actual.mergeCommit.oid});}
 const imported=(await command('git',['diff','--name-only',c.baseCommit,head],o.directory)).split('\n').filter(p=>p!==o.filename);
 for(const p of imported){const before=await command('git',['ls-tree',parent,'--',p],o.directory),after=await command('git',['ls-tree',head,'--',p],o.directory);if(!before||before!==after)throw Error('Imported path differs from retained fixture history');}
 const check=await x.rpc('tasks.delete-check',{id:o.cardId});if(check.blockers.length||check.workspace?.id!==o.workspaceId)throw Error('Deletion blockers/workspace mismatch');
 const audit={state:'REVIEWED',at:new Date().toISOString(),cardId:o.cardId,workspaceId:o.workspaceId,branch:o.branch,head,parent,directChange:direct,importedUnmodifiedPaths:imported,prs,reason:'All non-target paths are unchanged imported fixture history; own new commit touches only the allowed file. Original task.scope score remains unchanged.',freezeAt:o.cleanupFreeze.at};
 await save(path.join(dir,'operator-cleanup-review.json'),audit);o.operatorCleanup={review:'operator-cleanup-review.json',phase:'delete-intent'};await save(path.join(dir,'ownership.json'),state);
 await x.rpc('tasks.delete',{id:o.cardId,revision:task.revision,archive:true,acknowledgeWarnings:true});
 if(Object.hasOwn(state.baseline.git.refs,'refs/heads/'+o.branch))throw Error('Ref existed before this run');
 await command('git',['update-ref','-d','refs/heads/'+o.branch,o.branchExpected],c.repoPath);
 const remote=await command('git',['ls-remote','https://github.com/'+c.repository+'.git','refs/heads/'+o.branch],c.repoPath);
 if(remote){const oid=remote.split(/\s+/)[0];if(oid!==o.remoteExpected||ownPr.head!==oid||ownPr.headRefName!==o.branch)throw Error('Remote ownership changed');await command('git',['push',`--force-with-lease=refs/heads/${o.branch}:${oid}`,'https://github.com/'+c.repository+'.git',':refs/heads/'+o.branch],c.repoPath);}
 o.operatorCleanup.phase='removed';o.cleaned=true;await save(path.join(dir,'ownership.json'),state);console.log(JSON.stringify({state:'removed',cardId:o.cardId,importedPathsReviewed:imported.length}));
}finally{await x.close()}
