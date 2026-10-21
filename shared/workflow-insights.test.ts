import { describe, expect, test } from "vitest";
import {
  MATERIAL_LIMIT,
  MAX_FINDINGS,
  aggregate,
  replaceOpen,
  buildMaterial,
  classify,
  fingerprint,
  isDue,
  laneAt,
  nextRunAt,
  parseWorkflowOutput,
  projectScriptsFrom,
  quiet,
  redact,
  shellRecord,
  similarFinding,
  splitChain,
  titleSimilarity,
  trimState,
  validateFindings,
  windowDays,
  workflowSettingsValues,
  type CommandRecord,
  type Finding,
  type RawFinding,
  type WorkflowState,
} from "./workflow-insights";

const ctx = { repo: "/Users/me/code/app", home: "/Users/me" };
const scripts = new Set(["typecheck", "test"]);
const key = (segment: string) => {
  const r = classify(segment, ctx, scripts);
  return r.kind === "action" ? r.key : r.kind;
};

describe("splitting and classifying", () => {
  test("splits at top-level separators, keeps quotes, $( ) and heredocs whole", () => {
    expect(splitChain("cd /x && npm test; git status | head -3")).toEqual(["cd /x", "npm test", "git status", "head -3"]);
    expect(splitChain(`echo "a && b; c" && ls`)).toEqual([`echo "a && b; c"`, "ls"]);
    expect(splitChain("x=$(git rev-parse HEAD) && echo $x")).toEqual(["x=$(git rev-parse HEAD)", "echo $x"]);
    expect(splitChain("python3 - <<'PY'\nimport os; print(1)\nfor a in b: pass\nPY\nnpm test")).toEqual(["python3 - <heredoc>", "npm test"]);
  });
  test("skips cd, env assignments and shell syntax left by the split", () => {
    for (const s of ["cd /x", "FOO=1", "}", "break", "esac", "-d)", "cli(){ node", "$T", "umask 077"]) expect(key(s)).toBe("skip");
  });
  test("exploration is counted, not keyed; git read commands explore", () => {
    expect(key("grep -n foo src/a.ts")).toBe("explore");
    expect(key("git diff --stat")).toBe("explore");
    expect(key("git -c user.name=X log -3")).toBe("explore");
    expect(classify("sed -n 1,20p client/board.tsx", ctx)).toEqual({ kind: "explore", files: ["client/board.tsx"] });
  });
  test("normalizes runners; npx tsc folds into the project's typecheck script only when it exists", () => {
    expect(key("npm run typecheck")).toBe("npm run typecheck");
    expect(key("npm test -- foo.test.ts")).toBe("npm test");
    expect(key("npx tsc --noEmit -p .")).toBe("npm run typecheck");
    expect(classify("npx tsc --noEmit", ctx, new Set())).toEqual({ kind: "action", key: "npx tsc" });
    expect(key("npx vitest run shared/i18n.test.ts")).toBe("npm test");
    expect(key("git -c user.name=JasprW commit -m x")).toBe("git commit");
    expect(key("FOO=1 sudo npm i")).toBe("npm install");
    expect(key("python3 - <heredoc>")).toBe("python3 <inline>");
    expect(key("node -e 'console.log(1)'")).toBe("node <inline>");
    expect(key("node /tmp/probe.mjs")).toBe("node <tmp-script>");
    expect(key("node docs/promo/shots.mjs")).toBe("node docs/promo/shots.mjs");
    expect(key("paseo plugin reload flowly")).toBe("paseo plugin reload flowly");
    expect(key("paseo logs 132ad340 --tail 2")).toBe("paseo logs <id>");
    expect(key("/usr/local/bin/make release VERSION=1")).toBe("make release");
  });
});

describe("redaction", () => {
  test("drops secrets, credentials, e-mails and personal paths", () => {
    const out = redact(
      "curl -H 'Authorization: Bearer abc.def' https://u:p@host/x GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuv OPENAI_API_KEY='sk-zzzzzzzzzzzzzzzzzzzz' me@shopee.com /Users/me/code/app/src /Users/me/.paseo /tmp/x.mjs eyJhbGciOiJIUzI1NiJ9.payloadpart.sig " + "A".repeat(43),
      ctx,
    );
    expect(out).not.toMatch(/abc\.def|u:p@|ghp_|sk-z|shopee|eyJhbG|AAAAAAAAAA/);
    expect(out).toContain("Authorization: Bearer <secret>");
    expect(out).toContain("https://<cred>@host/x");
    expect(out).toContain("GITHUB_TOKEN=<v>");
    expect(out).toContain("<email>");
    expect(out).toContain("./src");
    expect(out).toContain("~/.paseo");
    expect(out).toContain("<tmp>");
  });
  test("long paths stay readable", () => {
    expect(redact("node node_modules/@getpaseo/client/dist/daemon-client/internal/connection/x.mjs", ctx)).toBe("node node_modules/@getpaseo/client/dist/daemon-client/internal/connection/x.mjs");
  });
});

