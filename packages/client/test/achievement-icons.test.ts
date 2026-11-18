import { describe, expect, it } from 'vitest';
import { ACHIEVEMENTS } from '@rfw/net';
import { ICON_IDS, iconSvg } from '../src/achievement-icons.js';

describe('achievement icons', () => {
  it('has one for every achievement, and one for those still hidden', () => {
    for (const x of ACHIEVEMENTS) expect(ICON_IDS, x.id).toContain(x.id);
    expect(ICON_IDS).toContain('hidden');
    expect(iconSvg('wins-25')).toMatch(/^<svg .*<text [^>]*>25<\/text><\/svg>$/);
  });
});
