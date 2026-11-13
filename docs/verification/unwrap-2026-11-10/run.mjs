// End-to-end check of "Unwrap in place" (WORKSPACE-RESTORE-SPEC) on the installed plugin.
// Adds ONE temporary worktree card to the Tinylink demo project (existing cards untouched), runs one idle Haiku
// session in it, moves it to Done and wraps it up, then presses Unwrap in the card sidebar (desktop web) and checks
// the workspace and session come back while the card stays in Done. Screenshots desktop and phone width before and
// after. Everything it creates (card, session, workspace, worktree, branch) is removed in `finally`.
// Usage: node docs/verification/unwrap-2026-11-10/run.mjs
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { launch, open, openCard, shot } from "../../promo/shot-lib.mjs";

const out = dirname(fileURLToPath(import.meta.url));
const fx = JSON.parse(readFileSync(join(out, "../../promo/ids.json"), "utf8"));
const home = process.env.PASEO_HOME || join(homedir(), ".paseo");
const listen = JSON.parse(readFileSync(join(home, "paseo.pid"), "utf8")).listen;
const token = readFileSync(join(home, "local-credential"), "utf8").trim();
const client = new DaemonClient({
  url: `ws://${listen}/ws`, clientId: "flowly-unwrap-e2e", clientType: "cli",
  localCredential: () => token, reconnect: { enabled: false }, connectTimeoutMs: 8000,
});
await client.connect();
const rpc = (method, input) => client.invokePluginRpc("flowly", method, input);
const repo = fx.directory;
const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = Date.now();
const title = `Unwrap e2e ${stamp}`;
const log = [];
const note = (...parts) => {
  const line = parts.map((p) => (typeof p === "string" ? p : JSON.stringify(p))).join(" ");
  log.push(line);
  console.log(line);
};
const failures = [];
const check = (ok, what) => {
  note(ok ? "PASS" : "FAIL", what);
  if (!ok) failures.push(what);
};
const created = { taskId: null, workspaceId: null, agentId: null, dir: null, branch: null };
const board = () => rpc("board.read", {});
const task = async () => (await board()).tasks.find((t) => t.id === created.taskId);
const events = async () => (await board()).events.filter((e) => e.taskId === created.taskId);
const agentArchivedAt = async () => {
  const a = await client.fetchAgent(created.agentId);
  return a?.agent?.archivedAt ?? a?.archivedAt ?? null;
};
const waitFor = async (fn, what, ms = 90000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await fn();
    if (value) return value;
    await sleep(1000);
  }
  throw new Error(`Timed out waiting for ${what}`);
};
const branchesBefore = new Set(git("branch", "--format=%(refname:short)").split("\n"));
let browser;
// Phone width: enter the project at desktop width (the compact header has no project tab), then narrow the window
// so the plugin surface is 430 px wide (< 760, the compact layout), as release-v1.7.0 ui-check does.
const openPhone = async () => {
  const s = await open(browser, { w: 1700, h: 932 });
  await s.page.setViewportSize({ width: 750, height: 932 });
  await s.page.waitForTimeout(1500);
  // The phone board shows one lane at a time: switch to Done through the lane chooser.
  await s.page.getByTestId("lane-chooser").click();
  await s.page.waitForTimeout(800);
  await s.page.getByText("Done", { exact: true }).last().click();
  await s.page.waitForTimeout(1200);
  return Object.assign(s, { w: 750, h: 932, clip: { ...s.clip, width: 750 - s.clip.x, height: 932 } });
};

