// The helicopter and the attack drone: the sprites their models' faces carry, rotors still and spinning, shadows
// and the helicopter's wreck. On the long faces the nose is at the right unless a comment says otherwise.

import { GLASS, PAINT, SKIN, SOOT, STEEL, WHITE, box, disc, hash, inSets, over, sprite } from '../kit.mjs';

const RED = [0xff5a5aff, 0xff2222d2];

/** Camouflage: broad slanting bands of two tones. */
const camo = (p, x, y, seed = 0) => (Math.floor((x + y * 2 + seed) / 9) & 1 ? p.lo : p.mid);

// ---- helicopter ----------------------------------------------------------------------------------------------

/** From below: the belly, a stub wing each side with a rocket pod at its tip. */
const heliBelly = (p) => sprite(41, 50, (x, y) => {
  const dy = Math.abs(y - 24.5);
  if (dy < 7) return x > 37 ? (x > 39 ? 0 : RED[1]) : dy > 5.5 ? p.deep : x % 12 === 3 ? p.deep : p.lo;
  if (x >= 12 && x <= 20 && dy < 24) return dy > 18 ? (x >= 14 && x <= 18 ? (x > 16 ? RED[0] : STEEL.mid) : STEEL.lo) : p.deep;
  return 0;
});

/** The cabin's side: glazing at the nose end, a door, the engine housing above. */
const heliSide = (p) => sprite(52, 16, (x, y) => {
  if (x > 46 + (y > 8 ? 8 - y : y - 8) / 2) return 0;
  if (y < 2) return x < 36 ? p.hi : 0;
  if (x >= 34 && y >= 3 && y <= 9) return x + y < 40 ? p.lo : y < 5 ? GLASS.hi : GLASS.mid;
  if (x >= 20 && x <= 30 && y >= 5 && y <= 13) return x === 20 || y === 5 ? p.deep : p.lo;
  return y > 13 ? p.deep : camo(p, x, y);
});

const heliChin = () => sprite(32, 16, (x, y) => (y < 5 ? GLASS.hi : y < 10 ? GLASS.mid : Math.abs(x - 15.5) < 6 ? RED[1] : GLASS.lo));
const heliNose = () => sprite(16, 16, (x, y) => (x === 7 || x === 8 ? STEEL.lo : y < 6 ? GLASS.hi : y < 12 ? GLASS.mid : GLASS.lo));
const heliHub = (p) => sprite(16, 16, over(disc(8, 8, 4.5, (d) => (d < 1.5 ? STEEL.hi : d < 3 ? STEEL.lo : STEEL.mid)), (x, y) => (x === 0 || y === 0 || x === 15 || y === 15 ? p.lo : p.mid)));
const heliRear = (p) => sprite(16, 16, (x, y) => (y < 2 ? p.hi : x >= 5 && x <= 10 && y >= 5 && y <= 10 ? (y & 1 ? p.deep : p.lo) : p.mid));
const heliFin = (p) => sprite(32, 16, (x, y) => (x < 5 ? RED[1] : x < 7 ? WHITE : x > 29 || y === 0 || y === 15 ? p.lo : camo(p, x, y, 4)));

/** The tail boom from above (tail at the left): a slim boom, the tailplane across it near the end. */
const heliBoom = (p) => sprite(53, 30, (x, y) => {
  const dy = Math.abs(y - 14.5);
  if (x >= 4 && x <= 10 && dy < 11) return dy > 9 || x === 4 ? p.lo : p.mid;
  const half = 1.5 + (x / 52) * 3;
  if (dy > half) return 0;
  return dy > half - 1 ? p.lo : x % 10 === 5 ? p.lo : p.mid;
});

/** The cabin from above: engine housing, the rotor mast's fairing, glazing over the cockpit at the nose. */
const heliTop = (p) => sprite(42, 30, (x, y) => {
  const dy = Math.abs(y - 14.5);
  const half = x < 6 ? 5 + x / 2 : x > 34 ? 8 - (x - 34) * 0.9 : 8;
  if (dy > half) return 0;
  if (x >= 28) return dy > half - 1 ? p.lo : dy < 0.6 ? STEEL.lo : x > 36 ? GLASS.lo : x < 31 ? GLASS.hi : GLASS.mid;
  if (dy > half - 1) return p.lo;
  if (x >= 12 && x <= 20 && dy < 4) return dy > 3 || x === 12 ? p.deep : p.lo;
  return camo(p, x, y, 2);
});

