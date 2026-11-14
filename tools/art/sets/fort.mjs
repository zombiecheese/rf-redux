// The fort: gun towers and their turrets, the walls between them, the gates, and all of these knocked about
// (walls broken at one end or both, the stump of a tower, the heap a tower or a gate leaves). The shadow masks
// among these numbers are not drawn here.

import { PAINT, STEEL, hash } from '../kit.mjs';
import { CONCRETE, PIT, beam, broken, canvas, cloud, cracked, dim, grey, rubble, shade, shard, tones } from '../masonry.mjs';
import { rgb } from '../png.mjs';

const C = CONCRETE;
const LAMP = [rgb(236, 40, 36), rgb(128, 16, 16)];
const BEACON = [rgb(150, 226, 255), rgb(40, 132, 232)];

// How much light each side of a model gets: the side facing the viewer, the left, the right, the far side.
const LIGHT = [1, 0.94, 0.78, 0.64];

// ---- towers --------------------------------------------------------------------------------------------------

/** A tower's roof: a painted parapet round a concrete deck, the turret's ring in the middle. */
function towerTop(p) {
  const cv = canvas(32, 32, p.mid);
  cv.frame(0, 0, 31, 31, p.hi, p.lo).frame(3, 3, 28, 28, p.lo, p.hi);
  cv.raised(4, 4, 27, 27, C).frame(6, 6, 25, 25, C.lo, C.hi);
  // The braces the ring sits on, then the ring.
  cv.rect(15, 7, 16, 24, C.deep).rect(7, 15, 24, 16, C.deep);
  cv.disc(16, 16, 8.2, C.deep).disc(16, 16, 6.8, grey(92)).disc(16, 16, 2.2, C.deep);
  for (const [x, y] of [[8, 8], [23, 8], [8, 23], [23, 23]]) cv.set(x, y, C.deep);
  return cv.img;
}

/** One of a tower's four leaning walls: a painted band with a pennant under it, a firing slit, a footing. */
function towerWall(p) {
  const cv = canvas(32, 32, C.mid);
  cv.rect(0, 0, 31, 3, p.mid).rect(0, 0, 31, 0, p.hi).rect(0, 3, 31, 3, p.lo).rect(0, 4, 31, 4, C.lo);
  for (let y = 4; y <= 8; y++) {
    for (let x = 11 + (y - 4); x <= 20 - (y - 4); x++) cv.set(x, y, x === 11 + (y - 4) ? p.hi : x === 20 - (y - 4) ? p.deep : p.mid);
  }
  cv.sunk(11, 13, 20, 25, C).rect(13, 15, 18, 23, C.mid).frame(13, 15, 18, 23, C.hi, C.lo);
  cv.rect(15, 17, 16, 21, PIT);
  cv.rect(0, 29, 31, 29, C.hi).rect(0, 30, 31, 31, C.lo);
  for (const x of [8, 22]) cv.rect(x, 26, x + 1, 27, C.deep);
  return cv;
}

/** The turret from above: twin barrels at the front (the left of the sprite), a hatch and a lamp behind. */
function turretTop(p) {
  const cv = canvas(16, 16, p.mid);
  cv.frame(5, 0, 15, 15, p.hi, p.lo).frame(8, 3, 13, 12, p.lo, p.hi).rect(9, 4, 12, 11, p.mid);
  cv.rect(0, 0, 4, 15, STEEL.deep);
  for (const y of [3, 10]) cv.rect(0, y, 4, y, STEEL.hi).rect(0, y + 1, 4, y + 1, STEEL.mid).rect(0, y + 2, 4, y + 2, STEEL.lo);
  cv.rect(6, 7, 7, 8, LAMP[0]).set(7, 8, LAMP[1]);
  return cv.img;
}

/** The turret's side: the gun's cradle at the front, the painted box behind. */
function turretSide(p) {
  const cv = canvas(16, 8, p.lo);
  cv.rect(0, 0, 15, 0, p.mid).rect(0, 7, 15, 7, p.deep).rect(5, 2, 13, 5, p.deep).frame(5, 2, 13, 5, p.deep, p.mid);
  cv.rect(0, 0, 3, 7, STEEL.lo).rect(0, 3, 3, 4, STEEL.deep);
  return cv.img;
}

/** The turret's end: a steel plate with four ports. */
function turretEnd() {
  const cv = canvas(16, 8, STEEL.lo);
  cv.rect(0, 0, 15, 0, STEEL.mid).rect(0, 7, 15, 7, STEEL.deep);
  for (const x of [1, 5, 9, 13]) cv.rect(x, 2, x + 1, 5, STEEL.deep).set(x, 2, STEEL.mid).set(x + 1, 5, STEEL.hi);
  return cv.img;
}

