import React from "react";
import { Animated } from "react-native";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { motionMockState } from "../motion/rn-motion-mock";

const state = vi.hoisted(() => ({
  actor: {} as any,
  timelineResult: {} as any,
  queryOptions: [] as any[],
  subscriptions: [] as Array<{ callback: () => void; stop: ReturnType<typeof vi.fn> }>,
  scrollToEnd: vi.fn(),
  sendInstruction: vi.fn(),
  openURL: vi.fn(),
  workspaceSession: undefined as any,
  paseo: undefined as any,
}));

vi.mock("react-native", async () => {
  const React = await import("react");
  const motion = await import("../motion/rn-motion-mock");
  return {
    ...motion.createReactNativeMotionMock(),
    ActivityIndicator: "ActivityIndicator",
    KeyboardAvoidingView: "KeyboardAvoidingView",
    Linking: { openURL: state.openURL },
    Platform: { OS: "ios" },
    Text: "NativeText",
    View: "View",
  };
});
vi.mock("@getpaseo/plugin/client/react-native", async () => {
  const React = await import("react");
  const ScrollView = React.forwardRef((props: any, ref: any) => {
    React.useImperativeHandle(ref, () => ({ scrollToEnd: state.scrollToEnd }), []);
    const { children, ...rest } = props;
    return React.createElement("ScrollView", rest, children);
  });
  // No FlatList: the transcript uses its ScrollView path (SESSION-PANE-SPEC §3).
  return { Icon: "Icon", ScrollView, FlatList: undefined, TextInput: "TextInput" };
});
vi.mock("@getpaseo/plugin/client", () => ({
  usePaseo: () => state.paseo,
  useRpc: (key: string) => state.paseo.rpc[key],
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: any) => {
    state.queryOptions.push(options);
    if (options.queryKey[1] === "timeline") return state.timelineResult;
    if (options.queryKey[1] === "agent") return { data: { agent: state.actor }, isPending: false, isError: false, refetch: vi.fn(async () => ({ agent: state.actor })) };
    if (options.queryKey[1] === "tools") return { data: { ready: true } };
    if (options.queryKey[1] === "access") return { data: { methods: [], ready: true }, refetch: vi.fn() };
    return { data: undefined, isPending: false, isError: false, refetch: vi.fn() };
  },
}));
vi.mock("../../../../shared/rpc", () => ({ taskContext: "taskContext", toolsHealth: "toolsHealth", prepareExisting: "prepareExisting", accessState: "accessState", readSessionReceipts: "readSessionReceipts", markSessionRead: "markSessionRead" }));
vi.mock("../../../../client/session", () => ({
  sendCardInstruction: (...args: any[]) => state.sendInstruction(...args),
  workspaceSession: (...args: any[]) => state.workspaceSession(...args),
}));
vi.mock("../../../../client/ui", async () => {
  const React = await import("react");
  const node = (type: string) => ({ children, ...props }: any) => React.createElement(type, props, children);
  return {
    Button: node("Button"), Choices: node("Choices"), Label: node("Label"), Notice: node("Notice"),
    message: (error: any) => String(error?.message ?? error),
    useTheme: () => ({ colors: { accent: "accent", border: "border", surface0: "surface", surface1: "surface1", foregroundMuted: "muted", foreground: "fg" } }),
  };
});

const rendererPath = process.env.SESSION_LAYOUT_TEST_RENDERER;
const renderer = rendererPath ? require(rendererPath) : null;
const { act, create } = renderer || { act: (_fn: () => unknown) => {}, create: () => undefined };
const { SessionPreview } = await import("../../../../client/session-preview");
const { SessionMarkdown } = await import("../../../../client/session-content");
const { parseSessionInline, parseSessionMarkdown } = await import("../../../../client/session-markdown");
const { recentSessionOutput } = await import("../../../../client/session-state");
const { coalescedRefresh } = await import("../../../../client/session-follow");
const { MotionProvider, useMotionPresence } = await import("../../../../client/motion");

