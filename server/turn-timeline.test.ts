import { expect, test, vi } from "vitest";
import type { PaseoApi } from "@getpaseo/client";
import { turnTimeline } from "./turn-timeline";

vi.mock("./error-report", () => ({ logFailure: vi.fn() }));

const paseoWith = (refetch: (...args: unknown[]) => unknown) =>
  ({ agents: { ref: () => ({ timeline: { refetch } }) } }) as unknown as PaseoApi;

test("a hook that carries the turn is used as it is, with no read", async () => {
  const refetch = vi.fn();
  const hook = [{ type: "assistant_message" }];
  expect(await turnTimeline(paseoWith(refetch), "a", hook)).toBe(hook);
  expect(refetch).not.toHaveBeenCalled();
});

test("an empty hook (Paseo 0.13) is replaced by the last turn of the newest page", async () => {
  const refetch = vi.fn(async () => ({
    entries: [
      { item: { type: "user_message", text: "old" } },
      { item: { type: "assistant_message", text: "old reply" } },
      { item: { type: "user_message", text: "new" } },
      { item: { type: "tool_call", name: "Bash" } },
      { item: { type: "assistant_message", text: "new reply" } },
    ],
  }));
  const turn = await turnTimeline<{ type: string }>(paseoWith(refetch), "agent-1", []);
  expect(turn.map((i) => i.type)).toEqual(["user_message", "tool_call", "assistant_message"]);
  expect(refetch).toHaveBeenCalledWith({ direction: "tail", limit: 200, projection: "projected" });
});

test("a failed read leaves the empty hook value", async () => {
  const turn = await turnTimeline<{ type: string }>(paseoWith(async () => { throw new Error("gone"); }), "a", []);
  expect(turn).toEqual([]);
});
