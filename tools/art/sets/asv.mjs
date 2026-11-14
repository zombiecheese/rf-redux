// The armoured support vehicle: a tracked carrier with a cab at the front and a rocket rack on its back. The
// sprites its model's faces carry, its shadow and its wreck.

import { PAINT, GLASS, SOOT, STEEL, WHITE, blot, box, hash, inSets, mirrored, over, sprite } from '../kit.mjs';
import { links, trackSide, wreckHigh, wreckLow } from './tank.mjs';

// Across a 64-pixel face 24 units wide: the tracks' outer edges, and the body between them.
const TRACK = [12, 51];
const BODY = [20, 43];

const belly = (p) => sprite(64, 64, (x, y) => {
  if (x < TRACK[0] || x > TRACK[1] || y < 4 || y > 59) return 0;
  if (x < BODY[0] || x > BODY[1]) return links(x, y);
  return y % 11 === 5 || x === 31 || x === 32 ? p.lo : p.deep;
});

/** The roof: the cab with its two hatches, then the open bed the rack stands in. */
const roof = (p) => sprite(64, 64, (x, y) => {
  if (x < BODY[0] || x > BODY[1] || y < 8 || y > 60) return 0;
  const edge = x === BODY[0] || x === BODY[1];
  if (y < 27) {
    const hatch = (cx) => Math.abs(x - cx) <= 3 && y >= 13 && y <= 20;
    if (hatch(26) || hatch(37)) return y === 13 || x === 23 || x === 34 ? p.hi : y === 20 || x === 29 || x === 40 ? p.deep : p.lo;
    return y === 8 ? p.lo : edge ? p.lo : y < 11 ? p.mid : p.hi;
  }
  if (y === 27 || y === 60) return p.deep;
  if (edge || x === BODY[0] + 1 || x === BODY[1] - 1) return p.mid;
  return y % 6 === 3 ? p.deep : p.lo;
});

/** The rack's base plate, on the back half of its face: three tube covers in a row. */
const rackBase = (p) => sprite(32, 32, (x, y) => {
  if (y < 14 || x < 2 || x > 29) return 0;
  const cover = x >= 4 && x <= 27 && (x - 4) % 8 < 6 && y >= 18 && y <= 25;
  if (cover) return (x - 4) % 8 === 0 || y === 18 ? p.hi : (x - 4) % 8 === 5 || y === 25 ? p.deep : p.lo;
  return y === 14 ? p.hi : y >= 29 ? p.deep : p.mid;
});

/** A fender over a track: the track's edge showing along the outside, a tool clipped to the plate. */
const fender = (p) => sprite(64, 16, (x, y) => {
  if (x < 9) return links(y, x);
  if (x === 9) return p.deep;
  if (x >= 20 && x <= 50 && y >= 6 && y <= 8) return y === 6 ? STEEL.hi : STEEL.lo;
  return y === 0 || y === 15 ? p.lo : p.mid;
});

/** The body from the side, cab at the left: a sloped front with a window, panelled sides, a skirt below. */
const side = (p) => sprite(64, 32, (x, y) => {
  // The cab's front leans back.
  if (x < 10 - y / 2) return 0;
  if (y >= 26) return p.deep;
  if (x >= 6 && x <= 17 && y >= 4 && y <= 11) return y === 4 || x === 6 ? p.deep : y < 8 ? GLASS.lo : GLASS.mid;
  if (x === 22 || x === 42) return p.deep;
  if (x > 22 && y >= 6 && y <= 20 && (x - 23) % 20 > 2 && (x - 23) % 20 < 17) return y === 6 ? p.hi : y === 20 ? p.deep : p.mid;
  return y === 0 ? p.hi : y >= 22 ? p.lo : y < 3 ? p.mid : p.lo;
});

const windscreen = (p) => sprite(16, 16, (x, y) => {
  if (x >= 2 && x <= 13 && y >= 3 && y <= 10) return x === 7 || x === 8 ? p.lo : y < 6 ? GLASS.lo : GLASS.mid;
  return y === 0 ? p.hi : y >= 13 ? p.lo : p.mid;
});

const rearDoors = (p) => sprite(16, 16, (x, y) => {
  if (x === 7 || x === 8) return p.deep;
  if ((x === 5 || x === 10) && y >= 6 && y <= 8) return STEEL.hi;
  return y === 0 ? p.hi : y >= 14 ? p.deep : x === 0 || x === 15 ? p.lo : p.mid;
});

/** The low plate at the nose and tail: a bumper between the two tracks' ends. */
const endPlate = (p) => sprite(32, 16, (x, y) => {
  if (x < 6 || x > 25) return y < 3 ? 0 : links(x, y);
  if (y >= 10 && y <= 12) return y === 10 ? STEEL.hi : STEEL.lo;
  return y === 0 ? p.hi : y >= 14 ? p.deep : p.mid;
});

/** The rockets on the rack: three in a row, noses forward. */
const ROCKET = { hi: GLASS.hi, mid: GLASS.mid, lo: STEEL.lo };
const rockets = () => sprite(32, 17, (x, y) => {
  const slot = (x - 3) % 9;
  if (x < 3 || x > 28 || slot > 6) return 0;
  const d = Math.abs(slot - 3);
  if (y < 4) return d <= y ? (d === 0 ? ROCKET.hi : ROCKET.mid) : 0;
  if (d > 2) return y >= 13 ? ROCKET.lo : 0;
  return y >= 15 ? SOOT : d === 0 || slot === 2 ? ROCKET.hi : ROCKET.mid;
});

export function draw(put) {
  inSets(put, 279, belly);
  inSets(put, 284, roof);
  inSets(put, 289, rackBase);
  inSets(put, 294, fender);
  inSets(put, 299, trackSide);
  inSets(put, 304, side);
  inSets(put, 309, windscreen);
  inSets(put, 314, rearDoors);
  inSets(put, 319, endPlate);
  put(324, rockets());
  put(327, sprite(32, 32, box(5, 2, 26, 30, WHITE)), { mode: 1 });
  put(412, sprite(32, 32, blot(16, 16, 15, 620, WHITE)), { mode: 1 });
  put(413, mirrored(wreckLow(PAINT[0])));
  put(414, mirrored(wreckLow(PAINT[1])));
  put(415, mirrored(wreckHigh(PAINT[0])));
  put(416, mirrored(wreckHigh(PAINT[1])));
}
