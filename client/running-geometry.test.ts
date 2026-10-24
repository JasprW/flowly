import { describe, expect, it } from "vitest";
import { cyclicKeys, dotGroups, glowKeys, phaseOffset } from "./running-geometry";

/** Evaluates interpolation keys the way Animated does between keyframes (linear, clamped). */
function at(keys: { input: number[]; output: number[] }, x: number) {
  const { input, output } = keys;
  if (x <= input[0]) return output[0];
  for (let i = 1; i < input.length; i++) {
    if (x <= input[i]) {
      const span = input[i] - input[i - 1];
      return span === 0 ? output[i] : output[i - 1] + ((output[i] - output[i - 1]) * (x - input[i - 1])) / span;
    }
  }
  return output[output.length - 1];
}

describe("glowKeys", () => {
  it.each([0.1, 0.5, 0.97, 0.02])("is a valid, seamless loop for a dot lit at %s", (lit) => {
    const keys = glowKeys(lit, 0.06);
    expect(keys.input[0]).toBe(0);
    expect(keys.input[keys.input.length - 1]).toBe(1);
    keys.input.forEach((x, i) => i && expect(x).toBeGreaterThan(keys.input[i - 1]));
    expect(at(keys, 0)).toBeCloseTo(at(keys, 1), 6);
  });

  it("is brightest when the wave arrives, fades after it and is dark otherwise", () => {
    const keys = glowKeys(0.4, 0.1);
    expect(at(keys, 0.4)).toBeCloseTo(1, 6);
    expect(at(keys, 0.45)).toBeCloseTo(0.45, 6);
    expect(at(keys, 0.39)).toBeLessThan(1);
    expect(at(keys, 0.2)).toBe(0);
    expect(at(keys, 0.7)).toBe(0);
  });

  it("wraps when the dot is lit near the end of the loop", () => {
    const keys = glowKeys(0.98, 0.1);
    expect(at(keys, 0.98)).toBeCloseTo(1, 6);
    expect(at(keys, 0.03)).toBeCloseTo(0.45, 6);
    expect(at(keys, 0.5)).toBe(0);
  });
});

describe("cyclicKeys", () => {
  it("is zero outside its frames", () => {
    const keys = cyclicKeys([[0.2, 0], [0.3, 1], [0.4, 0]]);
    expect(at(keys, 0.1)).toBe(0);
    expect(at(keys, 0.3)).toBeCloseTo(1, 9);
    expect(at(keys, 0.9)).toBe(0);
  });
});

describe("dotGroups", () => {
  it("places every dot of a centred grid once, inside the box", () => {
    const groups = dotGroups(280, 120, 8, 2, 0.5);
    const dots = groups.flatMap((g) => g.dots);
    expect(dots).toHaveLength(35 * 15);
    expect(new Set(dots.map(([x, y]) => `${x},${y}`)).size).toBe(dots.length);
    dots.forEach(([x, y]) => {
      expect(x >= 0 && x + 2 <= 280).toBe(true);
      expect(y >= 0 && y + 2 <= 120).toBe(true);
    });
  });

  it("slants the lines: a line holds dots further right towards the top", () => {
    const groups = dotGroups(80, 80, 8, 2, 0.5);
    const line = groups[6].dots.sort((a, b) => a[1] - b[1]);
    expect(line[0][0]).toBeLessThanOrEqual(line[line.length - 1][0]);
    expect(groups.map((g) => g.index)).toEqual(groups.map((_, i) => i));
  });

  it("is empty when the box is too small", () => {
    expect(dotGroups(4, 100, 8, 2, 0.5)).toEqual([]);
  });
});

describe("phaseOffset", () => {
  it("is stable per id and spread over the loop", () => {
    expect(phaseOffset("card-a")).toBe(phaseOffset("card-a"));
    const offsets = ["a", "b", "c", "d", "e", "f", "g", "h"].map((id) => phaseOffset(`card-${id}`));
    offsets.forEach((x) => expect(x >= 0 && x < 1).toBe(true));
    expect(new Set(offsets.map((x) => Math.floor(x * 4))).size).toBeGreaterThan(1);
  });
});
