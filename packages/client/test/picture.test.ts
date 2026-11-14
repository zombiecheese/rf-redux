// Picture tests: frames of the game drawn by the real renderer from the committed art pack, compared with pictures
// kept in test/pictures. They catch what the logic tests cannot see: a sprite drawn solid that should be a shadow, a
// console out of its bay, a model wearing the wrong face. After a change that is meant to alter the picture, run
//   UPDATE_PICTURES=1 npx vitest run packages/client/test/picture.test.ts
// look at the new files in packages/client/test/pictures, and commit them with the change.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEEP, ONE, busy, buildWorld, createMatch, groundAt, launchNow, stepMatch, type Match, type RfwMap, type ShoreTable, type VehicleKind } from '@rfw/sim';
import { assemble, SCREENS, type BuildingTable, type Cel, type EffectsData, type GameAssets, type ScreenName, type VehicleModels } from '../src/assets.js';
import { drawBunker } from '../src/bunker.js';
import { Camera, layout } from '../src/camera.js';
import { drawHud } from '../src/hud.js';
import { Frame, SCREEN_H, SCREEN_W } from '../src/raster.js';
import { drawView } from '../src/view.js';

const root = (p: string) => fileURLToPath(new URL(`../../../${p}`, import.meta.url));
const PACK = root('assets/art/pack');
const PICTURES = fileURLToPath(new URL('./pictures', import.meta.url));
// The Docker build runs the tests with only packages/ and the pack copied in: no tools to read PNGs with.
const here = existsSync(root('tools/art/png.mjs')) && existsSync(join(PACK, 'sprites/frames.json'));
const update = process.env.UPDATE_PICTURES === '1';
/** Pixels that may differ before a picture counts as changed (one in 400), for rounding on another machine. */
const SLACK = (SCREEN_W * SCREEN_H) / 400;

interface Img { w: number; h: number; px: Uint32Array }
let png: { encodePng(img: Img): Buffer; decodePng(buf: Buffer): Img };
let assets: GameAssets;

beforeAll(async () => {
  if (!here) return;
  png = (await import(pathToFileURL(root('tools/art/png.mjs')).href)) as typeof png;
  const json = <T>(name: string) => JSON.parse(readFileSync(join(PACK, name), 'utf8')) as T;
  const frames = json<{ cel: number; atlas: number; x: number; y: number; w: number; h: number; packed?: number }[]>('sprites/frames.json');
  const atlases = new Map<number, Img>();
  const cels = new Map<number, Cel>();
  for (const f of frames) {
    if (!atlases.has(f.atlas)) atlases.set(f.atlas, png.decodePng(readFileSync(join(PACK, `sprites/atlas-${f.atlas}.png`))));
    const atlas = atlases.get(f.atlas)!;
    const px = new Uint32Array(f.w * f.h);
    for (let y = 0; y < f.h; y++) px.set(atlas.px.subarray((f.y + y) * atlas.w + f.x, (f.y + y) * atlas.w + f.x + f.w), y * f.w);
    cels.set(f.cel, { w: f.w, h: f.h, px, mode: f.packed ?? 0 });
  }
  const screens = Object.fromEntries(SCREENS.map((name) => {
    const img = png.decodePng(readFileSync(join(PACK, `screens/${name}.png`)));
    return [name, { w: img.w, h: img.h, px: img.px, mode: 0 }];
  })) as Record<ScreenName, Cel>;
  const common = assemble({
    buildings: json<BuildingTable>('buildings.json'), vehicles: json<VehicleModels>('vehicles.json'), shore: json<ShoreTable>('shore.json'),
    effects: json<EffectsData>('effects.json'), screens, cels,
  });
  assets = { ...common, map: json<RfwMap>('maps/rfmap101.json') };
});

function match(bases = 2): Match {
  const map = assets.map;
  return createMatch(buildWorld(map, assets.defs, assets.shore), map, map.bases.slice(0, bases).map((b) => ({ base: b.id, team: b.id })), 3);
}

/** Compares a frame with its kept picture (or keeps it, with UPDATE_PICTURES=1); a changed one is left in the temp folder. */
function check(name: string, frame: Frame): void {
  const file = join(PICTURES, `${name}.png`);
  const img = { w: frame.w, h: frame.h, px: frame.px.map((c) => (c | 0xff000000) >>> 0) };
  if (update || !existsSync(file)) {
    if (!update) throw new Error(`No picture ${name}.png: run with UPDATE_PICTURES=1, look at it, and commit it`);
    mkdirSync(PICTURES, { recursive: true });
    writeFileSync(file, png.encodePng(img));
    return;
  }
  const kept = png.decodePng(readFileSync(file));
  expect([kept.w, kept.h]).toEqual([img.w, img.h]);
  let changed = 0;
  for (let i = 0; i < img.px.length; i++) if (kept.px[i] !== img.px[i]) changed++;
  if (changed > SLACK) {
    const out = join(tmpdir(), `rfw-picture-${name}.png`);
    writeFileSync(out, png.encodePng(img));
    throw new Error(`${name}: ${changed} pixels differ from test/pictures/${name}.png; the frame drawn now is in ${out}`);
  }
}

