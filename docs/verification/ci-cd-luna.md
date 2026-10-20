# Independent CI/CD review

Date: 2026-10-21 (Asia/Singapore)

## Scope and source identity

- Requested starting source: `5e532494e3d6db5b836bd7d8230501ff169040e5` (`origin/main`).
- Implementation was committed during this review as `40b92a03de60304588f1efe3b2e686def6205513`; the safe artifact rehearsal hardening was subsequently committed as `afe0061956638a1bedef31d0cd4977cf565b3464` (`HEAD`, `origin/ci/github-actions`). The final workflow/rehearsal review is against `afe0061`.
- Final `git status --porcelain`: only untracked `docs/verification/ci-cd-environment.json` and `docs/verification/ci-cd-protection.json`, created by the parent task. I did not modify or remove them. My only persistent write is this evidence file.
- Environment: macOS, Node `v26.9.0`, npm `11.19.1`. No Paseo resources, GitHub settings, npm state, or publication endpoints were changed.

## Completed checks

| Check | Result | Evidence |
|---|---|---|
| `npm run test:ci` | PASS, 4/4 | Ran on final rehearsal source; SemVer/tag/lock consistency, stable downgrade guard, and integrity retry guard all pass. |
| Tag/version mismatch guard | PASS | Disposable local Git fixture under `.test-data/ci-review-<pid>`; `node server/ci/release.mjs validate` rejected `v9.9.9` against package `1.4.0` before fetch. Fixture removed. |
| Non-tag real release guard | PASS | Same disposable fixture; validate without a tag and without dry-run exited nonzero with `A real release requires a v* tag`. Fixture removed. |
| Off-main release target guard | PASS | Isolated local bare remote with unrelated `main` and release histories; `merge-base --is-ancestor` exited 1. Fixture removed. |
| Missing release metadata | PASS, fail closed | Isolated fixture invoked publish with valid tag/repository context but no `dist/npm/release.json`; it stopped on ENOENT before registry/npm calls. Fixture removed. |
| Missing repository secrets boundary | PASS by workflow review | No npm token/secret is referenced by workflow YAML. Only the publishing job receives `id-token: write`, `contents: write`, and `GH_TOKEN: ${{ github.token }}`; release uses npm OIDC. |
| Dry-run rehearsal source path | PASS, isolated | Copied the existing tarball into a disposable git fixture, set metadata SHA to that fixture commit, and used a fake `npm` executable. `node server/ci/release.mjs rehearse` validated package/lock/tarball integrity and invoked only `publish <tgz> --dry-run --ignore-scripts --access public --tag latest`. No real npm command or network was used. Fixture removed. |
| Rehearsal with dry-run disabled | PASS, fail closed | `node server/ci/release.mjs rehearse` without `RELEASE_DRY_RUN=true` rejected at the explicit dry-run assertion before reading metadata or invoking npm. |
| `make -n release VERSION=1.4.0 DRY_RUN=1` | PASS | Printed planned actions only; no release/push/publish command executed. |
| `actionlint .github/workflows/*.yml` | PASS | Used the available `../actionlint` binary against final workflow source. |
| `cd dist/npm && sha256sum --check SHA256SUMS` | PASS | Existing tarball checksum matched. Its `release.json` records base SHA `5e53249`, so it is stale for `afe0061` and was not treated as release evidence. |
| Binary output preservation | PASS | Local Node `execFileSync(..., { encoding: 'buffer' })` probe returned a Buffer with bytes `[0,255,65]`; this confirms the `gh api` asset retrieval path does not UTF-8 decode asset bytes. |

## Review notes

- Release validation checks SemVer and package/lock versions, requires a tag for real releases, and checks that the release commit is reachable from `origin/main`. Publish additionally verifies the remote tag still resolves to the tested commit, covering a moved-tag retry.
- npm retry is fail-closed: an existing immutable version is skipped only when its sha512 integrity equals the tested tarball; registry errors, missing integrity, mismatched contents, and stable downgrades stop publication. Post-publish registry integrity is checked again.
- GitHub release retry reads existing assets and compares SHA256 before proceeding. It only creates a release when `gh release view` specifically reports “release not found”; other CLI/auth/network errors propagate. The `apiUrl` field is supported in current `gh release view --json` output ([official field list](https://cli.github.com/manual/gh_release_view)).
- The manual dry-run rehearsal job has only inherited `contents: read` permissions, no OIDC permission, and no release token. It downloads the tested artifact, verifies `SHA256SUMS`, then exercises the explicit `npm publish --dry-run` path.
- CI now runs for PRs, main pushes, manual dispatches, and reusable workflow calls. Restricting push CI to main avoids a duplicate run for a branch that also has a PR.
- No substantive defect found in the reviewed release guards, retry paths, binary asset handling, or added rehearsal path.

## Not run

- Full typecheck, full Vitest suite, and `npm run ci:package`: intentionally not repeated; the parent already recorded these on the isolated implementation. No installation or rebuild was performed.
- Live GitHub Actions PR/main runs, Release workflow dry-run, repository protection settings, npm Trusted Publisher configuration, OIDC publication, GitHub Release creation, and native UI: not run by this independent local test session. Parent owns live GitHub configuration and workflow evidence.
- Real `npm publish --dry-run` was not run; the rehearsal command was exercised with a fake npm binary so npm configuration/cache state and network state remained untouched.

## Fixture cleanup

- Removed all unique review fixtures under `.test-data/` after each run, including the local bare repositories and fake npm shim.
- The pre-existing empty `.test-data/` directory was preserved. The pre-existing `dist/npm` artifact was read only and preserved.
