// `node tools/title-art/modern.mjs`: captures the modern title art (packages/client/src/title/title-modern.jpg) from
// the modern gallery's title part: a four-base bot match on Four Corners, run headless to a fixed tick, drawn as the
// drone's feed with the computer-vision boxes. Start the dev server first (npm run dev). Needs Playwright and Python
// with Pillow. Pass other gallery options to try another shot, e.g. `--query "ticks=2400&follow=1&night=1"`.
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = fileURLToPath(new URL('../../packages/client/src/title/title-modern.jpg', import.meta.url));
const at = process.argv.indexOf('--query');
const query = at > 0 ? process.argv[at + 1] : 'map=quad01&seed=7&ticks=2000&follow=2&x=40&z=300';
const png = join(mkdtempSync(join(tmpdir(), 'title-modern-')), 'frame.png');

const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.error(e));
await page.goto(`http://localhost:5173/modern-gallery.html?part=title&${query}`);
await page.waitForFunction(() => document.title === 'ready', null, { timeout: 300_000 });
await page.screenshot({ path: png });
await browser.close();

const python = process.platform === 'win32' ? 'python' : 'python3';
const code = `from PIL import Image; Image.open(r'${png}').convert('RGB').save(r'${out}', quality=86, optimize=True, progressive=True)`;
const run = spawnSync(python, ['-c', code], { stdio: 'inherit' });
if (run.status !== 0) process.exit(run.status ?? 1);
console.log(`wrote ${out}`);
