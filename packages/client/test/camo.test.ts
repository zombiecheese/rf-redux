import { describe, expect, it } from 'vitest';
import { camoTile, camoTones, TILE } from '../src/camo.js';

describe('bar camo', () => {
  it('uses all four tones in a pattern that is the same every time', () => {
    const tile = camoTile();
    expect(tile.length).toBe(TILE * TILE);
    const counts = [0, 0, 0, 0];
    for (const t of tile) counts[t]!++;
    for (const c of counts) expect(c).toBeGreaterThan(TILE * TILE * 0.03);
    expect(camoTile()).toBe(tile);
  });

  it('runs dark to light in each side\'s colour, grey with no side', () => {
    for (const base of [0, 1, 2, 3, null]) {
      const tones = camoTones(base);
      const sums = tones.map(([r, g, b]) => r + g + b);
      expect(sums).toEqual([...sums].sort((a, b) => a - b));
    }
    const [r, g, b] = camoTones(null)[3]!;
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(8);
    expect(camoTones(1)[2]![1]).toBeGreaterThan(camoTones(1)[2]![0]); // Green is green
    expect(camoTones(2)[2]![2]).toBeGreaterThan(camoTones(2)[2]![0]); // Blue is blue
    expect(camoTones(3)[2]![0]).toBeGreaterThan(camoTones(3)[2]![2]); // Red is red
  });
});
