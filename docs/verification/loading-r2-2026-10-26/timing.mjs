import { launch } from '../../promo/shot-lib.mjs';
const label = process.argv[2] || 'run', project = process.argv[3] || 'Flowly', runs = Number(process.argv[4] || 3);
const browser = await launch();
const out = [];
for (let i = 0; i < runs; i++) {
  const context = await browser.newContext({ viewport: { width: 1700, height: 1000 }, deviceScaleFactor: 1, locale: 'en-US' });
  await context.grantPermissions(['local-network-access'], { origin: 'https://app.paseo.sh' });
  const page = await context.newPage();
  let bytes = 0, counting = false;
  page.on('websocket', ws => ws.on('framereceived', f => { if (counting) bytes += typeof f.payload === 'string' ? Buffer.byteLength(f.payload) : f.payload.length; }));
  await page.goto('https://app.paseo.sh', { waitUntil: 'networkidle', timeout: 45000 });
  counting = true;
  const t0 = Date.now();
  await page.getByText('Flowly', { exact: true }).first().click();
  await page.getByText(project, { exact: true }).first().click();
  await page.getByRole('button', { name: /Open task/ }).first().waitFor({ timeout: 60000 });
  const firstCard = Date.now() - t0;
  await page.waitForTimeout(10000); // three overview/board polls
  out.push({ firstCardMs: firstCard, receivedKB10s: Math.round(bytes / 1024) });
  await context.close();
}
await browser.close();
console.log(JSON.stringify({ label, project, runs: out }));
