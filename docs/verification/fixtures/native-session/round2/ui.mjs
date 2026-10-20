import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { DaemonClient } from '@getpaseo/client/internal/daemon-client';
import { createPaseoApi } from '@getpaseo/client';
import { chromium } from '/Users/bofan.wang/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';

const roundDir = new URL('./', import.meta.url);
const evidencePath = new URL('./evidence.json', import.meta.url);
const uiEvidencePath = new URL('./ui-evidence.json', import.meta.url);
const shotsDir = new URL('../../../native-session/round2/', import.meta.url);
const fixture = JSON.parse(await readFile(evidencePath, 'utf8')).fixture;
const mode = process.argv[2] ?? 'desktop-fill-copy';
const compact = mode === 'compact';
const browser = await chromium.launch({
  headless: true,
  executablePath: '/Users/bofan.wang/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell',
});
const context = await browser.newContext({
  viewport: compact ? { width: 430, height: 900 } : { width: 1700, height: 1000 },
  ...(compact ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}),
});
await context.grantPermissions(['local-network-access', 'clipboard-read', 'clipboard-write'], { origin: 'https://app.paseo.sh' });
const pageErrors = [];
const newPage = async () => {
  const p = await context.newPage();
  p.on('pageerror', (error) => pageErrors.push({ page: p.url(), message: String(error).slice(0, 300) }));
  return p;
};
const page = await newPage();
const daemon = new DaemonClient({ url: 'ws://127.0.0.1:6767/ws', clientId: `native-r2-ui-${Date.now()}`, clientType: 'cli', appVersion: '0.11.2', connectTimeoutMs: 10000, reconnect: { enabled: false } });
const paseo = createPaseoApi(daemon);
await daemon.connect();
const rpc = (name, input = {}) => daemon.invokePluginRpc('flowly', name, input);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const cardName = new RegExp(`Open task ${escapeRegExp(fixture.title)}`);
const managedPreview = new RegExp(`Preview \\[test\\] native session round 2 managed`);
const unmanagedPreview = new RegExp(`Preview \\[test\\] native session round 2 unmanaged`);
const takeShot = async (p, name) => {
  await mkdir(shotsDir, { recursive: true });
  await p.screenshot({ path: new URL(`${name}.png`, shotsDir).pathname });
};
const allItems = async (agentId) => (await paseo.agents.ref(agentId).timeline.refetch({ direction: 'tail', limit: 100, projection: 'projected' })).entries.map((x) => x.item);
const moveRows = async (agentId) => (await allItems(agentId)).filter((x) => x?.type === 'plugin' && x.kind === 'flowly-next-moves');
const userMessages = async (agentId) => (await allItems(agentId)).filter((x) => x?.type === 'user_message');
const latestMoveRow = async (agentId) => (await moveRows(agentId)).at(-1) ?? null;
const apiChips = () => rpc('sessions.native-chips', {});

