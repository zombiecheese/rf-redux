import { touch, type Body, type Shape } from './collide.js';
import { ANGLE_MASK, ONE, TILE_SHIFT, approach, cos, mul, sin, turnToward } from './fixed.js';
import { GRID, buildingBody, terrainAt, type World } from './map.js';
import { HELI_LOW, heliFlying, makeHeli, stepHeli, type HeliState } from './heli.js';
import { Rng } from './rng.js';
import { DEEP, LAND, groundAt, type Ground } from './shore.js';

export type VehicleKind = 'tank' | 'jeep' | 'asv' | 'heli';
export const VEHICLE_KINDS: readonly VehicleKind[] = ['tank', 'jeep', 'asv', 'heli'];

export interface WeaponDef {
  /** Projectile type: an index into PROJECTILES, or 'grenade' / 'mine' for the classes of their own. */
  projectile: number | 'grenade' | 'mine';
  /** Ticks between shots (weapon slot +0x10). */
  reload: number;
  /** Rounds carried at launch (weapon slot +0x14). */
  ammo: number;
}

/**
 * The original vehicle definition blocks (tank at VA 0x4456b8, then jeep, ASV and heli 0x2E8 apart).
 * Values are the raw 16.16 words; see the mechanics spec, Vehicles, for where each is read.
 */
export interface VehicleDef {
  /** Type id at +0x00. */
  type: number;
  /** Top speed forwards, pixels per tick (+0x168). */
  maxForward: number;
  /** Top speed in reverse, negative (+0x16C). */
  maxReverse: number;
  /** Speed gained per tick while accelerating (+0x170). */
  accel: number;
  /** Speed lost per tick while braking (+0x174). */
  brake: number;
  /** Heading steps per tick, 64 steps to a full turn (+0x178). */
  turnRate: number;
  /** Taken off every hit before it counts (+0x24). */
  armour: number;
  /** Health at launch (+0x28). */
  health: number;
  /** Fuel at launch, 16.16 (+0x210). */
  fuel: number;
  /** Ticks after the vehicle is lost before the player is sent back to the bunker (+0x260). */
  respawnDelay: number;
  /** Weapon slots at +0x194 and +0x1C8. */
  weapons: readonly WeaponDef[];
  /** How deep it sinks in deep water before it is lost (+0x158). */
  sinkDepth: number;
  /** Half the size used for projectile and mine hits, in world units. */
  radius: number;
  /** The body model's collision shapes (model word 2). */
  shapes: readonly Shape[];
  flies: boolean;
}

export const VEHICLES: Record<VehicleKind, VehicleDef> = {
  tank: {
    type: 0, maxForward: 0x10ccc, maxReverse: -0x6666, accel: 0xccc, brake: 0x666, turnRate: 0x4000,
    armour: 0x4ccc, health: 0x160000, fuel: 400 * ONE, respawnDelay: 120,
    weapons: [{ projectile: 0, reload: 20, ammo: 150 }],
    sinkDepth: 0xe0000, radius: 13 * ONE, flies: false,
    shapes: [{ type: 3, flags: [0, 0, 2, 39], z: [0, 0xa0000], offset: [0, 0], bounds: [-0xc0000, -0xc0000, 0xc0000, 0xc0000], verts: [[-0x78000, -0xb4000], [0x78000, -0xb4000], [0x78000, 0xb4000], [-0x78000, 0xb4000]], edges: [0, 1, 2, 3] }],
  },
  jeep: {
    type: 1, maxForward: 0x16666, maxReverse: -0xcccc, accel: 0xccc, brake: 0x28f, turnRate: 0x8000,
    armour: 0, health: 0x10000, fuel: 500 * ONE, respawnDelay: 120,
    weapons: [{ projectile: 'grenade', reload: 30, ammo: 16 }],
    sinkDepth: 0xd0000, radius: 8 * ONE, flies: false,
    shapes: [{ type: 3, flags: [0, 0, 2, 39], z: [0, 0xa0000], offset: [0, 0], bounds: [-0xc0000, -0xc0000, 0xc0000, 0xc0000], verts: [[-0x48000, -0x78000], [0x48000, -0x78000], [0x48000, 0x78000], [-0x48000, 0x78000]], edges: [0, 1, 2, 3] }],
  },
  asv: {
    type: 2, maxForward: 0xb851, maxReverse: -0x4ccc, accel: 0xa3d, brake: 0x666, turnRate: 0x3333,
    armour: 0x8000, health: 0x1a0000, fuel: 320 * ONE, respawnDelay: 120,
    weapons: [{ projectile: 8, reload: 30, ammo: 100 }, { projectile: 'mine', reload: 140, ammo: 10 }],
    sinkDepth: 0xe0000, radius: 16 * ONE, flies: false,
    shapes: [{ type: 3, flags: [0, 0, 2, 39], z: [0, 0xc0000], offset: [0, 0], bounds: [-0xc0000, -0xc0000, 0xc0000, 0xc0000], verts: [[-0x78000, -0xc0000], [0x78000, -0xc0000], [0x78000, 0xb4000], [-0x78000, 0xb4000]], edges: [0, 1, 2, 3] }],
  },
  heli: {
    type: 3, maxForward: 0x1cccc, maxReverse: -0x9999, accel: 0x51e, brake: 0x51e, turnRate: 0xc000,
    armour: 0x3333, health: 0xf0000, fuel: 400 * ONE, respawnDelay: 200,
    weapons: [{ projectile: 7, reload: 15, ammo: 100 }, { projectile: 6, reload: 30, ammo: 50 }],
    sinkDepth: 0xe0000, radius: 8 * ONE, flies: true,
    shapes: [{ type: 3, flags: [0, 0, 2, 39], z: [0, 0xa0000], offset: [0, 0], bounds: [-0xc0000, -0x100000, 0xc0000, 0x230000], verts: [[0, 0x1e9999], [-0xa3333, 0], [-0xa3333, -0xd9999], [0xa3333, -0xd9999], [0xa3333, 0]], edges: [0, 1, 2, 3, 4] }],
  },
};

