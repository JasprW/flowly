// Usage: node measure.mjs <index.html path> "v=A&n=12" ["v=W&n=12" ...]
// Bundle bench-app.tsx / bench-real.tsx with esbuild (alias react-native -> react-native-web) into the page first.
// Set PLAYWRIGHT_CHROMIUM_PATH to use a specific browser; otherwise Playwright's own is launched.
import { chromium } from "playwright-core";
import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const [pagePath, ...configs] = process.argv.slice(2);
// Playwright has no Browser.process(): tag our browser with a unique switch and find its root process by it.
const tag = `--bench-tag=${process.pid}-${Date.now()}`;
const browser = await chromium.launch({ headless: true, args: [tag], ...(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {}) });

/** ps TIME is [[DD-]HH:]MM:SS[.ss]; returns seconds. */
function cpuSeconds(text) {
  const [days, rest] = text.includes("-") ? text.split("-") : [0, text];
  return rest.split(":").reduce((total, part) => total * 60 + Number(part), 0) + Number(days) * 86400;
}

/** CPU seconds per process kind, only for the browser we launched and its descendants. */
function sample() {
  const rows = execSync("ps -axo pid,ppid,time,args", { encoding: "utf8" }).trim().split("\n").slice(1).map((l) => {
    const m = l.trim().match(/^(\d+)\s+(\d+)\s+([\d:.-]+)\s+(.*)$/);
    if (!m) return null;
    return { pid: +m[1], ppid: +m[2], t: cpuSeconds(m[3]), args: m[4], kind: (m[4].match(/--type=([a-z-]+)/) || [, "browser"])[1] };
  }).filter(Boolean);
  const rootRow = rows.find((r) => r.args.includes(tag) && !r.args.includes("--type="));
  const ours = new Set(rootRow ? [rootRow.pid] : []);
  for (let grew = true; grew;) { grew = false; for (const r of rows) if (!ours.has(r.pid) && ours.has(r.ppid)) { ours.add(r.pid); grew = true; } }
  return rows.filter((r) => ours.has(r.pid));
}

for (const c of configs) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto(pathToFileURL(resolve(pagePath)).href + "?" + c);
  await page.waitForTimeout(1500);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const metrics = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((x) => [x.name, x.value]));
  const m0 = await metrics();
  const a = sample();
  await page.waitForTimeout(5000);
  const b = sample();
  const m1 = await metrics();
  const by = {};
  for (const y of b) { const x = a.find((z) => z.pid === y.pid); if (x) by[y.kind] = (by[y.kind] || 0) + ((y.t - x.t) / 5) * 100; }
  const d = (k) => (((m1[k] - m0[k]) / 5) * 100).toFixed(1);
  console.log(c.padEnd(24), "script%", d("ScriptDuration"), "task%", d("TaskDuration"), "| procs%", Object.entries(by).map(([k, v]) => `${k}=${v.toFixed(1)}`).join(" "));
  await page.close();
}
await browser.close();
