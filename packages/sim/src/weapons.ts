import { ANGLE_MASK, ONE, TILE_SHIFT, cos, div, fineCos, fineSin, mul, sin, sqrt, turnToward } from './fixed.js';
import { GRID } from './map.js';
import type { Vehicle } from './vehicle.js';

/**
 * Projectile types from the original's table at VA 0x4489a0 (60 bytes each, used by sub_415480).
 * - speed is word 3 (pixels per tick, 16.16) and damage word 9 (+0x24), which the hit handlers pass to buildings
 *   (sub_414dd0) and objects (sub_414e60).
 * - threeD is bit 0 of word 2: the muzzle offset is turned by the pitch as well as the heading.
 * - fine is bit 1 of word 2: the pitch is turned with sub_41ae10's fsin on the fine circle (a quarter of the
 *   angle it says, as the pitch is passed unscaled), and goes on turning by pitchRate a tick. Otherwise the pitch
 *   uses the 64-step table and eases back to level by pitchRate a tick (sub_414b10).
 * - pitchRate is word 10 (+0x28) and life byte +0x38, the ticks it lasts.
 * Type 3 is not a shot but a probe (class 0x4488c8): see clearShot in match.ts.
 */
export interface ProjectileDef {
  speed: number;
  damage: number;
  threeD: boolean;
  fine: boolean;
  pitchRate: number;
  life: number;
}

export const PROJECTILES: readonly ProjectileDef[] = [
  { speed: 0x30000, damage: 0x10000, threeD: false, fine: false, pitchRate: 0x2666, life: 80 }, // 0: tank shell
  { speed: 0x28000, damage: 0x20000, threeD: false, fine: false, pitchRate: 0x1999, life: 100 }, // 1
  { speed: 0x24ccc, damage: 0x40000, threeD: true, fine: false, pitchRate: 0x1999, life: 90 }, // 2
  { speed: 0x60000, damage: 0x10000, threeD: true, fine: false, pitchRate: 0, life: 90 }, // 3: line-of-fire probe
  { speed: 0x40000, damage: 0x18000, threeD: true, fine: false, pitchRate: 0, life: 150 }, // 4: gun tower shell
  { speed: 0x30000, damage: 0x10000, threeD: false, fine: false, pitchRate: 0x28f, life: 90 }, // 5
  { speed: 0x30000, damage: 0x40000, threeD: false, fine: true, pitchRate: 0x6666, life: 100 }, // 6: heli missile
  { speed: 0x30000, damage: 0x10000, threeD: false, fine: false, pitchRate: 0, life: 80 }, // 7: heli gun
  { speed: 0x24ccc, damage: 0x20000, threeD: true, fine: true, pitchRate: 0, life: 90 }, // 8: ASV missile
  { speed: 0x24ccc, damage: 0x20000, threeD: true, fine: false, pitchRate: 0x1c28, life: 90 }, // 9: ASV missile up
  { speed: 0x30000, damage: 0x1900000, threeD: false, fine: false, pitchRate: 0x1c28, life: 90 }, // 10: death missile
  { speed: 0x38000, damage: 0xf333, threeD: true, fine: false, pitchRate: 0, life: 90 }, // 11: drone gun
];

/** Shots go no higher than 55 px (sub_414b10). */
export const SHOT_CEILING = 0x370000;

export interface Projectile {
  /** Index into PROJECTILES. */
  kind: number;
  owner: number;
  team: number;
  x: number;
  y: number;
  z: number;
  /** Where it was before its last move: the shot sweeps the line between (sub_41e5f0). */
  from: readonly [number, number, number];
  heading: number;
  /** Pitch (+0x60): down is positive, so a shot fired up has a pitch just under a whole turn. */
  pitch: number;
  /** Speed (+0x54): its type's, plus a helicopter's own speed when fired from one (sub_4155a0). */
  speed: number;
  vx: number;
  vy: number;
  vz: number;
  damage: number;
  /** Life left (+0x70); it goes when this would reach 0. */
  ticksLeft: number;
  /** Fired with a pitch by a type that turns it (flag 0x2000000). */
  turning: boolean;
  /** Tile the shot was fired from, which it cannot hit (a gun tower's own tile), or -1. */
  fromTile: number;
  /** What a death missile homes on (+0x2c). */
  target?: Vehicle;
}

