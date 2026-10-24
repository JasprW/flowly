import { memo, useMemo, useState } from "react";
import { Animated, View } from "react-native";
import { useMarquee } from "./motion";
import { tint } from "./ui";
import { dotGroups, glowKeys, phaseOffset } from "./running-geometry";

/**
 * "Running" motion (MOTION-SPEC, running state): a dot-matrix sweep. A grid of small dots lies hidden under the
 * content; a slanted wave lights it from left to right with a soft afterglow, then it rests dark. Used on running
 * board cards and running session rows. It rides the one shared loop from `useMarquee` (only opacity moves, on the
 * native driver) and renders nothing under Reduce Motion.
 */

const pitch = 8;
const dot = 2;
/** Columns the wave leans per row: it reaches the top of a column before the bottom. */
const slant = 0.5;
/** The sweep takes this part of the loop; the dots rest dark for the remainder. */
const sweepWindow = 0.6;
/** How long a dot glows, measured in the slanted lines the wave crosses meanwhile. */
const afterglow = 8;
/** A dot's alpha at full light. */
const peak = 0.85;

/**
 * The dot sweep over its parent. Mount it as the parent's first child, so it lies under the content; `radius` clips
 * it to rounded corners. `seed` (the card or session id) picks where in the loop it sweeps, so several running items
 * do not light up in unison. Each slanted line of dots is one layer whose opacity follows the wave; the dots are
 * plain views laid out once per size.
 */
export const RunningDots = memo(function RunningDots({ color, seed, radius = 0 }: { color: string; seed: string; radius?: number }) {
  const phase = useMarquee(true);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const layers = useMemo(() => {
    if (!phase || !size.w || !size.h) return [];
    const groups = dotGroups(size.w, size.h, pitch, dot, slant);
    const start = phaseOffset(seed);
    return groups.map((group) => {
      const keys = glowKeys(start + (sweepWindow * group.index) / groups.length, (sweepWindow * afterglow) / groups.length);
      return { ...group, opacity: phase.interpolate({ inputRange: keys.input, outputRange: keys.output }) };
    });
  }, [phase, size.w, size.h, seed]);
  if (!phase) return null;
  const fill = tint(color, peak);
  return (
    <View
      pointerEvents="none"
      onLayout={(e) => {
        const next = { w: Math.round(e.nativeEvent.layout.width), h: Math.round(e.nativeEvent.layout.height) };
        setSize((current) => (current.w === next.w && current.h === next.h ? current : next));
      }}
      style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: radius, overflow: "hidden" }}
    >
      {layers.map((layer) => (
        <Animated.View key={layer.index} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, opacity: layer.opacity }}>
          {layer.dots.map(([x, y], i) => (
            <View key={i} style={{ position: "absolute", left: x, top: y, width: dot, height: dot, borderRadius: dot / 2, backgroundColor: fill }} />
          ))}
        </Animated.View>
      ))}
    </View>
  );
});
