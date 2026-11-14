// Shots and explosions: the shells, missiles and tracers in flight, and every run of frames the game plays for
// a blast, a fire, smoke, dust or a splash. Each run is drawn by rule from a few numbers (how big its flash,
// fireball and smoke are, where the smoke drifts), one frame at a time, so a run keeps its length and the game
// its timing. The shots' shadow masks are not drawn here.

import { hash } from '../kit.mjs';
import { canvas, cloud } from '../masonry.mjs';
import { rgb } from '../png.mjs';

// ---- colours -------------------------------------------------------------------------------------------------

const HOT = [rgb(255, 255, 232), rgb(255, 226, 72), rgb(252, 150, 26), rgb(226, 86, 18), rgb(152, 46, 22)];
const BROWN = [rgb(158, 108, 76), rgb(126, 84, 60), rgb(96, 64, 48)];
const GREY = [rgb(176, 176, 178), rgb(138, 138, 142), rgb(102, 102, 106)];
const DARK = [rgb(124, 124, 128), rgb(94, 94, 98), rgb(68, 68, 72)];
const SAND = [rgb(220, 178, 120), rgb(194, 150, 98), rgb(162, 120, 78)];
const WATER = [rgb(226, 255, 255), rgb(150, 238, 242), rgb(96, 204, 218)];
const SLUG = [rgb(168, 178, 214), rgb(112, 122, 170), rgb(66, 72, 112)];
const SHELL = [rgb(232, 70, 48), rgb(170, 36, 30), rgb(70, 60, 64)];

// ---- pieces --------------------------------------------------------------------------------------------------

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
/** 0 to 1 as t crosses from a to b. */
const ramp = (t, a, b) => clamp((t - a) / (b - a));

/** Which way a pixel lies from a centre, as a number round the circle from 0 to 16, without trigonometry. */
function bearing(dx, dy) {
  const s = Math.abs(dx) + Math.abs(dy) || 1;
  return (dx >= 0 ? 1 + dy / s : 3 - dy / s) * 4;
}

/** A flash: a white-hot star with uneven points. */
function flash(cv, cx, cy, r, seed) {
  if (r < 0.8) return;
  for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++) {
    for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const point = cloud(bearing(dx, dy) * 4, 0, 2, seed) ** 2 * 1.7;
      const far = Math.sqrt(dx * dx + dy * dy);
      const d = Math.min(far / (r * (0.3 + 0.9 * point)), far / (r * 0.5));
      if (d < 1) cv.set(x, y, d < 0.55 ? HOT[0] : d < 0.8 ? HOT[1] : HOT[2]);
    }
  }
}

/** A fireball: `heat` 1 is white-hot at the heart, 0 has cooled to brown smoke with a few embers. */
function fire(cv, cx, cy, r, seed, heat, lift = 0) {
  if (r < 0.8) return;
  for (let y = Math.floor(cy - r - 2); y <= cy + r + 2; y++) {
    for (let x = Math.floor(cx - r - 2); x <= cx + r + 2; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const d = Math.sqrt(dx * dx + dy * dy) / r + (cloud(x, y + lift, 3, seed) - 0.5) * 0.8;
      if (d >= 1) continue;
      const t = (1 - d) * (0.3 + heat * 1.3) + (cloud(x, y + lift, 2, seed + 1) - 0.5) * 0.35;
      cv.set(x, y, t > 0.95 ? HOT[0] : t > 0.68 ? HOT[1] : t > 0.42 ? HOT[2] : t > 0.22 ? HOT[3] : heat > 0.45 ? HOT[4] : BROWN[t > 0.1 ? 0 : 1]);
    }
  }
}

/** A puff of smoke: lit from the top left; below `body` 1 it thins into streaks. */
function puff(cv, cx, cy, r, seed, tone, body = 1, squash = 0.8) {
  if (r < 0.7) return;
  for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++) {
    for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
      const dx = (x + 0.5 - cx) / r;
      const dy = (y + 0.5 - cy) / (r * squash);
      const d = Math.sqrt(dx * dx + dy * dy) + (cloud(x, y, 3, seed) - 0.5) * 0.5;
      if (d >= 1) continue;
      if (body < 1 && cloud(x, y * 3, 4, seed + 5) > body) continue;
      const light = -(dx + dy) * 0.5 + (hash(x, y, seed + 2) - 0.5) * 0.3;
      cv.set(x, y, tone[light > 0.3 ? 0 : light > -0.2 ? 1 : 2]);
    }
  }
}

