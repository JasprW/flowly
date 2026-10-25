import { afterEach, expect, test, vi } from "vitest";

const rn = vi.hoisted(() => {
  const app = new Set<(state: string) => void>();
  const loops: { ended: ((r: { finished: boolean }) => void) | null; stopped: boolean }[] = [];
  return { app, loops };
});
vi.mock("react-native", () => {
  class Value {
    constructor(public v: number) {}
    setValue(v: number) { this.v = v; }
  }
  return {
    Platform: { OS: "ios" },
    Easing: { out: (f: unknown) => f, in: (f: unknown) => f, cubic: 0, quad: 0 },
    Dimensions: { get: () => ({ width: 1200 }), addEventListener: () => ({ remove: () => undefined }) },
    AccessibilityInfo: { addEventListener: () => ({ remove: () => undefined }), isReduceMotionEnabled: () => new Promise(() => undefined) },
    AppState: { addEventListener: (_: string, l: (s: string) => void) => (rn.app.add(l), { remove: () => rn.app.delete(l) }) },
    Animated: {
      Value,
      timing: () => ({}),
      loop: () => {
        const loop = { ended: null as ((r: { finished: boolean }) => void) | null, stopped: false };
        rn.loops.push(loop);
        return {
          start: (cb: (r: { finished: boolean }) => void) => { loop.ended = cb; },
          stop: () => { loop.stopped = true; loop.ended?.({ finished: false }); },
        };
      },
    },
  };
});
// Hooks run inline: no component, the effect fires at once and hands back its cleanup.
vi.mock("react", async (orig) => ({
  ...(await orig<typeof import("react")>()),
  useContext: () => false,
  useEffect: (fn: () => (() => void) | void) => { effectCleanup = fn() ?? null; },
}));
let effectCleanup: (() => void) | null = null;
const tick = () => new Promise((r) => setTimeout(r, 300));
afterEach(() => { effectCleanup?.(); effectCleanup = null; rn.loops.length = 0; vi.resetModules(); });

async function mount() {
  const { useMarquee } = await import("./motion");
  useMarquee(true);
  await Promise.resolve();
  await Promise.resolve();
}

test("a running sweep loop that ends on its own is started again", async () => {
  await mount();
  expect(rn.loops).toHaveLength(1);
  rn.loops[0].ended?.({ finished: false });
  await tick();
  expect(rn.loops).toHaveLength(2);
  expect(rn.loops[1].stopped).toBe(false);
});

test("coming back to the foreground starts a fresh lap, and stopping it does not restart it", async () => {
  await mount();
  rn.app.forEach((l) => l("background"));
  expect(rn.loops).toHaveLength(1);
  rn.app.forEach((l) => l("active"));
  await Promise.resolve();
  await Promise.resolve();
  expect(rn.loops).toHaveLength(2);
  expect(rn.loops[0].stopped).toBe(true);
  await tick();
  expect(rn.loops).toHaveLength(2);
});

test("the last sweep leaving stops the loop and the foreground listener", async () => {
  await mount();
  effectCleanup?.();
  effectCleanup = null;
  expect(rn.loops[0].stopped).toBe(true);
  expect(rn.app.size).toBe(0);
  await tick();
  expect(rn.loops).toHaveLength(1);
});
