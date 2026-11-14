// The town: the houses (three roofs, and walls with a door, an open doorway, windows, a cooling unit or a hole
// blown through), the hospital, and the rubble they leave. The shadow masks among these numbers are not drawn
// here.

import { PAINT, STEEL, WHITE, hash } from '../kit.mjs';
import { CONCRETE, PANE, PIT, WOOD, beam, broken, canvas, cloud, dim, grey, rubble, shard, tones } from '../masonry.mjs';
import { image, rgb } from '../png.mjs';

const C = CONCRETE;
const DECK = { hi: rgb(142, 102, 64), mid: rgb(114, 80, 50), lo: rgb(88, 60, 38) };
const SHEET = { hi: rgb(164, 170, 194), mid: rgb(130, 136, 164), lo: rgb(98, 104, 134) };
const NIGHT = [rgb(18, 28, 58), rgb(10, 16, 36)];
const AID = [rgb(20, 150, 116), rgb(12, 108, 84)];
const SHADE = 0.7;

// ---- house roofs ---------------------------------------------------------------------------------------------

/** A flat concrete roof with two painted hatches, and a painted awning along the front. */
function roofHatches(p) {
  const cv = canvas(32, 32).raised(0, 0, 31, 22, tones(172));
  cv.sunk(3, 3, 28, 19, tones(160), grey(160));
  for (const x of [9, 17]) cv.raised(x, 8, x + 5, 13, p).rect(x + 2, 10, x + 3, 11, p.lo);
  cv.rect(0, 23, 31, 31, p.mid).rect(0, 23, 31, 23, p.hi).rect(0, 31, 31, 31, p.deep).rect(0, 24, 0, 30, p.hi).rect(31, 24, 31, 30, p.lo);
  for (const x of [4, 10, 16, 22, 28]) cv.set(x, 27, STEEL.hi).set(x, 28, p.deep);
  return cv.img;
}

/** A painted kerb round a tarred deck: the start of the other two roofs. */
function deck(p) {
  const cv = canvas(32, 32, DECK.mid);
  cv.each((c, x, y) => (y % 6 === 3 ? DECK.lo : hash(x, y, 11) < 0.05 ? DECK.hi : c));
  cv.frame(0, 0, 31, 31, p.hi, p.lo).frame(1, 1, 30, 30, p.mid, p.mid).frame(2, 2, 29, 29, p.deep, DECK.hi);
  return cv;
}

/** A pipe along a run of points, lit along one edge. */
function pipe(cv, points, t = STEEL) {
  for (let i = 1; i < points.length; i++) cv.line(points[i - 1][0], points[i - 1][1] + 1, points[i][0], points[i][1] + 1, t.lo);
  for (let i = 1; i < points.length; i++) cv.line(...points[i - 1], ...points[i], t.hi);
}

/** The deck with two tanks and the pipes between them. */
function roofTanks(p) {
  const cv = deck(p);
  pipe(cv, [[6, 7], [25, 7], [25, 24], [9, 24]]);
  for (const y of [11, 17]) cv.rect(8, y, 20, y + 3, STEEL.mid).rect(8, y, 20, y, STEEL.hi).rect(8, y + 3, 20, y + 3, STEEL.lo).rect(13, y, 13, y + 3, STEEL.lo);
  pipe(cv, [[21, 13], [25, 13]]);
  pipe(cv, [[21, 19], [25, 19]]);
  cv.rect(5, 23, 8, 26, PANE.mid).frame(5, 23, 8, 26, PANE.hi, PANE.lo);
  for (const [x, y] of [[5, 5], [26, 5], [5, 28], [26, 28]]) cv.set(x, y, STEEL.hi);
  return cv.img;
}

/** The deck with two cooling units piped to a junction box. */
function roofCoolers(p) {
  const cv = deck(p);
  pipe(cv, [[9, 17], [9, 23], [13, 23]]);
  pipe(cv, [[22, 17], [22, 23], [18, 23]]);
  for (const x of [5, 18]) {
    cv.raised(x, 5, x + 8, 16, tones(150)).sunk(x + 2, 7, x + 6, 13, tones(140), grey(96));
    cv.rect(x + 3, 9, x + 5, 11, grey(70));
  }
  cv.raised(13, 20, 18, 26, PANE).rect(15, 22, 16, 24, PANE.hi);
  return cv.img;
}

// ---- house walls ---------------------------------------------------------------------------------------------

/** A painted wall, lit along the eave and dark at the foot. */
function plain(p) {
  return canvas(32, 16, p.mid).rect(0, 0, 31, 0, p.hi).rect(0, 1, 31, 1, p.lo).rect(0, 15, 31, 15, p.deep);
}

/** A tall window with a sill. */
function tall(cv, p, x) {
  cv.rect(x, 4, x + 1, 10, PIT).rect(x - 1, 3, x + 2, 3, p.deep).rect(x - 1, 11, x + 2, 11, p.hi).set(x, 5, PANE.lo);
}

