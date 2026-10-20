// Headless browser checks for Round 3 D7. Run from the worktree root:
// node docs/verification/fixtures/native-session/round3/ui.mjs a-first|a-wrapup|b-auto|settings-final
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { DaemonClient } from '@getpaseo/client/internal/daemon-client';
import { createPaseoApi } from '@getpaseo/client';
import { chromium } from '/Users/bofan.wang/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';

const fixturePath = new URL('./evidence.json', import.meta.url);
const uiPath = new URL('./ui-evidence.json', import.meta.url);
const settingsBeforePath = new URL('./settings-before.json', import.meta.url);
const shotsDir = new URL('../../../native-session/round3/', import.meta.url);
const evidence = JSON.parse(await readFile(fixturePath, 'utf8'));
const baseline = JSON.parse(await readFile(settingsBeforePath, 'utf8')).settings;
const mode = process.argv[2] ?? 'a-first';
const browser = await chromium.launch({ headless: true, executablePath: '/Users/bofan.wang/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell' });
const context = await browser.newContext({ viewport: { width: 1700, height: 1000 } });
await context.grantPermissions(['local-network-access'], { origin: 'https://app.paseo.sh' });
const pageErrors = [];
const page = await context.newPage();
page.on('pageerror', (e) => pageErrors.push({ page: page.url(), error: String(e).slice(0, 400) }));
const daemon = new DaemonClient({ url: 'ws://127.0.0.1:6767/ws', clientId: `native-r3-ui-${Date.now()}`, clientType: 'cli', appVersion: '0.11.2', connectTimeoutMs: 10000, reconnect: { enabled: false } });
const api = createPaseoApi(daemon);
const rpc = (name, input = {}) => daemon.invokePluginRpc('flowly', name, input);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const takeShot = async (p, name) => { await mkdir(shotsDir, { recursive: true }); await p.screenshot({ path: new URL(`${name}.png`, shotsDir).pathname }); };
const uiLog = async (step, data) => {
  let report;
  try { report = JSON.parse(await readFile(uiPath, 'utf8')); } catch { report = { round: 3, testSessionId: evidence.testSessionId, steps: [] }; }
  report.steps.push({ step, at: new Date().toISOString(), ...data }); report.pageErrors = pageErrors;
  await writeFile(uiPath, JSON.stringify(report, null, 2)); console.log(step, JSON.stringify(data));
};
const allItems = async (agentId) => (await api.agents.ref(agentId).timeline.refetch({ direction: 'tail', limit: 100, projection: 'projected' })).entries.map((x) => x.item);
const currentMoveRow = async (agentId, id) => (await allItems(agentId)).find((x) => x?.type === 'plugin' && x.kind === 'flowly-next-moves' && x.id === id) ?? null;
const settingsPage = await context.newPage();
settingsPage.on('pageerror', (e) => pageErrors.push({ page: settingsPage.url(), error: String(e).slice(0, 400) }));

