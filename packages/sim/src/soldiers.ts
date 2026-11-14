// Soldiers (the MAN class, VA 0x44eb38). Barracks, bunkers, factories, hospitals, outposts, watchtowers and tents
// let men out when a hit leaves them on their last hit point (sub_42e8c0 calls sub_434980); a prison lets out the
// other side's men. A man runs from the nearest vehicle, friend or enemy, and now and then stops to throw a
// grenade at an enemy one. Any vehicle that touches him runs him over, and any shot kills him. Men nobody is
// looking at are gone after two seconds (the draw functions sub_433950 and sub_433a10 keep them alive).
//
// The think states, called in a loop each tick until one says it is done for the tick (sub_433ab0):
// - place (sub_434460): a new man walks out of the building he came from, 4 px at a time, then picks a state.
// - choose (sub_434350): targets the nearest vehicle in play; within 256 px he runs, else he idles.
// - idle (sub_433d40) and wait (sub_434320): stand, or tread water, until the timer runs out.
// - run (sub_433d80): heads directly away from the target, sliding along a building or round another man.
// - throw (sub_434220): winds up, then throws a grenade at the target, give or take a pixel per 4 px of range.

import { touch, type Body, type Shape } from './collide.js';
import { ANGLE_MASK, FIXED_SHIFT, ONE, TILE_SHIFT, cos, distance, headingTo, mul, sin } from './fixed.js';
import { gateShapes, type Gate } from './gates.js';
import { GRID, buildingBody, type World } from './map.js';
import type { Rng } from './rng.js';
import { LAND, groundAt } from './shore.js';
import { VEHICLES, airborne, type Vehicle } from './vehicle.js';

/** Walking speed, a fifth of a pixel a tick (DAT_0044ea9c), and the animation speed (DAT_0044eaa4). */
export const SOLDIER_SPEED = 0x3333;
export const SOLDIER_ANIM_SPEED = 0x3333;
/** A man runs from a vehicle within 256 px (sub_434350). */
export const SOLDIER_ALERT = 0x1000000;
/** He throws at an enemy closer than 96 px, and when he stops to throw on his own, further than 64 px. */
export const SOLDIER_THROW_MAX = 0x600000;
export const SOLDIER_THROW_MIN = 0x400000;
/** Ticks a man lasts once nobody can see him (sub_433ab0: 120 past his last draw). */
export const SOLDIER_UNSEEN = 120;
/** Grenades a man carries (DAT_0044eab0, picked by rand(16)). */
const AMMO = [0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4];
/** Where a new man tries to stand round another he came out on top of (DAT_0044ead8), whole pixels. */
const ROUND: readonly (readonly [number, number])[] = [[-4, 0], [4, 0], [-4, -3], [4, -3], [0, -3], [-4, 1], [4, 1], [0, 1]];
/** The record flags (+0x0c) that say a building holds men: bits 16-19 and 20-23 give how many, 15 a prison. */
const HOLDS_MEN = 0xff8000;
const PRISON = 0x8000;

/**
 * Animations (+0x72) and their frames (+0x64, 16.16): 0 running (frames 0-5), 1 standing (runs up to 9),
 * 2 throwing (back to 6), 3 swimming (10-17), 4 treading water (18-19).
 */
export const RUN = 0;
export const STAND = 1;
export const THROW = 2;
export const SWIM = 3;
export const TREAD = 4;

/** His collision box (model 0x44e928, shape 0x44e8e8): 4 x 1.5 px, 2 px tall, and 7 px tall when swimming. */
const BOX: readonly number[] = [-0x20000, -0x18000, 0x20000, 0xccc];
const FLAGS = [0, 0, 1, 255];
const LAND_SHAPES: readonly Shape[] = [{ type: 2, flags: FLAGS, z: [0, 0x20000], offset: [0, 0], bounds: BOX }];
const WATER_SHAPES: readonly Shape[] = [{ type: 2, flags: FLAGS, z: [0, 0x70000], offset: [0, 0], bounds: BOX }];

