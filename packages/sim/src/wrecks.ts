// Destroyed vehicles (the wreck class, VA 0x4453e8). When a vehicle is destroyed (sub_40c460) or runs out of fuel
// (sub_40b980) it is replaced by a wreck object that carries on with its heading and speed (sub_40c7e0):
// - It explodes at once (sub_40cc50), unless it only ran out of fuel.
// - After 8 ticks it takes on its wreck model (definition +0x160); one that ran out of fuel keeps its body (+0x148)
//   and so still stands in the way (sub_40cca0).
// - Then its speed runs down (definition +0x25c a tick) and 720 ticks after it was made it is gone (sub_40cd00).
// - It moves each tick (sub_40c8f0): in the air it falls (sub_42a520: 0x51e a tick faster, at most 1 px a tick)
//   and blows apart where it lands; in deep water it sinks and is gone with a splash once under.
// - Come to rest, a wreck with no collision shapes (every ground vehicle's wreck model) becomes a mark on the ground
//   for 720 ticks (sub_40ad10) and the object goes. One that ran out of fuel lets its driver out instead: a man of
//   its side steps out to its left, 3 px at a time until clear of it (sub_434950).
// - It takes 12.0 of damage (+0x6c) before it blows apart (sub_40cbe0), and a vehicle hit for 40.0 more than it
//   had left blows apart at once. Blowing apart throws debris (sub_42b4e0); on the ground the remains (definition
//   word 0x59) are left, in the air or in water nothing.

import { ANGLE_MASK, ONE, cos, mul, sin } from './fixed.js';
import type { VehicleKind } from './vehicle.js';

/** Hit points (+0x6c). */
export const WRECK_TOUGHNESS = 0xc0000;
/** Ticks before it takes on its wreck model. */
export const WRECK_BURN = 8;
/** Ticks it lasts (+0x64 + 0x2d0), and how long the mark it leaves may go undrawn before it goes (sub_40aca0). */
export const WRECK_TICKS = 720;
/** A vehicle hit this far past its last health blows apart straight away. */
export const WRECK_OVERKILL = -0x280000;
const FALL = 0x51e;
const FALL_MAX = -ONE;
/** Speed lost per tick (definition +0x25c). */
const SLOW: Record<VehicleKind, number> = { tank: 0x1999, jeep: 0x1999, asv: 0x1999, heli: 0x7ae };
/** The helicopter's falling wreck (+0x160, model 0x440bd0) has collision shapes; no other wreck model does. */
const SHAPED_WRECK: ReadonlySet<VehicleKind> = new Set(['heli']);

export type WreckModel = 'body' | 'wreck' | 'remains';

export interface Wreck {
  id: number;
  kind: VehicleKind;
  base: number;
  team: number;
  x: number;
  y: number;
  z: number;
  heading: number;
  speed: number;
  /** Falling speed (+0x58). */
  vz: number;
  hp: number;
  born: number;
  /** Ran out of fuel (flag 0x1000000): no explosion, keeps its body, and lets its driver out at rest. */
  fuelOut: boolean;
  model: WreckModel;
  /** Set to blow apart this tick (flag 0x2000000). */
  blow: boolean;
}

export type WreckGround = 'land' | 'shallow' | 'deep';

/** What became of a wreck this tick. */
export interface WreckStep {
  /** It blew apart: an explosion with debris, at its height. */
  blew?: boolean;
  /** Its driver gets out, at this spot. */
  driverAt?: [number, number];
  /** It is gone: 'mark' leaves a mark on the ground, 'sunk' a splash, 'gone' nothing. */
  end?: 'mark' | 'sunk' | 'gone';
}

export function makeWreck(
  id: number, kind: VehicleKind, base: number, team: number, x: number, y: number, z: number, heading: number, speed: number,
  tick: number, fuelOut: boolean, health: number,
): Wreck {
  return {
    id, kind, base, team, x, y, z, heading, speed, vz: 0, hp: WRECK_TOUGHNESS, born: tick, fuelOut, model: 'body',
    blow: !fuelOut && health < WRECK_OVERKILL,
  };
}

/** Whether the wreck's current model has collision shapes, so it stands in the way. */
export function wreckSolid(w: Wreck): boolean {
  return w.model === 'body' || (w.model === 'wreck' && SHAPED_WRECK.has(w.kind));
}

/** A hit on a wreck (sub_40cbe0). */
export function hitWreck(w: Wreck, damage: number): void {
  w.hp -= damage;
  if (w.hp <= 0) w.blow = true;
}

/**
 * One tick of a wreck. ground is what lies under it, sinkDepth the vehicle's, and clear(x, y) whether its driver
 * could stand there clear of it.
 */
export function stepWreck(
  w: Wreck, tick: number, ground: (x: number, y: number) => WreckGround, sinkDepth: number,
  clear: (x: number, y: number) => boolean,
): WreckStep {
  const age = tick - w.born;
  if (age > WRECK_TICKS) return { end: 'gone' };
  if (age === WRECK_BURN) w.model = w.fuelOut ? 'body' : 'wreck';
  if (age > WRECK_BURN && w.speed !== 0) {
    const slow = SLOW[w.kind];
    w.speed = w.speed > 0 ? Math.max(0, w.speed - slow) : Math.min(0, w.speed + slow);
  }
  const under = ground(w.x, w.y);
  const out: WreckStep = {};
  if (w.speed === 0 && w.z <= 0 && under !== 'deep') {
    // At rest (flag 0x4000000).
    if (age > WRECK_BURN && !wreckSolid(w)) return { end: 'mark' };
    if (w.fuelOut && age > WRECK_BURN && w.model === 'body') {
      w.fuelOut = false;
      const side = ((w.heading - 0x100000) & ANGLE_MASK);
      let x = w.x;
      let y = w.y;
      for (let n = 0; n < 32 && !clear(x, y); n++) {
        x += sin(side) * 3;
        y += -cos(side) * 3;
      }
      out.driverAt = [x, y];
    }
  } else {
    w.x += mul(w.speed, sin(w.heading));
    w.y += mul(w.speed, -cos(w.heading));
    let dz = 0;
    if (w.z > 0 || under === 'deep') {
      w.vz = Math.max(FALL_MAX, w.vz - FALL);
      dz = w.vz;
      if (w.z > 0 && w.z <= -dz) {
        dz = -w.z;
        w.blow = true;
      }
    }
    w.z += dz;
    if (w.z >> 16 <= -(sinkDepth >> 16)) return { end: 'sunk' };
  }
  if (w.blow) {
    w.blow = false;
    out.blew = true;
    if (under !== 'land' || w.z > 0) return { ...out, end: under === 'land' ? 'gone' : 'sunk' };
    w.model = 'remains';
  }
  return out;
}