export type Vec3 = readonly [number, number, number];

/**
 * A 3 x 3 rotation as the original keeps them: nine 16.16 words, row by row, applied to row vectors (sub_41e770:
 * out = v x M). Heading matrices come from the table at 0x48a4b0 (64 steps), pitch matrices from the table at
 * 0x481710 (64 steps) or from sub_41ae10 (fine angles).
 */
type Matrix = readonly number[];

function headingMatrix(heading: number): Matrix {
  const s = sin(heading);
  const c = cos(heading);
  return [c, s, 0, -s, c, 0, 0, 0, ONE];
}

/** A turn about the x axis: the 64-step table (0x481710), or fsin on the fine circle (sub_41ae10). */
function pitchMatrix(pitch: number, fine: boolean): Matrix {
  const s = fine ? fineSin(pitch) : sin(pitch);
  const c = fine ? fineCos(pitch) : cos(pitch);
  return [ONE, 0, 0, 0, c, s, 0, -s, c];
}

/** Matrix product a x b (sub_410d00). */
function times(a: Matrix, b: Matrix): Matrix {
  const out = new Array<number>(9);
  for (let r = 0; r < 3; r++) {
    const [p, q, t] = [a[r * 3]!, a[r * 3 + 1]!, a[r * 3 + 2]!];
    out[r * 3] = mul(p, b[0]!) + mul(t, b[6]!) + mul(q, b[3]!);
    out[r * 3 + 1] = mul(t, b[7]!) + mul(q, b[4]!) + mul(p, b[1]!);
    out[r * 3 + 2] = mul(p, b[2]!) + mul(t, b[8]!) + mul(q, b[5]!);
  }
  return out;
}

/** Row vector v x M (sub_41e770 and sub_410c60). */
export function turn(v: Vec3, m: Matrix): [number, number, number] {
  return [
    mul(v[0], m[0]!) + mul(v[2], m[6]!) + mul(v[1], m[3]!),
    mul(v[2], m[7]!) + mul(v[0], m[1]!) + mul(v[1], m[4]!),
    mul(v[1], m[5]!) + mul(v[2], m[8]!) + mul(v[0], m[2]!),
  ];
}

/** The turn for a pitch and heading: the heading alone when level. */
export function aim(heading: number, pitch: number, fine: boolean): Matrix {
  const h = headingMatrix(heading);
  return pitch === 0 ? h : times(pitchMatrix(pitch, fine), h);
}

/**
 * A point on a vehicle's model turned by a barrel's pitch, plus where the barrel is fixed (sub_402bf0): the pitch
 * is on the heading circle, so it is scaled up 4 times for the fine one.
 */
export function muzzle(tip: Vec3, pivot: Vec3, pitch: number): Vec3 {
  const t = pitch === 0 ? tip : turn(tip, pitchMatrix(pitch << 2, true));
  return [t[0] + pivot[0], t[1] + pivot[1], t[2] + pivot[2]];
}

/** Sets the velocity from the speed, heading and pitch (sub_4148f0, sub_414b10, sub_4155a0). */
function setVelocity(p: Projectile): void {
  const def = PROJECTILES[p.kind]!;
  const [vx, vy, vz] = turn([0, -p.speed, 0], aim(p.heading, p.pitch, def.fine));
  p.vx = vx;
  p.vy = vy;
  p.vz = vz;
}

/**
 * Fires a projectile (sub_415480 creating it with sub_4148f0). offset is the muzzle on the shooter's model: turned
 * by the heading, and for threeD types also by the pitch, though their height is added afterwards unturned.
 */
