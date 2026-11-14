// The foot soldiers: running, standing and throwing in five directions (the other three are mirrored by the game),
// swimming, and what is left of one. Each is a small jointed figure posed by rule, drawn once per side with only
// the uniform's colours changed, which is what lets the game repaint the Brown ones for the Blue and Red bases.

import { image, rgb } from '../png.mjs';

// ---- colours -------------------------------------------------------------------------------------------------

/** Uniform, its shade. */
const SIDES = [
  [rgb(132, 74, 44), rgb(98, 52, 30)],
  [rgb(52, 80, 26), rgb(30, 48, 16)],
];
const HELMET = rgb(104, 106, 112);
const HELMET_SHADE = rgb(72, 74, 80);
const BOOT = rgb(58, 58, 64);
const SKIN = rgb(222, 168, 132);
const FOAM = rgb(126, 208, 214);
const SPRAY = rgb(196, 236, 238);
const BLOOD = rgb(214, 22, 22);
const BLOOD_SHADE = rgb(150, 12, 14);

// ---- drawing -------------------------------------------------------------------------------------------------

function canvas(w, h) {
  const img = image(w, h);
  const set = (x, y, c) => {
    x = Math.round(x);
    y = Math.round(y);
    if (x >= 0 && y >= 0 && x < w && y < h) img.px[y * w + x] = c;
  };
  /** A limb: a line `wide` pixels across, ending in `tip` (a boot or a hand) if one is given. */
  const limb = (x0, y0, x1, y1, c, wide = 2, tip) => {
    const steps = Math.max(Math.abs(Math.round(x1) - Math.round(x0)), Math.abs(Math.round(y1) - Math.round(y0)), 1);
    for (let i = 0; i <= steps; i++) {
      const x = x0 + ((x1 - x0) * i) / steps;
      const y = y0 + ((y1 - y0) * i) / steps;
      for (let k = 0; k < wide; k++) set(x + k, y, tip !== undefined && i === steps ? tip : c);
    }
  };
  const box = (x0, y0, x1, y1, c) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, c);
  };
  return { img, set, limb, box };
}

function hash(x, y, seed) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 362437)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// ---- on land -------------------------------------------------------------------------------------------------

// Frames 0-5 are the run; 6-9 stand and bring the throwing arm up.
const STRIDE = [3, 2, 0, -3, -2, 0];

/** Seen from behind (`toward` false) or from the front: legs lifting in turn, arms pumping at the sides. */
function upright(side, f, toward) {
  const [body, shade] = SIDES[side];
  const { img, set, box } = canvas(16, 16);
  const run = f < 6;
  const lift = run ? Math.sign(STRIDE[f]) : 0;
  // Legs: the lifted one is a pixel shorter.
  const leg = (x, up) => {
    box(x, 10, x + 1, up ? 11 : 12, shade);
    box(x, up ? 12 : 13, x + 1, up ? 12 : 13, BOOT);
  };
  leg(6, lift > 0);
  leg(8, lift < 0);
  box(6, 5, 9, 8, body);
  box(6, 9, 9, 9, shade);
  if (!toward) box(7, 6, 8, 7, shade); // his pack
  // Arms: each swings up as the other side's leg lifts.
  const arm = (x, up) => box(x, up ? 4 : 5, x, up ? 7 : 8, shade);
  arm(5, lift < 0);
  if (run || f === 6) arm(10, lift > 0);
  else if (f === 7) box(10, 5, 12, 5, shade);
  else if (f === 8) [[10, 5], [11, 4], [12, 3]].forEach(([x, y]) => set(x, y, shade));
  else box(10, 1, 10, 5, shade);
  box(7, 2, 8, 2, HELMET);
  box(6, 3, 9, 3, toward ? HELMET : HELMET_SHADE);
  box(7, 4, 8, 4, toward ? SKIN : HELMET_SHADE);
  return img;
}

/**
 * Seen from the side, facing right. `turn` is 0 for square on, -1 for turned a little away from the camera and
 * 1 for turned toward it: turned, he is a pixel broader and his stride shorter.
 */
