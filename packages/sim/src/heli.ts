// The helicopter's flight (definition at VA 0x445f70). Its think is a chain of states in the player record (+0x0c),
// each called before the movement, and while one says it is busy the helicopter neither moves under control, fires
// nor docks (sub_40b980):
// - spin-up (sub_40e8c0): the engine winds up, 0x49b a tick to 1.0 (+0x58).
// - spool (sub_40e930): the rotor speeds up, 0x666 a tick to 0x40000 (+0x84), turning the rotor (+0x80).
// - climb (sub_40e9c0): it lifts off at 0.5 px a tick to 50 px, drifting a quarter pixel a tick east and swinging
//   round a quarter step a tick (left or right by the object's id).
// - fly (sub_40eab0): under control, moved by sub_40e0e0 (below), which also climbs back to 50 px.
// Docking on its own lift starts the landing (definition word 150, sub_40eb00):
// - brake (sub_40eb40): flies with only the brake held until it hangs still, then works out how to settle onto the
//   middle of the lift facing heading 24.
// - descend (sub_40ec30): comes down 0.5 px a tick, turning and sliding in proportion to its height.
// - wind-down (sub_40ecd0, sub_40ede0): the rotor slows to 0x8000, runs on until a blade lines up, then the engine
//   winds down and it is docked.
//
// In flight (sub_40e0e0) the throttle sets a speed as on the ground, but the helicopter has momentum: its velocity
// (+0x98, +0x9c) eases 0x7ae a tick towards speed along the heading, plus 0.8 px a tick sideways for the strafe keys
// (the tank's turret keys, command bits 0x4000 and 0x8000). Turning eases its turn rate (+0x8c) up slowly and
// down quickly. Hanging still it drifts at random. Its banking (+0x88) only tilts the drawing and is left out.

import { ANGLE_MASK, approach, cos, mul, sin } from './fixed.js';
import type { Rng } from './rng.js';

export type HeliPhase = 'spinup' | 'spool' | 'climb' | 'fly' | 'brake' | 'descend' | 'winddown' | 'stop' | 'docked';

export interface HeliState {
  phase: HeliPhase;
  /** Engine (+0x58), rotor speed (+0x84) and rotor angle (+0x80). */
  engine: number;
  rotorSpeed: number;
  rotor: number;
  /** Velocity (+0x98, +0x9c), turn rate (+0x8c) and the random drift while hanging still (+0x90, +0x94). */
  vx: number;
  vy: number;
  yaw: number;
  driftX: number;
  driftY: number;
  /** Landing: where it settles and, per pixel of height, how far it is turned and off the middle (sub_40eb40). */
  padX: number;
  padY: number;
}

/** Cruising height, 50 px. */
export const HELI_HEIGHT = 0x320000;
/** Climb and descent per tick. */
export const HELI_CLIMB = 0x8000;
/** Below this it is on or near the ground: ground fire hits it and it can run men over (GRENADE_LOW). */
export const HELI_LOW = 0x50000;
const ENGINE_RATE = 0x49b;
const SPOOL_RATE = 0x666;
const ROTOR_FULL = 0x40000;
const ROTOR_IDLE = 0x8000;
/** Take-off drift east (DAT_00445494) and swing. */
const LIFT_DRIFT = 0x4000;
const LIFT_SWING = 0x4000;
/** Turn rate easing (DAT_00445498 spinning up, DAT_0044549c slowing or reversing), velocity easing, strafing. */
const YAW_UP = 0x7ae;
/** How fast the helicopter's turn rate eases back to nothing once the turn is let go (also used by the touch stick). */
export const YAW_DOWN = 0x1eb8;
const EASE = 0x7ae;
const STRAFE = 0xcccc;
const QUARTER = 0x100000;
/** Random drift: up to 0x7ae either way, changing by -0x147 to +0x147 a tick. */
const DRIFT_MAX = 0x7ae;
const DRIFT_STEP = 0x28f;
const DRIFT_HALF = 0x147;
/** Landing: it settles facing heading 24, turning and sliding 0x51e (1/50) of the way per pixel of height. */
const LAND_HEADING = 0x180000;
const PER_PIXEL = 0x51e;

