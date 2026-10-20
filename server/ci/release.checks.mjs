import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertIntegrity, assertNoDowngrade, validateVersions, versionInfo } from './common.mjs';

test('SemVer and channel validation reject invalid versions', () => {
  for (const version of ['1.2', 'v1.2.3', '01.2.3', '1.2.3-01', '1.2.3;echo bad', '1.2.3+build']) assert.throws(() => versionInfo(version));
  for (const version of ['1.2.3', '1.2.3-rc.1', '0.0.0-alpha.0']) assert.equal(versionInfo(version).distTag, version.includes('-') ? 'next' : 'latest');
});
test('tag and both lockfile version identities must match', () => {
  const pkg = { name: 'paseo-flowly', version: '1.2.3' };
  const lock = { ...pkg, packages: { '': { version: pkg.version } } };
  assert.doesNotThrow(() => validateVersions(pkg, lock, 'v1.2.3'));
  assert.throws(() => validateVersions(pkg, lock, 'v1.2.4'));
  assert.throws(() => validateVersions(pkg, { ...lock, version: '1.0.0' }));
  assert.throws(() => validateVersions(pkg, { ...lock, packages: { '': { version: '1.0.0' } } }));
});
test('stable releases cannot move latest backwards, prereleases use next', () => {
  assert.throws(() => assertNoDowngrade('1.9.9', '2.0.0'));
  assert.throws(() => assertNoDowngrade('2.0.9', '2.1.0'));
  assert.doesNotThrow(() => assertNoDowngrade('2.1.1', '2.1.0'));
  assert.doesNotThrow(() => assertNoDowngrade('2.1.0', '2.1.0'));
  assert.doesNotThrow(() => assertNoDowngrade('1.0.0-rc.1', '2.0.0'));
});
test('retry skips publishing only for identical immutable content', () => {
  assert.doesNotThrow(() => assertIntegrity('sha512-same', 'sha512-same'));
  assert.throws(() => assertIntegrity('sha512-original', 'sha512-other'));
  assert.throws(() => assertIntegrity('sha512-original', undefined));
});
