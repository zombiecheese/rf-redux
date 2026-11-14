// Checks that a generated map is fair by symmetry. Used by mapgen.test.ts and, on the real data, original-maps.test.ts.

import { expect } from 'vitest';
import {
  ShorePainter, decodeTerrain, transformCorners, transformPoint, transformType,
  type BuildingDef, type RfwMap, type ShoreTable, type Transform,
} from '../src/index.js';

/**
 * Checks a generated map is fair: every building has its mirror image, owned by the matching base, and the ground
 * at every tile mirrors too. 4 bases mirror both ways (bases 0-1 and 2-3 left to right, 0-2 and 1-3 top to bottom);
 * 3 bases mirror left to right (base 0 onto itself, 1 onto 2).
 */
export function expectSymmetric(map: RfwMap, defs: readonly BuildingDef[], shore: ShoreTable | null): void {
  const names = new Set(defs.map((d) => d.name));
  const painter = new ShorePainter(shore);
  const terrain = decodeTerrain(map.terrain);
  const w = map.width;
  const h = map.height;
  const mirrors: { t: Transform; base: (b: number) => number }[] = map.bases.length === 4
    ? [{ t: 'flipX', base: (b) => b ^ 1 }, { t: 'flipY', base: (b) => b ^ 2 }]
    : [{ t: 'flipX', base: (b) => (b === 0 ? 0 : 3 - b) }];
  const at = new Map(map.objects.map((o) => [o.y * w + o.x, o]));
  for (const m of mirrors) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const [mx, my] = transformPoint(m.t, x, y, w, h);
        expect(painter.corners[terrain[my * w + mx]! & 127], `${map.name} ground at ${x},${y}`).toEqual(transformCorners(m.t, painter.corners[terrain[y * w + x]! & 127]!));
      }
    }
    for (const o of map.objects) {
      const [mx, my] = transformPoint(m.t, o.x, o.y, w, h);
      const twin = at.get(my * w + mx);
      expect(twin && { type: twin.type, base: twin.base }, `${map.name}: ${o.type} at ${o.x},${o.y}`).toEqual({
        type: transformType(m.t, o.type, names), base: o.base === null ? null : m.base(o.base),
      });
    }
    for (const b of map.bases) {
      const twin = map.bases[m.base(b.id)]!;
      const [sx, sy] = transformPoint(m.t, b.start.x, b.start.y, w, h);
      expect(twin.start).toEqual({ x: sx, y: sy });
      const sites = (list: { x: number; y: number }[]) => list.map((p) => p.y * w + p.x).sort((p, q) => p - q);
      expect(sites(twin.flagSites)).toEqual(sites(b.flagSites.map((p) => {
        const [fx, fy] = transformPoint(m.t, p.x, p.y, w, h);
        return { x: fx, y: fy };
      })));
    }
  }
}