/** One tick of a player's controls. The original packs these into command bits 1, 2, 4, 8 and 16. */
export interface VehicleInput {
  throttle: -1 | 0 | 1;
  turn: -1 | 0 | 1;
  /** The three fire buttons (the command bit groups 0xe0, 0x700 and 0x3800 that sub_40b980 hands to each). */
  fire?: boolean;
  fire2?: boolean;
  fire3?: boolean;
  /** Tank turret: swing left (command bit 0x4000) or right (0x8000); both together bring it back to centre. */
  turretLeft?: boolean;
  turretRight?: boolean;
}

export interface Vehicle {
  kind: VehicleKind;
  /** Player id that drives it. */
  player: number;
  team: number;
  base: number;
  x: number;
  y: number;
  heading: number;
  speed: number;
  health: number;
  fuel: number;
  ammo: number[];
  /** Tick at which each weapon can fire again. */
  readyAt: number[];
  /** Tank turret angle relative to the hull, and the angle it is swinging to (player record +0x58, +0x5C). */
  turret: number;
  turretTarget: number;
  /** Ground under it after its last move (record +0x70). */
  ground: Ground;
  /** Height: below 0 while sinking in deep water (+0x48). */
  z: number;
  /** Jeep only: tyres blown up to float (record +0x84, the jeep's second fire button, sub_40dfe0). */
  tyres: boolean;
  /** Second fire button held last tick, so the tyres toggle once per press. */
  fire2Held: boolean;
  fire3Held: boolean;
  /** The helicopter's picked weapon (flag 0x10000000): 0 the gun, 1 the missiles. */
  weapon: number;
  /** Tile of the last building it bumped into, or -1 (player record +0xA4). */
  bumped: number;
  /** The pad part it last drove onto (record +0x68 and +0x6C): a depot's, or a gate's trigger zone. */
  pad: { tile: number; part: number } | null;
  /** Buildings it crushed this tick (bushes and tents); the match destroys them. */
  crushed: number[];
  /** Soldiers it touched this tick (their obstacle owners); the match kills them. */
  ranOver: unknown[];
  /** Flag building a jeep touched this tick, or -1; the match hands it the flag. */
  flagTouched: number;
  /** Tick from which the next resupply ding may sound (record +0x74). */
  resupplyAt: number;
  /** Helicopter only: take-off, flight and landing (heli.ts). */
  heli: HeliState | null;
  /**
   * Tank and ASV: the barrel's (or launcher's) pitch and the pitch it is turning to (record +0x50, +0x54), and a
   * shot waiting for it to get there (+0x60 tank, +0x5c ASV).
   */
  barrel: number;
  barrelTarget: number;
  pending: boolean;
  /** ASV: the launcher tube that fires next, 0-2, or below 0 while it reloads after three (record +0x58). */
  tube: number;
  /** Helicopter: which gun fires next (flag 0x8000000): 0 the right, 1 the left. */
  gunSide: number;
}

