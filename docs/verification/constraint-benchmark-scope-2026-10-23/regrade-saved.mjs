// Sidecar regrade only. Original run files are never written.
import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import path from 'node:path';
import {json,save,command} from '../../../benchmarks/constraints/io.mjs';import {hash} from '../../../benchmarks/constraints/facts.mjs';import {gradeRun,markdown} from '../../../benchmarks/constraints/grade.mjs';
const dir=path.dirname(import.meta.filename),projection=await json(dir+'/saved-scopes.json'),source=projection.source;
assert.equal(hash(await readFile(source+'/facts.json')),projection.sourceHashes['facts.json']);
const facts=await json(source+'/facts.json'),before=await json(source+'/verdicts.json');
for(const p of projection.scopes)facts.sessions.find(s=>s.id===p.sessionId).turns.find(t=>t.id===p.turnId).after.scope=p.scope;
const after=gradeRun(facts);const graderHash=hash(Buffer.concat(await Promise.all(['grade.mjs','scope.mjs'].map(n=>readFile('benchmarks/constraints/'+n)))));
const changes=[];for(const s of after.sessions)for(const t of s.turns){const prior=before.sessions.find(x=>x.id===s.id).turns.find(x=>x.id===t.id);if(prior.finalVerdict!==t.finalVerdict)changes.push({model:s.model,turn:t.id,before:prior.finalVerdict,after:t.finalVerdict});}
assert.deepEqual(changes,[{model:'gpt-6-luna',turn:'T3',before:'FAIL',after:'PASS'}]);assert.equal(after.exitCode,1);
await save(dir+'/regraded-verdicts.json',after);await save(dir+'/regrade-metadata.json',{graderVersion:'1.0.1',graderHash,source,sourceFactsHash:projection.sourceHashes['facts.json'],scopeProjectionHash:hash(await readFile(dir+'/saved-scopes.json')),head:await command('git',['rev-parse','HEAD']),dirty:true,changes,exitCode:after.exitCode});
await import('node:fs/promises').then(fs=>fs.writeFile(dir+'/regraded-report.md',markdown(after)));
console.log(JSON.stringify({changes,overall:after.finalVerdict,exitCode:after.exitCode}));
