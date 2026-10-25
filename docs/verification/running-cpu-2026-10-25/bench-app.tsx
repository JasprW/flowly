import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Animated, View, Easing, StyleSheet } from "react-native";
import { dotGroups, glowKeys, phaseOffset } from "../../../client/running-geometry";

const q = new URLSearchParams(location.search);
const variant = q.get("v") || "A";
const N = Number(q.get("n") || 12);
const band = variant === "A" ? 1 : Number(q.get("band") || 4);
const css = variant === "W";
const fps = variant === "C" ? Number(q.get("fps") || 12) : 0;
const clock = new Animated.Value(0);
if (css) {} else if (fps) {
  const t0 = performance.now();
  setInterval(() => clock.setValue((((performance.now() - t0) % 2400) / 2400)), 1000 / fps);
} else {
  Animated.loop(Animated.timing(clock, { toValue: 1, duration: 2400, easing: Easing.linear, useNativeDriver: false })).start();
}
function WDots({ seed }: { seed: string }) {
  const w = 300, h = 110;
  const layers = useMemo(() => {
    const groups = dotGroups(w, h, 8, 2, 0.5);
    const start = phaseOffset(seed);
    const out: any[] = [];
    for (let i = 0; i < groups.length; i += band) {
      const slice = groups.slice(i, i + band);
      const mid = i + (slice.length - 1) / 2;
      const keys = glowKeys((0.6 * mid) / groups.length, (0.6 * 8) / groups.length);
      const frames: any = {};
      const steps = Number(q.get("steps") || 0);
      const val = (x: number) => { for (let k = 1; k < keys.input.length; k++) { if (x <= keys.input[k]) { const a = keys.input[k - 1], b = keys.input[k]; return keys.output[k - 1] + ((keys.output[k] - keys.output[k - 1]) * (x - a)) / (b - a || 1); } } return 0; };
      if (steps) { for (let k = 0; k < steps; k++) frames[(k * 100) / steps + "%"] = { opacity: Math.round(val(k / steps) * 100) / 100 }; frames["100%"] = frames["0%"]; }
      else keys.input.forEach((x, k) => { frames[Math.round(x * 10000) / 100 + "%"] = { opacity: keys.output[k] }; });
      out.push({ index: i, dots: slice.flatMap((g) => g.dots), style: StyleSheet.create({ s: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, animationKeyframes: frames, ...(q.get("wc") ? { willChange: "opacity" } : {}), animationDuration: "2400ms", animationIterationCount: "infinite", animationTimingFunction: q.get("steps") ? "step-end" : "linear", animationDelay: -Math.round(start * 2400) + "ms" } as any }).s });
    }
    return out;
  }, [seed]);
  return (
    <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, overflow: "hidden", borderRadius: 8 }}>
      {layers.map((l) => (
        <View key={l.index} style={l.style}>
          {l.dots.map(([x, y]: number[], i: number) => (
            <View key={i} style={{ position: "absolute", left: x, top: y, width: 2, height: 2, borderRadius: 1, backgroundColor: "#5b8cffd9" }} />
          ))}
        </View>
      ))}
    </View>
  );
}
function Dots({ seed }: { seed: string }) {
  const w = 300, h = 110;
  const layers = useMemo(() => {
    const groups = dotGroups(w, h, 8, 2, 0.5);
    const start = phaseOffset(seed);
    const out: any[] = [];
    for (let i = 0; i < groups.length; i += band) {
      const slice = groups.slice(i, i + band);
      const mid = i + (slice.length - 1) / 2;
      const keys = glowKeys(start + (0.6 * mid) / groups.length, (0.6 * 8) / groups.length);
      out.push({ index: i, dots: slice.flatMap((g) => g.dots), opacity: clock.interpolate({ inputRange: keys.input, outputRange: keys.output }) });
    }
    return out;
  }, [seed]);
  return (
    <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, overflow: "hidden", borderRadius: 8 }}>
      {layers.map((l) => (
        <Animated.View key={l.index} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, opacity: l.opacity }}>
          {l.dots.map(([x, y]: number[], i: number) => (
            <View key={i} style={{ position: "absolute", left: x, top: y, width: 2, height: 2, borderRadius: 1, backgroundColor: "#5b8cffd9" }} />
          ))}
        </Animated.View>
      ))}
    </View>
  );
}
function App() {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", backgroundColor: "#111", padding: 8 }}>
      {Array.from({ length: N }, (_, i) => (
        <View key={i} style={{ width: 300, height: 110, margin: 6, backgroundColor: "#1c1c1c", borderRadius: 8 }}>
          {css ? <WDots seed={"card-" + i} /> : <Dots seed={"card-" + i} />}
        </View>
      ))}
    </View>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
