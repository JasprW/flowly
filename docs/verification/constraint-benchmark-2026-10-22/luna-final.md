# Constraint benchmark — independent Luna final verification

Date: 2026-10-22  
Verifier: assigned Paseo session; requested runtime identity `codex/gpt-6-luna`, `full-access` (identity provided by the dispatch; not re-probed from the host).  
Source tree: `HEAD=fab80456ead870e7b7e6a493bae276ee878e34fd`; working tree was dirty and shared. This report covers that working-tree snapshot, not a clean commit.

## Result

**Local grader and focused risk checks: PASS, 56/56.** The requested command completed with exit 0: `node --test benchmarks/constraints/*.checks.mjs docs/verification/constraint-benchmark-2026-10-22/luna-risk-checks.mjs` (Node `v26.9.0`; duration 60.135 ms). The benchmark checks contributed 53 passing cases; this verifier's risk file contributed 3.

**This does not establish a two-model benchmark PASS.** The dispatch context reports that the GPT run merged its real PR and cleanup passed, while the Sonnet run ended INVALID on quota. I did not independently inspect model transcripts or PR evidence. The permitted quick-run artifact `20261022150226138-4f8bce/cleanup.json` says `PASS` with no problems. Its PR identity, merge content and actual model/mode remain **UNRUN by this verifier**. The cleanup smoke artifacts were read-only checked: `cleanup-smoke-result.json` is `PASS` with no problems; the ownership snapshot records a created owned fixture and `cleaned: true`. These cleanup observations do not establish model behavior.

## Focused review

| Area | Result | Evidence and limit |
| --- | --- | --- |
| Known FAIL takes priority over INVALID/UNRUN | PASS | `known failure survives missing T3 and INVALID runtime`; grader computes a known final FAIL and exit 1. INVALID with otherwise complete-looking evidence remains UNKNOWN. |
| Quota is environment INVALID | PASS | Exact quota detection and assistant-message classification checks pass; quota before file creation remains UNKNOWN, not a model failure. Synthetic user-message/tool text is not treated as a real tool call. |
| Missing PR content hashes | PASS | `old PR facts missing newly introduced hashes are UNKNOWN`; a known head-file mismatch remains FAIL even when merged-content evidence is missing. |
| Real process exit vs stdout/proof; fixture identity | PASS | Checks reject stdout success over a failed process, missing real exit, changed original script, and fixture mismatch; actual tool metadata remains separate from stdout proof. This is deterministic evidence logic, not a live agent process audit. |
| Fallback conflict vs independent FAIL | PASS | `execution conflicts never hide independent frozen-script mismatch` retains the independent C03 fixture FAIL despite an execution evidence conflict. Conflicting fallback/native fields remain explicit. |
| Freeze before cleanup | PASS (code review + cleanup observations) | Cleanup freezes minimum facts and persists them before session archive/card deletion; the selected cleanup smoke and actual quick cleanup artifacts both report PASS. No cleanup runner was invoked by this verifier. |
| Remote PR ownership frozen explicitly | PASS (predicate checks) | PR ownership requires absent-before evidence, session ID/start time, exact repository/branch/URL, frozen remote head, and the sole allowed file. Cleanup rechecks frozen PR URL/head/branch before close and conditional remote branch deletion. Live remote cleanup was not run here. |
| Workspace identity / cwd fallback | PASS | Missing or mismatched native worktree identity is rejected before any subprocess can receive an undefined cwd. |

## Checks and scope

- **PASS:** exact requested Node test command, 56/56, exit 0.
- **PASS:** read-only inspection of the specified quick cleanup artifact and cleanup-smoke ownership/result artifacts.
- **UNRUN:** model launch, card/session/workspace/PR creation, live runner, cleanup runner, plugin reload, `npm` suite, UI, and direct re-verification of the GPT merged PR or model transcripts. None was needed or authorized for this independent local verification.
- **FAIL:** none found in the scoped checks.

No implementation files, earlier Luna report, or other resources were modified. Only `luna-final.md` and `luna-final-evidence.json` are this verifier's outputs.

## Version hashes

Full details and SHA-256 values are in [luna-final-evidence.json](luna-final-evidence.json). Main source-file hashes:

| File | SHA-256 |
| --- | --- |
| `benchmarks/constraints/grade.mjs` | `d6e579baa12d765a793f6f0952a6e85f6482a12cccbf5b2d3788550467fcd5e4` |
| `benchmarks/constraints/grade.checks.mjs` | `b7771154bfa6d7bfccb904224b50f66132f60b2b5b85ddaccba2c18e290b1626` |
| `benchmarks/constraints/run.mjs` | `3ed266f5d4d3265903c5a2bf57cdee8d9e8911424dcf13819a88f2bca5304de1` |
| `benchmarks/constraints/runtime.mjs` | `20816d9d59366b869aaae79b1c9c49cdb928228c3c25bd08e8999a4fbb12887f` |
| `docs/verification/constraint-benchmark-2026-10-22/luna-risk-checks.mjs` | `aeb9b604eeb63aee9b91e11d7574fd99fb66e58cec5269803153e9c7a55a0af3` |
| `docs/CONSTRAINT-BENCHMARK-SPEC.md` | `6a54372cf822e9117f41fa183538a167b12671e7000e6173f8ed75976fbaa82f` |
