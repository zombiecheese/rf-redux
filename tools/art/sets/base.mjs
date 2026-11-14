// The base: the flag building (whole, broken open and razed) and the bunker with its barrel roof. The shadow
// masks among these numbers are not drawn here.

import { PAINT, STEEL, hash } from '../kit.mjs';
import { PANE, PIT, canvas, cloud, cracked, dim, grey, tones } from '../masonry.mjs';

const LIGHT = [1, 0.86, 0.72, 0.6];

// ---- flag building -------------------------------------------------------------------------------------------

/** Pale veined stone. */
const marble = (seed) => (x, y) => (cracked(x, y, seed, 2.2) ? grey(146) : grey(178 + Math.round(cloud(x, y, 6, seed + 4) * 22)));

/** A louvred steel shutter. */
function shutter(cv, x0, y0, x1, y1) {
  cv.rect(x0, y0, x1, y1, (x, y) => ((y - y0) % 3 === 2 ? grey(104) : (y - y0) % 3 === 0 ? grey(166) : grey(140)));
  cv.rect(x0, y0, x0, y1, grey(108)).rect(x1, y0, x1, y1, grey(176)).rect(x0, y1, x1, y1, grey(176));
}

/** A wall of the flag building: stone over a painted foot, a tall shutter, and on the front the door. */
function hall(p, front, seed) {
  const cv = canvas(32, 32, marble(seed));
  shutter(cv, 10, 0, 21, front ? 12 : 25);
  cv.rect(0, 25, 31, 31, p.mid).rect(0, 25, 31, 25, p.hi).rect(0, 31, 31, 31, p.deep);
  if (front) {
    cv.raised(9, 14, 22, 31, tones(152));
    cv.rect(12, 17, 19, 31, p.lo).frame(12, 17, 19, 31, p.deep, p.deep).rect(13, 18, 18, 18, p.mid).rect(13, 19, 13, 30, p.mid);
    cv.rect(17, 24, 18, 25, STEEL.hi).set(18, 25, STEEL.lo);
  }
  return cv;
}

/** The same wall broken open: `gap(x)` is how far down the break reaches. */
function breached(p, front, seed, gap) {
  const cv = hall(p, front, seed);
  cv.each((c, x, y) => {
    const top = Math.round(gap(x) + (cloud(x, 0, 3, seed + 9) - 0.5) * 8);
    if (y < top) return 0;
    if (y === top && y < 25) return grey(212);
    return c;
  });
  return cv.img;
}

// Broken open: the corners stand, the middle is down to the shutter's foot (the front keeps its door posts).
const open = (x) => (x < 10 || x > 21 ? 12 : 22);
const openFront = (x) => ((x >= 9 && x <= 11) || (x >= 20 && x <= 22) ? 9 : x > 11 && x < 20 ? 23 : 13);
// Razed: a stump at each corner.
const razed = (x) => (x < 6 || x > 25 ? 25 : 40);

/** One face of the pointed roof. */
function spire(p) {
  const cv = canvas(16, 16, p.mid);
  cv.rect(0, 0, 15, 1, p.hi).rect(0, 12, 15, 12, p.lo).rect(0, 13, 15, 13, p.hi).rect(0, 15, 15, 15, p.deep);
  return cv.img;
}

// ---- bunker --------------------------------------------------------------------------------------------------

const inArch = (x, y) => y >= 13 && ((x - 15.5) / 16) ** 2 + ((31.5 - y) / 19.5) ** 2 <= 1;

/** A bunker's end under its barrel roof: the door between two slits, or three slits. */
function bunkerEnd(p, door) {
  const cv = canvas(32, 32);
  cv.each((c, x, y) => {
    if (!inArch(x, y)) return 0;
    if (!inArch(x - 1, y - 1) || !inArch(x, y - 1)) return p.hi;
    if (!inArch(x + 1, y)) return p.lo;
    return y === 31 ? p.deep : p.mid;
  });
  const slit = (x) => cv.rect(x, 22, x + 4, 25, PIT).frame(x - 1, 21, x + 5, 26, p.deep, p.hi).rect(x, 22, x + 4, 25, PIT);
  slit(5);
  slit(22);
  if (door) {
    cv.rect(12, 20, 19, 31, p.deep).rect(13, 21, 18, 31, p.lo).rect(13, 21, 13, 31, p.mid).set(17, 26, STEEL.hi);
    cv.rect(15, 16, 16, 17, PANE.hi).rect(14, 18, 17, 18, STEEL.mid).rect(11, 31, 20, 31, grey(170));
  } else {
    slit(13);
    cv.rect(14, 22, 17, 25, PIT);
  }
  return cv.img;
}

/** A strip of the barrel roof, from the crown (0) down to the painted foot (4). */
function roofStrip(p, step) {
  const cv = canvas(32, 8);
  if (step === 4) return cv.rect(0, 0, 31, 7, p.mid).rect(0, 0, 31, 0, p.hi).rect(0, 7, 31, 7, p.deep).img;
  const v = [226, 192, 176, 164][step];
  cv.rect(0, 0, 31, 7, grey(v)).rect(0, 0, 31, 0, grey(v + 14)).rect(0, 7, 31, 7, grey(v - 16));
  if (step < 2) for (let x = 3; x < 32; x += 8) cv.rect(x, 3, x + 1, 4, grey(v - 36));
  if (step === 2) {
    cv.rect(0, 4, 31, 4, PANE.hi).rect(0, 5, 31, 5, PANE.mid).rect(0, 6, 31, 6, PANE.lo);
    for (let x = 5; x < 32; x += 10) cv.rect(x, 3, x + 1, 6, grey(120));
  }
  if (step === 3) {
    for (const x of [4, 14, 24]) cv.rect(x, 0, x + 3, 2, PIT).rect(x, 3, x + 3, 3, grey(v + 20));
    cv.rect(0, 5, 31, 7, p.mid).rect(0, 5, 31, 5, p.hi).rect(0, 7, 31, 7, p.deep);
  }
  return cv.img;
}

export function draw(put) {
  PAINT.forEach((p, side) => {
    put(968 + side, hall(p, false, 131).img);
    put(970 + side, dim(hall(p, false, 133).img, 0.74));
    put(972 + side, hall(p, true, 135).img);
    // The roof's faces: front, left, right, back.
    [974, 976, 978, 980].forEach((cel, i) => put(cel + side, dim(spire(p), LIGHT[i])));
    put(983 + side, breached(p, false, 131, open));
    put(985 + side, dim(breached(p, false, 133, open), 0.74));
    put(987 + side, breached(p, true, 135, openFront));
    put(990 + side, breached(p, false, 131, razed));
    put(992 + side, dim(breached(p, false, 133, razed), 0.74));
    put(994 + side, breached(p, false, 135, razed));
    put(997 + side, bunkerEnd(p, true));
    put(999 + side, bunkerEnd(p, false));
    for (let step = 0; step < 5; step++) put(1001 + step * 2 + side, roofStrip(p, step));
  });
}
