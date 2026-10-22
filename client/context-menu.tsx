import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { Animated, Pressable, View, type GestureResponderEvent } from "react-native";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { Modal, useAfterModalClose } from "./modal";
import { Label, Row, Theme, font, noFocusRing, radius, space, touch, useTheme } from "./ui";
import { useMotionPresence, lerp } from "./motion";
import { t } from "../shared/i18n";

export type MenuEntry =
  | { kind?: "item"; id: string; label: string; icon?: string; leading?: ReactNode; danger?: boolean; checked?: boolean; disabled?: boolean; onPress(): void }
  | { kind: "separator"; id: string }
  | { kind: "label"; id: string; label: string };

export type Point = { x: number; y: number };
type Opener = (at: Point, title: string, entries: MenuEntry[]) => void;
const Context = createContext<Opener | null>(null);

/** Position of a press/right-click, in window coordinates. */
export function eventPoint(event: GestureResponderEvent | { nativeEvent: { pageX?: number; pageY?: number } }): Point {
  const n = event.nativeEvent as { pageX?: number; pageY?: number };
  return { x: n.pageX ?? 0, y: n.pageY ?? 0 };
}

/** The board's menu opener (null outside a ContextMenuProvider). */
export function useMenuOpener() {
  return useContext(Context);
}

/**
 * Plugin context menus: right-click on desktop web, long-press on touch.
 * Spread the result onto a Pressable. The browser's own menu is suppressed.
 */
export function menuHandlers(open: Opener | null, title: string, entries: () => MenuEntry[]): object {
  if (!open) return {};
  const show = (event: GestureResponderEvent) => open(eventPoint(event), title, entries());
  return {
    onLongPress: show,
    onContextMenu: (event: GestureResponderEvent & { preventDefault?(): void; stopPropagation?(): void }) => {
      event.preventDefault?.();
      event.stopPropagation?.();
      show(event);
    },
  };
}

/**
 * Board-level suppression of the browser context menu. Editable fields keep
 * their native menu (copy/paste); everything else gets plugin menus or none.
 */
export function suppressNativeMenu(event: { preventDefault?(): void; nativeEvent?: { target?: unknown } }) {
  const target = event.nativeEvent?.target as { tagName?: string; isContentEditable?: boolean } | undefined;
  if (target?.isContentEditable || /^(INPUT|TEXTAREA)$/.test(target?.tagName || "")) return;
  event.preventDefault?.();
}

