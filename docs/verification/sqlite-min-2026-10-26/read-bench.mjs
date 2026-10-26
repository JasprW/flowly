// Read/write latency, board.json vs flowly.sqlite, on the same board (the pre-migration snapshot).
// Runs inside the Paseo Helper runtime with Paseo's real plugin compiler, like drill.mjs. Prints numbers only.
//   ELECTRON_RUN_AS_NODE=1 '<Paseo Helper>' '<node-entrypoint-runner.js>' node-script read-bench.mjs
// Env: RB_WT (a clean worktree to compile from), RB_SNAPSHOT (the original board.json), RB_COMPILER.
import { copyFile, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const { RB_WT: WT, RB_SNAPSHOT: SNAPSHOT, RB_COMPILER: COMPILER } = process.env;
const entry = join(WT, "bench-entry.server.ts");
await writeFile(entry, `import { BoardStore } from "./server/store";\nimport { boardOverview } from "./server/board-overview";\nexport function benchLib() {\n  return { BoardStore, boardOverview };\n}\n`);
const { compilePlugin } = await import(pathToFileURL(COMPILER).href);
let serverBundle;
try {
  ({ serverBundle } = await compilePlugin({ client: null, server: entry }));
} finally {
  await rm(entry, { force: true });
}
const { BoardStore, boardOverview } = (0, eval)(serverBundle)(createRequire(join(WT, "package.json"))).benchLib();

const temps = [];
const dir = async () => {
  const d = await mkdtemp(join(tmpdir(), "flowly-read-bench-"));
  temps.push(d);
  return d;
};
const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { median: +q(0.5).toFixed(1), p90: +q(0.9).toFixed(1), min: +s[0].toFixed(1), n: s.length };
};
async function measure(fn, n = 30, warmup = 3) {
  for (let i = 0; i < warmup; i++) await fn(i);
  const xs = [];
  for (let i = 0; i < n; i++) {
    const t = performance.now();
    await fn(i);
    xs.push(performance.now() - t);
  }
  return stats(xs);
}

const out = { host: { node: process.version, sqlite: process.versions.sqlite, platform: `${process.platform}-${process.arch}` } };
try {
  const jsonDir = await dir(),
    sqlDir = await dir();
  await copyFile(SNAPSHOT, join(jsonDir, "board.json"));
  await copyFile(SNAPSHOT, join(sqlDir, "board.json"));
  out.boardJsonBytes = (await stat(SNAPSHOT)).size;
  const json = new BoardStore(jsonDir);
  let sql = new BoardStore(sqlDir, { backend: "sqlite" });
  let t = performance.now();
  const board = await sql.read();
  out.migrationMs = +(performance.now() - t).toFixed(1);
  out.counts = { tasks: board.tasks.length, events: board.events.length, receipts: board.agentReceipts.length };
  out.sameBoard = JSON.stringify(await json.read()) === JSON.stringify(board);

  // store.read(): what attention.count and most server code call.
  out.read = { json: await measure(() => json.read()), sqlite: await measure(() => sql.read()) };
  // store.view(): read() plus the full boardSchema parse every board RPC does.
  out.view = { json: await measure(() => json.view()), sqlite: await measure(() => sql.view()) };
  // The overview RPC's server work: view() then boardOverview().
  out.overview = { json: await measure(async () => boardOverview(await json.view())), sqlite: await measure(async () => boardOverview(await sql.view())) };
  // A plugin start: open the database and read the board once (JSON has no separate start cost).
  await sql.close();
  out.coldStart = {
    json: await measure(async () => new BoardStore(jsonDir).read(), 10, 1),
    sqlite: await measure(async () => {
      const s = new BoardStore(sqlDir, { backend: "sqlite" });
      await s.read();
      await s.close();
    }, 10, 1),
  };
  sql = new BoardStore(sqlDir, { backend: "sqlite" });
  // One card edit, for comparison: JSON rewrites the whole file and its .bak.
  const id = board.tasks[0].id;
  const edit = (s) => async (i) => {
    const task = (await s.read()).tasks.find((x) => x.id === id);
    await s.editTask({ id, revision: task.revision, description: `bench ${i}`, actor: "human" });
  };
  out.edit = { json: await measure(edit(json), 20, 2), sqlite: await measure(edit(sql), 20, 2) };
  await sql.close();
  out.databaseBytes = (await stat(join(sqlDir, "flowly.sqlite"))).size;
} catch (error) {
  out.error = { name: error?.name, code: error?.code ?? null, message: String(error?.message ?? error).slice(0, 200) };
} finally {
  for (const d of temps) await rm(d, { recursive: true, force: true });
  out.cleaned = temps.length;
}
console.log(JSON.stringify(out, null, 1));
