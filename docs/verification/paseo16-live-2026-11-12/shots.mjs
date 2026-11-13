import { launch, open, openCard, shot, pageText } from '../../promo/shot-lib.mjs';
const browser = await launch();
try {
  const s = await open(browser, { w: 1500, h: 950, project: 'p16 live e2e' });
  await shot(s, new URL('./board.png', import.meta.url).pathname);
  const board = await pageText(s);
  console.log('board has label:', board.includes('Background tasks running'));
  await openCard(s, 'Write HELLO.md');
  await new Promise((r) => setTimeout(r, 2500));
  await shot(s, new URL('./card.png', import.meta.url).pathname);
  const t = await pageText(s);
  console.log('drawer has label:', t.includes('Background tasks running'));
  const i = t.indexOf('Background tasks running'); if (i >= 0) console.log(t.slice(Math.max(0, i - 200), i + 100));
} finally { await browser.close(); }