function wallDoor(p) {
  const cv = plain(p);
  cv.rect(4, 3, 11, 15, p.deep).rect(5, 4, 10, 15, WOOD.mid).rect(5, 4, 5, 15, WOOD.hi).rect(10, 4, 10, 15, WOOD.lo);
  cv.rect(6, 6, 9, 8, WOOD.lo).set(9, 11, STEEL.hi).rect(3, 15, 12, 15, C.hi);
  tall(cv, p, 17);
  tall(cv, p, 24);
  return cv.img;
}

function wallWindows(p) {
  const cv = plain(p);
  for (const x of [4, 11, 19, 26]) tall(cv, p, x);
  return cv.img;
}

function wallCooler(p) {
  const cv = plain(p);
  tall(cv, p, 4);
  tall(cv, p, 26);
  cv.rect(17, 2, 18, 8, PANE.mid).rect(17, 2, 17, 8, PANE.hi);
  cv.raised(10, 8, 21, 15, tones(160));
  for (const x of [12, 17]) cv.rect(x, 10, x + 2, 12, grey(70)).set(x + 1, 11, grey(120));
  return cv.img;
}

function wallOpen(p) {
  const cv = plain(p);
  tall(cv, p, 3);
  tall(cv, p, 27);
  cv.rect(8, 3, 23, 15, p.lo).frame(8, 3, 23, 15, p.hi, p.deep).rect(10, 5, 21, 15, WOOD.deep);
  cv.rect(10, 12, 21, 15, WOOD.lo).rect(13, 9, 18, 10, WOOD.mid).rect(13, 9, 18, 9, WOOD.hi);
  return cv.img;
}

/** A wall with a hole blown through it: the dark inside, a window frame left hanging, rubble at the foot. */
function wallHole(p) {
  const cv = plain(p);
  cv.each((c, x, y) => {
    const edge = 2.5 + cloud(x, y, 4, 41) * 4 + (x < 4 || x > 27 ? 3 : 0);
    const reach = Math.min(x + 1, 32 - x, y + 2);
    return reach > edge ? (hash(x, y, 43) < 0.2 ? NIGHT[1] : NIGHT[0]) : c;
  });
  cv.line(20, 5, 20, 14, WOOD.mid).line(15, 9, 26, 9, WOOD.mid).line(15, 8, 26, 8, WOOD.hi);
  cv.line(4, 6, 10, 9, PANE.lo);
  const heap = canvas(32, 16);
  rubble(heap, 45, 11, 1.2, 2.4, { margin: 0, v: 120 });
  for (let y = 11; y < 16; y++) for (let x = 0; x < 32; x++) cv.set(x, y, heap.get(x, (y - 11) * 3));
  return cv.img;
}

// ---- hospital ------------------------------------------------------------------------------------------------

/** A window with a white frame and a box of flowers under it. */
function boxed(cv, p, x, y) {
  cv.rect(x, y, x + 4, y + 4, p.hi).rect(x + 1, y + 1, x + 3, y + 3, PIT).set(x + 2, y + 1, PANE.lo);
  cv.rect(x, y + 5, x + 4, y + 5, p.deep).set(x + 1, y + 5, rgb(236, 120, 60)).set(x + 3, y + 5, rgb(236, 120, 60));
}

/** The hospital's short wall, under the eave. */
function wardEnd(p) {
  const cv = canvas(16, 16, p.mid);
  cv.rect(0, 0, 15, 1, p.deep).rect(0, 2, 15, 2, p.lo).rect(0, 15, 15, 15, p.deep);
  boxed(cv, p, 2, 6);
  boxed(cv, p, 9, 6);
  return cv.img;
}

// Where the roof meets a long wall: the ridge sits left of the middle and the far eave is the lower one.
const gable = (x) => (x <= 14 ? 5 - Math.floor((3 * x) / 14) : 2 + Math.floor((5 * (x - 14)) / 17));

/** The hospital's long wall under its gable: a door and two windows, or three windows. */
function wardSide(p, door) {
  const cv = canvas(32, 16, p.mid);
  cv.rect(0, 15, 31, 15, p.deep);
  if (door) {
    cv.rect(4, 6, 10, 15, p.deep).rect(5, 7, 9, 15, WOOD.mid).rect(5, 7, 5, 15, WOOD.hi).set(8, 11, STEEL.hi).rect(3, 15, 11, 15, C.hi);
    cv.rect(6, 8, 8, 9, PANE.lo);
  } else {
    boxed(cv, p, 4, 8);
  }
  boxed(cv, p, 14, 8);
  boxed(cv, p, 23, 8);
  cv.each((c, x, y) => (y < gable(x) ? 0 : y === gable(x) ? p.hi : y === gable(x) + 1 ? p.lo : c));
  return cv.img;
}

