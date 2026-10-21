// Renders a draft sheet (logo-drafts/<set>/index.html) to overview.png in the same folder at 2x.
// Usage: node docs/brand/render-drafts.mjs [set]   (default v2-line; v1-filled also works)
// The set's SVG sources are injected as window.__SVGS so the sheet can draw them inline in any color.
// PLAYWRIGHT points at a playwright(-core) entry when the package is not resolvable from here;
// CHROMIUM at a browser binary when Playwright's bundled one is missing.
import { readdir, readFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT ?? 'playwright');
const set = process.argv[2] ?? 'v2-line';
const dir = new URL(`./logo-drafts/${set}/`, import.meta.url).pathname;
const svgs = {};
for (const name of (await readdir(dir)).filter((n) => n.endsWith('.svg'))) svgs[name] = await readFile(dir + name, 'utf8');
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM });
try {
  const page = await browser.newPage({ viewport: { width: 1720, height: 900 }, deviceScaleFactor: 2 });
  await page.addInitScript((value) => { window.__SVGS = value; }, svgs);
  await page.goto(`file://${dir}index.html`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: `${dir}overview.png`, fullPage: true });
} finally {
  await browser.close();
}
