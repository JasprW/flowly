// One owned dirty worktree, no model/session/PR. Tests the actual cleanup/freeze path.
import path from 'node:path';
import {writeFile,mkdir} from 'node:fs/promises';
import {connect,preflight,cleanup} from '../../../benchmarks/constraints/runtime.mjs';
import {json,save,ownedDirectory,command} from '../../../benchmarks/constraints/io.mjs';
const out=path.dirname(import.meta.filename),c=await json(path.join(out,'local-config.json'));
const state={runId:'cleanup-'+new Date().toISOString().replace(/[^0-9]/g,''),owned:[]};
const file=path.join(out,'cleanup-smoke-ownership.json'),persist=()=>save(file,state);await persist();
const x=await connect();let result;
try {
 await preflight(x,c,state,persist);
 const branch='bench-constraints-'+state.runId+'-owned';const o={key:'cleanup',branch,operationId:branch,filename:'docs/'+branch+'.txt',baseCommit:c.baseCommit,phase:'intent'};state.owned.push(o);await persist();
 const task=await x.rpc('tasks.create',{projectId:c.projectId,operationId:branch,title:'Benchmark cleanup contract '+state.runId,description:'Owned no-model cleanup contract fixture',mode:'worktree',baseRef:c.baseCommit,branchName:branch});
 o.cardId=task.id;o.workspaceId=task.workspaceId;await persist();
 o.directory=ownedDirectory(await x.api.workspaces.ref(task.workspaceId).refresh(),o,state.baseline.projectId,c.repoPath);
 if(await command('git',['symbolic-ref','--short','HEAD'],o.directory)!==branch)throw Error('Branch intent mismatch');o.branchCreated=true;o.branchExpected=c.baseCommit;await persist();
 await mkdir(path.join(o.directory,'docs'),{recursive:true});await writeFile(path.join(o.directory,o.filename),'Cleanup contract owned fixture.\n',{flag:'wx'});
} finally {
 try{result=await cleanup(x,c,state,persist);await save(path.join(out,'cleanup-smoke-result.json'),result);}finally{await x.close();}
}
console.log(JSON.stringify(result));if(result.state!=='PASS')process.exitCode=1;
