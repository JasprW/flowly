# Memory review child session is deleted, not left behind

- Date: 2026-10-22. Build: `4a332b7` plus the uncommitted working tree.
- Plugin `flowly` was loaded from that working tree at 07:09:38Z (`paseo plugin logs flowly`, the last "Loading plugin" before the run at 07:23Z); it was not reinstalled or reloaded for this test. The two files that matter had not changed since that load: `server/memory.ts` (modified 04:25Z; its diff against `4a332b7` only adds the `memoryOn` global switch, not the cleanup call) and `server/summarizer-remove.ts` (modified 01:44Z; identical to `4a332b7`). So the run exercised the same cleanup code as `4a332b7`.
- Report: the finished-card review session stayed in the Paseo workspace, although it is meant to be disposable (PROJECT-MEMORY-SPEC §4.2, AGENTS.md hard-delete exception).

## Finding

The current code deletes the review session: `MemoryService.execute()` calls `removeAgent` in a `finally`, which hard-deletes over the local daemon (`server/summarizer-remove.ts`) and archives only if the delete fails. The 18 leftovers (`Flowly memory review ·` and `Flowly insights ·`, all archived, newest about 4 hours old) ran before that call was in `memory.ts`. No review ran afterwards, so the live path was unverified until this run.

## Cleanup of the leftovers

The user confirmed the full list. All 18 archived sessions were removed with `paseo delete`, including four in other projects (agent-smith, Search System, search_workspace x2) and the Tinylink sessions `92a63fed` and `16bd40b5` that `project-memory.md` cites as its review agents. Afterwards `paseo ls -a` held no session starting with `Flowly memory review` or `Flowly insights`.

## End-to-end run (Tinylink)

1. Created a disposable Tinylink card `d4b74427-60e0-4ff9-a33d-4fa5656eb2c8`; a Haiku card session `10ce707d-edde-4eb7-ae1d-a1d0d5388317` wrote one workpad confusion and a result note.
2. Moved the card to Done (07:23:53Z).
3. Polled `paseo ls -a --json` every 3 s ([state](project-memory/review-cleanup-e2e-state.json)):
   - `Kanban summary · [e2e] ...` (`a85a3642`) appeared running, then was gone.
   - `Flowly memory review · [e2e] ...` (`3217b6d5`) appeared running at 07:24:27Z, then was gone; the run ended at 07:24:31Z with no child left in the list.
4. `paseo ls -a` afterwards: 0 hits for both child ids.

**Result: PASS.** The review session is hard-deleted; it is not even archived.

## Cleanup of the test

- Card deleted with `tasks.delete` (backup in plugin `removed/`); Tinylink is back to its six cards.
- Done's auto wrap-up had already archived the card session and its workspace; the session was then removed with `paseo delete`. No `[e2e]` session or workspace remains.
- The review produced no memory candidate; nothing in the Tinylink memory refers to the test card.
- Temporary scripts `docs/promo/_tmp-retro-e2e*.mjs` and `/tmp/flowly-memory-e2e-20261022` were removed.

## Checks

- `npx vitest run server/memory.test.ts server/summarizer-remove.test.ts` on the working tree: 18 tests passed.
- `npm run typecheck` and `npm test` on exactly the tree of this PR (`4a332b7` plus the two evidence files, in a temporary worktree): typecheck exit 0; 113 test files passed, 13 skipped; 906 tests passed, 65 skipped.
