import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { json, registryVersion, run } from './common.mjs';

const tag = process.env.GITHUB_REF_NAME;
const meta = json('dist/npm/release.json');
assert.equal(process.env.GITHUB_REF_TYPE, 'tag');
assert.equal(tag, `v${meta.version}`);
assert.equal(process.env.GITHUB_REPOSITORY, 'JasprW/flowly');
// Query first; only a definite missing release authorizes creation. A network or
// authentication error must never be mistaken for an absent release.
let release;
try {
  release = JSON.parse(run('gh', ['release', 'view', tag, '--json', 'assets,isDraft,isPrerelease']));
} catch (error) {
  if (!String(error.stderr).includes('release not found')) throw error;
}
if (!release) {
  run('gh', ['release', 'create', tag, '--verify-tag', '--draft', '--title', `Flowly ${tag}`, '--generate-notes', ...(meta.prerelease ? ['--prerelease'] : [])]);
  release = JSON.parse(run('gh', ['release', 'view', tag, '--json', 'assets,isDraft,isPrerelease']));
}
assert.equal(release.isPrerelease, meta.prerelease, 'Existing GitHub release has a different release channel');
for (const filename of [meta.filename, 'SHA256SUMS']) {
  const file = `dist/npm/${filename}`;
  const existing = release.assets.find((asset) => asset.name === filename);
  if (existing) {
    // gh api uses the authenticated asset endpoint, including for draft assets.
    assert(existing.apiUrl.startsWith('https://api.github.com/repos/JasprW/flowly/releases/assets/'));
    const contents = run('gh', ['api', existing.apiUrl, '-H', 'Accept: application/octet-stream'], { encoding: 'buffer' });
    assert.equal(createHash('sha256').update(contents).digest('hex'), createHash('sha256').update(readFileSync(file)).digest('hex'), `Existing release asset differs: ${filename}`);
  } else {
    run('gh', ['release', 'upload', tag, file]);
  }
}
const latest = await registryVersion(meta.name, 'latest');
if (release.isDraft) run('gh', ['release', 'edit', tag, '--draft=false', '--latest=' + (!meta.prerelease && latest?.version === meta.version)]);
console.log(`GitHub release ready: https://github.com/JasprW/flowly/releases/tag/${tag}`);
