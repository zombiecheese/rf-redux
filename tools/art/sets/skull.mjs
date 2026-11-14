// The laughing skull a player sees after losing a vehicle: seven faces, from jaw shut to wide open, in each
// side's helmet (skull.ts spins and sizes them).

import { PAINT, hash } from '../kit.mjs';
import { canvas } from '../masonry.mjs';
import { rgb } from '../png.mjs';

const BONE = { hi: rgb(244, 230, 196), mid: rgb(214, 190, 150), lo: rgb(162, 136, 100), deep: rgb(98, 80, 58) };
const VOID = rgb(18, 18, 24);
const GULLET = rgb(40, 16, 16);

const within = (x, y, cx, cy, rx, ry) => ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1;

/** Bone, lit down the middle of the face and dark at its edges. */
function bone(x, y, edge) {
  const off = Math.abs(x - 31.5) + (hash(x, y, 3) - 0.5) * 2;
  return edge ? BONE.deep : off > 12 ? BONE.lo : off > 7.5 ? BONE.mid : BONE.hi;
}

/** A row of teeth between x0 and x1, rows y0 to y1: bars of bone with gaps, one or two knocked out. */
function teeth(cv, x0, x1, y0, y1, seed) {
  for (let x = x0; x <= x1; x++) {
    const gap = (x - x0) % 3 === 2 || hash((x - x0) / 3 | 0, 0, seed) < 0.14;
    for (let y = y0; y <= y1; y++) cv.set(x, y, gap ? GULLET : y === y1 ? BONE.mid : BONE.hi);
  }
}

/** One face: `open` is how far the jaw has dropped, in pixels. */
function face(p, open) {
  const cv = canvas(64, 64);
  const helmet = (x, y) => (y <= 28 ? within(x, y, 32, 26, 25, 19) : y <= 41 && (within(x, y, 32, 28, 26, 14) || (Math.abs(x - 31.5) > 17 && Math.abs(x - 31.5) < 26.5 - (y - 28) * 0.25)));
  const head = (x, y) => within(x, y, 32, 33, 15.5, 14) || (y >= 40 && y <= 46 && Math.abs(x - 31.5) <= 10.5 - (y - 40) * 0.3);
  const jawTop = 47 + open;
  const jaw = (x, y) => y >= jawTop && y <= jawTop + 8 && Math.abs(x - 31.5) <= 9.5 - Math.max(0, y - jawTop - 3) * 0.9;
  cv.each((c, x, y) => {
    // The face first, then the dark inside of the helmet, then the helmet itself over the brow.
    if (y > 25 && head(x, y)) return bone(x, y, !head(x - 1, y) || !head(x + 1, y) || !head(x, y + 1));
    if (jaw(x, y)) return bone(x, y, !jaw(x - 1, y) || !jaw(x + 1, y) || !jaw(x, y + 1));
    // The hinge of the jaw, from the cheek down to the chin.
    if (y > 40 && y < jawTop + 3 && Math.abs(Math.abs(x - 31.5) - 10.5) < 1.2) return BONE.lo;
    if (y > 46 && y < jawTop && Math.abs(x - 31.5) < 9) return GULLET;
    if (!helmet(x, y)) return 0;
    if (y > 25 && Math.abs(x - 31.5) < 19 - Math.max(0, y - 34) * 0.4) return VOID;
    if (!helmet(x - 1, y) || !helmet(x + 1, y) || !helmet(x, y - 1) || y === 41) return p.deep;
    const light = (32 - x) * 0.5 + (22 - y) * 1.2 + (hash(x, y, 5) - 0.5) * 3;
    return y >= 24 && y <= 25 ? p.deep : light > 9 ? p.hi : light > -3 ? p.mid : p.lo;
  });
  // Eye sockets under a heavy brow, and the nose.
  for (const cx of [25, 39]) {
    cv.each((c, x, y) => (within(x, y, cx, 33.5, 5, 4) ? (within(x, y, cx, 34, 4, 3) ? VOID : BONE.lo) : c));
  }
  for (let y = 38; y <= 42; y++) cv.rect(32 - Math.ceil((y - 37) / 2), y, 31 + Math.ceil((y - 37) / 2), y, y === 42 ? BONE.lo : VOID);
  cv.rect(31, 39, 32, 42, BONE.mid);
  teeth(cv, 23, 40, 44, 46, 11);
  teeth(cv, 24, 39, jawTop, jawTop + 1, 13);
  return cv.img;
}

export function draw(put) {
  PAINT.forEach((p, side) => {
    for (let i = 0; i < 7; i++) put(2126 + side * 7 + i, face(p, Math.round(i * 1.3)));
  });
}
