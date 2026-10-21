// Compares small-size versions of the mark at true pixel sizes (no resampling): every size is rasterized by Chromium
// at 1x, then shown 1:1 and as pixel zooms, plus the 2x welcome tour title and the small app icon tiles.
// Usage: node docs/brand/render-small.mjs [set]   (default v11-small; reads logo-drafts/<set>/variants.json, writes overview.png)
// PLAYWRIGHT / CHROMIUM as in render-drafts.mjs.
import { readFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT ?? 'playwright');
const dir = new URL(`./logo-drafts/${process.argv[2] ?? 'v11-small'}/`, import.meta.url).pathname;
const variants = JSON.parse(await readFile(dir + 'variants.json', 'utf8'));
const out = dir + 'overview.png';
const INK = '#1E2120', PAPER = '#F3F1EC', LBG = '#FAFAFA', DBG = '#1E2120';
const SIZES = [16, 20, 24, 32, 40, 48, 60];
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM });
const svgOf = (v, color, px) => `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="${v.viewBox}" fill="none" stroke="${color}" stroke-width="${v.stroke}" stroke-linecap="round" stroke-linejoin="round" style="display:block">${v.body.replaceAll('currentColor', color)}</svg>`;
const tiles = {};
const tileOf = (v, bg, color, px) => `<div style="width:${px}px;height:${px}px;border-radius:${px * 0.22}px;background:${bg};display:flex;align-items:center;justify-content:center">${svgOf(v, color, Math.round(px * 0.68))}</div>`;
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const v of variants) for (const [t, color, bg] of [['l', INK, LBG], ['d', PAPER, DBG]]) for (const px of SIZES) {
  await page.setViewportSize({ width: px, height: px });
  await page.setContent(`<body style="margin:0;background:${bg}">${svgOf(v, color, px)}</body>`);
  tiles[`${v.id}-${t}-${px}`] = 'data:image/png;base64,' + (await page.screenshot({ clip: { x: 0, y: 0, width: px, height: px } })).toString('base64');
}
for (const v of variants) for (const [t, bg, color, page_] of [['l', '#FFFFFF', INK, LBG], ['d', INK, PAPER, '#3A3D3C']]) for (const px of [16, 32, 48]) {
  await page.setViewportSize({ width: px, height: px });
  await page.setContent(`<body style="margin:0;background:${page_}">${tileOf(v, bg, color, px)}</body>`);
  tiles[`${v.id}-${t}-tile${px}`] = 'data:image/png;base64,' + (await page.screenshot({ clip: { x: 0, y: 0, width: px, height: px } })).toString('base64');
}
const sheet = await browser.newPage({ viewport: { width: 1800, height: 800 }, deviceScaleFactor: 1 });
const row = (v) => `<div class="row"><div class="label"><b>${v.id}</b> ${v.name}<div class="note">${v.note}</div></div>
  ${['l', 'd'].map((t) => `<div class="cell ${t}">
    <div class="sizes">${SIZES.map((px) => `<img src="${tiles[`${v.id}-${t}-${px}`]}" width="${px}" height="${px}">`).join('')}</div>
    <div class="zooms"><img class="px" src="${tiles[`${v.id}-${t}-20`]}" width="120" height="120"><img class="px" src="${tiles[`${v.id}-${t}-40`]}" width="120" height="120"><img class="px" src="${tiles[`${v.id}-${t}-16`]}" width="96" height="96"></div>
    <div class="sizes">${[16, 32, 48].map((px) => `<img src="${tiles[`${v.id}-${t}-tile${px}`]}" width="${px}" height="${px}">`).join('')}<img class="px" src="${tiles[`${v.id}-${t}-tile16`]}" width="96" height="96"><span class="cap">App 图标 / favicon</span></div>
    <div class="title"><img src="${tiles[`${v.id}-${t}-40`]}" width="40" height="40"><span>Welcome to Flowly</span></div>
  </div>`).join('')}</div>`;
await sheet.setContent(`<!doctype html><meta charset="utf-8"><style>
 body{margin:0;padding:24px;background:#F7F5F2;font:14px -apple-system,"PingFang SC",sans-serif;color:#1E2120;width:1750px}
 .row{display:grid;grid-template-columns:260px 1fr 1fr;gap:14px;margin-bottom:14px;align-items:stretch}
 .label{font-size:15px}.note{font-size:12.5px;color:#55544f;margin-top:6px;line-height:1.5}
 .cell{border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:12px}
 .l{background:${LBG};border:1px solid #E4DFD8}.d{background:${DBG};color:#FAFAFA}
 .sizes,.zooms{display:flex;align-items:flex-end;gap:18px}.px{image-rendering:pixelated}.cap{font-size:12px;opacity:.6}
 .title{display:flex;align-items:center;gap:16px;font-size:28px;font-weight:500}
</style><body>${variants.map(row).join('')}<p style="color:#55544f">每格：16 / 20 / 24 / 32 / 40 / 48 / 60 px 原样像素；放大格依次是 20 px ×6、40 px ×3（2 倍屏上的 20 pt）、16 px ×6；第三行是 App 图标 16 / 32 / 48 px 和 16 px ×6；最后一行是 2 倍屏下欢迎页标题的样子（40 px 标志 + 28 px 字）。</p></body>`);
await sheet.screenshot({ path: out, fullPage: true });
await browser.close();
