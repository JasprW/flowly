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
