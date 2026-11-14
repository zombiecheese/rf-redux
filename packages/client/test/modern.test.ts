import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { building, lookOf } from '../src/modern/buildings.js';
import { MODERN_H, MODERN_W, modernLayout } from '../src/modern/layout.js';
import { bodyBox } from '../src/modern/renderer.js';
import * as V from '../src/modern/vehicles.js';

const table = JSON.parse(readFileSync(new URL('../../../assets/art/pack/buildings.json', import.meta.url), 'utf8')) as {
  id: number; name: string; parts?: { model: { verts: [number, number, number][] } | null; offset: [number, number, number] }[];
}[];

describe('modern view', () => {
  it('has a model for every building in the table', () => {
    const missing = table.filter((b) => b.id && lookOf(b.name) === 'none').map((b) => b.name);
    expect(missing).toEqual([]);
    for (const b of table) {
      if (!b.id) continue;
      const kit = building({ id: b.id, name: b.name } as never, b.name, bodyBox((b.parts ?? []) as never), b.id);
      expect(kit, b.name).not.toBeNull();
      const g = kit!.build();
      expect(g.getAttribute('position').count, b.name).toBeGreaterThan(0);
      expect(g.getAttribute('color').count).toBe(g.getAttribute('position').count);
    }
  });

  it('builds every vehicle', () => {
    for (const make of [V.tank, V.jeep, V.asv, V.heli, V.drone]) {
      const k = make();
      expect(k.body.build().getAttribute('position').count).toBeGreaterThan(0);
    }
  });

  it('keeps the bodies on the art pack models’ footprints', () => {
    const fuel = table.find((b) => b.name === 'FUEL_S')!;
    const box = bodyBox((fuel.parts ?? []) as never)!;
    const g = building({ id: fuel.id, name: fuel.name } as never, fuel.name, box, 1)!.build();
    g.computeBoundingBox();
    // Three.js x is east-west: the body stays within its tile and the pumps' apron.
    expect(g.boundingBox!.max.x - g.boundingBox!.min.x).toBeLessThanOrEqual(32);
  });

  it('lays out one view or a split screen at 1280 x 720', () => {
    expect(modernLayout(1)).toEqual([{ x: 0, y: 0, w: MODERN_W, h: MODERN_H }]);
    const [a, b] = modernLayout(2);
    expect(a!.w).toBe(b!.w);
    expect(b!.x + b!.w).toBe(MODERN_W);
    expect(b!.x).toBeGreaterThan(a!.w);
  });
});
