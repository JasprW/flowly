// Ideas chip popover in a native session (wide layout): the title row stays put, only the ideas list scrolls, and the
// host's own scroll layer never overflows, so the mouse wheel has one target. Runs at a normal and a short window.
// Uses the permanent Tinylink fixture's "Add rate limiting to POST /shorten" card (2 open ideas); changes nothing.
//   node docs/verification/ideas-popover-scroll/check.mjs
import { writeFile } from 'node:fs/promises';
import { launch, open, shot } from '../../promo/shot-lib.mjs';

const workspaceId = 'wks_ba6ff18c509f409e';
const ideas = ['Share rate-limit state across instances with Redis', 'Make rate limit configurable via env vars'];
const out = new URL('./', import.meta.url).pathname;

// Every scroll container from the popover title up to the floating surface, plus those inside it.
const measure = (page) =>
  page.evaluate(() => {
    const title = [...document.querySelectorAll('div')].find((el) => el.textContent === 'Ideas for this card' && !el.children.length);
    if (!title) return null;
    const scrolls = (el) => ['auto', 'scroll'].includes(getComputedStyle(el).overflowY);
    const chain = [];
    for (let el = title; el && el !== document.body; el = el.parentElement) chain.push(el);
    const host = chain.filter(scrolls).at(-1);
    const inner = [...host.querySelectorAll('*')].filter(scrolls);
    const box = (el) => ({ clientHeight: el.clientHeight, scrollHeight: el.scrollHeight, scrollTop: Math.round(el.scrollTop), overflowing: el.scrollHeight > el.clientHeight + 1 });
    return { titleY: Math.round(title.getBoundingClientRect().y), host: box(host), inner: inner.map(box) };
  });

async function run(browser, h, name) {
  const s = await open(browser, { w: 1500, h });
  const { page } = s;
  const base = page.url().match(/^https:\/\/[^/]+\/h\/[^/]+/)?.[0];
  if (!base) throw new Error(`No host route in ${page.url()}`);
  await page.goto(`${base}/workspace/${workspaceId}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  const chip = page.getByRole('button', { name: 'Ideas for this card' });
  await chip.first().waitFor({ timeout: 30000 });
  await chip.first().click();
  await page.getByText('Ideas for this card', { exact: true }).last().waitFor();
  // Let the host's open animation finish: content that grows during it keeps the host's first height until the
  // popover is reopened (host behavior, menu-overlay.tsx useReleaseFixedMenuHeight), which is not what this checks.
  await page.waitForTimeout(1000);
  // Expanding an idea makes the content taller than the popover (one idea opens at a time).
  for (const title of ideas) {
    await page.getByRole('button', { name: title, exact: true }).last().click();
    await page.waitForTimeout(350);
  }
  // Back to the top, so the wheel has to carry the list the whole way.
  await page.evaluate(() => {
    const title = [...document.querySelectorAll('div')].find((el) => el.textContent === 'Ideas for this card' && !el.children.length);
    const scrolls = (el) => ['auto', 'scroll'].includes(getComputedStyle(el).overflowY);
    const chain = [];
    for (let el = title; el && el !== document.body; el = el.parentElement) chain.push(el);
    const host = chain.filter(scrolls).at(-1);
    for (const el of [host, ...host.querySelectorAll('*')]) if (el.scrollTop) el.scrollTop = 0;
  });
  await page.waitForTimeout(250);
  const before = await measure(page);
  await shot(s, `${out}${name}-top.png`);
  const box = await page.getByText('Ideas for this card', { exact: true }).last().boundingBox();
  await page.mouse.move(box.x + 120, box.y + 160);
  for (let i = 0; i < 14; i++) { await page.mouse.wheel(0, 240); await page.waitForTimeout(120); }
  await page.waitForTimeout(300);
  const after = await measure(page);
  await shot(s, `${out}${name}-bottom.png`);
  await s.context.close();
  const list = after?.inner.filter((x) => x.overflowing) ?? [];
  return {
    windowHeight: h,
    before,
    after,
    hostNeverOverflows: !before?.host.overflowing && !after?.host.overflowing,
    oneScrollingLayer: list.length === 1,
    titleStayed: before?.titleY === after?.titleY,
    listReachedEnd: list.length === 1 && list[0].scrollTop + list[0].clientHeight >= list[0].scrollHeight - 2,
    pageErrors: s.errors,
  };
}

const browser = await launch();
const result = {};
try {
  result.normal = await run(browser, 760, 'popover');
  result.short = await run(browser, 420, 'popover-short');
} finally {
  await browser.close();
}
await writeFile(`${out}result.json`, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