describe("records", () => {
  const meta = { taskId: "task-1", agentId: "agent-1", lane: "development", provider: "claude", at: "2026-10-19T08:00:00.000Z" };
  const call = (command: string, status = "completed", callId: unknown = "c1") => ({ type: "tool_call", callId, status, detail: { type: "shell", command } });
  test("finished shell calls become records with keys, explore count and files", () => {
    const r = shellRecord(call("cd /x && npm run typecheck && grep -n a client/a.tsx && npm test"), meta, ctx, scripts)!;
    expect(r).toMatchObject({ id: "agent-1:c1", actions: ["npm run typecheck", "npm test"], explore: 1, files: ["client/a.tsx"], status: "completed" });
    expect(r.inline).toBeUndefined();
    expect(r.failed).toBeUndefined();
  });
  test("running calls, other tools and calls without id are ignored", () => {
    expect(shellRecord(call("npm test", "running"), meta, ctx, scripts)).toBeNull();
    expect(shellRecord({ type: "tool_call", callId: "c", status: "completed", detail: { type: "read", filePath: "a" } }, meta, ctx, scripts)).toBeNull();
    expect(shellRecord(call("npm test", "completed", ""), meta, ctx, scripts)).toBeNull();
  });
  test("inline scripts keep a redacted excerpt; failed calls keep a short command", () => {
    const r = shellRecord(call(`python3 - <<'PY'\nopen('/Users/me/code/app/x.ts').write('token=ghp_abcdefghijklmnopqrstuv')\n${"y = 1\n".repeat(200)}PY`, "failed"), meta, ctx, scripts)!;
    expect(r.inline).toContain("./x.ts");
    expect(r.inline).not.toContain("ghp_");
    expect(r.inline!.length).toBeLessThanOrEqual(562);
    expect(r.failed!.length).toBeLessThanOrEqual(262);
  });
  test("the lane at the time of the command is replayed from status changes", () => {
    const changes = [
      { at: "2026-10-18T10:00:00.000Z", from: "todo", to: "design" },
      { at: "2026-10-18T12:00:00.000Z", from: "design", to: "development" },
    ];
    expect(laneAt(changes, Date.parse("2026-10-18T09:00:00.000Z"), "done")).toBe("todo");
    expect(laneAt(changes, Date.parse("2026-10-18T11:00:00.000Z"), "done")).toBe("design");
    expect(laneAt(changes, Date.parse("2026-10-19T11:00:00.000Z"), "done")).toBe("development");
    expect(laneAt([], 0, "done")).toBe("done");
  });
});

describe("scheduling", () => {
  const at = (iso: string) => Date.parse(iso);
  test("due after the run hour and once the interval has passed, by local calendar days", () => {
    const base = { tz: "Asia/Singapore", runHour: 9, intervalDays: 7 };
    // 08:30 local: before the run hour.
    expect(isDue({ ...base, now: at("2026-10-19T00:30:00.000Z"), lastRunAt: null })).toBe(false);
    expect(isDue({ ...base, now: at("2026-10-19T01:30:00.000Z"), lastRunAt: null })).toBe(true);
    expect(isDue({ ...base, now: at("2026-10-25T01:30:00.000Z"), lastRunAt: "2026-10-19T01:30:00.000Z" })).toBe(false);
    expect(isDue({ ...base, now: at("2026-10-26T01:30:00.000Z"), lastRunAt: "2026-10-19T01:30:00.000Z" })).toBe(true);
    // Missed runs collapse: a month later it is due once, then not again the same day.
    expect(isDue({ ...base, now: at("2026-11-30T03:00:00.000Z"), lastRunAt: "2026-10-19T01:30:00.000Z" })).toBe(true);
    expect(isDue({ ...base, now: at("2026-11-30T05:00:00.000Z"), lastRunAt: "2026-11-30T03:00:00.000Z" })).toBe(false);
  });
  test("daily runs at most once per local day", () => {
    const base = { tz: "UTC", runHour: 0, intervalDays: 1 };
    expect(isDue({ ...base, now: at("2026-10-19T23:00:00.000Z"), lastRunAt: "2026-10-19T00:10:00.000Z" })).toBe(false);
    expect(isDue({ ...base, now: at("2026-10-20T00:05:00.000Z"), lastRunAt: "2026-10-19T00:10:00.000Z" })).toBe(true);
  });
  test("the next run is the first due hour", () => {
    const next = nextRunAt({ now: at("2026-10-19T05:20:00.000Z"), tz: "UTC", runHour: 9, intervalDays: 3, lastRunAt: "2026-10-18T09:00:00.000Z" });
    expect(new Date(next).toISOString()).toBe("2026-10-21T09:00:00.000Z");
  });
  test("the window is at least a week and at most two", () => {
    expect([1, 3, 7, 14].map(windowDays)).toEqual([7, 7, 7, 14]);
  });
});