export function makeVehicle(kind: VehicleKind, player: number, team: number, base: number, x: number, y: number): Vehicle {
  const d = VEHICLES[kind];
  return {
    kind, player, team, base, x, y, heading: 0, speed: 0, health: d.health, fuel: d.fuel,
    ammo: d.weapons.map((w) => w.ammo), readyAt: d.weapons.map(() => 0), turret: 0, turretTarget: 0,
    ground: LAND, z: 0, tyres: false, fire2Held: false, fire3Held: false, weapon: 0, bumped: -1, pad: null, crushed: [], ranOver: [], flagTouched: -1,
    resupplyAt: 0, heli: kind === 'heli' ? makeHeli() : null, barrel: 0, barrelTarget: 0, pending: false, tube: 0, gunSide: 0,
  };
}

const ROAD_FIRST = 73;
const ROAD_END = 90;
const ROAD_FACTOR = 0x13333;

/** Speed factors in water (sub_40c390): 0.75 wading, 0.25 for a jeep floating, and 0.01 for a floating jeep on land. */
export const WATER_FACTOR = 0xc000;
export const FLOAT_FACTOR = 0x4000;
export const BEACHED_FACTOR = 0x28f;
/** Sinking and surfacing speed in water (sub_40cf90). */
export const SINK_RATE = 0x6666;

/**
 * Speed factor for the ground under a vehicle (sub_40c390), by the ground it was on after its last move: water
 * slows it (see WATER_FACTOR), roads (terrain 73-89) and bridges are 1.2 times faster, everything else 1.0.
 */
export function groundFactor(world: World, v: Vehicle): number {
  if (VEHICLES[v.kind].flies) return ONE;
  if (v.ground !== LAND) return v.tyres ? FLOAT_FACTOR : WATER_FACTOR;
  if (v.tyres) return BEACHED_FACTOR;
  const i = (v.y >> TILE_SHIFT) * GRID + (v.x >> TILE_SHIFT);
  const t = world.terrain[i]! & 127;
  if (t >= ROAD_FIRST && t < ROAD_END) return ROAD_FACTOR;
  const b = world.building[i]!;
  return b === 74 || b === 75 ? ROAD_FACTOR : ONE;
}

/** Buildings bots should steer round: those that block ground vehicles. Water does not count. */
export function isSolid(world: World, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= GRID || ty >= GRID) return true;
  return world.defs[world.building[ty * GRID + tx]!]?.solid ?? false;
}

/** Tiles with deep water somewhere on them (open water and the deep-edged shore tiles 40-51), not bridged. */
export function hasDeepWater(world: World, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= GRID || ty >= GRID) return true;
  const t = terrainAt(world, tx, ty) & 127;
  const b = world.building[ty * GRID + tx]!;
  return (t === 2 || (t >= 40 && t <= 51)) && b !== 74 && b !== 75;
}

/** Something besides buildings a vehicle can run into: another vehicle, or a gate's moving halves. */
export interface Obstacle {
  body: Body;
  shapes: readonly Shape[];
  /** The tile it is registered on (its centre's). */
  tile: number;
  /** The vehicle itself, so a vehicle never collides with its own entry. */
  owner?: unknown;
  /** A soldier: touching him runs him over (sub_433c60) and does not stop the vehicle. */
  soft?: boolean;
}

/** Contact callback results (sub_42bb10): 1 stops the vehicle, 8 lets it through. */
const BLOCK = 1;
const PASS = 8;
/** Crushing speed for bushes and tents: half a pixel a tick. */
export const CRUSH_SPEED = 0x8000;
const PAD = 2;
const PLANTER_TOP = 4;

