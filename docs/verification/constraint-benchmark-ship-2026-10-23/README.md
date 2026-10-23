# Benchmark selective publication

Card `08a37039`, session `036d5d2b`, base `a7f4819d407e` (latest origin/main at selection).

[Selection manifest](selection.json) freezes the 108 owned files and the two assembled document blobs. It also records the 174 non-target working files that must stay unchanged. The manifest and this note are publication evidence, additional to those 110 selected paths. No product source, package/version, AGENTS, translation or other session's document sections are selected.

The candidate tree is constructed through a separate Git index. `PROGRESS.md` contains only the historical design checkpoint, implementation and scope-fix sections; `SPEC-OUTLINE.md` contains only the benchmark entry. Full working copies retain all other hunks.

The exact commit is checked in a detached temporary worktree with `npm run typecheck`, `npm test`, and `node --test benchmarks/constraints/*.checks.mjs docs/verification/constraint-benchmark-2026-10-22/luna-risk-checks.mjs` before PR creation. Actual results and checked commit/tree are recorded in the PR. Shipping does not rerun a model or fixture cleanup.

All three original run directories and their initial/versioned facts, verdicts, reports and cleanup records remain intact. The scope sidecar regrade stays separate: GPT T3 becomes PASS; the overall result remains FAIL/exit 1. No UI/onboarding change or plugin reload is needed.
