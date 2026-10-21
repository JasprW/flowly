import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { json, run, validateVersions } from './common.mjs';

const pkg = json('package.json'), lock = json('package-lock.json');
const info = validateVersions(pkg, lock);
const output = resolve('dist/npm');
mkdirSync(output, { recursive: true });
assert(!existsSync('npm-shrinkwrap.json'), 'Refusing to replace an existing npm-shrinkwrap.json');
let packed;
try {
  copyFileSync('package-lock.json', 'npm-shrinkwrap.json');
  [packed] = JSON.parse(run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', output]));
} finally {
  rmSync('npm-shrinkwrap.json', { force: true });
}
const paths = packed.files.map(({ path }) => path);
for (const required of ['package.json', 'npm-shrinkwrap.json', 'paseo-plugin.json', 'index.client.tsx', 'index.server.ts', 'OVERVIEW.md', 'LICENSE', 'skills/flowly/SKILL.md']) {
  assert(paths.includes(required), `Package missing ${required}`);
}
const listing = json('paseo-plugin.json');
for (const asset of [listing.icon, ...(listing.media ?? [])].filter((entry) => entry && !/^https:/.test(entry))) {
  assert(paths.includes(asset), `Package missing listing asset ${asset}`);
}
for (const path of paths) {
  assert(!/(^|\/)(?:\.env(?:\..*)?|\.npmrc|node_modules|docs|scripts|\.github|coverage)(\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path), `Unexpected private/development file: ${path}`);
}
mkdirSync('.test-data', { recursive: true });
const fixture = mkdtempSync(resolve('.test-data/ci-package-'));
try {
  run('tar', ['-xzf', join(output, packed.filename), '-C', fixture]);
  const cwd = join(fixture, 'package');
  const manifest = json(join(cwd, 'paseo-plugin.json'));
  assert.equal(manifest.id, 'flowly');
  assert(manifest.requirements?.paseo && Array.isArray(manifest.build) && manifest.build.length);
  for (const [command, ...args] of manifest.build) run(command, args, { cwd });
  run('npm', ['ls', '--omit=dev', '--depth=0'], { cwd });
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
const data = readFileSync(join(output, packed.filename));
const sha256 = createHash('sha256').update(data).digest('hex');
assert.equal(packed.integrity, `sha512-${createHash('sha512').update(data).digest('base64')}`);
const metadata = { name: pkg.name, version: pkg.version, filename: packed.filename, integrity: packed.integrity, sha256, prerelease: info.prerelease, distTag: info.distTag, sha: run('git', ['rev-parse', 'HEAD']) };
writeFileSync(join(output, 'release.json'), `${JSON.stringify(metadata, null, 2)}\n`);
writeFileSync(join(output, 'SHA256SUMS'), `${sha256}  ${packed.filename}\n`);
console.log(`Validated ${pkg.name}@${pkg.version}: ${paths.length} files, ${packed.size} bytes, manifest install PASS`);