/** What a building's contact callback says when vehicle v touches part b of the building on tile i. */
function contact(world: World, v: Vehicle, i: number, b: Shape): number {
  const def = world.defs[world.building[i]!]!;
  const jeep = v.kind === 'jeep';
  let result = 0;
  switch (def.contact) {
    case 'rock':
      result = jeep ? 0 : PASS;
      break;
    case 'scenery':
      if (b.flags[3] === PLANTER_TOP) result = PASS;
      else if (jeep) result = 0;
      else if (v.speed > CRUSH_SPEED) result = PASS;
      else result = BLOCK;
      if (result === PASS && b.flags[3] !== PLANTER_TOP && !v.crushed.includes(i)) v.crushed.push(i);
      break;
    case 'tent':
      result = v.speed > CRUSH_SPEED ? PASS : BLOCK;
      if (result === PASS && !v.crushed.includes(i)) v.crushed.push(i);
      break;
    case 'pad':
      if (b.flags[0]! & PAD) {
        v.pad = { tile: i, part: def.shapes.indexOf(b) };
        result = PASS;
      }
      break;
    case 'flag':
      if (jeep) v.flagTouched = i;
      break;
  }
  if (result & BLOCK) return BLOCK;
  if (result & PASS) return PASS;
  // The vehicle class's own building handler (sub_40c130) remembers the building and stops.
  v.bumped = i;
  return BLOCK;
}

/**
 * Whether vehicle v would be stopped at (x, y) facing heading (sub_42bd40): the tiles of its 3 x 3 neighbourhood,
 * its own row first, then the row above and the row below, and in each row its own column, then left, then right.
 * On each tile the building is tried first, then the obstacles registered there.
 */
function stopped(world: World, v: Vehicle, x: number, y: number, heading: number, obstacles: readonly Obstacle[]): boolean {
  const limit = GRID << TILE_SHIFT;
  if (x < 0 || y < 0 || x >= limit || y >= limit) return true;
  const me: Body = { x, y, z: v.z, heading };
  const shapes = VEHICLES[v.kind].shapes;
  const tx = x >> TILE_SHIFT;
  const ty = y >> TILE_SHIFT;
  for (const dy of [0, -1, 1]) {
    const cy = ty + dy;
    if (cy < 0 || cy >= GRID) continue;
    for (const dx of [0, -1, 1]) {
      const cx = tx + dx;
      if (cx < 0 || cx >= GRID) continue;
      const i = cy * GRID + cx;
      const def = world.defs[world.building[i]!];
      if (def && def.shapes.length) {
        const hit = touch(me, shapes, buildingBody(world, i), def.shapes);
        if (hit && contact(world, v, i, hit.b) === BLOCK) return true;
      }
      for (const o of obstacles) {
        if (o.tile !== i || o.owner === v) continue;
        if (!touch(me, shapes, o.body, o.shapes)) continue;
        // A soldier is run over; any other object stops it (sub_40c150 answers 5 for anything a vehicle hits).
        if (!o.soft) return true;
        if (!v.ranOver.includes(o.owner)) v.ranOver.push(o.owner);
      }
    }
  }
  return false;
}

/**
 * Moves a vehicle one tick, following the original's ground movement (sub_40c190). Throttle accelerates
 * towards top speed (scaled by the ground factor), reverse towards the reverse limit, and with neither the
 * vehicle brakes towards a stop. Heading 0 points north and headings increase clockwise.
 */
/** The tank turret swings 0x4CCC (0.3 heading steps) a tick. */
export const TURRET_SWING = 0x4ccc;

/**
 * Swings the tank turret (sub_40d460): either key moves the target one step's swing past where the turret is,
 * both keys set it back to centre, and the turret then turns towards the target.
 */
function stepTurret(v: Vehicle, input: VehicleInput): void {
  if (input.turretLeft && input.turretRight) v.turretTarget = 0;
  else if (input.turretLeft) v.turretTarget = (v.turret - TURRET_SWING) & ANGLE_MASK;
  else if (input.turretRight) v.turretTarget = (v.turret + TURRET_SWING) & ANGLE_MASK;
  v.turret = turnToward(v.turret, v.turretTarget, TURRET_SWING);
}

/**
 * Moves a vehicle one tick (sub_40b980 with the movement in sub_40c190). Obstacles are the other things it can
 * run into besides buildings. Returns true when it is standing still: no speed and no turn.
 */
