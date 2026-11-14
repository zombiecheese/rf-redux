// The camp: the prison block and its watchtower, the tents, and what is left of them. The shadow masks among
// these numbers are not drawn here.

import { PAINT, STEEL, blot, hash } from '../kit.mjs';
import { BLOOD, CONCRETE, PANE, PIT, WOOD, beam, broken, canvas, cloud, dim, rubble, shard } from '../masonry.mjs';
import { rgb } from '../png.mjs';

const C = CONCRETE;
const SHEET = { hi: rgb(164, 170, 194), mid: rgb(130, 136, 164), lo: rgb(98, 104, 134) };
const CLOTH = { hi: rgb(176, 146, 108), mid: rgb(148, 118, 84), lo: rgb(112, 88, 62), deep: rgb(80, 62, 44) };

/** A roof of ribbed sheet, riveted along each rib. */
function sheetRoof(w, h) {
  const cv = canvas(w, h, SHEET.mid);
  cv.each((c, x, y) => {
    if (x % 5 === 2) return y % 4 === 1 ? SHEET.hi : SHEET.lo;
    if (x % 5 === 3) return SHEET.hi;
    return y === 0 ? SHEET.hi : y === h - 1 ? SHEET.lo : c;
  });
  return cv.img;
}

// ---- prison --------------------------------------------------------------------------------------------------

/** The cell block's long side: a painted upper wall with four barred windows over a concrete foot. */
function blockSide(p) {
  const cv = canvas(32, 16, p.mid);
  cv.rect(0, 0, 31, 0, p.hi).rect(0, 7, 31, 7, p.lo);
  for (const x of [3, 11, 19, 27]) cv.rect(x, 2, x + 2, 4, PIT).rect(x, 5, x + 2, 5, p.deep).set(x + 1, 3, STEEL.lo);
  cv.rect(0, 8, 31, 15, C.mid).rect(0, 8, 31, 8, C.hi).rect(0, 15, 31, 15, C.lo);
  for (const x of [4, 12, 20, 28]) cv.rect(x, 11, x + 1, 12, C.lo).set(x, 11, C.deep);
  return cv.img;
}

/** The block's end: its door in a concrete frame. */
function blockEnd(p) {
  const cv = canvas(16, 16, C.mid);
  cv.rect(0, 0, 15, 4, p.mid).rect(0, 0, 15, 0, p.hi).rect(0, 4, 15, 4, p.lo);
  cv.raised(3, 4, 12, 15, C).rect(5, 6, 10, 15, p.lo).frame(5, 6, 10, 15, p.deep, p.deep).rect(6, 7, 9, 7, p.mid);
  cv.rect(7, 9, 8, 10, PIT).set(9, 12, STEEL.hi);
  cv.rect(0, 15, 2, 15, C.lo).rect(13, 15, 15, 15, C.lo);
  return cv.img;
}

/** The ruin: stretches of footing, a fallen beam, torn panels and a splinter of glass. */
function blockRuin(p) {
  const cv = canvas(32, 32);
  const stone = broken(132, 21);
  cv.rect(4, 4, 19, 6, stone).rect(4, 7, 6, 20, stone).rect(24, 12, 26, 24, stone).rect(12, 25, 26, 27, stone);
  cv.each((c, x, y) => (c && hash(x, y, 23) < 0.12 ? 0 : c));
  rubble(cv, 25, 7, 1.2, 2.6, { margin: 2, v: 128 });
  beam(cv, 9, 24, 23, 9, WOOD, 2);
  shard(cv, 11, 12, 2.6, 27, p);
  shard(cv, 20, 20, 3, 28, p);
  shard(cv, 26, 6, 2, 29, p);
  cv.line(15, 13, 17, 17, PANE.hi).line(16, 13, 18, 17, PANE.mid);
  return cv.img;
}

// ---- watchtower ----------------------------------------------------------------------------------------------