function sideways(side, f, turn) {
  const [body, shade] = SIDES[side];
  const { img, set, limb, box } = canvas(16, 16);
  const run = f < 6;
  const reach = turn ? 2 / 3 : 1;
  const s = run ? STRIDE[f] * reach : 0;
  const left = turn ? 6 : 7;
  // The far arm and leg first, so the near ones lie over them.
  if (run) {
    limb(8, 5, 8 + s, 8, shade, 1);
    if (STRIDE[f]) {
      limb(8, 10, 8 - s, 13, shade, 2, BOOT);
      limb(8, 10, 8 + s, 13, shade, 2, BOOT);
    } else {
      // Mid stride: one leg under him, the other knee up.
      limb(8, 10, 8, 13, shade, 2, BOOT);
      limb(9, 10, 10, 12, shade, 2, BOOT);
    }
  } else {
    limb(7, 10, 7, 13, shade, 1, BOOT);
    limb(9, 10, 9, 13, shade, 2, BOOT);
  }
  box(left, 5, 9, 8, body);
  box(left, 9, 9, 9, shade);
  if (turn < 0) box(left, 6, left, 7, shade); // the edge of his pack
  // The near arm: swinging against the legs, or coming up to throw.
  if (run) limb(8, 5, 8 - s, 8, shade, 1);
  else if (f === 6) limb(8, 5, 8, 8, shade, 1);
  else if (f === 7) limb(9, 5, 12, 6, shade, 1);
  else if (f === 8) limb(9, 5, 12, 3, shade, 1);
  else limb(8, 5, 6, 1, shade, 1);
  box(7, 2, 9, 3, HELMET);
  box(7, 3, turn < 0 ? 9 : 7, 3, HELMET_SHADE);
  box(8, 4, 9, 4, turn < 0 ? HELMET_SHADE : SKIN);
  if (turn >= 0) set(8, 4, shade);
  return img;
}

// ---- in the water --------------------------------------------------------------------------------------------

/**
 * A swimmer, seen from above and heading right, on a 32 x 16 sprite with him three quarters of the way along and
 * his wake behind. Frames 0-9 are the dive in, 10-17 the stroke, 18-19 treading water, 20-23 the water settling
 * and 24 the man alone.
 */
function swimmer(side, f) {
  const [body, shade] = SIDES[side];
  const { img, set, limb, box } = canvas(32, 16);
  const man = (legs, arms) => {
    if (legs) {
      limb(18, 6 + (f & 1), 21, 7, shade, 1, BOOT);
      limb(21, 8, 18, 9 - (f & 1), shade, 1);
      set(18, 9 - (f & 1), BOOT);
    }
    box(21, 7, 25, 8, body);
    box(21, 8, 23, 8, shade);
    if (arms === 'out') {
      limb(25, 6, 23, 4, shade, 1);
      limb(25, 9, 23, 11, shade, 1);
    } else if (arms !== undefined) {
      // The crawl: one arm reaching ahead as the other pulls back, in four steps each.
      const step = arms & 3;
      const ahead = [[29, 5], [30, 6], [28, 4], [26, 4]][step];
      const behind = [[22, 11], [21, 10], [24, 11], [26, 11]][step];
      const flip = arms & 4 ? (y) => 15 - y : (y) => y;
      limb(25, flip(6), ahead[0], flip(ahead[1]), shade, 1);
      limb(25, flip(9), behind[0], flip(behind[1]), shade, 1);
    }
    box(26, 7, 27, 8, HELMET);
    set(26, 8, HELMET_SHADE);
  };
  /** Broken water: specks of foam in a patch, thinner toward its edge. */
  const foam = (cx, cy, rx, ry, seed, fill = 0.5) => {
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 32; x++) {
        const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
        if (d < 1 && hash(x, y, seed) < fill * (1.3 - d)) set(x, y, hash(x, y, seed + 1) < 0.25 ? SPRAY : FOAM);
      }
    }
  };
  /** A ripple: the outline of an oval. */
  const ring = (cx, cy, rx, ry, seed) => {
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 32; x++) {
        const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
        if (d < 1 && d > 0.5 && hash(x, y, seed) < 0.8) set(x, y, FOAM);
      }
    }
  };
  if (f === 24) {
    man(true, 'out');
  } else if (f < 4) {
    // Going in head first: the water breaks further up him each frame.
    man(true, 'out');
    if (f) foam(27, 7.5, 1 + f, 1 + f, 40 + f, 0.9);
  } else if (f < 7) {
    man(true);
    foam(25, 7.5, f + 1, 2 + (f - 3) * 1.5, 40 + f, 1);
  } else if (f < 10) {
    man(false);
    ring(24, 7.5, 2 + (f - 6) * 2, 6, 50 + f);
    foam(14, 7.5, 6, 4, 60 + f, 0.3);
  } else if (f < 18) {
    foam(11 - ((f - 10) % 4), 7.5, 9, 3.5, 70 + f, 0.34);
    foam(19, 7.5, 3, 4, 80 + f, 0.5);
    man(false, f - 10);
  } else if (f < 20) {
    man(false);
    ring(24, 7.5, f === 18 ? 5 : 6.5, f === 18 ? 5 : 6.5, 90 + f);
  } else {
    man(false);
    ring(24, 7.5, 3 + (f - 20) * 1.2, 4 + (f - 20), 100 + f);
    foam(10, 7.5, 5, 2, 110 + f, 0.2 - (f - 20) * 0.04);
  }
  return img;
}

