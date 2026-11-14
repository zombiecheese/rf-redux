// `node tools/title-art/modern.mjs`: draws the modern title art (packages/client/src/title/title-modern.jpg). The
// classic title art's scene (scene.js) is rendered twice in headless Chromium, by night and through the thermal
// camera, and the two are cut together on a slant with a stream glitch at the cut, under the modern view's
// drone-feed overlay and computer-vision boxes. Needs Playwright (npm i -D playwright && npx playwright install chromium).
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = fileURLToPath(new URL('../../packages/client/src/title/title-modern.jpg', import.meta.url));

const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch();
const shots = {};
let marks = [];
for (const mode of ['night', 'thermal']) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error(e));
  await page.goto(`file://${join(here, 'page.html')}?mode=${mode}`);
  await page.waitForFunction(() => window.done, null, { timeout: 600_000 });
  shots[mode] = await page.evaluate(() => document.getElementById('c').toDataURL('image/png'));
  marks = await page.evaluate(() => window.marks);
  await page.close();
}

const page = await browser.newPage();
const jpeg = await page.evaluate(async ({ shots, marks }) => {
  const W = 1280, H = 720, S = W / 960;
  const load = (src) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = src; });
  const [night, thermal] = await Promise.all([load(shots.night), load(shots.thermal)]);
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

  // Night on the left, thermal on the right, cut on a slant.
  const cut = (y) => 860 - (y / H) * 150;
  g.drawImage(night, 0, 0, W, H);
  g.save();
  g.beginPath(); g.moveTo(cut(0), 0); g.lineTo(W, 0); g.lineTo(W, H); g.lineTo(cut(H), H); g.closePath(); g.clip();
  g.drawImage(thermal, 0, 0, W, H);
  g.restore();

  // The stream glitch along the cut: torn rows, split colour, broken blocks.
  const snap = g.getImageData(0, 0, W, H);
  for (let y = 0; y < H;) {
    const h = 2 + Math.floor(rnd() * 14), x0 = Math.floor(cut(y) - 40 - rnd() * 50), w = 80 + Math.floor(rnd() * 120);
    const shift = Math.floor((rnd() - 0.5) * 70);
    if (rnd() < 0.7) g.putImageData(snap, shift, 0, x0, y, w, h);
    if (rnd() < 0.35) { g.fillStyle = `rgba(${rnd() < 0.5 ? '255,40,60' : '40,220,255'},0.18)`; g.fillRect(x0 + shift, y, w, h); }
    y += h + Math.floor(rnd() * 10);
  }
  for (let i = 0; i < 22; i++) {
    const bs = 8 + Math.floor(rnd() * 3) * 8, y = Math.floor(rnd() * H), x = Math.floor(cut(y) + (rnd() - 0.5) * 120);
    g.putImageData(snap, Math.floor((rnd() - 0.5) * 40), Math.floor((rnd() - 0.5) * 24), x, y, bs, bs);
  }
  // A few thin tears across the whole picture.
  for (let i = 0; i < 4; i++) {
    const y = Math.floor(rnd() * H), h = 1 + Math.floor(rnd() * 3);
    g.putImageData(snap, Math.floor((rnd() - 0.5) * 24), 0, 0, y, W, h);
  }

  // The feed's look: grain, a soft lens rim, scan lines.
  const img = g.getImageData(0, 0, W, H), d = img.data;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const k = (y * W + x) * 4, n = (rnd() - 0.5) * 18, dx = x / W - 0.5, dy = y / H - 0.5, rim = 1 - 0.55 * (dx * dx + dy * dy) * 1.6;
    const line = y % 3 === 0 ? 0.93 : 1;
    for (let c = 0; c < 3; c++) d[k + c] = Math.max(0, Math.min(255, (d[k + c] + n) * rim * line));
  }
  g.putImageData(img, 0, 0);

  // Computer-vision boxes on the vehicles.
  g.font = 'bold 13px ui-monospace, "Cascadia Mono", Menlo, Consolas, monospace';
  g.textBaseline = 'top';
  const tag = (x, y, lines, col) => {
    const w = Math.max(...lines.map((l) => g.measureText(l).width)) + 10;
    g.fillStyle = 'rgba(0,0,0,0.72)'; g.fillRect(x, y - lines.length * 15 - 4, w, lines.length * 15 + 4);
    lines.forEach((l, i) => { g.fillStyle = i ? '#9ff0a4' : col; g.fillText(l, x + 5, y - (lines.length - i) * 15 - 1); });
  };
  const brackets = (x0, y0, x1, y1, col) => {
    const c = Math.min(18, (x1 - x0) / 4, (y1 - y0) / 4);
    g.strokeStyle = col; g.lineWidth = 2;
    for (const [x, y, sx, sy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]]) {
      g.beginPath(); g.moveTo(x + sx * c, y); g.lineTo(x, y); g.lineTo(x, y + sy * c); g.stroke();
    }
  };
  const LABEL = {
    JEEP: { text: 'OWN JEEP 0.97', state: 'INTEGRITY 100% NOMINAL', col: '#e6e6e6' },
    HELICOPTER: { text: 'HOSTILE HELICOPTER 0.91', state: 'INTEGRITY 64% DAMAGED', col: '#ff6a5c' },
    TANK: { text: 'HOSTILE TANK 0.95', state: 'INTEGRITY 100% NOMINAL', col: '#ff6a5c' },
    ASV: { text: 'HOSTILE ASV 0.88', state: 'INTEGRITY 82% NOMINAL', col: '#ff6a5c' },
  };
  for (const m of marks) {
    const l = LABEL[m.name];
    if (!l) continue;
    const pad = 6, [x0, y0, x1, y1] = m.box.map((v) => v * S);
    brackets(x0 - pad, Math.max(4, y0 - pad), x1 + pad, Math.min(H - 4, y1 + pad), l.col);
    tag(x0 - pad, Math.max(36, y0 - pad - 2), [l.text, l.state], l.col);
  }

  // The drone's overlay: corner brackets, the feed's name, the clock and both cameras' modes.
  g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 2;
  for (const [x, y, sx, sy] of [[22, 22, 1, 1], [W - 22, 22, -1, 1], [22, H - 22, 1, -1], [W - 22, H - 22, -1, -1]]) {
    g.beginPath(); g.moveTo(x + sx * 30, y); g.lineTo(x, y); g.lineTo(x, y + sy * 30); g.stroke();
  }
  g.font = 'bold 14px ui-monospace, "Cascadia Mono", Menlo, Consolas, monospace';
  g.textAlign = 'right'; g.fillStyle = '#f2f2f2';
  g.fillText('UAV-1   REC', W - 40, 34);
  g.fillStyle = '#ff3b30'; g.beginPath(); g.arc(W - 72, 41, 5, 0, 7); g.fill();
  g.fillStyle = '#f2f2f2';
  g.fillText('1996-05-17 02:14:07Z', W - 40, 54);
  g.fillText('EO NIGHT  |  IR WHT', W - 40, 74);
  g.textAlign = 'left';
  g.fillText('ALT 2400FT', cut(H - 120) - 6 + 30, H - 112);
  g.fillText('GRID 48-66   ZOOM 1.5X', cut(H - 90) + 30, H - 92);
  g.font = 'bold 12px ui-monospace, Menlo, Consolas, monospace';
  g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(cut(40) - 46, 40, 92, 18);
  g.fillStyle = '#ffd54a'; g.textAlign = 'center'; g.fillText('EO  |  IR', cut(40), 43);
  return cv.toDataURL('image/jpeg', 0.88);
}, { shots, marks });
await browser.close();
writeFileSync(out, Buffer.from(jpeg.split(',')[1], 'base64'));
console.log(`wrote ${out}`);
