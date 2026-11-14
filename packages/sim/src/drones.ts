// Attack drones (the Drone class, VA 0x443838): small enemy helicopters that come after a vehicle that has sat on
// one tile too long. The vehicle think function (around 0x40bddb) times how long its vehicle has stayed on the same
// map tile; after 360 ticks it restarts the clock and, if fewer than three enemy gun towers were drawn on that
// player's screen, launches a drone at it (sub_40a7b0). Drones come from a pool per side whose size the
// difficulty level sets (sub_409ea0), so a camper faces at most that many at once.
//
// A drone appears 512 px from its target on a random side of it (sub_40aa90 retries the other sides if another
// player could see that spot) at 50 px up, and:
// - attack (sub_40a280): flies at the target, turning faster when it is behind it, aims its gun pod and fires from
//   alternate sides of the nose every 10 ticks while the target is 32 to 80 px away and dead ahead.
// - leave (sub_40a6a0): with its target gone it flies on until nobody has seen it for 60 ticks, then is gone.
// Movement (sub_40a480) eases the velocity towards the heading, 1.5 px a tick at most, so drones overshoot and
// circle. A hit of 1.0 or more brings one down (sub_40a6e0); its own gun does less, so drones never down each other.
// Two drones that come close push apart (sub_40a760 records the pair; sub_40a480 pushes).

import { ANGLE_MASK, ONE, approach, cos, distance, fineAtan2, headingTo, mul, sin, turnToward } from './fixed.js';
import { BOX, type Shape } from './collide.js';
import type { Rng } from './rng.js';
import type { Vehicle } from './vehicle.js';

/** The pool size for each difficulty level 1-9 (bytes at VA 0x442fd8), and its cap per side (sub_409ea0). */
export const DRONE_POOL = [0, 0, 0, 1, 1, 2, 2, 3, 3] as const;
export const DRONE_POOL_MAX = 5;
/** Ticks on one tile before a drone comes (DAT_004452b8). */
export const CAMP_TICKS = 360;
/** No drone comes while this many enemy gun towers are on the camper's screen (the count at DAT_0048c7a0). */
export const CAMP_TOWERS = 3;
/** Flying height, 50 px (sub_40a7b0), reached at up to 0.3 px a tick (sub_40a480). */
export const DRONE_HEIGHT = 0x320000;
const CLIMB = 0x4ccc;
/** Spawn distance: the box either side of the target that sub_40aa90 puts it on the edge of. */
export const DRONE_SPAWN = 0x2000000;
/** Ticks a leaving drone lasts unseen (sub_40a6a0). */
export const DRONE_UNSEEN = 60;
/** A hit must be at least this to bring a drone down (sub_40a6e0). */
export const DRONE_TOUGHNESS = 0x10000;
/** Its body box, 8 px either way (the second shape at 0x443700), and the 16 px box that keeps drones apart. */
export const DRONE_BODY = 8 * ONE;
/** The body's collision shape (model 0x443740): a box 8 px either way, from 4 px below it to 6 px above. */
export const DRONE_SHAPES: readonly Shape[] = [
  { type: BOX, flags: [0, 0, 1, 255], z: [-4 * ONE, 6 * ONE], offset: [0, 0], bounds: [-DRONE_BODY, -DRONE_BODY, DRONE_BODY, DRONE_BODY] },
];
const DRONE_NEAR = 16 * ONE;
/** Owner id on a drone's shots, so other drones ignore them. */
export const DRONE_OWNER = -2;

/** The drone's parameters (DAT_00443118), by word. */
const P = {
  ease: 0x3d7, // 0: velocity change per tick
  turnAhead: 0x6666, // 1: turn rate with the target ahead (within a quarter turn)
  turnNear: 0x3333, // 2: with the target behind and near
  turnFar: 0x10000, // 3: with the target behind and far
  far: 0x4b0000, // 4: 75 px
  speedUp: 0x4ccc, // 9: speed gained per tick
  podTurn: 0x4ccc, // 10: gun pod turn rate
  podLimit: 0x50000, // 11: how far the pod tilts up
  reload: 10, // 12
  minRange: 0x200000, // 13: 32 px
  maxRange: 0x500000, // 14: 80 px
};
const MAX_SPEED = 0x18000;
/** It fires when within this of dead ahead: (heading - aim + 0xe38e) & mask < 0x1c71c. */
const AIM_HALF = 0xe38e;
const AIM_WINDOW = 0x1c71c;
/** Guns either side of the nose (DAT_00443160), with -y forward. */
const GUNS: readonly (readonly [number, number, number])[] = [[-8 * ONE, -8 * ONE, 0], [8 * ONE, -8 * ONE, 0]];
/** Its gun (projectile type 11). */
const SHOT = 11;
/** A target more than 2 px up (a helicopter in the air) is checked for a clear line of fire first. */
const AIR_TARGET = 0x20000;