export type SoldierState = 'place' | 'choose' | 'idle' | 'run' | 'throw' | 'wait';

export interface Soldier {
  /** Base whose man he is (+0x10), or -1 for a neutral building's. */
  base: number;
  /** His team in this match; -1 makes every vehicle an enemy. */
  team: number;
  x: number;
  y: number;
  /** 16.16 heading in 64 steps (+0x4c). */
  heading: number;
  state: SoldierState;
  /** Tick the current state lasts until (+0x60). */
  timer: number;
  /** The vehicle he is running from or throwing at (his parent link, +0x2c). */
  target: Vehicle | null;
  /** Grenades left (+0x70). */
  ammo: number;
  /** Heading steps added to "directly away" while running (+0x71). */
  jitter: number;
  anim: number;
  /** Animation frame, 16.16 (+0x64). */
  frame: number;
  /** In water (+0x73): he swims, and cannot throw. */
  water: boolean;
  /** Last tick someone could see him (+0x5c). */
  seen: number;
  /** Set when he is gone; the match removes him. */
  dead: boolean;
  /** Set with dead when he walked into a vehicle and was run over. */
  crushed: boolean;
}

export function soldierShapes(s: Soldier): readonly Shape[] {
  return s.water ? WATER_SHAPES : LAND_SHAPES;
}

/** A new man (sub_433a50), facing roughly up the screen. */
export function makeSoldier(base: number, team: number, x: number, y: number, tick: number, rng: Rng): Soldier {
  const ammo = AMMO[rng.below(16)]!;
  const heading = ((rng.below(8) - 4) & 63) << FIXED_SHIFT;
  return {
    base, team, x, y, heading, state: 'place', timer: 0, target: null, ammo, jitter: 0, anim: RUN, frame: 0x60000,
    water: false, seen: tick, dead: false, crushed: false,
  };
}

/**
 * How many men a building lets out (sub_434980): the record's two counts give n = high - low, and he lets out
 * n + rand(n). Returns where they stand: inside the building's first box, along its bottom edge and up into it.
 */
export function soldiersFrom(
  world: World, tile: number, rng: Rng, prisonersOf: (owner: number) => number = (owner) => owner ^ 1,
): { base: number; at: [number, number][] } | null {
  const def = world.defs[world.building[tile]!];
  if (!def || !(def.flags & HOLDS_MEN)) return null;
  const n = ((def.flags >> 20) & 15) - ((def.flags >> 16) & 15);
  if (n < 1) return null;
  const count = n + rng.below(n);
  const owner = world.owner[tile]!;
  const base = owner < 0 ? owner : def.flags & PRISON ? prisonersOf(owner) : owner;
  const body = buildingBody(world, tile);
  const box = def.shapes[0];
  const at: [number, number][] = [];
  for (let k = 0; k < count; k++) {
    if (!box) {
      at.push([body.x, body.y]);
      continue;
    }
    const left = box.bounds[0]!;
    const x = body.x + box.offset[0]! + left + rng.below((box.bounds[2]! - left) >> 17) * ONE;
    const y = body.y + box.offset[1]! - (rng.below(-box.bounds[1]!) & ~0xffff);
    at.push([x, y]);
  }
  return { base, at };
}

/** What a man can bump into besides buildings, all registered on the tile under their centre. */
export interface SoldierWorld {
  world: World;
  rng: Rng;
  tick: number;
  /** Vehicles in play (the players' current vehicles). Helicopters are in the air and miss him. */
  vehicles: readonly Vehicle[];
  gates: readonly Gate[];
  soldiers: readonly Soldier[];
}

/** What stopped a move (the man's +0x68 and +0x58, and the building's shape in DAT_0047c918). */
interface Bump {
  blocked: boolean;
  building: number;
  shape: Shape | null;
  other: Soldier | Gate | null;
}

const tileOf = (x: number, y: number) => (y >> TILE_SHIFT) * GRID + (x >> TILE_SHIFT);

