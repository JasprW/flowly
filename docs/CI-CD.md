# CI/CD operations

CI is in `.github/workflows/ci.yml`. PRs and main pushes run Node
22 and 24 typecheck + Vitest + release guard tests on Ubuntu. Node 24 also packs,
inspects and installs the actual npm tarball with the plugin manifest commands.
`CI gate` is the required branch check. Artifacts expire after 7 days.

No separate application compilation is shipped: Paseo compiles the TypeScript
plugin entry points on install/load. This CI verifies types and package install;
it does not claim native desktop/phone acceptance or provider availability.

## One-time npm setup

In the paseo-flowly package Settings → Trusted Publisher, add GitHub Actions:
owner `JasprW`, repository `flowly`, workflow filename `release.yml`, environment
`npm`, allow direct `npm publish`. No NPM_TOKEN GitHub secret is needed. Keep
package two-factor authentication enabled. The publishing job uses Node 24 and
npm >=11.5.1; other jobs have neither OIDC nor release write permission.

The `npm` GitHub environment permits main and v* release tags. Main is
protected with `CI gate`; force pushes and branch deletion are disabled.
Changes go through a PR; no second human review is required for this solo repo.

References: [npm trusted publishers](https://docs.npmjs.com/trusted-publishers/),
[GitHub Actions security](https://docs.github.com/en/actions/reference/security/secure-use).

## Release

1. Merge reviewed changes and green CI into main. Work from a clean checkout
   synchronized with origin/main.
2. On a release branch run `make bump VERSION=1.5.0` (or `1.5.0-rc.1`; it also sets `shared/version.ts`),
   commit package.json/package-lock.json and merge that PR after CI passes. Then
   on synchronized main run `make release VERSION=1.5.0`: it typechecks/tests,
   verifies the already merged version, creates an annotated v* tag, asks before
   pushing only the tag, and prints the Actions URL. Main is never pushed by this
   target. `DRY_RUN=1` previews without tag/push/publish.
3. Actions checks tag/version/main ancestry, repeats CI at that exact commit,
   then publishes its tarball. Stable versions use npm latest; prereleases next.
   A newer stable latest may not be downgraded by an older version.
4. GitHub release contains generated notes, the same tgz and SHA256SUMS. It stays
   a draft until uploads finish. The Paseo registry pins a commit and requires
   its own [submission](https://github.com/getpaseo/plugins/issues/new/choose).

Registry listing art lives in `assets/` (`icon.png`, `screenshots/*.png`, resized
from `docs/promo/screenshots` and `docs/brand/logo/png`) and is declared by
`icon` and `media` in `paseo-plugin.json`, so the registry reads it from the pinned
artifact (first image is the card thumbnail; PNG/JPG/WebP/GIF/MP4/WebM, no SVG).
`assets/` is in package `files` and `ci:package` fails if a declared file is not
in the tarball. Retake the shots with `docs/promo/shots.mjs` when the UI changes.

To rehearse, run Release manually on main with `dry_run=true` (default). It runs
source checks and CI/package validation, downloads the artifact, verifies its
checksum and runs npm publish --dry-run; it skips the publishing job. It does
not create a version, npm package, tag or GitHub Release. A manual real publish
requires selecting a v* tag that already contains the workflows.

## Failures and recovery

- Tag mismatch / off-main: correct the release preparation. Never move a
  published tag or reuse an npm version for changed contents.
- CI failure: publishing is skipped. Fix and create a new release commit/tag.
- npm E401/E404 during OIDC: verify the exact owner/repo/file/environment and
  allowed publish action on npm. Do not add a long-lived token to work around it.
- npm succeeded but the job failed: rerun the failed release jobs. The immutable
  version must have identical sha512 integrity before npm is skipped. Different
  contents or registry errors stop the release. GitHub resumes the draft and
  verifies existing asset hashes; it never overwrites different assets.
- If an artifact has expired, rerun all jobs at the same tag. Packaging is
  deterministic for unchanged tracked input. Never rebuild from the working
  directory of a later commit and label it as the old tag.
- Emergency local publication: `make publish` builds/validates the package first
  and asks before publishing, using the existing local npm credential flow.
  Normal `make release` never calls this target, avoiding duplicate publishers.

Local checks: `npm ci --ignore-scripts --no-audit --no-fund`,
`npm run typecheck`, `npm test`, `npm run test:ci`, `npm run ci:package`.
Packaging leaves only ignored `dist/npm` artifacts; its extraction fixtures and
transient npm-shrinkwrap.json are always removed. Clean with `rm -r dist/npm`
only after no release process is using those task-owned artifacts.

Onboarding: no tour/tip/catalog changes; this is contributor tooling.
