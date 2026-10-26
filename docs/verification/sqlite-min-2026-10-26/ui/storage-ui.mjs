import { launch, open, shot, pageText } from '/Users/bofan.wang/Developer/personal/paseo-utlra-kanban/docs/promo/shot-lib.mjs';
const out = '/Users/bofan.wang/Developer/personal/paseo-utlra-kanban/docs/verification/sqlite-min-2026-10-26/ui/';
const browser = await launch();
const result = {};
try {
  for (const [name, w, h] of [['desktop', 1700, 1000], ['compact', 1000, 900]]) {
    const s = await open(browser, { w: 1700, h: 1000, project: 'Tinylink' });
    if (w !== 1700) { await s.page.setViewportSize({ width: w, height: h }); s.w = w; s.h = h; s.clip = { ...s.clip, width: w - s.clip.x, height: h }; await s.page.waitForTimeout(1500); }
    await s.page.locator('[aria-label="Flowly settings"]').last().click(); await s.page.waitForTimeout(1200);
    await s.page.getByRole('button', { name: 'Storage', exact: true }).first().click(); await s.page.waitForTimeout(2500);
    await shot(s, `${out}${name}-storage.png`);
    const text = await pageText(s);
    const restore = s.page.getByText('Restore…', { exact: true }).first();
    let confirm = null;
    if (await restore.count()) {
      await restore.click(); await s.page.waitForTimeout(800);
      await shot(s, `${out}${name}-restore-confirm.png`);
      confirm = (await pageText(s)).split('\n').find((l) => l.startsWith('The board goes back to')) ?? null;
      await s.page.locator('text="Cancel" >> visible=true').last().click(); await s.page.waitForTimeout(500);
    }
    result[name] = { errors: s.errors, hasStorage: text.includes('Board data'), backend: ['SQLite', 'JSON file', 'Needs attention'].find((x) => text.split('\n').includes(x)) ?? null, backups: (text.match(/flowly-\d{8}-\d{6}(-\d+)?\.sqlite/g) || []).length, confirm };
    await s.context.close();
  }
} finally { await browser.close(); }
console.log(JSON.stringify(result, null, 1));
