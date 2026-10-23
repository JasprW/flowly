import { launch, open, shot, pageText } from '../promo/shot-lib.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import assert from 'node:assert/strict';
import { DaemonClient } from '@getpaseo/client/internal/daemon-client';
const home = process.env.PASEO_HOME || join(homedir(), '.paseo');
const lock = JSON.parse(await readFile(join(home, 'paseo.pid'), 'utf8'));
const credential = (await readFile(join(home, 'local-credential'), 'utf8')).trim();
const client = new DaemonClient({ url: `ws://${lock.listen.replace(/^tcp:\/\//, '')}/ws`, clientId: 'summary-model-list-ui-test', clientType: 'cli', localCredential: () => credential, reconnect: { enabled: false } });
await client.connect();
const prefs = () => client.invokePluginRpc('flowly', 'settings.task-summary.read', {});
const original = await prefs();
const originalOnboarding = await client.invokePluginRpc('flowly', 'settings.onboarding.read', {});
assert.equal(original.status, 'ready');
const defaults = ['claude/claude-haiku-5-5', 'codex/gpt-6-luna'];
const evidence = { at: new Date().toISOString(), original, checks: [] };
let lastOwned;
let browser;
const record = (name, detail) => { evidence.checks.push({ name, detail, state: 'pass' }); console.log(`PASS ${name}`); };
const waitForList = async (list) => {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const state = await prefs();
    if (JSON.stringify(state.values.summaryModels) === JSON.stringify(list)) {
      assert.equal(state.values.summaryModel, '');
      assert.equal(state.values.summaryEnabled, original.values.summaryEnabled);
      assert.equal(state.values.digestEnabled, original.values.digestEnabled);
      assert.equal(state.values.retroEnabled, original.values.retroEnabled);
      lastOwned = state;
      return state;
    }
    await new Promise(r => setTimeout(r, 100));
  }
  throw Error(`Saved model list did not become ${list.join(' -> ')}`);
};
try {
  browser = await launch();
  const s = await open(browser, { w: 1700, h: 1050, project: 'Tinylink' });
  const p = s.page;
  await p.getByRole('button', { name: 'Flowly settings', exact: true }).click();
  await p.getByRole('button', { name: 'Models', exact: true }).click();
  if (!process.argv.includes('--compact-only')) {
  await p.getByRole('button', { name: 'Restore defaults', exact: true }).click();
  await waitForList(defaults);
  record('default list persisted', defaults);
  await p.getByRole('button', { name: 'Move GPT-6-Luna up', exact: true }).click();
  await waitForList([defaults[1], defaults[0]]);
  record('move up changes persisted priority');
  await p.getByRole('button', { name: 'Remove Haiku 5.5', exact: true }).click();
  await waitForList([defaults[1]]);
  await p.getByText('2. Haiku 5.5', { exact: true }).waitFor({ state: 'hidden' });
  assert.equal(await p.getByRole('button', { name: 'Remove GPT-6-Luna', exact: true }).isDisabled(), true);
  record('remove works; final model cannot be removed');
  await p.getByRole('button', { name: 'Add model', exact: true }).click();
  await p.getByRole('button', { name: 'Provider', exact: true }).last().click();
  await p.getByRole('button', { name: 'Provider: Claude', exact: true }).click();
  await p.getByRole('button', { name: 'Model', exact: true }).last().click();
  await p.getByRole('button', { name: 'Model: Haiku 5.5', exact: true }).click();
  await waitForList([defaults[1], defaults[0]]);
  record('add provider/model appends without changing previous priority');
  await p.getByRole('button', { name: 'Add model', exact: true }).click();
  await p.getByRole('button', { name: 'Provider', exact: true }).last().click();
  await p.getByRole('button', { name: 'Provider: Codex', exact: true }).click();
  await p.getByRole('button', { name: 'Model', exact: true }).last().click();
  assert.equal(await p.getByRole('button', { name: 'Model: GPT-6-Luna', exact: true }).isDisabled(), true);
  record('duplicate model is disabled');
  await p.getByRole('button', { name: 'Cancel', exact: true }).click();
  await p.getByRole('button', { name: 'Move GPT-6-Luna down', exact: true }).click();
  await waitForList(defaults);
  record('move down persists priority');
  await p.getByRole('button', { name: 'Restore defaults', exact: true }).click();
  await waitForList(defaults);
  await shot(s, new URL('./summary-models-2026-10-23-desktop.png', import.meta.url).pathname);
  await writeFile(new URL('./summary-models-2026-10-23-desktop.txt', import.meta.url), await pageText(s));
  await p.reload({ waitUntil: 'networkidle' });
  await p.getByRole('button', { name: 'Flowly settings', exact: true }).click();
  await p.getByRole('button', { name: 'Models', exact: true }).click();
  await p.getByText('1. Haiku 5.5', { exact: true }).waitFor();
  await p.getByText('2. GPT-6-Luna', { exact: true }).waitFor();
  record('list survives page reload');
  }
  await p.setViewportSize({ width: 820, height: 920 });
  await p.waitForTimeout(1500);
  await writeFile(new URL('./summary-models-2026-10-23-compact-before.txt', import.meta.url), await pageText(s));
  if (!(await p.getByRole('button', { name: 'Move GPT-6-Luna up', exact: true }).count())) {
    await p.getByRole('button', { name: 'Flowly settings', exact: true }).click({ timeout: 5000 });
    await p.getByRole('button', { name: 'Models', exact: true }).click({ timeout: 5000 });
  }
  await p.getByRole('button', { name: 'Move GPT-6-Luna up', exact: true }).waitFor({ state: 'visible' });
  await p.getByRole('button', { name: 'Move GPT-6-Luna up', exact: true }).scrollIntoViewIfNeeded();
  const boxes = await Promise.all(['Move GPT-6-Luna up', 'Move GPT-6-Luna down', 'Remove GPT-6-Luna'].map(name => p.getByRole('button', { name, exact: true }).boundingBox()));
  assert(boxes.every(b => b && b.x >= 0 && b.x + b.width <= 820));
  record('compact desktop action controls remain within 820px viewport', boxes);
  // shot-lib always omits the private left sidebar; compact export shows the right-side action region.
  s.w = 820; s.h = 920; s.clip = { x: 320, y: 0, width: 500, height: 920 };
  await shot(s, new URL('./summary-models-2026-10-23-compact-actions.png', import.meta.url).pathname);
  assert.deepEqual(s.errors, []);
  record('no browser page errors');
  const beforeInvalid = await prefs();
  for (const summaryModels of [[], ['codex/gpt-6-luna', 'codex/gpt-6-luna']]) {
    let rejected = false;
    try { const result = await client.invokePluginRpc('flowly', 'settings.task-summary.write', { revision: beforeInvalid.revision, values: { ...beforeInvalid.values, summaryModels } }); rejected = result.status === 'invalid'; }
    catch { rejected = true; }
    assert(rejected);
    assert.equal((await prefs()).revision, beforeInvalid.revision);
  }
  record('settings RPC rejects empty/duplicate lists without mutation');
} catch (error) {
  evidence.failure = String(error);
  console.error(error);
  process.exitCode = 1;
} finally {
  if (lastOwned) {
    const current = await prefs();
    if (current.revision !== lastOwned.revision) {
      evidence.restore = 'SKIPPED: another writer changed settings; no overwrite';
      process.exitCode = 1;
    } else {
      const result = await client.invokePluginRpc('flowly', 'settings.task-summary.write', { revision: current.revision, values: original.values });
      assert.equal(result.status, 'saved');
      const restored = await prefs();
      assert.deepEqual(restored.values, original.values);
      evidence.restore = 'PASS: original values restored exactly';
      console.log(evidence.restore);
    }
  }
  const onboarding = await client.invokePluginRpc('flowly', 'settings.onboarding.read', {});
  const withoutTestTip = { ...onboarding.values, tipsSeen: onboarding.values.tipsSeen.filter(id => id !== 'summary-models') };
  const originalWithoutTip = { ...originalOnboarding.values, tipsSeen: originalOnboarding.values.tipsSeen.filter(id => id !== 'summary-models') };
  if (JSON.stringify(withoutTestTip) === JSON.stringify(originalWithoutTip)) {
    const restored = await client.invokePluginRpc('flowly', 'settings.onboarding.write', { revision: onboarding.revision, values: originalOnboarding.values });
    assert.equal(restored.status, 'saved');
    assert.deepEqual((await client.invokePluginRpc('flowly', 'settings.onboarding.read', {})).values, originalOnboarding.values);
    evidence.onboardingRestore = 'PASS: exact original onboarding values';
  } else { evidence.onboardingRestore = 'SKIPPED: another writer changed onboarding'; process.exitCode = 1; }
  await browser?.close();
  await client.close();
  await writeFile(new URL('./summary-models-2026-10-23-ui.json', import.meta.url), JSON.stringify(evidence, null, 2));
}
