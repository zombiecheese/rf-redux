// The works: the factories (three roofs, and walls with a door, a roller door, lit windows, blank panels or a
// hole blown through; the outpost wears the same walls), the fuel tank and the ammunition shed, and what is
// left of them. The shadow masks among these numbers are not drawn here.

import { PAINT, STEEL, hash } from '../kit.mjs';
import { CONCRETE, PANE, PIT, WOOD, beam, broken, canvas, cloud, dim, grey, rubble, shard, tones } from '../masonry.mjs';
import { rgb } from '../png.mjs';

const C = CONCRETE;
const SHADE = 0.72;
const HAZARD = [rgb(244, 208, 32), rgb(36, 36, 40)];
const CRATE = { hi: rgb(196, 160, 112), mid: rgb(160, 124, 84), lo: rgb(118, 88, 60), deep: rgb(78, 58, 40) };

// ---- factory roofs -------------------------------------------------------------------------------------------

/** A concrete roof with a raised kerb: the start of all three. */
function slab() {
  return canvas(32, 32).raised(0, 0, 31, 31, tones(154)).frame(1, 1, 30, 30, grey(148), grey(132)).frame(2, 2, 29, 29, C.lo, C.hi);
}

/** A skylight: glass in a steel rim. */
function skylight(cv, x, y) {
  cv.rect(x, y, x + 5, y + 5, PANE.mid).frame(x, y, x + 5, y + 5, PANE.lo, PANE.hi).rect(x + 1, y + 1, x + 2, y + 2, PANE.hi);
}

function roofDoors(p) {
  const cv = slab();
  for (const x of [4, 17]) cv.raised(x, 5, x + 10, 26, p).rect(x + 2, 8, x + 8, 9, p.lo).rect(x + 5, 12, x + 5, 23, p.lo);
  return cv.img;
}

function roofSkylights(p) {
  const cv = slab();
  for (const x of [4, 17]) {
    cv.raised(x, 4, x + 10, 27, p);
    skylight(cv, x + 3, 7);
    skylight(cv, x + 3, 18);
  }
  return cv.img;
}

function roofPlant(p) {
  const cv = slab();
  for (const y of [9, 10]) cv.rect(6, y, 17, y, y === 9 ? PANE.hi : PANE.lo);
  cv.rect(6, 9, 7, 25, PANE.mid).rect(6, 9, 6, 25, PANE.hi).rect(22, 19, 23, 26, PANE.mid);
  cv.raised(14, 6, 25, 18, p);
  skylight(cv, 17, 9);
  cv.raised(4, 24, 12, 27, tones(150)).raised(18, 24, 27, 27, tones(150));
  return cv.img;
}

// ---- factory walls -------------------------------------------------------------------------------------------

/** A window let into the wall: dark glass, or lit. */
function pane(cv, x0, y0, x1, y1, lit) {
  cv.sunk(x0, y0, x1, y1, C, grey(84));
  if (lit) cv.rect(x0 + 2, y0 + 2, x0 + 3, y1 - 2, PANE.hi).rect(x0 + 4, y0 + 3, x0 + 4, y1 - 2, PANE.mid);
  else cv.rect(x0 + 1, y0 + 1, x1 - 1, y0 + 1, grey(60));
}

/** The upper wall every factory wall shares: two windows over a painted, riveted band. */
function upper(p) {
  const cv = canvas(32, 32, C.mid);
  cv.rect(0, 0, 31, 0, C.hi).rect(0, 31, 31, 31, C.lo);
  pane(cv, 4, 3, 12, 9, false);
  pane(cv, 19, 3, 27, 9, false);
  cv.rect(0, 13, 31, 17, p.mid).rect(0, 13, 31, 13, p.hi).rect(0, 17, 31, 17, p.deep);
  for (const x of [5, 15, 26]) cv.set(x, 15, p.hi).set(x + 1, 15, p.deep);
  return cv;
}

