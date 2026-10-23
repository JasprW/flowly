import { readFile,writeFile,rename,mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { hash } from './facts.mjs';
export const execute=promisify(execFile);
export async function command(bin,args,cwd,timeout=30000) {return (await execute(bin,args,{cwd,timeout,maxBuffer:8<<20,env:{...process.env,GIT_TERMINAL_PROMPT:'0'}})).stdout.trimEnd();}
export const json=async file=>JSON.parse(await readFile(file,'utf8'));
export async function save(file,value) {await mkdir(path.dirname(file),{recursive:true});const temp=file+'.tmp';await writeFile(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600});await rename(temp,file);}
export function inside(root,target) {const p=path.relative(root,target);return p===''||!p.startsWith('..'+path.sep)&&p!=='..'&&!path.isAbsolute(p);}
export function config(input,base=process.cwd()) {
  const keys=['projectId','repository','repoPath','baseCommit','models','parentAgentId','daemonHome','turnTimeoutMs','runTimeoutMs'];
  if(!input||Object.keys(input).some(k=>!keys.includes(k)))throw Error('Unknown configuration key');
  for(const k of ['projectId','repository','repoPath','baseCommit','parentAgentId'])if(typeof input[k]!=='string'||!input[k])throw Error('Missing '+k);
  if(!/^[\w.-]+\/[\w.-]+$/.test(input.repository)||!(/^[a-f0-9]{40}$/.test(input.baseCommit)))throw Error('Expected explicit repository and full base commit');
  if(!Array.isArray(input.models)||input.models.length!==2||new Set(input.models.map(m=>m.key)).size!==2)throw Error('quick requires two explicitly configured models');
  for(const m of input.models) {
    if(!m||!/^[a-z][a-z0-9-]{0,20}$/.test(m.key)||!['claude','codex'].includes(m.provider)||typeof m.model!=='string'||/auto/i.test(m.model)||!m.thinking)throw Error('Invalid model configuration');
    if(m.mode!==(m.provider==='codex'?'full-access':'bypassPermissions'))throw Error('Full access must be set at creation');
    if(Object.keys(m).some(k=>!['key','provider','model','mode','thinking'].includes(k)))throw Error('Unknown model configuration');
  }
  if(new Set(input.models.map(m=>m.provider)).size!==2)throw Error('quick requires Claude and Codex');
  const out={...input,repoPath:path.resolve(base,input.repoPath),turnTimeoutMs:input.turnTimeoutMs??600000,runTimeoutMs:input.runTimeoutMs??3600000};
  for(const k of ['turnTimeoutMs','runTimeoutMs'])if(!Number.isSafeInteger(out[k])||out[k]<1000||out[k]>24*3600000)throw Error('Invalid '+k);
  return out;
}
export async function gitSnapshot(repo) {
  const refs=await command('git',['for-each-ref','--format=%(refname) %(objectname)'],repo);
  return {refs:refs?Object.fromEntries(refs.split('\n').map(x=>x.split(' '))):{},configHash:hash(await command('git',['config','--null','--list'],repo)),remoteHash:hash(await command('git',['remote','-v'],repo)),statusHash:hash(await command('git',['status','--porcelain=v1','--untracked-files=all'],repo)),head:await command('git',['rev-parse','HEAD'],repo)};
}
export function deletableRef(ref,before,current,expected) {
  return /^refs\/heads\/bench-constraints-[a-zA-Z0-9-]+$/.test(ref)&&!Object.hasOwn(before,ref)&&!!expected&&current===expected;
}

export function ownedDirectory(workspace,owned,projectId,root) {
  if(workspace?.id!==owned.workspaceId||workspace.projectId!==projectId||workspace.workspaceKind!=='worktree'||workspace.projectRootPath!==root||typeof workspace.workspaceDirectory!=='string'||!path.isAbsolute(workspace.workspaceDirectory))throw Error('Owned workspace directory unavailable or mismatched');
  return workspace.workspaceDirectory;
}
export function providerUnavailable(message) {
  const text=typeof message==='string'?message:message?.text;
  return typeof text==='string'&&/^You've hit your weekly limit(?: ·|$)/.test(text.trim())?'weekly-quota':null;
}

export function remotePrOwned(o,p,repository) {
  return o.remoteBeforeAbsent===true&&!!o.id&&!!o.startedAt&&p.repository===repository&&p.headRefName===o.branch&&p.createdAt>=o.startedAt&&p.url===`https://github.com/${repository}/pull/${p.number}`&&p.head===o.remoteExpected&&p.files?.length===1&&p.files[0]===o.filename;
}
