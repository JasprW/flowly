# CardDetail residual profiling: bounded observation

2026-10-24. User-authorized follow-up to CARD-DETAIL-APPLY-SPEC. Research only: verify the installed Samsung host's profiling entry points before collecting function profiles. Do not change product behavior to make a profiler available.

## 1. Question and protected behavior

Separate the residual cache-success → first render-consuming-detail and render → layout-commit windows into (a) JS queue/scheduler availability, (b) Flowly computation/reconciliation, (c) other host work, and (d) native commit/layout. Prior sub-0.5ms schema→cache and 165–1268ms cache→render measurements are wall-clock observations, not ownership evidence. Prior production Profiler recorded no callbacks above its 5ms logging threshold; that alone does not establish absence of all callbacks.

Keep fresh task/project/workspace/session authorization, failure/deletion refusal, late-route fencing, complete stored card history, independent detail/index/overview keys, focused input/drafts/scroll identity, continuous 220/160ms disclosure and 450ms modal handoff. Keep contribute network gating. No host rewrite, app replacement, new native module, polling redesign, timeline pagination or animation rewrite in this phase.

## 2. Availability gate (same installed app)

Target Samsung RFCW214ZCFA / SM-S911B, package sh.paseo. Record package version/code, APK hashes, running PID, Android version, debuggable/profileable flags and current forwards. Copy only base and arm64 split APKs into this phase's owned temporary directory; inspect with existing aapt2/zip/string tools, then remove copies. No dependency install or host build. Preserve shared cache and all pre-existing forwards.

Check four independent entry paths:

| Entry | Required positive evidence | Insufficient evidence |
| --- | --- | --- |
| Hermes CDP / RN DevTools | An actual target for this app connected to the supported RN inspector, and accepted CPU-profiler start/stop | A Hermes library, arbitrary TCP port, unrelated socket, or Android USB debugging alone |
| Hermes Perfetto producer | Live `com.facebook.hermes.profiler` data-source registration and attributable PID, followed by a bounded trace containing JS function stacks | Only `linux.ftrace`, `track_event` from another process, or local SDK source guarded by WITH_PERFETTO |
| Host native Hermes sampler | An existing supported host entry calling enable/disable/dump and a readable exported profile | Native Java/C++ symbols inside the APK with no callable/export path; `DevSettings.setProfilingEnabled` (FPS overlay) |
| React commit profiling | Actual matching renderer with profiling enabled, an unconditional known-update Profiler callback smoke or DevTools export with commit data | React.Profiler export existence, `useLayoutEffect`, a timeout, or a function-body wall timer |

Read-only probes: `adb devices -l`, `dumpsys package sh.paseo`, `run-as sh.paseo id`, `pm path sh.paseo`, `/proc/net/unix`, `perfetto --query`, aapt2 AndroidManifest.xml inspection and matching installed RN source. RN uses a Metro inspector connection; absence of a Unix socket alone does not disprove it. Do not scan or attach to unrelated services. Android `profileable` permits platform sampling; it does not itself expose JS stacks or enable React profiling. No `am profile start` for a non-profileable app, signals, debugger-forcing, root, injection or repackaging.

Save command status, bounded relevant output, tool versions, file hashes and source provenance in `verification/card-detail-profiler-2026-10-24/`. Installed APK evidence outranks local dependency assumptions. Verify React/RN versions from shipped bytecode if possible; a local RN 0.81.5 checkout alone does not prove mobile host version. Unknown fields remain UNVERIFIED. Raw socket inventory, unrelated process/package information and bundle contents are not retained in the report.

## 3. Conditional finite capture protocol

Only run a path with the positive evidence above. If none is usable, stop device profiling, report function attribution UNRUN and deliver the exact missing host prerequisite; do not repeat ordinary timers as a substitute.

When a path is usable: freeze all product source/config bytes and diagnostic build/source-map hashes; typecheck before any plugin reload. Keep the same installed host, network, powered awake state and executor (physical ADB input, no hierarchy reads during capture). Use the existing task as read-only target; do not create sessions, send messages or perform business writes. One 8s idle control and two first-detail captures, each at most 8s, plus at most one warm reopen control. Start sampler before input, stop/export after the bounded window. Maximum four valid captures and five attempts total: one missing/invalid sample may be replaced once with the reason preserved. Stop a broken sampler immediately; no repeated retries on unchanged input.