export interface Drone {
  /** Order of launch, which phases the rotor (the draw function adds the object id). */
  id: number;
  /** The base whose colours it wears: a rival of its target's base (rivalOf in match.ts; with two bases, the other). */
  side: number;
  /** Team it was sent against, which its pool slot counts for. */
  targetTeam: number;
  /** The vehicle it hunts (+0x2c), or null once that is gone. */
  target: Vehicle | null;
  x: number;
  y: number;
  z: number;
  heading: number;
  speed: number;
  vx: number;
  vy: number;
  /** Gun pod tilt (pool entry +0x1c): it tilts towards the target before firing. */
  pod: number;
  /** Which gun fires next (pool entry +0x0d). */
  gun: number;
  /** Tick it may fire again (pool entry +0x14). */
  readyAt: number;
  /** Another drone it came close to last tick (pool entry +0x18), by id, or -1. */
  bump: number;
  /** Last tick someone could see it. */
  seen: number;
  dead: boolean;
}

export interface DroneShot {
  kind: number;
  /** The gun it fires from, on the drone's model. */
  offset: readonly [number, number, number];
  heading: number;
  /** Aimed down at the target: the drop over the distance (sub_410b80), on the heading circle. */
  pitch: number;
  /** Fire only if the line of fire is clear of the drone's own side (a probe, type 3, goes first). */
  check: boolean;
}

export interface DroneWorld {
  tick: number;
  drones: Drone[];
}

/** Pool size per side for a difficulty and a map's AI pool setting (null for the difficulty's). */
export function dronePool(difficulty: number, setting: number | null): number {
  const n = setting ?? DRONE_POOL[Math.min(9, Math.max(1, difficulty)) - 1]!;
  return Math.min(DRONE_POOL_MAX, n);
}

/**
 * Where to launch a drone at a target (sub_40a7b0 with sub_40aa90): the edge of the 512 px box round it, on a side
 * picked at random and then the next ones round, at a random place along that side. A spot inside the same box
 * round any other vehicle in play is refused, so nobody sees one appear. Null if every side is refused.
 */
export function droneSpawn(rng: Rng, target: Vehicle, others: readonly Vehicle[]): [number, number] | null {
  let side = rng.below(4);
  const span = (DRONE_SPAWN * 2 + 1) >> 16;
  for (let n = 0; n < 4; n++) {
    let x = target.x;
    let y = target.y;
    const along = rng.below(span) * ONE - DRONE_SPAWN;
    if (side === 0) {
      x += along;
      y -= DRONE_SPAWN;
    } else if (side === 1) {
      x += DRONE_SPAWN;
      y += along;
    } else if (side === 2) {
      x += along;
      y += DRONE_SPAWN;
    } else {
      x -= DRONE_SPAWN;
      y += along;
    }
    const seen = others.some((v) => v !== target && Math.abs(x - v.x) <= DRONE_SPAWN && Math.abs(y - v.y) <= DRONE_SPAWN);
    if (!seen) return [x, y];
    side = (side + 1) & 3;
  }
  return null;
}

export function makeDrone(id: number, side: number, target: Vehicle, x: number, y: number, tick: number): Drone {
  return {
    id, side, targetTeam: target.team, target, x, y, z: DRONE_HEIGHT, heading: 0, speed: 0, vx: 0, vy: 0, pod: 0, gun: 0,
    readyAt: 0, bump: -1, seen: tick, dead: false,
  };
}