/** A vehicle launched from base 0 and driven for a while, as one player's whole screen. */
function drive(kind: VehicleKind, ticks: number): Frame {
  const m = match();
  const cam = new Camera(layout(1)[0]!);
  const home = m.world.bases[0]!.start;
  launchNow(m, 0, kind);
  for (let t = 0; t < ticks; t++) {
    stepMatch(m, [{ throttle: 1, turn: t % 90 < 20 ? 1 : 0, fire: t % 40 === 0 }]);
    cam.update(m.players[0]!.vehicle ?? null, home.tx * 32 + 16, home.ty * 32 + 16);
  }
  const frame = new Frame();
  drawView(frame, cam, m, assets, 0);
  drawHud(frame, m, assets, [0], [kind]);
  return frame;
}

describe.skipIf(!here)('the picture', () => {
  it.each(['tank', 'jeep', 'asv', 'heli'] as const)('of a %s out on the map, with its console, is as kept', (kind) => {
    check(kind, drive(kind, kind === 'heli' ? 260 : 120));
  });

  it('of the bunker screen is as kept', () => {
    const m = match();
    const frame = new Frame();
    const view = layout(1)[0]!;
    const p = m.players[0]!;
    drawBunker(frame, view, assets, p.base, p.lives, 'tank', p.elevator, m.tick);
    drawHud(frame, m, assets, [0], ['tank']);
    check('bunker', frame);
  });

  it('of two views side by side is as kept', () => {
    const m = match();
    const cams = layout(2).map((v) => new Camera(v));
    launchNow(m, 0, 'tank');
    launchNow(m, 1, 'asv');
    for (let t = 0; t < 120; t++) {
      stepMatch(m, [{ throttle: 1, turn: 0, fire: false }, { throttle: 1, turn: 0, fire: false }]);
      cams.forEach((cam, i) => {
        const home = m.world.bases[i]!.start;
        cam.update(m.players[i]!.vehicle ?? null, home.tx * 32 + 16, home.ty * 32 + 16);
      });
    }
    const frame = new Frame();
    cams.forEach((cam, i) => drawView(frame, cam, m, assets, i));
    drawHud(frame, m, assets, [0, 1], ['tank', 'asv']);
    check('split', frame);
  });

  it('of a jeep afloat on its blown-up tyres, leaving a wake, is as kept', () => {
    const m = match();
    const cam = new Camera(layout(1)[0]!);
    launchNow(m, 0, 'jeep');
    const jeep = m.players[0]!.vehicle!;
    // The nearest open water to the base with room to go north.
    const home = m.world.bases[0]!.start;
    const deep = (tx: number, ty: number) => groundAt(m.world, (tx << 21) + (1 << 20), (ty << 21) + (1 << 20)) === DEEP;
    let at: [number, number] = [0, 0];
    let near = Infinity;
    for (let ty = 8; ty < 120; ty++) {
      for (let tx = 4; tx < 124; tx++) {
        const d = Math.hypot(tx - home.tx, ty - home.ty);
        if (d >= near) continue;
        let open = true;
        for (let dy = -6; dy <= 1 && open; dy++) for (let dx = -1; dx <= 1 && open; dx++) open = deep(tx + dx, ty + dy);
        if (open) [at, near] = [[tx, ty], d];
      }
    }
    jeep.x = (at[0] << 21) + (1 << 20);
    jeep.y = (at[1] << 21) + (1 << 20);
    jeep.heading = 0;
    stepMatch(m, [{ throttle: 0, turn: 0, fire2: true }]);
    for (let t = 0; t < 64; t++) stepMatch(m, [{ throttle: 0, turn: 0 }]);
    expect(jeep.inflate).toBe(ONE);
    for (let t = 0; t < 45; t++) {
      stepMatch(m, [{ throttle: 1, turn: 0 }]);
      cam.update(jeep, 0, 0);
    }
    expect(jeep.wake).toBeGreaterThanOrEqual(0);
    const frame = new Frame();
    drawView(frame, cam, m, assets, 0);
    check('jeep-afloat', frame);
  });

  it('of the submarine surfaced beside a helicopter off the map is as kept', () => {
    const m = match();
    const cam = new Camera(layout(1)[0]!);
    launchNow(m, 0, 'heli');
    const h = m.players[0]!.vehicle!;
    for (let i = 0; i < 1000 && busy(h); i++) stepMatch(m, []);
    h.x = -40 * ONE;
    h.y = 64 << 21;
    for (let t = 0; t < 400; t++) {
      stepMatch(m, []);
      cam.update(h, 0, 0);
    }
    expect(m.sub?.state).toBe('aim');
    const frame = new Frame();
    drawView(frame, cam, m, assets, 0);
    check('submarine', frame);
  });

  it('draws no shadow or rotor as a solid white shape', () => {
    // The fault that slipped through once: masks drawn with no draw mode. Pure white is in none of the art's ground.
    for (const kind of ['tank', 'jeep', 'asv', 'heli'] as const) {
      const frame = drive(kind, kind === 'heli' ? 260 : 120);
      let white = 0;
      for (let y = 0; y < 150; y++) for (let x = 0; x < SCREEN_W; x++) if ((frame.px[y * SCREEN_W + x]! & 0xffffff) === 0xffffff) white++;
      expect([kind, white < 40]).toEqual([kind, true]);
    }
  });
});
