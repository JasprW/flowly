// Builds the final logo (docs/brand/logo): every SVG from the geometry below, then PNGs, favicon.ico and overview.png,
// and client/flowly-mark-data.ts (the small mark as theme PNGs for the welcome tour title; the client cannot draw SVG).
// Usage: node docs/brand/export-logo.mjs
// The wordmark comes from wordmark.json, Inter Medium outlined by outline-wordmark.py (see logo/README.md).
// PLAYWRIGHT points at a playwright(-core) entry when the package is not resolvable from here;
// CHROMIUM at a browser binary when Playwright's bundled one is missing. favicon.ico needs ImageMagick (magick).
import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const INK = '#1E2120';
const PAPER = '#F3F1EC';

// Mark on the 64 grid, stroke 4 (direction H, "status path"): the to-do ring, a path that turns twice,
// the in-progress ring with its dot, and the check ring. Every line end sits 2 units from its ring.
// The check is one step lighter (stroke 3) and 12% larger, so it reads inside its ring instead of filling it.
const MARK = `<circle cx="11" cy="52.5" r="5"/>
  <path d="M22 52.5 C27 52.5 31 50.5 31 45.5"/>
  <circle cx="31" cy="33.5" r="6"/>
  <path d="M31 33.5 h0"/>
  <path d="M31 21.5 C31 16.5 32.5 14.5 36 14.5"/>
  <circle cx="50" cy="14.5" r="8"/>
  <path stroke-width="3" d="M46.46 15 L48.93 17.47 L53.41 12.43"/>`;
// 24 px and below (on a 20 grid, stroke 1.5): three rings do not fit, so only the two ends stay, a solid start and an
// open end ring joined by one S curve. The solid dot is drawn about 13% smaller (5.2 across against the ring's 6)
// so the two ends look the same size. Chosen from logo-drafts/v12-two-ends (T5).
const SMALL = `<circle cx="4" cy="16" r="2.6" fill="currentColor" stroke="none"/>
  <path d="M7.75 16 C13 16 7 4 12 4"/>
  <circle cx="16" cy="4" r="2.25"/>`;
// Wordmark: "Flowly" in Inter Medium (SIL OFL 1.1), tracked -1%, with details from the mark (l tops and the y's tail
// cut at an angle, rising like the path; a dot in the o, the in-progress ring), as filled outlines in font units (baseline y=0, y down).
const WORD = JSON.parse(await readFile(new URL('./wordmark.json', import.meta.url), 'utf8'));
const [wx0, wy0, wx1, wy1] = WORD.bbox;

