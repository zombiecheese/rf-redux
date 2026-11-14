// The bunker screen: sky, clouds and the ground cut away, the lift shaft with its four bays, the lift, the dark
// doorway and running lights of the chosen bay, and each vehicle parked side on (bunker.ts lays them out). The
// spotlight is a light sprite and is not drawn here.

import { GLASS, PAINT, STEEL, hash } from '../kit.mjs';
import { canvas, cloud, grey } from '../masonry.mjs';
import { rgb } from '../png.mjs';

// The sky is the colour the game fills the view with before it draws these.
const SKY = rgb(87, 168, 179);
const EARTH = [rgb(128, 88, 50), rgb(106, 70, 40), rgb(84, 54, 32), rgb(150, 108, 64)];
const TURF = [rgb(112, 132, 62), rgb(88, 108, 50)];
const WELL = [rgb(22, 24, 54), rgb(36, 40, 86), rgb(14, 15, 36)];
const HAZARD = [rgb(244, 208, 32), rgb(36, 36, 40)];
const LAMP = [rgb(252, 150, 26), rgb(214, 40, 28)];

// ---- ground and sky ------------------------------------------------------------------------------------------

/** Earth: mottled, with a few stones. */
const earth = (seed) => (x, y) => {
  const t = cloud(x, y, 5, seed) * 0.6 + hash(x, y, seed + 1) * 0.4;
  return hash(x >> 1, y >> 1, seed + 2) < 0.03 ? EARTH[3] : EARTH[t > 0.62 ? 0 : t > 0.36 ? 1 : 2];
};

const dirt = (seed) => canvas(32, 32, earth(seed)).img;

// Where the ground's top is across a strip 64 wide: 20 at both ends so strips join, a low rise between.
const rise = (x) => 20 - Math.round(((16 * x * (63 - x)) / (63 * 63)) * (0.6 + 0.4 * cloud(x, 0, 9, 5)));

/** The skyline: sky over turf over earth. */
function horizon() {
  const cv = canvas(64, 32, SKY);
  return cv.each((c, x, y) => (y < rise(x) ? c : y < rise(x) + 2 ? TURF[hash(x, y, 7) < 0.5 ? 0 : 1] : earth(11)(x, y))).img;
}

/** The skyline over the shaft: the lift's hatch lying shut in the ground, striped. */
function liftDoor() {
  const cv = canvas(64, 32, SKY);
  cv.each((c, x, y) => (y < 20 ? c : y < 22 && (x < 5 || x > 58) ? TURF[x & 1] : earth(13)(x, y)));
  cv.rect(6, 20, 57, 22, (x, y) => HAZARD[((x + y) >> 2) & 1]).rect(6, 23, 57, 24, grey(96)).rect(6, 23, 57, 23, grey(150));
  return cv.img;
}

/** A bank of cloud. */
function clouds(seed, many) {
  const cv = canvas(64, 32);
  for (let k = 0; k < many; k++) {
    const cx = 8 + hash(k, 1, seed) * 48;
    const cy = 8 + hash(k, 2, seed) * 16;
    const r = 5 + hash(k, 3, seed) * 6;
    for (let y = Math.floor(cy - r * 0.8); y <= cy + r * 0.8; y++) {
      for (let x = Math.floor(cx - r * 1.6); x <= cx + r * 1.6; x++) {
        const d = ((x - cx) / (r * 1.6)) ** 2 + ((y - cy) / (r * 0.8)) ** 2 + (cloud(x, y * 2, 4, seed + 4) - 0.5) * 0.7;
        if (d < 1 && y <= cy + 1) cv.set(x, y, y < cy - r * 0.3 ? rgb(196, 234, 236) : rgb(150, 212, 218));
      }
    }
  }
  return cv.img;
}

// ---- shaft and lift ------------------------------------------------------------------------------------------

