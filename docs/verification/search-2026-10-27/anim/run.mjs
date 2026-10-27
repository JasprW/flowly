import { launch, hidePrivate, SIDEBAR_WIDTH } from '/Users/bofan.wang/Developer/personal/paseo-utlra-kanban/docs/promo/shot-lib.mjs';
const out = process.argv[2];
const note = (k, v) => console.log(`${k}: ${v}`);
const browser = await launch();
try {
  const context = await browser.newContext({ viewport: { width: 1700, height: 1000 }, deviceScaleFactor: 2 });
  await context.grantPermissions(['local-network-access'], { origin: 'https://app.paseo.sh' });
  const page = await context.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  await page.goto('https://app.paseo.sh', { waitUntil: 'networkidle', timeout: 45000 });
  await page.getByText('Flowly', { exact: true }).first().click(); await page.waitForTimeout(3000);
  if (await page.getByText(/Agents can search them too/).count()) { await page.keyboard.press('Escape'); await page.waitForTimeout(1000); }
  await page.getByText('Tinylink', { exact: true }).first().click();
  await page.getByRole('button', { name: /Open task/ }).first().waitFor(); await page.waitForTimeout(2500);
  await hidePrivate(page, 'Tinylink');
  await page.keyboard.press('s'); await page.waitForTimeout(1200);
  const box = page.getByPlaceholder('Search cards, notes and deliverables');
  await box.fill('limit'); await page.waitForTimeout(2500);
  // Lowest opacity seen on any ancestor of the first result title, sampled every animation frame for 600 ms.
  const sample = () => page.evaluate(() => new Promise((resolve) => {
    const seen = []; const start = performance.now();
    const step = () => {
      const el = [...document.querySelectorAll('div')].find((d) => d.children.length === 0 && /rate limiting/i.test(d.textContent) && d.getBoundingClientRect().left > 320 && d.getBoundingClientRect().left < 1300);
      let min = 1; for (let n = el; n; n = n.parentElement) min = Math.min(min, Number(getComputedStyle(n).opacity));
      seen.push(el ? min : -1);
      if (performance.now() - start < 600) requestAnimationFrame(step); else resolve(seen);
    };
    step();
  }));
  for (const [name, act] of [
    ['source chip Workpads', () => page.getByText('Workpads', { exact: true }).first().click()],
    ['scope All projects', () => page.getByText('All projects', { exact: true }).first().click()],
    ['query edit', () => box.fill('limiter')],
  ]) {
    const p = sample(); await act(); const seen = await p;
    const valid = seen.filter((v) => v >= 0);
    note(`${name}: frames ${seen.length}, min opacity ${Math.min(...valid).toFixed(2)}, last ${valid[valid.length - 1]?.toFixed(2)}`);
    await page.waitForTimeout(800);
  }
  await page.screenshot({ path: `${out}/after.png`, clip: { x: SIDEBAR_WIDTH, y: 0, width: 1700 - SIDEBAR_WIDTH, height: 1000 } });
  note('page errors', JSON.stringify(errors));
  await context.close();
} finally { await browser.close(); }
