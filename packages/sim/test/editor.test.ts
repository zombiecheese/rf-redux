import { describe, expect, it } from 'vitest';
import {
  DEEP, LAND, ONE, SHALLOW, ShorePainter, buildWorld, buildingDefs, checkMap, createMatch, decodeTerrain, encodeTerrain, newMap,
  paintGround, parseMap, settleCoast, settingLives, terrainCorners, transformBridgeEnd, transformCorners, transformPoint, transformType, validateMap,
  type BuildingRecord, type RfwMap, type ShorePolygon, type ShoreTable,
} from '../src/index.js';

// A made-up building table (the real one is never committed) with the pieces these tests place.
function fakeTable(): BuildingRecord[] {
  const raw = (r2: number) => [0, 0, r2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const t: BuildingRecord[] = Array.from({ length: 91 }, (_, i) => ({ name: `B${i}`, raw: raw(0) }));
  t[0] = { name: 'NOTHING', raw: raw(0) };
  t[7] = { name: 'ROCK_1S', raw: raw(0xff) };
  t[22] = { name: 'FLAG', raw: raw(0x66d) };
  t[31] = { name: 'BNKR_N', raw: raw(0x500) };
  t[32] = { name: 'BNKR_E', raw: raw(0x500) };
  t[33] = { name: 'BNKR_S', raw: raw(0x500) };
  t[34] = { name: 'BNKR_W', raw: raw(0x500) };
  t[43] = { name: 'GATE_H', raw: raw(0x558) };
  t[44] = { name: 'GATE_V', raw: raw(0x558) };
  t[49] = { name: 'TOWER', raw: raw(0x5ff) };
  t[74] = { name: 'BRIGE_H', raw: raw(0x5ff) };
  t[75] = { name: 'BRIGE_V', raw: raw(0x5ff) };
  return t;
}
const DEFS = buildingDefs(fakeTable());
const NAMES = new Set(DEFS.map((d) => d.name));

// Made-up shoreline shapes: 4-7 have land on the north, east, south and west half; 8-11 land on one quarter
// (north-west, north-east, south-east, south-west); 12-15 water on one quarter (south-east, south-west, north-west,
// north-east). 40-43 are deep water with a shallow north, east, south or west half.
const rect = (x0: number, y0: number, x1: number, y1: number, insideIsLand = true): ShorePolygon => {
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const hw = (x1 - x0) / 2;
  const hh = (y1 - y0) / 2;
  return {
    insideIsLand, rotation: 0, offset: [cx * ONE, cy * ONE], bounds: [-hw * ONE, -hh * ONE, hw * ONE, hh * ONE],
    verts: [[-hw * ONE, -hh * ONE], [hw * ONE, -hh * ONE], [hw * ONE, hh * ONE], [-hw * ONE, hh * ONE]], edges: [0, 1, 2, 3],
  };
};
const SHORE: ShoreTable = {
  polygons: {
    4: rect(-16, -16, 16, 0), 5: rect(0, -16, 16, 16), 6: rect(-16, 0, 16, 16), 7: rect(-16, -16, 0, 16),
    8: rect(-16, -16, 0, 0), 9: rect(0, -16, 16, 0), 10: rect(0, 0, 16, 16), 11: rect(-16, 0, 0, 16),
    12: rect(0, 0, 16, 16, false), 13: rect(-16, 0, 0, 16, false), 14: rect(-16, -16, 0, 0, false), 15: rect(0, -16, 16, 0, false),
  },
  boxes: {
    40: [-16 * ONE, -16 * ONE, 16 * ONE, 0], 41: [0, -16 * ONE, 16 * ONE, 16 * ONE],
    42: [-16 * ONE, 0, 16 * ONE, 16 * ONE], 43: [-16 * ONE, -16 * ONE, 0, 16 * ONE],
  },
};
const L = LAND;
const S = SHALLOW;
const D = DEEP;

describe('shore corners', () => {
  it('reads each terrain\'s corners from its shape', () => {
    expect(terrainCorners(SHORE, 3)).toEqual([L, L, L, L]);
    expect(terrainCorners(SHORE, 1)).toEqual([S, S, S, S]);
    expect(terrainCorners(SHORE, 2)).toEqual([D, D, D, D]);
    expect(terrainCorners(SHORE, 4)).toEqual([L, L, S, S]);
    expect(terrainCorners(SHORE, 10)).toEqual([S, S, L, S]);
    expect(terrainCorners(SHORE, 12)).toEqual([L, L, S, L]);
    expect(terrainCorners(SHORE, 41)).toEqual([D, S, S, D]);
  });

  it('picks a piece by its corners, and keeps a tile that already fits', () => {
    const p = new ShorePainter(SHORE);
    expect(p.pick([L, L, S, S], 3)).toBe(4);
    expect(p.pick([S, L, S, S], 3)).toBe(9);
    expect(p.pick([L, L, L, L], 2)).toBe(3);
    expect(p.pick([L, L, L, L], 80)).toBe(80);
    expect(p.pick([S, S, S, S], 3)).toBe(1);
    expect(p.pick([S, S, S, S], 24)).toBe(24);
    expect(p.pick([D, D, D, D], 3)).toBe(2);
  });

  it('turns a corner no piece has into plain ground of the other three', () => {
    // The stand-in boxes, like the original's, only make straight shallow-to-deep edges.
    const p = new ShorePainter(SHORE);
    expect(p.has([S, S, D, S])).toBe(false);
    expect(p.pick([S, S, D, S], 2)).toBe(1);
    expect(p.pick([D, S, D, D], 1)).toBe(2);
    expect(p.pick([D, D, S, D], 24)).toBe(2);
    expect(p.pick([S, S, S, D], 24)).toBe(24);
  });
});

describe('ground painting', () => {
  const grid = (w: number, h: number, fill: number) => ({ width: w, height: h, terrain: new Uint8Array(w * h).fill(fill) });

  it('lays a coast round new land in shallow water', () => {
    const g = grid(6, 6, 1);
    const p = new ShorePainter(SHORE);
    paintGround(g, p, [2 * 6 + 2, 2 * 6 + 3, 3 * 6 + 2, 3 * 6 + 3], L);
    const at = (x: number, y: number) => g.terrain[y * 6 + x];
    // The painted block is land; the tiles round it show the edge of it.
    expect([at(2, 2), at(3, 2), at(2, 3), at(3, 3)]).toEqual([3, 3, 3, 3]);
    expect(at(2, 1)).toBe(6); // land on its south half
    expect(at(4, 2)).toBe(7); // land on its west half
    expect(at(1, 1)).toBe(10); // land on its south-east quarter
    expect(at(0, 0)).toBe(1);
  });

  it('puts shallow water between new land and deep water', () => {
    const g = grid(7, 7, 2);
    const p = new ShorePainter(SHORE);
    paintGround(g, p, [3 * 7 + 3], L, 80);
    const at = (x: number, y: number) => g.terrain[y * 7 + x];
    expect(at(3, 3)).toBe(80);
    expect(at(3, 2)).toBe(6);
    // Beyond the coast: deep water with a shallow south half.
    expect(at(3, 1)).toBe(2);
    expect(p.corners[at(3, 2)!]).toEqual([S, S, L, L]);
  });

  it('cuts water into land', () => {
    const g = grid(5, 5, 3);
    const p = new ShorePainter(SHORE);
    const changed = paintGround(g, p, [2 * 5 + 2], S);
    expect(g.terrain[2 * 5 + 2]).toBe(1);
    expect(g.terrain[1 * 5 + 2]).toBe(4); // land on its north half
    expect(changed.length).toBe(9);
  });
});

describe('settling the coast', () => {
  it('fixes a seam where land was pasted next to water', () => {
    // Land on the left half, shallows on the right, with no coast between them.
    const g = { width: 6, height: 3, terrain: Uint8Array.from({ length: 18 }, (_, i) => (i % 6 < 3 ? 3 : 1)) };
    const p = new ShorePainter(SHORE);
    settleCoast(g, p);
    // Corners on the seam go to land (it wins ties), so the first water column becomes land on its west half.
    expect([...g.terrain.slice(0, 6)]).toEqual([3, 3, 3, 7, 1, 1]);
  });
});

describe('mirroring and turning', () => {
  it('moves points', () => {
    expect(transformPoint('flipX', 0, 1, 4, 3)).toEqual([3, 1]);
    expect(transformPoint('flipY', 0, 1, 4, 3)).toEqual([0, 1]);
    expect(transformPoint('turnRight', 0, 0, 4, 3)).toEqual([2, 0]);
    expect(transformPoint('turnLeft', 0, 0, 4, 3)).toEqual([0, 3]);
  });

  it('turns corners, facings and bridge ends', () => {
    expect(transformCorners('turnRight', [L, S, S, S])).toEqual([S, L, S, S]);
    expect(transformCorners('flipY', [L, L, S, S])).toEqual([S, S, L, L]);
    expect(transformType('turnRight', 'BNKR_N', NAMES)).toBe('BNKR_E');
    expect(transformType('flipX', 'BNKR_E', NAMES)).toBe('BNKR_W');
    expect(transformType('turnLeft', 'GATE_H', NAMES)).toBe('GATE_V');
    expect(transformType('flipX', 'GATE_H', NAMES)).toBe('GATE_H');
    expect(transformType('turnRight', 'TOWER', NAMES)).toBe('TOWER');
    expect(transformType('turnRight', 'ROCK_1S', NAMES)).toBe('ROCK_1S');
    expect(transformBridgeEnd('turnRight', 86)).toBe(85);
    expect(transformBridgeEnd('flipX', 84)).toBe(85);
    expect(transformBridgeEnd('flipX', 3)).toBe(3);
  });
});

/** A 20 x 10 island with a base at each end. */
function island(edit: (terrain: Uint8Array, m: RfwMap) => void = () => {}): RfwMap {
  const m = newMap({ width: 20, height: 10, fill: 3 });
  const t = decodeTerrain(m.terrain);
  m.bases = [
    { id: 0, start: { x: 2, y: 5 }, flagSites: [{ x: 4, y: 2 }] },
    { id: 1, start: { x: 17, y: 5 }, flagSites: [{ x: 15, y: 2 }] },
  ];
  m.players = { min: 1, max: 2 };
  edit(t, m);
  m.terrain = encodeTerrain(t);
  return m;
}

describe('map checks', () => {
  const codes = (m: RfwMap) => checkMap(m, DEFS, SHORE).map((p) => p.code);

  it('asks for a base first', () => {
    expect(codes(newMap())).toEqual(['no-bases']);
  });

  it('passes a fair map', () => {
    expect(checkMap(island(), DEFS, SHORE)).toEqual([]);
  });

  it('finds lifts in the water, under buildings or boxed in', () => {
    expect(codes(island((t) => (t[5 * 20 + 2] = 2)))).toContain('lift-water');
    expect(codes(island((_, m) => m.objects.push({ type: 'TOWER', x: 2, y: 5, base: 0 })))).toContain('lift-blocked');
    const boxed = island((_, m) => {
      // B50 stands for a wall: solid, and it can't be destroyed.
      for (const [x, y] of [[1, 5], [3, 5], [2, 4], [2, 6]]) m.objects.push({ type: 'B50', x: x!, y: y!, base: null });
    });
    expect(codes(boxed)).toContain('lift-boxed');
  });

  it('finds missing and shared flag sites', () => {
    expect(codes(island((_, m) => (m.bases[0]!.flagSites = [])))).toContain('no-flag');
    expect(codes(island((_, m) => (m.bases[1]!.flagSites = [{ x: 4, y: 2 }])))).toContain('flag-shared');
    expect(codes(island((_, m) => (m.bases[1]!.flagSites = [{ x: 2, y: 5 }])))).toContain('flag-on-lift');
  });

  it('finds a bridge with no far end', () => {
    const m = island((t) => (t[3 * 20 + 6] = 84));
    const p = checkMap(m, DEFS, SHORE).find((x) => x.code === 'bridge-open');
    expect(p?.tiles).toEqual([{ x: 6, y: 3 }]);
    expect(codes(island((t) => ((t[3 * 20 + 6] = 84), (t[3 * 20 + 9] = 85))))).not.toContain('bridge-open');
  });

  it('warns when a jeep cannot reach a flag', () => {
    // A channel of deep water down the middle.
    const split = island((t) => {
      for (let y = 0; y < 10; y++) t[y * 20 + 10] = 2;
    });
    const p = checkMap(split, DEFS, SHORE);
    expect(p.map((x) => [x.level, x.code])).toEqual([['warning', 'unreachable'], ['warning', 'unreachable']]);
    // A bridge across it fixes that.
    const bridged = island((t) => {
      for (let y = 0; y < 10; y++) t[y * 20 + 10] = 2;
      t[5 * 20 + 9] = 84;
      t[5 * 20 + 11] = 85;
    });
    expect(codes(bridged)).toEqual([]);
    // Rocks stop jeeps and can't be shot; a wall of them cuts the map in two.
    const rocks = island((_, m) => {
      for (let y = 0; y < 10; y++) m.objects.push({ type: 'ROCK_1S', x: 10, y, base: null });
    });
    expect(codes(rocks)).toEqual(['unreachable', 'unreachable']);
    // A gun tower can be destroyed, so it does not.
    const towers = island((_, m) => {
      for (let y = 0; y < 10; y++) m.objects.push({ type: 'TOWER', x: 10, y, base: null });
    });
    expect(codes(towers)).toEqual([]);
  });

  it('names unknown building types', () => {
    const p = checkMap(island((_, m) => m.objects.push({ type: 'CASTLE', x: 1, y: 1, base: null })), DEFS, SHORE);
    expect(p[0]).toMatchObject({ level: 'error', code: 'unknown-type', tiles: [{ x: 1, y: 1 }] });
  });

  it('refuses a base with no jeeps, since it would be out at the start', () => {
    const none = island((_, m) => {
      m.settings.vehicles.jeep = 0;
      m.bases[1]!.vehicles = { jeep: 2 };
    });
    const p = checkMap(none, DEFS, SHORE).filter((x) => x.code === 'no-jeeps');
    expect(p.map((x) => [x.level, x.base])).toEqual([['error', 0]]);
  });
});

describe('map format v2', () => {
  it('still reads version 1 maps', () => {
    const m = { ...island(), version: 1 };
    delete m.description;
    delete m.notes;
    delete m.visibility;
    delete m.revision;
    expect(() => validateMap(m)).not.toThrow();
    expect(() => buildWorld(m, DEFS)).not.toThrow();
  });

  it('reads a file into a clean map, and refuses bad ones', () => {
    const m = island();
    m.notes = [{ x: 3, y: 3, text: 'Ambush here' }];
    const json = JSON.parse(JSON.stringify({ ...m, extra: 'dropped' }));
    const parsed = parseMap(json);
    expect(parsed).toEqual(m);
    expect('extra' in parsed).toBe(false);
    expect(() => parseMap({ ...json, width: '20' })).toThrow('width is not a whole number');
    expect(() => parseMap({ ...json, visibility: 'friends' })).toThrow('visibility');
    expect(() => parseMap({ ...json, notes: [{ x: 30, y: 3, text: '' }] })).toThrow('note outside');
    expect(() => parseMap({ ...json, terrain: encodeTerrain(new Uint8Array(200).fill(200)) })).toThrow('above 127');
    expect(() => parseMap('nope')).toThrow('not an object');
  });

  it('gives each base its own vehicles where the map says so', () => {
    const m = island((_, map) => {
      map.settings.vehicles.jeep = 4;
      map.bases[1]!.vehicles = { tank: 1, jeep: null };
    });
    expect(settingLives(m, 0)).toEqual({ tank: 3, jeep: 4, asv: 3, heli: 3 });
    expect(settingLives(m, 1)).toEqual({ tank: 1, jeep: 4, asv: 3, heli: 3 });
    const match = createMatch(buildWorld(m, DEFS), m, [{ base: 0, team: 0 }, { base: 1, team: 1 }], 1);
    expect(match.players.map((p) => p.lives.tank)).toEqual([3, 1]);
  });
});
