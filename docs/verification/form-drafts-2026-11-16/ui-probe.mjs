// Implementer UI probe for New task / New session drafts (docs/FORM-DRAFTS-SPEC.md).
// Runs against the live "flowly" project WITHOUT creating anything: it types probe text,
// closes with Esc, reopens (same and fresh browser context), then clears the probe text.
//   PLAYWRIGHT_CHROMIUM_PATH=... node docs/verification/form-drafts-2026-11-16/ui-probe.mjs
import { launch, open, openCard, shot } from '../../promo/shot-lib.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'ui');
mkdirSync(out, { recursive: true });
const project = 'flowly';
const card = process.env.PROBE_CARD || '修复';
const stamp = `DRAFT-PROBE-${Date.now()}`;
const png = join(out, 'probe.png');
// 1x1 PNG
writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); };

// Wide layouts show a dialog; the compact layout shows the form as a sheet without the dialog role.
const dialog = (s) => s.page.locator('[role="dialog"]:visible, body').first();
const field = (s, label) => dialog(s).getByLabel(label, { exact: true }).first();
async function closeEsc(s) {
  await s.page.keyboard.press('Escape');
  await s.page.getByLabel('Title', { exact: true }).or(s.page.getByLabel('Instruction', { exact: true })).first().waitFor({ state: 'hidden', timeout: 10000 }).catch(() => undefined);
  await s.page.waitForTimeout(800);
}
async function openNewTask(s) {
  await s.page.locator('[aria-label^="New task"]').first().click({ timeout: 15000 });
  await field(s, 'Title').waitFor({ timeout: 15000 });
}
async function openNewSession(s) {
  await s.page.getByRole('button', { name: 'Start session' }).first().click({ timeout: 15000 });
  await field(s, 'Instruction').waitFor({ timeout: 15000 });
}

// The host sidebar entry is only reachable wide: open wide, then shrink to the compact layout.
async function openAt(browser, w, h) {
  const s = await open(browser, { w: 1700, h: 1000, project });
  if (w !== 1700) {
    await s.page.setViewportSize({ width: w, height: h });
    await s.page.waitForTimeout(2500);
  }
  return s;
}
const snap = (s, w, path) => (w === 1700 ? shot(s, path) : undefined);

async function taskRound(browser, w, h, tag) {
  let s = await openAt(browser, w, h);
  try {
    await openNewTask(s);
    await field(s, 'Title').fill(`${stamp} ${tag}`);
    await field(s, 'Description').fill(`desc ${tag}`);
    await s.page.waitForTimeout(1200);
    await closeEsc(s);
    await openNewTask(s);
    check(`${tag} New task: title restored after Esc`, (await field(s, 'Title').inputValue()) === `${stamp} ${tag}`);
    check(`${tag} New task: description restored after Esc`, (await field(s, 'Description').inputValue()) === `desc ${tag}`);
    await snap(s, w, join(out, `${tag}-new-task-restored.png`));
    await closeEsc(s);
  } finally { await s.context.close(); }
  s = await openAt(browser, w, h);
  try {
    await openNewTask(s);
    check(`${tag} New task: restored in a fresh browser context`, (await field(s, 'Title').inputValue()) === `${stamp} ${tag}`);
    // Cleanup: clear the probe text and let it save.
    await field(s, 'Title').fill('');
    await field(s, 'Description').fill('');
    await s.page.waitForTimeout(1200);
    await closeEsc(s);
    await openNewTask(s);
    check(`${tag} New task: cleared probe stays cleared`, (await field(s, 'Title').inputValue()) === '');
    await closeEsc(s);
  } finally { await s.context.close(); }
}

async function sessionRound(browser, w, h, tag) {
  let s = await openAt(browser, w, h);
  try {
    await openCard(s, card);
    await openNewSession(s);
    await field(s, 'Instruction').fill(`${stamp} session ${tag}`);
    const chooser = s.page.waitForEvent('filechooser', { timeout: 8000 }).catch(() => null);
    await dialog(s).getByRole('button', { name: 'Add images' }).click({ timeout: 8000 }).catch(() => undefined);
    const fc = await chooser;
    if (fc) await fc.setFiles(png);
    await s.page.waitForTimeout(1500);
    await closeEsc(s);
    await openNewSession(s);
    check(`${tag} New session: instruction restored after Esc`, (await field(s, 'Instruction').inputValue()) === `${stamp} session ${tag}`);
    const thumbs = await dialog(s).getByRole('button', { name: 'Remove probe.png', exact: true }).count();
    check(`${tag} New session: image restored after Esc`, !!fc && thumbs === 1, fc ? `${thumbs} thumbnail(s)` : 'file chooser not reached');
    await snap(s, w, join(out, `${tag}-new-session-restored.png`));
    await closeEsc(s);
  } finally { await s.context.close(); }
  s = await openAt(browser, w, h);
  try {
    await openCard(s, card);
    await openNewSession(s);
    check(`${tag} New session: restored in a fresh browser context`, (await field(s, 'Instruction').inputValue()) === `${stamp} session ${tag}`);
    // Cleanup: clear text and remove images.
    await field(s, 'Instruction').fill('');
    while (await dialog(s).getByRole('button', { name: 'Remove probe.png', exact: true }).count()) await dialog(s).getByRole('button', { name: 'Remove probe.png', exact: true }).first().click();
    await s.page.waitForTimeout(1200);
    await closeEsc(s);
    await openNewSession(s);
    check(`${tag} New session: cleared probe stays cleared`, (await field(s, 'Instruction').inputValue()) === '' && !(await dialog(s).getByRole('button', { name: 'Remove probe.png', exact: true }).count()));
    await closeEsc(s);
  } finally { await s.context.close(); }
}

const browser = await launch();
try {
  for (const [w, h, tag] of [[1700, 1000, 'desktop'], [430, 900, 'compact']]) {
    for (const run of [taskRound, sessionRound]) {
      try { await run(browser, w, h, tag); } catch (e) { check(`${tag} ${run.name}`, false, String(e).split('\n')[0]); }
    }
  }
} finally { await browser.close(); }
writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