/**
 * Whether a man at (x, y) touches anything (sub_42bd40 with the man's handlers): his 3 x 3 tiles in the same order
 * as a vehicle's, the building first and then the objects on each tile. A building stops him unless he is
 * walking out of one (sub_433c40); a vehicle runs him over (sub_433c60); another man or a gate stops him.
 */
function bump(sw: SoldierWorld, s: Soldier, x: number, y: number, throughBuildings: boolean): Bump {
  const out: Bump = { blocked: true, building: -1, shape: null, other: null };
  const limit = GRID << TILE_SHIFT;
  if (x < 0 || y < 0 || x >= limit || y >= limit) return out;
  const me: Body = { x, y, z: 0, heading: s.heading };
  const shapes = soldierShapes(s);
  const w = sw.world;
  const tx = x >> TILE_SHIFT;
  const ty = y >> TILE_SHIFT;
  for (const dy of [0, -1, 1]) {
    const cy = ty + dy;
    if (cy < 0 || cy >= GRID) continue;
    for (const dx of [0, -1, 1]) {
      const cx = tx + dx;
      if (cx < 0 || cx >= GRID) continue;
      const i = cy * GRID + cx;
      const def = w.defs[w.building[i]!];
      if (def && def.shapes.length) {
        const hit = touch(me, shapes, buildingBody(w, i), def.shapes);
        if (hit) {
          out.building = i;
          out.shape = hit.b;
          if (!throughBuildings) return out;
        }
      }
      for (const v of sw.vehicles) {
        if (airborne(v) || tileOf(v.x, v.y) !== i) continue;
        if (touch(me, shapes, { x: v.x, y: v.y, z: v.z, heading: v.heading }, VEHICLES[v.kind].shapes)) {
          s.dead = true;
          s.crushed = true;
          return out;
        }
      }
      for (const o of sw.soldiers) {
        if (o === s || o.dead || tileOf(o.x, o.y) !== i) continue;
        if (touch(me, shapes, { x: o.x, y: o.y, z: 0, heading: o.heading }, soldierShapes(o))) {
          out.other = o;
          return out;
        }
      }
      for (const g of sw.gates) {
        if (g.tile !== i) continue;
        if (touch(me, shapes, buildingBody(w, g.tile), gateShapes(g))) {
          out.other = g;
          return out;
        }
      }
    }
  }
  out.blocked = false;
  return out;
}

/** Moves a man by (dx, dy) unless something stops him (sub_42c830). Returns what he touched. */
function move(sw: SoldierWorld, s: Soldier, dx: number, dy: number, throughBuildings = false): Bump {
  const b = bump(sw, s, s.x + dx, s.y + dy, throughBuildings);
  if (!b.blocked && !s.dead) {
    s.x += dx;
    s.y += dy;
  }
  return b;
}

/** Turns a man to a heading and walks him a step at speed (sub_4341c0). True if he moved. */
function walk(sw: SoldierWorld, s: Soldier, heading: number, speed: number): boolean {
  s.heading = heading & ANGLE_MASK;
  return !move(sw, s, mul(speed, sin(s.heading)), -mul(speed, cos(s.heading))).blocked;
}

function onLand(sw: SoldierWorld, s: Soldier): boolean {
  return groundAt(sw.world, s.x, s.y) === LAND;
}

function inPlay(sw: SoldierWorld, v: Vehicle | null): v is Vehicle {
  return !!v && sw.vehicles.includes(v);
}

function enemy(s: Soldier, v: Vehicle): boolean {
  return s.team < 0 || v.team !== s.team;
}

function range(s: Soldier, v: Vehicle): number {
  return distance(v.x - s.x, v.y - s.y);
}

/** Within ±16 heading steps (a quarter turn either way) of the heading he wants. */
function near(want: number, h: number): boolean {
  const d = (want - h) & ANGLE_MASK;
  return d > 0x300000 || d < 0x100000;
}

type Think = (sw: SoldierWorld, s: Soldier, act: SoldierAction) => boolean;

/** What a man did this tick that the match acts on. */
export interface SoldierAction {
  /** He threw a grenade at this point. */
  throwAt: { x: number; y: number } | null;
}

