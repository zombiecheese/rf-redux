import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  BUILDING, DEEP, GRID, LAND, MAP_PLANS, SHALLOW, ShorePainter, analyseMaps, buildWorld, builtInMaps, checkMap, buildingDefs, createMatch,
  decodePng, matchTileTransforms, dock, groundAt, launch, stepMatch, type BuildingRecord, type Corners, type RfwMap, type ShoreTable,
} from '../src/index.js';
import { expectSymmetric } from './symmetry.js';

// Checks against the art pack's tables and its two-player maps (see docs/assets.md).
const DIR = fileURLToPath(new URL('../../../assets/art/pack', import.meta.url));
const present = existsSync(join(DIR, 'maps')) && existsSync(join(DIR, 'buildings.json'));
// maps/index.json is the Level Selector's list, not a map.
const mapFiles = () => readdirSync(join(DIR, 'maps')).filter((f) => f.endsWith('.json') && f !== 'index.json');
const table = () => buildingDefs(JSON.parse(readFileSync(join(DIR, 'buildings.json'), 'utf8')) as BuildingRecord[]);

describe.skipIf(!present)('original data', () => {
  it('reads the building hit points listed in the mechanics spec', () => {
    const defs = table();
    const hp = (name: string) => defs.find((d) => d.name === name)!.hp;
    expect([hp('ROCK_1S'), hp('BUSH_1S'), hp('TENT_V'), hp('AMMO'), hp('HOSP_S'), hp('BNKR_N'), hp('FLAG')]).toEqual([0, 1, 1, 2, 3, 5, 6]);
    expect(defs[BUILDING.FLAG]!.becomes).toBe(BUILDING.DMG_FLAG);
    expect(defs[BUILDING.DMG_FLAG]!.becomes).toBe(BUILDING.DEST_FLAG);
    expect(defs[BUILDING.BRIDGE_H]!.name).toBe('BRIGE_H');
  });

  it('loads every converted map as a 2-player match', () => {
    const defs = table();
    const files = mapFiles();
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const map = JSON.parse(readFileSync(join(DIR, 'maps', f), 'utf8')) as RfwMap;
      const world = buildWorld(map, defs);
      expect(world.bases.length, f).toBe(2);
      expect(map.players, f).toEqual({ min: 2, max: 2 });
      const m = createMatch(world, map, [{ base: 0, team: 0 }, { base: 1, team: 1 }], 1);
      expect(m.flags.every((fl) => world.building[fl.site] === BUILDING.FLAG), f).toBe(true);
    }
  });

  it('collides with the real shapes: every vehicle can turn on its base\'s lift, and depots have pads', () => {
    const defs = table();
    expect(defs[BUILDING.FUEL_N]!.shapes.some((s) => s.flags[0]! & 2 && s.flags[1] === 1)).toBe(true);
    expect(defs[BUILDING.AMMO]!.shapes.some((s) => s.flags[0]! & 2 && s.flags[1] === 2)).toBe(true);
    for (const f of mapFiles()) {
      const map = JSON.parse(readFileSync(join(DIR, 'maps', f), 'utf8')) as RfwMap;
      const m = createMatch(buildWorld(map, defs), map, [{ base: 0, team: 0 }, { base: 1, team: 1 }], 1);
      for (const kind of ['tank', 'jeep', 'asv'] as const) {
        for (const p of [0, 1]) {
          if (!launch(m, p, kind)) continue;
          const v = m.players[p]!.vehicle!;
          stepMatch(m, p === 0 ? [{ throttle: 0, turn: 1 }] : [undefined, { throttle: 0, turn: 1 }]);
          expect(v.heading, `${f} ${kind} ${p}`).not.toBe(0);
          dock(m, p);
        }
      }
    }
  });

  it.skipIf(!existsSync(join(DIR, 'shore.json')))('turns shore shapes so their land side meets the land next door', () => {
    // A check on the rotation sense and the point-in-polygon port: just inside each edge of a shoreline tile, the
    // ground should match the neighbouring tile across that edge. A few odd tile placements in the maps disagree.
    const defs = table();
    const shore = JSON.parse(readFileSync(join(DIR, 'shore.json'), 'utf8')) as ShoreTable;
    let agree = 0;
    let total = 0;
    for (const f of mapFiles()) {
      const w = buildWorld(JSON.parse(readFileSync(join(DIR, 'maps', f), 'utf8')) as RfwMap, defs, shore);
      for (let i = 0; i < GRID * GRID; i++) {
        const t = w.terrain[i]! & 127;
        if (t < 4 || t > 23) continue;
        const tx = i % GRID;
        const ty = (i - tx) / GRID;
        for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
          const n = w.terrain[(ty + dy) * GRID + tx + dx]! & 127;
          const land = n === 0 || n === 3 || n > 51;
          if (!land && !(n === 1 || n === 2 || (n >= 24 && n <= 51))) continue;
          total++;
          if ((groundAt(w, (tx * 32 + 16 + dx * 14) << 16, (ty * 32 + 16 + dy * 14) << 16) === LAND) === land) agree++;
        }
      }
    }
    expect(agree / total).toBeGreaterThan(0.98);
  });

  it.skipIf(!existsSync(join(DIR, 'shore.json')))('has a shoreline piece for every corner pattern the editor needs', () => {
    // The editor picks coast pieces by the ground at their corners (mapedit.ts). Every straight edge between two
    // kinds of ground must have a piece (land with shallow water from 4-23, shallow with deep water from 40-51).
    // A lone corner of one ground needs a piece one way round at least; the other way round the painter uses plain
    // ground and lets the edge pieces next to it turn the corner, as the original maps do.
    const shore = JSON.parse(readFileSync(join(DIR, 'shore.json'), 'utf8')) as ShoreTable;
    const painter = new ShorePainter(shore);
    const missing: string[] = [];
    for (const [a, b] of [[LAND, SHALLOW], [SHALLOW, DEEP]] as const) {
      const of = (bits: number) => [0, 1, 2, 3].map((k) => (bits >> k) & 1 ? a : b) as Corners;
      for (const bits of [3, 6, 12, 9]) if (!painter.has(of(bits))) missing.push(of(bits).join(''));
      for (const bits of [1, 2, 4, 8]) if (!painter.has(of(bits)) && !painter.has(of(15 - bits))) missing.push(of(bits).join(''));
      for (let bits = 1; bits < 15; bits++) {
        if (bits === 5 || bits === 10) continue;
        const c = of(bits);
        const t = painter.pick(c, 0);
        const most = c.find((g) => c.filter((x) => x === g).length === 3);
        expect(painter.corners[t], c.join('')).toEqual(painter.has(c) || most === undefined ? c : [most, most, most, most]);
      }
    }
    expect(missing).toEqual([]);
  });

  it('finds no errors in the converted maps', () => {
    const defs = table();
    const shore = existsSync(join(DIR, 'shore.json')) ? (JSON.parse(readFileSync(join(DIR, 'shore.json'), 'utf8')) as ShoreTable) : null;
    for (const f of mapFiles()) {
      const map = JSON.parse(readFileSync(join(DIR, 'maps', f), 'utf8')) as RfwMap;
      expect(checkMap(map, defs, shore).filter((p) => p.level === 'error'), f).toEqual([]);
    }
  });
});

