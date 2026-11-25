import { beforeEach, expect, test, vi } from "vitest";
import { createElement, Fragment, type Context, type ReactElement, type ReactNode } from "react";
import type { PluginTheme } from "@getpaseo/plugin";

const harness = vi.hoisted(() => ({
  contexts: new Map<unknown, unknown>(),
  platform: "ios",
  motion: [] as number[],
  reduced: true,
}));

vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useContext: <T,>(context: Context<T>) => harness.contexts.has(context)
    ? harness.contexts.get(context)
    : (context as Context<T> & { _currentValue: T })._currentValue,
}));
vi.mock("react-native", async () => {
  const React = await import("react");
  return {
    Platform: { OS: "ios" },
    Animated: { View: "view" },
    Modal: ({ children, ...props }: { children: ReactNode }) =>
      React.createElement(harness.platform === "web" ? "dialog" : "native-portal", props, children),
    View: "view", Text: "text", Pressable: "pressable", Image: "image",
    StyleSheet: {
      flatten: (style: unknown) => style,
      absoluteFillObject: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0 },
    },
  };
});
vi.mock("./shortcuts", () => ({ useShortcutBlock: () => {} }));
vi.mock("./motion", async () => {
  const React = await import("react");
  return {
    MotionBridge: ({ reduced, children }: { reduced: boolean; children: ReactNode }) =>
      React.createElement("motion-bridge", { reduced }, children),
    useReducedMotion: () => harness.reduced,
    useMotionValue: (target: number) => { harness.motion.push(target); return target; },
    useMotionPresence: (open: boolean) => ({ item: open ? "projects" : undefined, active: open, progress: open ? 1 : 0, settled: open }),
    motionDuration: { forward: 220, reverse: 160 },
    lerp: () => 0,
  };
});
vi.mock("@getpaseo/plugin/client/react-native", async () => {
  const React = await import("react");
  const ModalContext = React.createContext<{ icon?: ReactNode } | null>(null);
  // Paseo 0.16's Modal.Content moves both header and body through Gorhom's
  // non-React portal. Only explicitly bridged contexts survive on phones.
  const Modal = Object.assign(
    ({ children, icon }: { children: ReactNode; icon?: ReactNode }) =>
      React.createElement(ModalContext.Provider, { value: { icon } }, children),
    { Content: ({ children, ...props }: { children: ReactNode }) => {
      const modal = React.useContext(ModalContext)!;
      return React.createElement(harness.platform === "web" ? "dialog" : "native-portal", props,
        React.createElement("header", null, modal.icon),
        React.createElement("body", null, children));
    } },
  );
  return { Modal, Icon: "icon", TextInput: "input", ScrollView: "scroll-view" };
});

import { Modal as HostModal } from "@getpaseo/plugin/client/react-native";
import { Modal } from "./modal";
import { ProjectChooserDialog } from "./project-chooser-dialog";
import { BrandIcon } from "./brand-icons";
import { Button, Theme, useTheme } from "./ui";

type HostNode = { type: string; props: Record<string, any> };
// Small synchronous element walker: uses real context/provider identities and
// production components, but models portal reparenting explicitly. It does not
// simulate React scheduling, native layout, gestures or an actual iPhone.
function render(node: ReactNode, contexts = new Map<unknown, unknown>()): HostNode[] {
  if (node == null || typeof node === "boolean" || typeof node === "string" || typeof node === "number") return [];
  if (Array.isArray(node)) return node.flatMap(child => render(child, contexts));
  const { type, props } = node as ReactElement<any>;
  if (type === Fragment) return render(props.children, contexts);
  if (typeof type === "string") {
    return [{ type, props }, ...render(props.children, type === "native-portal" ? new Map() : contexts)];
  }
  const special = type as unknown as { $$typeof?: symbol; type?: any };
  if (special.$$typeof === Symbol.for("react.context")) {
    const next = new Map(contexts);
    next.set(type, props.value);
    return render(props.children, next);
  }
  if (special.$$typeof === Symbol.for("react.memo")) return render(createElement(special.type, props), contexts);
  if (typeof type !== "function") throw new Error("Unsupported test element");
  const previous = harness.contexts;
  harness.contexts = contexts;
  try { return render((type as (props: any) => ReactNode)(props), contexts); }
  finally { harness.contexts = previous; }
}

