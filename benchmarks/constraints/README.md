# Constraint benchmark: B01 quick

A developer harness, not a product workflow or an automatic repair agent. Read
[the contract](../../docs/CONSTRAINT-BENCHMARK-SPEC.md) before running.

```sh
node --test benchmarks/constraints/*.checks.mjs
node benchmarks/constraints/run.mjs run --profile quick --config /absolute/config.json
node benchmarks/constraints/run.mjs grade --run RUN_ID
node benchmarks/constraints/run.mjs cleanup --run RUN_ID
```

The configuration explicitly names the existing fixture project and its actual
root, a full local base commit, the retained private GitHub repository, the parent
session and exactly two discovered models. No credentials belong in config:

```json
{
  "projectId": "FIXTURE_FLOWLY_PROJECT_ID",
  "repoPath": "/absolute/path/to/permanent/fixture",
  "baseCommit": "FULL_40_CHARACTER_LOCAL_COMMIT",
  "repository": "OWNER/EXISTING_PRIVATE_TEST_REPOSITORY",
  "parentAgentId": "CURRENT_SESSION_ID",
  "turnTimeoutMs": 900000,
  "runTimeoutMs": 3600000,
  "models": [
    {"key":"sonnet","provider":"claude","model":"DISCOVERED_EXACT_ID","mode":"bypassPermissions","thinking":"medium"},
    {"key":"gpt","provider":"codex","model":"DISCOVERED_EXACT_ID","mode":"full-access","thinking":"medium"}
  ]
}
```

An optional `daemonHome` selects the local Paseo home. The SDK reads the local
credential privately; preparation credentials and signed requests stay in memory.
Writes always use the running plugin RPC. Receipt capture alone reads the local
storage `board.json`, projecting public fields. `board.read` excludes receipts.

Every run creates a new immutable-ID evidence directory beneath
`docs/verification/constraint-benchmark/`. It records the planned six user turns,
versions, explicit runtime model/mode, creation intent/IDs, selected facts and
per-rule verdicts. Directory installation identity and skill hash are available;
the exact loaded daemon implementation hash is marked **unknown** unless actually
verified. No causal version-comparison claim can be made from that alone.

Exit 0 means final compliance and cleanup passed; inspect proactive compliance
separately. Exit 1 records a known final violation or cleanup failure. Exit 2
means necessary evidence/environment/coverage is incomplete; 64 is bad arguments.
Unknown evidence is never a pass. A current-turn independent nextMoves declaration
can satisfy final compliance even when carrying it on a particular call is unknown.
Some dynamic Code Mode operations cannot establish order; these remain UNKNOWN.
A refusal requiring natural-language justification remains UNKNOWN unless repair
and a fresh accepted delivery can be proven. The runner never injects reminders,
repairs setup, registers outputs or edits workpad for the subject.

B01 T2/T3 depend on factual state, not an earlier perfect score. A failed T1 does
not erase the later PR observation if the file and prior delivery actually exist.
The runner uses real GitHub PRs, preserving the private repository and merged
history, and deletes only its new branch names. Worktrees share the fixture's Git
common-dir: permanent refs/config/remotes and pre-existing test refs are preserved.
Permission preflight uses a unique compare-and-delete scratch ref. Cleanup checks
owned paths/commits before acknowledging dirty-worktree warnings; unknown work is
preserved and reported. It archives only its sessions and removes only its cards
and worktrees. Cleanup can be retried independently; no model rerun or duplicate
message is sent after a crash.

The live runner is intentionally serial. Run within the declared budget; a failed
or unknown first result stays recorded. Regrading preserves versioned results.
Only B01 is implemented; extra providers, B02–B04, automatic resume, comparison
commands and dashboards are outside this implementation.


Implementation checks and live coverage are tracked in the
[verification report](../../docs/verification/constraint-benchmark-2026-10-22/implementation-report.md).
The first live attempt and incomplete two-model result remain recorded. A provider
quota is INVALID, not a model compliance failure. Native replay timestamps do not
establish action time: phase checks use ordered successful contexts/receipts.
Versioned report names include both the loaded grader hash and facts hash.


Grader 1.0.1 records each case's fixture `main` SHA before starting its session.
Scope grading and cleanup share `scope.mjs`: only graph-proven, unchanged imports
from that frozen history are exempted. New non-target commits (including later
reverts), dirty paths and merge resolutions remain violations; incomplete proof
is UNKNOWN and blocks automatic deletion. The raw fixed-base path list stays in
the facts but cannot identify an extra edit by itself. No final-parent or moving
remote-main inference is used. Grader hashes cover both `grade.mjs` and `scope.mjs`.

[Saved-evidence regression](../../docs/verification/constraint-benchmark-scope-2026-10-23/report.md)
keeps the old run untouched. `regrade-saved.mjs` writes a separate verdict using
frozen scope projections; it never runs a model or native cleanup.