/** Walking out of the building he appeared in (sub_434460). */
const place: Think = (sw, s) => {
  let b = bump(sw, s, s.x, s.y, false);
  if (s.dead) return false;
  if (b.building >= 0) {
    const dx = sin(s.heading) << 2;
    const dy = -cos(s.heading) << 2;
    // The original walks until he is clear; a cap keeps a man walled in from looping for ever.
    for (let k = 0; k < 64 && b.building >= 0; k++) {
      b = move(sw, s, dx, dy, true);
      if (s.dead) return false;
    }
  }
  const other = b.other;
  if (other) {
    if (!('anim' in other)) {
      s.dead = true;
      return false;
    }
    let placed = false;
    for (const [ox, oy] of ROUND) {
      const dx = other.x - s.x + ox * ONE;
      const dy = other.y - s.y + oy * ONE;
      if (!move(sw, s, dx, dy).blocked || (!s.dead && !move(sw, s, dx, dy).blocked)) {
        placed = true;
        break;
      }
      if (s.dead) return false;
    }
    if (!placed) {
      s.dead = true;
      return false;
    }
  }
  s.state = 'choose';
  return true;
};

/** Picks the nearest vehicle in play (sub_434350): within 256 px he runs from it, else he idles. */
const choose: Think = (sw, s) => {
  let best: Vehicle | null = null;
  let bestRange = 0x7fffffff;
  for (const v of sw.vehicles) {
    const d = range(s, v);
    if (d < bestRange) {
      bestRange = d;
      best = v;
    }
  }
  s.target = best;
  const alert = bestRange <= SOLDIER_ALERT;
  s.state = alert ? 'run' : 'idle';
  s.timer = sw.tick + 30 + sw.rng.below(90);
  if (alert) s.jitter = sw.rng.below(5) - 2;
  return true;
};

/** Standing about, or treading water (sub_433d40). */
const idle: Think = (sw, s) => {
  if (s.timer < sw.tick) {
    s.state = 'choose';
    return true;
  }
  s.water = !onLand(sw, s);
  s.anim = s.water ? TREAD : STAND;
  return false;
};

/** Running from the target (sub_433d80). */
const run: Think = (sw, s) => {
  const t = s.target;
  if (!inPlay(sw, t) || s.timer < sw.tick) {
    if (inPlay(sw, t) && enemy(s, t) && s.ammo > 0 && onLand(sw, s) && sw.rng.below(3) === 0) {
      const d = range(s, t);
      if (d < SOLDIER_THROW_MAX && d > SOLDIER_THROW_MIN) {
        s.state = 'throw';
        return true;
      }
    }
    s.state = 'choose';
    return true;
  }
  const want = (headingTo(t.x - s.x, t.y - s.y) + ((s.jitter + 32) << FIXED_SHIFT)) & ANGLE_MASK;
  s.water = !onLand(sw, s);
  s.heading = want;
  s.jitter = 0;
  const speed = SOLDIER_SPEED;
  const first = move(sw, s, mul(speed, sin(want)), -mul(speed, cos(want)));
  if (s.dead) return false;
  let moved = !first.blocked;
  if (first.blocked && first.building >= 0 && first.shape) {
    // Stopped by a building: slide along its box, up or down the screen if he is beside it, across if above or below.
    const body = buildingBody(sw.world, first.building);
    const box = first.shape;
    const bx = body.x + box.offset[0]!;
    const by = body.y + box.offset[1]!;
    moved = false;
    if (s.x < bx + box.bounds[0]! || bx + box.bounds[2]! < s.x) {
      moved = walk(sw, s, want > 0x2fffff || want < 0x100000 ? 0 : 0x200000, speed);
    }
    if (!moved && !s.dead && (s.y < by + box.bounds[1]! || by + box.bounds[3]! < s.y)) {
      moved = walk(sw, s, want < 0x200000 ? 0x100000 : 0x300000, speed);
    }
  } else if (first.blocked && first.other) {
    // Stopped by another man or a gate: try directly away from it, then either side of that, if near his way.
    const o = first.other;
    const ox = 'anim' in o ? o.x : buildingBody(sw.world, o.tile).x;
    const oy = 'anim' in o ? o.y : buildingBody(sw.world, o.tile).y;
    let h = (headingTo(ox - s.x, oy - s.y) + 0x200000) & ANGLE_MASK;
    if (near(want, h)) moved = walk(sw, s, h, speed);
    h = (h + 0x100000) & ANGLE_MASK;
    if (!moved && !s.dead && near(want, h)) moved = walk(sw, s, h, speed);
    h = (h + 0x200000) & ANGLE_MASK;
    if (!moved && !s.dead && near(want, h)) moved = walk(sw, s, h, speed);
  }
  if (s.dead) return false;
  s.anim = moved ? (s.water ? SWIM : RUN) : s.water ? TREAD : STAND;
  if (!moved && enemy(s, t) && s.ammo > 0 && s.frame === 0x90000 && s.anim === STAND && range(s, t) < SOLDIER_THROW_MAX) {
    s.state = 'throw';
    return true;
  }
  return false;
};

