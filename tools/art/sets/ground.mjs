// The ground: the 32 x 32 tiles a map's terrain codes pick (sand, water, shores, deep water, grass, roads, bridge
// ends, the two bunker hatches and the walled lawn). Drawn here from scratch: every tile is a rule (a coastline, a
// set of road arms, a depth corner) run through the same few textures, so neighbours meet without seams.
//
// Whole numbers and square roots only, so every machine builds the same pack.

import { image, rgb } from '../png.mjs';

export const N = 32;

// ---- noise ---------------------------------------------------------------------------------------------------

/** A fixed pseudo-random number in [0, 1) for a pixel and a seed. */
export function hash(x, y, seed = 0) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 362437)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth noise in [0, 1): random values on a grid `cell` pixels apart, blended between; repeats every tile. */
export function smooth(x, y, cell, seed) {
  const per = N / cell;
  const gx = x / cell;
  const gy = y / cell;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const fx = gx - x0;
  const fy = gy - y0;
  const at = (i, j) => hash(((i % per) + per) % per, ((j % per) + per) % per, seed);
  const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * fx;
  const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * fx;
  return top + (bottom - top) * fy;
}

const clamp = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const ease = (t) => t * t * (3 - 2 * t);

// ---- colours -------------------------------------------------------------------------------------------------

export const SAND = [rgb(184, 136, 90), rgb(200, 160, 114), rgb(172, 128, 84)];
export const DARK_SAND = [rgb(165, 126, 82), rgb(152, 117, 77), rgb(176, 132, 88)];
const RIM = [rgb(206, 170, 124), rgb(198, 160, 114)];
export const WATER = [rgb(70, 160, 183), rgb(86, 168, 181), rgb(60, 152, 178)];
const DEEP = [rgb(50, 143, 166), rgb(58, 151, 175), rgb(40, 130, 151)];
export const SURF = [rgb(190, 188, 152), rgb(150, 190, 172), rgb(106, 177, 183)];
export const GRASS = [rgb(118, 124, 52), rgb(125, 133, 55), rgb(110, 114, 49)];
export const ROAD = rgb(129, 130, 132);
export const ROAD_FLECK = rgb(150, 151, 153);
export const KERB = [rgb(166, 167, 169), rgb(148, 149, 151)];
export const ROAD_EDGE = rgb(110, 111, 114);

// ---- textures ------------------------------------------------------------------------------------------------

/** Sand: a flat tan with light grains and the odd dark one. `dark` in 0..1 fades to the darker, packed sand. */
export function sand(x, y, dark = 0) {
  const set = hash(x, y, 11) < dark ? DARK_SAND : SAND;
  const g = hash(x, y, 12);
  return g < 0.24 ? set[1] : g > 0.93 ? set[2] : set[0];
}

/** Water: `depth` in 0..1 from the shallows to deep water, in soft ripples rather than even grains. */
function water(x, y, depth = 0) {
  const set = hash(x, y, 21) < depth ? DEEP : WATER;
  const r = smooth(x, y, 2, 22) * 0.6 + hash(x, y, 23) * 0.4;
  return r < 0.36 ? set[1] : r > 0.72 ? set[2] : set[0];
}

/** Grass in soft clumps of three greens. */
export function grass(x, y) {
  const r = smooth(x, y, 2, 31) * 0.75 + hash(x, y, 32) * 0.25;
  return r < 0.38 ? GRASS[1] : r > 0.66 ? GRASS[2] : GRASS[0];
}

// ---- shapes --------------------------------------------------------------------------------------------------

/** The tile turned clockwise by `turns` quarter turns: the base-shape pixel that lands on (x, y). */
function unturn(x, y, turns) {
  for (let i = 0; i < turns; i++) [x, y] = [y, N - 1 - x];
  return [x, y];
}

/** Distance from a point to a polygon's outline, negative inside. */
function polygon(points, px, py) {
  let best = Infinity;
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [ax, ay] = points[i];
    const [bx, by] = points[j];
    const ex = bx - ax;
    const ey = by - ay;
    const t = clamp(((px - ax) * ex + (py - ay) * ey) / (ex * ex + ey * ey));
    const dx = px - ax - ex * t;
    const dy = py - ay - ey * t;
    best = Math.min(best, dx * dx + dy * dy);
    if (ay > py !== by > py && px < ((bx - ax) * (py - ay)) / (by - ay) + ax) inside = !inside;
  }
  return inside ? -Math.sqrt(best) : Math.sqrt(best);
}