// ---- what is left --------------------------------------------------------------------------------------------

/** A man down, three ways: flat on his back, sprawled, and worse. */
function splat(side, kind) {
  const [body, shade] = SIDES[side];
  const { img, set, limb, box } = canvas(16, 16);
  const pool = (cx, cy, r, seed) => {
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2) + (hash(x >> 1, y >> 1, seed) - 0.5) * 2.5;
        if (d < r) set(x, y, d < r - 1.4 && hash(x, y, seed + 1) < 0.18 ? BLOOD_SHADE : BLOOD);
      }
    }
  };
  if (kind === 0) {
    pool(8, 8, 4.5, 1);
    pool(12, 12, 2, 2);
    box(5, 7, 9, 8, body);
    limb(9, 7, 12, 6, shade, 1, BOOT);
    limb(9, 8, 12, 10, shade, 1, BOOT);
    limb(6, 6, 4, 4, shade, 1);
    limb(6, 9, 4, 11, shade, 1);
    box(3, 7, 4, 8, HELMET);
    pool(7, 8, 1.6, 3);
  } else if (kind === 1) {
    pool(10, 9, 4, 4);
    pool(4, 12, 2.2, 5);
    limb(3, 3, 12, 12, body, 2);
    limb(12, 3, 9, 7, shade, 1, SKIN);
    limb(6, 9, 2, 13, shade, 1, BOOT);
    limb(11, 12, 14, 14, shade, 1, BOOT);
    limb(7, 6, 5, 2, shade, 1, SKIN);
    box(2, 2, 3, 3, HELMET);
    pool(9, 9, 1.8, 6);
  } else {
    pool(6, 11, 4.2, 7);
    pool(12, 5, 2.4, 8);
    pool(13, 13, 1.6, 9);
    box(4, 4, 7, 6, body);
    box(5, 5, 6, 5, BLOOD);
    limb(8, 8, 11, 9, body, 2);
    limb(2, 8, 4, 12, shade, 1, BOOT);
    limb(10, 2, 13, 3, shade, 1, SKIN);
    limb(12, 10, 14, 8, shade, 1, BOOT);
    box(9, 12, 10, 13, HELMET);
    set(10, 13, HELMET_SHADE);
  }
  return img;
}

// ---- the set -------------------------------------------------------------------------------------------------

export function draw(put) {
  // Five directions from 655, clockwise from walking away: 20 sprites each, ten frames for Brown then ten for Green.
  const views = [
    (side, f) => upright(side, f, false),
    (side, f) => sideways(side, f, -1),
    (side, f) => sideways(side, f, 0),
    (side, f) => sideways(side, f, 1),
    (side, f) => upright(side, f, true),
  ];
  views.forEach((view, dir) => {
    for (let side = 0; side < 2; side++) for (let f = 0; f < 10; f++) put(655 + dir * 20 + side * 10 + f, view(side, f));
  });
  for (let side = 0; side < 2; side++) for (let f = 0; f < 25; f++) put(756 + side * 25 + f, swimmer(side, f));
  for (let kind = 0; kind < 3; kind++) for (let side = 0; side < 2; side++) put(806 + kind * 2 + side, splat(side, kind));
}