export function makeHeli(): HeliState {
  return {
    phase: 'spinup', engine: 0, rotorSpeed: 0, rotor: 0, vx: 0, vy: 0, yaw: 0, driftX: 0, driftY: 0, padX: 0, padY: 0,
  };
}

/** The helicopter's figures from its definition: speeds, acceleration, braking and turn rate. */
export interface HeliDef {
  maxForward: number;
  maxReverse: number;
  accel: number;
  brake: number;
  turnRate: number;
}

export interface HeliBody {
  x: number;
  y: number;
  z: number;
  heading: number;
  speed: number;
  /** Player id, whose evenness picks the way it swings on take-off (the object id in the original). */
  player: number;
  heli: HeliState | null;
}

export interface HeliControls {
  throttle: -1 | 0 | 1;
  turn: -1 | 0 | 1;
  strafeLeft?: boolean;
  strafeRight?: boolean;
}

/** Whether the helicopter is under control: not taking off or landing. */
export function heliFlying(h: HeliState): boolean {
  return h.phase === 'fly';
}

/** Starts the landing on the lift whose middle is (x, y) (sub_40eb00). */
export function landHeli(h: HeliState, x: number, y: number): void {
  if (h.phase !== 'fly') return;
  h.phase = 'brake';
  h.padX = x;
  h.padY = y;
}

/** sub_40e0e0: controls, momentum and height. Returns the move to make. */
function fly(v: HeliBody, h: HeliState, def: HeliDef, c: HeliControls, rng: Rng): [number, number, number] {
  let speed = v.speed;
  if (c.throttle > 0) speed = Math.min(speed + def.accel, def.maxForward);
  else if (c.throttle < 0) speed = Math.max(speed - def.accel, def.maxReverse);
  else speed = approach(speed, 0, def.brake);
  let heading = v.heading;
  let strafe = 0;
  if (c.turn) {
    const target = c.turn * def.turnRate;
    h.yaw = approach(h.yaw, target, (target >= 0 && h.yaw <= 0) || (target <= 0 && h.yaw > 0) ? YAW_DOWN : YAW_UP);
  } else {
    if (c.strafeLeft) strafe = -QUARTER;
    else if (c.strafeRight) strafe = QUARTER;
    h.yaw = approach(h.yaw, 0, YAW_DOWN);
  }
  if (h.yaw) heading = (heading + h.yaw) & ANGLE_MASK;
  let tx = mul(speed, sin(heading));
  let ty = mul(speed, -cos(heading));
  if (strafe) {
    const side = (v.heading + strafe) & ANGLE_MASK;
    tx += mul(sin(side), STRAFE);
    ty += mul(-cos(side), STRAFE);
  }
  if (tx === 0 && ty === 0) {
    tx = h.driftX;
    ty = h.driftY;
    h.driftX = Math.max(-DRIFT_MAX, Math.min(DRIFT_MAX, h.driftX - DRIFT_HALF + rng.below(DRIFT_STEP)));
    h.driftY = Math.max(-DRIFT_MAX, Math.min(DRIFT_MAX, h.driftY - DRIFT_HALF + rng.below(DRIFT_STEP)));
  } else {
    h.driftX = 0;
    h.driftY = 0;
  }
  h.vx = approach(h.vx, tx, EASE);
  h.vy = approach(h.vy, ty, EASE);
  v.speed = speed;
  v.heading = heading;
  const dz = v.z < HELI_HEIGHT ? Math.min(HELI_CLIMB, HELI_HEIGHT - v.z) : 0;
  return [h.vx, h.vy, dz];
}

/**
 * One tick of the helicopter. Moves it and returns true while it is busy taking off or landing (when it may not
 * fire). Once landed its phase is 'docked' and the match takes it in.
 */
