// `npm run asset-inventory`: lists every sprite, model, sound and picture the game uses from a pack, with what uses
// each. It reads the art pack (assets/art/pack, or --assets <folder> for another pack laid out the same way), follows
// every model and explosion to the cels they draw, adds the cels the client's code names (tools/code-cels.mjs), and
// writes inventory.md and inventory.json into assets/generated/, which is git-ignored.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CODE_CELS, SCREENS } from './code-cels.mjs';

const args = process.argv.slice(2);
const at = args.indexOf('--assets');
const DIR = resolve(at >= 0 ? args[at + 1] : fileURLToPath(new URL('../assets/art/pack', import.meta.url)));
const OUT = fileURLToPath(new URL('../assets/generated', import.meta.url));
const has = (p) => existsSync(join(DIR, p));
const json = (p) => (has(p) ? JSON.parse(readFileSync(join(DIR, p), 'utf8')) : null);

const frames = json('sprites/frames.json');
if (!frames) {
  console.error(`No pack in ${DIR}. Run \`npm run art\`, or name another pack with --assets <folder>.`);
  process.exit(1);
}
const sizes = new Map(frames.map((f) => [f.cel, f]));
const ADD_VARIANT = 8;

/** cel -> the set of things that use it. */
const uses = new Map();
const use = (cel, what) => {
  if (!Number.isInteger(cel) || cel < 0) return;
  if (!uses.has(cel)) uses.set(cel, new Set());
  uses.get(cel).add(what);
};
let models = 0;
/** A model's faces: each cel, and for faces that add the side, the side's and nobody's cels that exist. */
function model(m, what) {
  if (!m?.faces) return;
  models++;
  for (const f of m.faces) {
    use(f.cel, what);
    const more = f.flags & ADD_VARIANT ? [1, 2] : f.pair ? [f.pair] : [];
    for (const k of more) if (sizes.has(f.cel + k)) use(f.cel + k, what);
  }
}
const pieces = (list, what) => (list ?? []).forEach((p) => {
  use(p.cel, what);
  if (p.add) for (const k of [1, 2]) if (sizes.has(p.cel + k)) use(p.cel + k, what);
});

for (const c of CODE_CELS) for (let k = 0; k < c.count; k++) use(c.first + k, `${c.use} (${c.file})`);

const buildings = json('buildings.json') ?? [];
buildings.forEach((b, id) => {
  const what = `Building ${id} ${b.name}`;
  model(b.model, what);
  (b.parts ?? []).forEach((p) => model(p.model, what));
  (b.stubs ?? []).forEach((s) => model(s, 'Broken bridge stubs'));
  pieces(b.debris, `${what} debris`);
});

const vehicles = json('vehicles.json') ?? {};
for (const [kind, parts] of Object.entries(vehicles)) {
  if (kind === 'shots') {
    for (const [shot, sp] of Object.entries(parts ?? {})) for (const [part, m] of Object.entries(sp ?? {})) model(m, `Shot ${shot} ${part}`);
  } else {
    for (const [part, m] of Object.entries(parts ?? {})) model(m, `Vehicle ${kind} ${part}`);
  }
}

const effects = json('effects.json');
if (effects) {
  for (const [name, d] of Object.entries(effects.defs ?? {})) {
    for (const f of d.faces ?? []) for (let k = 0; k <= Math.max(0, f.last - f.first); k++) use(f.cel + k, `Explosion ${name}`);
  }
  for (const [name, m] of Object.entries(effects.models ?? {})) model(m, `Effect model ${name}`);
  for (const [name, list] of Object.entries(effects.pieces ?? {})) pieces(list, `Debris ${name}`);
  for (const [name, sets] of Object.entries(effects.vehicleDebris?.pieces ?? {})) (sets ?? []).forEach((list) => pieces(list, `Vehicle debris ${name}`));
  if (effects.bridgePlank) use(effects.bridgePlank.cel, 'Bridge planks');
}

// Sounds: the names the client loads (sound.ts).
const soundSrc = readFileSync(fileURLToPath(new URL('../packages/client/src/sound.ts', import.meta.url)), 'utf8');
const names = /const NAMES = \[([^\]]+)\]/s.exec(soundSrc);
const sounds = (names ? [...names[1].matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]) : []).map((name) => {
  const file = `sound/${name}.wav`;
  return { name, file, present: has(file), bytes: has(file) ? statSync(join(DIR, file)).size : 0 };
});
const screens = SCREENS.map((s) => ({ ...s, file: `screens/${s.name}.png`, present: has(`screens/${s.name}.png`) }));