/** Sparks thrown out from a centre to about radius r. */
function sparks(cv, cx, cy, r, seed, count, up = 0) {
  for (let i = 0; i < count; i++) {
    const dx = hash(i, 1, seed) * 2 - 1;
    const dy = hash(i, 2, seed) * 2 - 1 - up;
    const k = r * (0.6 + hash(i, 3, seed) * 0.5);
    cv.set(Math.round(cx + dx * k), Math.round(cy + dy * k), HOT[1 + (i % 3)]);
  }
}

/** A ring: `body` below 1 breaks it into dots. */
function ring(cv, cx, cy, r, wide, seed, tone, body = 1) {
  for (let y = Math.floor(cy - r - 2); y <= cy + r + 2; y++) {
    for (let x = Math.floor(cx - r - 2); x <= cx + r + 2; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const d = Math.sqrt(dx * dx + dy * dy) + (cloud(x, y, 4, seed) - 0.5) * 1.6;
      if (Math.abs(d - r) > wide / 2 || hash(x >> 1, y >> 1, seed + 1) > body) continue;
      cv.set(x, y, typeof tone === 'function' ? tone(x, y) : tone[dx + dy < 0 ? 0 : 1]);
    }
  }
}

/** Tongues of flame standing on a line: `high` is the tallest, `beat` moves the flicker on. */
function flames(cv, cx, base, wide, high, seed, beat) {
  for (let i = 0; i < 4; i++) {
    const x0 = cx + (i - 1.5) * (wide / 4) + (hash(i, 1, seed) - 0.5) * 3;
    const h = high * (0.35 + 0.65 * hash(i, 2 + (beat >> 1), seed));
    if (h < 1) continue;
    for (let k = 0; k < h; k++) {
      const half = Math.sqrt(1 - k / h) * 3.2;
      const lean = (cloud(k + beat * 2, i * 9, 5, seed + 3) - 0.5) * (k / h) * 9;
      for (let x = Math.floor(x0 - half + lean); x <= x0 + half + lean; x++) {
        const t = k / h + Math.abs(x - x0 - lean) / 5;
        cv.set(x, base - k, t < 0.3 ? HOT[1] : t < 0.62 ? HOT[2] : t < 0.88 ? HOT[3] : HOT[4]);
      }
    }
  }
}

// ---- a blast, by its numbers ---------------------------------------------------------------------------------

/**
 * One frame of a blast. The numbers (all optional):
 *   at       where it goes off                     dot      a spark on the first frame
 *   flash    the flash's reach                     fire     the fireball's
 *   sparks   how many sparks fly                   up       how much they favour upward
 *   puffs    how many puffs of smoke               smoke    a puff's size
 *   from/to  the smoke's colour, early and late    spread   how far apart the puffs start
 *   drift    where the smoke goes by the end       squash   how flat a puff is
 *   embers   a glowing line along the ground       seed     what makes this blast its own
 */