export function ContextMenuProvider({ compact, children }: { compact: boolean; children: ReactNode }) {
  const theme = useTheme();
  const { colors } = theme;
  const root = useRef<View>(null);
  const [menu, setMenu] = useState<{ at: Point; title: string; entries: MenuEntry[]; key: number } | null>(null);
  const [origin, setOrigin] = useState({ x: 0, y: 0, width: 0, height: 0 });
  const seq = useRef(0);
  const presence = useMotionPresence(menu, menu ? String(menu.key) : "");
  // Stable: it is the context value, and a new one would re-render every
  // consumer (the whole board) on each menu open/close (PERFORMANCE-SPEC §3).
  const compactRef = useRef(compact);
  compactRef.current = compact;
  const open = useCallback<Opener>((at, title, entries) => {
    // Phones show a bottom sheet: no anchoring geometry needed.
    if (!compactRef.current)
      root.current?.measureInWindow((x, y, width, height) => setOrigin({ x, y, width, height }));
    setMenu({ at, title, entries, key: ++seq.current });
  }, []);
  const close = () => setMenu(null);
  const afterClose = useAfterModalClose();
  const run = (entry: MenuEntry) => {
    close();
    if (entry.kind === "separator" || entry.kind === "label") return;
    // Phones show the menu in a Modal; what the entry opens (a dialog, a card) waits for it to close.
    if (compactRef.current) afterClose(entry.onPress);
    else entry.onPress();
  };
  const shown = presence.item;
  const width = 232;
  const itemCount = shown ? shown.entries.length : 0;
  const estimate = itemCount * 32 + 12;
  const left = shown ? Math.max(4, Math.min(shown.at.x - origin.x, origin.width - width - 4)) : 0;
  const top = shown ? Math.max(4, Math.min(shown.at.y - origin.y, origin.height - estimate - 4)) : 0;
  return (
    <Context.Provider value={open}>
      <View ref={root} style={{ flex: 1, minHeight: 0 }}>
        {children}
        {!compact && shown && (
          <>
            {/* Only an open menu catches outside clicks; a closing one never swallows the next click. */}
            {presence.active && <Pressable
              accessibilityLabel={t("Close menu")}
              onPress={close}
              {...({ onContextMenu: (e: { preventDefault?(): void }) => { e.preventDefault?.(); close(); } } as object)}
              style={{ ...noFocusRing, position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 200 }}
            />}
            <Animated.View
              accessibilityRole="menu"
              pointerEvents={presence.active ? "auto" : "none"}
              style={{
                position: "absolute",
                zIndex: 201,
                left,
                top,
                width,
                padding: 4,
                borderRadius: radius.lg,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.surface0,
                shadowColor: "#000",
                shadowOpacity: 0.14,
                shadowRadius: 18,
                shadowOffset: { width: 0, height: 8 },
                opacity: presence.progress,
                transform: [{ scale: lerp(presence.progress, [0.97, 1]) }],
              }}
            >
              {shown.entries.map((entry) =>
                entry.kind === "separator" ? (
                  <View key={entry.id} style={{ height: 1, marginVertical: 4, backgroundColor: colors.border }} />
                ) : entry.kind === "label" ? (
                  <View key={entry.id} style={{ paddingHorizontal: space[2] + 2, paddingTop: 4, paddingBottom: 2 }}>
                    <Label muted size={font.xs} selectable={false}>{entry.label}</Label>
                  </View>
                ) : (
                  <Pressable
                    key={entry.id}
                    accessibilityRole="menuitem"
                    accessibilityLabel={entry.label}
                    disabled={entry.disabled}
                    onPress={() => run(entry)}
                    style={(state) => {
                      const { pressed, hovered: hover, focused } = state as typeof state & { hovered?: boolean; focused?: boolean };
                      return {
                        ...noFocusRing,
                        flexDirection: "row",
                        alignItems: "center",
                        gap: space[2],
                        height: touch ? 40 : 30,
                        paddingHorizontal: space[2] + 2,
                        borderRadius: radius.md,
                        backgroundColor: hover || focused || pressed ? colors.surface2 : "transparent",
                        opacity: entry.disabled ? 0.4 : 1,
                      };
                    }}
                  >
                    <View style={{ width: 16, alignItems: "center" }}>
                      {entry.leading ?? (entry.icon ? (
                        <Icon name={entry.icon} size={14} color={entry.danger ? colors.statusDanger : colors.foregroundMuted} />
                      ) : null)}
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Label size={font.md} lines={1} color={entry.danger ? colors.statusDanger : undefined} selectable={false}>
                        {entry.label}
                      </Label>
                    </View>
                    {entry.checked && <Icon name="Check" size={14} color={colors.accent} />}
                  </Pressable>
                ),
              )}
            </Animated.View>
          </>
        )}
      </View>
      {compact && (
        <Modal open={!!menu} title={menu?.title || t("Actions")} onOpenChange={(next) => !next && close()}>
          <Modal.Content contentContainerStyle={{ padding: space[3], gap: space[1] }}>
            <Theme.Provider value={theme}>
              {(menu?.entries || []).map((entry) =>
                entry.kind === "separator" ? (
                  <View key={entry.id} style={{ height: 1, marginVertical: space[1], backgroundColor: colors.border }} />
                ) : entry.kind === "label" ? (
                  <View key={entry.id} style={{ paddingHorizontal: space[3], paddingTop: space[1] }}>
                    <Label medium muted size={font.sm} selectable={false}>{entry.label}</Label>
                  </View>
                ) : (
                  <Row
                    key={entry.id}
                    title={entry.label}
                    icon={entry.leading ? undefined : entry.icon}
                    leading={entry.leading}
                    iconColor={entry.danger ? colors.statusDanger : undefined}
                    selected={entry.checked}
                    disabled={entry.disabled}
                    onPress={() => run(entry)}
                  />
                ),
              )}
            </Theme.Provider>
          </Modal.Content>
        </Modal>
      )}
    </Context.Provider>
  );
}
