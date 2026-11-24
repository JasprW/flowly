// UI step for live.mjs: node ui.mjs <step> [dismiss|rerun] [compact]. Screenshots and text via shot-lib only.
import { writeFile } from 'node:fs/promises';
import { launch, openCard, shot, pageText } from '../../promo/shot-lib.mjs';
import { open016 } from '../auto-review-status-2026-11-13/ui-lib.mjs';
const out = new URL('./', import.meta.url).pathname;
const [step, act, layout] = process.argv.slice(2);
const TITLE = 'QA review rerun (temporary)';
const size = layout === 'compact' ? { w: 1000, h: 1000 } : { w: 1700, h: 1000 };
const tag = `${step}-${layout === 'compact' ? 'compact' : 'desktop'}`;
const browser = await launch();
try {
  const s = await open016(browser, { ...size, project: 'Tinylink' });
  const cardButton = s.page.getByRole('button', { name: new RegExp(`^Open task ${TITLE.replace(/[()]/g, '\\$&')}\\.`) });
  await cardButton.waitFor({ timeout: 20000 });
  await s.page.waitForTimeout(800);
  const cardLabel = await cardButton.getAttribute('aria-label');
  const cardText = await cardButton.innerText();
  await shot(s, `${out}${tag}-board.png`);
  let attentionText = null;
  if (process.env.ATTN) {
    await s.page.getByRole("button", { name: /^Needs attention/ }).first().click();
    await s.page.waitForTimeout(1500);
    await shot(s, `${out}${tag}-attention.png`);
    attentionText = await pageText(s);
    await s.page.keyboard.press("Escape");
    await s.page.waitForTimeout(800);
  }
  await openCard(s, TITLE);
  const drawer = s.page.getByTestId('task-drawer-motion').filter({ hasText: TITLE }).first();
  await s.page.waitForTimeout(1200);
  const rerun = drawer.getByRole('button', { name: 'Rerun', exact: true });
  const rerunVisible = await rerun.isVisible();
  await shot(s, `${out}${tag}-drawer.png`);
  const drawerText = await pageText(s);
  const menu = [];
  if (act !== "rerun") {
    await drawer.getByRole("button", { name: "More task actions", exact: true }).click();
    await s.page.waitForTimeout(500);
    for (const label of ["Dismiss from Attention", "Restore to Attention"]) if (await s.page.getByText(label, { exact: true }).isVisible().catch(() => false)) menu.push(label);
  }
  let did = null;
  if (act === 'dismiss') {
    await s.page.getByText('Dismiss from Attention', { exact: true }).click();
    await s.page.getByText('Dismissed. It comes back when something new happens.').waitFor({ timeout: 10000 }).catch(() => {});
    did = 'dismissed';
  } else if (act !== "rerun") {
    await s.page.keyboard.press("Escape");
  }
  if (act === 'rerun') {
    if (!rerunVisible) throw new Error('Rerun not visible');
    await rerun.click();
    await drawer.getByText('Waiting for review', { exact: true }).or(drawer.getByText(/Reviewing/)).first().waitFor({ timeout: 15000 });
    did = 'rerun';
  }
  if (did) {
    await s.page.waitForTimeout(1500);
    await shot(s, `${out}${tag}-after-${did}.png`);
  }
  const afterLabel = did ? await cardButton.getAttribute('aria-label') : null;
  const result = { step: tag, attention: attentionText && attentionText.split("\n").filter((l, i, a) => /QA review rerun|Review failed|Review unavailable/.test(l) || /QA review rerun/.test(a[i - 1] || "")), cardLabel, cardText, rerunVisible, menu, did, afterLabel, errors: s.errors };
  await writeFile(`${out}${tag}.json`, JSON.stringify({ ...result, drawerText }, null, 2));
  console.log(JSON.stringify(result, null, 1));
} finally { await browser.close(); }