async function openFlowlyBoardBase(p, { mobile = false } = {}) {
  await p.goto('https://app.paseo.sh', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await p.waitForTimeout(1600);
  if (mobile) {
    const menu = p.getByRole('button', { name: 'Open menu' });
    if (await menu.count()) await menu.click();
  }
  const workspace = p.getByRole('button', { name: /tinylink/i });
  if (!(await workspace.count())) throw new Error('Tinylink workspace button not found');
  await workspace.click();
  await p.getByText('Flowly', { exact: true }).first().click();
  await p.waitForTimeout(700);
  if (mobile) {
    await p.getByRole('button', { name: /Project: Flowly/ }).click();
    await p.getByRole('button', { name: 'Tinylink', exact: true }).click();
  } else {
    await p.getByText('Tinylink', { exact: true }).last().click();
  }
  await p.waitForTimeout(900);
  const filters = p.getByRole('button', { name: /Task filters/ });
  if (await filters.count()) {
    const label = await filters.getAttribute('aria-label');
    if (/\d+ active/.test(label ?? '')) {
      await filters.click();
      if (await p.getByText('Reset filters', { exact: true }).count()) {
        await p.getByText('Reset filters', { exact: true }).click();
        await p.waitForTimeout(200);
        await p.getByText('Done', { exact: true }).last().click();
        await p.waitForTimeout(700);
      }
    }
  }
}

async function openFlowlyTask(p, options = {}) {
  await openFlowlyBoardBase(p, options);
  if (options.mobile) {
    const lane = p.getByRole('button', { name: /Choose task status/ });
    if (await lane.count()) {
      await lane.click();
      await p.waitForTimeout(350);
      const laneName = await rpc('board.read', {}).then((b) => b.tasks.find((t) => t.id === fixture.cardId)?.status ?? 'development');
      const labels = { todo: 'Todo', backlog: 'Backlog', design: 'Design', development: 'Development', test: 'Test', in_review: 'In review', blocked: 'Blocked', done: 'Done', cancelled: 'Cancelled' };
      await p.getByText(labels[laneName] ?? 'Development', { exact: true }).last().click();
      await p.waitForTimeout(500);
    }
  }
  await p.getByRole('button', { name: cardName }).click();
  await p.waitForTimeout(700);
}

async function openNative(p, kind = 'managed', options = {}) {
  await openFlowlyTask(p, options);
  await p.getByRole('button', { name: kind === 'managed' ? managedPreview : unmanagedPreview }).click();
  await p.waitForTimeout(550);
  await p.getByRole('button', { name: 'Open in Paseo' }).click();
  await p.waitForTimeout(1200);
}

async function openSettingsPage(p, section) {
  await openFlowlyBoardBase(p);
  const settings = p.locator('[aria-label="Flowly settings"]').last();
  await settings.click();
  await p.waitForTimeout(700);
  await p.getByRole('button', { name: section, exact: true }).click();
  await p.waitForTimeout(500);
}

async function selectNextMoveMode(p, value) {
  await openSettingsPage(p, 'AI features');
  await p.getByRole('button', { name: /Tapping a suggested next step/ }).click();
  await p.waitForTimeout(150);
  await p.getByRole('button', { name: `Tapping a suggested next step: ${value === 'copy' ? 'Copy' : 'Fill the message box'}`, exact: true }).last().click();
  await p.waitForTimeout(700);
  const state = await apiChips();
  return state.nextMoveTap;
}

async function composerFor(agentId) {
  const owners = await page.locator('textarea[data-composer-input]').evaluateAll((fields) => fields.map((field) => {
    const fiberKey = Object.keys(field).find((key) => key.startsWith('__reactFiber$'));
    let fiber = fiberKey ? field[fiberKey] : null;
    for (; fiber; fiber = fiber.return) {
      const props = fiber.memoizedProps;
      if (props && typeof props.agentId === 'string' && 'workspaceId' in props) {
        const alternate = fiber.alternate?.memoizedProps;
        return { agentId: props.agentId, workspaceId: props.workspaceId, alternateAgentId: alternate?.agentId ?? null };
      }
    }
    return null;
  }));
  const matching = owners.map((owner, index) => ({ owner, index })).filter((x) => x.owner?.agentId === agentId && x.owner?.workspaceId === fixture.workspaceId && (!x.owner.alternateAgentId || x.owner.alternateAgentId === agentId));
  if (matching.length !== 1) throw new Error(`Cannot prove one composer belongs to ${agentId}: ${JSON.stringify(owners)}`);
  return { locator: page.locator('textarea[data-composer-input]').nth(matching[0].index), owner: matching[0].owner, owners };
}

async function writeStep(modeName, checks, extra = {}) {
  let report;
  try { report = JSON.parse(await readFile(uiEvidencePath, 'utf8')); } catch { report = { round: 2, testSessionId: 'e63b5616-a0db-47cd-9b11-4c3691dcde10', startedAt: new Date().toISOString(), steps: [] }; }
  report.steps.push({ mode: modeName, at: new Date().toISOString(), checks, ...extra });
  report.pageErrors = pageErrors;
  await writeFile(uiEvidencePath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ mode: modeName, checks, ...extra, pageErrors }, null, 2));
}