function wallLights(p) {
  const cv = upper(p);
  for (const x of [2, 12, 22]) pane(cv, x, 21, x + 7, 28, true);
  return cv.img;
}

function wallPanels(p) {
  const cv = upper(p);
  for (const x of [3, 18]) cv.sunk(x, 21, x + 10, 28, C);
  return cv.img;
}

function wallDoor(p) {
  const cv = upper(p);
  cv.raised(4, 11, 13, 31, tones(146));
  cv.rect(6, 20, 11, 31, p.lo).frame(6, 20, 11, 31, p.deep, p.deep).rect(7, 21, 10, 21, p.mid).rect(7, 22, 7, 30, p.mid);
  cv.set(10, 26, STEEL.hi).rect(8, 15, 9, 16, PANE.hi).rect(8, 17, 9, 17, PANE.lo);
  pane(cv, 19, 21, 27, 28, true);
  return cv.img;
}

function wallRoller(p) {
  const cv = upper(p);
  cv.raised(6, 12, 25, 31, tones(170));
  for (let y = 14; y <= 31; y++) cv.rect(8, y, 23, y, y % 3 === 0 ? p.deep : y % 3 === 1 ? p.hi : p.mid);
  cv.rect(8, 14, 8, 31, p.deep).rect(23, 14, 23, 31, p.deep).rect(14, 29, 17, 29, STEEL.hi);
  return cv.img;
}

/** A wall blown in: ragged concrete round the dark inside, bent girders, rubble at the foot. */
function wallHole() {
  const cv = canvas(32, 32, C.mid);
  cv.rect(0, 0, 31, 0, C.hi);
  cv.each((c, x, y) => {
    const edge = 3 + cloud(x, y, 5, 81) * 5;
    const reach = Math.min(x + 1, 32 - x, y + 1, 40 - y);
    if (reach > edge) return hash(x, y, 83) < 0.18 ? grey(52) : grey(34);
    return reach > edge - 1 ? C.lo : hash(x, y, 85) < 0.1 ? C.lo : c;
  });
  cv.rect(3, 15, 28, 16, grey(70));
  beam(cv, 6, 5, 13, 5, PANE, 2);
  beam(cv, 6, 5, 6, 12, PANE, 2);
  beam(cv, 14, 28, 26, 18, PANE, 2);
  beam(cv, 20, 4, 25, 12, tones(96), 1);
  const heap = canvas(32, 16);
  rubble(heap, 87, 12, 1.4, 3, { margin: 0, v: 110 });
  for (let y = 22; y < 32; y++) for (let x = 0; x < 32; x++) cv.set(x, y, heap.get(x, Math.floor((y - 22) * 1.5)));
  return cv.img;
}

/** The pad a factory stands on. */
function pad() {
  const cv = canvas(32, 32);
  cv.raised(2, 2, 29, 29, tones(140)).frame(4, 4, 27, 27, grey(96), grey(96)).frame(5, 5, 26, 26, grey(120), grey(160));
  cv.each((c, x, y) => (Math.min(x, y, 31 - x, 31 - y) > 6 ? 0 : c));
  return cv.img;
}

/** What an outpost leaves: a dark heap with its girders in it. */
function outpostWreck() {
  const cv = canvas(32, 32);
  rubble(cv, 91, 14, 1.2, 2.8, { margin: 2, v: 96 });
  cv.frame(11, 10, 20, 19, grey(70), grey(110));
  beam(cv, 3, 6, 13, 13, tones(84), 1);
  beam(cv, 17, 22, 26, 15, WOOD, 1);
  beam(cv, 14, 13, 18, 17, WOOD, 2);
  return cv.img;
}

// ---- fuel tank -----------------------------------------------------------------------------------------------

