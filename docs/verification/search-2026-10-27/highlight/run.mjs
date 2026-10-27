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
// Marked words in the drawer: bold accent spans outside the Search page's hit rows.
const marks = (page, minX) => page.evaluate((minX) => {
  const hitRow = (el) => { for (let n = el; n; n = n.parentElement) { const l = n.getAttribute && n.getAttribute('aria-label'); if (l && /^(Summary|Note|Workpad|Idea|Deliverable):/.test(l)) return true; } return false; };
  return [...document.querySelectorAll('span,div')].filter((el) => {
    if (el.children.length) return false;
    const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
    return cs.fontWeight === '600' && r.width > 0 && r.left >= minX && el.textContent.trim() && el.parentElement && el.parentElement.textContent.length > el.textContent.length && !hitRow(el);
  }).map((el) => ({ word: el.textContent, around: el.parentElement.textContent.slice(0, 80) }));
}, minX);
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
  await hit.click();
  await page.waitForTimeout(5000); // past the ring and the focus timers: marks must remain
  const m = await marks(page, minX);
  note(`${name}: marks after 5 s`, JSON.stringify(m));
  note(`${name}: target text visible`, await visible(page, expect));
  await page.screenshot({ path: `${out}/${shot}.png`, clip: minX > 0 ? { x: SIDEBAR_WIDTH, y: 0, width: 1700 - SIDEBAR_WIDTH, height: 1000 } : undefined });
  await page.getByText(chip, { exact: true }).first().click().catch(() => {});
}
try {
  let s = await openBoard(1700, 1000);
  const cases = [
    { name: 'Summary', chip: 'Summaries', query: 'Rate-limit POST', label: 'Summary', expect: 'Show less', shot: 'd-summary' },
    { name: 'Note', chip: 'Notes', query: 'clicks counter', label: 'Note', expect: 'clicks counter', shot: 'd-note' },
    { name: 'Workpad', chip: 'Workpads', query: 'limiter syntax', label: 'Workpad', expect: 'Hide output', shot: 'd-workpad' },
    { name: 'Idea', chip: 'Ideas', query: 'Redis', label: 'Idea', expect: 'Redis', shot: 'd-idea' },
  ];
  for (const c of cases) {
    await s.page.keyboard.press('Escape').catch(() => {}); await s.page.waitForTimeout(600);
    await hitCase(s, { ...c, minX: SIDEBAR_WIDTH + 20 });
  }
  // Closing the sidebar and reopening the card normally: no marks.
  await s.page.keyboard.press('Escape'); await s.page.waitForTimeout(600);
  const back = await right(s.page, s.page.getByRole('button', { name: /Back to board/ }), SIDEBAR_WIDTH);
  if (back) { await back.click(); await s.page.waitForTimeout(1000); }
  const card = await right(s.page, s.page.getByRole('button', { name: /^Open task Add rate limiting/ }), SIDEBAR_WIDTH);
  if (card) { await card.click(); await s.page.waitForTimeout(3000); }
  note('normal reopen: marks', JSON.stringify(await marks(s.page, SIDEBAR_WIDTH + 20)));
  await s.page.screenshot({ path: `${out}/d-normal-open.png`, clip: { x: SIDEBAR_WIDTH, y: 0, width: 1700 - SIDEBAR_WIDTH, height: 1000 } });
  note('desktop page errors', JSON.stringify(s.errors));
  await s.context.close();
  s = await openBoard(430, 900);
  await hitCase(s, { name: 'Compact note', chip: 'Notes', query: 'clicks counter', label: 'Note', expect: 'clicks counter', minX: 0, shot: 'c-note' });
  note('compact page errors', JSON.stringify(s.errors));
  await s.context.close();
} finally { await browser.close(); }
