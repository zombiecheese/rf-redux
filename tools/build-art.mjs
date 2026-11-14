#!/usr/bin/env node
// Builds the art pack the game runs on: its sprites, models, number tables, sounds and cockpit pictures. Run it
// with `npm run art` after changing a drawing.
//
// Sources, later ones winning:
//   tools/art/sets/*.mjs   sprites drawn in code. Each file exports draw(put): put(cel, image, { mode }) hands over
//                          one sprite by its cel number (see `npm run asset-inventory` for the numbers and uses).
//   assets/art/cels/N.png  a sprite drawn by hand, replacing cel N (8-bit PNG; see-through pixels are transparent).
//   tools/art/models/      the models and number tables, in code: buildings.mjs, vehicles.mjs, effects.mjs and
//                          shore.mjs each export the table of the same name.
//   tools/art/sounds.mjs   the sound effects, worked out in code: sounds() gives each by name.
//   tools/art/screens.mjs  the cockpit panels and the split screen's post: screens() gives each by name.
//
// Output, committed with the sources:
//   assets/art/pack/sprites/atlas-N.png and frames.json
//   assets/art/pack/buildings.json, vehicles.json, effects.json and shore.json
//   assets/art/pack/sound/NAME.wav   the sound effects
//   assets/art/pack/screens/NAME.png   the cockpit panels and the split screen's post
//   assets/art/pack/art.json   what the pack holds
//
// assets/art/pack/maps/ is not built here: it holds the original's two-player map layouts (assets/art/README.md),
// and this script leaves it alone.
//
//   --out <folder>    write the pack somewhere else (the tests do)
//   --cels <folder>   read hand-drawn sprites from somewhere else
//   --sets <folder>   read the sprites drawn in code from somewhere else (and then no models, unless --models)
//   --models <folder> read the models and tables from somewhere else
//   --check           build nothing; exit 1 if the committed pack is out of date

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { decodePng, encodePng, image } from './art/png.mjs';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(name) ? resolve(args[args.indexOf(name) + 1]) : fallback);
const OUT = arg('--out', here('../assets/art/pack'));
const CELS = arg('--cels', here('../assets/art/cels'));
const SETS = arg('--sets', here('./art/sets'));
const MODELS = arg('--models', args.includes('--sets') ? null : here('./art/models'));
const TABLES = ['buildings', 'vehicles', 'effects', 'shore'];
const SOUNDS = MODELS && existsSync(join(MODELS, '../sounds.mjs')) ? join(MODELS, '../sounds.mjs') : null;
const SCREENS = MODELS && existsSync(join(MODELS, '../screens.mjs')) ? join(MODELS, '../screens.mjs') : null;
const check = args.includes('--check');

/** cel number -> { img, mode, from }. */
const cels = new Map();
const put = (from) => (cel, img, opts = {}) => {
  if (!Number.isInteger(cel) || cel < 0) throw new Error(`${from}: ${cel} is not a cel number`);
  if (!img || img.px.length !== img.w * img.h || !img.w || !img.h) throw new Error(`${from}: cel ${cel} has no pixels`);
  cels.set(cel, { img, mode: opts.mode, from });
};

const sets = existsSync(SETS) ? readdirSync(SETS).filter((f) => f.endsWith('.mjs')).sort() : [];
for (const file of sets) {
  const set = await import(pathToFileURL(join(SETS, file)).href);
  if (typeof set.draw !== 'function') throw new Error(`tools/art/sets/${file} must export draw(put)`);
  await set.draw(put(file));
}
const drawn = existsSync(CELS) ? readdirSync(CELS).filter((f) => /^\d+\.png$/.test(f)).sort((a, b) => parseInt(a) - parseInt(b)) : [];
for (const file of drawn) {
  try {
    put(`cels/${file}`)(parseInt(file), decodePng(readFileSync(join(CELS, file))));
  } catch (err) {
    console.error(`assets/art/cels/${file}: ${err.message}`);
    process.exit(1);
  }
}