const heliBoomSide = (p) => sprite(32, 16, (x, y) => (y > 13 - x / 4 ? 0 : y === 0 ? p.hi : y > 10 - x / 4 ? p.deep : camo(p, x, y, 6)));

/** The two crew, seen through the glass: helmets and shoulders. */
const crew = (p) => sprite(16, 16, over(
  ...[3, 9].map((x0) => over(box(x0 + 1, 3, x0 + 2, 5, (x, y) => (y === 3 ? STEEL.hi : STEEL.mid)), box(x0 + 1, 6, x0 + 2, 6, () => SKIN), box(x0, 7, x0 + 3, 12, (x, y) => (y > 10 ? p.lo : p.mid)))),
));

/** A rotor blade lying still: a dark blade, two red bands toward the tip. `tipLeft` puts the tip at the left. */
const blade = (w, tipLeft) => () => sprite(w, 8, (x, y) => {
  const along = tipLeft ? x : w - 1 - x;
  if (y < 3 || y > 4) return 0;
  return along === 3 || along === 6 ? RED[1] : y === 3 ? STEEL.lo : STEEL.deep;
});

/** A spinning rotor's blur: thin streaks fanning out, red where the tip bands smear. */
const blur = (w, h, seed) => sprite(w, h, (x, y) => {
  const t = hash(x >> 1, y, seed);
  if (t > 0.3) return 0;
  return x < 4 || x > w - 5 ? RED[1] : t < 0.1 ? STEEL.hi : STEEL.mid;
});

/** The helicopter's outline from above (tail at the left), for its shadow and, charred, its wreck. */
function heliShape(x, y) {
  const dy = Math.abs(y - 15.5);
  if (x >= 38 && x <= 58) return dy < 5 - Math.max(0, x - 52) * 0.6;
  if (x >= 42 && x <= 48) return dy < 13;
  if (x >= 4 && x <= 8) return dy < 6;
  return x >= 2 && x < 38 && dy < 1.5 + x / 30;
}

const heliWreck = (p) => sprite(64, 32, (x, y) => {
  if (heliShape(x, y) && hash(x >> 1, y >> 1, 701) > 0.3) return hash(x, y, 702) < 0.4 ? SOOT : x > 50 ? GLASS.lo : camo(p, x, y);
  if (hash(x, y, 703) < 0.03) return x & 1 ? RED[1] : GLASS.mid;
  return 0;
});

// ---- drone ---------------------------------------------------------------------------------------------------

/** The drone's underside: an open frame on two skids. */
const droneFrame = (p) => sprite(64, 64, (x, y) => {
  const skid = (x >= 2 && x <= 5) || (x >= 58 && x <= 61);
  if (skid) return y < 2 || y > 61 ? RED[1] : STEEL.lo;
  if ((y >= 12 && y <= 14) || (y >= 46 && y <= 49)) return y >= 46 && Math.abs(x - 32) > 8 && Math.abs(x - 32) < 24 ? p.mid : STEEL.mid;
  if ((x === 20 || x === 43) && y > 12 && y < 46) return STEEL.lo;
  return 0;
});

const droneSkid = () => sprite(64, 8, (x, y) => (y < 3 || y > 5 || x < 4 ? 0 : x > 60 ? RED[1] : x % 12 < 2 ? STEEL.hi : STEEL.lo));
const droneSide = (p) => sprite(64, 16, (x, y) => (x < 14 || x > 50 ? (y >= 6 && y <= 9 && x > 4 && x < 60 ? STEEL.lo : 0) : y < 2 ? p.hi : y > 12 ? p.deep : x < 20 ? p.lo : p.mid));

