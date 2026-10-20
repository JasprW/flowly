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

## First remote checkpoint (40b92a0)

- PASS [PR CI](https://github.com/JasprW/flowly/actions/runs/39458649458):
  Node 22 + 24 types/tests/guard checks; 678 passed /65 skipped on each;
  Node 24 package manifest install PASS; CI gate PASS.
- Initial branch-push CI also passed (39458648543). Subsequent configuration
  removes CI branch-push triggering to avoid repeating the PR matrix.
- Main protection configured: strict CI gate from GitHub Actions app15368,
  admins included, PR required (0 extra approvals), linear history and resolved
  conversations; force pushes/deletions disabled.
- npm GitHub environment configured with only main branch and v* tags.
- npm settings access is blocked by the owner's security-key authentication;
  user notified through the async question tool. No token copied to GitHub.
