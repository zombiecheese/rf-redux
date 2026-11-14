import { deflateSync, inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { MAP_PLANS, analyseMaps, checkMap, decodePng, generateMaps, type GenData, type Transform } from '../src/index.js';
import { ARENA_DEFS, madeUpOriginal } from './arena.js';
import { expectSymmetric } from './symmetry.js';

const identity = (): Record<Transform, Uint8Array> => {
  const t = Uint8Array.from({ length: 128 }, (_, i) => i);
  return { flipX: t, flipY: t, turnHalf: t, turnLeft: t, turnRight: t };
};

describe('generated 3- and 4-base maps', () => {
  const data: GenData = { defs: ARENA_DEFS, shore: null, turned: identity() };
  const analysis = analyseMaps([{ id: 'test', map: madeUpOriginal() }], data);

  it('reads blocks, pads and scenery from the originals', () => {
    expect(analysis.maps).toBe(1);
    const flags = analysis.blocks.filter((b) => b.flags.length);
    const towers = analysis.blocks.filter((b) => !b.flags.length && b.defences);
    expect(flags).toHaveLength(2);
    expect(towers).toHaveLength(2);
    expect(towers[0]).toMatchObject({ w: 5, h: 3, defences: 4, source: 'test', sourceName: 'Made Up', level: 3 });
    // The flag site is not a building, and the block keeps its place.
    expect(flags[0]!.flags).toEqual([{ x: 2, y: 2 }]);
    expect(analysis.scenery).toEqual([{ type: 'BUSH_1S', count: 12 }]);
    expect(analysis.land).toBe(0);
  });

  it('makes every plan, each passing the checks with every flag in reach, and fair', () => {
    const maps = generateMaps(analysis, data);
    expect(maps.map((m) => m.id)).toEqual(MAP_PLANS.map((p) => p.id));
    for (const { map } of maps) {
      expect(checkMap(map, ARENA_DEFS).filter((p) => p.level === 'error' || p.code === 'unreachable'), map.name).toEqual([]);
      expect(map.players.max).toBe(map.bases.length);
      expect(map.width).toBeLessThanOrEqual(128);
      expect(map.height).toBeLessThanOrEqual(128);
      expectSymmetric(map, ARENA_DEFS, null);
    }
    expect(maps.filter((m) => m.map.bases.length === 3)).toHaveLength(8);
    expect(maps.filter((m) => m.map.bases.length === 4)).toHaveLength(8);
  }, 60_000);

  it('makes the same maps every time', () => {
    expect(JSON.stringify(generateMaps(analysis, data))).toBe(JSON.stringify(generateMaps(analysis, data)));
  }, 60_000);

  it('makes nothing without originals', () => {
    expect(generateMaps(analyseMaps([], data), data)).toEqual([]);
  });
});

describe('decodePng', () => {
  /** A PNG file from its header fields and raw (filtered) rows. */
  function png(w: number, h: number, type: number, rows: number[], extra: [string, number[]][] = []): Uint8Array {
    const chunk = (tag: string, body: Uint8Array) => {
      const out = Buffer.alloc(12 + body.length);
      out.writeUInt32BE(body.length, 0);
      out.write(tag, 4, 'latin1');
      Buffer.from(body).copy(out, 8);
      return out; // The decoder does not check CRCs.
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0);
    ihdr.writeUInt32BE(h, 4);
    ihdr[8] = 8;
    ihdr[9] = type;
    return Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
      ...extra.map(([tag, body]) => chunk(tag, Uint8Array.from(body))),
      chunk('IDAT', deflateSync(Uint8Array.from(rows))), chunk('IEND', new Uint8Array()),
    ]);
  }
  const inflate = (d: Uint8Array) => new Uint8Array(inflateSync(d));

  it('reads palette images, with transparency', () => {
    const file = png(2, 2, 3, [0, 0, 1, 1, 1, 0], [['PLTE', [0, 0, 0, 10, 20, 30]], ['tRNS', [0]]]);
    // Row 2 uses the Sub filter: 1, then 0 + 1.
    expect([...decodePng(file, inflate).px]).toEqual([0, 0xff1e140a, 0xff1e140a, 0xff1e140a]);
  });

  it('undoes the Up, Average and Paeth filters on RGBA rows', () => {
    const rows = [0, 10, 20, 30, 255, 2, 1, 2, 3, 0, 3, 3, 0, 0, 128, 4, 5, 5, 5, 0];
    const img = decodePng(png(1, 4, 6, rows), inflate);
    expect([...img.px].map((p) => [p & 255, (p >> 8) & 255, (p >> 16) & 255, p >>> 24])).toEqual([
      [10, 20, 30, 255], [11, 22, 33, 255], [8, 11, 16, 255], [13, 16, 21, 255],
    ]);
  });
});
