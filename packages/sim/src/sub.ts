// The submarine (the SUB class, VA 0x44ec38). A helicopter that flies more than 32 px off the map (checked by its
// flight code, sub_40e0e0) brings out the one submarine (sub_434e80). Its think (sub_434b30) runs a chain of states:
// - hunt (sub_434c00): looks for a vehicle off the map, the one furthest out. While there is one, it counts the
//   ticks; past 240 it comes up beside that vehicle and surfaces. With none, it stays down, and once fully under it
//   is gone.
// - surface (sub_434d10): rises while its target stays off the map; risen, it waits 180 ticks to aim.
// - aim (sub_434db0): fires a death missile (projectile type 10) from 32 px to its west, pitched 60 degrees up,
//   homing on its target, then watches it (sub_434e40) until it is gone.
// - dive (sub_434d80): sinks, then hunts again from the start. It dives whenever its target comes back over the
//   map or is lost.
// Its rise (+0x5c) is also its frame: it climbs 0x3333 a tick to 0x140000, then loops frames 20-24 while up; going
// down it finishes the loop, drops to frame 15 and sinks.
//
// The death missile (class 0x448920, think sub_415100) turns its heading towards its target at 0x6666 a tick and its
// pitch at 0x3333 towards the angle down to it (kept within 60 degrees of level), and eases its velocity towards
// that line: 0x7ae a tick across, 0x1999 up and down. It does 0x190 damage, enough for anything.

import { ANGLE_MASK, approach, distance, fineAtan2, turnToward } from './fixed.js';
import { GRID } from './map.js';
import type { Vehicle } from './vehicle.js';
import { aim, turn, type Projectile } from './weapons.js';

export type SubState = 'hunt' | 'surface' | 'aim' | 'watch' | 'dive';

export interface Sub {
  x: number;
  y: number;
  state: SubState;
  /** What its rise does (+0x68): 0 stays down, 1 rises and loops, 2 dives. */
  mode: 0 | 1 | 2;
  /** Rise and frame (+0x5c), 16.16: the frame drawn is its whole part less one. */
  rise: number;
  /** Ticks a vehicle has been off the map while hunting, then the tick it fires (+0x60). */
  wait: number;
  /** The vehicle it is after, then its missile (+0x2c). */
  target: Vehicle | null;
  missile: Projectile | null;
}

export const SUB_RATE = 0x3333;
const SUB_UP = 0x140000;
const SUB_TOP = 0x190000;
const SUB_LOOP = 0x50001;
const SUB_PATIENCE = 0xf0;
const SUB_AIM = 0xb4;
/** The map's far edge, and how far beyond any edge a helicopter brings the submarine out. */
const MAP_SIZE = GRID << 21;
const SUB_CALL = 0x200000;

export const DEATH_MISSILE = 10;
/** Fired from 32 px west of the submarine, pitched up 60 degrees (sub_434db0). */
export const SUB_MUZZLE = [-0x200000, 0, 0] as const;
export const SUB_PITCH = 0x355555;
const TURN_RATE = 0x6666;
const PITCH_RATE = 0x3333;
const STEER = 0x7ae;
const STEER_UP = 0x1999;
const PITCH_LOW = 0xaaaaa;
const PITCH_HIGH = 0x355556;
const QUARTER = 0x100000;

export function offMap(x: number, y: number): boolean {
  return x < 0 || y < 0 || x >= MAP_SIZE || y >= MAP_SIZE;
}

/** Whether a helicopter at this point is far enough off the map to bring the submarine out (sub_40e0e0). */
export function callsSub(x: number, y: number): boolean {
  return x < -SUB_CALL || y < -SUB_CALL || x > MAP_SIZE + SUB_CALL || y > MAP_SIZE + SUB_CALL;
}

export function makeSub(): Sub {
  return { x: 0, y: 0, state: 'hunt', mode: 0, rise: 0, wait: 0, target: null, missile: null };
}

/** The frame to draw, or -1 while it is fully under (sub_434ab0). */
export function subFrame(s: Sub): number {
  return (s.rise >> 16) - 1;
}

