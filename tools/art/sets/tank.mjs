// The tank: the sprites its model's faces carry (hull top and belly, track sides, hull ends, the turret's plates,
// the gun and its muzzle), its shadow and its wreck. Each painted part comes in Brown, Green and a half-size gold.

import { PAINT, SOOT, STEEL, WHITE, blot, box, disc, hash, inSets, over, sprite } from '../kit.mjs';

// The hull sits in the middle 36 of a 64-pixel square (the face is as wide as the tracks' outer edges).
const L = 14;
const R = 49;

/** Track links seen end on or from below: dark steel, a lighter bar every other row. */
export const links = (x, y) => (y & 1 ? STEEL.lo : STEEL.deep);

function hullTop(p) {
  const fender = (x, y) => {
    const left = x <= L + 7;
    if (y < 7 || y > 56) return links(x, y);
    if (y === 7) return p.hi;
    if (x === L || x === R) return p.lo;
    if (x === L + 7 || x === R - 7) return p.deep;
    // A stowage box on the left, a tool rack on the right.
    if (left && y >= 30 && y <= 40) return y === 30 || x === L + 1 ? p.hi : y === 40 || x === L + 6 ? p.deep : p.lo;
    if (!left && y >= 24 && y <= 44 && (x === R - 3 || x === R - 5)) return y % 7 === 3 ? p.lo : p.deep;
    return p.mid;
  };
  const middle = (x, y) => {
    if (y < 5 || y > 58) return 0;
    if (y <= 15) {
      // The glacis, sloping up from the nose, with a lamp each side.
      if ((x === 25 || x === 26 || x === 37 || x === 38) && (y === 9 || y === 10)) return y === 9 ? STEEL.hi : STEEL.mid;
      return y < 7 ? p.lo : y < 11 ? p.mid : p.hi;
    }
    if (y <= 41) {
      const d = Math.sqrt((x + 0.5 - 32) ** 2 + (y + 0.5 - 28) ** 2);
      if (d < 7.5) return p.deep;
      if (d < 9) return p.lo;
      return x === 22 || x === 41 || y === 16 ? p.lo : p.mid;
    }
    if (y <= 56) {
      // The engine deck: louvres, and an exhaust down each side.
      if ((x === 23 || x === 24 || x === 39 || x === 40) && y >= 50) return x & 1 ? STEEL.lo : STEEL.mid;
      if (x >= 26 && x <= 37 && y >= 44 && y <= 54) return y % 3 === 0 ? p.deep : p.lo;
      return y === 42 ? p.hi : p.mid;
    }
    return p.deep;
  };
  return sprite(64, 64, (x, y) => (x < L || x > R || y < 5 || y > 58 ? 0 : x <= L + 7 || x >= R - 7 ? fender(x, y) : middle(x, y)));
}

function belly(p) {
  return sprite(64, 64, (x, y) => {
    if (x < L || x > R || y < 5 || y > 58) return 0;
    if (x <= L + 7 || x >= R - 7) return links(x, y);
    return x === 31 || x === 32 || y % 13 === 6 ? p.lo : p.deep;
  });
}

/** A track from the side: the loop of links, five road wheels, a sprocket at each end, the fender above. */
export function trackSide(p) {
  const wheels = [10, 21, 32, 43, 54].map((cx, i) => disc(cx, i === 0 || i === 4 ? 8.5 : 10, i === 0 || i === 4 ? 3 : 3.6, (d) => (d < 1 ? STEEL.lo : d < 2.6 ? STEEL.hi : STEEL.mid)));
  return sprite(64, 16, over(...wheels, (x, y) => {
    if (y < 3) return x >= 3 && x <= 60 ? (y === 0 ? p.hi : y === 2 ? p.deep : p.mid) : 0;
    // The loop: straight along the ground, rising to the sprockets at both ends.
    const rise = Math.max(0, 7 - x, x - 56);
    if (y > 15 - rise || x < 2 || x > 61) return 0;
    const edge = y >= 14 - rise || y === 3 || x < 4 || x > 59;
    return edge ? (x & 1 ? STEEL.lo : STEEL.deep) : SOOT;
  }));
}

/** The hull's nose and tail plates between the tracks: two tow shackles on a plate. */
const hullEnd = (p) => sprite(16, 16, (x, y) => {
  if ((x === 3 || x === 4 || x === 11 || x === 12) && y >= 4 && y <= 7) return y === 4 ? STEEL.hi : x === 4 || x === 12 ? STEEL.lo : STEEL.mid;
  return y === 0 ? p.hi : y >= 13 ? p.deep : y >= 10 ? p.lo : p.mid;
});

/** The turret from above: an eight-sided casting, the gun's mount at the front, a round hatch off to one side. */
function turretTop(p) {
  return sprite(32, 32, (x, y) => {
    const dx = Math.abs(x + 0.5 - 16);
    const dy = Math.abs(y + 0.5 - 16.5);
    const edge = Math.max(dx - 12, dy - 13.5, (dx + dy * 0.9 - 19) * 0.75);
    if (edge > 0) return 0;
    if (y <= 7 && dx < 6) return y === 7 ? p.deep : dx < 2 ? STEEL.lo : p.lo;
    const hatch = Math.sqrt((x + 0.5 - 20.5) ** 2 + (y + 0.5 - 19) ** 2);
    if (hatch < 1.2) return STEEL.hi;
    if (hatch < 3.6) return p.mid;
    if (hatch < 4.6) return p.deep;
    if (x >= 8 && x <= 11 && y >= 22 && y <= 24) return STEEL.mid;
    return edge > -1.2 ? p.lo : edge > -3 ? p.mid : p.hi;
  });
}

