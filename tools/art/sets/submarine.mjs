// The submarine that surfaces to carry a flag away: 25 frames on a 64 x 32 sprite, lying bow up and to the right.
// First the water stirs, then the hull comes up through it, then it rides with foam along its sides.

import { SOOT, STEEL, hash, sprite } from '../kit.mjs';
import { SURF, WATER } from './ground.mjs';

/** Along the hull (0 at the stern, 1 at the bow) and across it, for a pixel. */
function hullAt(x, y) {
  const ax = 8;
  const ay = 25;
  const ex = 48;
  const ey = -16;
  const len = ex * ex + ey * ey;
  const t = ((x + 0.5 - ax) * ex + (y + 0.5 - ay) * ey) / len;
  const across = ((x + 0.5 - ax) * ey - (y + 0.5 - ay) * ex) / Math.sqrt(len);
  return [t, across];
}

function frame(f) {
  const up = Math.max(0, Math.min(1, (f - 6) / 12));
  return sprite(64, 32, (x, y) => {
    const [t, across] = hullAt(x, y);
    const half = t < 0 || t > 1 ? 0 : 4.2 * Math.sqrt(Math.max(0, 4 * t * (1 - t))) * (0.4 + 0.6 * up);
    const span = Math.abs(t - 0.5) < 0.12 + up * 0.42;
    if (up > 0 && span && Math.abs(across) < half) {
      // The conning tower, a little forward of the middle, comes up first.
      if (Math.abs(t - 0.56) < 0.07 && Math.abs(across) < 2.2) return across < -0.6 ? STEEL.mid : across > 1 ? SOOT : STEEL.lo;
      if (up < 0.35) return 0;
      return across < -half * 0.4 ? STEEL.mid : across > half * 0.5 ? SOOT : STEEL.deep;
    }
    // Broken water: a patch that spreads along the hull's line as the boat rises, thickest at its edge.
    const reach = 0.1 + Math.min(1, f / 12) * 0.45;
    if (Math.abs(t - 0.5) > reach + 0.06) return 0;
    const edge = Math.abs(across) - half;
    const stir = f < 7 ? 0.25 + f * 0.05 : edge < 2.5 ? 0.75 : edge < 5 ? 0.3 : 0;
    if (Math.abs(across) > 3 + f * 0.25 || hash(x, y, 800 + f) > stir) return 0;
    return edge < 1.5 && f > 8 ? SURF[1] : hash(x, y, 830 + f) < 0.4 ? SURF[2] : WATER[1];
  });
}

export function draw(put) {
  for (let f = 0; f < 25; f++) put(630 + f, frame(f));
}