const head = (viewBox, stroke, width = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" fill="none" stroke="${stroke}"${width && ` stroke-width="${width}"`} stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="Flowly">`;
const mark = (color) => `${head('0 0 64 64', color, 4)}\n  ${MARK}\n</svg>\n`;
const small = (color) => `${head('0 0 20 20', color, 1.5)}\n  ${SMALL.replaceAll('currentColor', color)}\n</svg>\n`;
const pad = (wy1 - wy0) * 0.04;
const word = (color) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${wx0 - pad} ${wy0 - pad} ${wx1 - wx0 + 2 * pad} ${wy1 - wy0 + 2 * pad}" fill="${color}" role="img" aria-label="Flowly">\n  <path d="${WORD.d}"/>\n</svg>\n`;
// Lockup: the cap height is 30 units (55% of the mark), the baseline 15 units below the mark's centre, 14 units after the mark.
// At this scale Inter Medium's stem is about 4.4 units, close to the mark's 4-unit line.
const ws = 30 / -wy0;
const lockupWidth = 74 + (wx1 - wx0) * ws + 3 - 2;
const lockup = (color) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="2 0 ${lockupWidth.toFixed(2)} 64" role="img" aria-label="Flowly">\n  <g fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">\n  ${MARK}\n  </g>\n  <path fill="${color}" transform="translate(${(74 - wx0 * ws).toFixed(2)} 47) scale(${ws.toFixed(5)})" d="${WORD.d}"/>\n</svg>\n`;
// App icon (512): rounded-square background with the line mark centred; tiles up to 48 px use the small mark, larger.
const tile = (bg, color, art, width, transform) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="Flowly">\n  <rect width="512" height="512" rx="112" fill="${bg}"/>\n  <g transform="${transform}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round">\n  ${art}\n  </g>\n</svg>\n`;
const icon = (bg, color) => tile(bg, color, MARK, 4, 'translate(83.2 83.2) scale(5.4)');
const iconSmall = (bg, color) => tile(bg, color, SMALL.replaceAll('currentColor', color), 1.5, 'translate(48 48) scale(20.8)');

const files = {
  'flowly-mark.svg': mark('currentColor'), 'flowly-mark-light.svg': mark(INK), 'flowly-mark-dark.svg': mark(PAPER),
  'flowly-mark-small.svg': small('currentColor'), 'flowly-mark-small-light.svg': small(INK), 'flowly-mark-small-dark.svg': small(PAPER),
  'flowly-wordmark.svg': word('currentColor'), 'flowly-wordmark-light.svg': word(INK), 'flowly-wordmark-dark.svg': word(PAPER),
  'flowly-lockup.svg': lockup('currentColor'), 'flowly-lockup-light.svg': lockup(INK), 'flowly-lockup-dark.svg': lockup(PAPER),
  'flowly-icon-light.svg': icon('#FFFFFF', INK), 'flowly-icon-dark.svg': icon(INK, PAPER),
  'flowly-icon-small-light.svg': iconSmall('#FFFFFF', INK), 'flowly-icon-small-dark.svg': iconSmall(INK, PAPER),
};

const dir = new URL('./logo/', import.meta.url).pathname;
const out = `${dir}png/`;
await mkdir(out, { recursive: true });
for (const [name, svg] of Object.entries(files)) await writeFile(dir + name, svg);

// [source svg, output png, width, height]
const jobs = [];
for (const theme of ['light', 'dark']) {
  for (const size of [16, 32, 48]) jobs.push([`flowly-icon-small-${theme}.svg`, `flowly-icon-${theme}-${size}.png`, size, size]);
  for (const size of [64, 128, 256, 512, 1024]) jobs.push([`flowly-icon-${theme}.svg`, `flowly-icon-${theme}-${size}.png`, size, size]);
  jobs.push([`flowly-mark-${theme}.svg`, `flowly-mark-${theme}-512.png`, 512, 512]);
  // The 20 pt welcome tour title icon at 1x, 2x and 3x, so no screen scales it (scaling 60 px down to 40 blurs it).
  for (const size of [20, 40, 60]) jobs.push([`flowly-mark-small-${theme}.svg`, `flowly-mark-small-${theme}-${size}.png`, size, size]);
  jobs.push([`flowly-lockup-${theme}.svg`, `flowly-lockup-${theme}-1200.png`, 1200, Math.round((1200 * 64) / lockupWidth)]);
}

const { chromium } = await import(process.env.PLAYWRIGHT ?? 'playwright');
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const [file, png, width, height] of jobs) {
    await page.setViewportSize({ width, height });
    const svg = files[file].replace('<svg ', `<svg width="${width}" height="${height}" style="display:block" `);
    await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${svg}</body></html>`);
    await page.screenshot({ path: out + png, omitBackground: true, clip: { x: 0, y: 0, width, height } });
  }
  const sheet = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
  await sheet.addInitScript((value) => { window.__SVGS = value; }, files);
  await sheet.goto(`file://${dir}sheet.html`);
  await sheet.waitForLoadState('networkidle');
  await sheet.screenshot({ path: `${dir}overview.png`, fullPage: true });
} finally {
  await browser.close();
}
await promisify(execFile)('magick', [16, 32, 48].map((s) => `${out}flowly-icon-light-${s}.png`).concat(`${dir}favicon.ico`));
// The client inlines these six, so keep them small: the mark is one colour, so keep only its alpha at 16 levels
// (still anti-aliased at 20 px) and paint it with the theme colour. Posterizing the screenshot in place drops the colour.
for (const [theme, color] of [['light', INK], ['dark', PAPER]]) for (const size of [20, 40, 60]) {
  const png = `${out}flowly-mark-small-${theme}-${size}.png`;
  const alpha = `${out}.alpha-${theme}.png`;
  await promisify(execFile)('magick', [png, '-alpha', 'extract', '-posterize', '16', alpha]);
  await promisify(execFile)('magick', ['-size', `${size}x${size}`, `xc:${color}`, alpha, '-alpha', 'off', '-compose', 'CopyOpacity', '-composite', '-strip', '-define', 'png:compression-level=9', '-define', 'png:compression-filter=5', png]);
  await rm(alpha);
}
const b64 = async (name) => (await readFile(out + name)).toString('base64');
const densities = async (theme) => `{ 1: "${await b64(`flowly-mark-small-${theme}-20.png`)}", 2: "${await b64(`flowly-mark-small-${theme}-40.png`)}", 3: "${await b64(`flowly-mark-small-${theme}-60.png`)}" }`;
await writeFile(
  new URL('../../client/flowly-mark-data.ts', import.meta.url),
  `// Generated by docs/brand/export-logo.mjs from the small Flowly mark; do not edit by hand.\n` +
    `// The 20 pt welcome tour title icon as PNGs at 1x, 2x and 3x (20, 40, 60 px): ink for light themes, paper for dark ones.\n` +
    `export const flowlyMarkPng = {\n  light: ${await densities('light')},\n  dark: ${await densities('dark')},\n} as const;\n`,
);
console.log(`${Object.keys(files).length} SVGs, ${jobs.length} PNGs, favicon.ico, overview.png and client/flowly-mark-data.ts written`);
