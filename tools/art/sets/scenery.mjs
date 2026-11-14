// Scenery: the remaining ground tiles (joints, pads, slabs, rubble, the planted and the ruined lawns) and the
// sprites the plant, rock and bridge models are covered with (bushes, palm trunks and fronds, trees, branches,
// rocks, bridge decks and their broken stubs). The shadow masks among these numbers are not drawn here.

import { image, rgb } from '../png.mjs';
import {
  BLACK, BOLT, KERB, N, PLANK, PLANK_GAP, ROAD, ROAD_EDGE, ROAD_FLECK, SURF, WALL, YELLOW,
  concrete, grass, hash, lawn, onRoad, sand, smooth, tile,
} from './ground.mjs';

// ---- colours -------------------------------------------------------------------------------------------------

const LEAF = [rgb(30, 58, 22), rgb(48, 88, 30), rgb(84, 126, 40), rgb(122, 160, 58)];
const TRUNK = [rgb(112, 72, 42), rgb(84, 52, 30), rgb(142, 98, 60)];
const BARK = [rgb(150, 82, 50), rgb(112, 58, 36), rgb(178, 108, 66)];
const ROCK = [rgb(150, 150, 154), rgb(116, 116, 122), rgb(84, 84, 90), rgb(182, 182, 186)];
const BERRY = [rgb(206, 36, 44), rgb(246, 120, 124)];
const BUD = [rgb(38, 150, 122), rgb(96, 198, 168)];
const ASPHALT = [rgb(90, 90, 94), rgb(80, 80, 84), rgb(104, 104, 108)];
const STEEL = [rgb(96, 104, 150), rgb(64, 70, 108), rgb(150, 158, 200)];

// ---- helpers -------------------------------------------------------------------------------------------------

/** A sprite from a rule: `pixel` gives a colour, or 0 to leave the pixel clear. */
function sprite(w, h, pixel) {
  const img = image(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) img.px[y * w + x] = pixel(x, y) || 0;
  return img;
}

/** One picture laid over another: the first rule that gives a colour wins. */
const over = (...layers) => (x, y) => {
  for (const layer of layers) {
    const c = layer(x, y);
    if (c) return c;
  }
  return 0;
};

/** Which of 32 directions a pixel lies in from a centre, without trigonometry. */
function spoke(dx, dy) {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const part = ax + ay === 0 ? 0 : Math.min(7, Math.floor((8 * ay) / (ax + ay)));
  return (dx >= 0 ? 0 : 1) * 16 + (dy >= 0 ? 0 : 1) * 8 + part;
}

/** A clump of leaves: a ragged round patch, darker underneath and at the heart, `spiky` making it a star. */
function clump(cx, cy, r, seed, { spiky = 0, tones = [0, 1, 2] } = {}) {
  return (x, y) => {
    const dx = x + 0.5 - cx;
    const dy = y + 0.5 - cy;
    const d = Math.sqrt(dx * dx + dy * dy);
    const reach = r * (1 - spiky * hash(spoke(dx, dy), 0, seed)) + (hash(x, y, seed + 1) - 0.5) * 1.6;
    if (d > reach) return 0;
    const t = smooth(x + 64, y + 64, 2, seed + 2) * 0.6 + hash(x, y, seed + 3) * 0.4 + (dy - dx) / (r * 5);
    return LEAF[tones[t < 0.4 ? 2 : t < 0.68 ? 1 : 0]];
  };
}

/** A stone: round, lit from the top right. */
function stone(cx, cy, r, seed) {
  return (x, y) => {
    const dx = x + 0.5 - cx;
    const dy = y + 0.5 - cy;
    const d = Math.sqrt(dx * dx + dy * dy * 1.3) + (hash(x >> 1, y >> 1, seed) - 0.5) * 1.2;
    if (d > r) return 0;
    const t = (dx - dy) / r + (hash(x, y, seed + 1) - 0.5) * 0.5;
    return d > r - 1 && t < 0 ? ROCK[2] : t > 0.7 ? ROCK[3] : t > -0.1 ? ROCK[0] : ROCK[1];
  };
}

/** Stones strewn over an area: `count` of them, sizes between `min` and `max`. */
function strewn(seed, count, min, max, w = N, h = N) {
  const stones = [];
  for (let i = 0; i < count; i++) {
    stones.push(stone(hash(i, 1, seed) * w, hash(i, 2, seed) * h, min + hash(i, 3, seed) * (max - min), seed + i * 7));
  }
  return over(...stones.reverse());
}

