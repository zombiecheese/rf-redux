import { describe, expect, it } from 'vitest';
import { BIG, SMALL, hash, lettering, ramp, roundCorners } from '../src/pixelart.js';

describe('pixel art', () => {
  it('has every glyph the logos spell, each row as wide as the first', () => {
    for (const [font, texts] of [[BIG, ['ZOMBIE', 'CHEESE', 'RETURN', 'FIRE']], [SMALL, ['PRODUCTIONS', 'PRESS ANY KEY OR TAP', 'RF']]] as const) {
      for (const ch of texts.join('')) {
        const rows = font[ch]?.split('/');
        expect(rows, ch).toBeDefined();
        expect(new Set(rows!.map((r) => r.length)).size, ch).toBe(1);
        expect(rows!.length, ch).toBe(Object.values(font)[0]!.split('/').length);
      }
    }
  });

  it('lays out a line of letters at the block size, with gaps', () => {
    const { mask, letters } = lettering('FIRE', BIG, 2);
    expect(mask.h).toBe(18);
    expect(mask.w).toBe((7 + 6 + 7 + 7 + 3) * 2);
    expect(letters.map((l) => l.x0)).toEqual([0, 16, 30, 46]);
    expect(mask.has(0, 0)).toBe(true);
    expect(mask.has(14, 0)).toBe(false);
  });

  it('rounds outer corners and dithers between ramp steps, the same on every run', () => {
    const { mask } = lettering('I', BIG, 4);
    roundCorners(mask);
    expect(mask.has(0, 0)).toBe(false);
    expect(mask.has(1, 1)).toBe(true);
    expect(ramp([1, 2], 0, 0, 0)).toBe(1);
    expect(ramp([1, 2], 1, 0, 0)).toBe(2);
    expect(hash(3, 4, 5)).toBe(hash(3, 4, 5));
  });
});
