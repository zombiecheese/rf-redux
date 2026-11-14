// The win scene's choice of scene by level follows the original's choice of movie.

import { describe, expect, it } from 'vitest';
import { winTier } from '../src/winscene.js';

describe('the win scene', () => {
  it('picks a scene by level as the original picked its movie', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map(winTier)).toEqual([0, 1, 1, 1, 1, 2, 2, 2, 3]);
    expect([0, -3, 12].map(winTier)).toEqual([0, 0, 3]);
  });
});
