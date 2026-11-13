import { expect, test, vi } from "vitest";
import { daemonRemoveAgent } from "./summarizer-remove";

const agent = () => {
  const archive = vi.fn(async () => ({}));
  return { id: "child-1", archive };
};

test("a finished summarizer session is hard-deleted and not archived", async () => {
  const deleted: string[] = [];
  let closed = 0;
  const a = agent();
  await daemonRemoveAgent(async () => ({ deleteAgent: async (id) => void deleted.push(id), close: async () => void closed++ }))(a);
  expect(deleted).toEqual(["child-1"]);
  expect(a.archive).not.toHaveBeenCalled();
  expect(closed).toBe(1);
});

test("when the delete fails the session is archived, the connection closed and the failure logged", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  let closed = 0;
  const a = agent();
  await daemonRemoveAgent(async () => ({
    deleteAgent: async () => {
      throw new Error("denied");
    },
    close: async () => void closed++,
  }))(a);
  expect(a.archive).toHaveBeenCalledTimes(1);
  expect(closed).toBe(1);
  expect(log).toHaveBeenCalled();
  log.mockRestore();
});

test("when no daemon connection can be made the session is archived and nothing throws", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const a = agent();
  await expect(daemonRemoveAgent(async () => Promise.reject(new Error("no daemon")))(a)).resolves.toBeUndefined();
  expect(a.archive).toHaveBeenCalledTimes(1);
  log.mockRestore();
});

test("a background session (Paseo 0.16) is archived through the SDK, without a daemon connection", async () => {
  const connect = vi.fn(async () => ({ deleteAgent: async () => undefined, close: async () => undefined }));
  const a = { ...agent(), current: () => ({ background: true }) };
  await daemonRemoveAgent(connect)(a);
  expect(a.archive).toHaveBeenCalledTimes(1);
  expect(connect).not.toHaveBeenCalled();
});

test("a background session whose archive fails is hard-deleted instead", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const deleted: string[] = [];
  const archive = vi.fn(async () => Promise.reject(new Error("busy")));
  await daemonRemoveAgent(async () => ({ deleteAgent: async (id) => void deleted.push(id), close: async () => undefined }))({ id: "child-1", archive, current: () => ({ background: true }) } as never);
  expect(deleted).toEqual(["child-1"]);
  log.mockRestore();
});
