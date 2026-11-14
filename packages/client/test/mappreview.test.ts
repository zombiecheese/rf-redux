import { describe, expect, it } from 'vitest';
import { encodeTerrain, type RfwMap } from '@rfw/sim';
import { landSquare } from '../src/mappreview.js';

const WATER = 2;
const LAND = 3;

/** A map of open water with land on the given tiles. */
function map(width: number, height: number, land: [number, number][], starts: [number, number][] = []): RfwMap {
  const terrain = new Uint8Array(width * height).fill(WATER);
  for (const [x, y] of land) terrain[y * width + x] = LAND;
  return {
    format: 'rfw-map', version: 2, name: 'Test', author: '', source: null, width, height, players: { min: 1, max: Math.max(1, starts.length) },
    terrain: encodeTerrain(terrain), bases: starts.map(([x, y], id) => ({ id, start: { x, y }, flagSites: [] })), objects: [],
    settings: { vehicles: { tank: null, jeep: null, asv: null, heli: null }, randomMines: null, aiPool: null },
  } as RfwMap;
}

describe('map previews', () => {
  it('crops an island in a big sea to the island and a little sea', () => {
    const s = landSquare(map(128, 128, [[60, 60], [70, 66]]));
    expect(s.size).toBe(11 + 8);
    expect(s.x).toBeLessThanOrEqual(60 - 4);
    expect(s.x + s.size).toBeGreaterThanOrEqual(71 + 4);
    expect(s.y).toBeLessThanOrEqual(60);
    expect(s.y + s.size).toBeGreaterThanOrEqual(67);
  });

  it('keeps every base in the picture, even one out at sea', () => {
    const s = landSquare(map(128, 128, [[60, 60]], [[60, 60], [90, 30]]));
    expect(s.x).toBeLessThanOrEqual(60);
    expect(s.x + s.size).toBeGreaterThan(90);
    expect(s.y).toBeLessThanOrEqual(30);
  });

  it('stays inside a map with land at its edge, and shows all of a map that is all land', () => {
    const edge = landSquare(map(128, 128, [[0, 0], [5, 5]]));
    expect(edge).toEqual({ x: 0, y: 0, size: 14 });
    const all: [number, number][] = [];
    for (let y = 0; y < 20; y++) for (let x = 0; x < 30; x++) all.push([x, y]);
    expect(landSquare(map(30, 20, all))).toEqual({ x: 0, y: -5, size: 30 });
  });

  it('shows the whole of an empty map', () => {
    expect(landSquare(map(40, 40, []))).toEqual({ x: 0, y: 0, size: 40 });
  });
});