export function stepVehicle(
  v: Vehicle, input: VehicleInput, world: World, obstacles: readonly Obstacle[] = [], rng: Rng = new Rng(1),
): boolean {
  const d = VEHICLES[v.kind];
  if (d.flies) {
    const heading = v.heading;
    const x = v.x;
    const y = v.y;
    stepHeli(v, d, { throttle: input.throttle, turn: input.turn, strafeLeft: input.turretLeft, strafeRight: input.turretRight }, rng);
    // Flying over everything: the original's shapes at 50 px meet nothing but other aircraft. Inferred. Nothing
    // keeps it over the map; the submarine deals with one that strays (sub.ts).
    v.fuel = Math.max(0, v.fuel - (Math.abs(v.speed) >> 5));
    return v.x === x && v.y === y && v.heading === heading;
  }
  if (v.kind === 'tank') stepTurret(v, input);
  const heading = v.heading;
  const factor = groundFactor(world, v);
  if (input.throttle > 0) {
    v.speed = Math.min(v.speed + d.accel, mul(d.maxForward, factor));
  } else if (input.throttle < 0) {
    v.speed = Math.max(v.speed - d.accel, mul(d.maxReverse, factor));
  } else {
    v.speed = approach(v.speed, 0, d.brake);
  }
  if (input.turn) v.heading = (v.heading + input.turn * d.turnRate) & ANGLE_MASK;

  // Fuel burns in proportion to speed (sub_40c540 takes |speed| / 32 each tick).
  v.fuel = Math.max(0, v.fuel - (Math.abs(v.speed) >> 5));

  // Speed is 16.16 pixels and a pixel is 2^16 world units, so the product is already in world units.
  const dx = mul(v.speed, sin(v.heading));
  const dy = -mul(v.speed, cos(v.heading));
  if (v.speed === 0) {
    // Turning on the spot: a turn that would hit something is undone.
    if (v.heading !== heading && stopped(world, v, v.x, v.y, v.heading, obstacles)) v.heading = heading;
  } else if (stopped(world, v, v.x + dx, v.y + dy, v.heading, obstacles)) {
    // Blocked (sub_42c830 undoes the move). If it was turning, it tries the same move without the turn, and if
    // that is blocked too but where it stands is clear, it just stays put. Otherwise it bounces back.
    let bounce = true;
    if (v.heading !== heading) {
      v.heading = heading;
      if (!stopped(world, v, v.x + dx, v.y + dy, heading, obstacles)) {
        v.x += dx;
        v.y += dy;
        bounce = false;
      } else if (!stopped(world, v, v.x, v.y, heading, obstacles)) {
        bounce = false;
      }
    }
    if (bounce) v.speed = -v.speed >> 2;
  } else {
    v.x += dx;
    v.y += dy;
  }
  stepWater(v, world);
  return v.speed === 0 && v.heading === heading;
}

/**
 * Water (sub_40cef0 and sub_40cf90). A vehicle in deep water sinks 0x6666 a tick, unless it is a jeep floating
 * on its tyres; in shallow water it comes back up, and on land it is out at once. sunk() says when it has gone
 * under.
 */
function stepWater(v: Vehicle, world: World): void {
  v.ground = groundAt(world, v.x, v.y, 0);
  if (v.ground === DEEP && !v.tyres) v.z -= SINK_RATE;
  else if (v.ground === LAND) v.z = 0;
  else if (v.z < 0) v.z = Math.min(0, v.z + SINK_RATE);
}

/** A helicopter up in the air: only shots aimed in 3D or fired from the air reach it, and it runs over nothing. */
export function airborne(v: Vehicle): boolean {
  return v.heli !== null && v.z >= HELI_LOW;
}

/** A helicopter taking off or landing, which can neither fire nor dock (sub_40b980 returns early). */
export function busy(v: Vehicle): boolean {
  return v.heli !== null && !heliFlying(v.heli);
}

/** Gone under: sunk to its sink depth in whole pixels (sub_40cf90). */
export function sunk(v: Vehicle): boolean {
  return v.z >> 16 <= -(VEHICLES[v.kind].sinkDepth >> 16);
}

/**
 * The jeep's second button (sub_40dfe0): in water it blows the tyres up to float; out of deep water it lets them
 * down again. Returns what happened, for the sound.
 */
export function toggleTyres(v: Vehicle, world: World): 'out' | 'in' | null {
  const g = groundAt(world, v.x, v.y, 0);
  if (g !== LAND && !v.tyres) {
    v.tyres = true;
    return 'out';
  }
  if (g !== DEEP && v.tyres) {
    v.tyres = false;
    return 'in';
  }
  return null;
}