try {
  if (mode === 'desktop-fill-copy') {
    await openNative(page, 'managed');
    const items = await allItems(fixture.managedAgentId);
    const row = items.find((x) => x?.type === 'plugin' && x.id === fixture.nextMoveRowId) ?? null;
    const lastAssistantIndex = items.reduce((found, item, index) => item?.type === 'assistant_message' ? index : found, -1);
    const rowIndex = items.findIndex((x) => x?.type === 'plugin' && x.id === fixture.nextMoveRowId);
    const chips = await apiChips();
    const nativeText = await page.locator('body').innerText();
    const nextButtons = await page.locator('button').evaluateAll((xs) => xs.map((x) => ({ text: x.innerText, label: x.getAttribute('aria-label') })).filter((x) => /Next\s*·|Next moves/i.test(`${x.text} ${x.label}`)));
    const d1 = {
      viewport: '1700x1000 desktop',
      cardUnderLastReply: nativeText.includes('Suggested next steps') && rowIndex > lastAssistantIndex,
      rawRow: row,
      rowData: row?.data,
      noNextComposerChip: nextButtons.length === 0,
      ideasChipVisible: await page.getByRole('button', { name: 'Ideas for this card' }).count() === 1,
      nativeChipRpc: { managedListed: chips.managed.some((x) => x.agentId === fixture.managedAgentId), nextMoveTap: chips.nextMoveTap },
    };
    await takeShot(page, 'd1-desktop-ready-card');
    const { locator: composer, owner, owners } = await composerFor(fixture.managedAgentId);
    const beforeCount = (await userMessages(fixture.managedAgentId)).length;
    const move = fixture.nextMoves[0];
    await page.getByRole('button', { name: `Suggested next step: ${move.label}`, exact: true }).click();
    await page.waitForTimeout(350);
    const firstValue = await composer.inputValue();
    const afterFirstCount = (await userMessages(fixture.managedAgentId)).length;
    const focusedAfterFirst = await composer.evaluate((x) => document.activeElement === x);
    await composer.fill('hello');
    const move2 = fixture.nextMoves[1];
    await page.getByRole('button', { name: `Suggested next step: ${move2.label}`, exact: true }).click();
    await page.waitForTimeout(350);
    const appendedValue = await composer.inputValue();
    const afterSecondCount = (await userMessages(fixture.managedAgentId)).length;
    await takeShot(page, 'd2-fill-append');
    await composer.fill('');
    const d2 = {
      composerOwner: owner,
      allComposerOwners: owners,
      firstPrompt: move.prompt,
      fillExactPrompt: firstValue === move.prompt,
      appendedExistingText: appendedValue === `hello\n\n${move2.prompt}`,
      focusAfterFill: focusedAfterFirst,
      noMessageSent: beforeCount === afterFirstCount && afterFirstCount === afterSecondCount,
      userMessagesBeforeAfter: { beforeCount, afterFirstCount, afterSecondCount },
    };

    const settingPage = await newPage();
    const initialMode = (await apiChips()).nextMoveTap;
    const setCopy = await selectNextMoveMode(settingPage, 'copy');
    await logStep('d3-copy-setting', { initialMode, setCopy });
    // A fresh native view sees the host setting in the same client refresh path as production.
    await page.goto('https://app.paseo.sh', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await openNative(page, 'managed');
    const copyDeadline = Date.now() + 30000;
    let modeValue = (await apiChips()).nextMoveTap;
    while (modeValue !== 'copy' && Date.now() < copyDeadline) { await sleep(600); modeValue = (await apiChips()).nextMoveTap; }
    const { locator: copyComposer } = await composerFor(fixture.managedAgentId);
    const copyBefore = await copyComposer.inputValue();
    const copyCountBefore = (await userMessages(fixture.managedAgentId)).length;
    await page.getByRole('button', { name: `Suggested next step: ${move.label}`, exact: true }).click();
    await page.waitForTimeout(500);
    const copyAfter = await copyComposer.inputValue();
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText()).catch((e) => `CLIPBOARD_READ_ERROR:${String(e)}`);
    const copyToastVisible = (await page.locator('body').innerText()).includes('Copied');
    const copyCountAfter = (await userMessages(fixture.managedAgentId)).length;
    await takeShot(page, 'd3-copy-result');
    const restoreMode = await selectNextMoveMode(settingPage, 'fill');
    const d3 = { initialMode, settingWhileCopy: modeValue, toastVisible: copyToastVisible, clipboardText, clipboardMatchesPrompt: clipboardText === move.prompt, composerUnchanged: copyAfter === copyBefore, noMessageSent: copyCountAfter === copyCountBefore, restoredMode: restoreMode };
    await logStep('d1-d3-desktop-fill-copy', { d1, d2, d3 });
  } else if (mode === 'capture-native-url') {
    await openNative(page, 'managed');
    await logStep('capture-native-url', { url: page.url(), title: await page.title() });
  } else if (mode === 'hide-and-ideas') {
    await openNative(page, 'managed');
    const d5before = (await page.locator('body').innerText()).includes('Suggested next steps');
    await page.getByRole('button', { name: 'Hide suggestions', exact: true }).click();
    await page.waitForTimeout(300);
    const hiddenNow = await page.getByRole('button', { name: /^Suggested next step:/ }).count() === 0;
    const rowStillReady = (await latestMoveRow(fixture.managedAgentId))?.data?.status === 'ready';
    await takeShot(page, 'd5-native-hidden');
    const flowly = await newPage();
    await openFlowlyTask(flowly);
    await flowly.getByRole('button', { name: managedPreview }).click();
    await flowly.waitForTimeout(900);
    const flowlySuggestions = await flowly.getByTestId('session-next-moves').count().catch(() => 0);
    const flowlyMoveButtons = await flowly.getByRole('button', { name: /^Suggested next step:/ }).count();
    await takeShot(flowly, 'd5-flowly-suggestion-row-preserved');

    await page.getByRole('button', { name: 'Ideas for this card' }).click();
    await page.waitForTimeout(250);
    await page.getByRole('button', { name: new RegExp(`Dismiss .*${escapeRegExp(fixture.initialIdea.title)}`) }).click();
    const ideaDeadline = Date.now() + 1000;
    while (await page.getByRole('button', { name: 'Ideas for this card' }).count() && Date.now() < ideaDeadline) await sleep(80);
    const ideaChipGoneWithinOneSecond = await page.getByRole('button', { name: 'Ideas for this card' }).count() === 0;
    const board = await rpc('board.read', {});
    const ideaAfter = board.ideas.find((x) => x.id === fixture.initialIdea.id) ?? null;
    await takeShot(page, 'd6-idea-dismissed-same-page');
    await logStep('d5-d6-hide-and-ideas', {
      d5: { cardVisibleBefore: d5before, hiddenImmediately: hiddenNow, rawRowStillReady: rowStillReady, flowlySuggestionTestIdCount: flowlySuggestions, flowlySuggestionButtons: flowlyMoveButtons, flowlySuggestionStillVisible: flowlySuggestions > 0 || flowlyMoveButtons > 0 },
      d6: { ideaChipGoneWithinOneSecond, idea: ideaAfter },
    });
  } else if (mode === 'unmanaged') {
    await openNative(page, 'unmanaged');
    const items = await allItems(fixture.unmanagedAgentId);
    const chips = await apiChips();
    const body = await page.locator('body').innerText();
    const result = {
      taskChipPresent: body.includes(`Task · ${fixture.title.slice(0, 30)}`) || body.includes('Task ·'),
      noNextMovesCard: !body.includes('Suggested next steps') && !items.some((x) => x?.kind === 'flowly-next-moves'),
      noIdeasChip: await page.getByRole('button', { name: 'Ideas for this card' }).count() === 0,
      noNextComposerChip: !(await page.locator('button').evaluateAll((xs) => xs.some((x) => /^Next\s*·/.test(x.innerText)))),
      rpcManagedFalse: !chips.managed.some((x) => x.agentId === fixture.unmanagedAgentId),
    };
    await takeShot(page, 'd9-unmanaged');
    await logStep('d9-unmanaged', result);
  } else if (mode === 'compact') {
    let mobileRouteError = null;
    try { await openNative(page, 'managed', { mobile: true }); }
    catch (error) {
      mobileRouteError = String(error?.message ?? error);
      await page.goto(`https://app.paseo.sh/h/srv_90C-XtZzxWEH/workspace/${fixture.workspaceId}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForTimeout(3000);
    }
    const compactButtons = await page.locator('button').evaluateAll((xs) => xs.map((x) => ({ text: x.innerText, label: x.getAttribute('aria-label'), title: x.getAttribute('title') })));
    if (await page.title() !== '[test] native session round 2 managed') {
      const sessionPicker = page.getByRole('button', { name: /Switch tabs/ });
      if (await sessionPicker.count()) {
        await sessionPicker.last().click();
        await page.waitForTimeout(250);
        const managedTab = page.getByText('[test] native session round 2 managed', { exact: true });
        if (await managedTab.count()) await managedTab.last().click();
        await page.waitForTimeout(900);
      }
    }
    const body = await page.locator('body').innerText();
    const card = page.getByText('Suggested next steps', { exact: true }).last();
    const box = await card.boundingBox().catch(() => null);
    const result = {
      viewport: '430x900 isMobile+hasTouch',
      cardVisible: body.includes('Suggested next steps') && body.includes(fixture.nextMoves[0].label),
      messageMovesPresent: fixture.nextMoves.every((move) => body.includes(move.label)),
      noHorizontalCardOverflow: box ? box.x >= 0 && box.x + box.width <= 430 : false,
      cardBoundingBox: box,
      mobileRouteError,
      pageTitle: await page.title(),
      currentUrl: page.url(),
      compactButtons,
    };
    await takeShot(page, 'd8-compact');
    await logStep('d8-compact', result);
  } else if (mode === 'send-dismiss') {
    await openNative(page, 'managed');
    const originalRow = await latestMoveRow(fixture.managedAgentId);
    const userCountBefore = (await userMessages(fixture.managedAgentId)).length;
    const { locator: composer, owner } = await composerFor(fixture.managedAgentId);
    const sendText = 'Round 2 composer send: begin a new turn to dismiss this suggestions card.';
    await composer.fill(sendText);
    const sendButtons = await page.locator('button').evaluateAll((xs) => xs.map((x) => ({ text: x.innerText, label: x.getAttribute('aria-label') })).filter((x) => /send/i.test(`${x.text} ${x.label}`)));
    const send = page.getByRole('button', { name: /send/i }).last();
    await send.click();
    let rowAfter = originalRow;
    const deadline = Date.now() + 60000;
    while (rowAfter?.data?.status !== 'dismissed' && Date.now() < deadline) { await sleep(400); rowAfter = (await moveRows(fixture.managedAgentId)).find((x) => x.id === originalRow?.id) ?? rowAfter; }
    await page.waitForTimeout(500);
    const cardGoneOnCurrentPage = !(await page.locator('body').innerText()).includes('Suggested next steps');
    const userRows = await userMessages(fixture.managedAgentId);
    await takeShot(page, 'd4-row-dismissed-current-page');
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(1500);
    await openNative(page, 'managed');
    const bodyAfterReload = await page.locator('body').innerText();
    const reloadedCardVisible = bodyAfterReload.includes('Suggested next steps');
    const rowAfterReload = (await moveRows(fixture.managedAgentId)).find((x) => x.id === originalRow?.id) ?? null;
    const result = { rowBefore: originalRow, rowAfter: rowAfter ?? null, rowStatusDismissedSameId: rowAfter?.id === originalRow?.id && rowAfter?.data?.status === 'dismissed', userMessageCountBefore: userCountBefore, userMessageAfter: userRows.slice(-1)[0]?.text ?? null, sendTextMatches: userRows.at(-1)?.text === sendText, composerOwner: owner, sendButtons, cardGoneOnCurrentPage, cardGoneAfterReload: !reloadedCardVisible, rowAfterReload, }; 
    await takeShot(page, 'd4-row-dismissed-after-reload');
    await logStep('d4-send-dismiss', result);
  } else if (mode === 'settings-copy-only') {
    const before = (await apiChips()).nextMoveTap;
    const selected = await selectNextMoveMode(page, process.argv[3] === 'copy' ? 'copy' : 'fill');
    await logStep(`setting-${selected}`, { before, selected, desired: process.argv[3] ?? 'fill' });
  } else if (mode === 'disable-auto-wrapup') {
    const before = await apiChips();
    let selected = before.autoWrapup;
    if (before.autoWrapup) {
      await openSettingsPage(page, 'Workflow');
      await page.getByRole('switch', { name: 'Auto wrap up' }).click();
      const deadline = Date.now() + 10000;
      while ((await apiChips()).autoWrapup && Date.now() < deadline) await sleep(150);
      selected = (await apiChips()).autoWrapup;
    }
    await logStep('auto-wrapup-disabled-for-d7', { before: before.autoWrapup, after: selected, willRestore: before.autoWrapup });
  } else if (mode === 'restore-auto-wrapup') {
    const before = await apiChips();
    const desired = process.argv[3] === 'true';
    let selected = before.autoWrapup;
    if (before.autoWrapup !== desired) {
      await openSettingsPage(page, 'Workflow');
      await page.getByRole('switch', { name: 'Auto wrap up' }).click();
      const deadline = Date.now() + 10000;
      while ((await apiChips()).autoWrapup !== desired && Date.now() < deadline) await sleep(150);
      selected = (await apiChips()).autoWrapup;
    }
    await logStep('auto-wrapup-restored', { before: before.autoWrapup, desired, after: selected, restored: selected === desired });
  } else if (mode === 'move-done') {
    await openNative(page, 'managed');
    const before = await page.locator('body').innerText();
    await page.getByRole('button', { name: /Suggested next step: Move to Done/ }).click();
    const wrapupDeadline = Date.now() + 12000;
    let body = await page.locator('body').innerText();
    while (!body.includes('Wrap up this card?') && Date.now() < wrapupDeadline) {
      await sleep(250);
      body = await page.locator('body').innerText();
    }
    const promptAppeared = body.includes('Wrap up this card?');
    const wrapupButtons = await page.locator('button').evaluateAll((xs) => xs.map((x) => ({ text: x.innerText, label: x.getAttribute('aria-label') })).filter((x) => /wrap up|open in flowly|not now/i.test(`${x.text} ${x.label}`)));
    await takeShot(page, 'd7-move-to-done-dialog');
    const statusAfterMove = (await rpc('board.read', {})).tasks.find((x) => x.id === fixture.cardId)?.status ?? null;
    const wrapupCheck = await rpc('tasks.wrapup-check', { id: fixture.cardId });
    let notNowChosen = false;
    if (promptAppeared && await page.getByRole('button', { name: 'Not now', exact: true }).count()) {
      await page.getByRole('button', { name: 'Not now', exact: true }).click();
      notNowChosen = true;
      await page.waitForTimeout(300);
      body = await page.locator('body').innerText();
    }
    const result = { moveButtonWasVisible: before.includes('Move to Done'), promptAppeared, wrapupButtons, notNowChosen, statusAfterMove, wrapupCheck, autoWrapupAfter: (await apiChips()).autoWrapup, }; 
    await takeShot(page, 'd7-after-not-now');
    await logStep('d7-move-to-done', result);
  } else throw new Error(`Unknown UI mode: ${mode}`);
} catch (error) {
  await logStep(`error-${mode}`, { error: String(error?.stack ?? error), pageErrors });
  await takeShot(page, `error-${mode}`).catch(() => {});
  process.exitCode = 1;
} finally {
  await paseo.dispose().catch(() => {});
  await daemon.close().catch(() => {});
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
}

async function logStep(name, data) {
  let report;
  try { report = JSON.parse(await readFile(uiEvidencePath, 'utf8')); } catch { report = { round: 2, testSessionId: 'e63b5616-a0db-47cd-9b11-4c3691dcde10', steps: [] }; }
  report.steps.push({ name, at: new Date().toISOString(), ...data });
  report.pageErrors = pageErrors;
  await writeFile(uiEvidencePath, JSON.stringify(report, null, 2));
  console.log(name, JSON.stringify(data));
}