function blast(i, n, o) {
  const cv = canvas(o.w ?? 32, o.h ?? 32);
  const [cx, cy] = o.at ?? [16, 17];
  const t = n > 1 ? i / (n - 1) : 0;
  const seed = o.seed;
  const lit = (o.flash || o.fire) && !o.cold;
  // Smoke comes in as the fire cools (straight away where there is no fire), swells, drifts and thins out.
  const start = lit ? 0.26 : 0;
  if (o.puffs && t >= start && i < n - 1) {
    const age = ramp(t, start, 1);
    const [driftX, driftY] = o.drift ?? [0, -3];
    for (let j = o.puffs - 1; j >= 0; j--) {
      const ox = (hash(j, 1, seed) * 2 - 1) * (o.spread ?? 6);
      const oy = (hash(j, 2, seed) * 2 - 1) * (o.spread ?? 6) * 0.6;
      const size = (o.smoke ?? 6) * (0.7 + hash(j, 3, seed) * 0.5) * (0.45 + 0.55 * ramp(age, 0, 0.35)) * (1 - 0.4 * ramp(age, 0.6, 1));
      const reach = 0.85 + age * 0.75;
      const tone = age < 0.2 + (j / o.puffs) * 0.3 ? o.from ?? o.to : o.to;
      puff(cv, cx + ox * reach + driftX * age * (0.6 + hash(j, 4, seed)), cy + oy * reach + driftY * age * (0.6 + hash(j, 5, seed)),
        size, seed + j * 13, tone, 1.35 - age * 1.15, o.squash ?? 0.8);
    }
  }
  if (o.embers && t > 0.2 && t < 0.8) for (let x = cx - 7; x <= cx + 7; x++) if (hash(x, i >> 1, seed + 7) < 0.3 * (1 - t)) cv.set(x, o.embers, HOT[2 + (x & 1)]);
  // Without smoke to follow it, the fire lasts the whole run.
  const span = o.puffs ? 1 : 1.9;
  if (o.fire && t >= 0.06 && t < 0.56 * span) {
    const heat = 1 - ramp(t, 0.1 * span, 0.5 * span);
    fire(cv, cx, cy, o.fire * (0.5 + 0.5 * ramp(t, 0.06, 0.22)) * (1 - 0.3 * ramp(t, 0.4 * span, 0.56 * span)), seed + 3, heat, i);
  }
  if (o.flash && t < 0.2) flash(cv, cx, cy, o.flash * (o.dot ? ramp(t, 0, 0.1) : 0.6 + 0.4 * ramp(t, 0, 0.08)) * (1 - 0.6 * ramp(t, 0.1, 0.2)), seed + 5);
  if (o.sparks && t > 0.08 && t < 0.5) sparks(cv, cx, cy, (o.fire ?? 5) * (0.8 + ramp(t, 0.08, 0.5) * 1.4), seed + 9, o.sparks, o.up ?? 0);
  if (o.dot && i === 0) cv.rect(cx - 1, cy - 1, cx, cy, HOT[0]);
  return cv.img;
}

/** A fire that flares up and burns down. */
function blaze(i, n, o) {
  const cv = canvas(32, 32);
  const t = i / (n - 1);
  const base = o.base ?? 27;
  if (t < 0.16) flash(cv, 16, o.star ?? 18, 9 * (1 - ramp(t, 0.05, 0.16) * 0.6), o.seed);
  if (t > 0.1 && i < n - 1) {
    const high = (o.high ?? 16) * ramp(t, 0.08, 0.3) * (1 - ramp(t, 0.55, 1));
    if (o.bed) for (let x = 9; x <= 23; x++) if (hash(x, i >> 1, o.seed + 2) < 0.7 * (1 - t)) cv.set(x, base + 1, HOT[3 + (x & 1)]);
    flames(cv, 16, base, 15, high, o.seed + 1, i);
  }
  return cv.img;
}

/** A small fire that opens into a ring of smoke. */
function smokeRing(i, n, seed) {
  const cv = canvas(32, 32);
  const t = i / (n - 1);
  if (i === 0) cv.rect(15, 16, 16, 17, HOT[0]);
  else if (t < 0.3) fire(cv, 16, 17, 2 + t * 14, seed, 1 - t);
  else if (i < n - 1) {
    const age = ramp(t, 0.3, 1);
    ring(cv, 16, 17, 5 + age * 8.5, 4.5 - age * 3, seed, age < 0.25 ? [HOT[3], HOT[4]] : BROWN, 1.1 - age);
  }
  return cv.img;
}

