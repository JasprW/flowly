import { launch, shot, pageText, hidePrivate, SIDEBAR_WIDTH } from '/Users/bofan.wang/Developer/personal/paseo-utlra-kanban/docs/promo/shot-lib.mjs';
// shot-lib's open(), plus closing a What's new dialog that may cover the board (and a screenshot of it).
async function open(browser, { w, h, project = 'Tinylink', url = 'https://app.paseo.sh' }) {
  const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, colorScheme: 'light', locale: 'en-US' });
  await context.grantPermissions(['local-network-access'], { origin: url });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
  await page.getByText('Flowly', { exact: true }).first().click();
  await page.waitForTimeout(3000);
  const s = { page, context, errors, w, h, project, clip: { x: SIDEBAR_WIDTH, y: 0, width: w - SIDEBAR_WIDTH, height: h } };
  if (await page.getByText(/Agents can search them too/).count()) {
    await page.screenshot({ path: `${process.argv[2]}/whats-new-${w}.png`, clip: s.clip.width > 0 && w > 800 ? s.clip : undefined });
    console.log('whats-new shown', true);
    const close = page.getByRole('button', { name: /^(Got it|Close|Done)$/ });
    if (await close.count()) await close.first().click(); else await page.keyboard.press('Escape');
    await page.waitForTimeout(1500);
  }
  await page.getByText(project, { exact: true }).first().click();
  await page.getByRole('button', { name: /Open task/ }).first().waitFor();
  await page.waitForTimeout(3500);
  await hidePrivate(page, project);
  return s;
}
import { writeFileSync, mkdirSync } from 'node:fs';
const out = process.argv[2]; mkdirSync(out, { recursive: true });
const log = []; const note = (k, v) => { log.push(`${k}: ${v}`); console.log(k, v); };
const browser = await launch();
try {
  // Desktop
  let s = await open(browser, { w: 1700, h: 1000 });
  const btn = s.page.getByRole('button', { name: /^Search \(S\)$/ });
  note('desktop search button', await btn.count());
  await btn.first().click(); await s.page.waitForTimeout(1200);
  const box = s.page.getByPlaceholder('Search cards, notes and deliverables').first();
  note('search box focused', await box.evaluate((el) => el === document.activeElement));
  await shot(s, `${out}/desktop-1-empty.png`);
  await box.type('n'); await s.page.waitForTimeout(800);
  note('typing n opened New task dialog', await s.page.getByText('New task', { exact: true }).filter({ visible: true }).count() > 1);
  await box.fill(''); await box.type('rate limit'); await s.page.waitForTimeout(2500);
  await shot(s, `${out}/desktop-2-results.png`);
  const text = await pageText(s); writeFileSync(`${out}/desktop-results.txt`, text);
  note('results contain rate limiting card', /rate limiting/i.test(text));
  await s.page.getByText('All projects', { exact: true }).first().click(); await s.page.waitForTimeout(2000);
  await shot(s, `${out}/desktop-3-all-projects.png`);
  await s.page.getByText('Notes', { exact: true }).first().click(); await s.page.waitForTimeout(1500);
  await shot(s, `${out}/desktop-4-notes-only.png`);
  await s.page.getByText('Notes', { exact: true }).first().click(); await s.page.waitForTimeout(1500);
  await box.fill(''); await box.type('zzqx-nothing'); await s.page.waitForTimeout(2000);
  note('no results label', await s.page.getByText('No results', { exact: true }).count());
  await box.fill(''); await box.type('rate limit'); await s.page.waitForTimeout(2000);
  { const all = s.page.getByRole('button', { name: /Add rate limiting/ }); let hit = null;
    for (let i = 0; i < await all.count(); i++) { const b = await all.nth(i).boundingBox(); if (b && b.x > SIDEBAR_WIDTH + 40) { hit = all.nth(i); break; } }
    note('result button found right of sidebar', !!hit); await hit.click(); } await s.page.waitForTimeout(2500);
  await shot(s, `${out}/desktop-5-open-card.png`);
  note('search page still open with drawer', await s.page.getByPlaceholder('Search cards, notes and deliverables').count());
  await s.page.getByRole('button', { name: /Back to board/ }).first().click(); await s.page.waitForTimeout(1200);
  note('back to board: search box gone', (await s.page.getByPlaceholder('Search cards, notes and deliverables').count()) === 0);
  // S shortcut and Esc
  await s.page.keyboard.press('Escape'); await s.page.waitForTimeout(800);
  await s.page.mouse.click(900, 600); await s.page.waitForTimeout(300);
  await s.page.keyboard.press('s'); await s.page.waitForTimeout(1200);
  note('S opens search page', await s.page.getByPlaceholder('Search cards, notes and deliverables').count());
  await s.page.keyboard.type('abc'); await s.page.waitForTimeout(600);
  await s.page.keyboard.press('Escape'); await s.page.waitForTimeout(1000);
  note('Esc closes search page (box gone)', (await s.page.getByPlaceholder('Search cards, notes and deliverables').count()) === 0);
  note('desktop page errors', JSON.stringify(s.errors));
  await s.context.close();
  // Compact
  s = await open(browser, { w: 1700, h: 1000 });
  await s.page.setViewportSize({ width: 430, height: 900 }); await s.page.waitForTimeout(2500);
  const cbtn = s.page.getByRole('button', { name: /^Search/ });
  note('compact search button', await cbtn.count());
  await cbtn.first().click(); await s.page.waitForTimeout(1200);
  const cbox = s.page.getByPlaceholder('Search cards, notes and deliverables').first();
  await cbox.type('expired'); await s.page.waitForTimeout(2500);
  await s.page.screenshot({ path: `${out}/compact-1-results.png` });
  const ctext = await pageText(s); writeFileSync(`${out}/compact-results.txt`, ctext);
  note('compact results contain expired card', /expired links/i.test(ctext));
  note('compact page errors', JSON.stringify(s.errors));
  await s.context.close();
} finally { await browser.close(); writeFileSync(`${out}/log.txt`, log.join('\n') + '\n'); }
