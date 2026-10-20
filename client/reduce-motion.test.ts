import { afterEach, expect, test, vi } from "vitest";

const rn = vi.hoisted(() => {
  const listeners = new Set<(v: boolean) => void>();
  let resolve: (v: boolean) => void = () => undefined;
  return {
    listeners,
    queries: 0,
    settle: (v: boolean) => resolve(v),
    AccessibilityInfo: {
      addEventListener: (_: string, l: (v: boolean) => void) => {
        listeners.add(l);
        return { remove: () => listeners.delete(l) };
      },
      isReduceMotionEnabled: () => {
        rn.queries++;
        return new Promise<boolean>((r) => (resolve = r));
      },
    },
  };
});
vi.mock("react-native", () => ({ AccessibilityInfo: rn.AccessibilityInfo }));
afterEach(() => vi.resetModules());

test("rows in Paseo's view share one Reduce Motion subscription; reduced until the system answers, then follows changes", async () => {
  const { reduceMotionNow, subscribeReduceMotion } = await import("./reduce-motion");
  expect(reduceMotionNow()).toBe(true);
  const seen: boolean[] = [];
  const stopA = subscribeReduceMotion(() => seen.push(reduceMotionNow()));
  const stopB = subscribeReduceMotion(() => undefined);
  expect(rn.queries).toBe(1);
  expect(rn.listeners.size).toBe(1);
  rn.settle(false);
  await Promise.resolve();
  expect(reduceMotionNow()).toBe(false);
  rn.listeners.forEach((l) => l(true));
  expect(reduceMotionNow()).toBe(true);
  expect(seen).toEqual([false, true]);
  stopA();
  stopB();
  expect(rn.listeners.size).toBe(0);
});