/** Winding up and throwing (sub_434220). */
const throwing: Think = (sw, s, act) => {
  const t = s.target;
  if (!inPlay(sw, t)) {
    s.state = 'choose';
    return true;
  }
  s.anim = THROW;
  if (s.frame > 0x60000) return false;
  s.ammo--;
  s.frame = 0x60000;
  s.state = 'wait';
  s.timer = sw.tick + sw.rng.below(60) + 120;
  const d = range(s, t);
  if (d > SOLDIER_THROW_MAX) {
    s.state = 'choose';
    return true;
  }
  const spread = d >> 18;
  const ex = sw.rng.below(spread) - sw.rng.below(spread);
  const ey = sw.rng.below(spread) - sw.rng.below(spread);
  act.throwAt = { x: t.x + ex * ONE, y: t.y + ey * ONE };
  return false;
};

/** Standing after a throw (sub_434320). */
const wait: Think = (sw, s) => {
  s.anim = STAND;
  if (inPlay(sw, s.target) && sw.tick <= s.timer) return false;
  s.state = 'choose';
  return true;
};

const THINK: Record<SoldierState, Think> = { place, choose, idle, run, throw: throwing, wait };

/**
 * One tick of a man (sub_433ab0): think until a state is done for the tick, then animate. Men nobody has seen
 * for 120 ticks are removed (dead is set).
 */
export function stepSoldier(sw: SoldierWorld, s: Soldier): SoldierAction {
  const act: SoldierAction = { throwAt: null };
  if (s.target && !inPlay(sw, s.target)) s.target = null;
  // States hand over to each other within a tick; a few rounds is always enough.
  for (let k = 0; k < 8 && THINK[s.state](sw, s, act); k++) {
    if (s.dead) return act;
  }
  if (s.dead) return act;
  if (sw.tick > s.seen + SOLDIER_UNSEEN) {
    s.dead = true;
    return act;
  }
  animate(s);
  return act;
}

/** The frame counters of sub_433ab0, one animation speed for all. */
function animate(s: Soldier): void {
  const f = s.frame;
  const step = SOLDIER_ANIM_SPEED;
  let n: number;
  switch (s.anim) {
    case RUN:
      n = f + step;
      s.frame = n > 0x5ffff ? n % 0x60000 : n;
      return;
    case STAND:
      n = f + step;
      s.frame = n > 0x8ffff ? 0x90000 : n;
      return;
    case THROW:
      if (f < 0x60000) s.frame = Math.min(f + step, 0x60000);
      else s.frame = Math.max(f - step, 0x60000);
      return;
    case SWIM:
      n = f + step;
      if (n > 0x11ffff) n -= (n - 0xa0000) & ~0x7ffff;
      s.frame = Math.max(n, 0xa0000);
      return;
    case TREAD:
      n = f + step;
      if (n > 0x13ffff) n -= (n - 0x120000) & ~0x1ffff;
      s.frame = Math.max(n, 0x120000);
      return;
    default:
      s.anim = RUN;
      s.frame = 0;
  }
}
