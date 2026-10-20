import assert from 'node:assert/strict';
import { appendFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { assertIntegrity, assertNoDowngrade, json, registryVersion, run, validateVersions } from './common.mjs';

const action = process.argv[2];
const dryRun = process.env.RELEASE_DRY_RUN === 'true';
const tag = process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : undefined;
if (action === 'validate') {
  assert(dryRun || tag, 'A real release requires a v* tag');
  validateVersions(json('package.json'), json('package-lock.json'), tag);
  run('git', ['fetch', '--no-tags', 'origin', 'main']);
  run('git', ['merge-base', '--is-ancestor', 'HEAD', 'origin/main']);
  console.log(`Release source validated: ${tag ?? 'dry run on main'} ${run('git', ['rev-parse', 'HEAD'])}`);
} else if (action === 'rehearse') {
  assert(dryRun, 'Rehearsal must explicitly enable dry-run');
  const meta = json('dist/npm/release.json');
  const info = validateVersions(json('package.json'), json('package-lock.json'), tag);
  assert.equal(meta.version, info.version);
  assert.equal(meta.sha, run('git', ['rev-parse', 'HEAD']));
  assert.equal(meta.filename, `paseo-flowly-${meta.version}.tgz`);
  const tarball = join('dist/npm', meta.filename);
  assertIntegrity(meta.integrity, `sha512-${createHash('sha512').update(readFileSync(tarball)).digest('base64')}`);
  run('npm', ['publish', tarball, '--dry-run', '--ignore-scripts', '--access', 'public', '--tag', info.distTag], { stdio: 'inherit' });
} else if (action === 'publish') {
  assert(!dryRun && tag, 'Publishing requires an explicit non-dry tag release');
  assert.equal(process.env.GITHUB_REPOSITORY, 'JasprW/flowly');
  const meta = json('dist/npm/release.json');
  validateVersions(json('package.json'), json('package-lock.json'), tag);
  assert.equal(meta.sha, run('git', ['rev-parse', 'HEAD']));
  const refs = run('git', ['ls-remote', 'origin', `refs/tags/${tag}`, `refs/tags/${tag}^{}`]).split('\n').map((line) => line.split(/\s+/));
  const remote = refs.find(([, ref]) => ref.endsWith('^{}')) ?? refs.find(([, ref]) => ref === `refs/tags/${tag}`);
  assert.equal(remote?.[0], meta.sha, 'Remote release tag moved since validation');
  assert.equal(meta.version, json('package.json').version);
  assert.equal(meta.filename, `paseo-flowly-${meta.version}.tgz`);
  const tarball = join('dist/npm', meta.filename);
  const contents = readFileSync(tarball);
  assertIntegrity(meta.integrity, `sha512-${createHash('sha512').update(contents).digest('base64')}`);
  const published = await registryVersion(meta.name, meta.version);
  if (published) {
    assertIntegrity(meta.integrity, published.dist?.integrity);
    console.log('Identical version already published; safely continuing GitHub release');
  } else {
    const latest = await registryVersion(meta.name, 'latest');
    if (latest) assertNoDowngrade(meta.version, latest.version);
    run('npm', ['publish', tarball, '--ignore-scripts', '--access', 'public', '--provenance', '--tag', meta.distTag], { stdio: 'inherit' });
    // A write followed by a timeout must be retried by rerunning this job, where
    // the integrity check above resolves the existing immutable version.
    const live = await registryVersion(meta.name, meta.version);
    assertIntegrity(meta.integrity, live?.dist?.integrity);
  }
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `version=${meta.version}\nprerelease=${meta.prerelease}\nfilename=${meta.filename}\n`);
} else {
  throw new Error('Usage: node server/ci/release.mjs validate|rehearse|publish');
}
