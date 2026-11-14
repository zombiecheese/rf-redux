import { describe, expect, it } from 'vitest';
import type { Cel } from '../src/assets.js';
import { TEAMS, artSide, paintCel, paintOf, paintedCel, repaint } from '../src/paint.js';
import { rgb } from '../src/raster.js';

const cel = (...px: number[]): Cel => ({ w: px.length, h: 1, px: Uint32Array.from(px), mode: 0 });
const channels = (c: number) => {
  const [r, g, b] = [c & 0xff, (c >> 8) & 0xff, (c >> 16) & 0xff];
  return { r, g, b };
};

describe('team paint', () => {
  it('draws bases 1 and 2 with their own art, and bases 3 and 4 as repainted Brown', () => {
    expect([0, 1, 2, 3].map(artSide)).toEqual([0, 1, 0, 0]);
    expect([0, 1, 2, 3].map(paintOf)).toEqual([0, 0, 2, 3]);
    expect(new Set(TEAMS.map((t) => t.colour)).size).toBe(4);
  });

  it('repaints only the browns that differ from the Green cel', () => {
    const brown = rgb(123, 67, 40);
    const wood = rgb(97, 68, 31);
    const light = rgb(187, 0, 0);
    const grey = rgb(82, 82, 82);
    const b = cel(brown, wood, light, grey, 0);
    const g = cel(rgb(59, 93, 18), wood, rgb(211, 0, 0), rgb(98, 98, 98), 0);
    const blue = paintCel(b, g, 2).px;
    const { r, g: gg, b: bb } = channels(blue[0]!);
    expect(bb).toBeGreaterThan(r);
    expect(bb).toBeGreaterThan(gg);
    // Same in both cels, a red light, a grey, and the transparent colour stay as drawn.
    expect(Array.from(blue.slice(1))).toEqual([wood, light, grey, 0]);
    const red = channels(paintCel(b, g, 3).px[0]!);
    expect(red.r).toBeGreaterThan(red.g + 80);
    expect(Math.abs(red.g - red.b)).toBeLessThan(15);
  });

  it('keeps the alpha and leaves cels without paint or a matching Green cel alone', () => {
    expect(repaint(rgb(123, 67, 40), TEAMS[2]!.swap!) >>> 24).toBe(0xff);
    const b = cel(rgb(123, 67, 40));
    expect(paintCel(b, cel(rgb(59, 93, 18)), 0)).toBe(b);
    expect(paintCel(b, cel(1, 2), 2)).toBe(b);
    expect(paintCel(b, undefined, 2)).toBe(b);
  });

  it('looks up the Green cel by the pair offset and keeps what it made', () => {
    const cels = new Map([[10, cel(rgb(123, 67, 40))], [20, cel(rgb(59, 93, 18))]]);
    const look = (i: number) => cels.get(i);
    expect(paintedCel(look, 10, 10, 0)).toBe(cels.get(10));
    const once = paintedCel(look, 10, 10, 2);
    expect(once).not.toBe(cels.get(10));
    expect(paintedCel(look, 10, 10, 2)).toBe(once);
    expect(paintedCel(look, 10, 1, 2)!.px[0]).toBe(rgb(123, 67, 40));
  });
});
