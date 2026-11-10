import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Animated, PanResponder, View } from "react-native";
import { listDropIndex, listShift } from "./geometry";
import { motionDuration, useMotionValue, useReducedMotion, lerp } from "./motion";
import { useTheme } from "./ui";

type Drag = { id: string; from: number; dy: number; to: number };

/**
 * List reordered by dragging a row with the mouse (desktop). The held row
 * follows the pointer immediately; the rows it passes slide aside. Touch
 * keeps the rows' own controls (a drag would fight the bottom sheet).
 * `horizontal` lays the items out in a row and drags along x (project tabs).
 */
export function SortableList<T extends { id: string }>({
  items,
  gap = 0,
  disabled = false,
  onMove,
  renderItem,
  handle = false,
  horizontal = false,
  onItemLayout,
}: {
  items: readonly T[];
  gap?: number;
  disabled?: boolean;
  onMove(id: string, to: number): void;
  /**
   * `pressable()` is false right after a drag, so the release is not a click.
   * With `handle`, spread `handleProps` on the grip: only it starts a drag
   * (rows with text fields stay selectable).
   */
  renderItem(item: T, index: number, pressable: () => boolean, handleProps: object): ReactNode;
  handle?: boolean;
  horizontal?: boolean;
  /** Each item's offset and length along the list axis. */
  onItemLayout?(id: string, offset: number, length: number): void;
}) {
  const heights = useRef<Record<string, number>>({});
  const [drag, setDragState] = useState<Drag | null>(null);
  const live = useRef<Drag | null>(null);
  const setDrag = (next: Drag | null) => {
    live.current = next;
    setDragState(next);
  };
  const suppressUntil = useRef(0);
  const pressable = () => Date.now() >= suppressUntil.current;
  const current = useRef({ items, disabled, onMove, gap });
  current.current = { items, disabled, onMove, gap };
  useEffect(() => setDrag(null), [disabled]);
  const sizes = () => current.current.items.map((i) => heights.current[i.id] || 0);
  const handlers = {
    start(id: string) {
      const from = current.current.items.findIndex((i) => i.id === id);
      if (from < 0 || current.current.disabled) return;
      setDrag({ id, from, dy: 0, to: from });
    },
    move(dy: number) {
      const d = live.current;
      if (d) setDrag({ ...d, dy, to: listDropIndex(sizes(), d.from, dy, current.current.gap) });
    },
    end(dy: number) {
      suppressUntil.current = Date.now() + 250;
      const d = live.current;
      setDrag(null);
      // Same batch as clearing the drag: the reordered list replaces the shifted one.
      if (d) {
        const to = listDropIndex(sizes(), d.from, dy, current.current.gap);
        if (to !== d.from) current.current.onMove(d.id, to);
      }
    },
    cancel() {
      setDrag(null);
    },
  };
  const size = drag ? (heights.current[drag.id] || 0) + gap : 0;
  return (
    <View style={{ gap, ...(horizontal ? { flexDirection: "row", alignItems: "center" } : {}) }}>
      {items.map((item, index) => (
        <SortableRow
          key={item.id}
          id={item.id}
          held={drag?.id === item.id}
          dragging={!!drag}
          dy={drag?.id === item.id ? drag.dy : 0}
          shift={drag ? listShift(index, drag.from, drag.to, size) : 0}
          disabled={disabled || items.length < 2}
          handlers={handlers}
          onLayout={(offset, length) => {
            heights.current[item.id] = length;
            onItemLayout?.(item.id, offset, length);
          }}
          handle={handle}
          horizontal={horizontal}
          render={(handleProps) => renderItem(item, index, pressable, handleProps)}
        />
      ))}
    </View>
  );
}