async function openBoard(p) {
  await p.goto('https://app.paseo.sh', { waitUntil: 'domcontentloaded', timeout: 45000 }); await p.waitForTimeout(1900);
  await p.getByRole('button', { name: /tinylink/i }).click(); await p.getByText('Flowly', { exact: true }).first().click(); await p.waitForTimeout(700); await p.getByText('Tinylink', { exact: true }).last().click(); await p.waitForTimeout(850);
}
async function openTask(p, slot) {
  const f = evidence.fixtures[slot]; await openBoard(p);
  await p.getByRole('button', { name: new RegExp(`Open task ${esc(f.title)}`) }).click(); await p.waitForTimeout(600);
}
async function openNative(p, slot) {
  await openTask(p, slot);
  const sessionLabel = slot === 'a' ? '[test] native session round 3 a' : '[test] native session round 3 b';
  await p.getByRole('button', { name: new RegExp(`Preview ${esc(sessionLabel)}`) }).click(); await p.waitForTimeout(450);
  await p.getByRole('button', { name: 'Open in Paseo' }).click(); await p.waitForTimeout(1100);
}
async function openWorkflow(p) {
  await openBoard(p); await p.locator('[aria-label="Flowly settings"]').last().click(); await p.waitForTimeout(500);
  await p.getByRole('button', { name: 'Workflow', exact: true }).click(); await p.waitForTimeout(450);
}
async function readSwitch(p, label) {
  return p.getByRole('switch', { name: label }).evaluate((el, label) => {
    const xs = [...el.querySelectorAll('div')]; const track = xs.at(-2); const thumb = xs.at(-1);
    const trackColor = track ? getComputedStyle(track).backgroundColor : '';
    const thumbTransform = thumb ? getComputedStyle(thumb).transform : '';
    return { label, on: /,\s*116,\s*74\)/.test(trackColor) && /14(?:\.0+)?px/.test(thumb?.style.transform ?? '') || /matrix\(1, 0, 0, 1, 14, 0\)/.test(thumbTransform), trackColor, thumbTransform };
  }, label);
}
async function setAutoWrap(p, desired) {
  await openWorkflow(p);
  const before = await readSwitch(p, 'Auto wrap up');
  if (before.on !== desired) await p.getByRole('switch', { name: 'Auto wrap up' }).click();
  const deadline = Date.now() + 12000; let rpcValue = (await rpc('sessions.native-chips', {})).autoWrapup;
  while (rpcValue !== desired && Date.now() < deadline) { await sleep(250); rpcValue = (await rpc('sessions.native-chips', {})).autoWrapup; }
  const after = await readSwitch(p, 'Auto wrap up');
  return { before, desired, after, rpcValue };
}
async function sendMove(p, slot, rowId, timeout = 15000) {
  const f = evidence.fixtures[slot]; const rowBefore = await currentMoveRow(f.managedAgentId, rowId);
  const label = rowBefore?.data?.moves?.find((x) => x.moveTo === 'done')?.label;
  if (!label) throw new Error(`No Move to Done in row ${rowId}`);
  await p.getByRole('button', { name: `Suggested next step: ${label}`, exact: true }).click();
  const deadline = Date.now() + timeout;
  let body = await p.locator('body').innerText();
  while (!body.includes('Wrap up this card?') && Date.now() < deadline) { await sleep(200); body = await p.locator('body').innerText(); }
  return { rowBefore, label, body, questionShown: body.includes('Wrap up this card?') };
}
async function taskAndSession(slot) {
  const f = evidence.fixtures[slot]; const board = await rpc('board.read', {}); const task = board.tasks.find((x) => x.id === f.cardId) ?? null; const state = (await api.agents.ref(f.managedAgentId).refresh())?.agent ?? null;
  const workspaceList = execFileSync('paseo', ['workspace', 'ls'], { encoding: 'utf8' });
  return { task: task ? { id: task.id, status: task.status, revision: task.revision, archivedAt: task.archivedAt } : null, session: state ? { status: state.status, archivedAt: state.archivedAt ?? null } : null, workspacePresent: workspaceList.includes(f.workspaceId), wrapupCheck: task ? await rpc('tasks.wrapup-check', { id: task.id }).catch((e) => ({ error: String(e) })) : null };
}

