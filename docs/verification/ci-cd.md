# CI/CD verification

Task: GitHub CI/CD 搭建, 2026-10-21. Source is isolated from unrelated dirty
main at `.git/flowly-ci-worktree`, branch `ci/github-actions`, baseline 5e53249.

PASS on 5e53249 + dirty implementation:

- `npm ci --ignore-scripts --no-audit --no-fund`: 365 packages installed.
- `npm run typecheck`.
- `npm test`: 92 files, 678 tests passed, 65 intentionally skipped.
- `npm run test:ci`: 4 boundary tests passed.
- `npm run ci:package`: actual tgz, required/forbidden file checks, extraction,
  exact manifest install, runtime dependency tree. Fixtures and generated
  npm-shrinkwrap.json cleaned. Only dist/npm build artifacts remain.
- `actionlint .github/workflows/*.yml` (1.7.12).
- `RELEASE_DRY_RUN=true GITHUB_REF_TYPE=branch GITHUB_REF_NAME=main node server/ci/release.mjs validate`.
- `make -n release VERSION=1.5.0 DRY_RUN=1`: local flow ends at tag push;
  publication belongs to Actions. No mutation was run.

No user-added input artifacts. Inputs: repository specs, package/lock/manifest,
existing Makefile and release history; npm trusted publisher and GitHub Actions
security documentation linked in the operations guide.

Remote verification and npm configuration: pending; see final evidence below.
Independent testing: [Luna report](ci-cd-luna.md).
