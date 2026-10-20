# GitHub CI/CD

Status: implementation contract, 2026-10-21. Delivery channels are the existing
`paseo-flowly` npm package and GitHub Releases in `JasprW/flowly`.

## Observable behavior

- Every pull request and push to main runs reproducible `npm ci`
  with the existing peer-dependency policy, typecheck and all Vitest checks on
  GitHub-hosted Ubuntu with Node 22 and 24. A stable `CI gate` job requires all
  checks. Manual CI runs are available. No credentials are exposed to PR jobs.
- Node 24 builds the npm tarball and validates its file list, required runtime
  files, manifest, package/lock version and runtime dependencies. Tests, docs,
  private files, node_modules and tooling must not ship. The tarball contains a
  generated npm-shrinkwrap.json from the committed lockfile: npm excludes
  package-lock.json, but the plugin's declared install uses npm ci. The generator
  never replaces an existing shrinkwrap file. The generated file is removed in
  finally; only dist/npm artifacts remain. A disposable extraction runs the
  manifest's exact install commands and verifies the runtime dependency tree.
- A push of a v-prefixed SemVer tag triggers Release. The tag must match both
  package versions and point to a commit reachable from origin/main. Invalid or
  off-main tags fail before publishing. Release reruns the same CI gate at the
  tag commit and publishes its exact tested tarball using npm OIDC, never a
  repository secret. Only the publishing job has id-token:write and
  contents:write, and it runs in the npm environment. Stable releases use latest;
  prereleases use next and GitHub prerelease. Older stable versions may not
  replace a newer npm latest.
- Release workflow_dispatch defaults to a dry run on the selected ref. On main
  this checks the current package without requiring a tag. A real manual run
  requires selecting a v* tag. Dry runs have no npm/Release write effects.
- Release retries skip npm only when the existing version's sha512 integrity
  equals the tested tarball, otherwise fail. Registry/network errors fail closed.
  GitHub release creation/upload is retryable; existing tag target must match.
  Each release includes the tarball and SHA256SUMS. Completed releases are not
  overwritten by a different package. No version bump, tag push or real publish
  is part of accepting this setup.
- Makefile release validates an already merged version and pushes its annotated tag;
  GitHub Actions owns publication. Local make publish is explicitly a recovery
  path and uses the same validated package. Dry run remains non-mutating.
- GitHub actions are pinned to full commit SHAs. Dependabot proposes weekly
  action updates. There is no pull_request_target, automatic dependency merge,
  plugin reload, daemon restart, registry submission, or product UI change.

## Repository configuration

Enable Actions, configure npm Trusted Publisher for owner JasprW, repository
flowly, file release.yml, environment npm, allowing direct npm publish. Enable
main protection requiring CI gate after a successful real PR run; preserve
existing protection if present. Keep human review optional for this solo repo.
No npm credentials are copied to GitHub. Setup may need the user's npm 2FA;
record that as open if the logged-in browser cannot finish it.

## Acceptance and checks

1. npm run typecheck
2. npm test
3. npm run test:ci (invalid version, mismatch, prerelease, retry integrity and
   downgrade guards)
4. npm run ci:package (tarball inspection and exact-manifest install)
5. actionlint .github/workflows/*.yml
6. Real GitHub PR CI and main CI are green, and Release dry run is green with
   publishing skipped. Record URLs, SHAs and artifact evidence.
7. Independent codex/gpt-6-luna full-access verification session reviews the
   final tooling/workflows and exercises negative cases, owns evidence only;
   archive the session and clean every test-owned resource when finished.

The active checkout contains unrelated unfinished work and a local-only commit.
Implementation is isolated under .git/flowly-ci-worktree from origin/main;
only this task's changes are committed/pushed. No welcome-tour change or tip:
this is contributor/release tooling, with no product UI behavior change.