export function fireProjectile(
  kind: number, owner: number, team: number, origin: Vec3, offset: Vec3, heading: number, pitch: number,
): Projectile {
  const def = PROJECTILES[kind] ?? PROJECTILES[0]!;
  let at: Vec3;
  if (!def.threeD) {
    at = turn(offset, headingMatrix(heading));
  } else {
    const t = turn([offset[0], offset[1], 0], aim(heading, pitch, false));
    at = [t[0], t[1], t[2] + offset[2]];
  }
  const x = origin[0] + at[0];
  const y = origin[1] + at[1];
  const z = origin[2] + at[2];
  const p: Projectile = {
    kind, owner, team, x, y, z, from: [x, y, z], heading: heading & ANGLE_MASK, pitch: pitch & ANGLE_MASK, speed: def.speed,
    vx: 0, vy: 0, vz: 0, damage: def.damage, ticksLeft: def.life, turning: pitch !== 0 && def.pitchRate !== 0, fromTile: -1,
  };
  setVelocity(p);
  return p;
}

/** A helicopter's shot takes on its speed (sub_4155a0). */
export function addSpeed(p: Projectile, speed: number): void {
  p.speed += speed;
  setVelocity(p);
}

// Jeep grenades (the Grenade class, VA 0x448c70). sub_415b00 picks what to throw at, sub_4159a0 throws it and
// sub_415730 flies it on a fixed arc. A grenade only does damage by striking something on the way: a building
// (sub_4158f0) or a vehicle (sub_415940), for 0x18000 either way. Where it lands it makes a burst, a road burst
// or a splash (explosion defs 0, 2 and 1), none of which hurt.

/** Damage a grenade does to what it strikes. */
export const GRENADE_DAMAGE = 0x18000;
/** It aims at an enemy vehicle or a building closer than this (0x3d3ab7, about 61 px). */
export const GRENADE_RANGE = 0x3d3ab7;
/** Only at a vehicle lower than 5 px: a helicopter in the air is safe. */
export const GRENADE_LOW = 0x50000;
/** With nothing to aim at it lands 48 to 62 px ahead, up to 4 heading steps off. */
export const GRENADE_THROW = 48;
// The sim has no building or vehicle heights yet (the original tests against model bounds), so a grenade strikes
// a building below 16 px and a vehicle below 8 px. Inferred.
export const GRENADE_BUILDING_HEIGHT = 16 * ONE;
export const GRENADE_VEHICLE_HEIGHT = 8 * ONE;

export interface Grenade {
  owner: number;
  team: number;
  /** Where it was thrown from (+0x5c), its heading (+0x6c, whole steps) and launch speed (+0x54). */
  x0: number;
  y0: number;
  z0: number;
  heading: number;
  speed: number;
  /** Ticks in flight (+0x68). */
  t: number;
  x: number;
  y: number;
  z: number;
}

/**
 * Throws a grenade at a point (sub_4159a0). The launch speed is sqrt(distance * 3276 / 46340) in pixels, which
 * with the arc below makes it come down at the target.
 */
export function throwGrenade(owner: number, team: number, x: number, y: number, z: number, heading: number, distPx: number): Grenade {
  const speed = sqrt(div(distPx * 3276, 0xb504));
  return { owner, team, x0: x, y0: y, z0: z, heading: heading & ~(ONE - 1), speed, t: 0, x, y, z };
}

/** One tick of flight (sub_415730). Height rises at speed * cos 22.5 degrees and falls 0x666 per tick squared. */
export function stepGrenade(g: Grenade): void {
  const t = ++g.t;
  g.z = Math.imul(mul(g.speed, 0xec83) - Math.imul(t, 0x666), t) + g.z0;
  const d = mul(g.speed, Math.imul(t, 0x61f7));
  g.x = g.x0 + mul(sin(g.heading), d);
  g.y = g.y0 - mul(cos(g.heading), d);
}

// Mines (classes 0x443078 while arming and 0x4542c8 once armed). Laid by the ASV or scattered at the start
// (sub_42a030). A new mine arms over 158 ticks (+0x60 climbs 0x2222 a tick from 0x50000 to 0x1a0000), blinking
// with a 30-tick period that lights for longer as it nears armed (sub_409cd0). An armed mine goes off when any
// vehicle touches it, whoever laid it (sub_409dd0), or when hit for more than 0x18000 (sub_409e00). Going off it
// leaves explosion def 0x445058, the only explosion that does damage: 1.0 a tick to everything in its box.

