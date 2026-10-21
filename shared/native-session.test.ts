import { expect, test } from "vitest";
import { summaryRow, summaryRowKind } from "./native-session";

// Paseo rejects any other kind or id at registration, and a throw in contribute() stops the whole client plugin.
const hostId = /^[a-z][a-z0-9-]*$/;

test("the summary row's kind and id follow Paseo's id rule", () => {
  expect(summaryRowKind).toMatch(hostId);
  const row = summaryRow(
    { id: "6f1c2d3e-0000-4000-8000-000000000001", taskId: "t", at: "2026-10-20T00:00:00.000Z", model: "m", agentIds: ["a"], state: "s", target: "", recap: "", next: "" },
    "w",
  );
  expect(row.kind).toMatch(hostId);
  expect(row.id).toMatch(hostId);
});

test("the Next moves card row: kind and id follow Paseo's id rule; ready, past and dismissed shapes parse", async () => {
  const { nextRowKind, nextRowId, nextRowSchema } = await import("./native-session");
  expect(nextRowKind).toMatch(hostId);
  expect(nextRowId("6f1c2d3e-0000-4000-8000-000000000001")).toMatch(hostId);
  expect(nextRowSchema.safeParse({ status: "ready", taskId: "t", workspaceId: "w", eventId: "e", moves: [{ label: "Verify", prompt: "Verify it" }, { label: "Done", moveTo: "done" }] }).success).toBe(true);
  expect(nextRowSchema.safeParse({ status: "dismissed" }).success).toBe(true);
  expect(nextRowSchema.safeParse({ status: "past", eventId: "e", moves: [{ label: "Verify", prompt: "Verify it" }] }).success).toBe(true);
  expect(nextRowSchema.safeParse({ status: "past", eventId: "e", moves: [] }).success).toBe(false);
  expect(nextRowSchema.safeParse({ status: "ready", taskId: "t", workspaceId: "w", eventId: "e", moves: [] }).success).toBe(false);
});
