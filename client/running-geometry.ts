/**
 * Layout and keyframe math for the running dot sweep (`client/running-motion.tsx`, MOTION-SPEC running state).
 * Pure, so it is tested without React Native: the dot grid and interpolation keys for the shared 0 → 1 phase.
 */

export type Keys = { input: number[]; output: number[] };

/** A stable start within the loop for a card or session, so they do not all sweep at once. */
export function phaseOffset(seed: string) {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
  // Final mix, so ids that differ only in their last character still land far apart.
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return (hash >>> 0) / 4294967296;
}

/**
 * Piecewise-linear keyframes `[phase, value]` on the cyclic 0 → 1 loop; phases may run past either end and wrap.
 * Outside the frames the value is 0. Returns sorted, distinct interpolation keys whose value at 0 equals that at 1.
 */
export function cyclicKeys(frames: [number, number][]): Keys {
  const value = (x: number) => {
    for (let i = 1; i < frames.length; i++) {
      const [x0, y0] = frames[i - 1];
      const [x1, y1] = frames[i];
      if (x >= x0 && x <= x1) return x1 === x0 ? y1 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
    return 0;
  };
  const at = (x: number) => Math.max(value(x), value(x + 1), value(x - 1));
  // Wrap by adding or subtracting whole loops only, so a phase already in range keeps its exact value.
  const wrap = (x: number) => x - Math.floor(x);
  const points = [0, 1, ...frames.map(([x]) => (x >= 0 && x <= 1 ? x : wrap(x)))].sort((a, b) => a - b);
  const unique = points.filter((x, i) => i === 0 || x - points[i - 1] > 1e-6);
  return { input: unique, output: unique.map(at) };
}

/** One dot's light as the wave reaches it at phase `at`: a quick rise, then a soft afterglow over `span`. */
export function glowKeys(at: number, span: number): Keys {
  return cyclicKeys([
    [at - span * 0.35, 0],
    [at, 1],
    [at + span * 0.5, 0.45],
    [at + span, 0.15],
    [at + span * 1.7, 0],
  ]);
}

export type DotGroup = { index: number; dots: [number, number][] };

/**
 * A dot grid centred in a `w` × `h` box, `pitch` apart, grouped into the slanted lines the wave lights together
 * (a group is one animated layer). `slant` columns per row: the wave leans right towards the top.
 */
export function dotGroups(w: number, h: number, pitch: number, dot: number, slant: number): DotGroup[] {
  const cols = Math.floor(w / pitch);
  const rows = Math.floor(h / pitch);
  if (cols < 1 || rows < 1) return [];
  const left = (w - cols * pitch) / 2 + (pitch - dot) / 2;
  const top = (h - rows * pitch) / 2 + (pitch - dot) / 2;
  const lean = Math.floor((rows - 1) * slant);
  const groups: DotGroup[] = Array.from({ length: cols + lean }, (_, index) => ({ index, dots: [] }));
  for (let r = 0; r < rows; r++) {
    const shift = Math.floor((rows - 1 - r) * slant);
    for (let c = 0; c < cols; c++) groups[c + shift].dots.push([left + c * pitch, top + r * pitch]);
  }
  return groups;
}
