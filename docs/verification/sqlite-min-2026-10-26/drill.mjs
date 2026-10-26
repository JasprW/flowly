// Independent drill for SQLITE-STORAGE-SPEC §11 (verifier run, commit 2334d58).
// Runs inside the Paseo Helper runtime (node 24.20, sqlite 3.53.4). It only touches copies in
// mkdtemp directories and prints counts, sizes, hashes, timings and result codes, never board content.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const WT = process.env.FV_WT; // verifier worktree at 2334d58 (compiled from here)
const SRC = process.env.FV_SRC; // real plugin-data dir: read only, copied from
const COMPILER = process.env.FV_COMPILER; // Paseo's real plugin compiler
const REPORT = process.env.FV_REPORT; // where drill-result.json is written

const out = { host: { node: process.version, sqlite: process.versions.sqlite }, checks: {}, timings: {}, sizes: {}, counts: {}, probes: {}, errors: [] };
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const exists = (p) => stat(p).then(() => true, () => false);
const ms = (t) => Math.round(performance.now() - t);
const temps = [];
const tempDir = async () => {
  const d = await mkdtemp(join(tmpdir(), "flowly-sqlite-drill-"));
  temps.push(d);
  return d;
};
/** Board content without revisions (same definition as the test suite's content()). */
const contentOf = (board) => {
  const c = structuredClone(board);
  c.revision = 0;
  for (const x of [...c.projects, ...c.tasks, ...c.workpads]) x.revision = 0;
  return JSON.stringify(c);
};
/** Records a failed step by error class and code only (messages can echo values). */
async function step(name, fn) {
  try {
    return await fn();
  } catch (error) {
    out.errors.push({ step: name, name: error?.name ?? "Error", code: error?.code ?? null });
    return undefined;
  }
}

const stores = [];
const open = (dir, storage = {}) => {
  const store = new BoardStore(dir, { backend: "sqlite", storage });
  stores.push(store);
  return store;
};

// ---- Compile the real module graph with Paseo's compiler ----------------------------------
// The compiler only accepts plugin modules under the entry's directory, so the entry sits at the
// verifier worktree root (a temporary file there, removed after the compile; never committed).
const entryDir = await tempDir();
const entry = join(WT, "drill-entry.server.ts");
await writeFile(entry, `import { BoardStore } from "./server/store";\nimport { upgradeBoard } from "./server/migrate";\nexport function drillLib() {\n  return { BoardStore, upgradeBoard };\n}\n`);
const { compilePlugin } = await import(pathToFileURL(COMPILER).href);
let serverBundle;
try {
  ({ serverBundle } = await compilePlugin({ client: null, server: entry }));
} finally {
  await rm(entry, { force: true });
}
if (typeof serverBundle !== "string" || !serverBundle.length) throw new Error("compiler returned no server bundle");
out.compiler = { bundleBytes: Buffer.byteLength(serverBundle), bundleSha256: sha(serverBundle) };
const requireFromWt = createRequire(join(WT, "package.json"));
const lib = (0, eval)(serverBundle)(requireFromWt);
const { BoardStore, upgradeBoard } = lib.drillLib();

const srcBoard = join(SRC, "board.json");
const srcBak = join(SRC, "board.json.bak");
out.source = { boardJsonBytes: (await stat(srcBoard)).size, mtimeBefore: (await stat(srcBoard)).mtimeMs, hasBak: await exists(srcBak) };

