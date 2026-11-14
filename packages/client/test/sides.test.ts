import { describe, expect, it } from 'vitest';
import { ONE, type Lives, type Player } from '@rfw/sim';
import type { Cel, GameAssets } from '../src/assets.js';
import type { ViewRect } from '../src/camera.js';
import { drawBunker } from '../src/bunker.js';
import { drawSkull } from '../src/skull.js';
import { drawText } from '../src/font.js';
import { Frame, rgb } from '../src/raster.js';

const BROWN = rgb(123, 67, 40);
const GREEN = rgb(59, 93, 18);
const solid = (colour: number, size = 64): Cel => ({ w: size, h: size, px: new Uint32Array(size * size).fill(colour), mode: 0 });

/** Assets holding only the cels asked for: Brown's at `brown` and Green's `pair` on. */
function assets(brown: number, pair: number, size: number): GameAssets {
  const cels = new Map([[brown, solid(BROWN, size)], [brown + pair, solid(GREEN, size)]]);
  return { cel: (i: number) => cels.get(i) } as unknown as GameAssets;
}

/** The colour family of the pixels drawn: which of red, green and blue leads, counted over the frame. */
function leads(frame: Frame): 'brown' | 'green' | 'blue' | 'red' | 'none' {
  const n = { brown: 0, green: 0, blue: 0, red: 0 };
  for (const c of frame.px) {
    if (!(c >>> 24) || (c & 0xffffff) === 0) continue;
    const [r, g, b] = [c & 0xff, (c >> 8) & 0xff, (c >> 16) & 0xff];
    if (c === BROWN) n.brown++;
    else if (c === GREEN) n.green++;
    else if (b > r && b > g) n.blue++;
    else if (r > g + 60 && Math.abs(g - b) < 30) n.red++;
  }
  const [name, count] = Object.entries(n).sort((a, b) => b[1] - a[1])[0]!;
  return count ? (name as 'brown') : 'none';
}

describe('the sides\' colours off the map', () => {
  const view: ViewRect = { x: 0, y: 0, w: 320, h: 240, dx: 0, dy: 0, boxW: 320, boxH: 240 };
  const look = { map: null, scale: ONE, angle: 0, face: 1, lives: null, light: ONE };
  const player = (base: number) => ({ base, death: null }) as unknown as Player;

  it('puts the rival\'s helmet on the skull, repainted for bases 3 and 4', () => {
    const helmet = (base: number, rival?: number) => {
      const frame = new Frame();
      drawSkull(frame, view, assets(2125 + 1, 7, 64), player(base), look, {} as Lives, rival);
      return leads(frame);
    };
    // Two bases, as the original: each is laughed at by the other.
    expect([helmet(0), helmet(1)]).toEqual(['green', 'brown']);
    expect([helmet(0, 2), helmet(0, 3), helmet(2, 0), helmet(3, 1)]).toEqual(['blue', 'red', 'brown', 'green']);
  });

  it('parks each base\'s own colour in the bunker', () => {
    const lives: Lives = { tank: 1, jeep: 0, asv: 0, heli: 0 };
    const parked = (base: number) => {
      const frame = new Frame();
      // 2094 is the tank's side view (PARKED in bunker.ts); nothing else is in these assets.
      drawBunker(frame, view, assets(2094, 1, 16), base, lives, 'tank', null, 0);
      const sky = frame.px[0]!;
      for (let i = 0; i < frame.px.length; i++) if (frame.px[i] === sky) frame.px[i] = 0;
      return leads(frame);
    };
    expect([0, 1, 2, 3].map(parked)).toEqual(['brown', 'green', 'blue', 'red']);
  });

  it('draws text into a frame of any size', () => {
    const frame = new Frame(40, 10);
    drawText(frame, 'AB', 0, 0, 0xffffffff, 1, 40);
    expect(frame.px.some((c) => c === 0xffffffff)).toBe(true);
    expect(frame.px.length).toBe(400);
  });
});
