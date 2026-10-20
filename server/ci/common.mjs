import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

export function run(command, args, options = {}) {
  const output = execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 180_000, ...options });
  return typeof output === 'string' ? output.trim() : output;
}
export const json = (file) => JSON.parse(readFileSync(file, 'utf8'));
export function versionInfo(version) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?$/.exec(version);
  if (!match) throw new Error(`Invalid release version: ${version}`);
  return { version, numbers: match.slice(1, 4).map(BigInt), prerelease: Boolean(match[4]), distTag: match[4] ? 'next' : 'latest' };
}
export function validateVersions(pkg, lock, tag) {
  const info = versionInfo(pkg.version);
  if (pkg.name !== 'paseo-flowly' || lock.name !== pkg.name || lock.version !== pkg.version || lock.packages?.['']?.version !== pkg.version) {
    throw new Error('Package name/version must match both lockfile versions');
  }
  if (tag !== undefined && tag !== `v${pkg.version}`) throw new Error('Release tag must equal v<package version>');
  return info;
}
export function assertNoDowngrade(candidate, latest) {
  const next = versionInfo(candidate), current = versionInfo(latest);
  if (next.prerelease) return;
  for (let i = 0; i < 3; i++) {
    if (next.numbers[i] > current.numbers[i]) return;
    if (next.numbers[i] < current.numbers[i]) throw new Error('Refusing to move npm latest backwards');
  }
}
export function assertIntegrity(expected, actual) {
  if (!expected || expected !== actual) throw new Error('Published npm integrity differs from the tested tarball');
}
export async function registryVersion(name, version) {
  const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(version)}`, { signal: AbortSignal.timeout(30_000) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`npm registry returned HTTP ${response.status}`);
  return response.json();
}