describe.skipIf(!present)('3- and 4-base maps made from the original data', () => {
  const shore = () => JSON.parse(readFileSync(join(DIR, 'shore.json'), 'utf8')) as ShoreTable;
  const read = (p: string) => (existsSync(join(DIR, p)) ? new Uint8Array(readFileSync(join(DIR, p))) : null);
  const made = () => builtInMaps(read, (d) => new Uint8Array(inflateSync(d)), table());

  it('makes every plan: playable, every flag in reach, fair, and a match starts on each with every base', () => {
    const defs = table();
    const maps = made();
    expect(maps.map((m) => m.id)).toEqual(MAP_PLANS.map((p) => p.id));
    for (const { id, map } of maps) {
      expect(checkMap(map, defs, shore()).filter((p) => p.level === 'error' || p.code === 'unreachable'), id).toEqual([]);
      expectSymmetric(map, defs, shore());
      const world = buildWorld(map, defs, shore());
      const m = createMatch(world, map, map.bases.map((b) => ({ base: b.id, team: b.id })), 1);
      expect(m.flags.every((fl) => world.building[fl.site] === BUILDING.FLAG), id).toBe(true);
    }
  }, 60000);

  it('mirrors road tiles into road tiles', () => {
    const shoreTable = shore();
    const frames = JSON.parse(readFileSync(join(DIR, 'sprites', 'frames.json'), 'utf8')) as { cel: number; atlas: number; x: number; y: number; w: number; h: number }[];
    const atlas = decodePng(read('sprites/atlas-0.png')!, (d) => new Uint8Array(inflateSync(d)));
    const cel = (t: number) => {
      const f = frames.find((x) => x.cel === t && x.atlas === 0);
      if (!f) return null;
      const px = new Uint32Array(f.w * f.h);
      for (let y = 0; y < f.h; y++) px.set(atlas.px.subarray((f.y + y) * atlas.w + f.x, (f.y + y) * atlas.w + f.x + f.w), y * f.w);
      return { w: f.w, h: f.h, px };
    };
    const turned = matchTileTransforms(cel, new ShorePainter(shoreTable));
    const a = analyseMaps([], { shore: shoreTable });
    expect(a.lift).toEqual([90, 91]);
    // An east-west road turned a quarter is a north-south one.
    const ew = analyseMaps(mapFiles().map((f) => ({ id: f, map: JSON.parse(readFileSync(join(DIR, 'maps', f), 'utf8')) as RfwMap })), { shore: shoreTable }).road;
    expect(turned.turnRight[ew.ew]).toBe(ew.ns);
    expect(turned.flipX[ew.ew]).toBe(ew.ew);
  });
});
