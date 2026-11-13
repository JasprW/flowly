import { readFile, writeFile } from 'node:fs/promises';
import { launch, openCard, shot, pageText } from '../../promo/shot-lib.mjs';
import { open016 } from './ui-lib.mjs';
const out = new URL('./', import.meta.url).pathname;
const state = JSON.parse(await readFile(new URL('../../../.test-data/auto-review-status-live-state.json', import.meta.url), 'utf8'));
const browser = await launch();
try {
  const s = await open016(browser, { w: 1000, h: 1000, project: state.title });
  await openCard(s, 'Waiting review');
  const drawer = s.page.getByTestId('task-drawer-motion');
  const rerun = drawer.getByRole('button', { name: 'Rerun', exact: true });
  await rerun.waitFor({ timeout: 20000 });
  await rerun.click();
  await drawer.getByText('Reviewing · Round 1', { exact: true }).waitFor({ timeout: 20000 });
  await s.page.waitForTimeout(600);
  if (await rerun.isVisible()) throw new Error('Rerun still visible during review');
  await shot(s, out + 'rerun-compact-drawer.png');
  await writeFile(out + 'rerun-compact-drawer.txt', await pageText(s));
  console.log(JSON.stringify({ clicked: 'Rerun', result: 'Reviewing · Round 1', errors: s.errors }));
} finally { await browser.close(); }
