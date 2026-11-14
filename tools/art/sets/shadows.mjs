// The shadows and lights that are only a shape: the masks the renderer darkens the ground under (draw modes 1 and
// 13) for the plants, the buildings, the soldiers and the shots, and the two lights it brightens the screen with
// (draw mode 5). A building's shadow lies on a square of ground that starts under the building and reaches up and
// to the right, so each mask is the building's footprint swept that way by about its height.

import { STEEL, WHITE, sprite } from '../kit.mjs';
import { cloud } from '../masonry.mjs';
import { rgb } from '../png.mjs';

const mask = (w, h, shape) => sprite(w, h, (x, y) => (shape(x, y) ? WHITE : 0));
const rect = (x0, y0, x1, y1) => (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
const round = (cx, cy, r) => (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
const oval = (cx, cy, rx, ry) => (x, y) => ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1;
/** A blob with a broken edge, for leaves and rubble. */
const ragged = (cx, cy, r, seed) => (x, y) => Math.sqrt((x - cx) ** 2 + (y - cy) ** 2) <= r * (0.7 + 0.6 * cloud(x, y, 3, seed));
const any = (...shapes) => (x, y) => shapes.some((s) => s(x, y));
/** A shape dragged `far` pixels up and to the right: the shadow of something that tall. */
const sweep = (shape, far) => (x, y) => {
  for (let t = 0; t <= far; t++) if (shape(x - t, y + t)) return true;
  return false;
};
/** A trunk's shadow: a line `wide` thick from one point to another. */
const stem = (x0, y0, x1, y1, wide) => (x, y) => {
  const dx = x1 - x0, dy = y1 - y0;
  const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / (dx * dx + dy * dy)));
  return (x - x0 - t * dx) ** 2 + (y - y0 - t * dy) ** 2 <= (wide / 2) ** 2;
};

/** A shot's shadow, nose to the right: a body, a tapered nose and fins `fin` pixels long at `at`. */
const dart = (w, h, { body, nose, at, fin }) => mask(w, h, (x, y) => {
  const off = Math.abs(y - (h - 1) / 2);
  if (off <= body && x >= 1 && x <= w - 1 - (off > body - 1 ? nose : 0)) return true;
  return x >= at && x < at + fin - Math.max(0, h / 2 - 1 - off) && off <= h / 2;
});

/** A light: grey for how much it brightens, in bands like the rest of the art. */
const glow = (w, h, strength) => sprite(w, h, (x, y) => {
  const v = Math.floor(strength(x + 0.5, y + 0.5) * 6) * 22;
  return v > 0 ? rgb(v, v, v) : 0;
});

/** Draw modes: 13 darkens the ground (plants, buildings, soldiers), 1 is a shot's shadow, 5 is a light. */
const MODES = new Map([[1068, 1], [1071, 1], [1074, 1], [1076, 1], [1778, 5], [2077, 5], [614, 0]]);

export function draw(place) {
  // Each sprite names its draw mode, so it is right even over a pack that does not have the cel.
  const put = (cel, img) => place(cel, img, { mode: MODES.get(cel) ?? 13 });
  // Plants: the quad starts at the plant's foot (bottom left of the sprite).
  put(116, mask(16, 16, sweep(ragged(3, 13, 6.5, 116), 6)));
  put(117, mask(16, 16, sweep(ragged(2, 14, 7, 117), 6)));
  put(120, mask(16, 16, ragged(8, 8, 6, 120)));
  put(121, mask(16, 16, ragged(8, 8, 6.5, 121)));
  put(133, mask(16, 16, any(stem(0, 15, 9, 6, 2), ragged(10, 5, 5.5, 133), stem(10, 5, 15, 1, 2), stem(10, 5, 4, 2, 2), stem(10, 5, 15, 9, 2))));
  put(137, mask(32, 16, any(stem(0, 15, 17, 6, 2), ragged(20, 6, 6, 137), stem(20, 6, 29, 2, 2), stem(20, 6, 12, 1, 2), stem(20, 6, 28, 12, 2))));
  put(141, mask(32, 32, any(stem(0, 31, 10, 21, 3), ragged(17, 14, 11, 141))));
  put(153, mask(16, 16, any(stem(0, 15, 11, 4, 3.4), stem(5, 10, 3, 5, 2.4), stem(3, 5, 6, 2, 2.4), stem(7, 8, 12, 10, 2.4), stem(12, 10, 14, 7, 2.4))));
  put(755, mask(16, 16, oval(8, 8, 7.5, 6)));

  // Buildings.
  put(842, mask(64, 64, sweep(rect(0, 31, 32, 63), 28)));
  put(870, mask(64, 64, sweep(rect(1, 31, 32, 56), 30)));
  put(879, mask(32, 32, sweep(rect(0, 15, 13, 31), 18)));
  put(900, mask(16, 16, sweep(rect(0, 4, 11, 15), 4)));
  put(937, mask(64, 64, sweep(rect(0, 28, 36, 63), 15)));
  put(966, mask(64, 64, sweep(rect(0, 28, 36, 63), 20)));
  put(967, mask(32, 32, sweep(rect(0, 16, 16, 31), 15)));
  put(982, mask(64, 64, sweep(rect(0, 37, 24, 61), 26)));
  put(989, mask(64, 64, sweep(rect(3, 40, 29, 63), 22)));
  put(996, mask(64, 64, sweep(any(ragged(16, 52, 13, 996), rect(3, 58, 29, 63)), 10)));
  put(1011, mask(64, 64, sweep(rect(0, 31, 31, 62), 30)));
  put(1026, mask(64, 32, sweep(rect(0, 13, 33, 31), 13)));
  put(1042, mask(64, 64, sweep(round(16, 42, 10.5), 19)));
  put(1043, mask(32, 32, sweep(ragged(15, 17, 12, 1043), 2)));
  put(1058, mask(64, 64, sweep(rect(2, 31, 30, 53), 17)));
  put(1061, mask(32, 32, sweep(ragged(15, 17, 12, 1061), 2)));

  // Shots.
  put(1068, dart(16, 8, { body: 1.5, nose: 2, at: 0, fin: 4 }));
  put(1071, dart(16, 8, { body: 1.5, nose: 3, at: 0, fin: 5 }));
  put(1074, dart(16, 8, { body: 1.5, nose: 3, at: 2, fin: 4 }));
  put(1076, mask(8, 8, any(oval(4, 4.5, 3, 3.5), rect(3, 0, 4, 1))));

  // The drone's little bracket.
  put(614, sprite(16, 8, (x, y) => {
    if (x < 8) return 0;
    if (y <= 3) return y === 0 ? STEEL.hi : x === 8 || y === 3 ? STEEL.lo : STEEL.mid;
    if (x >= 10 && y <= 5) return STEEL.lo;
    return x >= 14 || (y === 6 && x >= 10 && x <= 11) ? STEEL.deep : 0;
  }));

  // The storage yard's pool of light, and the bunker's spotlight: a cone from its lamp at the top.
  put(1778, glow(64, 64, (x, y) => Math.max(0, 1 - Math.sqrt((x - 32) ** 2 + (y - 32) ** 2) / 30) * 0.95));
  put(2077, glow(36, 18, (x, y) => {
    const half = 1.5 + y * 0.92;
    return Math.abs(x - 18) > half ? 0 : (1 - y / 26) * 0.99;
  }));
}
