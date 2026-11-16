// Usage (from the repo root): node docs/verification/composer-016-2026-11-12/verify.mjs probe|fill|stage|overflow|draft
// Serves the desktop app's 0.16 web build (app-dist) under https://app.paseo.sh through Playwright routing, so the
// local daemon accepts its origin; nothing on disk or in daemon config changes. `stage` moves the Tinylink card
// "Add rate limiting to POST /shorten" In review -> Test -> In review. Never sends a message; clears the composer.
import { readFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { launch, open, openCard, shot } from '../../promo/shot-lib.mjs';
const DIST = '/Applications/Paseo.app/Contents/Resources/app-dist';
const types = { '.js': 'application/javascript', '.html': 'text/html', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.css': 'text/css', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' };
const out = new URL('./', import.meta.url).pathname;
export async function open016(browser, opts) {
  const orig = browser.newContext.bind(browser);
  browser.newContext = async (o) => {
    const ctx = await orig(o);
    await ctx.route('https://app.paseo.sh/**', async (route) => {
      const url = new URL(route.request().url());
      let p = join(DIST, decodeURIComponent(url.pathname));
      if (!existsSync(p) || statSync(p).isDirectory()) p = join(DIST, 'index.html');
      await route.fulfill({ status: 200, body: await readFile(p), headers: { 'content-type': types[extname(p)] ?? 'application/octet-stream' } });
    });
    return ctx;
  };
  return open(browser, opts);
}
if (process.argv[2] === 'probe') {
  const browser = await launch();
  try {
    const s = await open016(browser, { w: 1700, h: 1000 });
    console.log('has addComposerItem', await s.page.evaluate(() => [...document.scripts].map((x) => x.src).join(',')));
    await openCard(s, 'Add rate limiting to POST /shorten');
    await s.page.getByText('Haiku · Add rate limiting to POST /shorten').first().click({ button: 'right' }).catch(() => {});
    await s.page.waitForTimeout(800);
    await s.page.getByText('Open in Paseo', { exact: true }).last().click();
    await s.page.waitForTimeout(6000);
    console.log('url', s.page.url());
    await shot(s, out + 'w016-wide.png');
    console.log('errors', s.errors);
  } finally { await browser.close(); }
}
async function toSession(s) {
  await openCard(s, 'Add rate limiting to POST /shorten');
  await s.page.getByText('Haiku · Add rate limiting to POST /shorten').first().click({ button: 'right' }).catch(() => {});
  await s.page.waitForTimeout(800);
  await s.page.getByText('Open in Paseo', { exact: true }).last().click();
  await s.page.waitForTimeout(6000);
}
const box = (s) => s.page.locator('textarea[data-composer-input]').first();
const state = (s) => s.page.evaluate(() => { const t = document.querySelector('textarea[data-composer-input]'); return { value: t?.value, focused: document.activeElement === t, sel: t ? [t.selectionStart, t.selectionEnd] : null }; });
if (process.argv[2] === 'fill') {
  const browser = await launch();
  try {
    const s = await open016(browser, { w: 1700, h: 1000 });
    await toSession(s);
    await s.page.getByText('Next moves', { exact: true }).last().click();
    await s.page.waitForTimeout(1200);
    await shot(s, out + 'w016-next-moves-open.png');
    const opts = await s.page.evaluate(() => [...document.querySelectorAll('[role="option"],[role="menuitem"]')].map((n) => n.textContent.trim()).slice(0, 10));
    console.log('options', JSON.stringify(opts));
    await s.page.getByText('Add 429 tests', { exact: true }).last().click();
    await s.page.waitForTimeout(1200);
    console.log('after pick (empty box)', JSON.stringify(await state(s)));
    await shot(s, out + 'w016-filled.png');
    // Existing text: replace with "Draft", then pick again.
    await box(s).fill('Draft');
    await s.page.locator('body').click({ position: { x: 1000, y: 300 } });
    await s.page.getByText('Next moves', { exact: true }).last().click();
    await s.page.waitForTimeout(1000);
    await s.page.getByText('Verify with Luna', { exact: true }).last().click();
    await s.page.waitForTimeout(1200);
    console.log('after pick (Draft)', JSON.stringify(await state(s)));
    await box(s).fill('');
    console.log('cleared', JSON.stringify(await state(s)));
    console.log('errors', s.errors);
  } finally { await browser.close(); }
}
if (process.argv[2] === 'stage') {
  const browser = await launch();
  try {
    const s = await open016(browser, { w: 1700, h: 1000 });
    await toSession(s);
    const pick = async (from, to) => {
      await s.page.getByText(from, { exact: true }).last().click();
      await s.page.waitForTimeout(1000);
      if (to === 'Test') await shot(s, out + 'w016-stage-open.png');
      await s.page.getByText(to, { exact: true }).last().click();
      await s.page.waitForTimeout(2500);
      const txt = await s.page.evaluate(() => document.body.innerText);
      console.log(`${from} -> ${to}: toast=${/Moved to/.test(txt)} control=${JSON.stringify((txt.match(/Moved to [A-Za-z ]+/) || [''])[0])}`);
    };
    await pick('In review', 'Test');
    await s.page.waitForTimeout(4000);
    await pick('Test', 'In review');
    console.log('errors', s.errors);
  } finally { await browser.close(); }
}
if (process.argv[2] === 'narrow') {
  const browser = await launch();
  try {
    const s = await open016(browser, { w: 1000, h: 900 });
    await toSession(s);
    await shot(s, out + 'w016-narrow.png');
    const labels = await s.page.evaluate(() => [...document.querySelectorAll('[aria-label]')].map((n) => n.getAttribute('aria-label')).filter((l) => /more|overflow|option/i.test(l)));
    console.log('labels', JSON.stringify(labels));
    console.log('errors', s.errors);
  } finally { await browser.close(); }
}
if (process.argv[2] === 'narrow2') {
  const browser = await launch();
  try {
    const s = await open016(browser, { w: 1700, h: 1000 });
    await toSession(s);
    for (const w of [1100, 800]) {
      await s.page.setViewportSize({ width: w, height: 1000 });
      await s.page.waitForTimeout(2500);
      const vis = await s.page.evaluate(() => ['In review', 'Next moves'].map((t) => [...document.querySelectorAll('*')].some((n) => !n.children.length && n.textContent.trim() === t && n.getBoundingClientRect().width > 0 && n.getBoundingClientRect().y > 800)));
      console.log(w, 'inline [stage, next]', JSON.stringify(vis));
      await s.page.screenshot({ path: out + `w016-narrow-${w}.png`, clip: { x: w > 1000 ? 320 : 0, y: 600, width: w > 1000 ? w - 320 : w, height: 400 } });
    }
    const btns = await s.page.evaluate(() => [...document.querySelectorAll('[aria-label]')].filter((n) => n.getBoundingClientRect().y > 850).map((n) => n.getAttribute('aria-label')));
    console.log('bottom labels', JSON.stringify(btns));
    console.log('errors', s.errors);
  } finally { await browser.close(); }
}
if (process.argv[2] === 'overflow') {
  const browser = await launch();
  try {
    const s = await open016(browser, { w: 1700, h: 1000 });
    await toSession(s);
    await s.page.setViewportSize({ width: 800, height: 1000 });
    await s.page.waitForTimeout(2500);
    await s.page.locator('[aria-label^="Select model"]').last().click();
    await s.page.waitForTimeout(1500);
    const txt = await s.page.evaluate(() => [...document.querySelectorAll('*')].filter((n) => !n.children.length && n.getBoundingClientRect().x >= 320 && n.getBoundingClientRect().width > 0).map((n) => n.textContent.trim()).filter(Boolean).slice(-40));
    console.log('visible', JSON.stringify(txt));
    await s.page.screenshot({ path: out + 'w016-overflow-800.png', clip: { x: 320, y: 0, width: 480, height: 1000 } });
    const has = (t) => s.page.getByText(t, { exact: true }).last();
    if (await has('Next moves').isVisible().catch(() => false)) {
      await has('Next moves').click();
      await s.page.waitForTimeout(1200);
      await s.page.screenshot({ path: out + 'w016-overflow-next-800.png', clip: { x: 320, y: 0, width: 480, height: 1000 } });
      await has('Add 429 tests').click();
      await s.page.waitForTimeout(1500);
      console.log('after pick', JSON.stringify(await state(s)));
      await box(s).fill('');
      console.log('cleared', JSON.stringify(await state(s)));
    }
    console.log('errors', s.errors);
  } finally { await browser.close(); }
}
if (process.argv[2] === 'draft') {
  const browser = await launch();
  try {
    const s = await open016(browser, { w: 1700, h: 1000 });
    await toSession(s);
    const labelsBefore = await s.page.evaluate(() => [...document.querySelectorAll('[aria-label]')].map((n) => n.getAttribute('aria-label')).filter((l) => /new|tab|draft|agent/i.test(l) && !/workspace for/i.test(l)).slice(0, 30));
    console.log('labels', JSON.stringify(labelsBefore));
    await s.page.locator('[aria-label*="New agent" i], [aria-label*="new tab" i], [aria-label*="New session" i]').first().click({ timeout: 8000 });
    await s.page.waitForTimeout(3000);
    await s.page.getByText('Agent', { exact: true }).first().click();
    await s.page.waitForTimeout(3000);
    const bottom = await s.page.evaluate(() => [...document.querySelectorAll('*')].filter((n) => !n.children.length && n.getBoundingClientRect().y > 800 && n.getBoundingClientRect().x > 320).map((n) => n.textContent.trim()).filter(Boolean));
    console.log('draft toolbar', JSON.stringify(bottom), 'url', s.page.url());
    await shot(s, out + 'w016-draft.png');
    console.log('errors', s.errors);
  } finally { await browser.close(); }
}