const used = [...uses.keys()].sort((a, b) => a - b);
const missing = used.filter((c) => !sizes.has(c));
const optional = new Set(CODE_CELS.filter((c) => c.optional).flatMap((c) => Array.from({ length: c.count }, (_, k) => c.first + k)));
// The project's own art pack (assets/art/pack, `npm run art`): which of these sprites it already replaces.
const artFrames = fileURLToPath(new URL('../assets/art/pack/sprites/frames.json', import.meta.url));
const art = new Map((existsSync(artFrames) ? JSON.parse(readFileSync(artFrames, 'utf8')) : []).map((f) => [f.cel, f]));
const sprites = used.map((cel) => {
  const f = sizes.get(cel);
  const own = art.get(cel);
  return { cel, w: f?.w ?? null, h: f?.h ?? null, present: Boolean(f), replaced: Boolean(own), ...(own && f && (own.w !== f.w || own.h !== f.h) ? { artSize: [own.w, own.h] } : {}), uses: [...uses.get(cel)] };
});
const replaced = sprites.filter((s) => s.replaced).length;
const pixels = sprites.reduce((n, s) => n + (s.w ?? 0) * (s.h ?? 0), 0);
mkdirSync(OUT, { recursive: true });

writeFileSync(join(OUT, 'inventory.json'), JSON.stringify({ pack: DIR, sprites, sounds, screens, models, unusedSprites: frames.length - sprites.filter((s) => s.present).length }, null, 1));

// Runs of consecutive cels with the same size and uses are shown as one row.
const rows = [];
for (const s of sprites) {
  const key = `${s.w}x${s.h}|${s.present}|${s.replaced}|${s.artSize ?? ''}|${s.uses.join('; ')}`;
  const last = rows[rows.length - 1];
  if (last && last.key === key && last.to + 1 === s.cel) last.to = s.cel;
  else rows.push({ key, from: s.cel, to: s.cel, s });
}
const md = [
  '# Asset inventory',
  '',
  `Pack: \`${DIR}\`.`,
  '',
  `- Sprites the game draws: ${sprites.filter((s) => s.present).length} (${pixels.toLocaleString('en')} pixels) of the ${frames.length} in the pack; the other ${frames.length - sprites.filter((s) => s.present).length} are never drawn.`,
  `- Sprites the game asks for that the pack lacks: ${missing.filter((c) => !optional.has(c)).length}${missing.length ? ` (${missing.filter((c) => !optional.has(c)).join(', ') || 'none'}; optional and absent: ${missing.filter((c) => optional.has(c)).join(', ') || 'none'})` : ''}.`,
  `- Sprites replaced by the project's own art (assets/art, \`npm run art\`): ${replaced} of ${sprites.length}${sprites.some((s) => s.artSize) ? `; ${sprites.filter((s) => s.artSize).length} of them are not the size of the sprite they replace (marked below)` : ''}.`,
  `- Models: ${models} (buildings and their parts, vehicles, shots, effect models).`,
  `- Sounds: ${sounds.filter((s) => s.present).length} of ${sounds.length} present. Pictures: ${screens.filter((s) => s.present).length} of ${screens.length}.`,
  '',
  '## Sprites',
  '',
  '| Cels | Size | In pack | Own art | Used by |',
  '| --- | --- | --- | --- | --- |',
  ...rows.map((r) => `| ${r.from === r.to ? r.from : `${r.from}-${r.to}`} | ${r.s.w ?? '?'} x ${r.s.h ?? '?'} | ${r.s.present ? 'yes' : 'no'} | ${r.s.replaced ? (r.s.artSize ? `yes, ${r.s.artSize[0]} x ${r.s.artSize[1]}` : 'yes') : ''} | ${r.s.uses.slice(0, 6).join('; ')}${r.s.uses.length > 6 ? `; and ${r.s.uses.length - 6} more` : ''} |`),
  '',
  '## Sounds',
  '',
  '| File | In pack | Bytes |',
  '| --- | --- | --- |',
  ...sounds.map((s) => `| ${s.file} | ${s.present ? 'yes' : 'no'} | ${s.bytes} |`),
  '',
  '## Pictures',
  '',
  '| File | Use | In pack |',
  '| --- | --- | --- |',
  ...screens.map((s) => `| ${s.file} | ${s.use} | ${s.present ? 'yes' : 'no'} |`),
  '',
].join('\n');
writeFileSync(join(OUT, 'inventory.md'), md);

console.log(`Sprites drawn: ${sprites.filter((s) => s.present).length} of ${frames.length} in the pack; asked for but absent: ${missing.filter((c) => !optional.has(c)).length} (and ${missing.filter((c) => optional.has(c)).length} optional)`);
console.log(`Models: ${models}. Sounds: ${sounds.filter((s) => s.present).length}/${sounds.length}. Pictures: ${screens.filter((s) => s.present).length}/${screens.length}.`);
console.log(`Replaced by the project's own art: ${replaced} of ${sprites.length}`);
console.log(`Written: ${join(OUT, 'inventory.md')} and inventory.json`);