/** A watchtower's side: the painted cabin with its two windows, on braced timber legs. */
function watchtower(p) {
  const cv = canvas(16, 32);
  cv.rect(0, 0, 15, 13, p.mid).rect(0, 0, 15, 0, p.hi).rect(0, 13, 15, 13, p.deep).rect(0, 1, 0, 12, p.hi).rect(15, 1, 15, 12, p.lo);
  for (const x of [3, 10]) cv.rect(x, 4, x + 2, 8, PIT).frame(x - 1, 3, x + 3, 9, p.deep, p.lo).rect(x, 4, x + 2, 8, PIT);
  cv.rect(0, 14, 15, 14, WOOD.lo);
  cv.line(2, 16, 13, 30, WOOD.lo).line(13, 16, 2, 30, WOOD.lo);
  cv.rect(1, 15, 2, 31, WOOD.mid).rect(1, 15, 1, 31, WOOD.hi).rect(13, 15, 14, 31, WOOD.mid).rect(14, 15, 14, 31, WOOD.deep);
  cv.rect(7, 22, 8, 23, STEEL.hi);
  return cv.img;
}

/** A fallen watchtower: its legs and braces in a heap, glass among them. */
function towerWreck() {
  const cv = canvas(32, 32);
  beam(cv, 4, 22, 22, 4, WOOD, 2);
  beam(cv, 8, 6, 25, 20, WOOD, 2);
  beam(cv, 12, 27, 27, 24, WOOD, 1);
  beam(cv, 5, 12, 12, 17, WOOD, 1);
  for (const [x, y, n] of [[6, 16, 0], [24, 8, 1], [20, 26, 2], [14, 11, 3]]) shard(cv, x, y, 2.2, 33 + n, PANE);
  return cv.img;
}

// ---- tents ---------------------------------------------------------------------------------------------------

/** One slope of a tent: cloth sagging between its ropes. */
function tentSlope(p) {
  const cv = canvas(16, 8, p.mid);
  cv.each((c, x, y) => {
    if (y === 0) return p.hi;
    if (y === 7) return p.deep;
    const sag = 2 + Math.floor(((x - 8) * (x - 8)) / 20);
    return y === sag ? p.lo : y === sag + 1 ? p.hi : x === 0 || x === 15 ? p.lo : c;
  });
  return cv.img;
}

/** Inside the tent, seen through its open ends: the ridge pole and a bedroll in the dark. */
function tentInside() {
  const cv = canvas(16, 8);
  cv.rect(0, 0, 15, 0, WOOD.deep);
  for (let y = 3; y <= 7; y++) cv.rect(3 + (y < 5 ? 5 - y : 0), y, 12 - (y < 5 ? 5 - y : 0), y, y === 3 ? WOOD.mid : WOOD.lo);
  cv.rect(2, 7, 6, 7, STEEL.lo);
  return cv.img;
}

/** A flattened tent: torn cloth, and what was in it. */
function tentFlat(t, seed) {
  const cv = canvas(32, 32);
  cv.rect(0, 0, 31, 31, blot(16, 17, 12.5, seed, t.mid));
  cv.each((c, x, y) => {
    if (!c) return 0;
    const fold = cloud(x + y, y - x + 40, 4, seed + 2);
    return fold > 0.76 ? t.hi : fold < 0.4 ? t.lo : c;
  });
  beam(cv, 8, 9, 14, 13, WOOD, 1);
  beam(cv, 20, 8, 24, 11, WOOD, 1);
  for (const [x, y, r] of [[22, 12, 2.2], [9, 20, 1.6], [16, 25, 1.8], [25, 22, 1.2]]) cv.disc(x, y, r, BLOOD[0]).set(Math.floor(x), Math.floor(y), BLOOD[1]);
  for (const [x, y] of [[26, 15], [6, 23], [20, 28], [12, 27]]) cv.set(x, y, BLOOD[0]);
  return cv.img;
}

export function draw(put) {
  PAINT.forEach((p, side) => {
    put(863 + side, blockEnd(p));
    put(865 + side, blockSide(p));
    put(867 + side, dim(blockSide(p), 0.72));
    [871, 873, 875].forEach((cel, i) => put(cel + side, dim(watchtower(p), [1, 0.84, 0.66][i])));
    put(896 + side, tentSlope(p));
    put(898 + side, dim(tentSlope(p), 0.8));
    put(901 + side, tentFlat(p, 31));
    put(1882 + side, blockRuin(p));
  });
  put(869, sheetRoof(32, 16));
  put(877, sheetRoof(16, 16));
  put(895, tentInside());
  put(903, tentFlat(CLOTH, 31));
  put(1938, towerWreck());
}
