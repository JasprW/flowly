#!/usr/bin/env node
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash } from './facts.mjs';
import { json,save,config,command,inside,providerUnavailable } from './io.mjs';
import { gradeRun,markdown,prerequisites } from './grade.mjs';
const sourceRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const graderIdentity=hash(Buffer.concat(await Promise.all(['grade.mjs','scope.mjs'].map(n=>readFile(new URL(n,import.meta.url))))));
const runsRoot=path.join(sourceRoot,'docs/verification/constraint-benchmark');
export function argumentsFor(argv) {
  const [action,...rest]=argv;
  if(action==='--help'||action==='help')return {action:'help'};
  if(!['run','grade','cleanup'].includes(action))throw Error('Use run, grade or cleanup');
  const out={action};
  for(let i=0;i<rest.length;i+=2){const k=rest[i],v=rest[i+1];if(!['--profile','--config','--run'].includes(k)||!v||v.startsWith('--')||Object.hasOwn(out,k.slice(2)))throw Error('Invalid/duplicate argument');out[k.slice(2)]=v;}
  if(action==='run'&&(!out.config||out.profile!=='quick'||out.run)||action!=='run'&&(!out.run||out.config||out.profile))throw Error('run requires --profile quick --config; grade/cleanup require --run');
  if(out.run&&!/^[a-zA-Z0-9-]{1,100}$/.test(out.run))throw Error('Invalid run ID');return out;
}
async function report(dir,facts) {
  const v=gradeRun(facts);const version=graderIdentity.slice(0,12)+'-'+hash(JSON.stringify(facts)).slice(0,12);v.graderHash=graderIdentity;v.factsHash=hash(JSON.stringify(facts));
  await save(path.join(dir,`verdicts-${version}.json`),v);await writeFile(path.join(dir,`report-${version}.md`),markdown(v));
  await save(path.join(dir,'verdicts.json'),v);await writeFile(path.join(dir,'report.md'),markdown(v));return v;
}
async function identity() {
  const files=['cases.json','facts.mjs','grade.mjs','io.mjs','scope.mjs','runtime.mjs','run.mjs'];const hashes={};
  for(const name of files)hashes[name]=hash(await readFile(new URL(name,import.meta.url)));
  return {head:await command('git',['rev-parse','HEAD'],sourceRoot),tree:await command('git',['rev-parse','HEAD^{tree}'],sourceRoot),dirtyPatchHash:hash(await command('git',['diff','--binary'],sourceRoot)),files:hashes};
}
export async function main(argv=process.argv.slice(2)) {
  let args;try {args=argumentsFor(argv);}catch(e){console.error(e.message);return 64;}
  if(args.action==='help'){console.log('run --profile quick --config FILE | grade --run ID | cleanup --run ID');return 0;}
  if(args.action==='grade') {const dir=path.join(runsRoot,args.run);const v=await report(dir,await json(path.join(dir,'facts.json')));console.log(JSON.stringify({runId:args.run,exitCode:v.exitCode,report:path.join(dir,'report.md')}));return v.exitCode;}
  const {connect,preflight,prepareCase,snapshot,collectTurn,cleanup}=await import('./runtime.mjs');
  if(args.action==='cleanup') {
    const dir=path.join(runsRoot,args.run);const state=await json(path.join(dir,'ownership.json'));const manifest=await json(path.join(dir,'manifest.json'));const c=config(manifest.config);const x=await connect(c.daemonHome);
    try {const result=await cleanup(x,c,state,()=>save(path.join(dir,'ownership.json'),state));await save(path.join(dir,'cleanup.json'),result);const facts=await json(path.join(dir,'facts.json'));facts.cleanup=result;await save(path.join(dir,'facts.json'),facts);return (await report(dir,facts)).exitCode;} finally {await x.close();}
  }
  let c;try {c=config(await json(path.resolve(args.config)));}catch(e){console.error(e.message);return 64;}
  const runId=new Date().toISOString().replace(/[^0-9]/g,'').slice(0,17)+'-'+hash(Math.random().toString()).slice(0,6);
  const dir=path.join(runsRoot,runId);await mkdir(runsRoot,{recursive:true});await mkdir(dir,{recursive:false});
  const cases=await json(new URL('./cases.json',import.meta.url));
  const state={runId,owned:[],createdAt:new Date().toISOString()};const persist=()=>save(path.join(dir,'ownership.json'),state);
  const facts={schemaVersion:1,runId,sessions:[],cleanup:{state:'UNRUN'}};
  const manifest={runId,config:c,cases,source:await identity(),createdAt:state.createdAt,planned:c.models.map(m=>({model:m.provider+'/'+m.model,key:m.key,turns:['T1','T2','T3']}))};
  await save(path.join(dir,'manifest.json'),manifest);await persist();await save(path.join(dir,'facts.json'),facts);
  let x,aborted=false;const deadline=Date.now()+c.runTimeoutMs;
  const stop=()=>{aborted=true;if(x)for(const o of state.owned)if(o.id)void x.client.cancelAgent(o.id).catch(()=>{});};process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try {
    x=await connect(c.daemonHome);await preflight(x,c,state,persist);
    // A directory installation is recorded as such, never asserted to be a verified loaded bundle hash.
    const installed=JSON.parse(await command('paseo',['--home',x.home,'plugin','ls','flowly','--json'],sourceRoot));
    manifest.runtime={installation:installed.map(p=>({id:p.id,path:p.path,status:p.status})),loadedImplementationHash:'unknown',skillHash:hash(await readFile(path.join(x.data,'SKILL.md')))};await save(path.join(dir,'manifest.json'),manifest);
    for(const m of c.models) {
      if(aborted||Date.now()>=deadline||!state.availability.find(a=>a.key===m.key)?.available) {
        facts.sessions.push({id:'unrun-'+m.key,cardId:'',model:m.model,turns:[],reason:'budget-abort-or-model-unavailable'});continue;
      }
      let o,agent,session;
      try {
        ({owned:o,agent}=await prepareCase(x,c,state,m,dir,persist));
        session={id:o.id,cardId:o.cardId,model:m.model,repository:c.repository,filename:o.filename,checkCommand:o.checkCommand,checkId:o.checkId,checkHash:o.checkHash,turns:[]};facts.sessions.push(session);
        for(const step of cases.turns) {
          const before=step.id==='T1'?o.initialBefore:await snapshot(x,o);const actual=(await agent.refresh())?.agent;
          const gate=prerequisites(step.id,session.turns,!!before.file,step.id==='T1'||actual?.status==='idle');
          if(!gate.ok||aborted||Date.now()>=deadline){session.turns.push({id:step.id,state:'UNRUN',reason:gate.reason??'budget-or-abort'});await save(path.join(dir,'facts.json'),facts);continue;}
          const t={id:step.id,state:'VALID',before,startedAt:step.id==='T1'?o.startedAt:new Date().toISOString()};session.turns.push(t);o.turns.push({id:step.id,startedAt:t.startedAt,phase:'send-intent'});await persist();await save(path.join(dir,'facts.json'),facts);
          console.log(JSON.stringify({runId,model:m.key,turn:step.id,session:o.id,phase:'waiting'}));
          if(step.id!=='T1')await agent.send(step.prompt);
          o.turns.at(-1).phase='sent';await persist();
          const wait=await agent.waitForFinish(Math.max(1,Math.min(c.turnTimeoutMs,deadline-Date.now())));
          if(wait.status!=='idle'){t.state=wait.status==='timeout'&&!aborted?'VALID':'INVALID';t.budgetExceeded=wait.status==='timeout'&&!aborted;t.reason=t.budgetExceeded?'fixed-turn-budget-exhausted':'provider-'+wait.status;await x.client.cancelAgent(o.id);await agent.waitForFinish(15000);}
          await collectTurn(x,c,o,t,agent);const unavailable=providerUnavailable(wait.lastMessage);if(unavailable&&!t.calls.length){t.state='INVALID';t.reason='provider-'+unavailable;}await save(path.join(dir,'facts.json'),facts);await persist();
          console.log(JSON.stringify({runId,model:m.key,turn:step.id,phase:'captured',state:t.state,calls:t.calls.length,prs:t.prs.length}));
          if(t.state!=='VALID')break;
        }
      }catch(e){
        o??=state.owned.find(v=>v.key===m.key);if(!session){session={id:o?.id??'invalid-'+m.key,cardId:o?.cardId??'',model:m.model,repository:c.repository,filename:o?.filename??'',turns:[]};facts.sessions.push(session);}
        session.infrastructureError=e.code??e.name;for(const id of ['T1','T2','T3'])if(!session.turns.some(t=>t.id===id))session.turns.push({id,state:'INVALID',reason:'case-infrastructure-error'});
        await save(path.join(dir,'facts.json'),facts);console.log(JSON.stringify({runId,model:m.key,phase:'infrastructure-error',error:e.code??e.name}));
      }
    }
  }catch(e){facts.infrastructureError=e.code??e.name;for(const m of c.models)if(!facts.sessions.some(s=>s.model===m.model))facts.sessions.push({id:'unrun-'+m.key,cardId:'',model:m.model,turns:[],reason:'preflight-or-connection-failed'});console.log(JSON.stringify({runId,phase:'preflight-error',error:e.code??e.name}));}
  finally {
    process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);
    if(x){try {facts.cleanup=await cleanup(x,c,state,persist);}catch(e){facts.cleanup={state:'FAIL',problems:[{reason:e.code??e.name}]};}await x.close();}
    await save(path.join(dir,'ownership.json'),state);await save(path.join(dir,'cleanup.json'),facts.cleanup);await save(path.join(dir,'facts.json'),facts);
  }
  const v=await report(dir,facts);console.log(JSON.stringify({runId,report:path.join(dir,'report.md'),exitCode:v.exitCode}));return v.exitCode;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().then(code=>{process.exitCode=code;},e=>{console.error(e.code??e.name);process.exitCode=2;});
