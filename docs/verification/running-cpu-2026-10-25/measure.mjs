import { chromium } from "playwright-core";
import { readdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
const root = join(homedir(), "Library/Caches/ms-playwright");
const b = readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().pop(); const dummy=0;
const exe = join(root, "chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
const browser = await chromium.launch({ headless: true, executablePath: exe });
const configs = process.argv.slice(2);
for (const c of configs) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.setContent('<div id="root"></div>');
  await page.goto("file:///tmp/rnbench/index.html?" + c);
  await page.waitForTimeout(1500);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const m0 = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((x) => [x.name, x.value]));
  const {execSync}=await import("node:child_process");
  const sample=()=>execSync("ps -axo pid,time,args | grep 'Google Chrome for Testing' | grep -v grep",{encoding:"utf8"}).trim().split("\n").map(l=>{const m=l.trim().match(/^(\d+)\s+([\d:.]+)\s+(.*)$/);const [mm,ss]=m[2].split(":");return {pid:m[1],t:Number(mm)*60+Number(ss),kind:(m[3].match(/--type=([a-z-]+)/)||[,"browser"])[1]}});
  const a=sample(); await page.waitForTimeout(5000); const b=sample();
  const by={}; for(const y of b){const x=a.find(z=>z.pid===y.pid); if(x) by[y.kind]=(by[y.kind]||0)+(y.t-x.t)/5*100;}
  console.log("  procs%", Object.entries(by).map(([k,v])=>k+"="+v.toFixed(1)).join(" "));
  const m1 = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((x) => [x.name, x.value]));
  const d = (k) => ((m1[k] - m0[k]) / 5 * 100).toFixed(1);
  console.log(c.padEnd(24), "script%", d("ScriptDuration"), "layout%", d("LayoutDuration"), "style%", d("RecalcStyleDuration"), "task%", d("TaskDuration"));
  await page.close();
}
await browser.close();