const task: any = { id: "task-fixture", workspaceId: "workspace-fixture", title: "Layout fixture", sourcePath: "/fixture", repoPaths: ["/fixture"] };
const longMetadata = "provider-name-".repeat(30);
const props = (extra: any = {}) => ({
  task, sessionId: "agent-fixture", hostId: "host-fixture", events: [], unavailable: false,
  navigation: undefined, draft: "draft text", pending: false,
  beginOperation: vi.fn(() => true), endOperation: vi.fn(), onDraftChange: vi.fn(), onBack: vi.fn(), refresh: vi.fn(),
  ...extra,
});
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await new Promise((resolve) => setTimeout(resolve, 0)); };
function strings(node: any): string[] {
  if (typeof node === "string") return [node];
  if (Array.isArray(node)) return node.flatMap(strings);
  if (!node) return [];
  return strings(node.children ?? node.props?.children);
}
function button(tree: any, label: string) {
  return tree.root.findAllByType("Button").find((item: any) => strings(item).join(" ").includes(label));
}
function renderPreview(p = props()) {
  let tree: any;
  act(() => { tree = create(<SessionPreview {...p} />); });
  return tree;
}
function scrollEvent(y: number, height = 1000, viewport = 300) {
  return { nativeEvent: { contentOffset: { x: 0, y }, contentSize: { width: 300, height }, layoutMeasurement: { width: 300, height: viewport } } };
}
function RetainedPreviewShell({ open, previewProps }: { open: boolean; previewProps: any }) {
  const presence = useMotionPresence(open ? "preview" : undefined, open ? "preview" : "");
  return <Animated.View testID="preview-exit-shell" pointerEvents={presence.active ? "auto" : "none"}>
    {presence.item ? <SessionPreview {...previewProps} visible={presence.active} /> : null}
  </Animated.View>;
}

beforeEach(() => {
  state.actor = { id: "agent-fixture", title: "Fixture agent", workspaceId: task.workspaceId, status: "idle", provider: longMetadata, model: longMetadata, pendingPermissions: [], lastUserMessageAt: "2026-10-14T00:00:00Z", archivedAt: null };
  state.timelineResult = { data: { entries: [] }, isPending: false, isError: false, refetch: vi.fn(async () => ({ entries: [] })) };
  state.queryOptions = [];
  state.subscriptions = [];
  state.scrollToEnd.mockClear();
  state.sendInstruction.mockReset().mockResolvedValue(undefined);
  state.workspaceSession = vi.fn(async () => state.actor);
  state.openURL.mockReset().mockResolvedValue(undefined);
  const refetch = vi.fn(async () => ({ entries: [] }));
  const subscribe = vi.fn((callback: () => void) => {
    const stop: any = vi.fn();
    stop.ready = Promise.resolve();
    state.subscriptions.push({ callback, stop });
    return stop;
  });
  state.paseo = {
    agents: { ref: () => ({ refresh: vi.fn(async () => ({ agent: state.actor })), send: vi.fn(), timeline: { refetch, subscribe } }) },
    rpc: { taskContext: vi.fn(), toolsHealth: vi.fn(async () => ({ ready: true })), prepareExisting: vi.fn(), accessState: vi.fn(async () => ({ methods: [], ready: true })) },
  };
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });

