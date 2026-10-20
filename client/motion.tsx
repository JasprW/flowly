import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { AccessibilityInfo, Animated, Easing, Platform, type ViewProps } from "react-native";
import { reduceMotionNow, subscribeReduceMotion } from "./reduce-motion";

export const motionDuration = { feedback: 120, forward: 220, reverse: 160 } as const;
/** Entrances decelerate into place; exits accelerate away (no lingering, near-invisible tail). */
const enterEasing = Easing.out(Easing.cubic);
const exitEasing = Easing.in(Easing.quad);
const ReduceMotion = createContext(true);

export function MotionProvider({ children }: { children: ReactNode }) {
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    let alive = true;
    let changed = false;
    const listener = AccessibilityInfo.addEventListener("reduceMotionChanged", (next) => {
      changed = true;
      if (alive) setReduced(next);
    });
    void AccessibilityInfo.isReduceMotionEnabled().then((next) => {
      // An event received after the query began is newer than its result.
      if (alive && !changed) setReduced(next);
    }).catch(() => {});
    return () => {
      alive = false;
      listener.remove();
    };
  }, []);
  return <ReduceMotion.Provider value={reduced}>{children}</ReduceMotion.Provider>;
}

/**
 * One interpolation node per value and range, reused across renders. A new
 * node each render re-attaches the native animated graph and commits the
 * JS-side (stale) value mid-animation; on Android's new architecture that can
 * leave a view at its start offset (user report: content drifting sideways).
 */
const interpolations = new WeakMap<object, Map<string, Animated.AnimatedInterpolation<number | string>>>();
export function lerp<T extends number | string>(
  value: Animated.Value | Animated.AnimatedInterpolation<number>,
  outputRange: T[],
  inputRange: number[] = [0, 1],
): Animated.AnimatedInterpolation<T> {
  let byRange = interpolations.get(value);
  if (!byRange) interpolations.set(value, (byRange = new Map()));
  const key = JSON.stringify([inputRange, outputRange]);
  let node = byRange.get(key);
  if (!node) byRange.set(key, (node = value.interpolate({ inputRange, outputRange: outputRange as number[] | string[] })));
  return node as Animated.AnimatedInterpolation<T>;
}

/**
 * Start a transition and, when it finishes on the native driver, set its final
 * value from JS as well: native updates never reach the shadow tree, so this
 * guarantees the committed props match what is on screen.
 */
function play(animation: Animated.CompositeAnimation, value: Animated.Value, toValue: number, nativeDriver: boolean, done?: (finished: boolean) => void) {
  animation.start(({ finished }) => {
    if (finished && nativeDriver) value.setValue(toValue);
    done?.(finished);
  });
}

function timing(value: Animated.Value, toValue: number, duration: number, nativeDriver = Platform.OS !== "web", easing = enterEasing) {
  return Animated.timing(value, {
    toValue,
    duration,
    easing,
    useNativeDriver: nativeDriver,
    isInteraction: false,
  });
}

export function useMotionValue(target: number, duration: number = motionDuration.feedback, initial = target, layout = false) {
  const reduced = useContext(ReduceMotion);
  const [value] = useState(() => new Animated.Value(initial));
  useLayoutEffect(() => {
    if (reduced) {
      value.setValue(target);
      return;
    }
    // Layout properties (width/height) cannot use the native driver.
    const native = !layout && Platform.OS !== "web";
    const animation = timing(value, target, duration, native);
    play(animation, value, target, native);
    return () => animation.stop();
  }, [value, target, duration, reduced]);
  return value;
}