/** The drone from above: the motor cowl, the sensor eye, the gun's cradle. */
const droneTop = (p) => sprite(64, 64, over(
  disc(32, 30, 5, (d) => (d < 2 ? GLASS.lo : d < 3.5 ? GLASS.mid : STEEL.hi)),
  (x, y) => {
    const dx = Math.abs(x - 31.5);
    if (y >= 10 && y <= 24 && dx < 11 - Math.max(0, 14 - y)) return y === 24 ? p.deep : dx > 8 ? p.lo : y < 14 ? p.hi : p.mid;
    if (y > 24 && y < 50 && dx < 8) return dx > 6 ? STEEL.lo : y % 6 === 0 ? STEEL.lo : STEEL.mid;
    if (y >= 50 && y <= 58 && dx < 13) return y === 50 ? p.hi : y > 56 ? p.deep : p.mid;
    return 0;
  },
));

const dronePlate = () => sprite(16, 16, (x, y) => {
  const bolt = (x === 4 || x === 11) && (y === 4 || y === 11);
  return bolt ? STEEL.deep : x === 0 || y === 0 ? STEEL.hi : x === 15 || y === 15 ? STEEL.lo : STEEL.mid;
});
const droneFacet = (p) => sprite(16, 16, (x, y) => (y === 0 ? p.hi : y > 12 ? p.deep : x === 0 || x === 15 ? p.lo : p.mid));
const droneGun = () => sprite(16, 8, (x, y) => (x < 4 ? 0xff20d0f0 : x < 6 ? RED[1] : y < 3 ? STEEL.hi : y > 5 ? STEEL.deep : STEEL.lo));
const droneMuzzle = () => sprite(16, 16, disc(8, 8, 6, (d) => (d < 3 ? 0 : d > 5 ? STEEL.lo : STEEL.hi)));

/** The drone's shadow: its frame, and the ring its rotor sweeps. */
const droneShadow = () => sprite(64, 64, (x, y) => {
  const d = Math.sqrt((x - 31.5) ** 2 + (y - 31.5) ** 2);
  if (Math.abs(x - 31.5) < 10 && Math.abs(y - 31.5) < 12) return WHITE;
  return (d > 20 && d < 22) || (d > 26 && d < 27.5) ? WHITE : 0;
});

export function draw(put) {
  inSets(put, 524, heliBelly);
  inSets(put, 529, heliSide);
  inSets(put, 534, heliChin);
  inSets(put, 539, heliHub);
  inSets(put, 544, heliRear);
  inSets(put, 549, heliFin);
  inSets(put, 554, heliBoom);
  inSets(put, 559, heliTop);
  inSets(put, 564, heliNose);
  inSets(put, 569, heliBoomSide);
  inSets(put, 574, crew);
  put(579, sprite(64, 32, (x, y) => (heliShape(x, y) ? WHITE : 0)), { mode: 1 });
  put(580, blade(32, true)());
  put(581, blade(32, true)());
  put(582, blur(32, 16, 710), { mode: 3 });
  put(584, blade(33, false)());
  put(585, blade(33, false)());
  put(586, blur(33, 16, 711), { mode: 3 });
  put(588, blade(32, false)());
  put(606, heliWreck(PAINT[0]));
  put(607, heliWreck(PAINT[1]));

  put(583, blur(32, 32, 712), { mode: 3 });
  put(587, blur(33, 32, 713), { mode: 3 });
  put(608, droneSkid());
  put(609, droneSkid());
  put(610, droneFrame(PAINT[0]));
  put(611, droneFrame(PAINT[1]));
  put(612, droneSide(PAINT[0]));
  put(613, droneSide(PAINT[1]));
  put(616, dronePlate());
  put(617, dronePlate());
  put(618, droneFacet(PAINT[0]));
  put(619, droneFacet(PAINT[1]));
  put(620, droneGun());
  put(621, droneGun());
  put(622, droneMuzzle());
  put(623, droneMuzzle());
  put(624, droneTop(PAINT[0]));
  put(625, droneTop(PAINT[1]));
  put(626, droneShadow(), { mode: 2 });
}
