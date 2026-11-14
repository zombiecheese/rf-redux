// Each base's colours. The original has two sides, Brown (base 1) and Green (base 2), and its art holds a Brown and a
// Green cel for everything a side owns (a face's cel plus the side, the soldiers' frames 10 apart). Bases 3 and 4 have
// no art of their own, so they are palette swaps of the Brown cels: a pixel is the side's paint where the Brown and
// Green cels differ and the Brown one is a brown, and only those pixels change hue (lightness and saturation scaled),
// so lights, glass, tracks, wood and the cel's shading stay as drawn.

import type { Cel } from './assets.js';
import { rgb } from './raster.js';

export interface TeamStyle {
  name: string;
  /** For flags, the radar, names and chat drawn in the game, and the pages' swatches. */
  colour: number;
  css: string;
  /** The swap for bases 3 and 4: hue in degrees, and the factors on the Brown pixel's saturation and lightness. */
  swap?: { hue: number; sat: number; light: number };
}

export const TEAMS: readonly TeamStyle[] = [
  { name: 'Brown', colour: rgb(178, 112, 70), css: '#b27046' },
  { name: 'Green', colour: rgb(112, 168, 34), css: '#70a822' },
  { name: 'Blue', colour: rgb(76, 128, 224), css: '#4c80e0', swap: { hue: 215, sat: 1, light: 1.15 } },
  { name: 'Red', colour: rgb(214, 64, 56), css: '#d64038', swap: { hue: 356, sat: 1.15, light: 1.3 } },
];

/** The side whose art a base draws with: Green's for base 2, Brown's for the others (bases 3 and 4 repaint it). */
export function artSide(base: number): number {
  return base === 1 ? 1 : 0;
}

/** The repaint a base's art takes: 0 none, else its index in TEAMS (2 or 3). */
export function paintOf(base: number): number {
  return TEAMS[base]?.swap ? base : 0;
}

/** Whether a pixel (ABGR) is one of the Brown side's browns: red over green over blue, hue 5-50 degrees, not grey. */
function brownish(c: number): boolean {
  const r = c & 0xff;
  const g = (c >> 8) & 0xff;
  const b = (c >> 16) & 0xff;
  if (!(r > g && g >= b)) return false;
  const [h, s] = hsl(r, g, b);
  return h >= 5 && h <= 50 && s > 0.15;
}

function hsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const [rf, gf, bf] = [r / 255, g / 255, b / 255];
  let h = max === rf ? (gf - bf) / d + (gf < bf ? 6 : 0) : max === gf ? (bf - rf) / d + 2 : (rf - gf) / d + 4;
  h *= 60;
  return [h, s, l];
}

function fromHsl(h: number, s: number, l: number): [number, number, number] {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const k = (t: number) => {
    t = ((t % 1) + 1) % 1;
    const v = t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
    return Math.round(v * 255);
  };
  return [k(h / 360 + 1 / 3), k(h / 360), k(h / 360 - 1 / 3)];
}

/** One Brown pixel in a base's paint. */
export function repaint(c: number, swap: NonNullable<TeamStyle['swap']>): number {
  const [, s, l] = hsl(c & 0xff, (c >> 8) & 0xff, (c >> 16) & 0xff);
  const [r, g, b] = fromHsl(swap.hue, Math.min(1, s * swap.sat), Math.min(1, l * swap.light));
  return ((c & 0xff000000) | (b << 16) | (g << 8) | r) >>> 0;
}

/** A Brown cel repainted where it differs from its Green cel (same size, or it is left as it is). */
export function paintCel(brown: Cel, green: Cel | undefined, paint: number): Cel {
  const swap = TEAMS[paint]?.swap;
  if (!swap || !green || green.w !== brown.w || green.h !== brown.h) return brown;
  const px = brown.px.map((c, i) => (c >>> 24 && c !== green.px[i] && brownish(c) ? repaint(c, swap) : c));
  return { ...brown, px };
}

const painted = new WeakMap<(i: number) => Cel | undefined, Map<number, Cel | undefined>>();

/**
 * Cel `brown` in a base's paint, its Green cel being `brown + pair` (1 for a face's side variant, 10 or 25 for a
 * soldier's frames); without paint, the cel itself. Kept for each cel lookup, as the match draws them every frame.
 */
export function paintedCel(cel: (i: number) => Cel | undefined, brown: number, pair: number, paint: number): Cel | undefined {
  if (!paint) return cel(brown);
  let cache = painted.get(cel);
  if (!cache) painted.set(cel, (cache = new Map()));
  const key = (brown * 64 + pair) * 4 + paint;
  if (cache.has(key)) return cache.get(key);
  const own = cel(brown);
  const out = own && paintCel(own, cel(brown + pair), paint);
  cache.set(key, out);
  return out;
}
