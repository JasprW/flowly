// Round 4 UI acceptance checks. Run from the worktree root.
// Modes: e1-f1, e2-f1, e2-f2, idea-action <f1|f2> <continue|new-session|new-workspace|dismiss>, managed-e8, set-switch <outside|progress|nextMoves|ideas> <true|false>, settings-final.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { DaemonClient } from '@getpaseo/client/internal/daemon-client';
import { createPaseoApi } from '@getpaseo/client';
import { chromium } from '/Users/bofan.wang/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';

const evidencePath = new URL('./evidence.json', import.meta.url);
const uiPath = new URL('./ui-evidence.json', import.meta.url);
const baselinePath = new URL('./settings-before.json', import.meta.url);
const shotsDir = new URL('../../../native-session/round4/', import.meta.url);
const ev = JSON.parse(await readFile(evidencePath, 'utf8'));
const baseline = JSON.parse(await readFile(baselinePath, 'utf8')).settings;
const mode = process.argv[2] ?? 'e1-f1';
const browser = await chromium.launch({ headless: true, executablePath: '/Users/bofan.wang/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell' });
const context = await browser.newContext({ viewport: { width: 1700, height: 1000 } });
await context.grantPermissions(['local-network-access'], { origin: 'https://app.paseo.sh' });
const pageErrors = [];
const page = await context.newPage(); page.on('pageerror', (e) => pageErrors.push({ url: page.url(), message: String(e).slice(0, 400) }));
const daemon = new DaemonClient({ url: 'ws://127.0.0.1:6767/ws', clientId: `native-r4-ui-${Date.now()}`, clientType: 'cli', appVersion: '0.11.2', connectTimeoutMs: 10000, reconnect: { enabled: false } });
const api = createPaseoApi(daemon);
const rpc = (name, input = {}) => daemon.invokePluginRpc('flowly', name, input);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const takeShot = async (p, name) => { await mkdir(shotsDir, { recursive: true }); await p.screenshot({ path: new URL(`${name}.png`, shotsDir).pathname }); };
async function log(step, data) {
  let report; try { report = JSON.parse(await readFile(uiPath, 'utf8')); } catch { report = { round: 4, testSessionId: ev.testSessionId, steps: [] }; }
  report.steps.push({ step, at: new Date().toISOString(), ...data }); report.pageErrors = pageErrors;
  await writeFile(uiPath, JSON.stringify(report, null, 2)); console.log(step, JSON.stringify(data));
}
const allTimeline = async (id) => (await api.agents.ref(id).timeline.refetch({ direction: 'tail', limit: 120, projection: 'projected' })).entries.map((x) => x.item);
const insight = async (id) => (await rpc('sessions.insights', {})).value?.find((x) => x.agentId === id) ?? null;
async function allAgents(includeArchived = true) {
  const found = []; let cursor;
  do { const page = await api.agents.list({ filter: { includeArchived }, page: { limit: 200, cursor } }); found.push(...page.entries.map((x) => x.agent)); cursor = page.pageInfo.nextCursor ?? undefined; } while (cursor);
  return found;
}
async function allWorkspaces() {
  const found = []; let cursor;
  do { const page = await api.workspaces.list({ page: { limit: 200, cursor } }); found.push(...page.entries.map((x) => x.workspace)); cursor = page.pageInfo.nextCursor ?? undefined; } while (cursor);
  return found;
}
function session(slot) {
  const f = ev[slot]; if (!f?.agentId) throw new Error(`No ${slot} session in fixture evidence`); return f;
}
async function openBoard(p) {
  await p.goto('https://app.paseo.sh', { waitUntil: 'domcontentloaded', timeout: 45000 }); await p.waitForTimeout(1900);
  await p.getByRole('button', { name: /tinylink/i }).click(); await p.getByText('Flowly', { exact: true }).first().click(); await p.waitForTimeout(700); await p.getByText('Tinylink', { exact: true }).last().click(); await p.waitForTimeout(850);
}
async function openF1Native(p, managed = false) {
  const f = ev.f1; await openBoard(p);
  const filters = p.getByRole('button', { name: /Task filters/ });
  if (await filters.count()) {
    const label = await filters.getAttribute('aria-label');
    if (/\d+ active/.test(label ?? '')) { await filters.click(); if (await p.getByText('Reset filters', { exact: true }).count()) { await p.getByText('Reset filters', { exact: true }).click(); await p.waitForTimeout(180); await p.getByText('Done', { exact: true }).last().click(); await p.waitForTimeout(500); } }
  }
  await p.getByRole('button', { name: new RegExp(`Open task ${esc(f.title)}`) }).click(); await p.waitForTimeout(650);
  const title = managed ? '[test] native r4 managed session' : '[test] outside r4 card-folder';
  await p.getByRole('button', { name: new RegExp(`Preview ${esc(title)}`) }).click(); await p.waitForTimeout(450);
  await p.getByRole('button', { name: 'Open in Paseo' }).click(); await p.waitForTimeout(1100);
}
async function openF2Native(p) {
  const f = ev.f2;
  await openBoard(p);
  const url = new URL(p.url()); const match = url.pathname.match(/^\/h\/[^/]+/);
  if (!match) throw new Error(`Could not derive native server route from ${p.url()}`);
  const base = `${url.origin}${match[0]}`;
  await p.goto(`${base}/workspace/${f.workspaceId}`, { waitUntil: 'domcontentloaded', timeout: 45000 }); await p.waitForTimeout(4500);
  if ((await p.title()) !== f.title) {
    const tabs = p.getByRole('button', { name: /Switch tabs/ });
    if (await tabs.count()) { await tabs.last().click(); await p.waitForTimeout(250); const target = p.getByText(f.title, { exact: true }); if (await target.count()) await target.last().click(); await p.waitForTimeout(800); }
  }
}
async function openSettings(p) {
  await openBoard(p); await p.locator('[aria-label="Flowly settings"]').last().click(); await p.waitForTimeout(450); await p.getByRole('button', { name: 'AI features', exact: true }).click(); await p.waitForTimeout(500);
}
function switchLocator(p, key) {
  const labels = { outside: 'Sessions outside Flowly', progress: 'Progress', nextMoves: 'Suggested next steps', ideas: 'Ideas' };
  const loc = p.getByRole('switch', { name: labels[key], exact: true });
  return key === 'ideas' ? loc.last() : loc.first();
}
async function readSwitch(p, key) {
  return switchLocator(p, key).evaluate((el, label) => {
    const ds = [...el.querySelectorAll('div')], track = ds.at(-2), thumb = ds.at(-1); const transform = thumb ? getComputedStyle(thumb).transform : '';
    return { label, on: /matrix\(1, 0, 0, 1, 14(?:\.0+)?, 0\)/.test(transform), trackColor: track ? getComputedStyle(track).backgroundColor : '', thumbTransform: transform };
  }, key);
}
async function apiSettings() { return (await rpc('sessions.native-chips', {})).outside; }
async function setSwitch(key, desired) {
  await openSettings(page); const beforeUi = await readSwitch(page, key); const beforeApi = await apiSettings();
  if (beforeUi.on !== desired) await switchLocator(page, key).click();
  const deadline = Date.now() + 12000; let state = await apiSettings();
  const prop = ({ outside: 'enabled', progress: 'progress', nextMoves: 'nextMoves', ideas: 'ideas' })[key];
  while (state[prop] !== desired && Date.now() < deadline) { await sleep(250); state = await apiSettings(); }
  await sleep(250); const afterUi = await readSwitch(page, key);
  return { key, beforeUi, beforeApi, desired, afterUi, afterApi: state };
}
async function composerFor(agentId, workspaceId) {
  const fields = page.locator('textarea[data-composer-input]');
  const owners = await fields.evaluateAll(xs => xs.map(x => { const k=Object.keys(x).find(k=>k.startsWith('__reactFiber$')); let f=k?x[k]:null; for(;f;f=f.return){const p=f.memoizedProps;if(p&&typeof p.agentId==='string'&&'workspaceId' in p){return{agentId:p.agentId,workspaceId:p.workspaceId,alternateAgentId:f.alternate?.memoizedProps?.agentId??null};}}return null;}));
  const matches = owners.map((owner,index)=>({owner,index})).filter(x=>x.owner?.agentId===agentId&&x.owner?.workspaceId===workspaceId&&(!x.owner.alternateAgentId||x.owner.alternateAgentId===agentId));
  if(matches.length!==1) throw new Error(`Could not prove a unique composer for ${agentId}: ${JSON.stringify(owners)}`);
  return { locator: fields.nth(matches[0].index), owner: matches[0].owner, owners };
}
async function inspectOutside(slot, shot) {
  const f = session(slot); const items = await allTimeline(f.agentId); const state = (await api.agents.ref(f.agentId).refresh())?.agent; const v = await insight(f.agentId);
  const summaryRows = items.filter(x=>x?.type==='plugin'&&x.kind==='flowly-summary'); const moveRows=items.filter(x=>x?.type==='plugin'&&x.kind==='flowly-next-moves');
  const lastAssistant = items.reduce((i,x,n)=>x?.type==='assistant_message'?n:i,-1); const ready = moveRows.filter(x=>x.data?.status==='ready').at(-1); const readyIndex=ready?items.findIndex(x=>x?.id===ready.id):-1;
  const summary = summaryRows.at(-1); const body=await page.locator('body').innerText();
  const result={ slot, agentId:f.agentId, title:await page.title(), status:state?.status, archivedAt:state?.archivedAt??null,
    insightsView:v, summaryRows:summaryRows.map(x=>({id:x.id,data:x.data})), summaryIdMatches:summary?summary.id===`flowly-summary-${summary.data?.entryId}`:false,
    noTaskIdOnSummary:summary?!Object.hasOwn(summary.data??{},'taskId'):null,
    summaryVisible:!!summary&&body.includes('Progress'), progressHasOpenCard:await page.getByRole('button',{name:'Open card',exact:true}).count()>0,
    readyRows:moveRows.filter(x=>x.data?.status==='ready').map(x=>({id:x.id,data:x.data})), latestMoveIdMatches:ready?ready.id===`flowly-next-moves-${ready.data?.eventId}`:false,
    latestMoveStatus:ready?.data?.status??null, noTaskIdOnMove:ready?!Object.hasOwn(ready.data??{},'taskId'):null,
    moveCardUnderLastReply:readyIndex>lastAssistant, ideasView:v?.ideas??[], ideaChipCount:await page.getByRole('button',{name:'Ideas for this session'}).count(), ideasChipText:await page.getByRole('button',{name:'Ideas for this session'}).allInnerTexts(),
    moveButtons:await page.getByRole('button',{name:/^Suggested next step:/}).allInnerTexts(), bodyContainsSuggestedCard:body.includes('Suggested next steps') };
  if (shot) await takeShot(page,shot); await log(`outside-${slot}-native-inspection`,result); return result;
}
function sessionIdeaInstruction(idea) { return [`Good idea — go ahead with it in this task: ${idea.title.trim()}`,idea.detail.trim(),idea.rationale.trim()&&`Why: ${idea.rationale.trim()}`].filter(Boolean).join('\n\n'); }
async function persistAdopted(slot, data) {
  const dataPath = new URL('./evidence.json', import.meta.url); const e=JSON.parse(await readFile(dataPath,'utf8')); e[slot].ideaActions??=[]; e[slot].ideaActions.push({at:new Date().toISOString(),...data});
  if(data.target==='session'&&data.agentId){e[slot].extraSessionIds??=[];if(!e[slot].extraSessionIds.includes(data.agentId))e[slot].extraSessionIds.push(data.agentId);}
  if(data.target==='workspace'&&data.workspaceId){e[slot].workspaceIds??=[];if(!e[slot].workspaceIds.includes(data.workspaceId))e[slot].workspaceIds.push(data.workspaceId);e[slot].newWorkspaceAgentIds??=[];e[slot].newWorkspaceAgentIds.push(data.agentId);}
  await writeFile(dataPath,JSON.stringify(e,null,2));
}

