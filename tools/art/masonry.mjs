// Shared pieces for the building sets: a small canvas to draw on, concrete in four tones, light and shade for
// the faces of a model, and the rubble a ruin is strewn with.

import { image, rgb } from './png.mjs';
import { hash } from './kit.mjs';

/** A grey, a touch cool. */
export const grey = (v) => rgb(Math.max(0, Math.min(255, v)), Math.max(0, Math.min(255, v)), Math.max(0, Math.min(255, v + 3)));

/** Four tones of one material round a middle brightness: lit edge, face, shaded edge, deep shadow. */
export const tones = (v) => ({ hi: grey(v + 34), mid: grey(v), lo: grey(v - 30), deep: grey(v - 62) });

export const CONCRETE = tones(158);
export const PIT = grey(44);
export const WOOD = { hi: rgb(176, 130, 84), mid: rgb(138, 98, 62), lo: rgb(102, 70, 46), deep: rgb(66, 44, 30) };
export const PANE = { hi: rgb(170, 180, 222), mid: rgb(112, 122, 176), lo: rgb(58, 62, 96), deep: rgb(30, 32, 52) };
export const BLOOD = [rgb(214, 24, 28), rgb(150, 14, 20)];

const channels = (c) => [c & 255, (c >>> 8) & 255, (c >>> 16) & 255];

/** A colour made darker (k below 1) or lighter. */
export function shade(c, k) {
  if (!c) return 0;
  const [r, g, b] = channels(c).map((v) => Math.max(0, Math.min(255, Math.round(v * k))));
  return rgb(r, g, b);
}

/** A whole sprite in another light: the same wall on a model's shaded side. */
export function dim(img, k) {
  const out = image(img.w, img.h);
  for (let i = 0; i < img.px.length; i++) out.px[i] = shade(img.px[i], k);
  return out;
}

/** Smooth noise in [0, 1): `cell` pixels between its knots. */
export function cloud(x, y, cell, seed) {
  const gx = Math.floor(x / cell);
  const gy = Math.floor(y / cell);
  const fx = x / cell - gx;
  const fy = y / cell - gy;
  const a = hash(gx, gy, seed);
  const b = hash(gx + 1, gy, seed);
  const c = hash(gx, gy + 1, seed);
  const d = hash(gx + 1, gy + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/**
 * A canvas: a sprite with drawing tools. A colour may be a number or a rule `(x, y) => colour`; a rule that gives
 * 0 leaves the pixel as it was.
 */
export function canvas(w, h, fill = 0) {
  const img = image(w, h);
  const at = (c, x, y) => (typeof c === 'function' ? c(x, y) : c);
  const cv = {
    img,
    w,
    h,
    get: (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : img.px[y * w + x]),
    set(x, y, c) {
      if (x < 0 || y < 0 || x >= w || y >= h) return cv;
      const v = at(c, x, y);
      if (v) img.px[y * w + x] = v;
      return cv;
    },
    clear(x, y) {
      if (x >= 0 && y >= 0 && x < w && y < h) img.px[y * w + x] = 0;
      return cv;
    },
    rect(x0, y0, x1, y1, c) {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) cv.set(x, y, c);
      return cv;
    },
    /** An outline one pixel wide: `a` along the top and left, `b` along the bottom and right. */
    frame(x0, y0, x1, y1, a, b = a) {
      for (let x = x0; x <= x1; x++) cv.set(x, y0, a).set(x, y1, b);
      for (let y = y0; y <= y1; y++) cv.set(x0, y, a).set(x1, y, b);
      cv.set(x1, y0, a);
      return cv;
    },
    /** A block standing out of the surface: lit along the top and left. */
    raised(x0, y0, x1, y1, t) {
      return cv.rect(x0, y0, x1, y1, t.mid).frame(x0, y0, x1, y1, t.hi, t.lo);
    },
    /** A hollow in the surface: shaded along the top and left, the far lip catching the light. */
    sunk(x0, y0, x1, y1, t, floor = t.lo) {
      return cv.rect(x0, y0, x1, y1, floor).frame(x0, y0, x1, y1, t.deep, t.hi);
    },
    line(x0, y0, x1, y1, c, wide = 1) {
      const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
      for (let i = 0; i <= n; i++) {
        const x = Math.round(x0 + ((x1 - x0) * i) / n);
        const y = Math.round(y0 + ((y1 - y0) * i) / n);
        for (let k = 0; k < wide; k++) cv.set(Math.abs(x1 - x0) >= Math.abs(y1 - y0) ? x : x + k, Math.abs(x1 - x0) >= Math.abs(y1 - y0) ? y + k : y, c);
      }
      return cv;
    },
    disc(cx, cy, r, c) {
      for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
        for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
          if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) cv.set(x, y, c);
        }
      }
      return cv;
    },
    /** Every pixel through a rule `(colour, x, y) => colour` (0 clears it). */
    each(rule) {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) img.px[y * w + x] = rule(img.px[y * w + x], x, y) || 0;
      return cv;
    },
    /** Another sprite laid on at (x, y), its clear pixels left out. */
    paste(src, x0 = 0, y0 = 0) {
      for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) cv.set(x0 + x, y0 + y, src.px[y * src.w + x]);
      return cv;
    },
  };
  if (fill) cv.rect(0, 0, w - 1, h - 1, fill);
  return cv;
}