/** A turret side plate: riveted, a lifting eye near the top. */
const turretSide = (p) => sprite(32, 16, (x, y) => {
  if (y === 0) return p.hi;
  if (y >= 14) return p.deep;
  if (y === 4 && x % 6 === 3) return p.hi;
  if (x >= 14 && x <= 17 && y >= 7 && y <= 9) return x === 14 || y === 7 ? STEEL.hi : STEEL.lo;
  return y >= 11 ? p.lo : p.mid;
});

/** The turret's back: a stowage bin. */
const turretBack = (p) => sprite(16, 16, over(
  box(3, 4, 12, 11, (x, y) => (y === 4 || x === 3 ? p.hi : y === 11 || x === 12 ? p.deep : y === 7 ? p.deep : p.lo)),
  (x, y) => (y === 0 ? p.hi : y >= 14 ? p.deep : p.mid),
));

const turretFront = (p) => sprite(8, 8, (x, y) => (y === 0 ? p.mid : x >= 3 && x <= 4 && y >= 2 && y <= 5 ? p.deep : p.lo));

/**
 * One slope of the gun, breech at the left and muzzle at the right, the ridge along the bottom edge of the
 * sprite: a collar where it leaves the turret, the tube, and a slotted steel muzzle brake.
 */
const gun = (p) => sprite(32, 16, (x, y) => {
  const tone = (set) => (y >= 12 ? set.hi : y >= 6 ? set.mid : y >= 2 ? set.lo : set.deep);
  if (x >= 24) return x === 27 || x === 28 ? (y >= 4 && y <= 11 ? SOOT : STEEL.lo) : tone(STEEL);
  if (x < 5) return y >= 12 ? p.mid : p.deep;
  if (x === 5 || x === 23) return p.deep;
  return tone(p);
});

/** The muzzle end on: a steel ring round the bore. */
const muzzle = (p) => sprite(16, 16, disc(8, 8, 6.5, (d) => (d < 2.6 ? SOOT : d < 3.6 ? STEEL.deep : d > 5.5 ? p.lo : p.mid)));

/** The shadow: the hull's outline, as a mask. */
const shadow = () => sprite(64, 64, (x, y) => (x >= L - 1 && x <= R + 1 && y >= 4 && y <= 59 ? WHITE : 0));

/** The wreck's lower layer: a road wheel, a length of track and torn plate on the ground. */
export function wreckLow(p) {
  return sprite(32, 32, over(
    disc(7, 8, 3.2, (d) => (d < 1 ? STEEL.deep : d < 2.4 ? STEEL.mid : STEEL.lo)),
    (x, y) => (y >= 23 && y <= 26 && x >= 10 && x <= 24 ? (x & 1 ? STEEL.lo : STEEL.deep) : 0),
    (x, y) => (x >= 22 && x <= 25 && y >= 14 && y <= 26 ? (y & 1 ? STEEL.lo : STEEL.deep) : 0),
    (x, y) => {
      // A torn plate: a slab with a ragged bite out of it.
      if (x < 12 || x > 26 || y < 4 || y > 12) return 0;
      if (hash(x >> 1, y >> 1, 601) < 0.22 || x - y > 17) return 0;
      return y === 4 ? p.mid : y > 10 ? p.deep : p.lo;
    },
    (x, y) => (x >= 4 && x <= 13 && y >= 17 && y <= 22 && hash(x >> 1, y, 602) > 0.2 ? (y < 19 ? p.lo : p.deep) : 0),
    (x, y) => (hash(x, y, 603) < 0.035 ? SOOT : 0),
  ));
}

/** The wreck's upper layer: the turret ring bent open, and a couple of plates thrown clear. */
export function wreckHigh(p) {
  return sprite(32, 32, over(
    (x, y) => {
      const d = Math.sqrt((x + 0.5 - 13) ** 2 + (y + 0.5 - 16) ** 2);
      if (d < 9 || d > 12.5 || x < 14 || y > 15) return 0;
      return d > 11.4 ? p.hi : d > 10 ? p.mid : p.lo;
    },
    box(5, 12, 8, 16, (x, y) => (x + y < 16 ? p.mid : p.lo)),
    box(6, 21, 13, 26, (x, y) => (y === 21 || x === 6 ? p.hi : (x === 9 || x === 10) && (y === 23 || y === 24) ? p.deep : p.mid)),
    box(15, 20, 17, 21, () => p.lo),
  ));
}

export function draw(put) {
  inSets(put, 167, belly);
  inSets(put, 172, hullTop);
  inSets(put, 177, turretTop);
  inSets(put, 182, trackSide);
  inSets(put, 187, hullEnd);
  inSets(put, 192, turretSide);
  inSets(put, 197, turretBack);
  inSets(put, 202, gun);
  inSets(put, 207, turretFront);
  inSets(put, 212, muzzle);
  put(217, shadow(), { mode: 1 });
  put(274, sprite(32, 32, blot(16, 16, 15, 610, WHITE)), { mode: 1 });
  put(275, wreckLow(PAINT[0]));
  put(276, wreckLow(PAINT[1]));
  put(277, wreckHigh(PAINT[0]));
  put(278, wreckHigh(PAINT[1]));
}