/** Retain an inert visual shell during exit; never let an old exit remove a new target. */
export function useMotionPresence<T>(item: T | undefined | null, key: string, nativeDriver = Platform.OS !== "web") {
  const reduced = useContext(ReduceMotion);
  const held = useRef(item);
  if (item) held.current = item;
  const [retained, setRetained] = useState(!!item);
  const [progress] = useState(() => new Animated.Value(item ? 1 : 0));
  // Shown and done entering: callers drop their animated props then (see MotionReveal on stale native writes).
  const [entered, setEntered] = useState(!!item);
  const heldKey = useRef(key);
  const generation = useRef(0);
  useLayoutEffect(() => {
    if (key) setRetained(true);
  }, [key]);
  useLayoutEffect(() => {
    const run = ++generation.current;
    let alive = true;
    if (key && key !== heldKey.current) {
      heldKey.current = key;
      progress.setValue(reduced ? 1 : 0);
    }
    const finish = () => {
      if (alive && generation.current === run && !key) {
        heldKey.current = "";
        held.current = undefined;
        setRetained(false);
      }
    };
    if (reduced) {
      progress.setValue(key ? 1 : 0);
      setEntered(!!key);
      finish();
      return () => { alive = false; };
    }
    setEntered(false);
    const animation = key
      ? timing(progress, 1, motionDuration.forward, nativeDriver)
      : timing(progress, 0, motionDuration.reverse, nativeDriver, exitEasing);
    play(animation, progress, key ? 1 : 0, nativeDriver, (finished) => {
      if (!finished) return;
      if (key) {
        if (alive && generation.current === run) setEntered(true);
      } else finish();
    });
    return () => {
      alive = false;
      animation.stop();
    };
  }, [key, reduced, progress, nativeDriver]);
  return { item: item || (retained ? held.current : undefined), active: !!item, progress, settled: !!item && entered };
}

/** Animate navigation identity, never streaming output or a background refetch. */
export function MotionReveal({
  transitionKey,
  direction = 1,
  distance = 18,
  children,
  style,
  ...props
}: ViewProps & { transitionKey: string; direction?: number; distance?: number }) {
  const reduced = useContext(ReduceMotion);
  // Signed offset: starts at ±1 (the side it comes from) and rests at 0, so
  // one set of interpolation nodes serves both directions.
  const [offset] = useState(() => new Animated.Value(0));
  // The reveal in flight (its generation), 0 at rest. At rest the view carries
  // no opacity or transform at all. On Android's new architecture a native-driven
  // animation writes the view directly, behind React's back: if that native write
  // outlives the animation (interrupted, dropped, or overwritten by a commit made
  // mid-transition), setting the value back to 0 is not a prop change React can
  // see, and the view stayed offset (user reports: returning from a session left
  // the card half faded, later shifted ~18 pt). Dropping the props on rest is a
  // real change, so the commit always resets the view to identity.
  const [moving, setMoving] = useState(0);
  const previous = useRef<string | undefined>(undefined);
  const generation = useRef(0);
  const reverse = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  useLayoutEffect(() => {
    const run = ++generation.current;
    // First mount: the surrounding surface brings it in; only identity changes animate.
    if (previous.current === undefined || previous.current === transitionKey || reduced) {
      previous.current = transitionKey;
      offset.setValue(0);
      setMoving(0);
      return;
    }
    previous.current = transitionKey;
    reverse.current = direction < 0;
    offset.setValue(reverse.current ? -1 : 1);
    // Re-renders before paint with the animated props attached; the animation starts once they are.
    setMoving(run);
  }, [transitionKey, direction, reduced, offset]);
  useLayoutEffect(() => {
    if (!moving) return;
    const run = moving;
    const animation = timing(offset, 0, reverse.current ? motionDuration.reverse : motionDuration.forward, Platform.OS !== "web");
    // Finished or stopped, the newest reveal decides; an older one never resets a newer one.
    animation.start(() => {
      if (alive.current && generation.current === run) setMoving(0);
    });
    return () => animation.stop();
  }, [moving, offset]);
  return (
    <Animated.View {...props} style={moving ? [style, {
      opacity: lerp(offset, [0.65, 1, 0.65], [-1, 0, 1]),
      transform: [{ translateX: lerp(offset, [-distance, 0, distance], [-1, 0, 1]) }],
    }] : style}>{children}</Animated.View>
  );
}

/** One breath (1 → 0.35 → 1) sampled from a cosine, so a linear native loop eases in and out. */
const pulseInput = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1];
const pulseOutput = pulseInput.map((t) => Math.round((0.675 + 0.325 * Math.cos(2 * Math.PI * t)) * 1000) / 1000);
const linear = (t: number) => t;

/**
 * Slow breathing dot for "working" states. Static under Reduce Motion; the
 * loop stops on unmount or when `active` turns off. One timing looped on the
 * native driver (a looped `sequence` restarts through JS every cycle and
 * freezes whenever the JS thread is busy; PERFORMANCE-SPEC §3).
 */
