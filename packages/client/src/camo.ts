// The camouflage in the bars round the 4:3 picture (display.ts): a pixel camo in the watching player's colour, drawn
// in game pixels so it is as blocky as the picture beside it. The pattern is the remake's own: three layers of
// blobs (dark, light, darkest) over a mid tone, from tileable value noise, the same every time.

import { TEAMS } from './paint.js';

/** The pattern repeats every TILE game pixels each way. */
export const TILE = 128;

/** Which of the four tones each pixel of the tile takes: 0 darkest, 1 dark, 2 mid, 3 light. */
let tile: Uint8Array | null = null;

/** A hash of a lattice point, 0-1. */
function hash(x: number, y: number, seed: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 0x100000000;
}

/** Smoothed value noise with `cell`-pixel cells, wrapping every TILE pixels. */
function noise(x: number, y: number, cell: number, seed: number): number {
  const n = TILE / cell;
  const gx = x / cell;
  const gy = y / cell;
  const ix = Math.floor(gx);
  const iy = Math.floor(gy);
  const ease = (t: number) => t * t * (3 - 2 * t);
  const fx = ease(gx - ix);
  const fy = ease(gy - iy);
  const at = (i: number, j: number) => hash(((i % n) + n) % n, ((j % n) + n) % n, seed);
  const top = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * fx;
  const bottom = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * fx;
  return top + (bottom - top) * fy;
}

/** Two octaves: broad blobs with ragged edges. */
function blobs(x: number, y: number, seed: number): number {
  return (noise(x, y, 16, seed) * 2 + noise(x, y, 8, seed + 7) + noise(x, y, 4, seed + 13) * 0.5) / 3.5;
}

/** The tile of tone indices (TILE x TILE, row by row). */
export function camoTile(): Uint8Array {
  if (tile) return tile;
  tile = new Uint8Array(TILE * TILE);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      let tone = 2;
      if (blobs(x, y, 1) > 0.56) tone = 1;
      if (blobs(x, y, 2) > 0.6) tone = 3;
      if (blobs(x, y, 3) > 0.63) tone = 0;
      tile[y * TILE + x] = tone;
    }
  }
  return tile;
}

/**
 * The four tones (CSS-ready [r, g, b]) for a base: its colour from paint.ts, darkened and toned down so the bars sit
 * back from the picture. Any other base (no player: the menus, the title, a match nobody plays) is a neutral grey.
 */
export function camoTones(base: number | null): [number, number, number][] {
  const team = base === null ? undefined : TEAMS[base];
  const c = team?.colour;
  const [r, g, b] = c === undefined ? [96, 96, 92] : [c & 0xff, (c >> 8) & 0xff, (c >> 16) & 0xff];
  return [0.32, 0.5, 0.68, 0.88].map((k) => {
    // Mixed a little towards grey so four sides' camo reads as camo, not as four flat colours.
    const grey = (r + g + b) / 3;
    const mix = (v: number) => Math.round((v * 0.75 + grey * 0.25) * k * 0.6);
    return [mix(r), mix(g), mix(b)] as [number, number, number];
  });
}
