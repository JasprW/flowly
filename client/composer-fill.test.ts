import { beforeEach, expect, test, vi } from "vitest";
import type { PluginComposer, PluginComposerSelector } from "@getpaseo/plugin/client";

const copied: string[] = [];
const webFill = vi.fn(async (_agentId: string, _text: string) => false);
vi.mock("@getpaseo/plugin/client/react-native", () => ({ copyText: async (text: string) => void copied.push(text) }));
vi.mock("./web-composer", () => ({ fillComposer: (agentId: string, text: string) => webFill(agentId, text) }));

const { applyMessageMove, fillPluginComposer } = await import("./composer-fill");

/** A 0.16 composer: `refuse` makes focus() reject as the host does for a composer it cannot bring on screen. */
function composer(prompt = "", refuse = false) {
  const focus = vi.fn(async (_options?: unknown) => {
    if (refuse) throw new Error("Composer is not on screen");
  });
  const c = {
    prompt,
    setPrompt(text: string) {
      c.prompt = text;
    },
    focus,
  };
  return c as typeof c & PluginComposer;
}

beforeEach(() => {
  copied.length = 0;
  webFill.mockClear();
});

test("fills an empty composer and puts the cursor at the end", async () => {
  const c = composer();
  expect(await fillPluginComposer(c, "Run the tests")).toBe(true);
  expect(c.prompt).toBe("Run the tests");
  expect(c.focus).toHaveBeenCalledWith({ selection: { start: 13, end: 13 } });
});

test("appends after typed text with a blank line", async () => {
  const c = composer("Also");
  expect(await fillPluginComposer(c, "Run the tests")).toBe(true);
  expect(c.prompt).toBe("Also\n\nRun the tests");
});

test("a refused focus puts the earlier text back and the move is copied", async () => {
  const c = composer("Draft", true);
  const composers = vi.fn(() => [c]);
  expect(await applyMessageMove({ client: { composers }, agentId: "a1", prompt: "Run the tests", tap: "fill" })).toBe("copied");
  expect(composers).toHaveBeenCalledWith({ agentId: "a1" });
  expect(c.prompt).toBe("Draft");
  expect(copied).toEqual(["Run the tests"]);
});

test("no composer for that session copies", async () => {
  expect(await applyMessageMove({ client: { composers: () => [] }, agentId: "a1", prompt: "x", tap: "fill" })).toBe("copied");
  expect(copied).toEqual(["x"]);
  expect(webFill).not.toHaveBeenCalled();
});

test("a 0.15 host (no composers) keeps the DOM path", async () => {
  webFill.mockResolvedValueOnce(true);
  expect(await applyMessageMove({ client: {}, agentId: "a1", prompt: "x", tap: "fill" })).toBe("filled");
  expect(webFill).toHaveBeenCalledWith("a1", "x");
  expect(copied).toEqual([]);
});

test("the copy setting never touches the composer", async () => {
  const c = composer("Draft");
  expect(await applyMessageMove({ client: { composers: () => [c] }, agentId: "a1", prompt: "x", tap: "copy" })).toBe("copied");
  expect(c.prompt).toBe("Draft");
});


test("a timeline move fills only the selected session through the native SDK", async () => {
  const selected = composer("Draft");
  const other = composer("Keep this");
  const composers = vi.fn((selector: PluginComposerSelector) => "agentId" in selector && selector.agentId === "selected" ? [selected] : [other]);
  expect(await applyMessageMove({ client: { composers }, agentId: "selected", prompt: "Run the tests", tap: "fill" })).toBe("filled");
  expect(composers).toHaveBeenCalledWith({ agentId: "selected" });
  expect(selected.prompt).toBe("Draft\n\nRun the tests");
  expect(selected.focus).toHaveBeenCalledWith({ selection: { start: 20, end: 20 } });
  expect(other.prompt).toBe("Keep this");
  expect(other.focus).not.toHaveBeenCalled();
  expect(copied).toEqual([]);
  expect(webFill).not.toHaveBeenCalled();
});
