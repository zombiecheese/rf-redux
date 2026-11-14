// Losing a vehicle: what the player's view does from the moment it is gone until the bunker is back.
//
// - The vehicle's death handler (sub_40c460, or sub_40cf90 for one that sank) starts a timer of the vehicle
//   definition's +0x260 ticks (respawnDelay, sub_4146d0). Until it runs out the view stays on the map, so the player
//   watches the vehicle blow up (the view goes on following its wreck; inferred, the original keeps the view on the
//   object that replaced the vehicle).
// - When it runs out, a vehicle destroyed outright always shows the skull (sub_40b5a0). One that ran out of fuel or
//   sank (sub_40b5c0) shows it only if it was a jeep, or the player has no jeeps left; otherwise the map simply fades
//   out (sub_418390) to the bunker. A base with no jeeps left is out at once in the remake, so
//   here only the jeep counts.
// - The skull screen (sub_418440, the view's think at +0xc0 stepping through sub_4184d0, sub_418830, sub_4188c0 and
//   sub_4189a0; sub_418510 draws it):
//   1. For 30 ticks the map plays on at full brightness with the skull over it, zooming in from 1% to 120% size
//      (+0xd4, 0x666 a tick) while it spins (+0xd0, 2.5 headings a tick) until it is full size and upright.
//   2. The map fades out under the skull, 0x51e a tick (about 50 ticks).
//   3. On black, the skull laughs (sound 22, Laugh): 60 frames of the table at 0x449270 at 0.3 a tick (200 ticks),
//      while a row of the lost vehicle's icons fades in under it, the ones already used crossed out.
//   4. The skull and screen fade to black, 0x11eb a tick (FADE_STEP), and the bunker fades in (sub_418290).
// - The skull wears the other side's helmet (cels 2126-2132 brown, 2133-2139 green): the enemy laughing.

import { ONE } from './fixed.js';
import { FADE_STEP } from './lift.js';
import type { Match, Player } from './match.js';
import type { VehicleKind } from './vehicle.js';

/** A lost vehicle, from the moment it is gone until the player is back in the bunker. */
export interface Death {
  kind: VehicleKind;
  /** Whether the skull screen shows. */
  skull: boolean;
  /** The wreck that took its place (its id), which the view follows; -1 if it sank. */
  wreck: number;
  /** The tick the skull screen began, once it has. */
  start: number;
}

/** The skull screen's steps, in ticks from its start. */
export const SKULL_HOLD = 30;
/** How fast the map fades out under the skull (sub_418830). */
const MAP_FADE = 0x51e;
/** The tick the map has faded out and the laugh starts. */
export const SKULL_LAUGH = SKULL_HOLD + Math.ceil(ONE / MAP_FADE) - 1;
/** The laugh's frames: 60, at 0x4ccc a tick (0x449268). */
const LAUGH_FRAMES = 60;
const LAUGH_RATE = 0x4ccc;
export const SKULL_FADE = SKULL_LAUGH + Math.ceil((LAUGH_FRAMES << 16) / LAUGH_RATE);
/** The tick the skull has faded to black and the bunker takes over. */
export const SKULL_END = SKULL_FADE + Math.ceil(ONE / FADE_STEP);

/** The laughing face for each of the 60 frames (0x449270): 1 is the mouth shut, 7 wide open. */
const LAUGH = [
  1, 2, 2, 3, 3, 4, 4, 5, 6, 6, 6, 5, 5, 5, 6, 6, 5, 4, 5, 6, 7, 7, 6, 5, 4, 5, 6, 7, 7, 6, 4, 5, 6, 7, 6, 5, 3, 4, 5, 7,
  7, 7, 6, 6, 6, 5, 5, 4, 4, 3, 3, 2, 2, 1, 1, 1, 1, 1, 1, 1,
];
/** The skull's size (+0xd4, 16.16): from 0x28f, 0x666 a tick, to 0x13333. */
const SCALE_FROM = 0x28f;
const SCALE_STEP = 0x666;
export const SCALE_FULL = 0x13333;
/** Its spin (+0xd0, 16.16 headings): 2.5 a tick, until it is full size and has come round to upright. */
const SPIN_STEP = 0x28000;
const TURN = 64 << 16;

/** How the skull screen looks, t ticks in. */
export interface SkullLook {
  /** How lit the map under the skull is (0 to ONE), or null once it is black. */
  map: number | null;
  /** The skull's size and spin (16.16; headings). */
  scale: number;
  angle: number;
  /** Its face, 1 (shut) to 7. */
  face: number;
  /** How far the row of lives has faded in (0 to ONE), or null before the laugh. */
  lives: number | null;
  /** How lit the skull itself is (0 to ONE). */
  light: number;
}

export function skullLook(t: number): SkullLook {
  // sub_418510 grows and spins the skull every tick it draws it, the first one included.
  let scale = SCALE_FROM;
  let angle = 0;
  for (let i = 0; i <= t; i++) {
    if (scale < SCALE_FULL) scale = Math.min(SCALE_FULL, scale + SCALE_STEP);
    if (scale === SCALE_FULL && angle === 0) continue;
    angle += SPIN_STEP;
    if (angle >= TURN) angle = scale >= SCALE_FULL ? 0 : angle - TURN;
  }
  const map = t < SKULL_HOLD ? ONE : t < SKULL_LAUGH ? ONE - MAP_FADE * (t - SKULL_HOLD + 1) : null;
  const laugh = t > SKULL_LAUGH && t < SKULL_FADE ? t - SKULL_LAUGH : 0;
  const frame = Math.min(LAUGH_FRAMES - 1, (LAUGH_RATE * laugh) >> 16);
  return {
    map,
    scale,
    angle,
    face: LAUGH[frame]!,
    lives: laugh > 0 ? Math.min(ONE, MAP_FADE * laugh) : null,
    light: t < SKULL_FADE ? ONE : Math.max(0, ONE - FADE_STEP * (t - SKULL_FADE + 1)),
  };
}

/** A player's view after losing a vehicle, each tick: the wait on the map, then the skull or a fade to the bunker. */
export function stepDeath(m: Match, p: Player): void {
  const d = p.death;
  if (p.state === 'lost' && m.tick >= p.returnAt) {
    if (d?.skull) {
      p.state = 'skull';
      d.start = m.tick;
      m.events.push({ type: 'skull', player: p.id });
    } else {
      p.fade -= FADE_STEP;
      if (p.fade <= 0) backToBunker(p);
    }
    return;
  }
  if (p.state !== 'skull' || !d) return;
  const t = m.tick - d.start;
  if (t === SKULL_LAUGH) m.events.push({ type: 'laugh', player: p.id });
  if (t >= SKULL_END) backToBunker(p);
}

function backToBunker(p: Player): void {
  p.state = 'bunker';
  p.fade = 0;
  p.death = null;
}
