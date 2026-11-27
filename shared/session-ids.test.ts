import { describe, expect, it } from "vitest";
import { providerSessionId } from "./session-ids";

describe("providerSessionId", () => {
  it("returns the persistence session id when it differs from the agent id", () => {
    expect(providerSessionId({ id: "a1", persistence: { sessionId: "s1" } })).toBe("s1");
  });
  it("falls back to runtime info", () => {
    expect(providerSessionId({ id: "a1", persistence: null, runtimeInfo: { sessionId: "s2" } })).toBe("s2");
  });
  it("gives nothing when missing or equal to the agent id", () => {
    expect(providerSessionId({ id: "a1" })).toBe("");
    expect(providerSessionId({ id: "a1", persistence: { sessionId: "a1" } })).toBe("");
    expect(providerSessionId({ id: "a1", persistence: { sessionId: "  " }, runtimeInfo: { sessionId: null } })).toBe("");
  });
  it("unwraps a plugin provider handle", () => {
    const sessionId = 'plugin:{"version":1,"data":{"sessionId":"session-9"}}';
    expect(providerSessionId({ id: "a1", persistence: { sessionId } })).toBe("session-9");
  });
  it("gives nothing for a plugin handle without an inner id or with bad JSON", () => {
    expect(providerSessionId({ id: "a1", persistence: { sessionId: 'plugin:{"version":1,"data":{}}' } })).toBe("");
    expect(providerSessionId({ id: "a1", persistence: { sessionId: "plugin:{oops" } })).toBe("");
  });
});