/** One of the tank's eight plates: steel with the side's painted band round it, some carrying the fuel mark. */
function tankPlate(p, mark) {
  const cv = canvas(8, 32, grey(170));
  cv.rect(0, 0, 0, 31, grey(196)).rect(7, 0, 7, 31, grey(138)).rect(0, 0, 7, 0, grey(206)).rect(0, 31, 7, 31, grey(120));
  cv.rect(0, 9, 7, 21, p.mid).rect(0, 9, 7, 9, p.hi).rect(0, 21, 7, 21, p.deep).rect(7, 10, 7, 20, p.lo);
  if (mark) cv.disc(4, 15.5, 3.2, p.deep).disc(4, 15.5, 2.1, p.hi).disc(4, 15.5, 1, p.deep);
  for (const y of [4, 26]) cv.rect(0, y, 7, y, grey(140));
  return cv.img;
}

/** The tank's eight-sided lid: plates meeting at a hub. */
function tankLid() {
  const cv = canvas(32, 32);
  cv.each((c, x, y) => {
    const dx = Math.abs(x - 15.5);
    const dy = Math.abs(y - 15.5);
    if (dx + dy > 22.5) return 0;
    if (dx + dy > 21 || dx > 15 || dy > 15) return grey(130);
    if (dx < 1.5 || dy < 1.5) return grey(130);
    return x - y > 0 ? grey(178) : grey(160);
  });
  cv.disc(16, 16, 5.5, grey(130)).disc(16, 16, 4.2, grey(112));
  return cv.img;
}

/** The filler cap on the lid. */
function tankCap() {
  const cv = canvas(16, 16);
  cv.disc(8, 8, 7.6, grey(150)).disc(8, 8, 6.4, grey(196)).disc(8, 8, 3.6, PANE.lo).disc(8, 8, 2.6, PANE.mid).set(7, 7, PANE.hi);
  return cv.img;
}

/** A burst tank, four ways: torn plates, bent pipe and a drift of ash. */
function tankWreck(look) {
  const cv = canvas(32, 32);
  const seed = 101 + look * 9;
  const ash = canvas(32, 32);
  rubble(ash, seed, 9, 1.4, 3, { margin: 0, v: 138 });
  for (let y = 24; y < 32; y++) for (let x = 0; x < 32; x++) cv.set(x, y, ash.get(x, y - 20 + ((x * 7 + look * 5) % 3)));
  for (let i = 0; i < 3; i++) {
    const x = 4 + Math.floor(hash(i, 1, seed) * 22);
    const y = 3 + Math.floor(hash(i, 2, seed) * 16);
    const dx = Math.floor(hash(i, 3, seed) * 9) - 4;
    beam(cv, x, y, x + dx, y + 5 - Math.abs(dx), i === 0 ? PANE : tones(120), i === 0 ? 2 : 1);
  }
  for (let i = 0; i < 5; i++) cv.set(3 + Math.floor(hash(i, 4, seed) * 26), 2 + Math.floor(hash(i, 5, seed) * 20), i & 1 ? PANE.hi : grey(170));
  shard(cv, 8 + look * 5, 14 + (look & 1) * 5, 2.4, seed + 1, PANE);
  return cv.img;
}

// ---- ammunition shed -----------------------------------------------------------------------------------------

/** The shed's roof: a painted sheet rising to a point, each quarter in its own light. */
function shedRoof(p) {
  const cv = canvas(32, 32);
  cv.each((c, x, y) => {
    const dx = x - 15.5;
    const dy = y - 15.5;
    if (Math.abs(Math.abs(dx) - Math.abs(dy)) < 1) return p.deep;
    const fold = hash((x + y) >> 2, (x - y + 64) >> 2, 111) < 0.2;
    if (Math.abs(dy) > Math.abs(dx)) return dy < 0 ? (fold ? p.mid : p.hi) : fold ? p.deep : p.lo;
    return dx < 0 ? (fold ? p.hi : p.mid) : fold ? p.lo : p.mid;
  });
  cv.frame(0, 0, 31, 31, p.hi, p.deep);
  return cv.img;
}

/** A crate. */
function crate(cv, x, y, w, h) {
  cv.rect(x, y, x + w - 1, y + h - 1, CRATE.mid).frame(x, y, x + w - 1, y + h - 1, CRATE.hi, CRATE.deep);
  cv.rect(x + 1, y + (h >> 1), x + w - 2, y + (h >> 1), CRATE.lo);
}

