# Independent verification: 2a74c87 (fix/form-drafts, PR #116)

- Commit: `2a74c87cbb1897f396b8d44288d144341993640b`
- Verifier: independent session (did not write the code), run in temporary worktree `/tmp/flowly-verify-2a74c87` (detached at 2a74c87, removed after the run)
- Node: v23.11.0 (npm ci ok, 369 packages; only deprecation and audit warnings, no native binding failures)
- Vitest: v4.1.11

## Commands and results

| Command | Exit | Result |
|---|---|---|
| `npm ci` | 0 | 369 packages installed |
| `npm run typecheck` | 0 | `tsc --noEmit` clean |
| `NODE_ENV=test FLOWLY_TELEMETRY=0 npx vitest run client/image-attach.test.tsx server/card-images.test.ts client/card-image-upload.test.ts client/form-draft-saver.test.ts server/form-drafts.test.ts server/agent-service.test.ts shared/i18n.test.ts` | 0 | 7 files passed, 138 tests passed, 0 failed, 0 skipped |
| `NODE_ENV=test FLOWLY_TELEMETRY=0 npm test` | 1 | 173 files: 171 passed, 1 failed, 1 skipped. 1586 tests: 1579 passed, 1 failed, 6 skipped |

### Full suite failure (known, reported separately)

```
FAIL  server/sqlite-store.test.ts > writes > a write that fails inside the transaction changes neither the database nor the cache
```

This is the known Node 23 transaction-test failure named in the brief. I did not run it on `main` myself, so "also fails on main" is taken from the brief, not verified here. It is unrelated to the three points in this commit.

## Verdict per point

**1. Phone restored-draft images (client/image-attach.tsx).** PASS with a note.
- Phones now render restored attachments with their remove buttons (`ImageAttachments`, the `!imageInputSupported` branch). No picker and no paste hint on phones. Covered by `client/image-attach.test.tsx` (three new tests: phone thumbs with remove, phone without images, web keeps picker).
- Note: the phone branch now wraps children in a `View` with `gap`, where it used to return a fragment. Harmless in principle, but it is a layout change on phones that the tests do not check visually. Not verified on device.

**2. Upload key dedupe (server/card-images.ts, client/card-image-upload.ts, shared/rpc.ts, shared/model.ts, server/agent-service.ts).** PASS.
- Early return before `expectedRevision` check and a second check inside the `store.mutate` transaction (duplicate removes the just-written files). Matches CARD-IMAGES-SPEC §4.2.
- Covered by `server/card-images.test.ts`: same key returns unchanged; other key or other bytes adds; partial upload (second image fails) then retry adds only the missing images, once each, with keys in order.
- `uploadKey` is validated by regex in `shared/rpc.ts` and `shared/model.ts` (`max(80)`), and stripped in `flowly_get_task` (`server/agent-service.ts:331`).
- Minor gap: `client/card-image-upload.ts` forwards `uploadKey` only when `image.id` matches the regex. No unit test in `client/card-image-upload.test.ts` asserts that forwarding or the filter. It is exercised only indirectly through the server test. Low risk.
- Design note, not a defect: the dedupe key is (uploadKey, MIME, byte size). Two different images under the same key with the same size would be treated as one. Draft image ids are generated per image, so the practical risk is low.

**3. Failed-load close (client/form-draft.tsx, client/form-draft-saver.ts, flushBeforeClose).** PASS at the logic level, gap in UI wiring.
- `flushBeforeClose` returns false only when the load failed for this key and the form holds edits nothing saved; callers (`client/forms.tsx:956`, `client/session-create.tsx:347`) keep the form open on false. Covered by `client/form-draft-saver.test.ts` (test "closing after a failed load keeps the form open only while it holds edits nothing saved").
- The `DraftNotice` "Close without saving" button (shown only when `unsavedEdits`) and the `unsavedEdits` state transitions in `useFormDraft` (`change`, `retryLoad`, `discard`) have no test. Only the pure function is tested. A regression in the hook wiring (e.g. `setUnsavedEdits` not called on change) would pass the suite.
- Spec match: FORM-DRAFTS-SPEC §3 (Retry and Close without saving, Back and Esc keep the form open while edits are unsaved).

## Not verified

- No browser or phone UI check. Phone layout of the restored-image row, the notice buttons and the Close gating were checked by reading code and unit tests only.
- The `main` comparison for `sqlite-store.test.ts` was not run.
- No fixture resources were created; no Paseo state was touched.
- Worktree removed after the run (see the final step of this session).
