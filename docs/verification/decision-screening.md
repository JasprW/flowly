# Verification: decision screening for retro notes — 2026-11-07

Spec: [GUARDRAILS-SPEC](../GUARDRAILS-SPEC.md) §4.7. Run by an independent session (Ornith-1.5-122B; Claude Haiku unavailable on this daemon), in a clean temporary worktree of commit `4bf3fbb` ("feat(guardrails): decision screening for retro notes").

## Completed

- `git log --oneline -1` → `4bf3fbb feat(guardrails): decision screening for retro notes (GUARDRAILS-SPEC 4.7)`; `git status --short` → clean (empty output, exit 0).
- `npm run typecheck`: PASS, exit code 0.
- `npm test`: exit code 1. **Test Files: 3 failed | 150 passed | 1 skipped (154). Tests: 8 failed | 1338 passed | 6 skipped (1353)** on the deciding run. Failing tests, all environment-dependent on this machine (a local guardrail git hook blocks the fixtures' commits on `main`), each reproduced identically on clean `origin/main` (`bad25d6`, verified in a second temporary worktree):
  - `server/repos.test.ts` > matches canonical subdirectories and external Git worktrees without path-prefix false positives — environmental: fixture `git commit` blocked by the local guardrail hook ("❌ BLOCKED: direct commit on protected branch 'main'").
  - `server/wrapup.test.ts` > real git: uncommitted and local-only commits are detected — environmental: same hook block.
  - `server/auto-review.test.ts` > linked root: the repositories behind its links, then each one's change with its paths under the link's name (§6.2) — environmental: same hook block.
  - `server/auto-review.test.ts` > linked root: a command runs where its script is, and applies nowhere else (§6.3) — environmental: same hook block.
  - `server/auto-review.test.ts` > linked root review: shape from both repositories, commands per repository, any failure fails, a cited file under a link counts (§6.2, §6.3) — environmental: same hook block.
  - `server/auto-review.test.ts` > linked root review: a command that fails in one repository fails, with that repository's output — environmental: same hook block.
  - `server/auto-review.test.ts` > linked root: commands run only in the repositories this delivery changed, all of them when none did (§6.3) — environmental: same hook block.
  - `server/auto-review.test.ts` > linked root diff: a large change in one repository cannot push the others out of the 64 KiB (§6.2) — environmental: same hook block.

  No other test failed. One additional flake was observed and ruled out: `server/auto-review.test.ts` > "no L1 any more: an unticked acceptance list delivers; a card without one gets SETUP_INCOMPLETE once (GUARDRAILS-SPEC §6.1)" failed intermittently (2 of 4 full-suite runs on this commit) with `ENOTEMPTY: directory not empty, rmdir '…/T/flowly-agent-test-*/data'` — a fixture temp-dir teardown race, not a hook block. It also reproduced on clean `origin/main` (1 of 2 runs there, identical error), and passes in isolation on this commit; it is pre-existing environment-dependent flakiness, not a failure of this commit. The deciding run above and the `origin/main` baseline run both had exactly the eight failures listed.

- The 8 new screening tests in `server/memory.test.ts` **pass on this commit**. `server/memory.test.ts` reports `✓ (24 tests)` in every full-suite run, and a focused `npx vitest run server/memory.test.ts` run passes all 24 (exit 0). The eight tests added by this commit — screener confirm+high writes the active note with provenance; dismiss+high writes nothing and blocks re-proposals; human verdict or medium confidence writes an observing note; trust gates run before the screener; supersedes stays human; screener failure fails open; screening off (default) runs one model call; screened provenance survives the parse-on-write round trip — are all in that passing set. This confirms the statement; nothing in the run refutes it.

## Unrun

- End-to-end screening against a real Paseo daemon and a real configured screener model (the suite uses mocked model calls).
- UI checks on the Guardrails page observing-note flag.