try {
  // (a) Expected board: copy of the real board.json, read by the default JSON mode.
  const T1 = await tempDir();
  await copyFile(srcBoard, join(T1, "board.json"));
  if (out.source.hasBak) await copyFile(srcBak, join(T1, "board.json.bak"));
  const originalBytes = await readFile(join(T1, "board.json"));
  out.checks.originalSha256 = sha(originalBytes);
  const T2 = await tempDir();
  await copyFile(join(T1, "board.json"), join(T2, "board.json"));
  const expectedBoard = await new BoardStore(T2).read();
  const expectedText = JSON.stringify(expectedBoard);
  out.counts = {
    projects: expectedBoard.projects.length,
    tasks: expectedBoard.tasks.length,
    events: expectedBoard.events.length,
    ideas: expectedBoard.ideas?.length ?? 0,
    workpads: expectedBoard.workpads.length,
    agentReceipts: expectedBoard.agentReceipts.length,
    backupFileBytes: out.source.hasBak ? (await stat(srcBak)).size : 0,
  };

  // (b) First start with SQLite: move, marker, snapshot, backup, timings.
  const s = open(T1);
  let t = performance.now();
  const migrated = await step("b.migrate", () => s.read());
  out.timings.migrationAndFirstReadMs = ms(t);
  out.checks.b_migratedEqualsJsonReader = migrated !== undefined && JSON.stringify(migrated) === expectedText;
  const marker = JSON.parse(await readFile(join(T1, "board.json"), "utf8"));
  out.checks.b_boardJsonIsRetiredMarker = marker.version === 0 && marker.storage === "sqlite";
  const runs = await readdir(join(T1, "migrations"));
  const manifest = JSON.parse(await readFile(join(T1, "migrations", runs[0], "manifest.json"), "utf8"));
  out.checks.b_snapshotCount = runs.length;
  out.checks.b_manifestSha256EqualsOriginal = manifest.files["board.json"].sha256 === out.checks.originalSha256;
  out.checks.b_snapshotBoardJsonBytesEqualOriginal = sha(await readFile(join(T1, "migrations", runs[0], "board.json"))) === out.checks.originalSha256;
  const status0 = await s.storageStatus();
  out.checks.b_backend = status0.backend;
  out.checks.b_backupsAfterMigration = status0.backups.length;
  out.sizes.flowlySqliteBytes = (await stat(join(T1, "flowly.sqlite"))).size;
  t = performance.now();
  await s.read();
  out.timings.readAfterMigrationMs = ms(t);

  // (c) One edit, close, reopen.
  const before = await s.read();
  const task = before.tasks[0];
  const newTitle = `${task.title} [verify]`;
  t = performance.now();
  await step("c.edit", () => s.editTask({ id: task.id, revision: task.revision, title: newTitle, actor: "human" }));
  out.timings.editTaskMs = ms(t);
  await s.close();
  const s2 = open(T1);
  const reopened = await step("c.reopen", () => s2.read());
  out.checks.c_editSurvivesReopen = reopened?.tasks.find((x) => x.id === task.id)?.title === newTitle;

  // (d) Restore the first (newest) backup.
  const edited = await s2.read();
  const editedTask = edited.tasks.find((x) => x.id === task.id);
  const first = (await s2.storageStatus()).backups[0];
  out.checks.d_restoredFromBackupNamedLikeFlowly = /^flowly-\d{8}-\d{6}(-\d+)?\.sqlite$/.test(first?.name ?? "");
  t = performance.now();
  const restoreResult = await step("d.restore", () => s2.restoreStorage(first.name));
  out.timings.restoreMs = ms(t);
  const restored = await s2.read();
  out.checks.d_contentEqualsOriginal = contentOf(restored) === contentOf(JSON.parse(expectedText));
  out.checks.d_everyRevisionAboveEdited =
    restored.revision > edited.revision &&
    restored.tasks.every((x) => {
      const e = edited.tasks.find((y) => y.id === x.id);
      return !e || x.revision > e.revision;
    }) &&
    restored.projects.every((x) => {
      const e = edited.projects.find((y) => y.id === x.id);
      return !e || x.revision > e.revision;
    });
  let staleRejected = false;
  try {
    await s2.editTask({ id: task.id, revision: editedTask.revision, title: "stale", actor: "human" });
  } catch {
    staleRejected = true;
  }
  out.checks.d_staleEditRejected = staleRejected;
  const aside = restoreResult?.aside ?? null;
  out.checks.d_previousDatabaseKept = aside !== null && (await exists(join(T1, aside)));
  if (aside) {
    const copy = new DatabaseSync(join(T1, aside), { readOnly: true });
    const rows = copy.prepare("SELECT body FROM items WHERE collection = 'tasks'").all().map((r) => r.body);
    copy.close();
    out.checks.d_keptDatabaseHasEdit = rows.some((b) => b.includes("[verify]"));
  }

  // (e) Export back to JSON; the previous release's reader is upgradeBoard (migrate.ts unchanged since 89f0333^).
  const preExport = await s2.read();
  t = performance.now();
  const exp = await step("e.export", () => s2.exportStorage());
  out.timings.exportJsonMs = ms(t);
  const raw = JSON.parse(await readFile(join(T1, "board.json"), "utf8"));
  out.checks.e_boardJsonVersion = raw.version;
  const exported = upgradeBoard(raw);
  out.checks.e_readableByPreviousReader = contentOf(exported) === contentOf(preExport);
  out.checks.e_revisionsAbovePreExport = exported.revision > preExport.revision && exported.tasks.every((x) => {
    const p = preExport.tasks.find((y) => y.id === x.id);
    return !p || x.revision > p.revision;
  });
  out.checks.e_jsonModeReadEqualsPreExport = contentOf(await new BoardStore(T1).read()) === contentOf(preExport);
  const retired = exp?.retired ?? null;
  out.checks.e_databaseRenamedRetired = retired !== null && (await exists(join(T1, retired))) && !(await exists(join(T1, "flowly.sqlite")));
  out.checks.e_modeFileWritten = JSON.parse(await readFile(join(T1, "storage-mode.json"), "utf8")).backend === "json";

  // (f) Back to SQLite.
  t = performance.now();
  await step("f.useSqlite", () => s2.useSqliteStorage());
  out.timings.useSqliteMs = ms(t);
  const back = await s2.read();
  out.checks.f_contentEqualsPreExport = contentOf(back) === contentOf(preExport);
  out.checks.f_backend = (await s2.storageStatus()).backend;
  await s2.close();

  // ---- Probes beyond the drill steps ----------------------------------------------------
  // P1: export killed-equivalent between its two writes (board.json replaced, storage-mode.json not yet written).
  const T3 = await tempDir();
  await copyFile(join(T2, "board.json"), join(T3, "board.json"));
  const p1 = new BoardStore(T3, { backend: "sqlite", storage: { step: (n) => { if (n === "export:json") throw new Error("injected"); } } });
  stores.push(p1);
  await step("p1.migrate", () => p1.read());
  let injected = false;
  try {
    await p1.exportStorage();
  } catch (e) {
    injected = /injected/.test(e.message);
  }
  await p1.close();
  const p1b = open(T3);
  let p1Result;
  try {
    await p1b.read();
    p1Result = "ok";
  } catch (e) {
    p1Result = e.code ?? e.name;
  }
  out.probes.P1_exportInterruptedBetweenWrites = { injectedThrown: injected, reopenResult: p1Result, boardJsonVersionAfter: JSON.parse(await readFile(join(T3, "board.json"), "utf8")).version };
  await p1b.close();

  // P2: retire rename fails after the export has written both files (state left in memory).
  const T4 = await tempDir();
  await copyFile(join(T2, "board.json"), join(T4, "board.json"));
  const fixed = new Date("2026-10-26T12:00:00Z");
  const p2 = new BoardStore(T4, { backend: "sqlite", storage: { now: () => fixed } });
  stores.push(p2);
  await step("p2.migrate", () => p2.read());
  await mkdir(join(T4, "flowly.sqlite.retired-20261026-120000"));
  let exportCode = null;
  try {
    await p2.exportStorage();
  } catch (e) {
    exportCode = e.code ?? e.name;
  }
  let nextCode = null;
  try {
    await p2.read();
    nextCode = "ok";
  } catch (e) {
    nextCode = e.code ?? e.name;
  }
  const st2 = await p2.storageStatus();
  out.probes.P2_retireFailureAfterExport = { exportErrorCode: exportCode, nextReadCode: nextCode, statusBackend: st2.backend, statusReason: st2.reason, statusDetail: st2.detail ?? null };
  await p2.close();
  const p2b = open(T4);
  let p2Result;
  try {
    const b = await p2b.read();
    p2Result = { backend: (await p2b.storageStatus()).backend, contentEqualsExpected: contentOf(b) === contentOf(JSON.parse(expectedText)) };
  } catch (e) {
    p2Result = { code: e.code ?? e.name };
  }
  out.probes.P2_afterRestartWithRealClock = p2Result;
  await p2b.close();

  // P3: several backups inside one second: which file is kept.
  const T5 = await tempDir();
  await copyFile(join(T2, "board.json"), join(T5, "board.json"));
  const p3 = new BoardStore(T5, { backend: "sqlite", storage: { now: () => fixed } });
  stores.push(p3);
  await step("p3.migrate", () => p3.read());
  for (let i = 0; i < 7; i++) await step("p3.backup", () => p3.backupStorage());
  const names = (await p3.storageStatus()).backups.map((b) => b.name);
  out.probes.P3_sameSecondBackups = { listedNewestFirst: names, count: names.length };
  await p3.close();

  // P4: a real second process while the first holds the owner lock.
  const T6 = await tempDir();
  await copyFile(join(T2, "board.json"), join(T6, "board.json"));
  const p4 = open(T6);
  await step("p4.migrate", () => p4.read());
  const bundlePath = join(entryDir, "bundle.cjs");
  await writeFile(bundlePath, serverBundle);
  const childPath = join(entryDir, "child.mjs");
  await writeFile(
    childPath,
    `import fs from "node:fs";\nimport { createRequire } from "node:module";\n` +
      `const lib = (0, eval)(fs.readFileSync(${JSON.stringify(bundlePath)}, "utf8"))(createRequire(${JSON.stringify(join(WT, "package.json"))}));\n` +
      `const s = new (lib.drillLib().BoardStore)(${JSON.stringify(T6)}, { backend: "sqlite" });\n` +
      `try { await s.read(); console.log(JSON.stringify({ code: "ok" })); } catch (e) { console.log(JSON.stringify({ code: e.code ?? e.name })); }\n`,
  );
  // A plain node process (not the Paseo helper, which Electron may treat as an app launch when spawned).
  const child = spawnSync("node", [childPath], { encoding: "utf8", timeout: 60000 });
  const childLine = (child.stdout || "").trim().split("\n").pop() ?? "";
  out.probes.P4_secondProcess = { runtime: "system node", exitStatus: child.status, result: childLine.slice(0, 80), spawnError: child.error?.code ?? null, stderrLines: (child.stderr || "").split("\n").filter(Boolean).length };
  await p4.close();
} finally {
  await Promise.all(stores.map((s) => s.close().catch(() => undefined)));
  for (const d of temps) await rm(d, { recursive: true, force: true });
  out.cleanup = { tempDirsRemoved: (await Promise.all(temps.map((d) => exists(d)))).every((x) => !x), tempDirCount: temps.length };
  out.source.mtimeAfter = (await stat(srcBoard)).mtimeMs;
  out.source.boardJsonBytesAfter = (await stat(srcBoard)).size;
  out.source.sourceReadOnlyNote = "drill opened the source only for copyFile and stat";
  const json = JSON.stringify(out, null, 2);
  console.log(json);
  if (REPORT) await writeFile(join(REPORT, "drill-result.json"), `${json}\n`);
}
