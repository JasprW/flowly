import { createContext, useCallback, useContext, useEffect, useRef } from "react";
import { Animated, StyleSheet, type ViewStyle } from "react-native";
import {
  Modal as HostModal,
  type ModalComponent,
  type ModalContentProps,
  type ModalProps,
} from "@getpaseo/plugin/client/react-native";
import { useShortcutBlock } from "./shortcuts";
import { MotionBridge, motionDuration, useMotionValue, useReducedMotion, lerp } from "./motion";

/** Host Modal that suspends board shortcuts while open; the host keeps Esc and focus. */
const OpenContext = createContext(true);
function TrackedModal(props: ModalProps) {
  useShortcutBlock(props.open);
  return (
    <OpenContext.Provider value={props.open}>
      <HostModal {...props} />
    </OpenContext.Provider>
  );
}

/** Content settles in with a short rise when the modal opens (the host card itself appears instantly on desktop). */
function ModalEnter({ gap, fill, children }: { gap: number; fill: boolean; children: ModalContentProps["children"] }) {
  // Replays on every open, also when the host keeps the content mounted while closed.
  const open = useContext(OpenContext);
  const progress = useMotionValue(open ? 1 : 0, open ? motionDuration.forward : motionDuration.reverse, 0);
  return (
    <Animated.View
      style={{
        gap,
        ...(fill ? { flex: 1, minHeight: 0 } : {}),
        opacity: progress,
        transform: [{ translateY: lerp(progress, [8, 0]) }],
      }}
    >
      {children}
    </Animated.View>
  );
}

TrackedModal.Content = function Content(props: ModalContentProps) {
  const reduced = useReducedMotion();
  // One wrapper child must keep the container's gap between the caller's children (host default 16).
  const gap = (StyleSheet.flatten(props.contentContainerStyle) as ViewStyle | undefined)?.gap;
  return (
    <HostModal.Content {...props}>
      <MotionBridge reduced={reduced}>
        <ModalEnter gap={typeof gap === "number" ? gap : 16} fill={props.scrollable === false}>
          {props.children}
        </ModalEnter>
      </MotionBridge>
    </HostModal.Content>
  );
};
export const Modal: ModalComponent = TrackedModal;

/** The host Modal has no closed callback; opening another Modal or a heavy view in the frame one closes freezes Paseo. */
export const MODAL_CLOSE_MS = 450;

/**
 * Runs `fn` after a Modal has had time to close (the latest call wins; cleared on unmount).
 * Close the Modal first, then pass whatever opens next through this.
 */
export function useAfterModalClose() {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return useCallback((fn: () => void) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      fn();
    }, MODAL_CLOSE_MS);
  }, []);
}