try {
 await daemon.connect();
 if (mode === 'set-switch') {
   const key=process.argv[3], desired=process.argv[4]==='true'; const result=await setSwitch(key,desired); await log(`switch-${key}-${desired}`,result);
 } else if (mode === 'settings-final') {
   await openSettings(page); const states={outside:await readSwitch(page,'outside'),progress:await readSwitch(page,'progress'),nextMoves:await readSwitch(page,'nextMoves'),ideas:await readSwitch(page,'ideas')};
   const tap=page.getByRole('button',{name:'Tapping a suggested next step'}); const tapText=(await tap.innerText()).split('\n').at(-1); const result={states,tappingSuggestedNextStep:tapText,expected:baseline}; await log('settings-final',result);
 } else if (mode === 'e1-f1') {
   await openF1Native(page,false); const f=session('f1'); const items=await allTimeline(f.agentId); const data={title:await page.title(),outsideChip:await page.getByRole('button',{name:'Ideas for this session'}).count(),progressRows:items.filter(x=>x?.kind==='flowly-summary'),moveRows:items.filter(x=>x?.kind==='flowly-next-moves'),sessionInsights:await insight(f.agentId),settings:await apiSettings()}; await takeShot(page,'e1-f1-outside-disabled'); await log('e1-f1-ui',data);
 } else if (mode === 'e2-f1' || mode === 'e2-f2') {
   const slot=mode.endsWith('f1')?'f1':'f2'; if(slot==='f1')await openF1Native(page,false);else await openF2Native(page);
   const f=session(slot); const result=await inspectOutside(slot,`e2-${slot}-progress-next`);
   if (result.latestMoveStatus==='ready'&&result.moveButtons?.length) {
     const row=result.readyRows.at(-1); const move=row?.data?.moves?.[0]; const {locator:composer,owner,owners}=await composerFor(f.agentId,f.workspaceId); const before=(await allTimeline(f.agentId)).filter(x=>x?.type==='user_message').length;
     await page.getByRole('button',{name:`Suggested next step: ${move.label}`,exact:true}).click(); await page.waitForTimeout(300); const value=await composer.inputValue(); const focused=await composer.evaluate(x=>document.activeElement===x); const after=(await allTimeline(f.agentId)).filter(x=>x?.type==='user_message').length; await composer.fill(''); await takeShot(page,`e2-${slot}-fill`);
     await log(`e2-${slot}-fill`,{move,composerOwner:owner,owners,exactFill:value===move.prompt,value,focused,noMessageSent:before===after,userMessageCountBefore:before,userMessageCountAfter:after});
   } else await log(`e2-${slot}-fill-unrun`,{reason:'No ready message move or composer card was available.',result});
 } else if (mode === 'idea-action') {
   const slot=process.argv[3], action=process.argv[4]; if(slot==='f1')await openF1Native(page,false);else await openF2Native(page);
   const f=session(slot); const v=await insight(f.agentId); const ideas=v?.ideas??[]; const row=ideas[0]??null;
   if(!row){await log(`e4-${slot}-${action}-unrun`,{reason:'No naturally generated open idea was available; no idea was fabricated.',ideas});}
   else {
     await page.getByRole('button',{name:'Ideas for this session'}).click(); await page.waitForTimeout(300);
     const popoverTitle=await page.getByText('Ideas for this session',{exact:true}).count(); let actionData={idea:row,popoverTitleVisible:popoverTitle>0};
     if(action==='continue'){
       await page.getByRole('button',{name:'Continue here',exact:true}).first().click(); await page.waitForTimeout(200); const confirmation=(await page.locator('body').innerText()).includes('Sends this idea to this session.');
       const before=(await allTimeline(f.agentId)).filter(x=>x?.type==='user_message').length; await page.getByRole('button',{name:'Send',exact:true}).last().click(); const expected=sessionIdeaInstruction(row); const deadline=Date.now()+15000;let messages=[];do{messages=(await allTimeline(f.agentId)).filter(x=>x?.type==='user_message');if(messages.at(-1)?.text===expected)break;await sleep(250)}while(Date.now()<deadline);
       actionData={...actionData,confirmation,expectedInstruction:expected,lastUserMessage:messages.at(-1)?.text??null,exactInstructionSent:messages.at(-1)?.text===expected}; await persistAdopted(slot,{target:'here',ideaId:row.id});
     } else if(action==='dismiss'){
       const beforeCount=await page.getByRole('button',{name:'Ideas for this session'}).innerText(); await page.getByRole('button',{name:`Dismiss ${row.title}`,exact:true}).click(); const deadline=Date.now()+1000;let chipStill=true;do{chipStill=await page.getByRole('button',{name:'Ideas for this session'}).count()>0;if(!chipStill)break;await sleep(60)}while(Date.now()<deadline);
       const afterView=await insight(f.agentId);actionData={...actionData,beforeCount,chipGoneWithinOneSecond:!chipStill,remainingIdeas:afterView?.ideas??[]}; await persistAdopted(slot,{target:'dismiss',ideaId:row.id});
     } else if(action==='new-session'){
       const before=(await allAgents(true)).filter(x=>x.workspaceId===f.workspaceId).map(x=>x.id); await page.getByRole('button',{name:'New session',exact:true}).first().click(); await page.waitForTimeout(700);
       const deadline=Date.now()+15000;let created=[];do{created=(await allAgents(true)).filter(x=>x.workspaceId===f.workspaceId&&!before.includes(x.id));if(created.length)break;await sleep(300)}while(Date.now()<deadline);
       const agent=created.at(-1)??null;const msgs=agent?(await allTimeline(agent.id)).filter(x=>x?.type==='user_message'):[];const expected=sessionIdeaInstruction(row);
       actionData={...actionData,createdAgent:agent?{id:agent.id,title:agent.title,workspaceId:agent.workspaceId,provider:agent.provider,model:agent.model}:null,firstMessage:msgs[0]?.text??null,firstMessageMatchesIdea:msgs[0]?.text===expected}; await persistAdopted(slot,{target:'session',ideaId:row.id,agentId:agent?.id??null,workspaceId:f.workspaceId});
     } else if(action==='new-workspace'){
       const beforeIds=new Set((await allWorkspaces()).map(x=>x.id)); await page.getByRole('button',{name:'New workspace',exact:true}).first().click();
       const deadline=Date.now()+30000;let viewAfter=null,adopted=null;do{viewAfter=await insight(f.agentId);const fresh=await allWorkspaces();adopted=fresh.find(x=>!beforeIds.has(x.id))??null;if(adopted)break;await sleep(400)}while(Date.now()<deadline);
       const currentView=await insight(f.agentId);const now=currentView?.ideas??[];const adoptedIdea=ideas.find(x=>x.id===row.id);const stateAgent=adopted?.id?((await allAgents(true)).filter(x=>x.workspaceId===adopted.id).at(-1)??null):null;const details=adopted?.id?await api.workspaces.ref(adopted.id).refresh().catch(()=>null):null;const descriptor=details?.workspace??details;
       actionData={...actionData,createdWorkspace:adopted?{id:adopted.id,title:adopted.title,kind:adopted.kind,projectId:adopted.projectId,directory:descriptor?.workspaceDirectory??descriptor?.directory??null}:null,createdAgent:stateAgent?{id:stateAgent.id,title:stateAgent.title,workspaceId:stateAgent.workspaceId}:null,workspaceProjectMatchesF2:slot==='f2'?adopted?.projectId===f.projectId:null,remainingIdeas:now};
       if(adopted)await persistAdopted(slot,{target:'workspace',ideaId:row.id,workspaceId:adopted.id,agentId:stateAgent?.id??null,directory:descriptor?.workspaceDirectory??descriptor?.directory??null});
     } else throw new Error(`Unknown idea action: ${action}`);
     await takeShot(page,`e4-${slot}-${action}`); await log(`e4-${slot}-${action}`,actionData);
   }
 } else if (mode === 'managed-e8') {
   await openF1Native(page,true); const f=session('f1'), items=await allTimeline(f.managedAgentId); const summary=items.find(x=>x?.type==='plugin'&&x.kind==='flowly-summary'); const outside=await insight(f.managedAgentId); const outsideKids=(await allAgents(true)).filter(x=>x.labels?.['flowly-session']===f.managedAgentId);
   const body=await page.locator('body').innerText(); await takeShot(page,'e7-managed-session-e8');
   const flowlyPage=await context.newPage();flowlyPage.on('pageerror',e=>pageErrors.push({url:flowlyPage.url(),message:String(e).slice(0,400)}));await openBoard(flowlyPage);const boardBody=await flowlyPage.locator('body').innerText();await takeShot(flowlyPage,'e8-flowly-board');
   await flowlyPage.getByRole('button',{name:new RegExp(`Open task ${esc(f.title)}`)}).click();await flowlyPage.waitForTimeout(650);const drawerBody=await flowlyPage.locator('body').innerText();const drawerProgress=await flowlyPage.getByText('Progress',{exact:true}).count();await takeShot(flowlyPage,'e8-flowly-card-drawer');
   await flowlyPage.getByRole('button',{name:new RegExp(`Preview ${esc('[test] native r4 managed session')}`)}).click();await flowlyPage.waitForTimeout(600);const flowlySessionBody=await flowlyPage.locator('body').innerText();const flowlySuggestionButtons=await flowlyPage.getByRole('button',{name:/^Suggested next step:/}).count();await takeShot(flowlyPage,'e8-flowly-own-session-view');
   const noTipText=![boardBody,drawerBody,flowlySessionBody].some(text=>/Sessions outside Flowly|Paseo's session view.*outside/i.test(text));
   await flowlyPage.locator('[aria-label="Flowly settings"]').last().click().catch(()=>{});await flowlyPage.waitForTimeout(350);await flowlyPage.getByRole('button',{name:'AI features',exact:true}).click().catch(()=>{});await flowlyPage.waitForTimeout(350);const newSettingsSwitches=await flowlyPage.getByRole('switch').evaluateAll(xs=>xs.map(x=>x.getAttribute('aria-label')).filter(x=>['Sessions outside Flowly','Progress','Suggested next steps','Ideas'].includes(x)));
   await takeShot(flowlyPage,'e8-flowly-settings-switches');
   await log('e7-e8-managed-and-flowly-spotcheck',{title:await page.title(),summaryRow:summary??null,summaryHasTaskId:!!summary&&!!summary.data?.taskId,openCardButton:await page.getByRole('button',{name:'Open card',exact:true}).count(),summaryVisible:body.includes('Progress'),outsideInsightsView:outside,outsideInsightChildrenForManaged:outsideKids.map(x=>({id:x.id,labels:x.labels})),managedListed:(await rpc('sessions.native-chips',{})).managed.some(x=>x.agentId===f.managedAgentId),flowlyBoardHasCard:boardBody.includes(f.title),drawerProgressSectionVisible:drawerProgress>0,flowlySessionViewNoOutsideIdeasChip:await flowlyPage.getByRole('button',{name:'Ideas for this session'}).count()===0,flowlySuggestionButtons,noNewTipOrTourText:noTipText,settingsSwitchLabels:newSettingsSwitches});
   await flowlyPage.close();
 } else throw new Error(`Unknown UI mode: ${mode}`);
} catch(error){await log(`error-${mode}`,{error:String(error?.stack??error)});await takeShot(page,`error-${mode}`).catch(()=>{});process.exitCode=1;}
finally{await api.dispose().catch(()=>{});await daemon.close().catch(()=>{});await context.close().catch(()=>{});await browser.close().catch(()=>{});}
