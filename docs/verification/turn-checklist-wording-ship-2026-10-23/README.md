# Selective publication of checklist wording

The [selection manifest](selection.json) records this card's exact file hashes, the separately assembled PROGRESS blob and prior ownership evidence. Only the task specification, checklist clauses 2/5, generated repository skill, supporting analysis/Fable review/offline checks and this publication record are selected. Other product changes, versions, AGENTS and unrelated document hunks remain outside the commit.

The candidate commit is checked in a detached temporary worktree with `npm run typecheck` and `npm test` before PR creation. The exact checked commit/tree and actual results, CI, merge SHA and final preservation audit are recorded in the PR. Models, B01, fixtures, grader and plugin reload are not run for publication.

Raw scores and independent regrade stay unchanged. Historical review scripts/check results retain their original baseline; this publication does not relabel them as new model validation. The generated repository skill is included; whether the active daemon has loaded it is not asserted.
