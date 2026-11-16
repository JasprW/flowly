import { expect, test } from "vitest";
import { restoredTask } from "./task-draft";
import type { Project } from "../shared/model";

const project = { id: "p" } as unknown as Project;

test("a New task draft restores text, choices, agent and its operation id", () => {
  const externals = [{ provider: "github", item: { key: "o/r#1", connectionId: "c1", summary: "Bug" } }];
  const r = restoredTask(
    {
      title: "Half",
      description: "desc",
      status: "development",
      priority: "high",
      type: "bugfix",
      tags: ["ui"],
      mode: "worktree",
      branchName: "b",
      baseRef: "main",
      startAgent: false,
      provider: "claude",
      model: "m",
      agentMode: "plan",
      thinking: "high",
      prompt: "do it",
      externals: JSON.stringify(externals),
      operationId: "card-123-abc",
    },
    project,
    "todo",
  );
  expect(r).toMatchObject({
    title: "Half",
    description: "desc",
    status: "development",
    priority: "high",
    type: "bugfix",
    tags: ["ui"],
    mode: "worktree",
    branchName: "b",
    baseRef: "main",
    startAgent: false,
    agent: { provider: "claude", model: "m", mode: "plan", thinking: "high" },
    prompt: "do it",
    operationId: "card-123-abc",
  });
  expect(r.externals).toEqual(externals);
});

test("no draft restores nothing; unexpected values are ignored", () => {
  expect(restoredTask(undefined, project, "todo")).toMatchObject({ title: undefined, agent: null, externals: [], operationId: undefined, startAgent: undefined });
  const r = restoredTask(
    { status: "done", priority: "extreme", type: "epic", mode: "elsewhere", startAgent: "yes", externals: "{broken", operationId: "x; rm -rf" },
    project,
    "todo",
  );
  expect(r).toMatchObject({ status: undefined, priority: undefined, type: undefined, mode: undefined, startAgent: undefined, externals: [], operationId: undefined });
  // A finished lane is kept only when the form was opened from that lane.
  expect(restoredTask({ status: "done" }, project, "done").status).toBe("done");
});