/** A fireball that swells, crusts over and blows away in streaks. */
function fireball(i, n, seed) {
  const cv = canvas(32, 32);
  if (i < 4) fire(cv, 16, 17, 6.5 + i * 1.7, seed, 1 - i * 0.12);
  else if (i < 6) {
    puff(cv, 16, 17, 11.5, seed + 1, DARK, 1, 1);
    fire(cv, 16, 17, 10 - (i - 4) * 3, seed, 0.75 - (i - 4) * 0.3);
  } else if (i < n - 1) for (let j = 0; j < 3; j++) puff(cv, 12 + j * 4, 15 + j * 3, 9 - (i - 6), seed + 2 + j, GREY, 0.6 - (i - 6) * 0.1, 0.5);
  return cv.img;
}

// ---- water ---------------------------------------------------------------------------------------------------

const wet = (x, y) => WATER[hash(x, y, 77) < 0.3 ? 0 : hash(x, y, 78) < 0.5 ? 1 : 2];

/** Rings spreading on water from a splash, with spray. */
function ripples(i, n, size, seed) {
  const cv = canvas(size, size);
  const c = size / 2;
  const t = i / (n - 1);
  const reach = size * 0.46;
  if (t < 0.3) puff(cv, c, c, reach * (0.3 + t * 1.2), seed, WATER, 1, 1);
  if (t > 0.1 && i < n - 1) {
    ring(cv, c, c, reach * (0.35 + 0.65 * t), size > 16 ? 2.4 - t * 1.4 : 1.4, seed + 1, wet, 1.25 - t);
    if (t > 0.3) ring(cv, c, c, reach * (0.1 + 0.5 * t), 1.2, seed + 2, wet, 1.1 - t);
    if (size > 16) for (let k = 0; k < 14; k++) if (hash(k, i >> 1, seed + 3) < 1 - t) cv.set(Math.round(c + (hash(k, 1, seed) * 2 - 1) * reach * (0.5 + t * 0.6)), Math.round(c + (hash(k, 2, seed) * 2 - 1) * reach * (0.5 + t * 0.6)), WATER[1]);
  }
  if (i === n - 1 && size > 16) puff(cv, c, c, 3, seed, WATER, 1, 1);
  return cv.img;
}

/** A splash seen from the side: water thrown up from the foot of the sprite, a column, then the drops falling. */
function splash(i, n, seed) {
  const cv = canvas(32, 32);
  const t = i / (n - 1);
  const high = 20 * ramp(t, 0, 0.45) * (1 - ramp(t, 0.5, 0.85));
  for (let k = 0; k < high; k++) {
    const half = k < 2 ? 5 - k : 1.3 + (k > high - 3 ? 1.5 : 0);
    for (let x = Math.floor(16 - half); x <= 16 + half; x++) if (hash(x, k + i, seed) < 0.85) cv.set(x, 29 - k, wet(x, k));
  }
  if (i < n - 1) {
    for (let k = 0; k < 16; k++) {
      const dx = (hash(k, 1, seed) * 2 - 1) * (4 + t * 11);
      const rise = hash(k, 2, seed) * 16 * (t < 0.5 ? t * 2 : 2 - t * 2);
      if (hash(k, 3 + (i >> 1), seed) < 1.2 - t) cv.set(Math.round(16 + dx), Math.round(29 - rise), WATER[k % 3]);
    }
    for (let x = 16 - Math.round(4 + t * 9); x <= 16 + Math.round(4 + t * 9); x++) if (hash(x, i, seed + 4) < 0.5 - t * 0.35) cv.set(x, 30, WATER[1 + (x & 1)]);
  }
  return cv.img;
}

// ---- exhaust and shots ---------------------------------------------------------------------------------------

/** A jet of flame from the right of the sprite that blows out into smoke. */
function jet(i, n, seed) {
  const cv = canvas(32, 16);
  const t = i / (n - 1);
  if (t > 0.2 && i < n - 1) {
    const age = ramp(t, 0.2, 1);
    for (let j = 0; j < 3; j++) puff(cv, 24 - j * 5 - age * 6, 8 + (hash(j, 1, seed) - 0.5) * 3, (4.2 - j * 0.6) * (1 - age * 0.6), seed + j, age < 0.3 ? BROWN : GREY, 1.1 - age, 0.7);
  }
  if (t < 0.4) {
    const long = 6 + ramp(t, 0, 0.15) * 8 * (1 - ramp(t, 0.25, 0.4));
    for (let k = 0; k < long; k++) {
      const half = 1.8 * (1 - k / long);
      for (let y = Math.floor(8 - half); y <= 8 + half; y++) cv.set(31 - k, y, k < long * 0.35 ? HOT[1] : k < long * 0.7 ? HOT[2] : HOT[3]);
    }
  }
  return cv.img;
}