/** A line between two points, `wide` across, in two tones (the lit side first). */
function branch(x0, y0, x1, y1, wide, tones) {
  const ex = x1 - x0;
  const ey = y1 - y0;
  const len = ex * ex + ey * ey;
  return (x, y) => {
    const px = x + 0.5 - x0;
    const py = y + 0.5 - y0;
    const t = Math.max(0, Math.min(1, (px * ex + py * ey) / len));
    const dx = px - ex * t;
    const dy = py - ey * t;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > wide / 2) return 0;
    return dx - dy > 0.3 ? tones[2] : dx - dy < -0.6 ? tones[1] : tones[0];
  };
}

/** A concrete slab with its kerb, lit like the roads. */
function slab(x0, y0, x1, y1) {
  const inside = (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
  return (x, y) => {
    if (!inside(x, y)) return 0;
    if (!inside(x + 1, y - 1) || !inside(x + 1, y) || !inside(x, y - 1)) return KERB[0];
    if (!inside(x + 2, y - 2) || !inside(x + 2, y) || !inside(x, y - 2)) return KERB[1];
    if (!inside(x - 1, y) || !inside(x, y + 1)) return ROAD_EDGE;
    return hash(x, y, 71) < 0.035 ? ROAD_FLECK : ROAD;
  };
}

const stripes = (x, y) => (((x + y) >> 2) & 1 ? YELLOW : BLACK);
const ground = (x, y) => sand(x, y);

// ---- ground tiles --------------------------------------------------------------------------------------------

/** A crossroads with an expansion joint across it (`across`) or down it. */
function joint(across) {
  return tile((x, y) => {
    if (!onRoad('nesw', x, y)) return sand(x, y);
    const along = across ? y : x;
    if (along === 15) return ROAD_EDGE;
    if (along === 16) return KERB[1];
    return concrete('nesw', x, y);
  });
}

/** The open top of a shaft: dark mesh, hazard stripes down both sides and along the bottom. */
const shaft = () =>
  tile((x, y) => {
    if (x < 2 || x >= N - 2 || y >= N - 2) return stripes(x, y);
    return (x + y) & 1 ? rgb(46, 48, 54) : rgb(56, 58, 64);
  });

const gravel = () =>
  tile((x, y) => {
    const t = smooth(x, y, 2, 201) * 0.5 + hash(x, y, 202) * 0.5;
    return t < 0.35 ? ASPHALT[2] : t > 0.7 ? ASPHALT[1] : ASPHALT[0];
  });

/** A tarmac strip over sand, running down the tile or across it. */
const strip = (across) =>
  tile((x, y) => {
    const a = across ? y : x;
    if (a < 8 || a >= 24) return sand(x, y);
    if (a === 8 || a === 23) return ASPHALT[1];
    return hash(x, y, 203) < 0.05 ? ASPHALT[2] : ASPHALT[0];
  });

/** An apron: a painted line along the top, worn concrete, then a clean slab. */
const apron = () =>
  tile((x, y) => {
    if (y < 2) return rgb(232, 232, 236);
    if (y < 16) return hash(x, y, 204) < 0.05 ? ROAD : rgb(116, 117, 120);
    if (y === 16 || x < 2) return KERB[0];
    return hash(x, y, 71) < 0.035 ? ROAD_FLECK : ROAD;
  });

/** The fuel point: stained sand, and the pump's manifold along the bottom. */
function fuelPad() {
  return tile((x, y) => {
    if (y >= 22) {
      if (x < 6 || x >= 26) return (x % 3 === 1 && y % 4 === 0) ? BOLT : y === 22 ? KERB[0] : ROAD;
      if (y >= 29 && x >= 8 && x < 24) return stripes(x, y);
    }
    if (x >= 12 && x <= 19 && y >= 20 && y <= 27) return x === 12 || y === 20 ? STEEL[2] : x === 19 || y === 27 ? STEEL[1] : STEEL[0];
    if (y >= 24 && y <= 25 && x >= 6 && x < 26) return y === 24 ? STEEL[2] : STEEL[1];
    if (x >= 15 && x <= 16 && y >= 16 && y < 20) return STEEL[0];
    const d = Math.sqrt((x - 15.5) ** 2 + (y - 9.5) ** 2) + (smooth(x, y, 4, 205) - 0.5) * 3;
    return sand(x, y, d < 7 ? 0.8 : d < 10 ? 0.35 : 0);
  });
}

const halfDark = () => tile((x, y) => sand(x, y, y < 15 ? 1 : y < 18 ? 0.5 : 0));

/** A hard standing with wheel ruts curving off it. */
function standing() {
  const pad = slab(1, 1, 19, 26);
  return tile((x, y) => {
    const c = pad(x, y);
    if (c) return c;
    const d = Math.sqrt((x - 30) ** 2 + (y - 16) ** 2);
    return sand(x, y, (d > 6 && d < 8) || (d > 10 && d < 12) ? 0.75 : 0);
  });
}

/** The vehicle park: six bays and a striped threshold. */
function park() {
  return tile((x, y) => {
    if (y >= 25 && (x < 5 || x >= 27)) return sand(x, y);
    if (y >= 27 && y < 31 && x >= 6 && x < 26) return stripes(x, y);
    const bay = (x >= 2 && x <= 11) || (x >= 20 && x <= 29);
    const row = y % 9;
    if (bay && y < 26 && row >= 1 && row <= 7) return row === 1 ? rgb(72, 52, 46) : hash(x, y, 206) < 0.08 ? rgb(104, 76, 66) : rgb(92, 66, 58);
    return hash(x, y, 71) < 0.035 ? ROAD_FLECK : ROAD;
  });
}

const rubble = (seed) => tile(over(strewn(seed, 16, 1.6, 3.6), (x, y) => sand(x, y, smooth(x, y, 8, seed) * 0.5)));

/** A building's footing: a slab with a step at the door. `damage` 0 whole, 1 cracked, 2 broken up. */
function footing(damage) {
  const parts = over(slab(2, 0, 29, 21), slab(8, 22, 23, 31));
  const debris = strewn(300 + damage, damage === 2 ? 22 : 5, 1.4, 3.4);
  return tile((x, y) => {
    const c = parts(x, y);
    if (!c) return (damage && debris(x, y)) || sand(x, y);
    if (damage === 2) {
      const d = debris(x, y);
      if (d) return d;
      return smooth(x, y, 4, 301) > 0.55 ? ASPHALT[1] : hash(x, y, 302) < 0.3 ? ASPHALT[0] : c;
    }
    if (damage === 1) {
      // Cracks: thin dark lines where two noise fields cross.
      const a = Math.abs(smooth(x, y, 8, 303) - 0.5);
      const b = Math.abs(smooth(x + 16, y, 4, 304) - 0.5);
      if (a < 0.012 || b < 0.01) return ASPHALT[1];
      if (hash(x >> 1, y >> 1, 305) < 0.05) return ASPHALT[0];
    }
    return c;
  });
}

// ---- lawns ---------------------------------------------------------------------------------------------------

const onLawn = (...layers) => {
  const base = lawn();
  const top = over(...layers);
  return tile((x, y) => (Math.min(x, y, N - 1 - x, N - 1 - y) >= 4 && top(x, y)) || base.px[y * N + x]);
};

const berries = (seed, count, spread = 9) => (x, y) => {
  for (let i = 0; i < count; i++) {
    const bx = Math.floor(16 + (hash(i, 1, seed) - 0.5) * 2 * spread);
    const by = Math.floor(16 + (hash(i, 2, seed) - 0.5) * 2 * spread);
    if (x === bx && y === by) return BERRY[1];
    if (Math.abs(x - bx) + Math.abs(y - by) === 1) return BERRY[0];
  }
  return 0;
};

const plinth = over(stone(16, 16, 3.2, 401), slab(10, 10, 21, 21));
const shrubs = over(...[[10, 10], [22, 10], [10, 22], [22, 22]].map(([cx, cy], i) => clump(cx, cy, 6, 410 + i * 5, { spiky: 0.55 })));

/** A crater in a lawn: bare earth, darker toward the middle, with a scorched rim. */
function crater(cx, cy, r, seed) {
  return (x, y) => {
    const d = Math.sqrt((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2) + (smooth(x, y, 4, seed) - 0.5) * 5;
    if (d > r) return 0;
    return d > r - 1.2 ? rgb(92, 84, 40) : sand(x, y, d < r / 2.5 ? 0.9 : 0.3);
  };
}

/** Scraps scattered over a ruined lawn: single pixels of a colour. */
const scraps = (seed, share, colours) => (x, y) => (hash(x, y, seed) < share ? colours[Math.floor(hash(x, y, seed + 1) * colours.length)] : 0);

/** Twigs: a few short sticks. */
function twigs(seed, count, w = N, h = N, tones = TRUNK) {
  const sticks = [];
  for (let i = 0; i < count; i++) {
    const x = 5 + hash(i, 1, seed) * (w - 10);
    const y = 5 + hash(i, 2, seed) * (h - 10);
    sticks.push(branch(x, y, x + (hash(i, 3, seed) - 0.5) * 12, y + (hash(i, 4, seed) - 0.5) * 12, 1.6, tones));
  }
  return over(...sticks);
}

/** A ruined lawn with its wall knocked through on the left, earth spilling out. */
function breached(...layers) {
  const whole = onLawn(...layers);
  const spill = crater(2, 17, 7, 430);
  for (let y = 0; y < N; y++) for (let x = 0; x < 6; x++) if (spill(x, y)) whole.px[y * N + x] = sand(x, y, 0.3);
  return whole;
}

// ---- plants --------------------------------------------------------------------------------------------------

/** A palm trunk running from (x0, y0) at the crown to (x1, y1) at the root, ringed, broader at the foot. */
function palmTrunk(x0, y0, x1, y1) {
  return (x, y) => {
    const t = (y + 0.5 - y0) / (y1 - y0);
    if (t < 0 || t > 1) return 0;
    const cx = x0 + (x1 - x0) * t;
    const half = 2.4 + t * 1.6 + (t > 0.9 ? 1.5 : 0);
    const dx = x + 0.5 - cx;
    if (Math.abs(dx) > half) return 0;
    if (y % 3 === 2) return TRUNK[1];
    return dx < -half * 0.4 ? TRUNK[2] : dx > half * 0.45 ? TRUNK[1] : TRUNK[0];
  };
}

// Eight frond directions, a little uneven, as unit-length steps.
const FROND_DIRS = [[1, 0.15], [0.75, 0.7], [0.1, 1], [-0.7, 0.75], [-1, 0.1], [-0.75, -0.7], [-0.1, -1], [0.7, -0.75]].map(([x, y]) => {
  const len = Math.sqrt(x * x + y * y);
  return [x / len, y / len];
});

/** A palm's crown from above: fronds fanning out from the middle, each a tapering leaf with a pale rib. */
function crown(cx, cy, length, width, seed, tones) {
  return (x, y) => {
    const px = x + 0.5 - cx;
    const py = y + 0.5 - cy;
    let best = 0;
    FROND_DIRS.forEach(([ux, uy], i) => {
      const len = length * (0.8 + 0.2 * hash(i, 0, seed));
      const t = (px * ux + py * uy) / len;
      if (t < 0.02 || t > 1) return;
      const across = Math.abs(px * uy - py * ux);
      const half = width * 4 * t * (1 - t) + 0.35;
      if (across > half) return;
      // Leaflets: the edge is notched.
      if (across > half * 0.55 && hash(Math.floor(t * len), i, seed + 1) < 0.4) return;
      const c = across < 0.6 ? tones[2] : (i & 1 ? across > half * 0.6 : t > 0.6) ? tones[0] : tones[1];
      best = best || c;
    });
    if (!best && px * px + py * py < 3) return tones[0];
    return best;
  };
}

const DENSE = [LEAF[0], LEAF[1], LEAF[2]];
const PALE = [LEAF[1], LEAF[2], LEAF[3]];

/** A branch with buds: a crooked stem up a 16 x 32 sprite, three twigs off it, each ending in a bud. */
function buddingBranch(seed) {
  const knots = [[8, 31], [7 + hash(1, 0, seed) * 3, 22], [5 + hash(2, 0, seed) * 4, 13], [6 + hash(3, 0, seed) * 4, 3]];
  const parts = [];
  const buds = [];
  for (let i = 0; i < 3; i++) {
    const [ax, ay] = knots[i];
    const [bx, by] = knots[i + 1];
    parts.push(branch(ax, ay, bx, by, 2.6 - i * 0.4, TRUNK));
    const out = (i + (seed & 1)) & 1 ? 5 : -5;
    const tx = Math.max(2, Math.min(13, bx + out));
    const ty = by - 3 + hash(i, 5, seed) * 2;
    parts.push(branch(bx, by, tx, ty, 1.6, TRUNK));
    buds.push([Math.round(tx), Math.round(ty)]);
  }
  buds.push([Math.round(knots[3][0]), 2]);
  const bud = (x, y) => {
    for (const [bx, by] of buds) {
      if (x >= bx - 1 && x <= bx && y >= by - 1 && y <= by) return x === bx && y === by - 1 ? BUD[1] : BUD[0];
    }
    return 0;
  };
  return sprite(16, 32, over(bud, ...parts));
}

/** What is left of a tree: a couple of boughs with a few leaves still on. */
function brokenTree(seed) {
  const boughs = twigs(seed, 3, 16, 16, BARK);
  const leaves = clump(8, 8, 7, seed + 20, { spiky: 0.5 });
  return sprite(16, 16, over(boughs, (x, y) => (hash(x, y, seed + 30) < 0.22 ? leaves(x, y) : 0)));
}

/** A rock standing in water: surf curling round its near side. */
function wetRock(r, seed) {
  const rock = stone(8, 7, r, seed);
  return sprite(16, 16, over(rock, (x, y) => {
    const d = Math.sqrt((x + 0.5 - 8) ** 2 + (y + 0.5 - 7) ** 2 * 1.3);
    const near = y - x > -3;
    return near && d > r && d < r + 2.2 && hash(x, y, seed + 9) < 0.75 ? SURF[d < r + 1 ? 1 : 2] : 0;
  }));
}

// ---- bridges -------------------------------------------------------------------------------------------------

/** Bridge deck: boards across the way over, bolted at both ends. `across` true for a bridge running left-right. */
function deck(across) {
  return (x, y) => {
    const along = across ? x : y;
    const span = across ? y : x;
    if (along % 4 === 3) return PLANK_GAP;
    if ((span === 3 || span === N - 4) && along % 4 === 1) return BOLT;
    const board = along >> 2;
    return hash(board, span >> 2, 81) < 0.2 ? PLANK[2] : PLANK[board & 1];
  };
}

/** A splintered edge: how far a broken board reaches at this row. */
const splinter = (y, seed) => Math.floor(hash(y >> 1, 0, seed) * 5) + (hash(y, 1, seed) < 0.3 ? 2 : 0);

/** The broken ends of a bridge: boards snapped off, `w` wide, at the left, the right or both. */
function stubs(w, left, right) {
  const boards = deck(true);
  return sprite(w, N, (x, y) => {
    const l = left && x < 4 + splinter(y, 501);
    const r = right && x >= w - 4 - splinter(y, 502);
    return l || r ? boards(right && !l ? x + (N - w) : x, y) : 0;
  });
}

// ---- the set -------------------------------------------------------------------------------------------------

export function draw(put) {
  put(88, joint(true));
  put(89, joint(false));
  put(92, shaft());
  put(94, onLawn(clump(16, 16, 8.5, 440, { tones: [0, 0, 1] })));
  put(95, onLawn(berries(441, 5, 8), shrubs));
  put(96, onLawn(plinth));
  put(97, gravel());
  put(98, strip(false));
  put(99, strip(true));
  put(100, apron());
  put(101, fuelPad());
  put(102, halfDark());
  put(103, standing());
  put(104, park());
  [105, 106, 107, 108].forEach((cel, i) => put(cel, rubble(210 + i * 9)));
  [109, 110, 111].forEach((cel, damage) => put(cel, footing(damage)));

  // Bushes: two full ones and two thin ones, then two flattened.
  put(112, sprite(16, 16, clump(8, 8, 7.5, 450, { spiky: 0.45, tones: [0, 0, 1] })));
  put(113, sprite(16, 16, clump(8, 8, 7, 451, { spiky: 0.7, tones: [1, 2, 3] })));
  put(114, sprite(16, 16, clump(8, 8, 7.5, 452, { spiky: 0.35, tones: [0, 1, 1] })));
  put(115, sprite(16, 16, clump(8, 8, 6.5, 453, { spiky: 0.75, tones: [1, 2, 2] })));
  put(118, sprite(16, 16, over(twigs(454, 3, 16, 16), (x, y) => (hash(x, y, 455) < 0.25 ? clump(8, 8, 7, 456, { spiky: 0.6 })(x, y) : 0))));
  put(119, sprite(16, 16, (x, y) => (hash(x, y, 457) < 0.45 ? clump(8, 8, 7, 458, { spiky: 0.3, tones: [0, 0, 1] })(x, y) : 0)));

  // What stands in a planter (drawn over the lawn tile), and the planters ruined.
  put(122, sprite(N, N, clump(16, 16, 8.5, 440, { tones: [0, 0, 1] })));
  put(123, sprite(N, N, berries(441, 7, 9)));
  put(124, sprite(N, N, stone(16, 16, 3.2, 401)));
  put(125, onLawn(crater(17, 17, 6, 460), (x, y) => (hash(x, y, 461) < 0.6 ? clump(16, 16, 11, 462, { spiky: 0.3, tones: [0, 0, 1] })(x, y) : 0)));
  put(126, onLawn(crater(19, 18, 7, 463), (x, y) => (hash(x, y, 464) < 0.75 ? clump(14, 15, 11, 465, { spiky: 0.2, tones: [0, 0, 1] })(x, y) : 0)));
  put(127, onLawn(twigs(466, 3), crater(17, 14, 4, 467), scraps(468, 0.05, [LEAF[0], LEAF[1]])));
  put(128, onLawn(twigs(469, 4), crater(14, 15, 4.5, 470), scraps(471, 0.05, [LEAF[0], LEAF[1]])));
  put(129, onLawn(scraps(472, 0.05, [BERRY[0], LEAF[0], LEAF[1]]), crater(16, 16, 9, 473)));
  put(130, breached(scraps(474, 0.06, [BERRY[0], LEAF[0], BERRY[1]]), twigs(475, 2), crater(14, 17, 9, 476)));
  put(131, breached((x, y) => {
    const c = slab(10, 10, 21, 21)(x, y);
    return c && Math.abs(smooth(x, y, 4, 477) - 0.5) < 0.06 ? ASPHALT[1] : c;
  }, crater(22, 20, 5, 478)));
  put(132, breached(strewn(479, 12, 1.6, 3.4), crater(16, 17, 11, 480)));

  // Palms: a trunk, then its crown full and thinned; the pair the same.
  put(134, sprite(16, 32, palmTrunk(9, 0, 7.5, 32)));
  put(135, sprite(N, N, crown(16, 16, 15, 4.6, 490, DENSE)));
  put(136, sprite(N, N, crown(16, 16, 14, 2, 491, PALE)));
  put(138, sprite(N, N, over(palmTrunk(6, 0, 14, 32), palmTrunk(26, 0, 19, 32))));
  put(139, sprite(64, N, over(crown(16, 16, 15, 4.6, 492, DENSE), crown(48, 16, 15, 4.6, 493, DENSE))));
  put(140, sprite(64, N, over(crown(16, 16, 14, 2, 494, PALE), crown(48, 16, 14, 2, 495, PALE))));

  // The tree: a forked trunk, a round head of leaves and a ragged one; then the pieces of a broken tree.
  put(142, sprite(16, 16, over(branch(8, 16, 8, 8, 3.2, BARK), branch(8, 9, 4, 2, 2.4, BARK), branch(8, 9, 12, 3, 2.4, BARK))));
  put(143, sprite(16, 16, clump(8, 8, 7.6, 496, { tones: [0, 1, 2] })));
  put(144, sprite(16, 16, clump(8, 8, 7.6, 497, { spiky: 0.6, tones: [1, 2, 3] })));
  [145, 146, 147, 148, 149].forEach((cel, i) => put(cel, brokenTree(510 + i * 40)));

  [154, 155, 156].forEach((cel, i) => put(cel, buddingBranch(520 + i)));
  put(157, sprite(16, 16, stone(8, 8, 4.6, 530)));
  put(158, sprite(16, 16, stone(8, 8, 6, 531)));
  put(159, wetRock(4.6, 532));
  put(160, wetRock(5.6, 533));

  put(161, sprite(N, N, deck(true)));
  put(162, sprite(N, N, deck(false)));
  put(163, stubs(N, true, true));
  put(164, stubs(16, true, false));
  put(165, stubs(16, false, true));
  put(166, sprite(N, 8, (x, y) => (y === 0 ? PLANK[2] : y === 7 ? PLANK_GAP : hash(x >> 3, y >> 1, 540) < 0.25 ? PLANK[1] : PLANK[0])));
}
