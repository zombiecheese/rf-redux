// Shared pieces for the art sets that are not ground: rule-drawn sprites, the two sides' paint, and steel.

import { image, rgb } from './png.mjs';

/** A fixed pseudo-random number in [0, 1) for a pixel and a seed. */
export function hash(x, y, seed = 0) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 362437)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** A sprite from a rule: `pixel` gives a colour, or 0 to leave the pixel clear. */
export function sprite(w, h, pixel) {
  const img = image(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) img.px[y * w + x] = pixel(x, y) || 0;
  return img;
}

/** One picture laid over another: the first rule that gives a colour wins. */
export const over = (...layers) => (x, y) => {
  for (const layer of layers) {
    const c = layer(x, y);
    if (c) return c;
  }
  return 0;
};

/** A sprite at half size, taking every other pixel. */
export function halved(img) {
  const w = Math.max(1, img.w >> 1);
  const h = Math.max(1, img.h >> 1);
  const out = image(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.px[y * w + x] = img.px[y * 2 * img.w + x * 2];
  return out;
}

/**
 * Paint: four tones from the lit face to the deepest shadow. Brown's keep red over green over blue, which is how
 * the game knows them when it repaints Brown's sprites for the Blue and Red bases; GOLD is for the third set
 * each vehicle part has (half size).
 */
export const PAINT = [
  { hi: rgb(182, 108, 68), mid: rgb(146, 80, 48), lo: rgb(108, 56, 34), deep: rgb(72, 38, 24) },
  { hi: rgb(98, 152, 46), mid: rgb(66, 118, 32), lo: rgb(42, 84, 24), deep: rgb(26, 52, 16) },
];
export const GOLD = { hi: rgb(250, 232, 96), mid: rgb(232, 196, 40), lo: rgb(184, 144, 24), deep: rgb(120, 90, 20) };

export const STEEL = { hi: rgb(186, 188, 194), mid: rgb(132, 134, 140), lo: rgb(84, 86, 92), deep: rgb(46, 47, 52) };
export const SOOT = rgb(30, 30, 34);
export const WHITE = rgb(255, 255, 255);

/**
 * A part in all three sets: `draw(paint)` at cel (Brown), cel + 1 (Green) and, half size in gold, cel + 2.
 */
export function inSets(put, cel, draw) {
  put(cel, draw(PAINT[0]));
  put(cel + 1, draw(PAINT[1]));
  put(cel + 2, halved(draw(GOLD)));
}

/** A disc: `fill(d)` gives the colour at distance d from the centre, inside radius r. */
export const disc = (cx, cy, r, fill) => (x, y) => {
  const d = Math.sqrt((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2);
  return d <= r ? fill(d) : 0;
};

/** A box: `fill(x, y)` inside x0..x1, y0..y1 (inclusive). */
export const box = (x0, y0, x1, y1, fill) => (x, y) => (x >= x0 && x <= x1 && y >= y0 && y <= y1 ? (typeof fill === 'function' ? fill(x, y) : fill) : 0);

/** A ragged blot (scorch marks, wreck shadows): solid in the middle, breaking up toward radius r. */
export const blot = (cx, cy, r, seed, colour) => (x, y) => {
  const d = Math.sqrt((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2) / r;
  const spoke = hash(Math.floor(((Math.abs(x - cx) * 5) / (Math.abs(x - cx) + Math.abs(y - cy) + 1)) + (x < cx ? 6 : 0) + (y < cy ? 12 : 0)), 0, seed);
  return d < 0.45 + spoke * 0.35 || (d < 1 && hash(x, y, seed + 1) < (1 - d) * 0.5) ? colour : 0;
};

/** A sprite flipped left to right. */
export function mirrored(img) {
  const out = image(img.w, img.h);
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) out.px[y * img.w + x] = img.px[y * img.w + img.w - 1 - x];
  return out;
}

export const GLASS = { hi: rgb(206, 240, 244), mid: rgb(120, 190, 206), lo: rgb(40, 60, 96) };
export const SKIN = rgb(222, 168, 132);
