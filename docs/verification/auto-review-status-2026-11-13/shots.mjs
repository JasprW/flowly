import { readFile, writeFile } from 'node:fs/promises';
import { launch, openCard, closeCard, shot, pageText } from '../../promo/shot-lib.mjs';
import { open016 } from './ui-lib.mjs';
const out = new URL('./', import.meta.url).pathname;
const state = JSON.parse(await readFile(out + 'live-ids.json', 'utf8'));
const phase = process.argv[2], expected = { waiting: 'Waiting for review', running: 'Reviewing', recovered: 'Review unavailable' }[phase];
if (!expected) throw new Error('Expected waiting/running/recovered');
const results = [];
for (const [layout, w] of [['desktop', 1700], ['compact', 1000]]) {
  const browser = await launch();
  try {
    const s = await open016(browser, { w, h: 1000, project: state.title });
    const card = s.page.getByRole('button', { name: /^Open task Waiting review\./ });
    await card.scrollIntoViewIfNeeded();
    await s.page.getByText(expected, { exact: true }).first().waitFor({ timeout: 20000 });
    const label = await card.getAttribute('aria-label');
    if (!label.includes(expected)) throw new Error('Card accessible label missing expected status: ' + label);
    await shot(s, out + `${phase}-${layout}-board.png`);
    await writeFile(out + `${phase}-${layout}-board.txt`, await pageText(s));
    await openCard(s, 'Waiting review');
    await s.page.waitForTimeout(600); // Let the observed drawer opening transition finish before evidence.
    const drawer = s.page.getByTestId('task-drawer-motion');
    await drawer.getByText(phase === 'recovered' ? 'Review unavailable · Round 1' : phase === 'running' ? 'Reviewing · Round 1' : expected, { exact: true }).waitFor({ timeout: 20000 });
    if (phase === 'recovered') await drawer.getByText('Flowly restarted before the review started.', { exact: true }).waitFor({ timeout: 20000 });
    await s.page.waitForTimeout(300);
    const text = await pageText(s);
    if (phase === 'waiting' && await s.page.getByRole('button', { name: 'Rerun', exact: true }).isVisible().catch(() => false)) throw new Error('Rerun visible while waiting');
    if (phase === 'recovered' && !text.includes('Flowly restarted before the review started.')) throw new Error('Missing restart reason');
    await shot(s, out + `${phase}-${layout}-drawer.png`);
    await writeFile(out + `${phase}-${layout}-drawer.txt`, text);
    results.push({ phase, layout, viewport: w, label, errors: s.errors });
    console.log(JSON.stringify(results.at(-1)));
  } finally { await browser.close(); }
}
await writeFile(out + `${phase}-ui.json`, JSON.stringify(results, null, 2));
