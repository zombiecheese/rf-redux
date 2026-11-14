// `node tools/title-art/render.mjs`: draws the title art in headless Chromium (needs Playwright: npm i -D playwright
// && npx playwright install chromium), then pixelate.py makes the game's copy from it: boxed down to 480 x 270 and
// held to a 160-colour palette, like the original's 8-bit pictures. Pass --master <file> to keep the 960 x 540 render.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = fileURLToPath(new URL('../../packages/client/src/title/title-art.png', import.meta.url));
const at = process.argv.indexOf('--master');
const master = at > 0 ? process.argv[at + 1] : join(mkdtempSync(join(tmpdir(), 'title-art-')), 'master.png');

// require, not import, so a global install (NODE_PATH) works too
const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (e) => console.error(e));
await page.goto(`file://${join(here, 'page.html')}`);
await page.waitForFunction(() => window.done, null, { timeout: 600_000 });
const url = await page.evaluate(() => document.getElementById('c').toDataURL('image/png'));
await browser.close();
writeFileSync(master, Buffer.from(url.split(',')[1], 'base64'));

const python = process.platform === 'win32' ? 'python' : 'python3';
const run = spawnSync(python, [join(here, 'pixelate.py'), master, out], { stdio: 'inherit' });
if (run.status !== 0) process.exit(run.status ?? 1);
console.log(`wrote ${out}`);