const rec = (over: Partial<CommandRecord> & { id: string }): CommandRecord => ({
  at: "2026-10-19T08:00:00.000Z",
  taskId: "t1",
  agentId: "a1",
  lane: "development",
  provider: "claude",
  status: "completed",
  actions: [],
  explore: 0,
  ...over,
});

describe("aggregation and material", () => {
  test("quiet below 50 new actions, or below 2 cards unless 200 new actions", () => {
    const actions = (n: number) => Array.from({ length: n }, (_, i) => rec({ id: String(i), actions: ["npm test"] }));
    expect(quiet(actions(50), 3)).toBe(false);
    expect(quiet(actions(49), 3)).toBe(true);
    // Two cards are enough now (Agent SMITH: 990 actions on 2 cards was skipped forever).
    expect(quiet(actions(50), 2)).toBe(false);
    expect(quiet(actions(199), 1)).toBe(true);
    expect(quiet(actions(200), 1)).toBe(false);
  });
  test("sequences count once per session; inline samples alternate between cards", () => {
    const records: CommandRecord[] = [];
    for (const [i, agent] of ["a1", "a2", "a3"].entries())
      records.push(
        rec({ id: `${agent}:1`, agentId: agent, taskId: `t${i}`, at: `2026-10-19T08:0${i}:00.000Z`, actions: ["npm run typecheck", "npm test"] }),
        rec({ id: `${agent}:2`, agentId: agent, taskId: `t${i}`, at: `2026-10-19T08:1${i}:00.000Z`, actions: ["paseo plugin reload flowly"] }),
        rec({ id: `${agent}:3`, agentId: agent, taskId: `t${i}`, at: `2026-10-19T08:2${i}:00.000Z`, actions: ["npm run typecheck", "npm test"] }),
      );
    records.push(...["x1", "x2", "x3"].map((id) => rec({ id, taskId: "t0", inline: `python ${id}` })), rec({ id: "y1", taskId: "t1", inline: "python y1" }));
    const agg = aggregate(records);
    expect(agg.cards).toBe(3);
    expect(agg.keys[0]).toMatchObject({ key: "npm run typecheck", runs: 6, cards: 3 });
    expect(agg.sequences.find((s) => s.keys.join(" ") === "npm run typecheck npm test paseo plugin reload flowly")?.sessions).toBe(3);
    expect(agg.inline.map((s) => s.text).slice(0, 2).sort()).toEqual(["python x1", "python y1"]);
  });
  test("material stays within the limit by dropping samples", () => {
    const records = Array.from({ length: 400 }, (_, i) => rec({ id: String(i), taskId: `t${i % 20}`, inline: `node -e ${"x".repeat(550)}${i}` }));
    const material = buildMaterial({
      days: 7,
      agg: aggregate(records),
      cards: Array.from({ length: 20 }, (_, i) => ({ id: `t${i}`, title: `Card ${i}`, tags: [], lane: "done" })),
      config: { paseoScripts: [], paseoWorktree: "", packageScripts: { test: "vitest run" }, commands: "" },
      previous: [{ target: "repo_tool", title: "i18n helper", status: "dismissed", proposal: "scripts/i18n.mjs  add <key>" }],
    });
    expect(material.length).toBeLessThanOrEqual(MATERIAL_LIMIT);
    expect(material).toContain("- dismissed · repo_tool: i18n helper — scripts/i18n.mjs add <key>");
    expect(material).toContain('"test":"vitest run"');
  });
});