/** One bay off the shaft: a steel room with a shutter at the back, a lamp over it, and the ledge a vehicle stands on. */
function bay(cv, x0, y0, left) {
  const x1 = x0 + 37;
  const y1 = y0 + 27;
  cv.rect(x0 - 2, y0 - 2, x1 + 2, y1, grey(74)).rect(x0, y0, x1, y1, grey(40));
  cv.rect(x0 - 2, y0 - 2, x1 + 2, y0 - 2, grey(110));
  // The shutter and its slats.
  const sx = left ? x0 + 4 : x0 + 6;
  cv.rect(sx, y0 + 6, sx + 27, y1 - 1, grey(54)).frame(sx, y0 + 6, sx + 27, y1 - 1, grey(72), grey(30));
  for (let y = y0 + 10; y < y1 - 2; y += 5) cv.rect(sx + 2, y, sx + 25, y, grey(34));
  cv.rect(x0 + 16, y0 + 1, x0 + 21, y0 + 2, rgb(96, 104, 170)).rect(x0 + 17, y0 + 1, x0 + 20, y0 + 1, rgb(160, 170, 226));
  // The ledge, and the lug that bolts the bay to the rock.
  cv.rect(x0 - 3, y1 + 1, x1 + 3, y1 + 4, grey(104)).rect(x0 - 3, y1 + 1, x1 + 3, y1 + 1, grey(140));
  for (let x = x0; x < x1; x += 6) cv.rect(x, y1 + 3, x + 2, y1 + 3, grey(60));
  const lx = left ? x0 - 9 : x1 + 4;
  cv.rect(lx, y0 + 4, lx + 4, y0 + 24, grey(84)).frame(lx, y0 + 4, lx + 4, y0 + 24, grey(112), grey(56)).rect(lx + 2, y0 + 10, lx + 2, y0 + 18, grey(50));
}

/** The shaft: a deep well with a toothed rail down it, two bays each side. */
function shaft() {
  const cv = canvas(132, 123);
  cv.rect(48, 16, 87, 122, grey(84)).rect(50, 18, 85, 122, WELL[0]);
  cv.rect(50, 18, 55, 122, WELL[1]).rect(80, 18, 85, 122, WELL[1]).rect(56, 18, 57, 122, WELL[2]).rect(78, 18, 79, 122, WELL[2]);
  cv.rect(48, 16, 87, 16, grey(120));
  for (const y0 of [46, 84]) {
    bay(cv, 12, y0, true);
    bay(cv, 86, y0, false);
  }
  cv.rect(66, 18, 69, 116, grey(78)).rect(66, 18, 66, 116, grey(104));
  for (let y = 21; y < 114; y += 6) cv.rect(67, y, 68, y + 2, grey(34));
  // The sump at the foot of the well.
  for (let k = 0; k < 4; k++) cv.rect(52 + k * 3, 113 + k * 2, 83 - k * 3, 114 + k * 2, k & 1 ? WELL[1] : rgb(52, 58, 112));
  cv.rect(63, 117, 72, 122, WELL[2]);
  return cv.img;
}

/** The lift's platform, on the head of its column. */
function liftTop() {
  const cv = canvas(32, 6);
  for (let y = 0; y < 4; y++) cv.rect(1 + y, y, 30 - y, y, y === 0 ? grey(150) : y === 3 ? grey(70) : grey(104));
  cv.rect(11, 4, 20, 5, grey(84)).rect(11, 4, 11, 5, grey(120));
  return cv.img;
}

/** A length of the lift's column. */
function liftColumn() {
  return canvas(32, 6).rect(12, 0, 18, 5, grey(96)).rect(12, 0, 13, 5, grey(132)).rect(18, 0, 18, 5, grey(60)).img;
}

/** The chosen bay's open doorway: a dark arch. */
function doorway() {
  const cv = canvas(32, 27);
  return cv.each((c, x, y) => (((x - 15.5) / 15) ** 2 + ((26.5 - y) / 18) ** 2 <= 1 ? (((x - 15.5) / 13) ** 2 + ((26.5 - y) / 16) ** 2 <= 1 ? grey(30) : grey(52)) : 0)).img;
}

/** The running lights: lamps fifteen apart, stepping along by five a frame. */
function runningLights(frame) {
  const cv = canvas(35, 2);
  for (let x = 1 + frame * 5; x < 34; x += 15) cv.rect(x, 0, x + 1, 0, LAMP[0]).rect(x + 2, 0, x + 2, 1, LAMP[1]).rect(x, 1, x + 1, 1, LAMP[1]);
  return cv.img;
}

// ---- parked vehicles (64 x 32, drawn at half size) -------------------------------------------------------------

/** The platform a parked vehicle stands on. */
function parked(drawOn) {
  const cv = canvas(64, 32);
  cv.rect(0, 27, 63, 31, grey(150)).rect(0, 27, 63, 27, grey(196)).rect(0, 29, 63, 29, grey(96));
  drawOn(cv);
  return cv.img;
}

const wheel = (cv, x, y, r) => cv.disc(x, y, r, STEEL.deep).disc(x, y, r - 1.2, STEEL.lo).disc(x, y, r - 2.4, STEEL.hi);

