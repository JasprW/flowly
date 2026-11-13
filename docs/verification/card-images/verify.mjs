// Card images live check on the permanent Tinylink project (CARD-IMAGES-SPEC §8).
// Usage: node verify.mjs setup | web | agents | check | cleanup   (state in /tmp/card-images-verify.json)
// Only the card this script creates is touched; cleanup deletes it with its own sessions and workspace.
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { DaemonClient } from '@getpaseo/client/internal/daemon-client';
import { createPaseoApi } from '@getpaseo/client';
import { launch, open, openCard, shot, pageText } from '../../promo/shot-lib.mjs';

const stateFile = '/tmp/card-images-verify.json';
const out = new URL('./', import.meta.url).pathname;
const TITLE = 'Card images check (temporary)';
const ids = JSON.parse(await readFile(process.env.TINYLINK_IDS || '/Users/bofan.wang/Developer/personal/paseo-utlra-kanban/docs/promo/ids.json', 'utf8'));
const load = async () => JSON.parse(await readFile(stateFile, 'utf8').catch(() => '{}'));
const save = (s) => writeFile(stateFile, JSON.stringify(s, null, 2));
const client = new DaemonClient({ url: 'ws://127.0.0.1:6767/ws', clientId: `verify-${randomUUID()}`, clientType: 'cli', appVersion: '0.11.2', connectTimeoutMs: 10000, reconnect: { enabled: false } });
const api = createPaseoApi(client);
const rpc = (m, i) => client.invokePluginRpc('flowly', m, i);
const task = async (id) => (await rpc('board.overview-changed', {})).value.tasks.find((t) => t.id === id);
const step = process.argv[2];
await client.connect();
try {
  if (step === 'setup') {
    const browser = await launch();
    const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
    const images = [['ALPHA 4821', '#c62828'], ['BRAVO 7350', '#1565c0'], ['CHARLIE 1946', '#2e7d32']];
    await mkdir('/tmp/card-images-verify', { recursive: true });
    const files = [];
    for (const [text, color] of images) {
      await page.setContent(`<body style="margin:0;background:${color};display:flex;align-items:center;justify-content:center;height:360px"><div style="font:bold 72px sans-serif;color:white">${text}</div></body>`);
      const path = `/tmp/card-images-verify/${text.split(' ')[0].toLowerCase()}.png`;
      await page.screenshot({ path });
      files.push(path);
    }
    await browser.close();
    const card = await rpc('tasks.create', { projectId: ids.project.id, operationId: `verify-${randomUUID()}`, title: TITLE, description: 'Temporary card for the card images check. The images below are part of this description.', status: 'todo', priority: 'normal', type: 'chore', mode: 'directory' });
    await save({ card: card.id, workspace: card.workspaceId, files, sessions: [] });
    console.log('card', card.id, card.workspaceId);
  } else if (step === 'web') {
    const s0 = await load();
    const browser = await launch();
    const s = await open(browser, { w: 1700, h: 1000, project: 'Tinylink' });
    const { page } = s;
    const log = [];
    await openCard(s, TITLE);
    await page.waitForTimeout(1500);
    await shot(s, `${out}01-drawer-before.png`);
    await page.locator('[aria-label="Edit task"]').first().click();
    await page.getByText('Add images').first().waitFor({ timeout: 10000 });
    const field = page.locator('textarea').filter({ hasText: 'Temporary card' }).first();
    const fire = async (kind, path, name) => {
      const b64 = (await readFile(path)).toString('base64');
      await field.evaluate((node, { kind, b64, name }) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const dt = new DataTransfer();
        dt.items.add(new File([bytes], name, { type: 'image/png' }));
        if (kind === 'paste') node.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
        else {
          node.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
          node.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
        }
      }, { kind, b64, name });
      await page.waitForTimeout(800);
    };
    await fire('paste', s0.files[0], 'alpha.png');
    await fire('drop', s0.files[1], 'bravo.png');
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByText('Add images').first().click()]);
    await chooser.setFiles(s0.files[2]);
    await page.waitForTimeout(1000);
    log.push(`pending thumbnails in Edit task: ${await page.locator('img[alt$=".png"], [aria-label^="Remove "]').count()}`);
    await shot(s, `${out}02-edit-task-three-added.png`);
    await page.getByText('Save task').last().click();
    await page.waitForTimeout(5000);
    const after = await task(s0.card);
    log.push(`after save: ${after.images?.length ?? 0} images, revision ${after.revision}, thumbs ${after.images?.map((i) => i.thumbMimeType || 'none').join(',')}`);
    await shot(s, `${out}03-drawer-thumbnails.png`);
    await page.locator('[aria-label="alpha.png"]').first().click();
    await page.waitForTimeout(2500);
    await shot(s, `${out}04-viewer-alpha.png`);
    await page.locator('[aria-label="Next image"]').first().click();
    await page.waitForTimeout(2500);
    await shot(s, `${out}05-viewer-next.png`);
    log.push(`viewer text: ${(await pageText(s)).split('\n').filter((l) => /\d \/ \d|\.png/.test(l)).join(' | ')}`);
    await page.getByText('Remove', { exact: true }).last().click();
    await page.waitForTimeout(4000);
    const removed = await task(s0.card);
    log.push(`after remove: ${removed.images?.length ?? 0} images (${removed.images?.map((i) => i.name).join(', ')})`);
    await shot(s, `${out}06-drawer-after-remove.png`);
    log.push(`page errors: ${s.errors.length ? s.errors.join(' || ') : 'none'}`);
    await browser.close();
    await writeFile(`${out}web-log.txt`, log.join('\n') + '\n');
    console.log(log.join('\n'));
  } else if (step === 'check') {
    const s0 = await load();
    const t = await task(s0.card);
    const ctx = await rpc('tasks.context', { id: s0.card });
    const line = ctx.context.split('\n').find((l) => l.startsWith('Card images'));
    const paths = line ? line.split(': ').slice(1).join(': ').split(', ') : [];
    const sizes = await Promise.all(paths.map((p) => stat(p).then((x) => x.size, () => -1)));
    console.log(JSON.stringify({ images: t.images, contextLine: line, sizes }, null, 2));
  } else if (step === 'agents') {
    const s0 = await load();
    const prompt = 'Look at the images listed as card images in your task context and reply with the exact text written in each one, one line per image. Do not change any files, and do not change the card.';
    for (const [provider, mode, label] of [['claude/claude-haiku-5-5', 'bypassPermissions', 'Haiku'], [process.argv[3] || 'codex/gpt-5.5', process.argv[4] || 'full-access', 'Codex']]) {
      const prep = await rpc('tools.prepare-session', { id: s0.card, operationId: `verify-${randomUUID()}` });
      const a = await api.workspaces.ref(s0.workspace).agents.create({
        agentId: prep.agentId, idempotencyKey: `verify:${prep.agentId}`, title: `${label} · card images check`,
        labels: { 'flowly-task': s0.card },
        config: { provider, modeId: mode, systemPrompt: prep.instructions },
        env: { FLOWLY_CONTEXT_FILE: prep.contextFile, FLOWLY_CLI: prep.cliPath, FLOWLY_SKILL: prep.skillPath },
        prompt,
      });
      s0.sessions.push({ label, id: a.id });
      await save(s0);
      console.log(label, a.id);
    }
  } else if (step === 'cleanup') {
    const s0 = await load();
    const t = await task(s0.card);
    if (t) console.log(JSON.stringify(await rpc('tasks.delete', { id: t.id, revision: t.revision, archive: true, acknowledgeWarnings: true })));
  }
} finally { await api.dispose().catch(() => {}); await client.close().catch(() => {}); }
