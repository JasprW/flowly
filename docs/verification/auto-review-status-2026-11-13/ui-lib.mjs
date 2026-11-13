// The installed desktop app's web build, served only in this test context.
import { readFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { open } from '../../promo/shot-lib.mjs';
const DIST = '/Applications/Paseo.app/Contents/Resources/app-dist';
const types = { '.js': 'application/javascript', '.html': 'text/html', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.css': 'text/css', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' };
export async function open016(browser, opts) {
  const orig = browser.newContext.bind(browser);
  browser.newContext = async (o) => {
    const ctx = await orig(o);
    await ctx.route('https://app.paseo.sh/**', async (route) => {
      const url = new URL(route.request().url());
      let p = join(DIST, decodeURIComponent(url.pathname));
      if (!existsSync(p) || statSync(p).isDirectory()) p = join(DIST, 'index.html');
      await route.fulfill({ status: 200, body: await readFile(p), headers: { 'content-type': types[extname(p)] ?? 'application/octet-stream' } });
    });
    return ctx;
  };
  return open(browser, opts);
}