// Land outlines, running well past the tile so only the coast itself is near. Each meets the tile's sides four
// pixels in from a corner (or not at all), which is what lets any two shore tiles sit side by side.
const FAR = 60;
const COASTS = {
  // Land along the bottom, swelling up in the middle.
  beach: [[-FAR, 28], [0, 28], [8, 24], [24, 24], [32, 28], [FAR, 28], [FAR, FAR], [-FAR, FAR]],
  // Land in the bottom right half, the coast a straight diagonal.
  slant: [[-FAR, 28], [0, 28], [28, 0], [28, -FAR], [FAR, -FAR], [FAR, FAR], [-FAR, FAR]],
  // Land down the right and along the bottom, water filling the top left.
  cove: [[28, -FAR], [28, 0], [20, 8], [20, 20], [0, 28], [-FAR, 28], [-FAR, FAR], [FAR, FAR], [FAR, -FAR]],
  // Nearly all land, with water along the top and the left and round the corner between.
  point: [[4, FAR], [4, 14], [14, 4], [FAR, 4], [FAR, FAR]],
};

/** A shore tile: sand, a pale rim, surf, then water, banded by distance from the coast. */
function shore(coast, turns, flip = false) {
  return tile((x, y) => {
    const [bx, by] = unturn(x, y, turns);
    let d = polygon(COASTS[coast], bx + 0.5, by + 0.5);
    if (flip) d = -d;
    d += (smooth(x, y, 4, 41) - 0.5) * 2.2 + (hash(x, y, 42) - 0.5) * 0.9;
    if (d < -3.2) return sand(x, y);
    if (d < -1) return RIM[hash(x, y, 43) < 0.7 ? 0 : 1];
    if (d < 0.6) return SURF[0];
    if (d < 2.2) return SURF[1];
    if (d < 4.4) return SURF[2];
    return water(x, y);
  });
}

const CORNERS = { tl: [0, 0], tr: [N, 0], bl: [0, N], br: [N, N] };
const SIDES = { left: (x) => x, right: (x) => N - x, top: (x, y) => y, bottom: (x, y) => N - y };

