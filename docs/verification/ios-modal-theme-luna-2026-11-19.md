# Independent verification: iOS modal theme correction (#120)

- Session: `CODEX_SESSION_ID=01a1f13f-bdb9-7790-8fc5-6ff471454319`
- Commit: `ffd2c09f7d00f87119bea809cead3b86a178bf47`
- Checkout: `.test-data/ios-theme-120/checkout`
- Scope: source review and the two authorized checks only. No UI, phone, daemon, or Paseo resource interaction.

## Checks

| Result | Command | Exit | Summary |
| --- | --- | ---: | --- |
| PASS | `npm run typecheck` | 0 | `tsc --noEmit` completed. |
| PASS | `NODE_ENV=test FLOWLY_TELEMETRY=0 npm test` | 0 | 168 test files passed, 1 skipped; 1543 tests passed, 6 skipped. The full run included all 7 cases in `client/modal.test.tsx`. |

No check failed. Successful output is summarized here; no failure output needed preservation.

## Findings

- **PASS — bridge matches Paseo 0.16.0's portal boundary.** The [host Modal source](https://github.com/getpaseo/paseo/blob/v0.16.0/packages/app/src/plugins/react-native/modal.tsx) routes content through `AdaptiveModalSheet`; its [isolated sheet source](https://github.com/getpaseo/paseo/blob/v0.16.0/packages/app/src/components/ui/isolated-bottom-sheet-modal/index.tsx) explains that `@gorhom/portal` renders under a different React tree and requires contexts to be re-provided. The host bridge restores its runtime, query client and toast contexts, not Flowly's `Theme`. `client/modal.tsx` captures Flowly's theme before the boundary and wraps both the header `icon` and `Modal.Content` children in `Theme.Provider`.
- **PASS — a concrete production path exists.** `client/connectors.tsx` passes a theme-reading `BrandIcon` as the header icon for the connector picker and preview, both reachable while creating a task. The existing body providers do not cover that sibling header slot. This confirms a real missing-provider path, but does not identify the exact control behind the original report.
- **PASS — no regression found in the reviewed wrapper behavior.** Content props remain forwarded; the gap/fill styles and captured closed state are retained. The new tests cover isolated header/body themes, separate modal values, web/native-shaped paths, prop forwarding and strict missing-provider behavior.
- **LIMITATION — the portal reproduction is synthetic.** The test mocks the host Modal and uses a synchronous element walker that deliberately resets contexts at a `native-portal` node. It demonstrates failure and repair under that boundary model; it does not execute Paseo's Modal, React scheduling, native layout, or an iPhone. The test title's “reproduces” wording should be read as a modeled reproduction, not a reproduction of the reported New task flow.
- **UNRUN — live theme update while a modal stays mounted.** The “follows theme changes” test compares two separately constructed and rendered modal trees (light and dark); it does not rerender one open modal. The implementation reads the current theme on render, but the spec's live-update acceptance remains unverified by this run.

## PASS / FAIL / UNRUN

- **PASS:** typecheck; full test suite; source-level confirmation of the provider bridge and connector header gap.
- **FAIL:** none in the authorized checks.
- **UNRUN:** actual iPhone or desktop/compact UI; original New task/card-creation interaction; mounted theme switching; native keyboard, gesture and dismissal behavior. No card, project, workspace or session was created.