export function stepHeli(v: HeliBody, def: HeliDef, c: HeliControls, rng: Rng): boolean {
  const h = v.heli;
  if (!h) return false;
  switch (h.phase) {
    case 'spinup':
      h.engine += ENGINE_RATE;
      if (h.engine > 0x10000) {
        h.engine = 0x10000;
        h.phase = 'spool';
      }
      return true;
    case 'spool':
      h.rotorSpeed += SPOOL_RATE;
      if (h.rotorSpeed >= ROTOR_FULL) {
        h.rotorSpeed = ROTOR_FULL;
        h.phase = 'climb';
      }
      h.rotor = (h.rotor + h.rotorSpeed) & ANGLE_MASK;
      return true;
    case 'climb': {
      const dz = Math.min(HELI_CLIMB, HELI_HEIGHT - v.z);
      v.x += LIFT_DRIFT;
      v.z += dz;
      if (v.z >= HELI_HEIGHT) {
        v.z = HELI_HEIGHT;
        h.phase = 'fly';
      }
      v.heading = (v.heading + ((v.player & 1) === 0 ? -LIFT_SWING : LIFT_SWING)) & ANGLE_MASK;
      h.rotor = (h.rotor + h.rotorSpeed) & ANGLE_MASK;
      return true;
    }
    case 'fly': {
      h.rotor = (h.rotor + h.rotorSpeed) & ANGLE_MASK;
      const [dx, dy, dz] = fly(v, h, def, c, rng);
      v.x += dx;
      v.y += dy;
      v.z += dz;
      return false;
    }
    case 'brake': {
      h.rotor = (h.rotor + h.rotorSpeed) & ANGLE_MASK;
      h.driftX = 0;
      h.driftY = 0;
      const [dx, dy, dz] = fly(v, h, def, { throttle: 0, turn: 0 }, rng);
      // No drift while landing: sub_40eb40 zeroes it before each call.
      h.driftX = 0;
      h.driftY = 0;
      v.x += dx;
      v.y += dy;
      v.z += dz;
      if (h.vx === 0 && h.vy === 0) {
        const off = (LAND_HEADING - v.heading) & ANGLE_MASK;
        h.yaw = off <= 0x200000 ? mul(-off, PER_PIXEL) : -mul(off - (ANGLE_MASK + 1), PER_PIXEL);
        h.driftX = mul(v.x - h.padX, PER_PIXEL);
        h.driftY = mul(v.y - h.padY, PER_PIXEL);
        h.phase = 'descend';
      }
      return true;
    }
    case 'descend': {
      // sub_40ec30 reuses the turn rate and drift fields for the per-pixel turn and offset.
      let z = v.z - HELI_CLIMB;
      if (z < 0) {
        z = 0;
        h.phase = 'winddown';
      }
      const px = z >> 16;
      v.heading = (Math.imul(h.yaw, px) + LAND_HEADING) & ANGLE_MASK;
      v.x = Math.imul(h.driftX, px) + h.padX;
      v.y = Math.imul(h.driftY, px) + h.padY;
      v.z = z;
      v.speed = 0;
      h.rotor = (h.rotor + h.rotorSpeed) & ANGLE_MASK;
      return true;
    }
    case 'winddown': {
      h.rotorSpeed -= SPOOL_RATE;
      if (h.rotorSpeed > ROTOR_IDLE) {
        h.rotor = (h.rotor + h.rotorSpeed) & ANGLE_MASK;
        return true;
      }
      h.rotorSpeed = ROTOR_IDLE;
      // Runs on at idle until a blade passes the rest position.
      const signed = (a: number) => (a > 0x1fffff ? a - 0x400000 : a);
      const before = signed(-h.rotor & ANGLE_MASK);
      h.rotor = (h.rotor + ROTOR_IDLE) & ANGLE_MASK;
      const after = signed(-h.rotor & ANGLE_MASK);
      if ((before > 0 || after < 0) && (before < 0 || after > 0)) return true;
      h.rotor = 0;
      h.rotorSpeed = 0;
      h.phase = 'stop';
      return true;
    }
    case 'stop':
      h.engine -= ENGINE_RATE;
      if (h.engine < 0) {
        h.engine = 0;
        h.phase = 'docked';
      }
      return true;
    case 'docked':
      return true;
  }
}
