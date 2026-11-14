#!/usr/bin/env node
// Review sheets for the art pack: each sprite enlarged and numbered, so a batch of art can be looked over in one
// picture. With --assets, each is set beside the sprite of the same number in another pack, for comparing.
//
//   node tools/art-sheet.mjs                  every sprite in the art pack
//   node tools/art-sheet.mjs --cels 0-127     these sprites (ranges and single numbers, with commas)
//   --assets <folder>   another pack, laid out like the art pack, to compare with
//   --name <name>       the file's name (default the cel list, or "all")
//   --scale <n>         enlargement (default 3)
//
// Sheets go to assets/generated/art-sheets/, which is git-ignored: they are for looking at, not for committing.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePng, image, rgb } from './art/png.mjs';

const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const PACK = opt('--assets') ? resolve(opt('--assets')) : null;
const ART = here('../assets/art/pack');
const scale = Math.max(1, Number(opt('--scale') ?? 3) | 0);

function load(dir) {
  const file = join(dir, 'sprites/frames.json');
  if (!existsSync(file)) return new Map();
  const frames = JSON.parse(readFileSync(file, 'utf8'));
  const atlases = new Map();
  const out = new Map();
  for (const f of frames) {
    if (!atlases.has(f.atlas)) atlases.set(f.atlas, decodePng(readFileSync(join(dir, `sprites/atlas-${f.atlas}.png`))));
    const a = atlases.get(f.atlas);
    const img = image(f.w, f.h);
    for (let y = 0; y < f.h; y++) img.px.set(a.px.subarray((f.y + y) * a.w + f.x, (f.y + y) * a.w + f.x + f.w), y * f.w);
    out.set(f.cel, img);
  }
  return out;
}
const pack = PACK ? load(PACK) : new Map();
const art = load(ART);
if (!pack.size && !art.size) {
  console.error(`No sprites in ${ART}. Run \`npm run art\` first (docs/assets.md).`);
  process.exit(1);
}

const spec = opt('--cels');
const wanted = spec
  ? spec.split(',').flatMap((part) => {
    const [a, b = a] = part.split('-').map(Number);
    return Array.from({ length: b - a + 1 }, (_, k) => a + k);
  }).filter((c) => pack.has(c) || art.has(c))
  : [...art.keys()].sort((a, b) => a - b);
if (!wanted.length) {
  console.error(spec ? `Neither pack has any of the sprites ${spec}.` : 'The art pack is empty; run `npm run art`.');
  process.exit(1);
}

const DIGITS = [[7, 5, 5, 5, 7], [2, 6, 2, 2, 7], [7, 1, 7, 4, 7], [7, 1, 7, 1, 7], [5, 5, 7, 1, 1], [7, 4, 7, 1, 7], [7, 4, 7, 5, 7], [7, 1, 2, 2, 2], [7, 5, 7, 5, 7], [7, 5, 7, 1, 7]];
function number(sheet, n, x, y, c) {
  [...String(n)].forEach((ch, k) => DIGITS[Number(ch)].forEach((bits, j) => {
    for (let i = 0; i < 3; i++) if (bits & (4 >> i)) for (let v = 0; v < 2; v++) for (let u = 0; u < 2; u++) sheet.px[(y + j * 2 + v) * sheet.w + x + (k * 4 + i) * 2 + u] = c;
  }));
}
/** A sprite enlarged onto the sheet over a checked ground, so its clear pixels show. */
function paste(sheet, img, x, y) {
  for (let j = 0; j < img.h * scale; j++) {
    for (let i = 0; i < img.w * scale; i++) {
      const p = img.px[Math.floor(j / scale) * img.w + Math.floor(i / scale)];
      const check = ((i >> 2) + (j >> 2)) & 1 ? rgb(58, 60, 66) : rgb(44, 46, 52);
      sheet.px[(y + j) * sheet.w + x + i] = p >>> 24 ? p : check;
    }
  }
}

// One cell per sprite: its number, then the compared pack's sprite (with --assets) and the art pack's side by side.
const GAP = 6;
const LABEL = 14;
const cells = wanted.map((cel) => {
  const a = pack.get(cel);
  const b = art.get(cel);
  const w = ((a?.w ?? 0) + (b?.w ?? 0)) * scale + (a && b ? GAP : 0);
  return { cel, a, b, w: Math.max(w, 40), h: Math.max(a?.h ?? 0, b?.h ?? 0) * scale + LABEL };
});
const WIDTH = Math.max(1200, ...cells.map((c) => c.w + 2 * GAP));
let x = GAP;
let y = GAP;
let row = 0;
for (const c of cells) {
  if (x + c.w + GAP > WIDTH) {
    x = GAP;
    y += row + GAP;
    row = 0;
  }
  c.x = x;
  c.y = y;
  x += c.w + GAP * 2;
  row = Math.max(row, c.h);
}
const sheet = image(WIDTH, y + row + GAP, rgb(24, 26, 30));
for (const c of cells) {
  number(sheet, c.cel, c.x, c.y, c.b ? rgb(120, 220, 120) : rgb(200, 200, 200));
  let at = c.x;
  if (c.a) {
    paste(sheet, c.a, at, c.y + LABEL);
    at += c.a.w * scale + GAP;
  }
  if (c.b) paste(sheet, c.b, at, c.y + LABEL);
}
const name = (opt('--name') ?? (spec ? spec.replaceAll(',', '_') : 'all')).replace(/[^A-Za-z0-9_-]/g, '');
const out = here('../assets/generated/art-sheets');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, `${name}.png`), encodePng(sheet));
console.log(`${wanted.length} sprites (${wanted.filter((c) => art.has(c)).length} in the art pack, numbered in green) -> ${join(out, `${name}.png`)}`);