describe("model output", () => {
  const finding = (over: Partial<RawFinding> = {}): RawFinding => ({
    target: "repo_tool",
    title: "i18n helper script",
    evidence: "7 cards",
    proposal: "scripts/i18n.mjs add",
    benefit: "fewer edits",
    confidence: "high",
    cards: ["aaaaaaaa", "bbbbbbbb"],
    ...over,
  });
  test("JSON is found in fences and prose; no JSON reads as null so the caller retries", () => {
    const body = JSON.stringify({ findings: [finding()], noise: "", verdict: "worth it" });
    expect(parseWorkflowOutput("```json\n" + body + "\n```")?.findings[0].title).toBe("i18n helper script");
    expect(parseWorkflowOutput("Here you go:\n" + body + "\nThanks")?.verdict).toBe("worth it");
    expect(parseWorkflowOutput("## Findings\n1. i18n helper")).toBeNull();
    expect(parseWorkflowOutput('{"verdict":"no list"}')).toBeNull();
  });
  test("validation drops unknown cards, thin evidence, over-long fields and repeats", () => {
    const now = Date.parse("2026-10-19T00:00:00.000Z");
    const cardIds = ["aaaaaaaa-1111", "bbbbbbbb-2222", "cccccccc-3333"];
    const existing: Finding[] = [
      { id: "f1", projectId: "p", runId: "r", fingerprint: fingerprint("skill", "Doc sync checklist"), target: "skill", title: "Doc sync checklist", evidence: "", proposal: "x", benefit: "", confidence: "high", cards: [], status: "dismissed", createdAt: "", updatedAt: "2026-10-10T00:00:00.000Z" },
      { id: "f2", projectId: "p", runId: "r", fingerprint: fingerprint("agents_md", "Old rule"), target: "agents_md", title: "Old rule", evidence: "", proposal: "x", benefit: "", confidence: "low", cards: [], status: "dismissed", createdAt: "", updatedAt: "2026-08-01T00:00:00.000Z" },
    ];
    const out = validateFindings(
      [
        finding({ cards: ["card aaaaaaaa", "BBBBBBBB", "zzzzzzzz"] }),
        finding({ title: "Only one card", cards: ["aaaaaaaa", "nope0000"] }),
        finding({ title: "Too long", proposal: "x".repeat(4001) }),
        finding({ title: "i18n helper script!" }),
        finding({ target: "skill", title: "Doc sync checklist" }),
        finding({ target: "agents_md", title: "Old rule" }),
        finding({ target: "magic", title: "Bad target" }),
        finding({ title: "Odd confidence", confidence: "certain", cards: ["bbbbbbbb", "cccccccc"] }),
      ],
      { cardIds, existing, now },
    );
    expect(out.map((f) => f.title)).toEqual(["i18n helper script", "Old rule", "Odd confidence"]);
    expect(out[0].cards).toEqual(["aaaaaaaa-1111", "bbbbbbbb-2222"]);
    expect(out[2].confidence).toBe("medium");
  });
  test("at most MAX_FINDINGS are kept", () => {
    const words = "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima".split(" ");
    const out = validateFindings(
      words.map((w) => finding({ title: `${w} helper tool` })),
      { cardIds: ["aaaaaaaa-1", "bbbbbbbb-2"], existing: [], now: 0 },
    );
    expect(out).toHaveLength(MAX_FINDINGS);
  });
  test("a window with one card accepts findings citing that card", () => {
    const out = validateFindings([finding({ cards: ["aaaaaaaa"] })], { cardIds: ["aaaaaaaa-1"], existing: [], now: 0 });
    expect(out).toHaveLength(1);
  });
});