export function PulseDot({ color, size = 8, active = true }: { color: string; size?: number; active?: boolean }) {
  const reduced = useContext(ReduceMotion);
  const [value] = useState(() => new Animated.Value(0));
  const [opacity] = useState(() => value.interpolate({ inputRange: pulseInput, outputRange: pulseOutput }));
  useEffect(() => {
    if (!active || reduced) {
      value.setValue(0);
      return;
    }
    const loop = Animated.loop(timing(value, 1, 1600, undefined, linear));
    loop.start();
    return () => {
      loop.stop();
      value.setValue(0);
    };
  }, [active, reduced, value]);
  return (
    <Animated.View
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, opacity }}
    />
  );
}

/** Mount-in rise for newly appearing items (callouts, queued rows, menus). */
export function Enter({ children, distance = 6, style }: { children: ReactNode; distance?: number; style?: ViewProps["style"] }) {
  const reduced = useContext(ReduceMotion);
  const [progress] = useState(() => new Animated.Value(reduced ? 1 : 0));
  // After the entrance the view carries no animated props (see MotionReveal on stale native writes).
  const [settled, setSettled] = useState(reduced);
  useLayoutEffect(() => {
    if (settled) return;
    let alive = true;
    const animation = timing(progress, 1, motionDuration.forward);
    play(animation, progress, 1, Platform.OS !== "web", () => { if (alive) setSettled(true); });
    return () => {
      alive = false;
      animation.stop();
    };
  }, [progress, settled]);
  return (
    <Animated.View
      style={settled ? style : [
        style,
        {
          opacity: progress,
          transform: [{ translateY: lerp(progress, [distance, 0]) }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/**
 * Animated height for clamp/expand. The first measured target is applied
 * immediately (no reveal on mount); later targets animate on the JS driver
 * (height is a layout property) and interrupt any running animation.
 */
export function useMotionHeight(target: number | null) {
  const reduced = useContext(ReduceMotion);
  const [value] = useState(() => new Animated.Value(target ?? 0));
  const placed = useRef(target !== null);
  const previous = useRef(target);
  useLayoutEffect(() => {
    if (target === null) return;
    if (!placed.current || reduced) {
      placed.current = true;
      previous.current = target;
      value.setValue(target);
      return;
    }
    const opening = target > (previous.current ?? 0);
    previous.current = target;
    const animation = timing(value, target, opening ? motionDuration.forward : motionDuration.reverse, false, opening ? enterEasing : exitEasing);
    animation.start();
    return () => animation.stop();
  }, [value, target, reduced]);
  return value;
}

/**
 * False until the enter transition that started when `key` appeared (or
 * changed) has finished; true at once under Reduce Motion. Gate heavy content
 * and its requests on it, so mounting and decoding never compete with the
 * transition's frames (PERFORMANCE-SPEC §3).
 */
export function useSettled(key: string, duration: number = motionDuration.forward) {
  const reduced = useContext(ReduceMotion);
  const [settled, setSettled] = useState(reduced ? key : "");
  useEffect(() => {
    if (reduced) {
      setSettled(key);
      return;
    }
    // One frame past the transition, so its last frames are not shared either.
    const timer = setTimeout(() => setSettled(key), duration + 32);
    return () => clearTimeout(timer);
  }, [key, reduced, duration]);
  return reduced || settled === key;
}

export function useReducedMotion() {
  return useContext(ReduceMotion);
}

/**
 * Re-provides the Reduce Motion preference inside host-rendered surfaces
 * (modals render outside this tree, where the default is "reduced").
 */
export function MotionBridge({ reduced, children }: { reduced: boolean; children: ReactNode }) {
  return <ReduceMotion.Provider value={reduced}>{children}</ReduceMotion.Provider>;
}

/**
 * The Reduce Motion preference for rows Paseo renders in its own views (timeline rows, chip popovers), which sit
 * outside `MotionProvider` and would otherwise always skip animation. One shared subscription for all of them.
 */
export function SharedMotionProvider({ children }: { children: ReactNode }) {
  const reduced = useSyncExternalStore(subscribeReduceMotion, reduceMotionNow);
  return <ReduceMotion.Provider value={reduced}>{children}</ReduceMotion.Provider>;
}
