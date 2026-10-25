# Running dot sweep CPU (2026-10-25)

Standalone react-native-web 0.21 page in Chromium (`bench-app.tsx`; `measure.mjs` reads CDP `Performance.getMetrics` and
`ps` CPU time over 5 s). 12 running cards of 300x110, share of one core:

| variant | main-thread script | renderer + GPU total |
| --- | --- | --- |
| before: `Animated` JS loop, 1 line per layer | 27.3 % | 60.6 % |
| 15 fps timer, 3 lines per layer (first fix) | 6.9 % | 17.2 % |
| CSS `animationKeyframes`, 3 lines per layer (looked like a low frame rate: 24 px jumps) | 0.0 % | 17.8 % |
| CSS `animationKeyframes`, 1 line per layer (shipped, real `RunningDots`) | 0.0 % | 18.8 % (30 cards: 39 %) |

The first fix still measured ~40 % on the user's real board, so the sweep moved off the JS thread entirely. The total
stays near the timer variant here (headless Chromium composites in software); the gain is that no script runs per frame
and the motion is smooth again. Single runs, noisy by a few points. Not yet re-measured inside Paseo.