describe("each run replaces the open suggestions (§5.3)", () => {
  const now = Date.parse("2026-10-21T00:00:00.000Z");
  const cardIds = ["aaaaaaaa-1111", "bbbbbbbb-2222", "cccccccc-3333"];
  const raw = (over: Partial<RawFinding> = {}): RawFinding => ({ target: "repo_tool", title: "Something new", evidence: "e2", proposal: "p2", benefit: "b2", confidence: "high", cards: ["aaaaaaaa", "cccccccc"], ...over });
  const stored = (id: string, over: Partial<Finding> = {}): Finding => ({
    id,
    projectId: "p",
    runId: "r1",
    fingerprint: fingerprint(over.target || "repo_tool", over.title || id),
    target: "repo_tool",
    title: id,
    evidence: "e1",
    proposal: "p1",
    benefit: "b1",
    confidence: "medium",
    cards: ["bbbbbbbb-2222"],
    status: "open",
    createdAt: "2026-10-19T00:00:00.000Z",
    updatedAt: "2026-10-19T00:00:00.000Z",
    ...over,
  });
  test("open suggestions do not block a finding: the run replaces them", () => {
    const out = validateFindings([raw({ title: "Board inspector" })], { cardIds, existing: [stored("1a2b3c4d-open", { title: "Board inspector" })], now });
    expect(out.map((f) => f.title)).toEqual(["Board inspector"]);
  });
  test("accepted and recently dismissed suggestions do not come back, also reworded or in another language", () => {
    const existing = [
      stored("1a2b3c4d-acc", { title: "board.json read-only inspector CLI", status: "accepted" }),
      stored("2b3c4d5e-dis", { title: "“新增用户可见特性”交付 checklist skill(onboarding + i18n + README)", target: "skill", status: "dismissed", updatedAt: "2026-10-20T00:00:00.000Z" }),
      stored("3c4d5e6f-old", { title: "Old rule", target: "agents_md", status: "dismissed", updatedAt: "2026-08-01T00:00:00.000Z" }),
    ];
    const out = validateFindings(
      [
        raw({ title: "board.json read-only inspector CLI (events, filters)" }),
        raw({ target: "skill", title: "“新增用户可见特性”交付 checklist skill" }),
        raw({ target: "agents_md", title: "Old rule" }),
        raw({ title: "翻查已安装Paseo.app内置SDK源码时反复重写asar解包脚本" }),
      ],
      { cardIds, existing, now },
    );
    // A dismissal older than the cooldown no longer blocks.
    expect(out.map((f) => f.title)).toEqual(["Old rule", "翻查已安装Paseo.app内置SDK源码时反复重写asar解包脚本"]);
    expect(similarFinding({ target: "repo_tool", title: "alpha helper tool" }, { target: "repo_tool", title: "bravo helper tool" })).toBe(false);
    expect(titleSimilarity("board.json read-only inspector CLI", "board.json read-only inspector CLI (events, filters)")).toBeGreaterThanOrEqual(0.6);
  });
  test("two findings of one run about the same thing add one suggestion", () => {
    const out = validateFindings([raw({ title: "verify pipeline script" }), raw({ title: "verify pipeline script (typecheck)" })], { cardIds, existing: [], now });
    expect(out).toHaveLength(1);
  });
  test("replacing removes only this project's open suggestions", () => {
    const findings = [stored("o1"), stored("o2"), stored("acc", { status: "accepted" }), stored("dis", { status: "dismissed" }), stored("other", { projectId: "q" })];
    const removed = replaceOpen(findings, "p", [stored("n1", { runId: "r2" })]);
    expect(removed).toBe(2);
    expect(findings.map((f) => f.id)).toEqual(["acc", "dis", "other", "n1"]);
  });
});

describe("state, settings and project scripts", () => {
  test("trimming keeps open suggestions, recent closed ones and the newest runs", () => {
    const run = (i: number) => ({ id: `r${i}`, projectId: "p", at: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(), from: "", to: "", model: "", manual: false, status: "ok" as const, findings: 0, replaced: 0, stats: { calls: 0, actions: 0, cards: 0, sessions: 0 } });
    const f = (id: string, status: Finding["status"], updatedAt: string): Finding => ({ id, projectId: "p", runId: "r", fingerprint: id, target: "skill", title: id, evidence: "", proposal: "x", benefit: "", confidence: "low", cards: [], status, createdAt: updatedAt, updatedAt });
    const state: WorkflowState = {
      version: 1,
      revision: 0,
      runs: Array.from({ length: 25 }, (_, i) => run(i)),
      findings: [f("old-open", "open", "2025-01-01T00:00:00.000Z"), f("old-dismissed", "dismissed", "2025-01-01T00:00:00.000Z"), f("new-accepted", "accepted", "2026-10-01T00:00:00.000Z")],
    };
    trimState(state, Date.parse("2026-10-19T00:00:00.000Z"));
    expect(state.runs).toHaveLength(20);
    expect(state.runs.map((r) => r.id)).not.toContain("r0");
    expect(state.findings.map((x) => x.id)).toEqual(["old-open", "new-accepted"]);
  });
  test("settings default to off, weekly at 09:00; an invalid interval falls back", () => {
    expect(workflowSettingsValues(undefined)).toEqual({ enabled: false, model: "", intervalDays: 7, runHour: 9, timeZone: "" });
    expect(workflowSettingsValues({ enabled: true, intervalDays: 5 }).intervalDays).toBe(7);
    expect(workflowSettingsValues({ intervalDays: 1, runHour: 30 })).toMatchObject({ intervalDays: 1, runHour: 9 });
  });
  test("paseo.json scripts are listed by name and type, never their commands", () => {
    expect(projectScriptsFrom(JSON.stringify({ scripts: { verify: { type: "script", command: "npm test" }, web: { command: "npm run dev", port: 3000 }, "bad name!": {} } }))).toEqual([
      { name: "verify", type: "script" },
      { name: "web", type: "service" },
    ]);
    expect(projectScriptsFrom("not json")).toEqual([]);
    expect(projectScriptsFrom("{}")).toEqual([]);
  });
});