function mirrored(img) {
  const out = image(img.w, img.h);
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) out.px[y * img.w + x] = img.px[y * img.w + img.w - 1 - x];
  return out;
}

/** A slope of the hospital's sheet roof; the big one carries a first-aid sign. */
function wardRoof(w, sign) {
  const cv = canvas(w, 16, SHEET.mid);
  cv.each((c, x, y) => (x % 6 === 2 ? SHEET.lo : x % 6 === 3 ? SHEET.hi : y === 0 ? SHEET.hi : y === 15 ? SHEET.lo : c));
  if (sign) {
    cv.rect(10, 2, 21, 13, AID[0]).frame(10, 2, 21, 13, WHITE, AID[1]);
    cv.rect(15, 4, 16, 11, WHITE).rect(12, 7, 19, 8, WHITE);
  }
  return cv.img;
}

// ---- ruins ---------------------------------------------------------------------------------------------------

/** A ring of broken footing: what stands of four walls. */
function footing(cv, seed, x0, y0, x1, y1) {
  const stone = broken(134, seed);
  cv.rect(x0, y0, x1, y0 + 2, stone).rect(x0, y1 - 2, x1, y1, stone).rect(x0, y0, x0 + 2, y1, stone).rect(x1 - 2, y0, x1, y1, stone);
  cv.each((c, x, y) => (c && cloud(x, y, 3, seed + 1) < 0.3 ? 0 : c));
}

function wardRuin(p) {
  const cv = canvas(32, 32);
  footing(cv, 51, 4, 5, 27, 27);
  rubble(cv, 53, 6, 1.2, 2.6, { margin: 3, v: 128 });
  cv.rect(1, 2, 6, 5, SHEET.mid).line(1, 2, 6, 2, SHEET.hi).line(2, 5, 6, 5, SHEET.lo);
  beam(cv, 12, 26, 22, 17, WOOD, 1);
  shard(cv, 23, 6, 3, 55, p);
  shard(cv, 10, 18, 2.6, 56, p);
  return cv.img;
}

/** Plain rubble, three ways: beams and torn panels, a fallen frame, or bare footings. */
function wreck(look) {
  const cv = canvas(32, 32);
  if (look === 2) footing(cv, 61, 3, 3, 28, 28);
  rubble(cv, 63 + look * 7, look === 2 ? 7 : 10, 1.1, look === 1 ? 3 : 2.4, { margin: 2, v: 132 });
  if (look === 0) {
    beam(cv, 4, 17, 11, 25, WOOD, 2);
    beam(cv, 14, 28, 24, 26, WOOD, 1);
    shard(cv, 8, 6, 2.6, 65, PAINT[0]);
    shard(cv, 24, 21, 3, 66, PAINT[0]);
    shard(cv, 20, 13, 2, 67, PAINT[0]);
  } else if (look === 1) {
    beam(cv, 6, 27, 20, 14, WOOD, 2);
    beam(cv, 19, 8, 27, 16, WOOD, 2);
    beam(cv, 8, 6, 20, 6, PAINT[0], 2);
    shard(cv, 15, 12, 2.4, 68, PAINT[0]);
  }
  return cv.img;
}

/** The pad a house stands on: a kerb with broken stone along its outside. */
function pad() {
  const cv = canvas(32, 32);
  cv.frame(3, 3, 28, 28, grey(96), grey(96)).frame(4, 4, 27, 27, grey(150), grey(118));
  rubble(cv, 71, 34, 0.8, 1.6, { margin: -1, v: 138 });
  cv.each((c, x, y) => (Math.min(x, y, 31 - x, 31 - y) > 5 ? 0 : c));
  return cv.img;
}

export function draw(put) {
  PAINT.forEach((p, side) => {
    put(909 + side, roofHatches(p));
    put(911 + side, roofTanks(p));
    put(913 + side, roofCoolers(p));
    // Each wall in the light, then on the building's shaded side.
    [wallDoor, wallWindows, wallCooler, wallOpen, wallHole].forEach((wall, i) => {
      put(915 + i * 4 + side, wall(p));
      put(917 + i * 4 + side, dim(wall(p), SHADE));
    });
    put(1012 + side, wardEnd(p));
    put(1014 + side, dim(wardEnd(p), SHADE));
    put(1016 + side, wardSide(p, true));
    put(1018 + side, dim(mirrored(wardSide(p, true)), SHADE));
    put(1020 + side, wardSide(p, false));
    put(1022 + side, dim(mirrored(wardSide(p, false)), SHADE));
    put(1884 + side, wardRuin(p));
  });
  put(1024, wardRoof(32, true));
  put(1025, wardRoof(16, false));
  put(1065, pad());
  put(1886, wreck(0));
  put(1887, wreck(1));
  put(1888, wreck(2));
}