export interface SubWorld {
  tick: number;
  /** The vehicles in play. */
  vehicles: readonly Vehicle[];
  /** Fires its missile at the vehicle; null if it could not. */
  fire(s: Sub, target: Vehicle): Projectile | null;
  /** Whether the missile is still flying. */
  flying(p: Projectile): boolean;
}

/** One tick of the submarine. Returns false once it has gone. */
export function stepSub(s: Sub, w: SubWorld): boolean {
  const live = (v: Vehicle | null): v is Vehicle => !!v && w.vehicles.includes(v) && offMap(v.x, v.y);
  for (let again = true; again;) {
    again = false;
    switch (s.state) {
      case 'hunt': {
        let best: Vehicle | null = null;
        let out = 0;
        for (const v of w.vehicles) {
          if (!offMap(v.x, v.y)) continue;
          for (const d of [-v.x, -v.y, v.x - MAP_SIZE, v.y - MAP_SIZE]) {
            if (out < d) {
              out = d;
              best = v;
            }
          }
        }
        if (best) {
          s.wait++;
          if (s.wait > SUB_PATIENCE) {
            s.x = best.x + 0x20;
            s.y = best.y + 0x20;
            s.target = best;
            s.state = 'surface';
            again = true;
          } else {
            s.mode = 0;
          }
        } else {
          s.mode = 0;
          if (s.rise < 1) return false;
        }
        break;
      }
      case 'surface':
        s.mode = 1;
        if (live(s.target)) {
          if (s.rise >= SUB_UP) {
            s.state = 'aim';
            s.wait = w.tick + SUB_AIM;
          }
        } else {
          s.target = null;
          s.state = 'dive';
          again = true;
        }
        break;
      case 'aim':
        s.mode = 1;
        if (live(s.target)) {
          if (w.tick < s.wait) break;
          const p = w.fire(s, s.target);
          if (p) {
            s.state = 'watch';
            s.target = null;
            s.missile = p;
          }
        } else {
          s.target = null;
          s.state = 'watch';
          again = true;
        }
        break;
      case 'watch':
        if (!s.missile || !w.flying(s.missile)) {
          s.mode = 2;
          s.missile = null;
          s.state = 'dive';
          again = true;
        } else {
          s.mode = 1;
        }
        break;
      case 'dive':
        s.mode = 2;
        if (s.rise < 1) {
          s.state = 'hunt';
          s.wait = 0;
          again = true;
        }
        break;
    }
  }
  if (s.mode === 1) {
    s.rise += SUB_RATE;
    if (s.rise > SUB_TOP) s.rise -= Math.trunc((s.rise - SUB_UP) / SUB_LOOP) * SUB_LOOP;
  } else if (s.rise < SUB_UP) {
    s.rise = Math.max(0, s.rise - SUB_RATE);
  } else {
    s.rise += SUB_RATE;
    if (s.rise > SUB_TOP) s.rise -= Math.trunc((s.rise - (SUB_UP - SUB_LOOP)) / SUB_LOOP) * SUB_LOOP;
  }
  return true;
}

/**
 * Steers a death missile towards its target (sub_415100), before it moves. Returns whether its pitch has not yet
 * come round, when it always trails smoke (otherwise one tick in four).
 */
export function steerDeathMissile(p: Projectile, target: Vehicle): boolean {
  const dx = target.x - p.x;
  const dy = target.y - p.y;
  // sub_422e70: the angle from the target to the missile, a quarter turn back; then the drop to the target.
  p.heading = turnToward(p.heading, ((fineAtan2(-dy, -dx) >> 2) - QUARTER) & ANGLE_MASK, TURN_RATE);
  let want = fineAtan2(p.z - target.z, distance(dx, dy)) >> 2;
  if (want > PITCH_LOW && want < PITCH_HIGH) want = want < 0x200001 ? PITCH_LOW : PITCH_HIGH;
  want &= ANGLE_MASK;
  p.pitch = turnToward(p.pitch, want, PITCH_RATE);
  const [vx, vy, vz] = turn([0, -p.speed, 0], aim(p.heading, p.pitch, false));
  p.vx = approach(p.vx, vx, STEER);
  p.vy = approach(p.vy, vy, STEER);
  p.vz = approach(p.vz, vz, STEER_UP);
  return p.pitch !== want;
}
