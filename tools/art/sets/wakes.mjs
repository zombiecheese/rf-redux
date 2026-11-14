// What vehicles leave behind them in water: the spray of a wake for the tank, the jeep and the ASV (13 frames
// each), and the jeep floating on its blown-up tyres: the tyres from above in the ripples they make (18 frames),
// the trail of ripples behind them (18 frames) and the tyres alone.
//
// A wake's frames run 4 to 12 as it starts, repeat 8 to 12 while the vehicle keeps going, and fade out through
// 0 to 3 when it stops. The floating frames go with speed, calm at 0 and churning at 17. The top of a wake sprite
// is at the vehicle; the trail's left edge is at the jeep's back and its top edge along the jeep's right side.

import { STEEL, SOOT, hash, over, sprite } from '../kit.mjs';
import { rgb } from '../png.mjs';

const FOAM = rgb(236, 252, 255);
const SPRAY = rgb(150, 228, 240);
const RIPPLE = rgb(84, 182, 206);
const DARK = rgb(40, 128, 160);

/** How much spray a wake frame throws: fading out (0-3), building up (4-7) and in full (8-12). */
const FULL = [0.55, 0.38, 0.24, 0.12, 0.3, 0.5, 0.7, 0.85, 1, 1, 1, 1, 1];

/**
 * One wake frame, 16 x 16: two plumes off the vehicle's back corners at `gap` from the middle, thrown out as they
 * trail away, made of drops that move down the sprite from frame to frame.
 */
function wake(frame, gap, seed) {
  const amount = FULL[frame];
  // The repeating frames move the drops along; the others keep the pattern still and thin it.
  const shift = frame >= 8 ? (frame - 8) * 3 : frame >= 4 ? (frame - 4) * 3 : 12 + frame * 2;
  return sprite(16, 16, (x, y) => {
    for (const side of [-1, 1]) {
      const cx = 7.5 + side * (gap + y * 0.18);
      const spread = 0.7 + y * 0.09;
      const d = Math.abs(x - cx) / spread;
      if (d > 1.4) continue;
      // Thinner further back and as the wake dies away.
      const fade = amount * (1 - y / 18);
      const h = hash(x, y - shift, seed + (side > 0 ? 7 : 0));
      if (h > fade * (1 - d * 0.6)) continue;
      return d < 0.5 && y < 9 && fade > 0.4 ? FOAM : h < fade * 0.4 ? SPRAY : RIPPLE;
    }
    return 0;
  });
}

/** Where the floating jeep's four tyres sit in a 32 x 32 sprite over its 24 x 24 px middle. */
const TYRES = [[10, 10], [22, 10], [10, 22], [22, 22]];
const TYRE_R = 5.5;

/** A blown-up tyre from above: a fat black ring, a grey rim and the hub. */
function tyre(x, y) {
  for (const [cx, cy] of TYRES) {
    const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
    if (d > TYRE_R) continue;
    if (d > TYRE_R - 1) return SOOT;
    if (d > 2.6) return (x + y) & 1 ? STEEL.deep : SOOT;
    if (d > 1.6) return STEEL.lo;
    return STEEL.mid;
  }
  return 0;
}

/** The ripples round the tyres: rings that widen and break up as the jeep goes faster (frame 0-17). */
function ripples(frame) {
  const churn = frame / 17;
  return (x, y) => {
    for (const [cx, cy] of TYRES) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const ring = TYRE_R + 0.8 + ((frame * 0.7) % 2.5);
      if (Math.abs(d - ring) < 0.6 && hash(x, y, frame) < 0.45 - churn * 0.15) return frame > 9 && hash(x, y, 3) < churn * 0.5 ? FOAM : RIPPLE;
      if (Math.abs(d - ring - 2.5) < 0.5 && hash(x, y, frame + 40) < churn * 0.45) return SPRAY;
    }
    return 0;
  };
}

/**
 * The trail behind the floating jeep, 32 x 32 on its side: the jeep's back is the left edge and it runs right. Two
 * arms of ripples spread from the back tyres, longer and brighter with speed (frame 0-17), with foam close in.
 */
function trail(frame) {
  const churn = frame / 17;
  const reach = 6 + churn * 26;
  return sprite(32, 32, (x, y) => {
    if (x > reach) return 0;
    const fade = 1 - x / (reach + 1);
    for (const arm of [10, 22]) {
      const out = arm < 16 ? -1 : 1;
      const line = arm + out * x * 0.32;
      const d = Math.abs(y + 0.5 - line);
      if (d < 1 && hash(x - frame * 2, y, 11) < fade * 0.9) return x < 5 + churn * 6 ? FOAM : SPRAY;
      if (d < 2.2 && hash(x - frame * 2, y, 12) < fade * churn * 0.6) return RIPPLE;
    }
    // A wash between the arms, only once moving.
    if (y > 11 && y < 21 && hash(x - frame * 3, y, 13) < fade * churn * 0.25) return DARK;
    return 0;
  });
}

export function draw(put) {
  for (let f = 0; f < 13; f++) {
    put(1999 + f, wake(f, 3.5, 1));
    put(2012 + f, wake(f, 4.5, 2));
    put(2025 + f, wake(f, 5, 3));
  }
  for (let f = 0; f < 18; f++) {
    put(2038 + f, sprite(32, 32, over(tyre, ripples(f))));
    put(2056 + f, trail(f));
  }
  put(2074, sprite(32, 32, tyre));
}