const light = { colors: { accent: "#0055ff", accentForeground: "#ffffff", surface0: "#ffffff" } } as PluginTheme;
const dark = { colors: { accent: "#aabbff", accentForeground: "#000000", surface0: "#111111" } } as PluginTheme;
const noop = () => {};
function Probe() {
  return <Button primary onPress={noop}>Create</Button>;
}
function ThemedValue() {
  return createElement("theme", { value: useTheme() });
}
const themed = (theme: PluginTheme, children: ReactNode) => <Theme.Provider value={theme}>{children}</Theme.Provider>;
const buttons = (nodes: HostNode[]) => nodes.filter(node => node.type === "pressable")
  .map(node => (typeof node.props.style === "function" ? node.props.style({}) : node.props.style)?.backgroundColor);

beforeEach(() => { harness.platform = "ios"; harness.motion = []; harness.reduced = true; });

test("the native host boundary reproduces Theme missing in Button despite a body-only provider", () => {
  expect(() => render(themed(light,
    <HostModal open title="Create task" icon={<Probe />} onOpenChange={noop}>
      <HostModal.Content>{themed(light, <Probe />)}</HostModal.Content>
    </HostModal>,
  ))).toThrow("Theme missing");
});

test.each(["ios", "android", "web"])("%s header and body use the caller theme across the host boundary", platform => {
  harness.platform = platform;
  const nodes = render(themed(light,
    <Modal open title="Create task" icon={<Probe />} onOpenChange={noop}>
      <Modal.Content scrollable={false} contentContainerStyle={{ gap: 8 }}><Probe /></Modal.Content>
    </Modal>,
  ));
  expect(buttons(nodes)).toEqual([light.colors.accent, light.colors.accent]);
  const body = nodes.find(node => node.type === "view")!;
  expect(body.props.style).toMatchObject({ gap: 8, flex: 1, minHeight: 0 });
  expect(nodes.find(node => node.type === (platform === "web" ? "dialog" : "native-portal"))?.props.scrollable).toBe(false);
});

test("connector picker header BrandIcon follows theme changes, and separate modals keep their own themes", () => {
  const modal = (theme: PluginTheme) => themed(theme,
    <Modal open title="GitHub" icon={<BrandIcon family="github" />} onOpenChange={noop}>
      <Modal.Content><ThemedValue /></Modal.Content>
    </Modal>,
  );
  const first = render(modal(light));
  const updated = render(modal(dark));
  expect(first.find(node => node.type === "image")?.props.source).not.toEqual(updated.find(node => node.type === "image")?.props.source);
  expect(render([modal(light), modal(dark)]).filter(node => node.type === "theme").map(node => node.props.value)).toEqual([light, dark]);
});

test("closed modal content keeps its captured open state after reparenting", () => {
  render(themed(light, <Modal open={false} title="Create task" onOpenChange={noop}>
    <Modal.Content>{themed(light, <Probe />)}</Modal.Content>
  </Modal>));
  expect(harness.motion).toEqual([0]);
});

test("a theme consumer outside a provider still fails instead of using a stale global palette", () => {
  expect(() => render(<Probe />)).toThrow("Theme missing");
});

test("ProjectChooserDialog bridges theme and motion on both compact and wide native paths", () => {
  harness.reduced = false;
  for (const nativeWide of [true, false]) {
    const chooser = (theme: PluginTheme) => themed(theme,
      <ProjectChooserDialog open nativeWide={nativeWide} onClose={noop}>
        <Probe />
        <ThemedValue />
      </ProjectChooserDialog>,
    );
    const lightNodes = render(chooser(light));
    const darkNodes = render(chooser(dark));
    expect(lightNodes.find(node => node.type === "theme")?.props.value).toBe(light);
    expect(darkNodes.find(node => node.type === "theme")?.props.value).toBe(dark);
    expect(buttons(lightNodes)).toContain(light.colors.accent);
    expect(buttons(darkNodes)).toContain(dark.colors.accent);
    expect(lightNodes.find(node => node.type === "motion-bridge")?.props.reduced).toBe(false);
  }
});