/** What is left of a tower wall: the foot of it, torn along the top and cracked. */
function towerStump(seed, k) {
  const wall = towerWall(PAINT[0]);
  const top = (x) => 15 + Math.round(cloud(x, 0, 6, seed) * 9);
  wall.each((c, x, y) => {
    if (y < top(x)) return 0;
    if (y === top(x)) return C.hi;
    if (cracked(x, y, seed + 3, 1)) return C.deep;
    return c;
  });
  return dim(wall.img, k);
}

/** A fallen turret plate lying on the stump. */
function turretPlate() {
  const cv = canvas(16, 16).raised(0, 0, 15, 15, tones(176));
  for (const [x, y] of [[3, 3], [9, 3], [3, 9], [9, 9]]) cv.sunk(x, y, x + 3, y + 3, C, C.deep);
  return cv.img;
}

/** The heap a tower leaves: broken stone, edge to edge. */
function heap() {
  const cv = canvas(32, 32, broken(108, 31));
  rubble(cv, 37, 46, 1.4, 3.6, { margin: -1, v: 134 });
  cv.each((c, x, y) => (Math.min(x, y, 31 - x, 31 - y) === 0 && hash(x, y, 41) < 0.45 ? 0 : c));
  return cv.img;
}

// ---- walls ---------------------------------------------------------------------------------------------------

// A wall's long side leans in from a wide cap to its foot, and stands clear of the ends of its sprite.
const lean = (y) => (y < 2 ? 11 : 12 + Math.floor((y - 2) / 7));

/** The row-by-row look of a wall's side, used whole and in pieces. */
function wallRow(x, y, left, right) {
  if (y === 0) return C.hi;
  if (y === 1) return grey(184);
  if (y <= 3) return C.lo;
  if (y === 24) return C.hi;
  if (y >= 26) return y === 31 ? C.lo : grey(152);
  return x === left ? C.hi : x === right ? C.lo : C.mid;
}

/** A niche: a tall arched hollow. */
function niche(cv, x, y0, y1) {
  cv.sunk(x, y0, x + 4, y1, C).set(x, y0, C.mid).set(x + 4, y0, C.mid).rect(x + 2, y0 + 2, x + 2, y1 - 2, C.deep);
}

function wallSide() {
  const cv = canvas(64, 32);
  cv.each((c, x, y) => (x >= lean(y) && x <= 63 - lean(y) ? wallRow(x, y, lean(y), 63 - lean(y)) : 0));
  niche(cv, 23, 8, 21);
  niche(cv, 36, 8, 21);
  for (const x of [22, 38]) cv.rect(x, 28, x + 3, 29, C.deep);
  return cv;
}

function wallTop() {
  const cv = canvas(64, 8);
  cv.rect(10, 0, 53, 7, grey(206)).rect(10, 0, 53, 0, grey(224)).rect(10, 7, 53, 7, C.mid);
  for (const x of [23, 37]) cv.rect(x, 3, x + 3, 4, C.lo).rect(x + 1, 3, x + 2, 3, C.deep);
  return cv;
}

// Where a wall broken at one end stops: further out at the foot than at the top, and ragged.
const tear = (y, seed) => 37 + Math.floor((y * 8) / 31) + Math.round(hash(y >> 1, 0, seed) * 3);

function brokenWallSide(seed) {
  const cv = wallSide();
  cv.each((c, x, y) => {
    const edge = tear(y, seed);
    if (x > edge) return 0;
    if (!c) return 0;
    if (x === edge) return C.hi;
    if (x > edge - 16 && cracked(x, y, seed + 5, 1.1)) return C.deep;
    return c;
  });
  return cv.img;
}

function brokenWallTop() {
  const cv = wallTop();
  cv.each((c, x, y) => (x > 35 + Math.round(hash(y, 0, 53) * 3) ? 0 : c));
  return cv.img;
}

/** The middle of a wall broken at both ends: a stub, wider at the foot. */
function stubSide(seed) {
  const cv = canvas(32, 32);
  const half = (y) => 7 + Math.floor((y * 7) / 31) + Math.round(hash(y >> 1, 1, seed) * 2);
  cv.each((c, x, y) => {
    const left = 15 - half(y);
    const right = 16 + half(y + 64);
    if (x < left || x > right) return 0;
    return wallRow(x, y, left, right);
  });
  niche(cv, 14, 8, 21);
  cv.each((c, x, y) => (c && cracked(x, y, seed + 7, 1.1) ? C.deep : c));
  return cv.img;
}