function SortableRow({
  id,
  held,
  dragging,
  dy,
  shift,
  disabled,
  handlers,
  onLayout,
  handle,
  horizontal,
  render,
}: {
  id: string;
  held: boolean;
  dragging: boolean;
  dy: number;
  shift: number;
  disabled: boolean;
  handlers: { start(id: string): void; move(dy: number): void; end(dy: number): void; cancel(): void };
  onLayout(offset: number, length: number): void;
  handle: boolean;
  horizontal: boolean;
  render(handleProps: object): ReactNode;
}) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const [slide] = useState(() => new Animated.Value(0));
  useLayoutEffect(() => {
    // Rows settle instantly when the drag ends: the new order takes their place.
    if (!dragging || reduced) {
      slide.setValue(dragging ? shift : 0);
      return;
    }
    const animation = Animated.timing(slide, { toValue: shift, duration: motionDuration.feedback, useNativeDriver: false });
    animation.start();
    return () => animation.stop();
  }, [dragging, shift, reduced, slide]);
  const lift = useMotionValue(held ? 1 : 0);
  const mousePress = useRef(false),
    // `claimed`: this row holds the responder; `active`: the drag has started.
    claimed = useRef(false),
    active = useRef(false);
  const current = useRef({ id, disabled, handlers, horizontal, handle });
  current.current = { id, disabled, handlers, horizontal, handle };
  const along = (g: { dx: number; dy: number }) => (current.current.horizontal ? g.dx : g.dy);
  const threshold = 6;
  useEffect(
    () => () => {
      if (active.current) current.current.handlers.cancel();
    },
    [],
  );
  const release = () => {
    mousePress.current = false;
    claimed.current = false;
    const was = active.current;
    active.current = false;
    return was;
  };
  const pan = useRef(
    PanResponder.create({
      // A grip does nothing else, so it takes the press at once: the moves that
      // follow reach it even after the pointer has left the small grip.
      onStartShouldSetPanResponder: () => current.current.handle && !current.current.disabled && mousePress.current,
      // A whole row is also pressable, so it takes over only once the pointer moves.
      onMoveShouldSetPanResponderCapture: (_e, g) =>
        !current.current.disabled && mousePress.current && Math.abs(along(g)) >= threshold,
      onPanResponderGrant: (_e, g) => {
        claimed.current = true;
        if (Math.abs(along(g)) < threshold) return;
        active.current = true;
        current.current.handlers.start(current.current.id);
      },
      onPanResponderMove: (_e, g) => {
        if (!claimed.current) return;
        if (!active.current) {
          if (Math.abs(along(g)) < threshold) return;
          active.current = true;
          current.current.handlers.start(current.current.id);
        }
        current.current.handlers.move(along(g));
      },
      onPanResponderRelease: (_e, g) => {
        if (release()) current.current.handlers.end(along(g));
      },
      onPanResponderTerminationRequest: () => false,
      onPanResponderTerminate: () => {
        if (release()) current.current.handlers.cancel();
      },
    }),
  ).current;
  const dragProps = {
    ...(disabled ? {} : pan.panHandlers),
    onPointerDown: (e: { nativeEvent: { pointerType?: string; button?: number } }) => {
      mousePress.current = e.nativeEvent.pointerType === "mouse" && e.nativeEvent.button === 0;
    },
    onPointerUp: () => {
      mousePress.current = false;
    },
  };
  return (
    <Animated.View
      {...(handle ? {} : dragProps)}
      onLayout={(e) => {
        const { x, y, width, height } = e.nativeEvent.layout;
        onLayout(horizontal ? x : y, horizontal ? width : height);
      }}
      style={{
        zIndex: held ? 2 : 0,
        borderRadius: 8,
        backgroundColor: held ? colors.surface0 : "transparent",
        shadowColor: "#000",
        shadowOpacity: held ? 0.14 : 0,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 4 },
        // The held row tracks the pointer immediately; the others slide.
        transform: [
          horizontal
            ? held ? { translateX: dy } : { translateX: slide }
            : held ? { translateY: dy } : { translateY: slide },
          { scale: lerp(lift, [1, 1.01]) },
        ],
        ...(held ? ({ cursor: "grabbing" } as object) : {}),
      }}
    >
      {render(handle ? dragProps : {})}
    </Animated.View>
  );
}
