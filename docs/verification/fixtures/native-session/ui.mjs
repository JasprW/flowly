import { chromium } from '/Users/bofan.wang/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs';

const browser = await chromium.launch({
  headless: true,
  executablePath: '/Users/bofan.wang/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell',
});
const mode = process.argv[2] ?? 'flowly';
const compact = mode === 'compact';
const context = await browser.newContext({
  viewport: compact ? { width: 430, height: 900 } : { width: 1700, height: 1000 },
  ...(compact ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}),
});
await context.grantPermissions(['local-network-access'], { origin: 'https://app.paseo.sh' });
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(String(error).slice(0, 300)));
const cardTitle = '[test] native session bc0d52e9';
const screenshot = (name) => page.screenshot({ path: new URL(`../../native-session/${name}.png`, import.meta.url).pathname });
const openFlowlyCard = async () => {
  await page.goto('https://app.paseo.sh', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(1800);
  if (compact) {
    const openMenu = page.getByRole('button', { name: 'Open menu' });
    if (await openMenu.count()) await openMenu.click();
  }
  await page.getByRole('button', { name: /tinylink/i }).click();
  await page.getByText('Flowly', { exact: true }).first().click();
  await page.waitForTimeout(700);
  if (compact) {
    await page.getByRole('button', { name: /Project: Flowly/ }).click();
    await page.getByRole('button', { name: 'Tinylink', exact: true }).click();
  } else {
    await page.getByText('Tinylink', { exact: true }).last().click();
  }
  await page.waitForTimeout(900);
  const filter = page.getByRole('button', { name: /Task filters/ });
  if (await filter.count()) {
    const label = await filter.getAttribute('aria-label');
    if (/1 active/.test(label ?? '')) {
      await filter.click();
      await page.getByText('Reset filters', { exact: true }).click();
      await page.waitForTimeout(250);
      await page.getByText('Done', { exact: true }).last().click();
      await page.waitForTimeout(700);
    }
  }
  const boardText = await page.locator('body').innerText();
  const nativeSessionTipVisible = boardText.includes("Next steps, ideas and progress now also appear in Paseo's own session view");
  await page.getByRole('button', { name: /Open task \[test\] native session/ }).click();
  await page.waitForTimeout(800);
  return { nativeSessionTipVisible, boardText };
};
const evidence = { mode, startedAt: new Date().toISOString(), pageErrors, checks: {} };
try {
  if (mode === 'flowly') {
    const start = await openFlowlyCard();
    const drawerText = await page.locator('body').innerText();
    evidence.checks.boardRendersFixture = drawerText.includes(cardTitle);
    evidence.checks.drawerProgress = drawerText.includes('Progress') && drawerText.includes('Updated');
    evidence.checks.nativeSessionTipVisible = start.nativeSessionTipVisible;
    await screenshot('flowly-drawer-current');
    await page.getByRole('button', { name: /Preview \[test\] native session managed/ }).click();
    await page.waitForTimeout(1000);
    const ownText = await page.locator('body').innerText();
    evidence.checks.flowlyTranscriptProgressCount = (ownText.match(/Progress/g) ?? []).length;
    evidence.checks.flowlyTranscriptHasNoProgress = !ownText.includes('Updated') || !ownText.includes('Progress\n');
    evidence.checks.flowlySuggestionRowVisible = await page.getByRole('button', { name: /Suggested next step: Verify/ }).count() === 1;
    await screenshot('flowly-session-current');
    await page.getByRole('button', { name: /Suggested next step: Verify/ }).click();
    await page.waitForTimeout(300);
    const composer = page.getByRole('textbox').last();
    evidence.checks.flowlySuggestionFillsComposer = (await composer.inputValue()).includes('Verify the native session summary and chips.');
    await composer.fill('');
    await page.getByRole('button', { name: 'Hide suggestions' }).click();
    await page.waitForTimeout(300);
    evidence.checks.flowlyOwnHideButtonWorks = await page.getByRole('button', { name: /Suggested next step/ }).count() === 0;
    await screenshot('flowly-session-own-suggestions-hidden');
  } else if (mode === 'native') {
    await openFlowlyCard();
    await page.getByRole('button', { name: /Preview \[test\] native session managed/ }).click();
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: 'Open in Paseo' }).click();
    await page.waitForTimeout(1200);
    const nativeText = await page.locator('body').innerText();
    evidence.checks.taskChipPresent = nativeText.includes('Task · [test] native session');
    evidence.checks.nextChipPresent = nativeText.includes('Next · 2');
    evidence.checks.ideasChipPresent = nativeText.includes('Ideas · 1');
    evidence.checks.nativeProgressCard = nativeText.includes('Progress') && nativeText.includes('Updated') && nativeText.includes('Open card');
    evidence.checks.legacyUnavailablePlaceholderPresent = nativeText.includes('Plugin timeline item unavailable.');
    await screenshot('native-session-desktop-current');
    await page.getByRole('button', { name: 'Suggested next steps' }).click();
    await page.waitForTimeout(500);
    evidence.checks.nextPopoverText = (await page.locator('body').innerText()).slice(-1600);
    evidence.checks.nextPopoverButtons = await page.locator('button').evaluateAll((xs) => xs.map((x) => ({ text: x.innerText, label: x.getAttribute('aria-label') })).filter((x) => /verify|commit|send|dismiss|cancel/i.test(`${x.text} ${x.label}`)));
    await screenshot('native-next-popover-current');
  } else if (mode === 'native-current') {
    await openFlowlyCard();
    await page.getByRole('button', { name: /Preview \[test\] native session managed/ }).click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'Open in Paseo' }).click();
    await page.waitForTimeout(1500);
    const text = await page.locator('body').innerText();
    evidence.checks.taskChip = text.includes('Task · [test] native session');
    evidence.checks.nextChip = text.includes('Next · 2');
    evidence.checks.ideasChip = /Ideas · \d/.test(text);
    evidence.checks.nativeProgressCard = text.includes('Progress') && text.includes('Open card');
    await screenshot('native-session-current-state');
  } else if (mode === 'unmanaged') {
    await openFlowlyCard();
    await page.getByRole('button', { name: /Preview \[test\] native session unmanaged/ }).click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'Open in Paseo' }).click();
    await page.waitForTimeout(1200);
    const text = await page.locator('body').innerText();
    evidence.checks.taskChipPresent = text.includes('Task · [test] native session');
    evidence.checks.nextChipAbsent = !text.includes('Next · 2');
    evidence.checks.ideasChipAbsent = !/Ideas · \d/.test(text);
    evidence.checks.noNativeProgressRow = !text.includes('Updated') || !text.includes('Open card');
    await screenshot('native-unmanaged-session');
  } else if (mode === 'move-done') {
    await openFlowlyCard();
    await page.getByRole('button', { name: /Preview \[test\] native session managed/ }).click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'Open in Paseo' }).click();
    await page.waitForTimeout(1000);
    const before = await page.locator('body').innerText();
    evidence.checks.moveToDoneChipShown = before.includes('Move to Done');
    await page.getByRole('button', { name: 'Suggested next steps' }).click();
    await page.waitForTimeout(500);
    const popover = await page.locator('body').innerText();
    evidence.checks.moveToDonePopoverShown = popover.includes('Move to Done');
    evidence.checks.popoverButtons = await page.locator('button').evaluateAll((xs) => xs.map((x) => ({ text: x.innerText, label: x.getAttribute('aria-label') })).filter((x) => /done|dismiss|wrap up|not now/i.test(`${x.text} ${x.label}`)));
    await screenshot('native-move-to-done-popover');
    await page.getByRole('button', { name: /Suggested next step: Move to Done/ }).click();
    await page.waitForTimeout(2200);
    let after = await page.locator('body').innerText();
    evidence.checks.movedToastVisible = /Moved to Done|Done/.test(after.slice(-1600));
    evidence.checks.wrapUpQuestionAppeared = after.includes('Wrap up this card?');
    evidence.checks.wrapUpChoices = await page.locator('button').evaluateAll((xs) => xs.map((x) => ({ text: x.innerText, label: x.getAttribute('aria-label') })).filter((x) => /wrap up|open in flowly|not now/i.test(`${x.text} ${x.label}`)));
    await screenshot('native-moved-to-done');
    if (await page.getByRole('button', { name: 'Not now', exact: true }).count()) {
      await page.getByRole('button', { name: 'Not now', exact: true }).click();
      evidence.checks.notNowChosen = true;
    } else evidence.checks.notNowChosen = false;
  } else if (mode === 'send-next') {
    await openFlowlyCard();
    await page.getByRole('button', { name: /Preview \[test\] native session managed/ }).click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'Open in Paseo' }).click();
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: 'Suggested next steps' }).click();
    await page.getByRole('button', { name: /Suggested next step: Verify/ }).click();
    await page.waitForTimeout(300);
    const editor = page.getByRole('textbox').last();
    evidence.checks.nextMoveEditorPrefilled = (await editor.inputValue()) === 'Verify the native session summary and chips.';
    const sentText = 'Edited in Paseo: verify the native summary card exactly.';
    await editor.fill(sentText);
    evidence.checks.editedValueShownBeforeSend = (await editor.inputValue()) === sentText;
    await screenshot('native-next-edited-before-send');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await page.waitForTimeout(1200);
    const afterSend = await page.locator('body').innerText();
    evidence.checks.nativeTimelineShowsExactEditedText = afterSend.includes(sentText);
    evidence.checks.nextChipDisappearsOnNewTurn = !afterSend.includes('Next · 2');
    evidence.checks.sessionShowsRunningOrTurnStarted = /Running|Working|Worked for/.test(afterSend.slice(-1800));
    evidence.sentText = sentText;
    await screenshot('native-next-sent');
    evidence.checks.pageErrors = pageErrors;
  } else if (mode === 'ideas-inspect') {
    await openFlowlyCard();
    await page.getByRole('button', { name: /Preview \[test\] native session managed/ }).click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'Open in Paseo' }).click();
    await page.waitForTimeout(1000);
    const nativeText = await page.locator('body').innerText();
    evidence.checks.nextChipPresent = nativeText.includes('Next · 2');
    evidence.checks.ideasChipPresent = nativeText.includes('Ideas · 1');
    await page.getByRole('button', { name: 'Ideas for this card' }).click();
    await page.waitForTimeout(500);
    evidence.checks.ideasPopoverText = (await page.locator('body').innerText()).slice(-1800);
    evidence.checks.ideasPopoverButtons = await page.locator('button').evaluateAll((xs) => xs.map((x) => ({ text: x.innerText, label: x.getAttribute('aria-label') })).filter((x) => /continue|new card|dismiss/i.test(`${x.text} ${x.label}`)));
    await screenshot('native-ideas-popover');
  } else if (mode === 'idea-confirm') {
    await openFlowlyCard();
    await page.getByRole('button', { name: /Preview \[test\] native session managed/ }).click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'Open in Paseo' }).click();
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: 'Ideas for this card' }).click();
    await page.getByRole('button', { name: 'Continue here', exact: true }).click();
    await page.waitForTimeout(400);
    evidence.checks.confirmationText = (await page.locator('body').innerText()).slice(-1100);
    evidence.checks.confirmationButtons = await page.locator('button').evaluateAll((xs) => xs.map((x) => ({ text: x.innerText, label: x.getAttribute('aria-label') })).filter((x) => /send|cancel|continue/i.test(`${x.text} ${x.label}`)));
    await screenshot('native-idea-confirmation');
  } else if (mode === 'idea-new-task-inspect') {
    await openFlowlyCard();
    await page.getByRole('button', { name: /Preview \[test\] native session managed/ }).click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'Open in Paseo' }).click();
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: 'Ideas for this card' }).click();
    await page.getByRole('button', { name: /Start a new task/ }).click();
    await page.waitForTimeout(800);
    const body = await page.locator('body').innerText();
    evidence.checks.newTaskFormOpened = body.includes('New task') || body.includes('Create task');
    evidence.checks.newTaskFormText = body.slice(-1600);
    evidence.checks.formFields = await page.locator('input,textarea').evaluateAll((xs) => xs.map((x) => ({ placeholder: x.getAttribute('placeholder'), value: x.value, aria: x.getAttribute('aria-label') })));
    evidence.checks.formButtons = await page.locator('button').evaluateAll((xs) => xs.map((x) => ({ text: x.innerText, label: x.getAttribute('aria-label') })).filter((x) => /cancel|create|save/i.test(`${x.text} ${x.label}`)));
    await screenshot('native-idea-new-task-form');
  } else if (mode === 'idea-new-task-dismiss') {
    await openFlowlyCard();
    await page.getByRole('button', { name: /Preview \[test\] native session managed/ }).click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'Open in Paseo' }).click();
    await page.waitForTimeout(900);
    await page.getByRole('button', { name: 'Ideas for this card' }).click();
    await page.getByRole('button', { name: /Start a new task/ }).click();
    await page.waitForTimeout(500);
    evidence.checks.titlePrefilled = (await page.getByRole('textbox', { name: 'Title' }).inputValue()) === 'Document session summary troubleshooting';
    await page.getByRole('button', { name: 'Cancel', exact: true }).first().click();
    await page.waitForTimeout(500);
    evidence.checks.formCancelled = await page.getByRole('textbox', { name: 'Title' }).count() === 0;
    evidence.checks.noTaskCreatedByForm = !(await page.locator('body').innerText()).includes('Document session summary troubleshooting');
    await screenshot('native-new-task-form-cancelled');
    await openFlowlyCard();
    await page.getByRole('button', { name: /Preview \[test\] native session managed/ }).click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'Open in Paseo' }).click();
    await page.waitForTimeout(900);
    await page.getByRole('button', { name: 'Ideas for this card' }).click();
    await page.getByRole('button', { name: /Dismiss Document session summary troubleshooting/ }).click();
    await page.waitForTimeout(500);
    evidence.checks.ideaChipGoneAfterDismiss = !(await page.locator('body').innerText()).includes('Ideas · 1');
    await screenshot('native-idea-dismissed');
  } else if (mode === 'idea-continue') {
    await openFlowlyCard();
    await page.getByRole('button', { name: /Preview \[test\] native session managed/ }).click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'Open in Paseo' }).click();
    await page.waitForTimeout(900);
    await page.getByRole('button', { name: 'Ideas for this card' }).click();
    await page.getByRole('button', { name: 'Continue here', exact: true }).click();
    await page.waitForTimeout(300);
    const confirmText = await page.locator('body').innerText();
    evidence.checks.confirmedSessionDestinationShown = confirmText.includes('Sends this idea to this session.');
    await page.getByRole('button', { name: 'Send', exact: true }).first().click();
    await page.waitForTimeout(1500);
    const after = await page.locator('body').innerText();
    evidence.checks.ideasPopoverClosedAfterSend = !after.includes('Sends this idea to this session.');
    evidence.checks.nextTurnStartedOrFinished = /Running|Working|Worked for/.test(after.slice(-1500));
    await screenshot('native-idea-continued');
  } else if (mode === 'dismiss-next') {
    await openFlowlyCard();
    await page.getByRole('button', { name: /Preview \[test\] native session managed/ }).click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'Open in Paseo' }).click();
    await page.waitForTimeout(1000);
    const before = await page.locator('body').innerText();
    evidence.checks.nextChipBeforeDismiss = before.includes('Next · 2');
    await page.getByRole('button', { name: 'Suggested next steps' }).click();
    await page.getByText('Dismiss', { exact: true }).last().click();
    await page.waitForTimeout(400);
    const afterDismiss = await page.locator('body').innerText();
    evidence.checks.nextChipHiddenAfterDismiss = !afterDismiss.includes('Next · 2');
    await screenshot('native-next-dismissed');
    await openFlowlyCard();
    await page.getByRole('button', { name: /Preview \[test\] native session managed/ }).click();
    await page.waitForTimeout(800);
    evidence.checks.flowlySuggestionRowRemains = await page.getByRole('button', { name: /Suggested next step: Verify/ }).count() === 1 && await page.getByRole('button', { name: /Suggested next step: Commit/ }).count() === 1;
    evidence.checks.flowlyTranscriptHasNoProgress = !(await page.locator('body').innerText()).includes('Progress\n');
    await screenshot('flowly-suggestion-row-after-native-dismiss');
  } else if (mode === 'compact') {
    await openFlowlyCard();
    await page.getByRole('button', { name: /Preview \[test\] native session managed/ }).click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'Open in Paseo' }).click();
    await page.waitForTimeout(1200);
    const compactText = await page.locator('body').innerText();
    evidence.checks.taskChipPresent = compactText.includes('Task · [test] native session');
    evidence.checks.progressCardVisible = compactText.includes('Progress') && compactText.includes('Open card');
    evidence.checks.nextChipVisible = compactText.includes('Next · 2');
    evidence.checks.ideasChipVisible = compactText.includes('Ideas · 1');
    await screenshot('native-session-compact-current');
    if (evidence.checks.nextChipVisible) {
      await page.getByRole('button', { name: 'Suggested next steps' }).click();
      await page.waitForTimeout(500);
      evidence.checks.nextPopoverVisible = (await page.locator('body').innerText()).includes('Commit');
      await screenshot('native-next-popover-compact');
    }
  } else throw new Error(`Unsupported UI mode ${mode}`);
} catch (error) {
  evidence.error = String(error?.stack ?? error);
  await screenshot(`error-${mode}`).catch(() => {});
  process.exitCode = 1;
} finally {
  evidence.pageErrors = pageErrors;
  evidence.endedAt = new Date().toISOString();
  const { writeFile, mkdir } = await import('node:fs/promises');
  const out = new URL(`../../fixtures/native-session/ui-evidence-${mode}.json`, import.meta.url);
  await mkdir(new URL('../../native-session/', import.meta.url), { recursive: true });
  await writeFile(out, JSON.stringify(evidence, null, 2));
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
  console.log(JSON.stringify(evidence, null, 2));
}
