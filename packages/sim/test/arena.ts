// A made-up arena for tests that need a whole match without the original data: open ground with 2-4 bases in the
// corners, a few rocks, bushes, barracks, gun towers and a fuel depot, built from a stand-in building table with
// the records the sim looks up by name. The server's tests use it too. Also a made-up original 2-player map for the
// map generator (mapgen.ts) to take pieces from.

import { buildWorld, buildingDefs, encodeTerrain, type BuildingRecord, type RfwMap, type Shape, type World } from '../src/index.js';

const PX = 0x10000;
const box = (h: number, flags = [0, 0, 1, 255], high = 16): Shape =>
  ({ type: 2, flags, z: [0, high * PX], offset: [0, 0], bounds: [-h * PX, -h * PX, h * PX, h * PX] });

function table(): BuildingRecord[] {
  const raw = (r2: number, r10 = 0, r1 = 0) => [0, r1, r2, 0, 0, 0, 0, 0, 0, 0, r10, 0, 0];
  const t: BuildingRecord[] = Array.from({ length: 91 }, (_, i) => ({ name: `B${i}`, raw: raw(0) }));
  const set = (i: number, name: string, r2: number, r10 = 0, shapes?: Shape[], r1 = 0) => (t[i] = { name, raw: raw(r2, r10, r1), shapes });
  set(0, 'NOTHING', 0);
  set(1, 'BUSH_1S', 0x1ff, 0x5700);
  set(7, 'ROCK_1S', 0xff, 0, [box(6, [0, 0, 1, 255], 5)]);
  set(14, 'AMMO', 0x268, 0x4100);
  set(22, 'FLAG', 0x66d, 0x3e00);
  set(23, 'BLDG_N', 0x500, 0x3300, [box(10)], 0x310000);
  set(31, 'BNKR_N', 0x500, 0x3300);
  set(39, 'FUEL_N', 0x100, 0x4d00, [box(8), box(20, [2, 1, 1, 2])]);
  set(49, 'TOWER', 0x5ff, 0x3d00);
  set(51, 'STD_DEST', 0x10000);
  set(62, 'DMG_FLAG', 0x66e, 0x3f00);
  set(63, 'DEST_FLAG', 0x6f, 0, [box(6)]);
  set(74, 'BRIGE_H', 0x5ff);
  set(75, 'BRIGE_V', 0x5ff);
  return t;
}

/** The stand-in building table as buildings.json would hold it, and as the sim reads it. */
export const ARENA_RECORDS = table();
export const ARENA_DEFS = buildingDefs(ARENA_RECORDS);

const SIZE = 48;
/** Corners in base order: 0 top left, 1 bottom right, 2 top right, 3 bottom left, so two bases face each other. */
const CORNERS = [[6, 6], [SIZE - 7, SIZE - 7], [SIZE - 7, 6], [6, SIZE - 7]] as const;

/** An arena with the given number of bases (2-4). */
export function arenaMap(bases = 2): RfwMap {
  const terrain = new Uint8Array(SIZE * SIZE);
  const objects: RfwMap['objects'] = [];
  const rocks = [[20, 14], [27, 30], [14, 27], [33, 18], [24, 24]];
  for (const [x, y] of rocks) objects.push({ type: 'ROCK_1S', x: x!, y: y!, base: null });
  for (let i = 0; i < 6; i++) objects.push({ type: 'BUSH_1S', x: 10 + i * 5, y: 22, base: null });
  objects.push({ type: 'FUEL_N', x: 24, y: 10, base: null });
  const list = CORNERS.slice(0, bases).map(([x, y], id) => {
    const dx = x < SIZE / 2 ? 1 : -1;
    const dy = y < SIZE / 2 ? 1 : -1;
    objects.push({ type: 'BLDG_N', x: x + 3 * dx, y, base: id });
    objects.push({ type: 'TOWER', x: x + 2 * dx, y: y + 2 * dy, base: id });
    objects.push({ type: 'BNKR_N', x, y: y + 4 * dy, base: id });
    return { id, start: { x, y }, flagSites: [{ x: x + 5 * dx, y: y + 5 * dy }, { x: x + 1 * dx, y: y + 6 * dy }] };
  });
  return {
    format: 'rfw-map', version: 1, name: `Arena ${bases}`, author: 'test', source: null, width: SIZE, height: SIZE,
    players: { min: 2, max: bases }, terrain: encodeTerrain(terrain), bases: list, objects,
    settings: { vehicles: { tank: null, jeep: null, asv: null, heli: null }, randomMines: null, aiPool: null },
  };
}

export function arenaWorld(map: RfwMap): World {
  return buildWorld(map, ARENA_DEFS, null);
}

/** A made-up original: a 64 x 64 island with, for each base, a flag compound and a block of gun towers. */
export function madeUpOriginal(): RfwMap {
  const size = 64;
  const terrain = new Uint8Array(size * size).fill(2);
  for (let y = 4; y < 60; y++) for (let x = 4; x < 60; x++) terrain[y * size + x] = 0;
  const objects: RfwMap['objects'] = [];
  const bases = [0, 1].map((id) => {
    const ox = id ? 40 : 10;
    for (const [x, y, type] of [[0, 0, 'BLDG_N'], [2, 0, 'BNKR_N'], [0, 2, 'AMMO'], [3, 3, 'BLDG_N']] as const) objects.push({ type, x: ox + x, y: 10 + y, base: id });
    for (const [x, y] of [[0, 0], [2, 0], [4, 0], [2, 2]] as const) objects.push({ type: 'TOWER', x: ox + x, y: 40 + y, base: id });
    for (let k = 0; k < 6; k++) objects.push({ type: 'BUSH_1S', x: ox + k * 2, y: 52, base: null });
    return { id, start: { x: ox + 4, y: 26 }, flagSites: [{ x: ox + 2, y: 12 }] };
  });
  return {
    format: 'rfw-map', version: 1, name: 'Made Up', author: 'test', source: { file: 'TEST.RFM', level: 3 }, width: size, height: size,
    players: { min: 2, max: 2 }, terrain: encodeTerrain(terrain), bases, objects,
    settings: { vehicles: { tank: null, jeep: null, asv: null, heli: null }, randomMines: null, aiPool: null },
  };
}