export const MINE_ARM_START = 0x50000;
export const MINE_ARM_RATE = 0x2222;
export const MINE_ARMED = 0x1a0000;
export const MINE_BLINK = 30;
/** A hit must be stronger than this to set a mine off. */
export const MINE_TOUGHNESS = 0x18000;
/**
 * The blast, traced from the mine's explosion (0x44d870) and the script ops that give an explosion a damage box
 * (sub_42d640, sub_42d710): the box does 1.0 damage for every tick something is in it (sub_42dcd0, sub_42dd20: a
 * negative amount is per tick). The explosion's clock runs at a sixth of a frame a tick for 24 frames, so the blast
 * lasts 144 ticks, and the script sizes the box as it goes: 4 px either way (and up) for the first 18 ticks, 25 px
 * for one tick, then 12 px, 16 px from tick 42 and 20 px from tick 66.
 */
export const MINE_BLAST_DAMAGE = 0x10000;
export const MINE_BLAST_TICKS = 144;
const MINE_BLAST_SIZES: readonly (readonly [number, number])[] = [[66, 20], [42, 16], [19, 12], [18, 25], [0, 4]];
/** How far the blast reaches, either way and up, this many ticks after the mine went off. */
export function mineBlastReach(age: number): number {
  return (MINE_BLAST_SIZES.find(([from]) => age >= from)?.[1] ?? 0) * ONE;
}
/** Contact: the mine model is about 3 px across. */
export const MINE_SIZE = 3 * ONE;

export interface Mine {
  x: number;
  y: number;
  /** Team of the player who laid it, which can see it once armed; -1 for a scattered mine. */
  team: number;
  /** Arming progress (+0x60). */
  arm: number;
  /** Blink counter (+0x5c). */
  blink: number;
}

export function layMine(x: number, y: number, team: number): Mine {
  return { x, y, team, arm: MINE_ARM_START, blink: 0 };
}

export function mineArmed(mine: Mine): boolean {
  return mine.arm >= MINE_ARMED;
}

/** Advances arming. True while the mine's light is on. */
export function stepMine(mine: Mine): boolean {
  if (mineArmed(mine)) return false;
  mine.arm += MINE_ARM_RATE;
  if (mineArmed(mine)) return false;
  mine.blink = (mine.blink + 1) % MINE_BLINK;
  return mine.blink < mine.arm >> 16;
}

export interface Blast {
  x: number;
  y: number;
  ticksLeft: number;
}

/**
 * Moves a projectile one tick (sub_414b10), short of hitting anything: the match tests the line it swept. Returns
 * false once its life is up (it goes without moving).
 */
export function stepProjectile(p: Projectile): boolean {
  if (p.ticksLeft <= 1) return false;
  p.ticksLeft--;
  const def = PROJECTILES[p.kind]!;
  if (p.turning) {
    if (!def.fine) {
      const was = p.pitch;
      p.pitch = turnToward(p.pitch, 0, def.pitchRate);
      if (was !== 0) setVelocity(p);
    } else {
      p.pitch = (p.pitch + def.pitchRate) & ANGLE_MASK;
      setVelocity(p);
    }
  }
  let dz = p.vz;
  if (p.z + dz > SHOT_CEILING) {
    dz = SHOT_CEILING - p.z;
    if (!p.turning) p.pitch = turnToward(p.pitch, 0, def.pitchRate);
  }
  p.from = [p.x, p.y, p.z];
  p.x += p.vx;
  p.y += p.vy;
  p.z += dz;
  return true;
}

/** The tile a point is over, or -1 off the map. */
export function tileAt(x: number, y: number): number {
  const tx = x >> TILE_SHIFT;
  const ty = y >> TILE_SHIFT;
  if (tx < 0 || ty < 0 || tx >= GRID || ty >= GRID) return -1;
  return ty * GRID + tx;
}

/** Damage a vehicle takes from a hit (sub_40c460): the hit less the vehicle's armour, if positive. */
export function vehicleDamage(hit: number, armour: number): number {
  return Math.max(0, hit - armour);
}