/** The shed's open side: the roof beam, and crates stacked along the foot. */
function shedSide(p) {
  const cv = canvas(32, 16);
  cv.rect(0, 2, 31, 3, p.mid).rect(0, 2, 31, 2, p.hi).rect(0, 4, 31, 4, p.deep);
  for (const x of [2, 9, 16]) crate(cv, x, 10, 6, 6);
  return cv.img;
}

/** The shed's back: boards in a timber frame, a painted panel with a vent. */
function shedBack(p) {
  const cv = canvas(32, 16, WOOD.mid);
  cv.each((c, x, y) => (y % 4 === 3 ? WOOD.lo : c));
  cv.frame(0, 0, 31, 15, WOOD.hi, WOOD.deep).rect(1, 1, 1, 14, WOOD.lo).rect(30, 1, 30, 14, WOOD.lo);
  cv.rect(3, 3, 28, 9, p.mid).frame(3, 3, 28, 9, p.hi, p.deep).rect(12, 6, 19, 7, PIT).rect(12, 8, 19, 8, p.lo);
  return cv.img;
}

/** The shed's front: the beam on its two posts, a big crate each side of the way in. */
function shedFront(p) {
  const cv = canvas(32, 16);
  cv.rect(0, 2, 31, 3, p.mid).rect(0, 2, 31, 2, p.hi).rect(0, 4, 31, 4, p.deep);
  cv.rect(0, 0, 1, 15, WOOD.mid).rect(0, 0, 0, 15, WOOD.hi).rect(30, 0, 31, 15, WOOD.mid).rect(31, 0, 31, 15, WOOD.deep);
  crate(cv, 3, 8, 9, 8);
  crate(cv, 20, 8, 9, 8);
  return cv.img;
}

/** A blown-up shed: its hazard strip, split crates and torn sheet. */
function shedWreck(p) {
  const cv = canvas(32, 32);
  cv.rect(4, 26, 27, 30, (x, y) => (hash(x, y, 121) < 0.12 ? 0 : HAZARD[((x + y) >> 2) & 1]));
  rubble(cv, 123, 8, 1.2, 2.6, { margin: 2, v: 124 });
  beam(cv, 5, 20, 16, 9, CRATE, 2);
  beam(cv, 17, 22, 27, 19, WOOD, 1);
  shard(cv, 7, 7, 3.2, 125, p);
  shard(cv, 24, 8, 3, 126, p);
  shard(cv, 20, 15, 2, 127, p);
  return cv.img;
}

export function draw(put) {
  PAINT.forEach((p, side) => {
    put(938 + side, roofDoors(p));
    put(940 + side, roofSkylights(p));
    put(942 + side, roofPlant(p));
    // Each wall in the light, then on the building's shaded side.
    [wallDoor, wallLights, wallPanels, wallRoller, wallHole].forEach((wall, i) => {
      put(944 + i * 4 + side, wall(p));
      put(946 + i * 4 + side, dim(wall(p), SHADE));
    });
    // The tank's plates, from the one facing the viewer round to the far side.
    [[1036, 1, true], [1032, 0.92, true], [1038, 0.84, false], [1028, 0.76, true], [1030, 0.64, false], [1034, 0.56, false]]
      .forEach(([cel, light, mark]) => put(cel + side, dim(tankPlate(p, mark), light)));
    put(1048 + side, shedRoof(p));
    put(1050 + side, shedSide(p));
    put(1052 + side, dim(shedSide(p), SHADE));
    put(1054 + side, shedBack(p));
    put(1056 + side, shedFront(p));
    put(1059 + side, shedWreck(p));
  });
  put(1040, tankLid());
  put(1041, tankCap());
  for (let look = 0; look < 4; look++) put(1044 + look, tankWreck(look));
  put(1064, pad());
  put(1939, outpostWreck());
}
