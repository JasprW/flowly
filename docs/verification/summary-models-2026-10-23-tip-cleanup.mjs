import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DaemonClient } from '@getpaseo/client/internal/daemon-client';
const home=process.env.PASEO_HOME || join(homedir(),'.paseo');
const lock=JSON.parse(await readFile(join(home,'paseo.pid'),'utf8'));
const token=(await readFile(join(home,'local-credential'),'utf8')).trim();
const client=new DaemonClient({url:`ws://${lock.listen.replace(/^tcp:\/\//,'')}/ws`,clientId:'summary-model-tip-test-cleanup',clientType:'cli',localCredential:()=>token,reconnect:{enabled:false}});
await client.connect();
try {
  const before=await client.invokePluginRpc('flowly','settings.onboarding.read',{});
  if (before.status!=='ready') throw Error('Onboarding settings not readable');
  const next={...before.values,tipsSeen:before.values.tipsSeen.filter(id=>id!=='summary-models')};
  const result=await client.invokePluginRpc('flowly','settings.onboarding.write',{revision:before.revision,values:next});
  if(result.status!=='saved') throw Error('Could not restore newly introduced tip to unseen after UI tests');
  const after=await client.invokePluginRpc('flowly','settings.onboarding.read',{});
  if(JSON.stringify(after.values)!==JSON.stringify(next)) throw Error('Tip cleanup mismatch');
  await writeFile(new URL('./summary-models-2026-10-23-tip-cleanup.json',import.meta.url),JSON.stringify({removedOnlyNewTestSeenTip:'summary-models',otherValuesPreserved:true,summary:(await client.invokePluginRpc('flowly','settings.task-summary.read',{})).values},null,2));
  console.log('PASS: removed only the new tip marked seen by these UI tests; other onboarding settings preserved.');
} finally {await client.close();}
