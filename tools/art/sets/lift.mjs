// The bunker lift's moving parts: the two hatch doors that slide apart, the platform a vehicle rides up on, the
// shaft's walls and the hazard lip round its mouth. The doors and platform are cut from the hatch tile's own
// drawing (ground.mjs), so a closed hatch and the ground tile under it are the same picture.

import { image, rgb } from '../png.mjs';
import { DOORS, hatch } from './ground.mjs';

const N = 32;

/** Half of the hatch, without its hazard stripes: `right` picks the right-hand door. */
function door(side, right) {
  const whole = hatch(...DOORS[side], { stripes: false });
  const img = image(N / 2, N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N / 2; x++) img.px[y * (N / 2) + x] = whole.px[y * N + x + (right ? N / 2 : 0)];
  return img;
}

/** The platform: the hatch's plate without stripes, clear round the outside so the shaft shows past it. */
function platform(side) {
  const img = hatch(...DOORS[side], { stripes: false });
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (Math.min(x, y, N - 1 - x, N - 1 - y) < 2) img.px[y * N + x] = 0;
  return img;
}

/** A shaft wall: steel plate at brightness `tone`, a bolted rail down each side and a pipe down the middle. */
function wall(tone, sheen) {
  const grey = (v) => rgb(v, v, v + 3);
  const img = image(N, N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let v = tone;
      // Light falls across the lit wall from its top left.
      if (sheen && x + y < 26) v += 14;
      if (sheen && x + y < 12) v += 10;
      const rail = x < 5 || x >= N - 5;
      if (rail) v -= 22;
      if (x === 5 || x === N - 6) v -= 20;
      if (rail && y % 6 === 2 && (x === 2 || x === N - 3)) v += 60;
      if (y >= 5 && x >= 15 && x <= 17) v += x === 15 ? 26 : x === 16 ? 8 : -30;
      if (y >= 3 && y < 6 && x >= 14 && x <= 18) v -= 40;
      img.px[y * N + x] = grey(Math.max(18, Math.min(235, v)));
    }
  }
  return img;
}

/** The lip: a strip of hazard stripes with a worn top edge. */
function lip() {
  const img = image(N, 4);
  for (let y = 0; y < 4; y++) for (let x = 0; x < N; x++) img.px[y * N + x] = ((x + y) >> 2) & 1 ? (y === 0 ? rgb(250, 226, 96) : rgb(244, 208, 32)) : rgb(36, 36, 40);
  return img;
}

export function draw(put) {
  put(822, door(0, false));
  put(823, door(1, false));
  put(824, door(0, true));
  put(825, door(1, true));
  put(826, wall(132, true));
  put(827, wall(92, false));
  put(828, wall(58, false));
  put(829, platform(0));
  put(830, platform(1));
  put(831, lip());
}