/** Hairline cracks over stone: true where one runs. */
export const cracked = (x, y, seed, much = 0.5) => {
  const a = cloud(x, y, 7, seed);
  const b = cloud(x, y, 5, seed + 1);
  return Math.abs(a - b) < 0.035 * much && hash(x, y, seed + 2) < 0.85;
};

/** Broken masonry seen end on: rough courses of stone at brightness `v`. */
export const broken = (v, seed) => (x, y) => {
  const course = Math.floor((y + cloud(x, 0, 4, seed) * 3) / 3);
  const t = hash(Math.floor((x + course * 3) / 4), course, seed + 1) * 0.6 + hash(x, y, seed + 2) * 0.4;
  return grey(v + (course & 1 ? -14 : 8) + Math.round((t - 0.5) * 50));
};

/** A lump of rubble: an uneven stone, lit from the top left. */
export function lump(cv, cx, cy, r, seed, v = 150) {
  for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++) {
    for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const d = Math.sqrt(dx * dx + dy * dy) + (hash(x >> 1, y >> 1, seed) - 0.5) * r * 0.9;
      if (d > r) continue;
      const t = (-dx - dy) / (r + 1) + (hash(x, y, seed + 1) - 0.5) * 0.7;
      cv.set(x, y, grey(v + (t > 0.45 ? 38 : t > -0.1 ? 8 : t > -0.6 ? -24 : -52)));
    }
  }
  return cv;
}

/** Rubble strewn over a canvas: `count` lumps of radius `min` to `max`, kept `margin` from the edge. */
export function rubble(cv, seed, count, min, max, { margin = 2, v = 150 } = {}) {
  for (let i = 0; i < count; i++) {
    const r = min + hash(i, 3, seed) * (max - min);
    const x = margin + r + hash(i, 1, seed) * (cv.w - 2 * (margin + r));
    const y = margin + r + hash(i, 2, seed) * (cv.h - 2 * (margin + r));
    lump(cv, x, y, r, seed + i * 11, v + Math.round((hash(i, 4, seed) - 0.5) * 40));
  }
  return cv;
}

/** A beam or a bent strip lying on the ground: a line in three tones, its shadow under it. */
export function beam(cv, x0, y0, x1, y1, t, wide = 2) {
  cv.line(x0 + 1, y0 + 1, x1 + 1, y1 + 1, shade(t.deep, 0.7), wide);
  cv.line(x0, y0, x1, y1, t.mid, wide);
  cv.line(x0, y0, x1, y1, t.hi, 1);
  return cv;
}

/** A torn shard of painted sheet: a small ragged triangle. */
export function shard(cv, cx, cy, r, seed, t) {
  for (let y = Math.floor(cy - r); y <= cy + r; y++) {
    for (let x = Math.floor(cx - r); x <= cx + r; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const k = hash(seed, 9) < 0.5 ? dx + dy : dx - dy;
      if (Math.abs(dx) + Math.abs(dy) > r + hash(x, y, seed) * 1.5 || k > r * 0.4) continue;
      cv.set(x, y, dy < -r * 0.3 ? t.hi : k > -r * 0.2 ? t.lo : t.mid);
    }
  }
  return cv;
}