For React capability smoke, use a tiny diagnostic-only tree with one known state update and **unconditional** onRender counting, separate from performance captures. This uses the plugin's supported React export and does not need a Hermes inspector; try it once even when Hermes sampling is gated. Verify that tree actually committed via separate layout/passive counters. Display only fixed diagnostic counts on the temporary Flowly screen, then read those counts through UIA after the window; no diagnostic RPC is needed. Temporarily replace only the BoardScreen registration in an owned entry bridge, typecheck before reload, and restore its exact bytes/catalog afterward. No business tree/query or action is mounted by this smoke. Do not hot-swap renderer, turn on __DEV__, attach a global DevTools hook after renderer initialization, or infer support from the prior thresholded probe. If the smoke committed a known update but emitted no callbacks, record this installed runtime's programmatic Profiler as unavailable. A host rebuild remains outside this phase.

Use the prior diagnostic boundary vocabulary, now with run/build/target/request sequence on every mark: input, rpc.start, schema.end, query.return, cache.success, render.seen, layout.commit, passive.effect. No eventOnce marker may be consumed by an earlier request. The target must be first detail in each fresh JS run; otherwise exclude it from cold attribution. Associate actual sampler timestamps to these marks in the same device clock, or measure a clock mapping with uncertainty before/after the window. If uncertainty crosses an interval boundary, do not label samples in that interval. Source maps must cover eval'd plugin code as well as the exact installed host; unresolved functions stay unresolved.

## 4. Interpretation and evidence gate

Report per window: wall duration, on/off-CPU time if available, sampled stack counts/self/inclusive estimates, GC/native/unresolved fraction, and relevant React commits. A host-wide flamegraph without target/request alignment cannot explain the residual interval. A sample count is statistical evidence, not exact function duration; preserve unknown samples and do not normalize them away. Small sample sizes may reveal a candidate hotspot but cannot establish P95/FPS or a stable latency gain.

- cache→render: distinguish sleeping/off-CPU, runnable delay and sampled executing stacks. React scheduling/host parsing/GC/Flowly work require corresponding frames, not subtraction.
- render→layout: React actualDuration measures rendering; commitTime is a timestamp, not commit duration. Obtain commit phases from a profiling renderer/DevTools or native trace; the whole gap cannot be charged to the component returning first.
- A native simpleperf/Perfetto stack ending in a Hermes interpreter does not identify the JS function; keep that part unknown.
- Separate Flowly, host React/scheduler, transport/crypto, GC and native work only where symbol/source mapping supports it. Include idle control and observer overhead. No performance success claim based only on control arrival.

Change implementation only after a reproducible, product-owned hotspot/defect is established and the smallest fix is added to this spec. No rewrite is authorized by the mere existence of a long interval.

## 5. Missing-host prerequisite, if gated

Prefer a release-like host build with Hermes sampling enabled behind an explicit local developer action and export outside private app storage, plus exact host/plugin maps and symbols. Enable a profiling renderer separately only when commit analysis is needed, with development checks/remote-JS execution/Fast Refresh disabled. Validate an unconditional Profiler smoke and JS-stack smoke before real captures. A debug-build profile can locate functions but cannot be compared directly with release timings. Keep original app/data intact; selecting/building/installing a diagnostic host is a separate concrete follow-up, not silently part of this research.

## 6. Validation and cleanup

`python3 docs/verification/card-detail-profiler-2026-10-24/probe.py` records availability once. `python3 docs/verification/card-detail-profiler-2026-10-24/verify.py` checks evidence/source provenance; `--cleanup` also checks owned temporary paths absent and forwards/device state preserved. Native full-access codex/gpt-6-luna independently audits the finite evidence and interpretation; no product test suite repeats when product bytes are unchanged. If temporary diagnostics become necessary, add their exact typecheck/focused commands before editing.

At close: restore only owned changes/forwards/settings, stop owned samplers/controllers, remove temporary APKs and exact test session, verify the product manifest before/after, retain compact sanitized evidence. Report PASS / FAIL / INVALID / UNVERIFIED / UNRUN distinctly. No new UI or capability is shipped, so no onboarding/tour/tip/What's new change is warranted.

Sources: [RN 0.81 debugging](https://reactnative.dev/docs/0.81/debugging), [RN 0.81 DevTools](https://reactnative.dev/docs/0.81/react-native-devtools), [React Profiler](https://react.dev/reference/react/Profiler), [Android profileable](https://developer.android.com/guide/topics/manifest/profileable-element), [Paseo plugin runtime modules](https://paseo.sh/docs/plugins/reference#runtime-modules). Local RN source is supporting version-specific evidence, not proof of enabled mobile features.
