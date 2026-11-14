// The jeep: an open car with a driver. The sprites its model's faces carry (floor, sides, bonnet, the cockpit's
// rim, grille and tail, windscreen, the driver and five frames of turning wheels) and its shadow. Front is at the
// left of the long faces.

import { GLASS, GOLD, PAINT, SKIN, SOOT, STEEL, WHITE, box, disc, halved, inSets, over, sprite } from '../kit.mjs';

/** The floor from above: bumper, engine bay, two seats, the load bed's boards. */
const floor = (p) => sprite(64, 32, (x, y) => {
  if (x < 2 || x > 61 || y < 4 || y > 27) return x >= 2 && x <= 4 && y >= 1 && y <= 30 ? STEEL.mid : 0;
  if (x <= 4) return STEEL.mid;
  if (x < 24) return y === 4 || y === 27 ? p.lo : p.deep;
  if (x < 40) {
    const seat = (y >= 7 && y <= 14) || (y >= 17 && y <= 24);
    return seat && x >= 27 && x <= 36 ? (x === 27 ? p.hi : x >= 34 ? p.lo : p.mid) : p.deep;
  }
  return x % 5 === 0 ? p.deep : p.lo;
});

/** The body from the side: bonnet, the cockpit cut low, the tub behind; wheels are separate. */
const flank = (p) => sprite(64, 32, (x, y) => {
  const top = x < 6 ? 20 : x < 26 ? 14 : x < 42 ? 19 : 13;
  if (y < top || y > 27 || x < 2 || x > 61) return 0;
  // Wheel arches.
  const arch = (cx) => Math.sqrt((x + 0.5 - cx) ** 2 + (y - 28) ** 2) < 7;
  if (arch(16) || arch(50)) return 0;
  if (y === top) return p.hi;
  if (x >= 28 && x <= 29) return p.deep;
  return y > 25 ? p.deep : y > 21 ? p.lo : p.mid;
});

const grille = (p) => sprite(32, 16, (x, y) => {
  const lamp = (cx) => Math.abs(x - cx) <= 2 && y >= 4 && y <= 9;
  if (lamp(6) || lamp(25)) return y < 6 ? GLASS.hi : GLASS.mid;
  if (x >= 11 && x <= 20 && y >= 3 && y <= 11) return x & 1 ? SOOT : p.lo;
  if (y >= 13) return STEEL.mid;
  return y === 0 ? p.hi : p.mid;
});

const tail = (p) => sprite(32, 16, (x, y) => {
  if ((x <= 4 || x >= 27) && y >= 3 && y <= 8) return y < 5 ? rgbRed[0] : rgbRed[1];
  if (y >= 12) return y === 12 ? STEEL.hi : STEEL.lo;
  if (x >= 12 && x <= 19 && y >= 3 && y <= 8) return SOOT;
  return y === 0 ? p.hi : p.mid;
});
const rgbRed = [0xff5a5aff, 0xff2222d2];

/** The bonnet from above, nose at the left: a raised middle, louvres, and the gun's two barrels at the back. */
const bonnet = (p) => sprite(32, 32, (x, y) => {
  if (y < 3 || y > 28) return 0;
  if (x >= 24 && (y === 12 || y === 13 || y === 18 || y === 19)) return x > 29 ? SOOT : STEEL.mid;
  if (x > 26) return 0;
  if (y === 3 || y === 28 || x === 0) return p.lo;
  if (x >= 6 && x <= 18 && (y === 8 || y === 23)) return p.deep;
  return y >= 11 && y <= 20 ? p.hi : p.mid;
});

/** The cockpit's rim from above: the tub's edge on three sides, open in the middle, the spare wheel at the back. */
const rim = (p) => sprite(32, 32, over(
  disc(27, 16, 4, (d) => (d < 1.5 ? STEEL.mid : SOOT)),
  (x, y) => {
    if (y < 3 || y > 28 || x < 3) return 0;
    const edge = y <= 5 || y >= 26 || x >= 22;
    if (!edge) return 0;
    return y === 3 || x === 22 ? p.hi : y === 28 ? p.deep : p.mid;
  },
));

/** The driver from behind the wheel: helmet, shoulders, hands up on the wheel. */
const driver = (p) => sprite(16, 16, over(
  box(6, 2, 9, 4, (x, y) => (y === 2 ? STEEL.mid : STEEL.lo)),
  box(6, 5, 9, 6, () => SKIN),
  box(4, 7, 11, 12, (x, y) => (x === 4 || x === 11 ? p.lo : y > 10 ? p.lo : p.mid)),
  box(2, 9, 3, 13, () => p.lo),
  box(12, 9, 13, 13, () => p.lo),
  box(2, 14, 13, 14, () => SOOT),
  (x, y) => ((x === 2 || x === 13) && y === 13 ? SKIN : 0),
));

const screen = (p) => sprite(32, 16, (x, y) => {
  if (x < 2 || x > 29 || y < 1 || y > 14) return 0;
  if (x < 4 || x > 27 || y < 3 || y > 12) return y === 1 ? p.hi : p.lo;
  return x + y < 22 && x + y > 16 ? GLASS.hi : GLASS.mid;
});

/** Both wheels from the side on a clear strip: tyre, rim, and a hub whose bolts turn with `frame`. */
function wheels(frame) {
  const wheel = (cx) => (x, y) => {
    const dx = x + 0.5 - cx;
    const dy = y + 0.5 - 23;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > 8.5) return 0;
    if (d > 5.5) return (Math.floor(Math.abs(dx) + Math.abs(dy) + frame) % 5 === 0) ? STEEL.lo : SOOT;
    if (d > 4.3) return STEEL.mid;
    // Four bolts, a fifth of a quarter turn on each frame.
    const bolts = [[2.4, 0.8], [1.9, 1.7], [1.2, 2.3], [0.5, 2.5], [-0.3, 2.5]][frame];
    for (const [bx, by] of [bolts, [-bolts[1], bolts[0]], [-bolts[0], -bolts[1]], [bolts[1], -bolts[0]]]) {
      if (Math.abs(dx - bx) < 0.8 && Math.abs(dy - by) < 0.8) return STEEL.hi;
    }
    return d < 1.2 ? STEEL.hi : GLASS.lo;
  };
  return sprite(128, 32, over(wheel(40), wheel(90)));
}

export function draw(put) {
  inSets(put, 417, bonnet);
  inSets(put, 422, floor);
  inSets(put, 427, rim);
  inSets(put, 432, flank);
  inSets(put, 437, grille);
  inSets(put, 442, tail);
  put(447, driver(PAINT[0]));
  put(448, driver(PAINT[1]));
  put(449, driver(GOLD));
  inSets(put, 452, screen);
  for (let f = 0; f < 5; f++) put(457 + f, wheels(f));
  put(462, sprite(32, 16, box(1, 2, 30, 13, WHITE)), { mode: 1 });
}
