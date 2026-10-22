// Release screenshots of the Tinylink demo project, via the shared shot-lib.mjs (crops the host sidebar, hides other projects' tabs).
// Usage: node docs/promo/shots.mjs [names…]   (no names = all)
import { mkdir } from 'node:fs/promises';
import { launch, open as openPage, shot as shotTo } from './shot-lib.mjs';
const out = new URL('./screenshots/', import.meta.url).pathname;
await mkdir(out + 'i18n/', { recursive: true });
await mkdir(out + 'settings/', { recursive: true });
const only = process.argv.slice(2).length ? new Set(process.argv.slice(2)) : null;
const want = (n) => !only || only.has(n);
const browser = await launch();

const open = (opts) => openPage(browser, opts);
const shot = (s, name, clip) => shotTo(s, out + name + '.png', clip);
const button = (p, re) => p.getByRole('button', { name: re }).first();

if (want('board')) {
  for (const scheme of ['light', 'dark']) {
    const s = await open({ w: 2300, h: 820, scheme });
    await shot(s, scheme === 'light' ? '01-board-auto-status' : '01-board-auto-status-dark');
    await s.context.close();
  }
}
if (want('drawers')) {
  const s = await open({ w: 1700, h: 1000 });
  await button(s.page, /^Open task Expired links/).click(); await s.page.waitForTimeout(2500); await shot(s, '02-needs-you-drawer');
  await s.page.keyboard.press('Escape'); await s.page.waitForTimeout(700);
  await button(s.page, /^Open task Add rate limiting/).click(); await s.page.waitForTimeout(2500);
  await s.page.getByText('Show more', { exact: true }).first().click().catch(() => {}); await s.page.waitForTimeout(800); await shot(s, '03-card-summary');
  await s.context.close();
}
if (want('ideas')) {
  const s = await open({ w: 1700, h: 1000 });
  await button(s.page, /Project ideas/).click(); await s.page.waitForTimeout(2500); await shot(s, '04-ideas-inbox');
  await s.page.getByText('Good idea', { exact: true }).first().click(); await s.page.waitForTimeout(1200); await shot(s, '04b-good-idea-two-paths');
  await s.context.close();
}
if (want('next-moves')) { // needs `node docs/promo/next-moves.mjs setup`; its session ends its turn with three suggested moves
  const s = await open({ w: 1700, h: 1000 });
  await s.page.getByText('Tinylink', { exact: true }).first().click(); await s.page.waitForTimeout(1500);
  await button(s.page, /^Open task Add rate limiting/).click(); await s.page.getByText('Haiku · Add rate limiting').first().waitFor({ timeout: 15000 });
  for (let i = 0; i < 60 && (await s.page.getByText('Running', { exact: false }).first().isVisible().catch(() => false)); i++) await s.page.waitForTimeout(3000);
  await s.page.getByText('Haiku · Add rate limiting').first().click(); await s.page.waitForTimeout(3500);
  await shot(s, '06-next-moves', { x: 1262, y: 545, width: 438, height: 455 });
  await s.context.close();
}
if (want('insights')) {
  for (const scheme of ['light', 'dark']) {
    const s = await open({ w: 1700, h: 1500, scheme });
    await button(s.page, /Project insights/).click(); await s.page.waitForTimeout(3500);
    await shot(s, scheme === 'light' ? '05-insights' : '05-insights-dark');
    await s.context.close();
  }
}
if (want('settings')) {
  const s = await open({ w: 1700, h: 1000 });
  await s.page.locator('[aria-label="Flowly settings"]').last().click(); await s.page.waitForTimeout(1200);
  const box = { x: 320, y: 50, width: 1060, height: 880 };
  await s.page.getByRole('button', { name: 'Models', exact: true }).first().click(); await s.page.waitForTimeout(6000); await shot(s, 'settings/models', box);
  await s.page.getByRole('button', { name: 'Workflow', exact: true }).first().click(); await s.page.waitForTimeout(1500); await shot(s, 'settings/workflow', box);
  await s.context.close();
}
if (want('i18n')) {
  for (const locale of ['ja-JP', 'de-DE', 'zh-CN', 'ru-RU']) {
    const s = await open({ w: 1700, h: 1000, locale });
    await shot(s, `i18n/${locale}-board`);
    await s.context.close();
  }
}
await browser.close();
console.log('done');