/** Movement (sub_40a480). The body's banking (+0x58, +0x68) only tilts the drawing and is left out. */
function move(dw: DroneWorld, d: Drone): void {
  d.vx = approach(d.vx, mul(d.speed, sin(d.heading)), P.ease);
  d.vy = approach(d.vy, -mul(d.speed, cos(d.heading)), P.ease);
  const nx = d.x + d.vx;
  const ny = d.y + d.vy;
  // Another drone's body blocks the move (sub_40a760 returns 5 for body against body); coming within the outer
  // box only records the pair. Both drones note each other so both push apart next tick.
  let blocked = false;
  for (const o of dw.drones) {
    if (o === d || o.dead) continue;
    const dx = Math.abs(nx - o.x);
    const dy = Math.abs(ny - o.y);
    if (dx > DRONE_NEAR * 2 || dy > DRONE_NEAR * 2) continue;
    d.bump = o.id;
    o.bump = d.id;
    if (dx <= DRONE_BODY * 2 && dy <= DRONE_BODY * 2) blocked = true;
  }
  if (!blocked) {
    d.x = nx;
    d.y = ny;
  }
  d.z += Math.max(-CLIMB, Math.min(CLIMB, DRONE_HEIGHT - d.z));
  if (d.speed < MAX_SPEED) d.speed = Math.min(MAX_SPEED, d.speed + P.speedUp);
  if (d.bump >= 0) {
    const o = dw.drones.find((x) => x.id === d.bump);
    d.bump = -1;
    if (o) {
      // Pushed apart by 2 px a tick less a sixteenth of the distance between them. Inferred: the original takes
      // the distance from its last float result, which is not certain to be this one.
      const push = 0x20000 - (distance(d.x - o.x, d.y - o.y) >> 4);
      if (push > 0) {
        const away = headingTo(d.x - o.x, d.y - o.y);
        d.vx += mul(sin(away), push);
        d.vy -= mul(cos(away), push);
      }
    }
  }
}

/**
 * Attack (sub_40a280). Returns the shot it fires, if any. The pod's aim is the drop to the target as a downward
 * tilt, which the original's range test (a positive tilt above 5 steps is out of reach, any downward one is in
 * reach) always passes, so the pod only has to finish turning.
 */
function attack(dw: DroneWorld, d: Drone, t: Vehicle): DroneShot | null {
  move(dw, d);
  const aim = headingTo(t.x - d.x, t.y - d.y);
  const off = (aim - d.heading) & ANGLE_MASK;
  const dist = distance(t.x - d.x, t.y - d.y);
  const ahead = off <= 0x100000 || off > 0x2fffff;
  d.heading = turnToward(d.heading, aim, ahead ? P.turnAhead : dist > P.far ? P.turnFar : P.turnNear);
  const drop = headingTo(d.z - t.z, -dist);
  let tilt = -drop & ANGLE_MASK;
  let inReach = true;
  if (tilt <= 0x200000 && tilt > P.podLimit) {
    inReach = false;
    tilt = P.podLimit;
  }
  d.pod = turnToward(d.pod, tilt, P.podTurn);
  if (d.pod !== tilt || !inReach || d.readyAt >= dw.tick) return null;
  if (dist <= P.minRange || dist >= P.maxRange) return null;
  if (((d.heading - aim + AIM_HALF) & ANGLE_MASK) >= AIM_WINDOW) return null;
  d.readyAt = dw.tick + P.reload;
  const pitch = (fineAtan2(d.z - t.z, dist) >> 2) & ANGLE_MASK;
  // At a helicopter in the air it checks its line of fire first; the match toggles the gun only when it fires.
  return { kind: SHOT, offset: GUNS[d.gun]!, heading: aim, pitch, check: t.z > AIR_TARGET };
}

/** The drone fired: the other gun goes next. */
export function droneFired(d: Drone): void {
  d.gun ^= 1;
}

/**
 * One tick of a drone. A drone whose target is gone leaves; once it has been unseen for 60 ticks it is marked dead
 * (gone, not shot down).
 */
export function stepDrone(dw: DroneWorld, d: Drone): DroneShot | null {
  if (d.target) return attack(dw, d, d.target);
  move(dw, d);
  if (dw.tick > d.seen + DRONE_UNSEEN) d.dead = true;
  return null;
}
