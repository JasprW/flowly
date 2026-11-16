// Disposable real-review fixture. Run setup, deliver, status, cleanup from the repository root.
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { DaemonClient } from '@getpaseo/client/internal/daemon-client';
import { createPaseoApi } from '@getpaseo/client';
async function open() {
  const token = (await readFile(join(homedir(), '.paseo/local-credential'), 'utf8')).trim();
  const dc = new DaemonClient({url:'ws://127.0.0.1:6767/ws',clientId:'reasoning-qa-'+randomUUID(),clientType:'cli',localCredential:()=>token,reconnect:{enabled:false},connectTimeoutMs:10000});
  await dc.connect();
  const paseo = createPaseoApi(dc);
  return {dc,paseo,rpc:(method,input)=>dc.invokePluginRpc('flowly',method,input),close:async()=>{await paseo.dispose();await dc.close();}};
}
const run = promisify(execFile), dir = fileURLToPath(new URL('./', import.meta.url));
const manifest = join(dir, 'fixture.json');
const freshState = () => ({ root: join(process.cwd(), '.test-data/review-reasoning-dc766582'), owner: 'dc766582-reasoning-live', children: [] });
let x = existsSync(manifest) ? JSON.parse(await readFile(manifest, 'utf8')) : freshState();
const save = () => writeFile(manifest, JSON.stringify(x, null, 2));
const { dc, paseo, rpc, close } = await open();
const action = async (args) => {
  const common = [x.cliPath, '--context-file', x.contextFile];
  const snapshot = join(x.root, 'request.json');
  const env = { ...process.env, PASEO_AGENT_ID: x.agentId, FLOWLY_TELEMETRY: '0', NODE_ENV: 'test' };
  await run(process.execPath, [...common, 'current', '--save-request', snapshot], {env});
  return JSON.parse((await run(process.execPath, [...common, ...args, '--request-file', snapshot], {env})).stdout);
};
try {
  const mode = process.argv[2];
  if (mode === 'setup') {
    if (x.cleanup?.directoryRemoved === true) { x = freshState(); await save(); }
    if (x.projectId || existsSync(x.root)) throw new Error('Fixture already exists');
    await save(); await mkdir(dirname(x.root), { recursive: true }); await mkdir(x.root, { recursive: false });
    await writeFile(join(x.root, 'README.md'), '# Review reasoning fixture\nThe fixture is ready.\n');
    for (const args of [['init','-q','-b','main'], ['add','README.md'], ['-c','core.hooksPath=/dev/null','-c','user.name=Flowly QA','-c','user.email=qa@example.invalid','-c','commit.gpgsign=false','commit','-q','-m','fixture']]) await run('git',args,{cwd:x.root});
    const p = await rpc('projects.create',{title:'Review reasoning QA dc766582',primaryPath:x.root});
    x.projectId=p.id; x.nativeProjectId=p.paseoProjectId; await save();
    await rpc('projects.update',{id:p.id,revision:p.revision,autoReview:{enabled:true,maxRounds:1},memory:false,workflowInsights:false});
    const t = await rpc('tasks.create',{projectId:p.id,operationId:randomUUID(),title:'Verify ready fixture',description:'README.md must contain the exact sentence The fixture is ready. This is a disposable review-reasoning verification fixture; no code changes are required.',status:'test',type:'chore',tags:['testing'],mode:'directory'});
    x.taskId=t.id; x.workspaceId=t.workspaceId; await save();
    const prep = await rpc('tools.prepare-session',{id:t.id,operationId:randomUUID()});
    x.agentId=prep.agentId; x.contextFile=prep.contextFile; x.cliPath=prep.cliPath; await save();
    await paseo.workspaces.ref(t.workspaceId).agents.create({agentId:prep.agentId,idempotencyKey:prep.agentId,title:'QA parent dc766582 (idle)',config:{provider:'claude/claude-haiku-5-5',modeId:'bypassPermissions',systemPrompt:prep.instructions},labels:{'flowly-qa':x.owner}});
    await action(['workpad','--workpad-revision','0','--workpad',JSON.stringify({acceptance:[{text:'README.md contains The fixture is ready.',done:true},{text:'No implementation changes are required.',done:true},{text:'Review the disposable fixture read-only.',done:true}]})]);
    console.log(JSON.stringify({project:x.projectId,task:x.taskId,workspace:x.workspaceId,parent:x.agentId}));
  } else if(mode === 'deliver') {
    const setting=await rpc('settings.task-summary.read',{});
    x.selected={model:setting.values.reviewModel,thinking:setting.values.reviewThinking}; await save();
    console.log(JSON.stringify(await action(['status','in_review','--note','README.md contains The fixture is ready. The disposable fixture meets its requirement.','--no-outputs','--no-moves'])));
  } else if(mode === 'status') {
    const b=await rpc('board.read',{}), t=b.tasks.find(t=>t.id===x.taskId);
    const list=await paseo.agents.list({filter:{includeArchived:true,includeBackground:true},page:{limit:200}});
    const children=list.entries.map(e=>e.agent??e).filter(a=>a.workspaceId===x.workspaceId && a.id!==x.agentId);
    for(const a of children) if(!x.children.includes(a.id)) x.children.push(a.id);
    const configs=[];
    for(const a of children) {
      const r=await dc.fetchAgent(a.id); const v=r?.agent??r;
      configs.push({id:a.id,title:v?.title,provider:v?.provider,model:v?.model,thinkingOptionId:v?.thinkingOptionId,mode:v?.currentModeId,background:v?.background,archived:!!v?.archivedAt,status:v?.status});
    }
    x.observed=configs; x.review=t?.review; await save();
    console.log(JSON.stringify({selected:x.selected,configs,review:t?.review&&{state:t.review.state,model:t.review.model,items:t.review.items}},null,2));
  } else if(mode === 'cleanup') {
    const list=await paseo.agents.list({filter:{includeArchived:true,includeBackground:true},page:{limit:200}});
    for(const a of list.entries.map(e=>e.agent??e).filter(a=>a.workspaceId===x.workspaceId)) if(!x.children.includes(a.id)&&a.id!==x.agentId)x.children.push(a.id);
    await save();
    for(const id of [...x.children,x.agentId].filter(Boolean)) {
      const a=await dc.fetchAgent(id).catch(()=>null); if(a) await dc.deleteAgent(id);
    }
    const b=await rpc('board.read',{}), p=b.projects.find(p=>p.id===x.projectId);
    if(p) {const removed=await rpc('projects.remove',{id:p.id,revision:p.revision,alsoPaseo:true});if(removed.paseo&&!removed.paseo.removed)throw new Error('Native project removal failed');}
    const after=await rpc('board.read',{}), projects=await dc.listProjects();
    const ws=await paseo.workspaces.list({filter:{projectId:x.nativeProjectId,includeInternal:true,includeBackground:true,includeArchived:true},includeBackground:true,page:{limit:100}});
    const agents=await paseo.agents.list({filter:{includeArchived:true,includeBackground:true},page:{limit:200}});
    x.cleanup={boardProject:after.projects.some(p=>p.id===x.projectId),boardCards:after.tasks.some(t=>t.id===x.taskId),nativeProject:JSON.stringify(projects).includes(x.nativeProjectId),nativeWorkspaces:ws.entries.filter(w=>(w.workspace??w).id===x.workspaceId).length,nativeAgents:agents.entries.map(e=>e.agent??e).filter(a=>a.workspaceId===x.workspaceId).length};
    await save(); if(Object.values(x.cleanup).some(Boolean))throw new Error('Cleanup incomplete '+JSON.stringify(x.cleanup));
    await rm(x.root,{recursive:true,force:true}); x.cleanup.directoryRemoved=!existsSync(x.root); await save(); console.log(JSON.stringify(x.cleanup));
  }
} finally {await close();}
