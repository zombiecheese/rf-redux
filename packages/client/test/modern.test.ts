import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { building, lookOf } from '../src/modern/buildings.js';
import { MODERN_H, MODERN_W, modernLayout } from '../src/modern/layout.js';
import { bodyBox, gateSlide, hatchSlide, liftHeight } from '../src/modern/renderer.js';
import { DOORS_OPEN, GATE_OPEN, GATE_SPEED, LIFT_DEPTH, LIFT_SPEED } from '@rfw/sim';
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

describe('lift and gate animation', () => {
  it('eases the lift over the sim\'s own travel, starting and ending where the sim does', () => {
    expect(liftHeight(-LIFT_DEPTH, 'rise', 0)).toBe(-32);
    expect(liftHeight(0, 'rise', 0)).toBe(0);
    expect(liftHeight(0, 'up', 0.5)).toBe(0);
    // Between ticks it moves on, never past the top or the bottom.
    expect(liftHeight(-LIFT_DEPTH / 2, 'rise', 0.5)).toBeGreaterThan(liftHeight(-LIFT_DEPTH / 2, 'rise', 0));
    expect(liftHeight(-LIFT_SPEED / 2, 'rise', 1)).toBe(0);
    expect(liftHeight(-LIFT_DEPTH + LIFT_SPEED / 2, 'sink', 1)).toBe(-32);
    // Slow away from rest, quick through the middle.
    const first = liftHeight(-LIFT_DEPTH + LIFT_SPEED, 'rise', 0) + 32;
    const middle = liftHeight(LIFT_SPEED / 2 - LIFT_DEPTH / 2, 'rise', 0) - liftHeight(-LIFT_SPEED / 2 - LIFT_DEPTH / 2, 'rise', 0);
    expect(first).toBeLessThan(0.01);
    expect(middle).toBeGreaterThan(0.3);
  });

  it('slides the hatch doors fully under the ground once the sim has them open', () => {
    expect(hatchSlide(0, 'rise', 0)).toBe(0);
    expect(hatchSlide(Math.ceil(DOORS_OPEN / LIFT_SPEED), 'rise', 0)).toBe(16);
    expect(hatchSlide(70, 'sink', 0)).toBe(16);
    expect(hatchSlide(0, 'sink', 0.5)).toBe(0);
  });

  it('slides the gate leaves as far as the sim\'s halves, eased', () => {
    expect(gateSlide(0, GATE_OPEN, 0)).toBe(0);
    expect(gateSlide(GATE_OPEN, GATE_OPEN, 0.7)).toBe(15);
    expect(gateSlide(GATE_OPEN / 2, GATE_OPEN, 0)).toBeCloseTo(7.5, 5);
    expect(gateSlide(GATE_OPEN - GATE_SPEED / 2, GATE_OPEN, 1)).toBe(15);
    expect(gateSlide(GATE_SPEED / 2, 0, 1)).toBe(0);
  });
});
