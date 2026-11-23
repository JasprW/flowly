import { beforeEach, expect, test, vi } from "vitest";
import { Fragment, type ReactElement, type ReactNode } from "react";

const harness = vi.hoisted(() => ({ web: false, listened: 0 }));

// Hooks without a renderer: state keeps its first value, effects run once.
vi.mock("react", async (original) => {
  const react = await original<typeof import("react")>();
  return {
    ...react,
    useState: <T,>(init: T | (() => T)) => [typeof init === "function" ? (init as () => T)() : init, () => undefined],
    useRef: <T,>(value: T) => ({ current: value }),
    useEffect: (run: () => unknown) => void run(),
  };
});
vi.mock("react-native", () => ({ View: "view", Image: "image", Pressable: "pressable", Platform: { OS: "ios" } }));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ Icon: "icon", useToast: () => ({ error: () => undefined }) }));
vi.mock("./motion", () => ({ Enter: ({ children }: { children: ReactNode }) => children }));
vi.mock("./ui", () => ({
  Button: ({ children }: { children: ReactNode }) => ({ type: "button", props: { children } }) as unknown as ReactElement,
  Label: "label",
  font: { sm: 12 },
  radius: { md: 6 },
  space: { 2: 8 },
  noFocusRing: {},
  message: String,
  useTheme: () => ({ colors: {} }),
}));
vi.mock("./web-images", () => ({
  get imageInputSupported() {
    return harness.web;
  },
  listenForImages: () => {
    harness.listened++;
    return () => undefined;
  },
  pickImageFiles: async () => [],
  readImages: async () => ({ images: [], problems: [] }),
}));

import { ImageAttachments, useImageAttachments } from "./image-attach";

type HostNode = { type: string; props: Record<string, any> };
function render(node: ReactNode): HostNode[] {
  if (node == null || typeof node === "boolean" || typeof node === "string" || typeof node === "number") return [];
  if (Array.isArray(node)) return node.flatMap(render);
  const { type, props } = node as ReactElement<any>;
  if (type === Fragment) return render(props.children);
  if (typeof type === "string") return [{ type, props }, ...render(props.children)];
  return render((type as (p: any) => ReactNode)(props));
}
const text = (nodes: HostNode[]) =>
  nodes.flatMap((n) => [n.props.accessibilityLabel, n.type === "button" || n.type === "label" ? n.props.children : undefined]).filter(Boolean);

const restored = [{ id: "image-1-1", name: "screen.png", mimeType: "image/png" as const, data: "AAAA", uri: "data:image/png;base64,AAAA" }];

beforeEach(() => {
  harness.web = false;
  harness.listened = 0;
});

test("phones show a restored draft's images with their remove buttons, but no picker or paste hint", () => {
  const state = useImageAttachments(4, undefined, restored);
  // What a create sends is what the form shows.
  expect(state.images()).toEqual([{ data: "AAAA", mimeType: "image/png" }]);
  const nodes = render(<ImageAttachments state={state}>{"field"}</ImageAttachments>);
  expect(nodes.filter((n) => n.type === "image").map((n) => n.props.source.uri)).toEqual(["data:image/png;base64,AAAA"]);
  const remove = nodes.find((n) => n.type === "pressable" && n.props.accessibilityLabel === "Remove screen.png");
  expect(remove).toBeTruthy();
  expect(text(nodes)).not.toContain("Add images");
  expect(text(nodes)).not.toContain("or paste or drop them here");
  remove!.props.onPress();
  expect(state.images()).toEqual([]);
});

test("phones without images render just the field, inside the same wrapper", () => {
  const state = useImageAttachments(4);
  const nodes = render(<ImageAttachments state={state}>{"field"}</ImageAttachments>);
  expect(nodes.map((n) => n.type)).toEqual(["view"]);
});

test("web keeps the picker beside the thumbnails", () => {
  harness.web = true;
  const state = useImageAttachments(4, undefined, restored);
  const nodes = render(<ImageAttachments state={state}>{"field"}</ImageAttachments>);
  expect(nodes.filter((n) => n.type === "image")).toHaveLength(1);
  expect(text(nodes)).toContain("Add images");
});
