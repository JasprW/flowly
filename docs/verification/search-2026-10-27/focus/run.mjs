import { launch, hidePrivate, SIDEBAR_WIDTH } from '/Users/bofan.wang/Developer/personal/paseo-utlra-kanban/docs/promo/shot-lib.mjs';
const out = process.argv[2];
const note = (k, v) => console.log(`${k}: ${v}`);
const browser = await launch();
async function openBoard(w, h) {
  const context = await browser.newContext({ viewport: { width: 1700, height: 1000 }, deviceScaleFactor: 2 });
  await context.grantPermissions(['local-network-access'], { origin: 'https://app.paseo.sh' });
  const page = await context.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  await page.goto('https://app.paseo.sh', { waitUntil: 'networkidle', timeout: 45000 });
  await page.getByText('Flowly', { exact: true }).first().click(); await page.waitForTimeout(3000);
  if (await page.getByText(/Agents can search them too/).count()) { await page.keyboard.press('Escape'); await page.waitForTimeout(1000); }
  await page.getByText('Tinylink', { exact: true }).first().click();
  await page.getByRole('button', { name: /Open task/ }).first().waitFor(); await page.waitForTimeout(2500);
  if (w !== 1700) { await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(2500); }
  await hidePrivate(page, 'Tinylink');
  return { page, context, errors };
}
const right = async (page, loc, minX) => { for (let i = 0; i < await loc.count(); i++) { const b = await loc.nth(i).boundingBox(); if (b && b.x > minX) return loc.nth(i); } return null; };
// Is an element with this text inside the visible window (any scroll container)?
const visible = (page, text) => page.evaluate((text) => {
  const all = [...document.querySelectorAll('div,span')].filter((el) => el.children.length === 0 && el.textContent.includes(text));
  return all.some((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth; });
}, text);
async function hitCase(s, { name, chip, query, label, expect, minX, shot }) {
  const { page } = s;
  const searchBtn = await right(page, page.getByRole('button', { name: /^Search/ }), minX - 300);
  if (!(await page.getByPlaceholder('Search cards, notes and deliverables').count())) { await searchBtn.click(); await page.waitForTimeout(1200); }
  const box = page.getByPlaceholder('Search cards, notes and deliverables');
  await page.getByText(chip, { exact: true }).first().click(); await page.waitForTimeout(400);
  await box.fill(query); await page.waitForTimeout(2200);
  const hit = await right(page, page.getByRole('button', { name: new RegExp(`^${label}:`) }), minX);
  note(`${name}: hit row found`, !!hit);
  if (!hit) return;
  await hit.click(); await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/${shot}-ring.png`, clip: minX > 0 ? { x: SIDEBAR_WIDTH, y: 0, width: 1700 - SIDEBAR_WIDTH, height: 1000 } : undefined });
  await page.waitForTimeout(1800);
  note(`${name}: target visible`, await visible(page, expect));
  await page.screenshot({ path: `${out}/${shot}.png`, clip: minX > 0 ? { x: SIDEBAR_WIDTH, y: 0, width: 1700 - SIDEBAR_WIDTH, height: 1000 } : undefined });
  await page.getByText(chip, { exact: true }).first().click().catch(() => {}); // unselect chip for the next case
}
try {
  let s = await openBoard(1700, 1000);
  const cases = [
    { name: 'Summary', chip: 'Summaries', query: 'Rate-limit POST', label: 'Summary', expect: 'Delivered to In review', shot: 'd-summary' },
    { name: 'Note', chip: 'Notes', query: 'clicks counter', label: 'Note', expect: 'clicks counter', shot: 'd-note' },
    { name: 'Workpad', chip: 'Workpads', query: 'limiter syntax', label: 'Workpad', expect: 'Check limiter syntax', shot: 'd-workpad' },
    { name: 'Idea', chip: 'Ideas', query: 'Redis', label: 'Idea', expect: 'Redis', shot: 'd-idea' },
  ];
  for (const c of cases) {
    // Back to the Search page with the drawer closed.
    await s.page.keyboard.press('Escape').catch(() => {}); await s.page.waitForTimeout(600);
    await hitCase(s, { ...c, minX: SIDEBAR_WIDTH + 20 });
  }
  // Stored preference untouched: open the click-counter card normally; Activity (closed by default) stays closed.
  await s.page.keyboard.press('Escape'); await s.page.waitForTimeout(600);
  const back = await right(s.page, s.page.getByRole('button', { name: /Back to board/ }), SIDEBAR_WIDTH);
  if (back) { await back.click(); await s.page.waitForTimeout(1000); }
  const card = await right(s.page, s.page.getByRole('button', { name: /^Open task Add click counter/ }), SIDEBAR_WIDTH);
  await card.click(); await s.page.waitForTimeout(3000);
  note('normal open: old note hidden (Activity back to its default)', !(await visible(s.page, 'store.js gets a clicks counter')));
  await s.page.screenshot({ path: `${out}/d-normal-open.png`, clip: { x: SIDEBAR_WIDTH, y: 0, width: 1700 - SIDEBAR_WIDTH, height: 1000 } });
  note('desktop page errors', JSON.stringify(s.errors));
  await s.context.close();
  // Compact
  s = await openBoard(430, 900);
  await hitCase(s, { name: 'Compact note', chip: 'Notes', query: 'clicks counter', label: 'Note', expect: 'clicks counter', minX: 0, shot: 'c-note' });
  note('compact page errors', JSON.stringify(s.errors));
  await s.context.close();
} finally { await browser.close(); }
