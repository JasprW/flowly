// UI step for live.mjs: node ui.mjs <step>. Board and drawer screenshots and text via shot-lib only; the Attention
// popover is read as text and only this card's lines are kept (it lists other projects' cards).
import { writeFile } from 'node:fs/promises';
import { launch, openCard, shot, pageText } from '../../promo/shot-lib.mjs';
import { open016 } from '../auto-review-status-2026-11-13/ui-lib.mjs';
const out = new URL('./', import.meta.url).pathname;
const [step] = process.argv.slice(2);
const TITLE = 'QA review needs you (temporary)';
const tag = `${step}-desktop`;
const browser = await launch();
try {
  const s = await open016(browser, { w: 1700, h: 1000, project: 'Tinylink' });
  const cardButton = s.page.getByRole('button', { name: new RegExp(`^Open task ${TITLE.replace(/[()]/g, '\\$&')}\\.`) });
  await cardButton.waitFor({ timeout: 20000 });
  await s.page.waitForTimeout(800);
  const cardLabel = await cardButton.getAttribute('aria-label');
  const cardText = await cardButton.innerText();
  await shot(s, `${out}${tag}-board.png`);
  await s.page.getByRole('button', { name: /^Needs attention/ }).first().click();
  await s.page.waitForTimeout(1500);
  const lines = (await pageText(s)).split('\n');
  const attention = lines.flatMap((l, i) => (l.includes(TITLE) ? lines.slice(i, i + 4) : []));
  await s.page.keyboard.press('Escape');
  await s.page.waitForTimeout(800);
  await openCard(s, TITLE);
  await s.page.waitForTimeout(1500);
  await shot(s, `${out}${tag}-drawer.png`);
  const drawerText = await pageText(s);
  const review = drawerText.split('\n').reduce((acc, l) => (acc.length || l === 'Review' ? [...acc, l] : acc), []).slice(0, 14);
  const result = { step: tag, cardLabel, cardText, attention, review, errors: s.errors };
  await writeFile(`${out}${tag}.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 1));
} finally { await browser.close(); }