/** A shot from the side, nose to the right: the upper half of its body with the tail fin standing up. */
function shot(body, nose, fin, long) {
  const cv = canvas(16, 8);
  for (let y = 4; y < 8; y++) cv.rect(y < 6 ? 2 : 0, y, long - (7 - y), y, y === 4 ? body[0] : y === 7 ? body[2] : body[1]);
  cv.rect(long - 5, 4, long - 3, 7, nose).rect(0, 0, 2, 3, fin).set(3, 2, fin).set(3, 3, fin).rect(0, 5, 1, 7, fin);
  return cv.img;
}

/** A tracer round: a slug seen from behind. */
function tracer() {
  const cv = canvas(8, 8);
  cv.disc(4, 5, 2.6, SLUG[1]).rect(3, 0, 4, 2, SLUG[1]).set(3, 1, SLUG[0]).set(3, 4, SLUG[0]).set(5, 6, SLUG[2]).set(4, 7, SLUG[2]);
  return cv.img;
}

/** A shot's exhaust: a flame trailing to the right, hottest where it leaves the motor. */
function exhaust(long) {
  const cv = canvas(16, 8);
  for (let k = 0; k < long; k++) {
    const half = 1.5 * (1 - k / long);
    for (let y = Math.floor(3.5 - half); y <= 3.5 + half; y++) cv.set(k, y, k < long * 0.3 ? HOT[1] : k < long * 0.7 ? HOT[2] : HOT[3]);
  }
  return cv.img;
}

// ---- the runs ------------------------------------------------------------------------------------------------