try {
  await daemon.connect();
  if (mode === 'a-first') {
    const f = evidence.fixtures.a; await openNative(page, 'a');
    const beforeState = await rpc('sessions.native-chips', {}); const currentRow = await currentMoveRow(f.managedAgentId, f.moveRowId);
    const viewInitiallyLoadedWithAutoWrapOn = beforeState.autoWrapup === true;
    await takeShot(page, 'd7a-ready-before-setting-change');
    const toggle = await setAutoWrap(settingsPage, false);
    await page.waitForTimeout(500);
    const stillOnNativeSession = (await page.title()).includes('round 3 a');
    const freshAtAction = (await rpc('sessions.native-chips', {})).autoWrapup;
    const action = await sendMove(page, 'a', f.moveRowId);
    const offered = await page.locator('button').evaluateAll((xs) => xs.map((x) => ({ label: x.getAttribute('aria-label'), text: x.innerText })).filter((x) => /Not now|Open in Flowly|Wrap up|Wrap up anyway/.test(`${x.label} ${x.text}`)));
    await takeShot(page, 'd7a-wrap-question');
    let notNowChosen = false;
    if (action.questionShown && await page.getByRole('button', { name: 'Not now', exact: true }).count()) { await page.getByRole('button', { name: 'Not now', exact: true }).click(); notNowChosen = true; await page.waitForTimeout(400); }
    const after = await taskAndSession('a');
    const questionClosed = !(await page.locator('body').innerText()).includes('Wrap up this card?');
    const nextCardGone = !(await page.locator('body').innerText()).includes('Suggested next steps');
    await takeShot(page, 'd7a-after-not-now');
    await uiLog('d7a-auto-wrapup-off-not-now', { initialNativeChipsAutoWrapup: viewInitiallyLoadedWithAutoWrapOn, row: currentRow, toggle, stillOnNativeSession, autoWrapupAtAction: freshAtAction, action, offered, notNowChosen, questionClosed, nextCardGone, after });
  } else if (mode === 'a-wrapup') {
    const f = evidence.fixtures.a; await openNative(page, 'a');
    const row = await currentMoveRow(f.managedAgentId, f.secondMoveRowId); const settingAtOpen = (await rpc('sessions.native-chips', {})).autoWrapup;
    const action = await sendMove(page, 'a', f.secondMoveRowId); const buttons = await page.locator('button').evaluateAll((xs) => xs.map((x) => ({ label: x.getAttribute('aria-label'), text: x.innerText })).filter((x) => /Not now|Open in Flowly|Wrap up|Wrap up anyway/.test(`${x.label} ${x.text}`)));
    await takeShot(page, 'd7b-wrap-question');
    let wrapUpChosen = false;
    const wrapButton = page.getByRole('button', { name: 'Wrap up', exact: true });
    if (action.questionShown && await wrapButton.count()) { await wrapButton.click(); wrapUpChosen = true; }
    const deadline = Date.now() + 45000; let after = await taskAndSession('a');
    while (!after.session?.archivedAt && Date.now() < deadline) { await sleep(500); after = await taskAndSession('a'); }
    await page.waitForTimeout(500); await takeShot(page, 'd7b-after-wrap-up');
    await uiLog('d7b-wrap-up-manually', { row, settingAtOpen, action, offered: buttons, wrapUpChosen, after });
  } else if (mode === 'b-auto') {
    const f = evidence.fixtures.b; await openNative(page, 'b');
    const settingAtOpen = (await rpc('sessions.native-chips', {})).autoWrapup;
    const action = await sendMove(page, 'b', f.moveRowId, 15000);
    const promptVisibleAtWaitEnd = action.questionShown;
    const deadline = Date.now() + 45000; let after = await taskAndSession('b');
    while ((!after.session?.archivedAt || after.workspacePresent) && Date.now() < deadline) { await sleep(500); after = await taskAndSession('b'); }
    await takeShot(page, 'd7c-auto-wrapup-on');
    await uiLog('d7c-auto-wrapup-on', { settingAtOpen, action, questionShown: promptVisibleAtWaitEnd, after });
  } else if (mode === 'settings-final') {
    await openWorkflow(page);
    const wrap = await readSwitch(page, 'Auto wrap up'); const archive = await readSwitch(page, 'Auto archive on delete');
    await page.getByRole('button', { name: 'AI features', exact: true }).click(); await page.waitForTimeout(400);
    const tap = page.getByRole('button', { name: 'Tapping a suggested next step' });
    const tapText = (await tap.innerText()).split('\n').at(-1);
    const result = { autoWrapup: wrap, autoArchiveOnDelete: archive, nextMoveTap: tapText === 'Fill the message box' ? 'fill' : tapText, expected: baseline };
    await uiLog('settings-final-restored', result);
  } else if (mode === 'set-auto') {
    const desired = process.argv[3] === 'true';
    const result = await setAutoWrap(page, desired);
    await uiLog(`set-auto-wrapup-${desired}`, result);
  } else throw new Error(`Unknown UI mode: ${mode}`);
} catch (error) {
  await uiLog(`error-${mode}`, { error: String(error?.stack ?? error) }); await takeShot(page, `error-${mode}`).catch(() => {}); process.exitCode = 1;
} finally {
  await api.dispose().catch(() => {}); await daemon.close().catch(() => {}); await context.close().catch(() => {}); await browser.close().catch(() => {});
}