function stubTop() {
  const cv = canvas(16, 8, grey(200));
  cv.rect(0, 0, 15, 0, grey(222)).rect(0, 7, 15, 7, C.mid);
  cv.each((c, x, y) => (cracked(x, y, 61, 2.4) ? C.lo : c));
  return cv.img;
}

// ---- gates ---------------------------------------------------------------------------------------------------

/** The outer side of a gate post, leaning like the wall it ends. */
function postSide() {
  const cv = canvas(8, 32);
  cv.each((c, x, y) => {
    const left = 2 + Math.floor(y / 8);
    return x >= left ? wallRow(x, y, left, 7) : 0;
  });
  return cv.img;
}

/** The face of a post the leaf slides into: a dark slot between two guide rails. */
function postFace() {
  const cv = canvas(32, 32, grey(122));
  cv.rect(0, 0, 31, 1, grey(150)).rect(0, 30, 31, 31, grey(98));
  cv.rect(10, 9, 21, 31, grey(100)).frame(10, 9, 21, 31, grey(84), grey(140));
  cv.rect(13, 11, 18, 31, PIT).rect(13, 11, 13, 31, grey(30));
  for (const x of [4, 26]) cv.rect(x, 27, x + 1, 28, grey(78));
  return cv.img;
}

/** A bolted plate: the leaf's edge and top. */
function plate() {
  const cv = canvas(8, 8).raised(0, 0, 7, 7, tones(150));
  cv.rect(3, 2, 4, 5, C.deep).rect(2, 3, 5, 4, C.deep);
  return cv.img;
}

/** The plate an open gate shows: its beacon lit. */
function beaconPlate() {
  const cv = canvas(8, 8).raised(0, 0, 7, 7, tones(150));
  cv.rect(2, 2, 5, 5, BEACON[1]).rect(3, 3, 4, 4, BEACON[0]);
  return cv.img;
}

/** A gate leaf: two painted panels in a steel frame, the runner down one side. */
function leaf(p) {
  const cv = canvas(16, 16, grey(118));
  cv.frame(0, 0, 15, 15, grey(150), grey(84));
  cv.rect(1, 2, 10, 5, p.mid).frame(1, 2, 10, 5, p.hi, p.deep).rect(3, 4, 8, 4, p.deep);
  cv.rect(1, 8, 10, 13, p.mid).frame(1, 8, 10, 13, p.hi, p.deep).rect(4, 10, 7, 11, p.lo).rect(5, 11, 6, 11, p.hi);
  cv.rect(12, 1, 14, 14, grey(96));
  for (const y of [3, 7, 11]) cv.rect(12, y, 14, y, grey(160)).rect(12, y + 1, 14, y + 1, grey(60));
  return cv.img;
}

/** What a gate leaves: lumps of post, a bent rail and torn panels. */
function gateWreck(p) {
  const cv = canvas(32, 32);
  rubble(cv, 71, 9, 1.5, 3.4, { margin: 1, v: 130 });
  beam(cv, 5, 26, 24, 29, tones(104), 1);
  beam(cv, 9, 6, 15, 13, p, 2);
  shard(cv, 20, 16, 3, 73, p);
  shard(cv, 13, 22, 2.4, 74, p);
  cv.set(17, 9, shade(p.hi, 1.1));
  return cv.img;
}

export function draw(put) {
  PAINT.forEach((p, side) => {
    put(832 + side, towerTop(p));
    [834, 836, 838, 840].forEach((cel, i) => put(cel + side, dim(towerWall(p).img, LIGHT[i])));
    put(847 + side, turretSide(p));
    put(849 + side, turretTop(p));
    put(851 + side, turretEnd());
    put(859 + side, leaf(p));
    put(861 + side, gateWreck(p));
  });
  put(844, wallTop().img);
  put(845, dim(wallSide().img, 0.84));
  put(846, wallSide().img);
  put(853, postSide());
  put(854, dim(postSide(), 0.84));
  put(856, postFace());
  put(857, plate());
  put(858, beaconPlate());

  put(1925, brokenWallTop());
  put(1926, brokenWallSide(81));
  put(1927, dim(brokenWallSide(83), 0.84));
  put(1928, canvas(16, 16, broken(128, 85)).img);
  put(1929, stubSide(87));
  put(1930, dim(stubSide(89), 0.84));
  put(1931, stubTop());
  put(1932, turretPlate());
  // The stump's walls, lit like the tower's: far side, left, right, near side.
  put(1933, towerStump(91, LIGHT[3]));
  put(1934, towerStump(93, LIGHT[1]));
  put(1935, towerStump(95, LIGHT[2]));
  put(1936, towerStump(97, LIGHT[0]));
  put(1937, heap());
}