// Each run: its first sprite, how many frames, and how a frame is drawn.
const RUNS = [
  [1084, 24, { flash: 11, fire: 12, puffs: 6, smoke: 7, from: BROWN, to: GREY, spread: 9, drift: [0, 4], seed: 201 }],
  [1108, 15, { dot: true, fire: 6, puffs: 3, smoke: 5, from: BROWN, to: GREY, drift: [0, -7], seed: 202 }],
  [1123, 16, { puffs: 4, smoke: 6.5, from: BROWN, to: GREY, drift: [0, -2], seed: 203 }],
  [1139, 20, (i, n) => blaze(i, n, { seed: 204 })],
  [1159, 13, { at: [16, 22], puffs: 2, smoke: 5, to: GREY, spread: 2, drift: [0, -9], seed: 205 }],
  [1172, 8, { dot: true, flash: 6, fire: 7, at: [17, 18], seed: 206 }],
  [1180, 16, { at: [14, 15], flash: 11, fire: 9, puffs: 4, smoke: 5, to: DARK, seed: 207 }],
  [1196, 14, (i, n) => smokeRing(i, n, 208)],
  [1210, 12, (i, n) => fireball(i, n, 209)],
  [1222, 20, { flash: 8, sparks: 12, fire: 5, puffs: 3, smoke: 4.5, to: BROWN, spread: 3, drift: [0, -8], embers: 27, seed: 210 }],
  [1251, 24, (i, n) => blaze(i, n, { seed: 211, bed: true, high: 15 })],
  [1275, 16, { dot: true, fire: 7, puffs: 3, smoke: 6, from: BROWN, to: GREY, seed: 212 }],
  [1291, 13, { at: [16, 22], fire: 3, cold: true, puffs: 3, smoke: 5, from: BROWN, to: GREY, spread: 8, drift: [2, -1], squash: 0.55, seed: 213 }],
  [1348, 17, { flash: 8, sparks: 10, up: 1.2, fire: 6, puffs: 3, smoke: 5, from: BROWN, to: GREY, drift: [6, -8], seed: 214 }],
  [1365, 15, { fire: 5, puffs: 3, smoke: 5, from: BROWN, to: GREY, drift: [1, -3], seed: 215 }],
  [1380, 24, { at: [14, 19], dot: true, flash: 7, fire: 10, puffs: 7, smoke: 7, from: BROWN, to: DARK, spread: 11, seed: 216 }],
  [1404, 12, { at: [17, 19], dot: true, puffs: 3, smoke: 3.5, to: DARK, spread: 6, seed: 217 }],
  [1416, 21, { flash: 9, fire: 10, puffs: 5, smoke: 6, from: BROWN, to: DARK, seed: 218 }],
  [1437, 15, { dot: true, fire: 5, sparks: 9, puffs: 4, smoke: 5, to: DARK, spread: 7, seed: 219 }],
  [1452, 16, { dot: true, flash: 5, fire: 4.5, sparks: 8, puffs: 3, smoke: 5.5, to: DARK, seed: 220 }],
  [1468, 16, { dot: true, flash: 7, fire: 6, sparks: 10, puffs: 4, smoke: 4, from: BROWN, to: DARK, seed: 221 }],
  [1484, 19, { dot: true, flash: 13, fire: 11, puffs: 6, smoke: 7.5, from: BROWN, to: GREY, spread: 8, seed: 222 }],
  [1503, 20, { dot: true, flash: 7, fire: 8, puffs: 3, smoke: 6, from: BROWN, to: GREY, spread: 4, seed: 223 }],
  [1523, 14, { puffs: 3, smoke: 6, from: BROWN, to: GREY, spread: 4, seed: 224 }],
  [1537, 18, (i, n) => ripples(i, n, 32, 225)],
  [1555, 10, (i, n) => ripples(i, n, 16, 226)],
  [1565, 15, (i, n) => splash(i, n, 227)],
  [1580, 18, { flash: 9, fire: 8, sparks: 12, puffs: 6, smoke: 8, to: SAND, spread: 9, drift: [0, -5], seed: 228 }],
  [1598, 14, { dot: true, puffs: 4, smoke: 6.5, to: SAND, spread: 5, drift: [5, -5], seed: 229 }],
  [1612, 14, { puffs: 3, smoke: 6.5, to: SAND, spread: 4, drift: [4, -3], seed: 230 }],
  [1626, 14, { puffs: 4, smoke: 5.2, to: SAND, spread: 5, drift: [3, -6], seed: 231 }],
  [1640, 14, { puffs: 2, smoke: 5.9, to: SAND, spread: 3, drift: [7, -3], seed: 232 }],
  [1654, 17, { flash: 9, fire: 8, sparks: 12, puffs: 6, smoke: 8, to: GREY, spread: 9, drift: [0, -5], seed: 228 }],
  [1671, 15, { dot: true, puffs: 4, smoke: 6.5, to: GREY, spread: 5, drift: [5, -5], seed: 229 }],
  [1686, 14, { puffs: 3, smoke: 6.5, to: GREY, spread: 4, drift: [4, -3], seed: 230 }],
  [1700, 14, { puffs: 4, smoke: 5.2, to: GREY, spread: 5, drift: [3, -6], seed: 231 }],
  [1714, 14, { puffs: 2, smoke: 5.9, to: GREY, spread: 3, drift: [7, -3], seed: 232 }],
  [1746, 16, (i, n) => jet(i, n, 233)],
];

export function draw(put) {
  for (const [first, n, how] of RUNS) {
    for (let i = 0; i < n; i++) put(first + i, typeof how === 'function' ? how(i, n) : blast(i, n, how));
  }
  put(1066, shot(SLUG, rgb(236, 236, 240), SLUG[2], 15));
  put(1069, shot(SHELL, rgb(244, 150, 40), SHELL[2], 15));
  put(1072, shot([HOT[2], HOT[2], HOT[1]], SLUG[1], SHELL[1], 15));
  put(1075, tracer());
  put(1077, exhaust(9));
  put(1078, exhaust(6));
  put(1079, exhaust(12));
}