describe.skipIf(!rendererPath)("session preview layout focused renderer", () => {
  test("parses native Markdown blocks, readable partial fences, inline marks and every vertical table cell", async () => {
    const source = "# Heading\n\n- [x] task\n> quote\n```ts\nconst open = true;";
    expect(parseSessionMarkdown(source).map((block: any) => block.kind)).toEqual(["heading", "list", "quote", "code"]);
    expect((parseSessionMarkdown(source).at(-1) as any).text).toBe("const open = true;");
    expect(parseSessionInline("**bold** *italic* `code` [link](https://example.test)").map((part: any) => part.kind)).toEqual(["bold", "text", "italic", "text", "code", "text", "link"]);
    const table = "| Name | Value |\n| --- | --- |\n| alpha | one |\n| beta | two |";
    const parsed = parseSessionMarkdown(table)[0] as any;
    expect(parsed.rows).toEqual([["alpha", "one"], ["beta", "two"]]);
    let tree: any;
    await act(async () => { tree = create(<SessionMarkdown text={table} />); });
    expect(strings(tree.toJSON())).toEqual(expect.arrayContaining(["Name", "Value", "alpha", "one", "beta", "two"]));
    tree.unmount();
  });

  test("keeps the bounded composer outside the output scroller and constrains long metadata", async () => {
    let tree: any;
    await act(async () => { tree = create(<SessionPreview {...props()} />); await flush(); });
    const output = tree.root.findByProps({ testID: "session-output" });
    const composer = tree.root.findByProps({ testID: "session-composer" });
    expect(output.parent).toBe(composer.parent);
    expect(output.parent.children).toContain(output);
    expect(output.parent.children).toContain(composer);
    const input = tree.root.findByType("TextInput");
    expect(input.props.multiline).toBe(true);
    expect(input.props.scrollEnabled).toBe(true);
    expect(input.props.style.minHeight).toBeGreaterThanOrEqual(72);
    expect(input.props.style.maxHeight).toBeLessThanOrEqual(120);
    const metadata = tree.root.findAllByType("Label").find((item: any) => strings(item).join("").includes(longMetadata));
    expect(metadata.props.lines).toBe(2);
    tree.unmount();
  });

  test("imperative ScrollView ref follows initial/content/layout and same-row output growth while following", async () => {
    state.timelineResult.data.entries = [{ seq: 7, item: { type: "assistant_message", text: "initial" } }];
    let tree: any;
    await act(async () => { tree = create(<SessionPreview {...props()} />); await flush(); });
    expect(state.scrollToEnd).toHaveBeenCalledWith({ animated: false });
    state.scrollToEnd.mockClear();
    const output = tree.root.findByProps({ testID: "session-output" });
    act(() => output.props.onContentSizeChange(320, 800));
    act(() => output.props.onLayout({ nativeEvent: { layout: { width: 300, height: 400 } } }));
    expect(state.scrollToEnd).toHaveBeenCalledTimes(2);
    state.scrollToEnd.mockClear();
    state.timelineResult.data = { entries: [{ seq: 7, item: { type: "assistant_message", text: "initial plus streamed tokens" } }] };
    await act(async () => { tree.update(<SessionPreview {...props()} />); await flush(); });
    expect(state.scrollToEnd).toHaveBeenCalled();
    tree.unmount();
  });

  test("pauses after upward scroll, resumes within 64 pt or Jump to latest, and preserves follow on programmatic end scroll", async () => {
    let tree: any;
    await act(async () => { tree = create(<SessionPreview {...props()} />); await flush(); });
    let output = tree.root.findByProps({ testID: "session-output" });
    act(() => output.props.onScrollBeginDrag());
    act(() => output.props.onScroll(scrollEvent(300)));
    act(() => output.props.onScrollEndDrag());
    expect(button(tree, "Jump to latest")).toBeTruthy();
    state.scrollToEnd.mockClear();
    act(() => output.props.onContentSizeChange(300, 1400));
    expect(state.scrollToEnd).not.toHaveBeenCalled();
    act(() => button(tree, "Jump to latest").props.onPress());
    expect(state.scrollToEnd).toHaveBeenCalledWith({ animated: false });
    output = tree.root.findByProps({ testID: "session-output" });
    act(() => output.props.onScroll(scrollEvent(700)));
    expect(button(tree, "Jump to latest")).toBeFalsy();
    act(() => output.props.onScroll(scrollEvent(600, 1000, 300)));
    expect(button(tree, "Jump to latest")).toBeTruthy();
    tree.unmount();
  });

  test("successful send clears the submitted draft and resumes tail; failure retains draft and position; duplicate send is locked", async () => {
    const p = props();
    let tree: any;
    await act(async () => { tree = create(<SessionPreview {...p} />); await flush(); });
    const output = tree.root.findByProps({ testID: "session-output" });
    act(() => { output.props.onScrollBeginDrag(); output.props.onScroll(scrollEvent(300)); output.props.onScrollEndDrag(); });
    const pending: { resolve?: (value?: unknown) => void } = {};
    state.sendInstruction.mockImplementationOnce(() => new Promise((resolve) => { pending.resolve = resolve; }));
    const send = button(tree, "Send instruction");
    await act(async () => { send.props.onPress(); send.props.onPress(); await flush(); });
    expect(state.sendInstruction).toHaveBeenCalledTimes(1);
    state.scrollToEnd.mockClear();
    await act(async () => { pending.resolve?.(); await flush(); });
    expect(p.onDraftChange).toHaveBeenCalledWith("agent-fixture", "", "draft text");
    expect(state.scrollToEnd).toHaveBeenCalledWith({ animated: false });

    p.onDraftChange.mockClear();
    await act(async () => { tree.update(<SessionPreview {...p} draft="retry draft" />); await flush(); });
    state.sendInstruction.mockRejectedValueOnce(new Error("send failed"));
    state.scrollToEnd.mockClear();
    await act(async () => { button(tree, "Send instruction").props.onPress(); await flush(); });
    expect(p.onDraftChange).not.toHaveBeenCalled();
    expect(strings(tree.toJSON()).join(" ")).toContain("send failed");
    expect(state.scrollToEnd).not.toHaveBeenCalled();
    tree.unmount();
  });

  test("timeline reads tail direction and surfaces SDK payload error instead of empty-output state", async () => {
    const refetch = vi.fn(async () => ({ entries: [], error: "timeline backend unavailable" }));
    state.paseo.agents.ref = () => ({ refresh: vi.fn(), send: vi.fn(), timeline: { refetch, subscribe: () => { const stop: any = vi.fn(); stop.ready = Promise.resolve(); return stop; } } });
    let tree: any;
    await act(async () => { tree = create(<SessionPreview {...props()} />); await flush(); });
    const timelineQuery = state.queryOptions.find((options: any) => options.queryKey[1] === "timeline");
    await expect(timelineQuery.queryFn()).rejects.toThrow("timeline backend unavailable");
    expect(refetch).toHaveBeenCalledWith({ direction: "tail", limit: 35, projection: "projected" });
    state.timelineResult = { ...state.timelineResult, error: new Error("timeline backend unavailable"), data: { entries: [] } };
    await act(async () => { tree.update(<SessionPreview {...props()} />); await flush(); });
    expect(strings(tree.toJSON()).join(" ")).toContain("timeline backend unavailable");
    expect(strings(tree.toJSON()).join(" ")).not.toContain("No text output yet.");
    await act(async () => { tree.unmount(); });
  });

  test("membership failure hides output/composer; Back calls callback and unmount releases subscription", async () => {
    state.actor = { ...state.actor, workspaceId: "other-workspace" };
    const p = props();
    let tree: any;
    await act(async () => { tree = create(<SessionPreview {...p} />); await flush(); });
    expect(tree.root.findAllByProps({ testID: "session-composer" })).toHaveLength(0);
    expect(strings(tree.toJSON()).join(" ")).toContain("different workspace");
    expect(state.queryOptions.find((options: any) => options.queryKey[1] === "timeline").enabled).toBe(false);
    await act(async () => { tree.unmount(); });

    state.actor = { ...state.actor, workspaceId: task.workspaceId };
    await act(async () => { tree = create(<SessionPreview {...p} />); await flush(); });
    expect(state.subscriptions.length).toBeGreaterThan(0);
    act(() => button(tree, "Back to task").props.onPress());
    expect(p.onBack).toHaveBeenCalledTimes(1);
    await act(async () => { tree.unmount(); });
    expect(state.subscriptions.at(-1)?.stop).toHaveBeenCalledTimes(1);
  });

  test("coalesces subscription bursts at 250 ms and cancels a pending refresh on disposal", () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    const updates = coalescedRefresh(refresh, 250);
    updates.trigger(); updates.trigger(); updates.trigger();
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(249);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    updates.trigger();
    updates.dispose();
    vi.advanceTimersByTime(250);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test("motion exit retains a real inactive preview while queries/actions/observation stop immediately", async () => {
    motionMockState.reset();
    let resolveMembership!: (value: any) => void;
    state.workspaceSession = vi.fn(() => new Promise((resolve) => { resolveMembership = resolve; }));
    const navigation: any = { openAgent: vi.fn() };
    const previewProps = props({ navigation });
    let tree: any;
    await act(async () => { tree = create(<MotionProvider><RetainedPreviewShell open previewProps={previewProps} /></MotionProvider>); await flush(); });
    expect(state.subscriptions).toHaveLength(1);
    act(() => button(tree, "Open in Paseo").props.onPress());
    expect(state.workspaceSession).toHaveBeenCalledTimes(1);

    await act(async () => { tree.update(<MotionProvider><RetainedPreviewShell open={false} previewProps={previewProps} /></MotionProvider>); });
    expect(tree.root.findByProps({ testID: "preview-exit-shell" }).props.pointerEvents).toBe("none");
    expect(tree.root.findByType("KeyboardAvoidingView")).toBeTruthy();
    expect(state.subscriptions[0].stop).toHaveBeenCalledTimes(1);
    const queries = state.queryOptions.filter((options: any) => ["agent", "timeline", "tools", "access"].includes(options.queryKey[1]));
    expect(queries.slice(-4).every((options: any) => options.enabled === false)).toBe(true);
    expect(button(tree, "Open in Paseo").props.disabled).toBe(true);
    expect(motionMockState.animations.at(-1)?.config.duration).toBe(160);

    await act(async () => { resolveMembership(state.actor); await flush(); });
    expect(navigation.openAgent).not.toHaveBeenCalled();
    expect(tree.root.findByType("KeyboardAvoidingView")).toBeTruthy();
    expect(button(tree, "Send instruction").props.disabled).toBe(true);
    expect(tree.root.findAllByType("TextInput").length).toBeGreaterThan(0);
    expect(tree.root.findAllByType("TextInput").every((input: any) => input.props.editable === false)).toBe(true);
    const exitIndex = motionMockState.animations.length - 1;
    await act(async () => { motionMockState.finish(exitIndex, true); await flush(); });
    expect(tree.root.findAllByType("KeyboardAvoidingView")).toHaveLength(0);
    await act(async () => { tree.unmount(); });
  });

  test("recent output uses sequence keys, includes named tool summaries, and skips malformed tool calls", () => {
    expect(recentSessionOutput([
      { seqStart: 12, item: { type: "tool_call", name: "search", status: "done" } },
      { seqStart: 13, item: { type: "tool_call" } },
    ])).toEqual([{ key: "12-tool_call", author: "Tool", text: "search · done", kind: "tool" }]);
  });
});