const tank = (p) => parked((cv) => {
  cv.rect(5, 10, 26, 11, STEEL.mid).rect(5, 10, 26, 10, STEEL.hi).rect(3, 9, 5, 12, STEEL.lo);
  cv.rect(25, 7, 43, 14, p.mid).rect(25, 7, 43, 7, p.hi).rect(25, 14, 43, 14, p.deep).rect(44, 9, 46, 13, p.lo).rect(33, 5, 38, 6, p.lo);
  cv.rect(10, 15, 55, 19, p.mid).rect(10, 15, 55, 15, p.hi).rect(10, 19, 55, 19, p.deep).rect(8, 17, 9, 19, p.lo).rect(56, 16, 57, 19, p.lo);
  cv.rect(11, 20, 54, 26, STEEL.deep).rect(9, 21, 10, 25, STEEL.deep).rect(55, 21, 56, 25, STEEL.deep);
  for (let x = 14; x <= 52; x += 7.6) wheel(cv, x, 23.5, 3);
});

const jeep = (p) => parked((cv) => {
  cv.line(30, 10, 27, 17, GLASS.mid).line(31, 10, 28, 17, GLASS.hi);
  cv.rect(16, 17, 48, 22, p.mid).rect(16, 17, 48, 17, p.hi).rect(16, 22, 48, 22, p.deep).rect(14, 19, 15, 21, p.lo).rect(49, 18, 50, 21, p.lo);
  cv.rect(34, 13, 37, 16, p.lo).rect(41, 14, 47, 16, p.lo).rect(47, 12, 48, 16, p.deep).rect(16, 15, 26, 16, p.mid).rect(16, 15, 26, 15, p.hi);
  wheel(cv, 22, 23.5, 3.6);
  wheel(cv, 43, 23.5, 3.6);
});

const asv = (p) => parked((cv) => {
  cv.rect(20, 5, 40, 8, p.lo).rect(20, 5, 40, 5, p.mid).rect(41, 6, 46, 7, GLASS.lo).rect(47, 6, 48, 7, GLASS.mid);
  cv.rect(9, 9, 49, 21, p.mid).rect(9, 9, 49, 9, p.hi).rect(9, 21, 49, 21, p.deep).rect(9, 9, 9, 21, p.hi);
  for (let x = 14; x <= 44; x += 10) cv.rect(x, 12, x + 6, 18, p.lo).frame(x, 12, x + 6, 18, p.deep, p.hi);
  cv.rect(50, 13, 57, 21, p.mid).rect(50, 13, 57, 13, p.hi).rect(52, 14, 56, 17, GLASS.mid).rect(52, 14, 56, 14, GLASS.hi).rect(58, 18, 59, 21, p.lo);
  for (let x = 13; x <= 55; x += 8.4) wheel(cv, x, 23.5, 3);
});

const heli = (p) => parked((cv) => {
  cv.rect(16, 5, 62, 5, STEEL.mid).rect(16, 6, 62, 6, STEEL.deep).rect(38, 6, 40, 9, STEEL.lo);
  cv.rect(6, 14, 28, 16, p.mid).rect(6, 14, 28, 14, p.hi).rect(5, 7, 8, 15, p.lo).rect(5, 6, 8, 8, rgb(236, 40, 34)).rect(3, 9, 4, 13, STEEL.mid);
  for (let y = 10; y <= 22; y++) {
    const half = Math.round(14 * Math.sqrt(1 - ((y - 16) / 6.5) ** 2));
    cv.rect(41 - half, y, 41 + half, y, y < 12 ? p.hi : y > 19 ? p.deep : p.mid);
  }
  cv.rect(46, 12, 53, 17, GLASS.mid).rect(46, 12, 53, 12, GLASS.hi).rect(50, 13, 50, 17, p.lo).rect(54, 14, 55, 17, GLASS.lo);
  cv.rect(30, 21, 40, 22, rgb(250, 214, 48)).rect(41, 21, 43, 22, rgb(236, 40, 34));
  cv.rect(32, 23, 32, 25, STEEL.lo).rect(48, 23, 48, 25, STEEL.lo).rect(28, 26, 53, 26, STEEL.hi);
});

export function draw(put) {
  put(2075, shaft());
  put(2076, liftTop());
  put(2078, doorway());
  put(2079, liftColumn());
  for (let i = 0; i < 4; i++) put(2080 + i, dirt(21 + i * 5));
  put(2084, liftDoor());
  put(2085, horizon());
  put(2087, clouds(41, 3));
  put(2088, clouds(43, 6));
  for (let i = 0; i < 3; i++) put(2091 + i, runningLights(i));
  PAINT.forEach((p, side) => {
    put(2094 + side, tank(p));
    put(2096 + side, jeep(p));
    put(2098 + side, asv(p));
    put(2100 + side, heli(p));
  });
}
