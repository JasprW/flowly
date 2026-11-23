# iOS modal theme correction (#120)

## Input and diagnosis

- Input: [JasprW/flowly#120](https://github.com/JasprW/flowly/issues/120), read through Flowly. iPhone 15 Pro Max, app 0.16.0, daemon 0.16.1, Flowly 1.8.0; reported `useTheme → Button → Theme missing` while creating a card. The user confirmed only that the issue says it occurs during card creation; the exact control remains unspecified.
- All current Flowly `Modal.Content` callers already provide the theme inside their bodies. The old Android correction covered bodies only. It does not cover header icons.
- Paseo 0.16.0 [plugin Modal](https://github.com/getpaseo/paseo/blob/v0.16.0/packages/app/src/plugins/react-native/modal.tsx) passes `icon` into the sheet header, outside the body. [IsolatedBottomSheetModal](https://github.com/getpaseo/paseo/blob/v0.16.0/packages/app/src/components/ui/isolated-bottom-sheet-modal/index.tsx) documents that Gorhom's portal renders elements elsewhere and loses caller-owned contexts. The host bridges its SDK contexts, not Flowly's Theme.
- Confirmed production gap: `client/connectors.tsx` picker and preview pass a theme-consuming `BrandIcon` as the header icon. A body provider cannot reach it. These pickers can be reached from New task. This explains a real `Theme missing` path; it does not establish which Button triggered the reporter's original stack.

## Change

`client/modal.tsx` captures the current theme and re-provides it in the host header icon and the body. The body's open state crosses the same portal alongside the existing reduced-motion bridge. Existing per-body providers remain compatible. No global fallback, swallowed error, dependency, RPC, persisted data or version change.

The old UI/UX contract mentioned only bodies. Its amendment now also requires the header bridge. No tour/tip or telemetry change is warranted: this restores existing controls and adds no capability, switch or counted action. No translated text or What's new change.

## Implementer checks

- PASS: `npm run typecheck`, exit 0, shared workspace.
- PASS: `NODE_ENV=test FLOWLY_TELEMETRY=0 npm test`, exit 0, 165 files passed / 1 skipped; 1516 tests passed / 6 skipped, shared workspace.
- PASS: focused `client/modal.test.tsx`, 7/7, exit 0. Covers iOS/Android portal and web paths, header and body colors, real GitHub BrandIcon palette changes, separate theme values, captured closed state, style forwarding and strict missing-provider errors.
- Expected baseline failure: temporarily used the original `HEAD:client/modal.tsx` with these tests and restored the fix in `finally`: 4 failed / 3 passed, exit 1. Native header tests fail in `useTheme → Button`; the real BrandIcon test also fails with `Theme missing`. Closed-state test reads the default `true` across the portal instead of the captured `false`.
- The synchronous test walker uses production components and real context identities with a simulated reparenting boundary. It is not React scheduling, native layout, a full New task integration test, or device evidence.
- UNRUN: iPhone/Android real-device interactions, desktop/compact live UI, actual card creation, native keyboard/dismiss gestures and mounted theme changes. No safely available iPhone is attached to this task, and existing personal desktop windows were not driven. No test project/card/workspace was created.

The shared workspace contains unrelated work; the shipping commit includes only this task's source, regression test, UI/UX amendment and this report. Exact-commit checks and reload receipts are reported by the task delivery; an independent verifier owns its own report.
