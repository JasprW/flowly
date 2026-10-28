import { afterEach, expect, test } from "vitest";
import { readFile, readdir, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { PaseoApi } from "@getpaseo/client";
import { agentFixture } from "./agent-fixture";
import { BoardService } from "./service";
import { SummaryStore } from "./summaries";
import { MemoryError, MemoryService, memoryContext, memoryOn, memoryStore, setMemoryEverywhere } from "./memory";
import type { SummarySettings } from "../shared/summary";
import type { MemoryEntry } from "../shared/memory";
import { BackgroundWorkspaces } from "./background-workspace";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});

type Created = { workspaceId: string; labels: Record<string, string>; prompt: string; config?: { provider: string } };
async function setup() {
  const f = await agentFixture();
  roots.push(f.root);
  const settings: SummarySettings = { summaryEnabled: true, summaryModel: "claude/claude-haiku-5-5", digestEnabled: true, retroEnabled: true };
  const summaries = new SummaryStore(f.store.directory);
  // The review session is hard-deleted over the local daemon in production; the test records who was removed.
  const removed: string[] = [];
  const memory = new MemoryService(f.store, summaries, async () => settings, async () => "en", async () => undefined, () => Date.now(), 0, 1000, async (agent) => {
    removed.push(agent.id);
  }, new BackgroundWorkspaces(f.store.directory, async () => "live"));
  f.service.memory = memory;
  const created: Created[] = [];
  const replies: (string | Error)[] = [];
  let archived = 0;
  let wsArchived = 0;
  const model = {
    providers: {
      listAvailable: async () => ({ providers: [{ provider: "claude", available: true }] }),
      listModels: async () => ({ models: [{ id: "claude-haiku-5-5" }, { id: "claude-sonnet-5-5" }], error: null }),
    },
    workspaces: {
      create: async () => ({ id: "bg-ws" }),
      archive: async () => {
        wsArchived++;
        return {};
      },
      ref: (workspaceId: string) => ({
        agents: {
          create: async (o: { labels: Record<string, string>; prompt: string }) => {
            created.push({ workspaceId, ...o });
            const reply = replies.shift();
            return {
              id: `review-${created.length}`,
              waitForFinish: async () => {
                if (reply instanceof Error) throw reply;
                return { status: "idle", error: null, lastMessage: reply ?? '{"candidates": []}' };
              },
              archive: async () => {
                archived++;
                return {};
              },
            };
          },
        },
      }),
    },
  } as unknown as PaseoApi;
  const remember = async (extra: Record<string, unknown> = {}) => {
    const ctx = await f.service.get(f.identity);
    return f.service.write(f.identity, "remember", {
      expectedRevision: ctx.revision,
      request: ctx.request,
      kind: "decision",
      title: "Do not pin a Paseo upper bound",
      body: "The user confirmed there is no real upper limit.",
      tags: ["release"],
      keywords: ["版本上限", "peer range"],
      ...extra,
    });
  };
  const entries = async () => (await memory.store.read()).entries;
  return { ...f, memory, summaries, settings, model, created, replies, archived: () => archived, wsArchived: () => wsArchived, removed, remember, entries };
}
type Fixture = Awaited<ReturnType<typeof setup>>;
const one = async (x: Fixture) => (await x.entries())[0];

/** A second card with its own workspace, created after A's memory was confirmed. */
async function addCardB(x: Fixture, title = "Card B") {
  const stamp = new Date().toISOString();
  await x.store.mutate((board) => {
    board.tasks.push({ ...board.tasks[0], id: "b", workspaceId: "wb", title, description: "", revision: 1, operationId: "create-b", createdAt: stamp, updatedAt: stamp });
  });
}

test("flowly_remember stores a candidate with a card event and receipt, without touching the card", async () => {
  const x = await setup();
  const before = (await x.store.read()).tasks[0];
  const result = await x.remember();
  const board = await x.store.read();
  expect(board.tasks[0]).toEqual(before);
  expect(board.events.at(-1)).toMatchObject({ action: "memory_proposed", actor: "agent", note: "Do not pin a Paseo upper bound" });
  expect(result.receipt).toMatchObject({ action: "remember", taskRevision: 1 });
  const e = await one(x);
  expect(result.memoryId).toBe(e.id);
  expect(e).toMatchObject({ status: "candidate", kind: "decision", projectId: "p", tags: ["release"], source: { by: "agent", taskId: "t", agentId: "actor", eventId: board.events.at(-1)!.id } });
  expect(result.current?.memory?.candidates).toEqual([{ id: e.id, title: e.title, status: "candidate" }]);
  // A candidate is never injected.
  expect(result.current?.memory?.entries).toEqual([]);
});

