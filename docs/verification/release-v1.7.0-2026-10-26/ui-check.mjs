// v1.7.0 release UI check: What's new left/right paging (desktop + compact) and every welcome tour page.
// Usage: node docs/verification/release-v1.7.0-2026-10-26/ui-check.mjs  (screenshots land next to this file)
import { launch, open, shot } from '../../promo/shot-lib.mjs';
const out = new URL('./', import.meta.url).pathname;
const browser = await launch();
const settings = async (s) => {
  await s.page.locator('[aria-label="Flowly settings"]').last().click(); await s.page.waitForTimeout(1200);
  await s.page.getByText('General', { exact: true }).last().click().catch(() => {}); await s.page.waitForTimeout(800);
};
const row = (s, name) => s.page.getByText(name, { exact: true }).last();
const results = [];
for (const [label, w, h] of [['compact', 750, 900], ['desktop', 1700, 1000]]) {
  // Enter the project at desktop width (the compact header has no project tab to click), then narrow the window.
  const s = await open(browser, { w: 1700, h: 1000 });
  if (w !== 1700) {
    await s.page.setViewportSize({ width: w, height: h }); await s.page.waitForTimeout(1500);
    Object.assign(s, { w, h, clip: { ...s.clip, width: w - s.clip.x, height: h } });
  }
  await settings(s);
  await row(s, "What's new").click(); await s.page.waitForTimeout(1500);
  await shot(s, `${out}whats-new-${label}-latest.png`);
  const older = s.page.getByRole('button', { name: 'Older release' }).last();
  const newer = s.page.getByRole('button', { name: 'Newer release' }).last();
  results.push({ label, newerDisabledOnLatest: await newer.isDisabled() });
  await older.click(); await s.page.waitForTimeout(120);
  await shot(s, `${out}whats-new-${label}-older-sliding.png`);
  await s.page.waitForTimeout(800);
  await shot(s, `${out}whats-new-${label}-older.png`);
  await older.click(); await s.page.waitForTimeout(900);
  results.push({ label, olderDisabledOnOldest: await older.isDisabled() });
  await shot(s, `${out}whats-new-${label}-oldest.png`);
  await newer.click(); await s.page.waitForTimeout(900);
  await shot(s, `${out}whats-new-${label}-back-newer.png`);
  await s.page.getByRole('button', { name: 'Got it' }).last().click(); await s.page.waitForTimeout(900);
  results.push({ label, closed: !(await s.page.getByRole('button', { name: 'Got it' }).count()) , errors: s.errors });
  if (label === 'desktop') {
    await settings(s);
    await row(s, 'Show welcome tour').click(); await s.page.waitForTimeout(1500);
    for (let i = 1; i <= 6; i++) {
      await shot(s, `${out}tour-page-${i}.png`);
      const next = s.page.getByRole('button', { name: 'Next', exact: true }).last();
      if (!(await next.count())) break;
      await next.click(); await s.page.waitForTimeout(1200);
    }
    await s.page.keyboard.press('Escape'); await s.page.waitForTimeout(800);
  }
  await s.context.close();
}
await browser.close();
console.log(JSON.stringify(results, null, 1));