// Shelf-pack into atlases 1024 wide and at most 2048 tall, tallest first, a pixel apart.
const W = 1024;
const H = 2048;
const list = [...cels.entries()].sort((a, b) => b[1].img.h - a[1].img.h || a[0] - b[0]);
const frames = [];
const heights = [];
let atlas = 0;
let x = 0;
let y = 0;
let row = 0;
for (const [cel, { img, mode }] of list) {
  if (img.w > W || img.h > H) throw new Error(`cel ${cel} is ${img.w} x ${img.h}, larger than an atlas`);
  if (x + img.w > W) {
    x = 0;
    y += row + 1;
    row = 0;
  }
  if (y + img.h > H) {
    heights[atlas] = y;
    atlas++;
    x = y = row = 0;
  }
  frames.push({ cel, atlas, x, y, w: img.w, h: img.h, ...(mode === undefined ? {} : { packed: mode }) });
  x += img.w + 1;
  row = Math.max(row, img.h);
}
if (frames.length) heights[atlas] = y + row;
const files = new Map();
heights.forEach((h, i) => {
  const sheet = image(W, Math.max(1, h));
  for (const f of frames.filter((f) => f.atlas === i)) {
    const { img } = cels.get(f.cel);
    for (let j = 0; j < f.h; j++) sheet.px.set(img.px.subarray(j * f.w, (j + 1) * f.w), (f.y + j) * W + f.x);
  }
  files.set(`sprites/atlas-${i}.png`, encodePng(sheet));
});
frames.sort((a, b) => a.cel - b.cel);
files.set('sprites/frames.json', Buffer.from(JSON.stringify(frames)));
const bySource = {};
for (const { from } of cels.values()) bySource[from.startsWith('cels/') ? 'drawn by hand' : from] = (bySource[from.startsWith('cels/') ? 'drawn by hand' : from] ?? 0) + 1;
const tables = [];
for (const name of MODELS ? TABLES : []) {
  if (!existsSync(join(MODELS, `${name}.mjs`))) continue;
  const table = (await import(pathToFileURL(join(MODELS, `${name}.mjs`)).href))[name];
  if (!table) throw new Error(`tools/art/models/${name}.mjs must export ${name}`);
  files.set(`${name}.json`, Buffer.from(JSON.stringify(table)));
  tables.push(name);
}
let sounds = 0;
if (SOUNDS) {
  const made = await import(pathToFileURL(SOUNDS).href);
  for (const [name, samples] of Object.entries(made.sounds())) {
    files.set(`sound/${name}.wav`, made.wav(samples));
    sounds++;
  }
}
let screens = 0;
if (SCREENS) {
  for (const [name, img] of Object.entries((await import(pathToFileURL(SCREENS).href)).screens())) {
    files.set(`screens/${name}.png`, encodePng(img));
    screens++;
  }
}
files.set('art.json', Buffer.from(JSON.stringify({ format: 'rfw-art', version: 1, sprites: frames.length, atlases: heights.length, sources: bySource, tables, sounds, screens }, null, 2) + '\n'));

if (check) {
  const stale = [...files].filter(([path, data]) => !existsSync(join(OUT, path)) || !readFileSync(join(OUT, path)).equals(data)).map(([path]) => path);
  const extra = existsSync(join(OUT, 'sprites')) ? readdirSync(join(OUT, 'sprites')).filter((f) => !files.has(`sprites/${f}`)) : [];
  extra.push(...TABLES.map((t) => `${t}.json`).filter((f) => existsSync(join(OUT, f)) && !files.has(f)));
  if (existsSync(join(OUT, 'screens'))) extra.push(...readdirSync(join(OUT, 'screens')).map((f) => `screens/${f}`).filter((f) => !files.has(f)));
  if (existsSync(join(OUT, 'sound'))) extra.push(...readdirSync(join(OUT, 'sound')).map((f) => `sound/${f}`).filter((f) => !files.has(f)));
  if (stale.length || extra.length) {
    console.error(`The art pack is out of date (${[...stale, ...extra].join(', ')}). Run: npm run art`);
    process.exit(1);
  }
  console.log(`The art pack is up to date: ${frames.length} sprites.`);
} else {
  rmSync(join(OUT, 'sprites'), { recursive: true, force: true });
  rmSync(join(OUT, 'sound'), { recursive: true, force: true });
  rmSync(join(OUT, 'screens'), { recursive: true, force: true });
  for (const t of TABLES) rmSync(join(OUT, `${t}.json`), { force: true });
  for (const [path, data] of files) {
    mkdirSync(dirname(join(OUT, path)), { recursive: true });
    writeFileSync(join(OUT, path), data);
  }
  console.log(`Art pack written to ${OUT}: ${frames.length} sprites in ${heights.length} atlas${heights.length === 1 ? '' : 'es'}.`);
  for (const [from, n] of Object.entries(bySource)) console.log(`  ${String(n).padStart(5)}  ${from}`);
  if (tables.length) console.log(`  tables: ${tables.join(', ')}`);
  if (sounds) console.log(`  sounds: ${sounds}`);
  if (screens) console.log(`  screens: ${screens}`);
}