/** 0..1: how far inside a quarter circle round a corner a pixel is, soft over `soft` pixels at the rim. */
function inCorner(x, y, corner, radius, soft) {
  const [cx, cy] = CORNERS[corner];
  const d = Math.sqrt((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2) + (smooth(x, y, 8, 51) - 0.5) * 4;
  return ease(clamp((radius + soft / 2 - d) / soft));
}

/** 0..1: how far into the half of the tile on `side` a pixel is. */
function inHalf(x, y, side, soft) {
  const d = SIDES[side](x + 0.5, y + 0.5) + (smooth(x, y, 8, 52) - 0.5) * 4;
  return ease(clamp((N / 2 + soft / 2 - d) / soft));
}

export function tile(pixel) {
  const img = image(N, N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) img.px[y * N + x] = pixel(x, y);
  return img;
}

// ---- grass edges ---------------------------------------------------------------------------------------------

const EDGE = 4.5;

/** Where grass meets sand: a ragged line with a few stray tufts on the sand side. `d` is negative on the grass. */
function turf(distance) {
  return tile((x, y) => {
    const d = distance(x + 0.5, y + 0.5) + (smooth(x, y, 4, 61) - 0.5) * 5 + (hash(x >> 1, y >> 1, 62) - 0.5) * 2.4;
    if (d < 0) return grass(x, y);
    if (d < 5 && smooth(x, y, 2, 63) > 0.8) return grass(x, y);
    return sand(x, y);
  });
}

/** Distance into the sand strip along a side (negative on the grass). */
const strip = (side) => (x, y) => EDGE - SIDES[side](x, y);

/** Grass with a rounded bite of sand out of one corner (and thin sand along both sides that meet there). */
function sandCorner(corner) {
  const [cx, cy] = CORNERS[corner];
  const r = 15;
  return (x, y) => {
    // A square of grass set EDGE in from the two sides, its corner rounded.
    const ax = Math.abs(x - cx) - EDGE - r;
    const ay = Math.abs(y - cy) - EDGE - r;
    if (ax < 0 && ay < 0) return Math.sqrt(ax * ax + ay * ay) - r;
    return -Math.min(ax, ay) - r;
  };
}

/** Sand with grass along the two sides that meet at a corner, the inside of the bend rounded. */
function grassCorner(corner) {
  const [cx, cy] = CORNERS[corner];
  const r = 9;
  return (x, y) => {
    const ax = Math.abs(x - cx) - EDGE - r;
    const ay = Math.abs(y - cy) - EDGE - r;
    if (ax < 0 && ay < 0) return r - Math.sqrt(ax * ax + ay * ay);
    return Math.min(ax, ay) + r;
  };
}

// ---- roads ---------------------------------------------------------------------------------------------------

const A = 4; // a road's sides sit this far in from the tile's
const B = N - A;

/** Whether a pixel is road, for a slab in the middle with arms out to the named sides ('n', 'e', 's', 'w'). */
export function onRoad(arms, x, y) {
  if (x < 0 || y < 0 || x >= N || y >= N) {
    // Past the tile: an arm carries on, anything else is verge.
    const cx = x < 0 ? 0 : x >= N ? N - 1 : x;
    const cy = y < 0 ? 0 : y >= N ? N - 1 : y;
    return onRoad(arms, cx, cy);
  }
  const midX = x >= A && x < B;
  const midY = y >= A && y < B;
  if (midX && midY) return true;
  if (midX && y < A) return arms.includes('n');
  if (midX && y >= B) return arms.includes('s');
  if (midY && x < A) return arms.includes('w');
  if (midY && x >= B) return arms.includes('e');
  return false;
}

/** Concrete, lit from the top right: a pale kerb on the top and right edges, a dark line on the left and bottom. */
export function concrete(arms, x, y) {
  const road = (dx, dy) => onRoad(arms, x + dx, y + dy);
  if (!road(1, 0) || !road(0, -1) || !road(1, -1)) return KERB[0];
  if (!road(2, 0) || !road(0, -2) || !road(2, -2)) return KERB[1];
  if (!road(-1, 0) || !road(0, 1) || !road(-1, 1)) return ROAD_EDGE;
  return hash(x, y, 71) < 0.035 ? ROAD_FLECK : ROAD;
}

export const road = (arms) => tile((x, y) => (onRoad(arms, x, y) ? concrete(arms, x, y) : sand(x, y)));

// ---- bridge ends ---------------------------------------------------------------------------------------------

export const PLANK = [rgb(134, 96, 66), rgb(118, 84, 58), rgb(148, 108, 74)];
export const PLANK_GAP = rgb(88, 62, 46);
export const RAIL = rgb(98, 68, 48);
export const POST = rgb(170, 128, 88);
export const BOLT = rgb(176, 178, 182);

/**
 * Where a road runs onto a timber bridge. Drawn for a road coming in from the left (planks across the bridge, a
 * rail and posts down each side) and turned for the other three.
 */
export function bridgeEnd(turns) {
  const arms = turns & 1 ? 'ns' : 'we';
  return tile((px, py) => {
    const [x, y] = unturn(px, py, turns);
    if (x < 8) return onRoad(arms, px, py) ? concrete(arms, px, py) : sand(px, py);
    if (y < 2 || y >= N - 2) return (x - 8) % 6 === 2 ? POST : sand(px, py);
    if (y < 4 || y >= N - 4) return (x - 8) % 6 === 2 ? POST : RAIL;
    const board = (x - 8) >> 2;
    if ((x - 8) % 4 === 3) return PLANK_GAP;
    if ((y === 6 || y === N - 7) && (x - 8) % 4 === 1) return BOLT;
    const grain = hash(board, y >> 2, 81);
    return grain < 0.2 ? PLANK[2] : PLANK[board & 1];
  });
}

// ---- hatches and the lawn ------------------------------------------------------------------------------------

export const YELLOW = rgb(244, 208, 32);
export const BLACK = rgb(36, 36, 40);
export const FRAME = [rgb(96, 97, 100), rgb(78, 79, 82), rgb(150, 152, 156)];
export const WALL = [rgb(160, 161, 164), rgb(128, 129, 132), rgb(100, 101, 104)];

/**
 * A bunker's lift hatch: hazard stripes, a bolted steel frame, two doors in the side's colour and an H plate.
 * The lift's own parts (tools/art/sets/lift.mjs) are cut from the same drawing: `stripes: false` leaves the
 * hazard border as plain frame, for the doors that slide apart and the platform that rises.
 */
export function hatch(door, doorShade, { stripes = true } = {}) {
  return tile((x, y) => {
    const ring = Math.min(x, y, N - 1 - x, N - 1 - y);
    if (ring < 2) return stripes ? (((x + y) >> 2) & 1 ? YELLOW : BLACK) : ring === 0 ? FRAME[1] : FRAME[0];
    if (ring < 6) {
      if (ring === 2) return FRAME[1];
      const along = ring === x || ring === N - 1 - x ? y : x;
      return ring === 4 && along % 4 === 1 ? FRAME[2] : FRAME[0];
    }
    const hx = x - 10;
    const hy = y - 11;
    if (hx >= 0 && hx < 12 && hy >= 0 && hy < 10) {
      if (hx === 0 || hy === 0) return FRAME[2];
      if (hx === 11 || hy === 9) return FRAME[1];
      const bar = hx >= 2 && hx <= 3;
      const bar2 = hx >= 8 && hx <= 9;
      const cross = hy >= 4 && hy <= 5 && hx >= 2 && hx <= 9;
      return (bar || bar2) && hy >= 2 && hy <= 7 ? WALL[0] : cross ? WALL[0] : FRAME[0];
    }
    if (x === 15 || x === 16) return x === 15 ? doorShade : BLACK;
    if (ring === 6) return doorShade;
    return hash(x, y, 91) < 0.06 ? doorShade : door;
  });
}

/** The two sides' door colours: [door, its shade]. */
export const DOORS = [[rgb(122, 84, 62), rgb(96, 66, 50)], [rgb(58, 112, 44), rgb(44, 88, 36)]];

/** A lawn inside a low wall. */
export function lawn() {
  return tile((x, y) => {
    const ring = Math.min(x, y, N - 1 - x, N - 1 - y);
    if (ring === 0) return x === 0 || y === N - 1 ? WALL[1] : WALL[0];
    if (ring < 3) return WALL[1];
    if (ring === 3) return x === 3 || y === N - 4 ? WALL[0] : WALL[2];
    return grass(x, y);
  });
}

// ---- the set -------------------------------------------------------------------------------------------------

export function draw(put) {
  put(0, tile((x, y) => sand(x, y)));
  put(1, tile((x, y) => water(x, y)));
  put(2, tile((x, y) => water(x, y, 1)));
  put(3, tile((x, y) => sand(x, y, 1)));

  // Shores, each shape in its four turns.
  [5, 11, 10, 4].forEach((cel, turns) => put(cel, shore('beach', turns)));
  [7, 13, 12, 6].forEach((cel, turns) => put(cel, shore('beach', turns, true)));
  [8, 9, 15, 14].forEach((cel, turns) => put(cel, shore('slant', turns)));
  [16, 17, 21, 20].forEach((cel, turns) => put(cel, shore('cove', turns)));
  [18, 19, 23, 22].forEach((cel, turns) => put(cel, shore('point', turns)));

  // Open water that touches a shore tile only at a corner: a breath of surf there.
  const surf = (corners) =>
    tile((x, y) => {
      const near = Math.max(...corners.map((c) => inCorner(x, y, c, 4, 6)));
      return near > 0.75 ? SURF[1] : near > 0.25 ? SURF[2] : water(x, y);
    });
  [['tr', 'br'], ['bl', 'br'], ['tl', 'tr'], ['tl', 'bl'], ['br'], ['bl'], ['tr'], ['tl']].forEach((corners, i) => put(24 + i, surf(corners)));

  // The step from the shallows to deep water: deep corners (wide and narrow), deep halves, then shallow corners.
  const order = ['br', 'bl', 'tr', 'tl'];
  order.forEach((c, i) => put(32 + i, tile((x, y) => water(x, y, inCorner(x, y, c, 17, 12)))));
  order.forEach((c, i) => put(36 + i, tile((x, y) => water(x, y, inCorner(x, y, c, 11, 10)))));
  ['right', 'bottom', 'top', 'left'].forEach((s, i) => put(40 + i, tile((x, y) => water(x, y, inHalf(x, y, s, 14)))));
  order.forEach((c, i) => put(44 + i, tile((x, y) => water(x, y, 1 - inCorner(x, y, c, 17, 12)))));
  order.forEach((c, i) => put(48 + i, tile((x, y) => water(x, y, 1 - inCorner(x, y, c, 11, 10)))));

  // Sand packing down to the dark sand, the same way.
  order.forEach((c, i) => put(52 + i, tile((x, y) => sand(x, y, inCorner(x, y, c, 25, 16)))));
  order.forEach((c, i) => put(56 + i, tile((x, y) => sand(x, y, inCorner(x, y, c, 12, 12)))));

  // Grass and where it gives out.
  put(60, tile((x, y) => grass(x, y)));
  ['tl', 'tr', 'bl', 'br'].forEach((c, i) => put(61 + i, turf(sandCorner(c))));
  put(65, turf(strip('right')));
  put(66, turf(strip('bottom')));
  put(67, turf(grassCorner('br')));
  put(68, turf(grassCorner('bl')));
  put(69, turf(strip('top')));
  put(70, turf(strip('left')));
  put(71, turf(grassCorner('tr')));
  put(72, turf(grassCorner('tl')));

  // Roads, by the sides they run out to.
  ['ns', 'nse', 'wes', 'wen', 'nsw', 'nesw', 'we', 'se', 'sw', 'ne', 'nw'].forEach((arms, i) => put(73 + i, road(arms)));

  // Bridge ends: the road coming in from the left, the right, the top and the bottom.
  [84, 86, 85, 87].forEach((cel, turns) => put(cel, bridgeEnd(turns)));

  put(90, hatch(...DOORS[0]));
  put(91, hatch(...DOORS[1]));
  put(93, lawn());
}