try {
  const t = await rpc("tasks.create", {
    projectId: fx.project.id, operationId: `flowly-unwrap-e2e-${stamp}`, title, mode: "worktree", baseRef: "main",
  });
  created.taskId = t.id;
  created.workspaceId = t.workspaceId;
  const page = await client.fetchWorkspaces({});
  const ws = (page.entries ?? page.workspaces ?? []).map((e) => e.workspace ?? e).find((w) => (w.id ?? w.workspaceId) === t.workspaceId);
  created.dir = ws?.workspaceDirectory ?? ws?.directory ?? null;
  created.branch = created.dir ? execFileSync("git", ["-C", created.dir, "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" }).trim() : null;
  note("card", t.id, t.workspaceId, created.dir, created.branch, "ownsWorkspace", t.ownsWorkspace);

  const agent = await client.createAgent({
    config: { provider: "claude", model: "haiku", modeId: "bypassPermissions", cwd: created.dir, title: `unwrap e2e ${stamp}` },
    workspaceId: t.workspaceId,
    initialPrompt: "Reply with the single word OK. Do not use tools.",
  });
  created.agentId = agent.id;
  note("session", agent.id, "first turn:", (await client.waitForFinish(agent.id, 180000)).status);

  // Done; the user's Auto wrap up is on, so the daemon archives it when the preflight is clean.
  // Otherwise wrap it up keeping the card, as the Done prompt does.
  let current = await rpc("tasks.update", { id: t.id, revision: t.revision, status: "done" });
  const auto = await waitFor(
    async () => (await events()).find((e) => e.action === "workspace_auto_archived" || e.action === "workspace_auto_archive_skipped") || null,
    "auto wrap-up", 60000,
  ).catch(() => null);
  note("auto wrap-up:", auto?.action ?? "none", auto?.note ?? "");
  if (auto?.action !== "workspace_auto_archived") {
    current = await task();
    note("manual wrap-up", (await rpc("tasks.wrapup", { id: t.id, revision: current.revision, acknowledgeWarnings: true, keepCard: true })).note);
  }
  const archived = await client.inspectWorkspaceRecovery(t.workspaceId);
  check(archived.kind === "recoverable", `wrapped: workspace archived (${archived.kind}/${archived.action ?? archived.reason})`);
  check(!!(await agentArchivedAt()), "wrapped: session archived");
  const revisionBefore = (await task()).revision;

  browser = await launch();
  const desk = await open(browser, { w: 1700, h: 1000 });
  const phone = await openPhone();
  // Wait on the sidebar itself (the board card also says "Wrapped up") and let its open transition finish.
  const drawer = (s) => s.page.getByTestId("task-drawer-motion").filter({ hasText: title }).first();
  await openCard(desk, title);
  await drawer(desk).getByRole("button", { name: "Unwrap", exact: true }).waitFor({ timeout: 15000 });
  await desk.page.waitForTimeout(1500);
  await shot(desk, join(out, "desktop-wrapped.png"));
  await openCard(phone, title);
  await drawer(phone).getByRole("button", { name: "Unwrap", exact: true }).waitFor({ timeout: 15000 });
  await phone.page.waitForTimeout(1500);
  await shot(phone, join(out, "phone-wrapped.png"));
  check(true, "UI: sidebar shows Wrapped up with Unwrap (desktop and phone)");

  // Press Unwrap in the desktop sidebar.
  await desk.page.getByRole("button", { name: "Unwrap", exact: true }).first().click({ timeout: 10000 });
  await desk.page.getByText("Unwrapped", { exact: true }).first().waitFor({ timeout: 90000 });
  check(true, "UI: success toast Unwrapped");
  await desk.page.getByText("Finished", { exact: true }).first().waitFor({ timeout: 30000 });
  check(await desk.page.getByRole("button", { name: "Unwrap", exact: true }).count() === 0, "UI: Unwrap button gone");
  await desk.page.waitForTimeout(3000);
  check(await desk.page.getByText("Workspace is unavailable or archived.", { exact: true }).count() === 0, "UI: no stale workspace warning after Unwrap");
  await shot(desk, join(out, "desktop-unwrapped.png"));

  const restored = (await events()).filter((e) => e.action === "workspace_restored");
  check(restored.length === 1 && restored[0].actor === "human", `event workspace_restored by human (${restored[0]?.note})`);
  const after = await client.inspectWorkspaceRecovery(t.workspaceId);
  check(after.kind === "unavailable" && after.reason === "workspace_not_archived", "same workspace ID active again");
  check(!!created.dir && existsSync(created.dir), "worktree directory exists");
  if (created.branch) check(execFileSync("git", ["-C", created.dir, "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" }).trim() === created.branch, `worktree on branch ${created.branch}`);
  check(!(await agentArchivedAt()), "session unarchived");
  const card = await task();
  check(card.status === "done" && !card.archivedAt, `card still in Done, not archived (${card.status})`);
  check(card.revision === revisionBefore && card.workspaceId === t.workspaceId, "card revision and workspace binding unchanged");

  // Auto wrap-up must not archive it again while it stays in Done.
  await sleep(10000);
  const again = (await events()).filter((e) => e.action === "workspace_auto_archived").length;
  check(again === (auto?.action === "workspace_auto_archived" ? 1 : 0), `no second auto wrap-up (auto-archive events: ${again})`);
  check((await client.inspectWorkspaceRecovery(t.workspaceId)).reason === "workspace_not_archived", "workspace still active after 10 s");

  await phone.context.close();
  const phone2 = await openPhone();
  await openCard(phone2, title);
  await drawer(phone2).getByRole("button", { name: "Wrap up", exact: true }).waitFor({ timeout: 15000 });
  await phone2.page.waitForTimeout(1500);
  await shot(phone2, join(out, "phone-unwrapped.png"));
  check(true, "UI: phone shows Finished after Unwrap");
  if (desk.errors.length || phone2.errors.length) note("page errors:", [...desk.errors, ...phone2.errors]);
} catch (e) {
  failures.push(e.message);
  note("ERROR", e.stack || e.message);
} finally {
  if (browser) await browser.close().catch(() => undefined);
  note("cleanup", created);
  if (created.agentId) await client.deleteAgent(created.agentId).catch((e) => note("agent delete failed", e.message));
  if (created.workspaceId) await client.archiveWorkspace(created.workspaceId).catch(() => undefined);
  if (created.taskId) {
    const t = await task();
    if (t) await rpc("tasks.delete", { id: t.id, revision: t.revision, archive: false }).catch((e) => note("card delete failed", e.message));
  }
  if (created.dir && existsSync(created.dir)) {
    try { git("worktree", "remove", "--force", created.dir); } catch (e) { note("worktree remove failed", e.message); }
  }
  try { git("worktree", "prune"); } catch {}
  if (created.branch && !branchesBefore.has(created.branch)) {
    try { git("branch", "-D", created.branch); } catch (e) { note("branch delete failed", e.message); }
  }
  const b = await board();
  check(!b.tasks.some((t) => t.id === created.taskId), "cleanup: card removed");
  if (created.agentId) check(!(await client.fetchAgent(created.agentId).catch(() => null)), "cleanup: session deleted");
  check(!created.dir || !existsSync(created.dir), "cleanup: worktree removed");
  check(!created.branch || !git("branch", "--format=%(refname:short)").split("\n").includes(created.branch), "cleanup: branch removed");
  check(fx.cards.every((c) => b.tasks.some((t) => t.id === c.id)), "Tinylink's own cards still present");
  await client.close();
  writeFileSync(join(out, "run.log"), log.join("\n") + "\n");
  console.log(failures.length ? `FAILED: ${failures.join("; ")}` : "ALL PASSED");
  process.exit(failures.length ? 1 : 0);
}