test("a replay of the same request returns the same candidate; the same event never stores twice", async () => {
  const x = await setup();
  const ctx = await x.service.get(x.identity);
  const input = { expectedRevision: ctx.revision, request: ctx.request, kind: "pitfall", title: "Two modals in one frame freeze Paseo", body: "Open the second after the first closed." };
  const first = await x.service.write(x.identity, "remember", input);
  const again = await x.service.write(x.identity, "remember", input);
  expect(again.replayed).toBe(true);
  expect(again.memoryId).toBe(first.memoryId);
  expect((await x.entries()).length).toBe(1);
  const e = await one(x);
  const same = await x.memory.propose({ projectId: "p", taskId: "t", eventId: e.source.eventId, by: "agent", kind: "pitfall", title: "other", body: "", tags: [], keywords: [] });
  expect(same.id).toBe(e.id);
});

test("refusals: duplicate title, secrets, a full card, memory off, an unknown supersedes", async () => {
  const x = await setup();
  await x.remember();
  await expect(x.remember({ title: "  do not pin a PASEO upper bound " })).rejects.toMatchObject({ code: "MEMORY_DUPLICATE" });
  await expect(x.remember({ title: "Publishing", body: "token npm_" + "t438cQg15C1LvYZFBfjwhHilAzSKAl1UuTLQ" })).rejects.toMatchObject({ code: "MEMORY_SECRET" });
  await expect(x.remember({ title: "Bad", supersedes: "nope" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  for (let i = 0; i < 4; i++) await x.remember({ title: `Lesson ${i}` });
  await expect(x.remember({ title: "Sixth" })).rejects.toMatchObject({ code: "MEMORY_LIMIT" });
  await x.store.mutate((board) => {
    board.projects[0].memory = false;
    board.projects[0].revision++;
  });
  await expect(x.remember({ title: "Off" })).rejects.toMatchObject({ code: "MEMORY_DISABLED" });
  // Refusals leave no receipt and no event.
  const board = await x.store.read();
  expect(board.agentReceipts.filter((r) => r.action === "remember").length).toBe(5);
});

test("a decision confirmed on card A is in the first instructions of a card B created later", async () => {
  const x = await setup();
  await x.remember();
  const candidate = await one(x);
  // Not before it is confirmed.
  await addCardB(x);
  expect((await new BoardService(x.store).context("b", x.paseo)).context).not.toContain("Do not pin a Paseo upper bound");
  await x.memory.confirm({ id: candidate.id, revision: candidate.revision, edits: { body: "No real upper limit exists (user, 2026-10-19)." } });
  const ctx = await new BoardService(x.store).context("b", x.paseo);
  expect(ctx.context).toContain("Project memory (all 1 entries):");
  expect(ctx.context).toContain(`- [Decision] Do not pin a Paseo upper bound: No real upper limit exists (user, 2026-10-19). (memory ${candidate.id.slice(0, 8)}, from "Card")`);
  expect(ctx.context.indexOf("Project memory")).toBeLessThan(ctx.context.indexOf("Project: Project"));
  expect(ctx.memoryIds).toEqual([candidate.id]);
  // Session creation counts it as used by B.
  await x.memory.markUsed(ctx.memoryIds, "b");
  expect((await one(x)).usedBy).toEqual([{ taskId: "b", at: expect.any(String) }]);
  // Turned off for the project: nothing is injected.
  await x.store.mutate((board) => {
    board.projects[0].memory = false;
  });
  expect((await new BoardService(x.store).context("b", x.paseo)).context).not.toContain("Project memory");
});

test("an edit in the UI reaches later sessions; a delete removes it and keeps a backup", async () => {
  const x = await setup();
  const e = await x.memory.create({ projectId: "p", kind: "convention", title: "MR descriptions follow the template", body: "", tags: [], keywords: [], pinned: false });
  const edited = await x.memory.update({ id: e.id, revision: e.revision, title: "MR descriptions use the team template" });
  expect(edited.revision).toBe(2);
  const board = await x.store.read();
  const lines = await memoryContext(x.store.directory, board.tasks[0], board.projects[0], board);
  expect(lines.lines.join("\n")).toContain("MR descriptions use the team template");
  await x.memory.remove({ id: edited.id, revision: edited.revision });
  expect(await x.entries()).toEqual([]);
  expect((await memoryContext(x.store.directory, board.tasks[0], board.projects[0], board)).lines).toEqual([]);
  expect((await readdir(join(x.store.directory, "removed"))).some((n) => n.startsWith(`memory-${e.id}`))).toBe(true);
});

test("a stale revision is refused and changes nothing", async () => {
  const x = await setup();
  const e = await x.memory.create({ projectId: "p", kind: "pitfall", title: "Hermes loop binding", body: "", tags: [], keywords: [], pinned: false });
  await x.memory.update({ id: e.id, revision: 1, body: "first" });
  await expect(x.memory.update({ id: e.id, revision: 1, body: "second" })).rejects.toMatchObject({ code: "MEMORY_CONFLICT" });
  await expect(x.memory.remove({ id: e.id, revision: 1 })).rejects.toMatchObject({ code: "MEMORY_CONFLICT" });
  expect((await one(x)).body).toBe("first");
});

test("confirming a replacement archives the old entry in the same write", async () => {
  const x = await setup();
  const old = await x.memory.create({ projectId: "p", kind: "decision", title: "Summaries every turn", body: "", tags: [], keywords: [], pinned: false });
  await x.remember({ title: "Summaries every completed turn", supersedes: old.id });
  const next = (await x.entries()).find((e) => e.status === "candidate")!;
  await x.memory.confirm({ id: next.id, revision: next.revision });
  const all = await x.entries();
  expect(all.find((e) => e.id === old.id)).toMatchObject({ status: "archived", archivedReason: "superseded" });
  expect(all.find((e) => e.id === next.id)).toMatchObject({ status: "active" });
});

test("a full project never evicts on its own: confirming asks for room; pins are capped", async () => {
  const x = await setup();
  const stamp = new Date().toISOString();
  await x.memory.store.update((state) => {
    for (let i = 0; i < 200; i++)
      state.entries.push({ id: `a${i}`, projectId: "p", kind: "pitfall", title: `Active ${i}`, body: "", tags: [], keywords: [], pinned: i < 5, status: "active", source: { by: "human" }, revision: 1, createdAt: stamp, updatedAt: stamp, confirmedAt: stamp } as MemoryEntry);
    return { value: undefined, changed: true };
  });
  await x.remember({ title: "One more" });
  const c = (await x.entries()).find((e) => e.status === "candidate")!;
  await expect(x.memory.confirm({ id: c.id, revision: c.revision })).rejects.toMatchObject({ code: "MEMORY_FULL" });
  expect((await x.entries()).filter((e) => e.status === "active").length).toBe(200);
  const unpinned = (await x.entries()).find((e) => e.id === "a10")!;
  await expect(x.memory.update({ id: unpinned.id, revision: 1, pinned: true })).rejects.toThrow("at most 5");
  await x.memory.archive({ id: unpinned.id, revision: 1, reason: "retired" });
  await x.memory.confirm({ id: c.id, revision: c.revision });
  expect((await x.entries()).find((e) => e.id === c.id)!.status).toBe("active");
});

test("deleting a card drops its candidates and clues but keeps confirmed memory; removing a project drops all", async () => {
  const x = await setup();
  await x.remember({ title: "Kept" });
  await x.remember({ title: "Dropped" });
  const kept = (await x.entries()).find((e) => e.title === "Kept")!;
  await x.memory.confirm({ id: kept.id, revision: kept.revision });
  await x.memory.removeTask("t");
  expect((await x.entries()).map((e) => e.title)).toEqual(["Kept"]);
  await x.memory.removeProject("p", new Set(["t"]));
  expect(await x.entries()).toEqual([]);
  const removed = await readdir(join(x.store.directory, "removed"));
  expect(removed.some((n) => n.startsWith("task-t-memory"))).toBe(true);
  expect(removed.some((n) => n.startsWith("p-memory"))).toBe(true);
});

test("clues: the user's own words are kept as answer, feedback or message; picks and short replies are not", async () => {
  const x = await setup();
  const turn = async (text: string, before: (board: Awaited<ReturnType<typeof x.store.read>>) => void = () => undefined) => {
    await x.store.mutate((board) => {
      before(board);
      x.store.event(board, { taskId: "t", agentId: "actor", actor: "system", action: "agent.turn_started" });
    });
    await x.memory.recordTurn(x.identity, [{ type: "user_message", text }], await x.store.read());
  };
  await turn("Use option B because A breaks the phone layout", (board) =>
    x.store.event(board, { taskId: "t", agentId: "actor", actor: "agent", action: "progress_reported", reportKind: "question", note: "A or B?" }),
  );
  await turn("The PR description must follow the template", (board) =>
    x.store.event(board, { taskId: "t", agentId: "actor", actor: "agent", action: "status_changed", from: "development", to: "in_review", note: "done" }),
  );
  await turn("ok");
  await turn("Commit only this card's hunks and push", (board) =>
    x.store.event(board, { taskId: "t", agentId: "actor", actor: "agent", action: "next_moves_suggested", moves: [{ label: "Commit", prompt: "Commit only this card's hunks and push" }] }),
  );
  // Rule A1 moved the card back to Development when that feedback turn started.
  await turn("Please keep screenshots out of the README for now", (board) =>
    x.store.event(board, { taskId: "t", agentId: "actor", actor: "system", action: "status_changed", from: "in_review", to: "development", rule: "A1" }),
  );
  const clues = (await x.memory.store.read()).clues;
  expect(clues.map((c) => [c.kind, c.text, c.ask])).toEqual([
    ["answer", "Use option B because A breaks the phone layout", "A or B?"],
    ["feedback", "The PR description must follow the template", undefined],
    ["message", "Please keep screenshots out of the README for now", undefined],
  ]);
  await x.store.mutate((board) => {
    board.projects[0].memory = false;
  });
  await turn("Nothing is recorded while memory is off");
  expect((await x.memory.store.read()).clues.length).toBe(3);
});

test("native question answers become answer clues once; the Codex answers message is not also a plain message", async () => {
  const x = await setup();
  const ask = {
    type: "tool_call",
    callId: "toolu_1",
    name: "AskUserQuestion",
    status: "completed",
    detail: { input: { questions: [{ question: "Which alphabet?", header: "Alphabet", options: [] }] }, output: { output: 'Your questions have been answered: "Which alphabet?"="base62".' } },
  };
  await x.store.mutate((board) => x.store.event(board, { taskId: "t", agentId: "actor", actor: "system", action: "agent.turn_started" }));
  const turn = [{ type: "user_message", text: "Pick the short-code format for the API" }, ask];
  await x.memory.recordTurn(x.identity, turn, await x.store.read());
  // The same turn seen twice (a replayed hook) adds nothing new.
  await x.memory.recordTurn(x.identity, [ask], await x.store.read());
  await x.memory.recordTurn(x.identity, [{ type: "user_message", text: "Answers to your questions:\n\nHow long?\n7 characters" }], await x.store.read());
  const clues = (await x.memory.store.read()).clues;
  expect(clues.map((c) => [c.kind, c.ask, c.text])).toEqual([
    ["answer", "Which alphabet?", "base62"],
    ["message", undefined, "Pick the short-code format for the API"],
    ["answer", "How long?", "7 characters"],
  ]);
});

test("the finished-card review stores at most one general candidate with evidence, hard-deletes its session, and does not rerun without new material", async () => {
  const x = await setup();
  x.memory.attach(x.model);
  await x.summaries.update((state) => {
    state.entries.push({ id: "s1", taskId: "t", at: new Date().toISOString(), model: "m", agentIds: [], state: "Done", target: "Goal", recap: "- Root cause: two modals in one frame", next: "-" });
    return { value: undefined, changed: true };
  });
  x.replies.push(
    JSON.stringify({
      candidates: [
        { kind: "decision", title: "The drawer's new section sits below Ideas", body: "", tags: [], keywords: [], evidence: "", reuse: "" },
        { kind: "pitfall", title: "Two modals in one frame freeze Paseo", body: "Close one first.", tags: ["ui-polish"], keywords: ["dialog"], evidence: "Root cause: two modals in one frame", reuse: "any card that opens a dialog from another" },
        { kind: "pitfall", title: "Second general lesson", body: "", tags: [], keywords: [], evidence: "", reuse: "any card" },
      ],
    }),
  );
  await x.store.mutate((board) => {
    board.tasks[0].status = "done";
  });
  // The project root's instruction files go into the review; a CLAUDE.md repeating AGENTS.md counts once.
  await mkdir(x.a, { recursive: true });
  await writeFile(join(x.a, "AGENTS.md"), "- Screenshots must not show the host sidebar.\n");
  await writeFile(join(x.a, "CLAUDE.md"), "- Screenshots must not show the host sidebar.\n");
  await x.memory.manual("t", x.model);
  await new Promise((r) => setTimeout(r, 50));
  expect(x.created).toHaveLength(1);
  expect(x.created[0].prompt).toContain("## AGENTS.md\n- Screenshots must not show the host sidebar.");
  expect(x.created[0].prompt).not.toContain("## CLAUDE.md");
  expect(x.created[0]).toMatchObject({ workspaceId: "bg-ws", labels: { flowly: "summarizer", "flowly-memory": "retro", "flowly-task": "t" } });
  expect(x.created[0].prompt).toContain("Root cause: two modals in one frame");
  expect(x.removed).toEqual(["review-1"]);
  expect(x.archived()).toBe(0);
  // The background workspace is archived once the review is done.
  expect(x.wsArchived()).toBe(1);
  const list = await x.entries();
  expect(list.map((e) => [e.title, e.source.by, e.evidence])).toEqual([["Two modals in one frame freeze Paseo", "retro", "Root cause: two modals in one frame"]]);
  expect((await x.memory.store.read()).errors).toEqual([]);
  expect((await x.store.read()).events.at(-1)).toMatchObject({ action: "memory_proposed", actor: "system" });
  // An automatic run with the same summary and no new clues is skipped.
  x.memory.afterDone("t", x.model);
  await new Promise((r) => setTimeout(r, 50));
  expect(x.created).toHaveLength(1);
});

test("a failed review records the error and still hard-deletes the session", async () => {
  const x = await setup();
  x.memory.attach(x.model);
  x.replies.push("I cannot do that.");
  await x.store.mutate((board) => {
    board.tasks[0].status = "done";
    board.workpads[0].confusions.push({ id: "c", text: "Unclear which window to test", at: new Date().toISOString() } as never);
  });
  await x.memory.manual("t", x.model);
  await new Promise((r) => setTimeout(r, 50));
  expect(x.removed).toEqual(["review-1"]);
  expect(x.archived()).toBe(0);
  expect((await x.memory.store.read()).errors).toEqual([expect.objectContaining({ taskId: "t", message: expect.stringContaining("The review model returned no JSON.") })]);
  await expect(x.memory.manual("nope", x.model)).rejects.toThrow("Task not found.");
});

test("invalid memory data is preserved, not reset", async () => {
  const x = await setup();
  await mkdir(x.store.directory, { recursive: true });
  await writeFile(join(x.store.directory, "memory.json"), "{ broken");
  await expect(memoryStore(x.store.directory).read()).rejects.toThrow("preserved");
  expect(await readFile(join(x.store.directory, "memory.json"), "utf8")).toBe("{ broken");
  // A session still starts: unreadable memory adds nothing.
  const board = await x.store.read();
  expect((await memoryContext(x.store.directory, board.tasks[0], board.projects[0], board)).lines).toEqual([]);
  expect(new MemoryError("MEMORY_FULL", "x").code).toBe("MEMORY_FULL");
});

test("the Settings switch turns memory off in every project; on, each project's own switch decides (ONBOARDING-SETUP-SPEC §6)", () => {
  try {
    expect(memoryOn({})).toBe(true);
    expect(memoryOn({ memory: false })).toBe(false);
    setMemoryEverywhere(false);
    expect(memoryOn({})).toBe(false);
    expect(memoryOn({ memory: true })).toBe(false);
  } finally {
    setMemoryEverywhere(true);
  }
  expect(memoryOn({ memory: true })).toBe(true);
});

test("finished-card review tries the ordered summary list and cleans both children", async () => {
  const x = await setup();
  x.settings.summaryModels = ["claude/claude-sonnet-5-5", "claude/claude-haiku-5-5"];
  x.memory.attach(x.model);
  await x.store.mutate((board) => {
    board.tasks[0].status = "done";
    board.workpads[0].confusions.push({ id: "c", text: "Unclear model selection", at: new Date().toISOString() } as never);
  });
  x.replies.push("quota limit", '{"candidates": []}');
  await x.memory.manual("t", x.model);
  await new Promise((r) => setTimeout(r, 50));
  expect(x.created.map((a) => a.config?.provider)).toEqual(["claude/claude-sonnet-5-5", "claude/claude-haiku-5-5"]);
  expect(x.removed).toEqual(["review-1", "review-2"]);
  expect((await x.memory.store.read()).errors).toEqual([]);
});
