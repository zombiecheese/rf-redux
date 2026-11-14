// A match: players, their vehicles and lives, projectiles, flags and the win rule.
//
// Original rules this follows (see the mechanics spec):
// - Each player has per-type vehicle lives from the map's VHCL settings. Launching uses one (sub_40b700) and
//   driving back into the bunker returns it (sub_42f110), so only destroyed vehicles cost a life. Vehicles go up
//   and down on the base's lift, and the player's screen fades between the bunker and the map (lift.ts).
// - Each base's flag is hidden in one of its flag sites, picked at random (sub_414130).
// - Only a jeep can carry a flag.
// Web rules: the last team standing wins. A base is eliminated when its players have
// no jeeps left in the bunker and none in play, or when an enemy jeep brings its flag home.

import { ANGLE_MASK, FIXED_SHIFT, ONE, TILE_SHIFT, TILE_SIZE, cos, distance, fineAtan2, headingTo, mul, sin, turnToward } from './fixed.js';
import { BUILDING } from './buildings.js';
import { BOX, sweep, touch, type Body, type Shape } from './collide.js';
import { buildingHits, damageBuilding, destroyBuilding, destroyExplosion } from './damage.js';
import { startScript, stepScript, type BuildingExplosion, type ExplosionOp, type Rubble } from './explosions.js';
import {
  CAMP_TICKS, CAMP_TOWERS, DRONE_OWNER, DRONE_SHAPES, DRONE_TOUGHNESS, droneFired, dronePool, droneSpawn, makeDrone, stepDrone,
  type Drone, type DroneWorld,
} from './drones.js';
import { gateObstacles, gateShapes, openGate, stepGate, type Gate } from './gates.js';
import { GRID, buildingBody, placeBuilding, sceneryEntry, type RfwMap, type World } from './map.js';
import { Rng } from './rng.js';
import { makeSoldier, soldierShapes, soldiersFrom, stepSoldier, type Soldier, type SoldierWorld } from './soldiers.js';
import { landHeli } from './heli.js';
import { stepDeath, type Death } from './death.js';
import { cancelLaunch, liftOf, skipLift, startDock, startLaunch, stepLifts, stepScreen, type Elevator, type Lift } from './lift.js';
import { DEEP, LAND, SHALLOW, groundAt } from './shore.js';
import { DEATH_MISSILE, SUB_MUZZLE, SUB_PITCH, callsSub, makeSub, steerDeathMissile, stepSub, type Sub } from './sub.js';
import { WRECK_TICKS, hitWreck, makeWreck, stepWreck, wreckSolid, type Wreck, type WreckModel } from './wrecks.js';
import {
  VEHICLES, airborne, busy, makeVehicle, stepVehicle, sunk, toggleTyres, type Obstacle, type Vehicle, type VehicleInput,
  type VehicleKind,
} from './vehicle.js';
import {
  GRENADE_BUILDING_HEIGHT, GRENADE_DAMAGE, GRENADE_RANGE, GRENADE_THROW, GRENADE_VEHICLE_HEIGHT,
  MINE_ARMED, MINE_BLAST_DAMAGE, MINE_BLAST_TICKS, MINE_SIZE, MINE_TOUGHNESS, PROJECTILES, addSpeed, aim, fireProjectile,
  layMine, mineArmed, mineBlastReach, muzzle, stepGrenade, stepMine, stepProjectile, throwGrenade, tileAt, turn, vehicleDamage,
  type Blast, type Grenade, type Mine, type Projectile, type Vec3,
} from './weapons.js';

export type Lives = Record<VehicleKind, number>;

/** Game defaults for a map setting left null (sub_413f00). */
export const DEFAULT_LIVES: Lives = { tank: 3, jeep: 8, asv: 3, heli: 3 };

/** 0xFF in the original means unlimited. */
export const UNLIMITED = 0xff;

/**
 * bunker: choosing a vehicle. launching: its elevator is going up in the bunker, then its lift on the map. driving.
 * docking: the vehicle is going down on the lift while the screen fades to the bunker. lost: watching it blow up
 * after losing one, then fading to the bunker. skull: the laughing skull (death.ts). out: the base is eliminated.
 */
export type PlayerState = 'bunker' | 'launching' | 'driving' | 'docking' | 'lost' | 'skull' | 'out';

export interface Player {
  id: number;
  base: number;
  team: number;
  state: PlayerState;
  lives: Lives;
  /** ASV mine pool (player record +0xBC). Parking an ASV returns its unused mines. */
  mines: number;
  vehicle: Vehicle | null;
  /** Tick at which a lost player's view leaves the map (death.ts). */
  returnAt: number;
  /** The vehicle lost, until the player is back in the bunker (death.ts). */
  death: Death | null;
  /** How lit the player's screen is (+0xbc of the view), 0 to ONE: it fades between the bunker and the map. */
  fade: number;
  /** The bunker's elevator while a vehicle goes up (lift.ts). */
  elevator: Elevator | null;
  /** The tile the vehicle was on last tick and when it came there or last drew a drone (player record +0xcc). */
  campTile: number;
  campAt: number;
}

export interface Flag {
  base: number;
  /** Tile index of the flag site it is hidden in. */
  site: number;
  /** Where it lies once revealed, as world coordinates. */
  x: number;
  y: number;
  revealed: boolean;
  /** Player id of the jeep carrying it, or -1. */
  carrier: number;
  /**
   * Player id of the jeep that last put it down with its third button, or -1 (flag +0x70). Until that jeep moves
   * off it, the flag is not picked up by touch, only by the button again.
   */
  dropper: number;
}

/**
 * A gun tower that has woken up (the "Turret Gun" class, VA 0x44e2d4). Headings are 16.16 in 64 steps.
 */
export interface Turret {
  tile: number;
  /** Owning base, or -1 for a neutral tower that fires on everyone. */
  base: number;
  x: number;
  y: number;
  heading: number;
  /** The gun's pitch (+0x5c): down is positive. */
  pitch: number;
  /** Tick at which it starts tracking (sub_431b20: now + the low byte of random(300)). */
  activeAt: number;
  /** Tick at which it may fire again (field +0x68). */
  readyAt: number;
  /** The player whose vehicle woke it, which it tracks until that vehicle is gone (+0x2c). */
  target: number;
  /** The last tick it was on anyone's screen (+0x62 counts the ticks since). */
  seenAt: number;
  /** The heading it woke with and turns back to (+0x6c). */
  rest: number;
}

/** What a shot was: a projectile type, a grenade or a laid mine. */
export type Shot = number | 'grenade' | 'mine';

/**
 * Things that happened during a tick. They never feed back into the simulation; clients use them for messages,
 * effects and sounds. Positions are world coordinates (16.16 pixels).
 */
export type MatchEvent =
  | { type: 'destroyed'; player: number; kind: VehicleKind; x: number; y: number; z: number; heading: number; drowned?: boolean; fuelOut?: boolean }
  /** A wreck blew apart (debris at its height), sank out of sight, or came to rest and left a mark for WRECK_TICKS. */
  /** A wreck blew apart, showing its body or its wreck model (for its debris). */
  | { type: 'wreckBlown'; kind: VehicleKind; base: number; x: number; y: number; z: number; heading: number; model: WreckModel }
  | { type: 'wreckSunk'; kind: VehicleKind; x: number; y: number }
  | { type: 'wreckMark'; kind: VehicleKind; base: number; x: number; y: number; heading: number; model: WreckModel; ticks: number }
  | { type: 'tyres'; player: number; out: boolean; x: number; y: number }
  /** The helicopter's weapon swapped: slot 0 the gun, 1 the missiles. */
  | { type: 'weapon'; player: number; slot: number; x: number; y: number }
  /** A vehicle's shot names its player, and the heading and pitch it left at (for the muzzle flash). */
  | { type: 'fired'; shot: Shot; x: number; y: number; z?: number; player?: number; heading?: number; pitch?: number }
  | { type: 'hit'; target: 'vehicle' | 'building' | 'ground' | 'water'; shot: Shot; x: number; y: number; z?: number }
  /**
   * building is the one destroyed. The tile holds what it became, or, for a building with an explosion, still the
   * building until its explosion swaps the rubble in.
   */
  | { type: 'buildingDestroyed'; tile: number; building: number; crushed?: true }
  | { type: 'gate'; tile: number; sound: 'move' | 'shut' }
  | { type: 'resupply'; player: number; x: number; y: number }
  /** A soldier run over or shot. On land he leaves splat cel variant 0-5 (rand(3) * 2 + his side). */
  | { type: 'soldierKilled'; base: number; x: number; y: number; water: boolean; variant: number }
  /** An attack drone launched at a camper, and one shot down (z is its height; side its colours). */
  | { type: 'droneLaunched'; player: number }
  /** A death missile's smoke puff (explosion 0x445238, sub_415100). */
  | { type: 'smoke'; x: number; y: number; z: number }
  | { type: 'droneDown'; x: number; y: number; z: number; heading: number; vx: number; vy: number; side: number }
  | { type: 'flagRevealed'; base: number }
  | { type: 'flagTaken'; base: number; player: number }
  | { type: 'flagDropped'; base: number }
  /** A jeep brought its own side's flag home, and it was hidden again (revealed if no flag building was left). */
  | { type: 'flagReturned'; base: number; player: number; revealed: boolean }
  /** An enemy flag was brought home. left is how many more captures the base can take (handicap); none puts it out. */
  | { type: 'captured'; base: number; player: number; left: number }
  | { type: 'eliminated'; base: number }
  /** A player's skull screen began, and its laugh (death.ts). */
  | { type: 'skull'; player: number }
  | { type: 'laugh'; player: number }
  | { type: 'won'; team: number }
  /** The last bases went out together: the match ends with no winner. */
  | { type: 'draw' };

export interface Match {
  world: World;
  rng: Rng;
  tick: number;
  players: Player[];
  projectiles: Projectile[];
  grenades: Grenade[];
  mines: Mine[];
  /** Mine explosions still doing damage. */
  blasts: Blast[];
  /** Difficulty level 1-9 (see DIFFICULTY). */
  difficulty: number;
  flags: Flag[];
  turrets: Turret[];
  /** Gates standing open or closing (gates.ts). */
  gates: Gate[];
  /** Destroyed buildings' explosions, still to change the map (explosions.ts), and rubble still to appear. */
  explosions: BuildingExplosion[];
  rubble: Rubble[];
  /** Soldiers out of their buildings (soldiers.ts). */
  soldiers: Soldier[];
  /** Wrecks still moving, or standing out of fuel (wrecks.ts), and the next wreck id. */
  wrecks: Wreck[];
  nextWreck: number;
  /** Attack drones in the air (drones.ts), how many each team may have after it, and the next drone id. */
  drones: Drone[];
  dronePool: number;
  nextDrone: number;
  /** The submarine, out while a helicopter has strayed off the map (sub.ts). */
  sub: Sub | null;
  /** Bases' lifts bringing a vehicle up or taking one down (lift.ts). */
  lifts: Lift[];
  eliminated: boolean[];
  /** Captures each base's flag can still take; the one that brings it to none puts the base out (capturesNeeded). */
  captures: number[];
  winner: number | null;
  /** Every base is out and nobody won: the last ones fell on the same tick. The match is over. */
  draw: boolean;
  events: MatchEvent[];
}

export interface SlotSetup {
  /** Base the player starts from. */
  base: number;
  /** Team chosen in the lobby. Players on one team win together. */
  team: number;
}

/** A base's vehicles: its own counts (map format v2), else the map's, else the game defaults. */
export function settingLives(map: RfwMap, base: number): Lives {
  const v = map.settings.vehicles;
  const own = map.bases[base]?.vehicles ?? {};
  const pick = (k: VehicleKind) => own[k] ?? v[k] ?? DEFAULT_LIVES[k];
  return { tank: pick('tank'), jeep: pick('jeep'), asv: pick('asv'), heli: pick('heli') };
}

/**
 * A player's vehicles at the start. With the handicap on (a lobby switch, off by default), a team
 * with fewer players than the biggest gets its counts scaled up to match, rounded up: one base against two starts
 * with twice the vehicles. Unlimited counts stay unlimited and counts stop short of that value.
 */
export function startingLives(map: RfwMap, slots: readonly SlotSetup[], slot: number, handicap = false): Lives {
  const lives = settingLives(map, slots[slot]!.base);
  if (!handicap) return lives;
  const size = (team: number) => slots.filter((s) => s.team === team).length;
  const mine = size(slots[slot]!.team);
  const most = Math.max(...slots.map((s) => size(s.team)));
  if (mine >= most) return lives;
  const scale = (n: number) => (n === UNLIMITED ? n : Math.min(UNLIMITED - 1, Math.floor((n * most + mine - 1) / mine)));
  return { tank: scale(lives.tank), jeep: scale(lives.jeep), asv: scale(lives.asv), heli: scale(lives.heli) };
}

/**
 * How many times a base's flag must be brought home before the base is out. Once, except with the handicap on for
 * a team smaller than the biggest: one base against two needs three captures, against three five.
 * Extra vehicles alone left the single base losing every bot match; this is the part that evens it up.
 */
export function capturesNeeded(slots: readonly SlotSetup[], slot: number, handicap = false): number {
  if (!handicap) return 1;
  const size = (team: number) => slots.filter((s) => s.team === team).length;
  const mine = size(slots[slot]!.team);
  const most = Math.max(...slots.map((s) => size(s.team)));
  return mine >= most ? 1 : 2 * Math.floor((most + mine - 1) / mine) - 1;
}

function centre(tile: number): number {
  return tile * TILE_SIZE + TILE_SIZE / 2;
}

/**
 * Difficulty, 1 to 9 like the original's level setting (stored 0-8 at VA 0x442fc0 and shown plus one). It sets
 * the bots' skill (bot.ts), the anti-camping drone pool and, above 6, extra random mines.
 */
export const DIFFICULTY = { min: 1, max: 9, default: 5 } as const;

export interface MatchOptions {
  difficulty?: number;
  /** Help for the smaller side: extra vehicles (startingLives) and a flag that takes more captures (capturesNeeded). */
  handicap?: boolean;
}

export function clampDifficulty(n: number | undefined): number {
  if (n === undefined || !Number.isFinite(n)) return DIFFICULTY.default;
  return Math.min(DIFFICULTY.max, Math.max(DIFFICULTY.min, Math.trunc(n)));
}

export function createMatch(world: World, map: RfwMap, slots: readonly SlotSetup[], seed: number, options: MatchOptions = {}): Match {
  const rng = new Rng(seed);
  const difficulty = clampDifficulty(options.difficulty);
  const players: Player[] = slots.map((s, id) => {
    const lives = startingLives(map, slots, id, options.handicap);
    return {
      id, base: s.base, team: s.team, state: 'bunker', lives, mines: VEHICLES.asv.weapons[1]!.ammo * lives.asv,
      vehicle: null, returnAt: 0, death: null, fade: 0, elevator: null, campTile: -1, campAt: 0,
    };
  });
  const flags: Flag[] = world.bases.map((b) => {
    const p = b.flagSites[rng.below(b.flagSites.length)] ?? b.start;
    return { base: b.id, site: p.ty * GRID + p.tx, x: centre(p.tx), y: centre(p.ty), revealed: false, carrier: -1, dropper: -1 };
  });
  const m: Match = {
    world, rng, tick: 0, players, projectiles: [], grenades: [], mines: [], blasts: [], difficulty, flags, turrets: [], gates: [], explosions: [], rubble: [], soldiers: [], wrecks: [], nextWreck: 0,
    drones: [], dronePool: dronePool(difficulty, map.settings.aiPool), nextDrone: 0, sub: null, lifts: [],
    eliminated: world.bases.map((b) => !slots.some((s) => s.base === b.id)), winner: null, draw: false, events: [],
    captures: world.bases.map((b) => {
      const slot = slots.findIndex((s) => s.base === b.id);
      return slot < 0 ? 1 : capturesNeeded(slots, slot, options.handicap);
    }),
  };
  // The map's random mines, or by default four per level from level 7 up (the start-up code around sub_42a030).
  const count = map.settings.randomMines ?? (difficulty - 1 > 5 ? (difficulty - 1) * 4 : 0);
  if (count > 0) scatterMines(m, count);
  return m;
}

const isRoad = (t: number) => t > 0x48 && t < 0x5a;

/**
 * Whether a tile can take a scattered mine (sub_42a430): no building, away from the bases' lifts, and ground the
 * original allows, which is certain road pieces and open ground. In the first pass open ground must be next to a
 * road. Terrain numbers with bit 3 set are skipped, as the original does.
 */
function mineSpot(m: Match, tx: number, ty: number, nearRoad: boolean): boolean {
  const w = m.world;
  const i = ty * GRID + tx;
  if (w.building[i]) return false;
  if (w.bases.some((b) => Math.abs(b.start.tx - tx) < 2 && Math.abs(b.start.ty - ty) < 2)) return false;
  const t = w.terrain[i]! & 127;
  if (t & 8 || t > 0x53) return false;
  if (t > 0x48) return true;
  if (t !== 0 && t !== 3 && t < 0x34) return false;
  if (!nearRoad) return true;
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < GRID && y < GRID ? w.terrain[y * GRID + x]! & 127 : 0);
  return isRoad(at(tx, ty - 1)) || isRoad(at(tx, ty + 1)) || isRoad(at(tx - 1, ty)) || isRoad(at(tx + 1, ty));
}

/** Scatters mines at the start (sub_42a030): first on and beside roads, then on any open ground. */
function scatterMines(m: Match, count: number): void {
  for (const nearRoad of [true, false]) {
    const spots: number[] = [];
    for (let i = 0; i < GRID * GRID; i++) if (mineSpot(m, i % GRID, (i - (i % GRID)) / GRID, nearRoad)) spots.push(i);
    while (count > 0 && spots.length) {
      const [i] = spots.splice(m.rng.below(spots.length), 1);
      const x = ((i! % GRID) * 32 + 6 + m.rng.below(25)) * ONE;
      const y = (Math.floor(i! / GRID) * 32 + 6 + m.rng.below(25)) * ONE;
      // sub_409e30 lays no mine in deep water.
      if (groundAt(m.world, x, y) === DEEP) continue;
      m.mines.push({ ...layMine(x, y, -1), arm: MINE_ARMED });
      count--;
    }
  }
}

/**
 * Launches a vehicle from the bunker if the player has one of that type left and the bunker screen has faded in
 * (sub_417ad0). It goes up the elevator and comes up on the lift (lift.ts), and is in play when that is done.
 */
export function launch(m: Match, playerId: number, kind: VehicleKind): boolean {
  const p = m.players[playerId];
  if (!p || p.state !== 'bunker' || p.fade < ONE || m.eliminated[p.base]) return false;
  if (p.lives[kind] === 0) return false;
  if (p.lives[kind] !== UNLIMITED) p.lives[kind]--;
  const v = startLaunch(m, p, kind);
  // With unlimited ASVs the mine pool never runs down either.
  if (kind === 'asv' && p.lives.asv !== UNLIMITED) {
    v.ammo[1] = Math.min(v.ammo[1]!, p.mines);
    p.mines -= v.ammo[1]!;
  }
  p.state = 'launching';
  p.campTile = -1;
  return true;
}

/** Launches and puts the vehicle straight out, skipping the lift: for tests and tools. */
export function launchNow(m: Match, playerId: number, kind: VehicleKind): boolean {
  const p = m.players[playerId];
  if (p?.state === 'bunker') p.fade = ONE;
  if (!launch(m, playerId, kind)) return false;
  skipLift(m, playerId);
  return true;
}

/**
 * Drives back into the bunker: the vehicle's life is returned, and an ASV's unused mines go back to the pool. A
 * helicopter first lands on the lift (heli.ts), and is taken in when it has; this returns true when it starts down.
 */
export function dock(m: Match, playerId: number): boolean {
  const p = m.players[playerId];
  const v = p?.vehicle;
  if (!p || !v || p.state !== 'driving' || busy(v)) return false;
  const start = m.world.bases[p.base]!.start;
  if (v.x >> TILE_SHIFT !== start.tx || v.y >> TILE_SHIFT !== start.ty) return false;
  if (m.flags.some((f) => f.carrier === p.id && !ownFlag(m, p, f))) return false;
  if (v.heli) {
    landHeli(v.heli, centre(start.tx), centre(start.ty));
    return true;
  }
  takeIn(m, p, v);
  return true;
}

function takeIn(m: Match, p: Player, v: Vehicle): void {
  // A jeep that docks with its own side's flag hides it again (sub_40e090, the jeep's docking state).
  for (const f of m.flags) {
    if (f.carrier !== p.id) continue;
    rehideFlag(m, f);
    m.events.push({ type: 'flagReturned', base: f.base, player: p.id, revealed: f.revealed });
  }
  if (p.lives[v.kind] !== UNLIMITED) p.lives[v.kind]++;
  if (v.kind === 'asv' && p.lives.asv !== UNLIMITED) p.mines += v.ammo[1]!;
  p.vehicle = null;
  p.state = 'docking';
  startDock(m, p, v);
}

/** Whether a player still has a jeep: one waiting in the bunker, or one out on the map or coming up to it. */
function hasJeep(m: Match, p: Player): boolean {
  if (p.lives.jeep > 0 || (p.state === 'driving' && p.vehicle?.kind === 'jeep')) return true;
  return p.state === 'launching' && liftOf(m, p.id)?.vehicle.kind === 'jeep';
}

/** A base is out once none of its players has a jeep left, in the bunker or in play. */
function checkJeeps(m: Match): void {
  for (const b of m.world.bases) {
    if (m.eliminated[b.id]) continue;
    const players = m.players.filter((p) => p.base === b.id);
    if (players.length && !players.some((p) => hasJeep(m, p))) eliminate(m, b.id);
  }
}

/** How a vehicle was lost: destroyed, sunk, or out of fuel (which leaves it standing, its driver getting out). */
type Loss = 'destroyed' | 'drowned' | 'fuel';

function loseVehicle(m: Match, p: Player, how: Loss = 'destroyed'): void {
  const v = p.vehicle;
  if (!v) return;
  const drowned = how === 'drowned';
  const fuelOut = how === 'fuel';
  m.events.push({
    type: 'destroyed', player: p.id, kind: v.kind, x: v.x, y: v.y, z: v.z, heading: v.heading, ...(drowned ? { drowned } : {}),
    ...(fuelOut ? { fuelOut } : {}),
  });
  // A vehicle that sinks is simply gone; any other leaves a wreck (sub_40c460, sub_40b980). Only one destroyed
  // outright always brings on the skull (sub_40b5a0, death.ts).
  p.death = { kind: v.kind, skull: how === 'destroyed' || v.kind === 'jeep', wreck: drowned ? -1 : m.nextWreck, start: 0 };
  if (!drowned) {
    m.wrecks.push(makeWreck(m.nextWreck++, v.kind, v.base, v.team, v.x, v.y, v.z, v.heading, v.speed, m.tick, fuelOut, v.health));
  }
  for (const f of m.flags) {
    if (f.carrier === p.id) {
      f.carrier = -1;
      f.x = v.x;
      f.y = v.y;
      m.events.push({ type: 'flagDropped', base: f.base });
    }
    if (f.dropper === p.id) f.dropper = -1;
  }
  p.vehicle = null;
  p.state = 'lost';
  p.returnAt = m.tick + VEHICLES[v.kind].respawnDelay;
}

function hitVehicle(m: Match, v: Vehicle, damage: number): void {
  const d = vehicleDamage(damage, VEHICLES[v.kind].armour);
  if (d <= 0) return;
  v.health -= d;
  if (v.health <= 0) loseVehicle(m, m.players[v.player]!);
}

function eliminate(m: Match, base: number): void {
  if (m.eliminated[base]) return;
  m.eliminated[base] = true;
  m.events.push({ type: 'eliminated', base });
  for (const p of m.players) {
    if (p.base !== base) continue;
    if (p.vehicle) loseVehicle(m, p);
    if (p.state === 'launching') cancelLaunch(m, p);
    p.state = 'out';
  }
  for (const f of m.flags) {
    if (f.base !== base) continue;
    if (f.carrier >= 0) m.events.push({ type: 'flagDropped', base });
    f.carrier = -1;
    f.dropper = -1;
  }
}

function fire(m: Match, v: Vehicle, slot: number): void {
  const w = VEHICLES[v.kind].weapons[slot];
  if (!w) return;
  if (w.projectile !== 'mine' && w.projectile !== 'grenade') {
    trigger(m, v, false);
    return;
  }
  if (v.ammo[slot]! <= 0 || m.tick < v.readyAt[slot]!) return;
  v.ammo[slot]!--;
  v.readyAt[slot] = m.tick + w.reload;
  m.events.push({ type: 'fired', shot: w.projectile, x: v.x, y: v.y });
  if (w.projectile === 'mine') m.mines.push(layMine(v.x, v.y, v.team));
  else m.grenades.push(aimGrenade(m, v));
}

/** Fires a projectile from a vehicle: offset is the muzzle on its model. */
function shoot(m: Match, v: Vehicle, kind: number, offset: Vec3, heading: number, pitch: number): Projectile {
  const p = fireProjectile(kind, v.player, v.team, [v.x, v.y, v.z], offset, heading, pitch);
  m.projectiles.push(p);
  m.events.push({ type: 'fired', shot: kind, x: p.x, y: p.y, z: p.z, player: v.player, heading, pitch });
  return p;
}

// The tank's gun (sub_40d240) and the ASV's launcher (sub_40d520) fire level, or raised for aircraft. Asking for
// the other one first swings the barrel (or launcher) over at 0x4ccc a tick, and the shot waits until it is there
// (their think functions, sub_40d460 and sub_40d790). The tank fires from the end of its barrel, turned with it,
// along the turret; the ASV from each of its three tubes in turn, then reloads them for 41 ticks.
export const BARREL_UP = 0x3b8e39;
export const BARREL_TURN = 0x4ccc;
/** The pitch of a raised shot (DAT_00445484, DAT_0044548c), and the ASV's level one (DAT_00445490). */
const SHOT_UP = 0x38e38f;
const ASV_LEVEL = 0x4f5c;
/** Barrel end about its pivot, and the pivot (0x43e400, 0x43e40c). */
const TANK_TIP: Vec3 = [0, -0x6c000, 0];
const TANK_PIVOT: Vec3 = [0, -0x54000, 0x70000];
/** The ASV's tube ends about their pivots, and the pivots of its three tubes (0x43edb8, 0x43ed90). */
const ASV_TIP: Vec3 = [0, -0xf0000, -0x10000];
const ASV_TUBES: readonly Vec3[] = [[-0x18000, 0x60000, 0xc0000], [0, 0x60000, 0xc0000], [0x18000, 0x60000, 0xc0000]];
/** After its third tube the ASV waits while this counts up 0x2666 a tick to 0. */
const ASV_TUBES_RELOAD = -0x60000;
const ASV_TUBE_STEP = 0x2666;

/** A press of the tank's or ASV's fire button, level or raised (sub_40d240, sub_40d520). */
function trigger(m: Match, v: Vehicle, raised: boolean): void {
  if (raised) {
    if (v.barrelTarget === 0) {
      v.barrelTarget = BARREL_UP;
      if (v.barrel === 0) v.barrel = turnToward(v.barrel, BARREL_UP, BARREL_TURN);
    }
  } else {
    v.barrelTarget = 0;
    if (v.barrel === BARREL_UP) v.barrel = turnToward(v.barrel, 0, BARREL_TURN);
  }
  if (v.barrel !== 0 && v.barrel !== BARREL_UP) {
    v.pending = true;
    return;
  }
  const up = v.barrel === BARREL_UP;
  const w = VEHICLES[v.kind].weapons[0]!;
  const tank = v.kind === 'tank';
  if (tank && m.tick < v.readyAt[0]!) return;
  if (v.ammo[0]! <= 0) {
    if (tank || m.tick >= v.readyAt[0]!) {
      v.pending = false;
      v.readyAt[0] = m.tick + w.reload;
    }
    return;
  }
  if (tank) {
    const pitch = up ? SHOT_UP : 0;
    shoot(m, v, w.projectile as number, muzzle(TANK_TIP, TANK_PIVOT, pitch), (v.heading + v.turret) & ANGLE_MASK, pitch);
  } else {
    if (m.tick < v.readyAt[0]! || v.tube < 0) return;
    const pitch = up ? SHOT_UP : ASV_LEVEL;
    shoot(m, v, up ? 9 : 8, muzzle(ASV_TIP, ASV_TUBES[v.tube]!, pitch), v.heading, pitch);
  }
  v.pending = false;
  v.readyAt[0] = m.tick + w.reload;
  v.ammo[0]!--;
  if (!tank) {
    v.tube = v.ammo[0]! > 0 && v.tube < 2 ? v.tube + 1 : ASV_TUBES_RELOAD;
  }
}

/** The barrel's turn each tick, and a shot waiting for it (sub_40d460, sub_40d790). */
function stepBarrel(m: Match, v: Vehicle): void {
  if (v.kind !== 'tank' && v.kind !== 'asv') return;
  if (v.tube < 0 && v.ammo[0]! !== 0) {
    v.tube += ASV_TUBE_STEP;
    if (v.tube > 0) v.tube = 0;
  }
  v.barrel = turnToward(v.barrel, v.barrelTarget, BARREL_TURN);
  if (v.pending && v.barrel === v.barrelTarget) trigger(m, v, v.barrel !== 0);
}

// The helicopter (sub_40e600) fires its picked weapon from guns either side of its nose in turn (0x440f20 and
// 0x440f38). Its first button fires down at the ground: each shot is angled two heading steps in towards the middle,
// the gun 40 degrees down (pitch 0x71c71) and the missile with a pitch just short of a whole turn, which sets it
// turning down in a curve (sub_414b10). Its second fires straight ahead, level. A shot gains the helicopter's own
// speed.
const HELI_GUNS: readonly Vec3[] = [[0x95999, -0x6cccc, 0], [-0x95999, -0x6cccc, 0]];
const HELI_IN = 0x20000;
const HELI_GUN_DOWN = 0x71c71;
const HELI_DOWN = 0x3fffff;

function heliShot(m: Match, v: Vehicle, down: boolean): void {
  const slot = v.weapon;
  const w = VEHICLES.heli.weapons[slot]!;
  if (m.tick < v.readyAt[slot]!) return;
  if (v.ammo[slot]! <= 0) {
    v.readyAt[slot] = m.tick + w.reload;
    return;
  }
  const side = v.gunSide;
  v.gunSide ^= 1;
  const heading = down ? (v.heading + (side ? HELI_IN : -HELI_IN)) & ANGLE_MASK : v.heading;
  const kind = w.projectile as number;
  const p = shoot(m, v, kind, HELI_GUNS[side]!, heading, !down ? 0 : kind === 7 ? HELI_GUN_DOWN : HELI_DOWN);
  if (v.speed > 0) addSpeed(p, v.speed);
  v.ammo[slot]!--;
  v.readyAt[slot] = m.tick + w.reload;
}

/**
 * What a jeep throws at (sub_415b00): an enemy vehicle on or near the ground within range; else the building it last
 * bumped into (player record +0xa4, set by the vehicle's contact callback sub_40c130), if that still stands and is
 * within range; else a spot 48-62 px ahead give or take 4 heading steps.
 * Left out: the original also keeps the last object the jeep touched (+0xa8) and throws at that instead when it is
 * an enemy's, in range and no further than the building. Here a woken tower is its building, which covers that.
 */
function aimGrenade(m: Match, v: Vehicle): Grenade {
  let best: { x: number; y: number; d: number } | null = null;
  for (const p of m.players) {
    const e = p.vehicle;
    if (!e || e.team === v.team || airborne(e)) continue;
    const d = distance(e.x - v.x, e.y - v.y);
    if (d < GRENADE_RANGE && (!best || d < best.d)) best = { x: e.x, y: e.y, d };
  }
  if (!best && v.bumped >= 0 && m.world.hp[v.bumped]) {
    const body = buildingBody(m.world, v.bumped);
    const d = distance(body.x - v.x, body.y - v.y);
    if (d <= GRENADE_RANGE) best = { x: body.x, y: body.y, d };
  }
  if (!best) {
    const d = (GRENADE_THROW + m.rng.below(15)) * ONE;
    const h = (v.heading + ((m.rng.below(8) - 4) << FIXED_SHIFT)) & ANGLE_MASK;
    best = { x: v.x + mul(sin(h), d), y: v.y - mul(cos(h), d), d };
  }
  const heading = headingTo(best.x - v.x, best.y - v.y);
  return throwGrenade(v.player, v.team, v.x, v.y, 0, heading, distance(best.x - v.x, best.y - v.y) >> FIXED_SHIFT);
}

/** Flies grenades and resolves what they strike or where they land. */
function stepGrenades(m: Match): void {
  const keep: Grenade[] = [];
  for (const g of m.grenades) {
    stepGrenade(g);
    const tx = g.x >> TILE_SHIFT;
    const ty = g.y >> TILE_SHIFT;
    if (tx < 0 || ty < 0 || tx >= GRID || ty >= GRID) continue;
    const i = ty * GRID + tx;
    if (g.z < 0) {
      // Shallow or deep, water makes a splash (sub_415730 with sub_42f280).
      const water = groundAt(m.world, g.x, g.y) !== LAND;
      m.events.push({ type: 'hit', target: water ? 'water' : 'ground', shot: 'grenade', x: g.x, y: g.y });
      continue;
    }
    if (g.z < GRENADE_VEHICLE_HEIGHT) {
      const v = vehiclesNear(m, g.x, g.y).find((e) => e.team !== g.team && e.player !== g.owner && !airborne(e));
      if (v) {
        m.events.push({ type: 'hit', target: 'vehicle', shot: 'grenade', x: g.x, y: g.y });
        hitVehicle(m, v, GRENADE_DAMAGE);
        continue;
      }
    }
    if (g.z < GRENADE_BUILDING_HEIGHT && m.world.building[i] && m.world.defs[m.world.building[i]!]?.solid) {
      m.events.push({ type: 'hit', target: 'building', shot: 'grenade', x: g.x, y: g.y });
      if (m.world.hp[i]) hitBuilding(m, i, GRENADE_DAMAGE);
      continue;
    }
    keep.push(g);
  }
  m.grenades = keep;
}

function setOff(m: Match, mine: Mine): void {
  m.mines = m.mines.filter((x) => x !== mine);
  m.blasts.push({ x: mine.x, y: mine.y, ticksLeft: MINE_BLAST_TICKS });
  m.events.push({ type: 'hit', target: 'ground', shot: 'mine', x: mine.x, y: mine.y });
}

/** Arms mines, sets off armed ones a ground vehicle touches, and lets blasts damage what is in them. */
function stepMines(m: Match): void {
  for (const mine of [...m.mines]) {
    stepMine(mine);
    if (!mineArmed(mine)) continue;
    const reach = MINE_SIZE >> 1;
    const hit = m.players.some((p) => {
      const v = p.vehicle;
      if (!v || airborne(v)) return false;
      const r = VEHICLES[v.kind].radius + reach;
      return Math.abs(v.x - mine.x) <= r && Math.abs(v.y - mine.y) <= r;
    });
    if (hit) setOff(m, mine);
  }
  for (const b of m.blasts) {
    const reach = mineBlastReach(MINE_BLAST_TICKS - b.ticksLeft);
    b.ticksLeft--;
    for (const p of m.players) {
      const v = p.vehicle;
      // The box is as tall as it is wide, so it catches a helicopter only while that is low.
      if (!v || (airborne(v) && v.z > reach)) continue;
      const r = VEHICLES[v.kind].radius + reach;
      if (Math.abs(v.x - b.x) <= r && Math.abs(v.y - b.y) <= r) hitVehicle(m, v, MINE_BLAST_DAMAGE);
    }
    for (const s of m.soldiers) {
      if (!s.dead && Math.abs(s.x - b.x) <= reach && Math.abs(s.y - b.y) <= reach) killSoldier(m, s);
    }
  }
  m.blasts = m.blasts.filter((b) => b.ticksLeft > 0);
}

/** The tile a point is over; every point off the map shares one, -1 (the original's spare cell, 0x449644). */
function tileOf(x: number, y: number): number {
  return tileAt(x, y);
}

function vehiclesNear(m: Match, x: number, y: number): Vehicle[] {
  const out: Vehicle[] = [];
  for (const p of m.players) {
    const v = p.vehicle;
    if (!v) continue;
    const r = VEHICLES[v.kind].radius;
    if (Math.abs(v.x - x) <= r && Math.abs(v.y - y) <= r) out.push(v);
  }
  return out;
}

/** What a shot's line touched. */
type ShotHit =
  | { kind: 'building'; tile: number }
  | { kind: 'vehicle'; v: Vehicle }
  | { kind: 'drone'; d: Drone }
  | { kind: 'wreck'; w: Wreck }
  | { kind: 'soldier'; s: Soldier }
  | { kind: 'mine'; mine: Mine }
  | { kind: 'gate'; g: Gate };

// Mines have no traced shape: a box 3 px either way and 2 px high. Inferred.
const MINE_SHAPES: readonly Shape[] = [
  { type: BOX, flags: [0, 0, 1, 255], z: [0, 2 * ONE], offset: [0, 0], bounds: [-MINE_SIZE, -MINE_SIZE, MINE_SIZE, MINE_SIZE] },
];

/**
 * What the line a shot swept this tick touches first (sub_42bd40), walking the tiles round it as a moving object
 * does: its own row, then the row above and the row below, and in each its own column, then left, then right. On
 * each tile the building comes first, then the objects there. A shot passes its owner, its own side's vehicles
 * and, from a gun tower, its own tile.
 */
function shotHit(m: Match, p: Projectile, owner: number, team: number, fromTile: number): ShotHit | null {
  const me: Body = { x: p.x, y: p.y, z: p.z, heading: p.heading };
  const line = [sweep(p.from, p.x, p.y, p.z)];
  const tx = p.x >> TILE_SHIFT;
  const ty = p.y >> TILE_SHIFT;
  const w = m.world;
  const at = (x: number, y: number) => tileOf(x, y);
  // Off the map there are no buildings, and everything out there shares the one spare cell.
  if (at(p.x, p.y) < 0) {
    for (const q of m.players) {
      const v = q.vehicle;
      if (!v || q.state !== 'driving' || v.player === owner || v.team === team || at(v.x, v.y) >= 0) continue;
      if (touch(me, line, { x: v.x, y: v.y, z: v.z, heading: v.heading }, VEHICLES[v.kind].shapes)) return { kind: 'vehicle', v };
    }
    return null;
  }
  for (const dy of [0, -1, 1]) {
    const cy = ty + dy;
    if (cy < 0 || cy >= GRID) continue;
    for (const dx of [0, -1, 1]) {
      const cx = tx + dx;
      if (cx < 0 || cx >= GRID) continue;
      const i = cy * GRID + cx;
      const def = w.defs[w.building[i]!];
      if (i !== fromTile && def?.shapes.length && touch(me, line, buildingBody(w, i), def.shapes)) return { kind: 'building', tile: i };
      // An open gate is an object on its tile, hit through its halves where they are.
      for (const g of m.gates) {
        if (g.tile === i && touch(me, line, buildingBody(w, i), gateShapes(g))) return { kind: 'gate', g };
      }
      for (const q of m.players) {
        const v = q.vehicle;
        if (!v || q.state !== 'driving' || v.player === owner || v.team === team || at(v.x, v.y) !== i) continue;
        if (touch(me, line, { x: v.x, y: v.y, z: v.z, heading: v.heading }, VEHICLES[v.kind].shapes)) return { kind: 'vehicle', v };
      }
      if (owner !== DRONE_OWNER) {
        for (const d of m.drones) {
          if (d.dead || at(d.x, d.y) !== i) continue;
          if (touch(me, line, { x: d.x, y: d.y, z: d.z, heading: d.heading }, DRONE_SHAPES)) return { kind: 'drone', d };
        }
      }
      for (const wr of m.wrecks) {
        if (!wreckSolid(wr) || at(wr.x, wr.y) !== i) continue;
        if (touch(me, line, { x: wr.x, y: wr.y, z: wr.z, heading: wr.heading }, VEHICLES[wr.kind].shapes)) return { kind: 'wreck', w: wr };
      }
      for (const s of m.soldiers) {
        if (s.dead || at(s.x, s.y) !== i) continue;
        if (touch(me, line, { x: s.x, y: s.y, z: 0, heading: s.heading }, soldierShapes(s))) return { kind: 'soldier', s };
      }
      for (const mine of m.mines) {
        if (at(mine.x, mine.y) !== i) continue;
        if (touch(me, line, { x: mine.x, y: mine.y, z: 0, heading: 0 }, MINE_SHAPES)) return { kind: 'mine', mine };
      }
    }
  }
  return null;
}

/** The submarine (sub.ts): it hunts the vehicles in play and fires a death missile homing on one. */
function stepSubmarine(m: Match): void {
  const s = m.sub;
  if (!s) return;
  const vehicles = vehiclesInPlay(m);
  const alive = stepSub(s, {
    tick: m.tick,
    vehicles,
    fire: (sub, target) => {
      const p = fireProjectile(DEATH_MISSILE, -1, -1, [sub.x, sub.y, 0], SUB_MUZZLE, 0, SUB_PITCH);
      p.target = target;
      m.projectiles.push(p);
      m.events.push({ type: 'fired', shot: DEATH_MISSILE, x: p.x, y: p.y, z: p.z });
      return p;
    },
    flying: (p) => m.projectiles.includes(p),
  });
  if (!alive) m.sub = null;
}

/**
 * A death missile's tick (sub_415100): it bursts if its target is gone, else steers and moves, trailing smoke
 * while its pitch is coming round and otherwise one tick in four. Returns false once it has gone.
 */
function stepDeathMissile(m: Match, p: Projectile): boolean {
  const target = p.target;
  if (!target || !vehiclesInPlay(m).includes(target)) {
    m.events.push({ type: 'hit', target: 'vehicle', shot: p.kind, x: p.x, y: p.y, z: p.z });
    return false;
  }
  // Its think replaces the shots' (sub_414b10), so it has no life to run out: it flies until it hits.
  if (steerDeathMissile(p, target) || m.rng.below(4) === 1) m.events.push({ type: 'smoke', x: p.x, y: p.y, z: p.z });
  p.from = [p.x, p.y, p.z];
  p.x += p.vx;
  p.y += p.vy;
  p.z += p.vz;
  return true;
}

function stepProjectiles(m: Match): void {
  const keep: Projectile[] = [];
  for (const p of m.projectiles) {
    if (p.kind === DEATH_MISSILE) {
      if (!stepDeathMissile(m, p)) continue;
    } else {
      if (!stepProjectile(p)) continue;
      if (tileAt(p.x, p.y) < 0) continue;
    }
    const hit = shotHit(m, p, p.owner, p.team, p.fromTile);
    if (hit) {
      // The move is undone (sub_42c830), so the shot bursts where it was.
      const [x, y, z] = p.from;
      const target = hit.kind === 'building' || hit.kind === 'gate' ? 'building' : 'vehicle';
      m.events.push({ type: 'hit', target, shot: p.kind, x, y, z });
      if (hit.kind === 'building') hitBuilding(m, hit.tile, p.damage);
      else if (hit.kind === 'gate') hitGate(m, hit.g, p.damage);
      else if (hit.kind === 'vehicle') hitVehicle(m, hit.v, p.damage);
      else if (hit.kind === 'drone' && p.damage >= DRONE_TOUGHNESS) downDrone(m, hit.d);
      else if (hit.kind === 'wreck') hitWreck(hit.w, p.damage);
      else if (hit.kind === 'soldier') killSoldier(m, hit.s);
      else if (hit.kind === 'mine' && p.damage > MINE_TOUGHNESS) setOff(m, hit.mine);
      continue;
    }
    if (p.z < 0) {
      // Into the ground (sub_414b10 with sub_42f280): a burst on land, a splash in water.
      const water = groundAt(m.world, p.x, p.y) !== LAND;
      m.events.push({ type: 'hit', target: water ? 'water' : 'ground', shot: p.kind, x: p.x, y: p.y });
      continue;
    }
    keep.push(p);
  }
  m.projectiles = keep;
}

/**
 * Whether a shot would have a clear line of fire (the probe, projectile type 3, class 0x4488c8: sub_414ef0 with
 * sub_415060 and sub_4150c0). The probe leaves the muzzle as a shot would and steps 32 px at a time, up to 16
 * steps, until it touches something or goes into the ground. The line is blocked if the first thing it touches is
 * on the shooter's side: one of its side's vehicles, or a building of its side.
 */
/** No vehicle's team: a probe passes no vehicle for being on its side. */
const NO_TEAM = -99;

function clearShot(
  m: Match, owner: number, friend: (team: number) => boolean, origin: Vec3, offset: Vec3, heading: number, pitch: number, fromTile: number,
): boolean {
  const probe = fireProjectile(3, owner, NO_TEAM, origin, offset, heading, pitch);
  const def = PROJECTILES[3]!;
  const [vx, vy, vz] = turn([0, -TILE_SIZE, 0], aim(heading, pitch & ANGLE_MASK, false));
  for (let n = (def.life * def.speed) >> TILE_SHIFT; n > 0; n--) {
    probe.from = [probe.x, probe.y, probe.z];
    probe.x += vx;
    probe.y += vy;
    probe.z += vz;
    if (tileAt(probe.x, probe.y) < 0) return true;
    // It passes its own side's vehicles here, so look for them first.
    const hit = shotHit(m, probe, owner, NO_TEAM, fromTile);
    if (hit) {
      if (hit.kind === 'vehicle') return !friend(hit.v.team);
      if (hit.kind === 'building' || hit.kind === 'gate') {
        const base = m.world.owner[hit.kind === 'gate' ? hit.g.tile : hit.tile]!;
        return base < 0 || !friend(baseTeam(m, base));
      }
      return true;
    }
    if (probe.z < 0) return true;
  }
  return true;
}

/**
 * A hit on a building. One that leaves it on its last hit point lets its men out (sub_42e8c0 calling sub_434980),
 * so a building destroyed outright, or crushed, lets nobody out.
 */
export function hitBuilding(m: Match, tile: number, damage: number): void {
  const before = m.world.hp[tile]!;
  const building = m.world.building[tile]!;
  if (damageBuilding(m.world, tile, damage, m.rng)) {
    buildingLost(m, tile, building, false);
    return;
  }
  if (before > 1 && m.world.hp[tile] === 1) letOut(m, tile);
}

/**
 * A hit on an open gate (the Gate's hit, sub_4324f0): its tile's hit points take it as the gate building's would
 * (sub_42e7f0). A hit that leaves none ends the gate, and the gate's end (sub_432460) puts the building back with
 * one hit point and hits it for 255 (sub_42e8c0), so it falls as a shut gate would.
 */
function hitGate(m: Match, g: Gate, damage: number): void {
  const w = m.world;
  const hp = w.hp[g.tile]!;
  const hits = buildingHits(w.defs[g.building]!, damage);
  if (!hp || !hits) return;
  if (hits < hp) {
    w.hp[g.tile] = hp - hits;
    return;
  }
  m.gates = m.gates.filter((o) => o !== g);
  w.building[g.tile] = g.building;
  w.hp[g.tile] = 1;
  hitBuilding(m, g.tile, 0xff0000);
}

/**
 * Whose men a base's prison holds. The original has two sides, so they are the other one's (owner ^ 1). With more
 * bases they are the next base round from the owner that is played by another team, or nobody's (-1) if there is none.
 */
export function prisonersOf(m: Match, owner: number): number {
  const n = m.world.bases.length;
  const team = baseTeam(m, owner);
  for (let k = 1; k < n; k++) {
    const b = (owner + k) % n;
    const t = baseTeam(m, b);
    if (t >= 0 && t !== team) return b;
  }
  return -1;
}

/**
 * The base whose colours face a player who has no single other side: the attack drones sent at them and the helmet on
 * their laughing skull. It is the base whose men their prison would hold; with two bases, the other one.
 */
export function rivalOf(m: Match, base: number): number {
  const rival = prisonersOf(m, base);
  return rival < 0 ? base ^ 1 : rival;
}

/** Most men alive at once. The original's object pool sets a limit; this one is ours. */
export const MAX_SOLDIERS = 96;

function letOut(m: Match, tile: number): void {
  const out = soldiersFrom(m.world, tile, m.rng, (owner) => prisonersOf(m, owner));
  if (!out) return;
  const team = out.base < 0 ? -1 : baseTeam(m, out.base);
  for (const [x, y] of out.at) {
    if (m.soldiers.length >= MAX_SOLDIERS) break;
    m.soldiers.push(makeSoldier(out.base, team, x, y, m.tick, m.rng));
  }
}

function buildingLost(m: Match, tile: number, building: number, crushed: boolean): void {
  m.events.push(crushed ? { type: 'buildingDestroyed', tile, building, crushed: true } : { type: 'buildingDestroyed', tile, building });
  const def = destroyExplosion(m.world.defs[building]!, crushed);
  if (def) {
    const e: BuildingExplosion = { tile, def, t: 0, ops: def.script, pc: 0, variant: 0 };
    m.explosions.push(e);
    startScript(e, (op) => explosionOp(m, e, op), m.rng);
  }
  revealFlags(m, tile);
}

/** One tick of the destroyed buildings' explosions, and of rubble waiting to appear (the timers run by sub_414760). */
function stepExplosions(m: Match): void {
  // An explosion may bring down a neighbour, which adds another: that one has had its first think already.
  const live = m.explosions;
  m.explosions = [];
  const kept = live.filter((e) => stepScript(e, e.def, (op) => explosionOp(m, e, op), m.rng));
  m.explosions = kept.concat(m.explosions);
  m.rubble = m.rubble.filter((r) => {
    if (m.tick < r.at) return true;
    destroyBuilding(m.world, r.tile, m.rng, r.building, r.owner);
    revealFlags(m, r.tile);
    return false;
  });
}

/** The ops of a building's explosion that change the map (see explosions.ts). */
function explosionOp(m: Match, e: BuildingExplosion, op: ExplosionOp): void {
  const w = m.world;
  // dx across, and one row up or down by the sign of dy.
  const near = () => e.tile + (op[1] as number) + Math.sign(op[2] as number) * GRID;
  switch (op[0]) {
    case 'tile':
      destroyBuilding(w, e.tile, m.rng);
      revealFlags(m, e.tile);
      break;
    case 'neighbour': {
      const i = near();
      if (w.building[i] !== op[3]) break;
      placeBuilding(w, i, op[4] as number, w.owner[i]! < 0 ? null : w.owner[i]!);
      break;
    }
    case 'edge':
    case 'corner': {
      const i = near();
      const match = op[0] === 'edge' ? w.building[i] === op[3] : (w.terrain[i]! & 0x7f) === op[3];
      // A gate standing open has no building on its tile; the original would hit an empty record there.
      if (match && w.building[i]) hitBuilding(m, i, 0xff0000);
      break;
    }
    case 'rubble':
      m.rubble.push({ tile: e.tile, building: w.building[e.tile]!, owner: w.owner[e.tile]!, at: m.tick + (op[1] as number) });
      w.building[e.tile] = 0;
      break;
    case 'turn':
      if (w.building[e.tile] === op[1]) w.owner[e.tile] = op[2] as number;
      break;
  }
}

function revealFlags(m: Match, tile: number): void {
  for (const f of m.flags) {
    if (f.revealed || f.site !== tile) continue;
    const b = m.world.building[tile]!;
    if (b === BUILDING.FLAG || b === BUILDING.DMG_FLAG) continue;
    f.revealed = true;
    m.events.push({ type: 'flagRevealed', base: f.base });
  }
}

/** Whether a flag belongs to a base on the player's own team. */
function ownFlag(m: Match, p: Player, f: Flag): boolean {
  const owner = m.players.find((q) => q.base === f.base);
  return !!owner && owner.team === p.team;
}

/** Whether a jeep is touching a flag: on its tile, or touching the opened flag building it still lies in. */
function touchingFlag(v: Vehicle, f: Flag): boolean {
  const at = tileOf(f.x, f.y);
  return v.kind === 'jeep' && (tileOf(v.x, v.y) === at || (v.flagTouched === f.site && at === f.site));
}

function takeFlag(m: Match, p: Player, f: Flag): void {
  f.carrier = p.id;
  f.dropper = -1;
  m.events.push({ type: 'flagTaken', base: f.base, player: p.id });
}

/**
 * A flag a jeep brings home is hidden again (sub_432600): in one of its base's flag buildings still standing, picked
 * at random, or, with none left, it is moved to a random flag site and stays in view.
 */
function rehideFlag(m: Match, f: Flag): void {
  const sites = m.world.bases[f.base]!.flagSites.map((s) => s.ty * GRID + s.tx);
  const standing = sites.filter((t) => m.world.building[t] === BUILDING.FLAG);
  f.carrier = -1;
  f.dropper = -1;
  if (!standing.length) {
    const t = sites[m.rng.below(sites.length)];
    if (t === undefined) return;
    f.x = centre(t % GRID);
    f.y = centre(Math.floor(t / GRID));
    return;
  }
  const t = standing[m.rng.below(standing.length)]!;
  f.site = t;
  f.x = centre(t % GRID);
  f.y = centre(Math.floor(t / GRID));
  f.revealed = false;
}

/**
 * The jeep's third button (sub_432e40): puts down the flag it carries, or picks up one it is touching, its own side's
 * first. Either side's flag can be carried; only an enemy flag brought home (teamHome) captures.
 */
function flagButton(m: Match, p: Player, v: Vehicle): void {
  const carried = m.flags.find((f) => f.carrier === p.id);
  if (carried) {
    carried.carrier = -1;
    carried.x = v.x;
    carried.y = v.y;
    carried.dropper = p.id;
    m.events.push({ type: 'flagDropped', base: carried.base });
    return;
  }
  const order = [...m.flags].sort((a, b) => Number(ownFlag(m, p, b)) - Number(ownFlag(m, p, a)));
  const f = order.find((f) => f.revealed && !m.eliminated[f.base] && f.carrier < 0 && touchingFlag(v, f));
  if (f) takeFlag(m, p, f);
}

/**
 * Whether a tile is home for a player's captures: the start of its own base or of any base on its team that is still
 * in the match (a flag taken to a teammate's base counts).
 */
function teamHome(m: Match, p: Player, tile: number): boolean {
  return m.world.bases.some((b) => tile === b.start.ty * GRID + b.start.tx && !m.eliminated[b.id] && (b.id === p.base || baseTeam(m, b.id) === p.team));
}

function stepFlags(m: Match, p: Player, v: Vehicle): void {
  const tile = tileOf(v.x, v.y);
  for (const f of m.flags) {
    if (!f.revealed || m.eliminated[f.base]) continue;
    if (f.carrier === p.id) {
      f.x = v.x;
      f.y = v.y;
      if (!ownFlag(m, p, f) && teamHome(m, p, tile)) {
        const left = (m.captures[f.base] = Math.max(0, m.captures[f.base]! - 1));
        m.events.push({ type: 'captured', base: f.base, player: p.id, left });
        // With captures to spare (the handicap) the flag goes back to its base, hidden again if a flag building stands.
        if (left > 0) rehideFlag(m, f);
        else eliminate(m, f.base);
      }
      continue;
    }
    const touching = touchingFlag(v, f);
    // The flag forgets who put it down once that jeep is off it (sub_432920).
    if (f.dropper === p.id && !touching) f.dropper = -1;
    if (f.carrier >= 0 || f.dropper >= 0 || !touching) continue;
    // A jeep carries one flag at a time (sub_432d00).
    if (m.flags.some((g) => g.carrier === p.id)) continue;
    takeFlag(m, p, f);
  }
}

/** Fuel gained per tick on a fuel pad (sub_40c540 adds 0.5 a tick up to the tank's capacity). */
export const REFUEL_RATE = 0x8000;
/** Ticks between the resupply dings. */
const RESUPPLY_SOUND = 40;
/** Weapon slots an ammo pad fills, by vehicle (DAT_004453c8): only the helicopter's second weapon is reloaded too. */
const RESUPPLY_SLOTS: Record<VehicleKind, number> = { tank: 1, jeep: 1, asv: 1, heli: 2 };
const FUEL_PAD = 1;
const AMMO_PAD = 2;
const GATE_PAD = 3;

/**
 * The pad a vehicle last drove onto (sub_40c540). A gate's trigger zone opens the gate if it belongs to the
 * vehicle's base. A fuel or ammo pad, of any side, resupplies the vehicle while it stands still on it: half a unit
 * of fuel, or one round, a tick.
 */
function stepPad(m: Match, p: Player, v: Vehicle, still: boolean): void {
  const pad = v.pad;
  if (!pad) return;
  const def = m.world.defs[m.world.building[pad.tile]!];
  const part = def?.shapes[pad.part];
  const kind = part?.flags[1] ?? 0;
  if (!def || !part || kind < FUEL_PAD || kind > GATE_PAD) {
    v.pad = null;
    return;
  }
  if (kind === GATE_PAD) {
    if (m.world.owner[pad.tile] === v.base) {
      const g = openGate(m.world, pad.tile, p.id, v);
      if (g) {
        m.gates.push(g);
        m.events.push({ type: 'gate', tile: g.tile, sound: 'move' });
      }
    }
    v.pad = null;
    return;
  }
  if (!still) return;
  const me = { x: v.x, y: v.y, z: v.z, heading: v.heading };
  if (!touch(me, VEHICLES[v.kind].shapes, buildingBody(m.world, pad.tile), def.shapes.slice(pad.part))) {
    v.pad = null;
    return;
  }
  const d = VEHICLES[v.kind];
  let ding = false;
  if (kind === FUEL_PAD) {
    v.fuel += REFUEL_RATE;
    if (v.fuel > d.fuel) v.fuel = d.fuel;
    else ding = true;
  } else {
    for (let s = 0; s < RESUPPLY_SLOTS[v.kind]; s++) {
      const max = d.weapons[s]!.ammo;
      v.ammo[s] = v.ammo[s]! + 1;
      if (v.ammo[s]! < max) {
        ding = true;
        break;
      }
      v.ammo[s] = max;
    }
  }
  if (ding && v.resupplyAt <= m.tick) {
    v.resupplyAt = m.tick + RESUPPLY_SOUND;
    m.events.push({ type: 'resupply', player: p.id, x: v.x, y: v.y });
  }
}

/** The things a vehicle can run into besides buildings: the other ground vehicles and the gates' halves. */
function obstaclesFor(m: Match, v: Vehicle): Obstacle[] {
  const out = gateObstacles(m.world, m.gates);
  for (const q of m.players) {
    const o = q.vehicle;
    if (!o || o === v || q.state !== 'driving' || airborne(o)) continue;
    out.push({ body: { x: o.x, y: o.y, z: o.z, heading: o.heading }, shapes: VEHICLES[o.kind].shapes, tile: tileOf(o.x, o.y), owner: o });
  }
  for (const s of m.soldiers) {
    if (s.dead) continue;
    out.push({ body: { x: s.x, y: s.y, z: 0, heading: s.heading }, shapes: soldierShapes(s), tile: tileOf(s.x, s.y), owner: s, soft: true });
  }
  // A wreck stands in the way while its model has shapes: a vehicle out of fuel, or the helicopter's falling wreck.
  for (const w of m.wrecks) {
    if (!wreckSolid(w) || airborne(v)) continue;
    out.push({ body: { x: w.x, y: w.y, z: w.z, heading: w.heading }, shapes: VEHICLES[w.kind].shapes, tile: tileOf(w.x, w.y), owner: w });
  }
  return out;
}

/** Crushing a bush or tent (sub_436640, sub_436a50) hits it for 100, with the record's other explosion. */
const CRUSH_DAMAGE = 0x640000;

function crush(m: Match, tile: number): void {
  const building = m.world.building[tile]!;
  if (damageBuilding(m.world, tile, CRUSH_DAMAGE, m.rng, true)) buildingLost(m, tile, building, true);
}

/** Gates opening and closing. */
function stepGates(m: Match): void {
  const inPlay = (v: Vehicle) => m.players.some((p) => p.vehicle === v && p.state === 'driving');
  m.gates = m.gates.filter((g) => {
    const blocked = (gate: Gate) => m.soldiers.some((s) => !s.dead && !!touch(buildingBody(m.world, gate.tile), gateShapes(gate), { x: s.x, y: s.y, z: 0, heading: s.heading }, soldierShapes(s)));
    const { keep, sound } = stepGate(m.world, g, inPlay, blocked);
    if (sound) m.events.push({ type: 'gate', tile: g.tile, sound });
    return keep;
  });
}

// Soldiers. The match keeps them alive while someone can see them: the original's draw functions stamp a man each
// time he is drawn. The sim has no screens, so a man counts as seen while he is within a screen's reach of any
// vehicle in play: 192 px either side, 240 px ahead up the screen and 160 px below (inferred from the tilted
// 320 x 240 view, which shows more ground above the vehicle than below it).
const SEEN_X = 192 * ONE;
const SEEN_UP = 240 * ONE;
const SEEN_DOWN = 160 * ONE;

function vehiclesInPlay(m: Match): Vehicle[] {
  const out: Vehicle[] = [];
  for (const p of m.players) if (p.vehicle && p.state === 'driving') out.push(p.vehicle);
  return out;
}

/** A man run over or shot (sub_433c60, sub_433ce0): the ManCrush sound, and on land a splat. */
function killSoldier(m: Match, s: Soldier): void {
  if (!m.soldiers.includes(s)) return;
  s.dead = true;
  m.soldiers = m.soldiers.filter((o) => o !== s);
  const water = s.water;
  const variant = water ? 0 : m.rng.below(3) * 2 + (s.base & 1);
  m.events.push({ type: 'soldierKilled', base: s.base, x: s.x, y: s.y, water, variant });
}

/** A man under a shot: its point inside his box. */
function soldierAt(m: Match, x: number, y: number): Soldier | null {
  for (const s of m.soldiers) {
    if (s.dead) continue;
    const b = soldierShapes(s)[0]!.bounds;
    const dx = x - s.x;
    const dy = y - s.y;
    if (b[0]! <= dx && dx <= b[2]! && b[1]! <= dy && dy <= b[3]!) return s;
  }
  return null;
}

function stepSoldiers(m: Match): void {
  if (!m.soldiers.length) return;
  const vehicles = vehiclesInPlay(m);
  for (const s of m.soldiers) {
    if (vehicles.some((v) => inSight(v, s.x, s.y))) s.seen = m.tick;
  }
  const sw: SoldierWorld = { world: m.world, rng: m.rng, tick: m.tick, vehicles, gates: m.gates, soldiers: m.soldiers };
  for (const s of [...m.soldiers]) {
    if (s.dead) continue;
    const act = stepSoldier(sw, s);
    if (s.dead) {
      // Run over walking into a vehicle, or gone: unseen, or with nowhere to stand.
      if (s.crushed) killSoldier(m, s);
      else m.soldiers = m.soldiers.filter((o) => o !== s);
      sw.soldiers = m.soldiers;
      continue;
    }
    if (act.throwAt) {
      const { x, y } = act.throwAt;
      m.events.push({ type: 'fired', shot: 'grenade', x: s.x, y: s.y });
      m.grenades.push(throwGrenade(-1, s.team, s.x, s.y, 0, headingTo(x - s.x, y - s.y), distance(x - s.x, y - s.y) >> FIXED_SHIFT));
    }
  }
}

const WRECK_GROUND = { [LAND]: 'land', [SHALLOW]: 'shallow', [DEEP]: 'deep' } as const;

/** Wrecks (wrecks.ts): moving, falling, sinking, blowing apart, coming to rest, and drivers getting out. */
function stepWrecks(m: Match): void {
  if (!m.wrecks.length) return;
  const ground = (x: number, y: number) => WRECK_GROUND[groundAt(m.world, x, y)];
  for (const w of [...m.wrecks]) {
    const def = VEHICLES[w.kind];
    const body = { x: w.x, y: w.y, z: 0, heading: w.heading };
    const man = soldierShapes({ water: false } as Soldier);
    const clear = (x: number, y: number) => !touch(body, def.shapes, { x, y, z: 0, heading: 0 }, man);
    const model = w.model;
    const r = stepWreck(w, m.tick, ground, def.sinkDepth, clear);
    if (r.blew) m.events.push({ type: 'wreckBlown', kind: w.kind, base: w.base, x: w.x, y: w.y, z: w.z, heading: w.heading, model });
    if (r.driverAt && m.soldiers.length < MAX_SOLDIERS) {
      const [x, y] = r.driverAt;
      m.soldiers.push({ ...makeSoldier(w.base, w.team, x, y, m.tick, m.rng), state: 'choose' });
    }
    if (!r.end) continue;
    m.wrecks = m.wrecks.filter((o) => o !== w);
    if (r.end === 'mark') {
      m.events.push({ type: 'wreckMark', kind: w.kind, base: w.base, x: w.x, y: w.y, heading: w.heading, model: w.model, ticks: WRECK_TICKS });
    } else if (r.end === 'sunk') {
      m.events.push({ type: 'wreckSunk', kind: w.kind, x: w.x, y: w.y });
    }
  }
}

/**
 * Whether a gun tower is on a vehicle's screen, for waking it. The same reach up and down the map, unlike inSight:
 * a tower that woke sooner for a vehicle coming up the map than for one coming down it had longer to aim, and bases
 * at the top of a map held out better than their mirror images at the bottom. The original's two players shared
 * that slant; with bases on every side it has to be even.
 */
function towerSeen(v: Vehicle, x: number, y: number): boolean {
  return Math.abs(v.x - x) <= SEEN_X && Math.abs(v.y - y) <= TOWER_SEEN_Y;
}
const TOWER_SEEN_Y = 200 * ONE;

/** Whether a point is within a screen's reach of a vehicle (see SEEN_X). */
function inSight(v: Vehicle, x: number, y: number): boolean {
  return Math.abs(v.x - x) <= SEEN_X && y - v.y <= SEEN_DOWN && v.y - y <= SEEN_UP;
}

/**
 * Drone launches (the vehicle think function, around 0x40bddb). A vehicle that stays on one tile has its clock
 * restarted every 360 ticks, and each time, if fewer than three enemy gun towers are on its player's screen, a drone
 * is sent after it while the pool for its team has one free. Towers count when awake and within sight, as the sim
 * has no screens; the original counts the ones it drew.
 */
function stepCamp(m: Match, p: Player, v: Vehicle): void {
  const tile = tileOf(v.x, v.y);
  if (tile !== p.campTile) {
    p.campTile = tile;
    p.campAt = m.tick;
    return;
  }
  if (p.campAt + CAMP_TICKS >= m.tick) return;
  p.campAt = m.tick;
  // Towers of a base that is out (or was left empty) never fire, so they do not count.
  const towers = m.turrets.filter((t) => !(t.base >= 0 && m.eliminated[t.base]) && (t.base < 0 ? -1 : baseTeam(m, t.base)) !== p.team && inSight(v, t.x, t.y)).length;
  if (towers >= CAMP_TOWERS) return;
  if (m.drones.filter((d) => d.targetTeam === p.team).length >= m.dronePool) return;
  const at = droneSpawn(m.rng, v, vehiclesInPlay(m));
  if (!at) return;
  m.drones.push(makeDrone(m.nextDrone++, rivalOf(m, p.base), v, at[0], at[1], m.tick));
  m.events.push({ type: 'droneLaunched', player: p.id });
}

/** A drone hit hard enough (sub_40a6e0, then sub_40a010's explosion and falling wreck). */
function downDrone(m: Match, d: Drone): void {
  d.dead = true;
  m.drones = m.drones.filter((o) => o !== d);
  m.events.push({ type: 'droneDown', x: d.x, y: d.y, z: d.z, heading: d.heading, vx: d.vx, vy: d.vy, side: d.side });
}

function stepDrones(m: Match): void {
  if (!m.drones.length) return;
  const vehicles = vehiclesInPlay(m);
  const dw: DroneWorld = { tick: m.tick, drones: m.drones };
  for (const d of [...m.drones]) {
    if (d.target && !vehicles.includes(d.target)) d.target = null;
    if (vehicles.some((v) => inSight(v, d.x, d.y))) d.seen = m.tick;
    const shot = stepDrone(dw, d);
    if (d.dead) {
      m.drones = m.drones.filter((o) => o !== d);
      dw.drones = m.drones;
      continue;
    }
    if (!shot) continue;
    const at: Vec3 = [d.x, d.y, d.z];
    // A drone's side is everyone but the side it was sent against.
    const friend = (team: number) => team >= 0 && team !== d.targetTeam;
    if (shot.check && !clearShot(m, DRONE_OWNER, friend, at, shot.offset, shot.heading, shot.pitch, -1)) continue;
    const p = fireProjectile(shot.kind, DRONE_OWNER, -1, at, shot.offset, shot.heading, shot.pitch);
    m.projectiles.push(p);
    droneFired(d);
    m.events.push({ type: 'fired', shot: shot.kind, x: p.x, y: p.y, z: p.z });
  }
}

function checkWinner(m: Match): void {
  if (m.winner !== null || m.draw) return;
  const alive = new Set<number>();
  for (const p of m.players) if (!m.eliminated[p.base]) alive.add(p.team);
  if (alive.size === 1) {
    m.winner = [...alive][0]!;
    m.events.push({ type: 'won', team: m.winner });
  } else if (alive.size === 0 && m.players.length) {
    m.draw = true;
    m.events.push({ type: 'draw' });
  }
}

/** Advances the match by one 16 ms tick. inputs is indexed by player id. */
export function stepMatch(m: Match, inputs: readonly (VehicleInput | undefined)[]): void {
  m.events = [];
  if (m.winner !== null || m.draw) return;
  m.tick++;
  stepLifts(m);
  for (const p of m.players) {
    const v = p.vehicle;
    stepDeath(m, p);
    stepScreen(m, p);
    if (!v || p.state !== 'driving') continue;
    const input = inputs[p.id] ?? { throttle: 0, turn: 0 };
    v.crushed = [];
    v.ranOver = [];
    v.flagTouched = -1;
    // A helicopter taking off or landing does nothing else that tick (its think state returns early).
    const held = busy(v);
    const still = stepVehicle(v, input, m.world, obstaclesFor(m, v), m.rng);
    if (v.heli && !m.sub && callsSub(v.x, v.y)) m.sub = makeSub();
    if (v.heli?.phase === 'docked') {
      takeIn(m, p, v);
      continue;
    }
    for (const tile of v.crushed) crush(m, tile);
    for (const s of v.ranOver as Soldier[]) killSoldier(m, s);
    if (sunk(v)) {
      loseVehicle(m, p, 'drowned');
      continue;
    }
    // Each vehicle's three buttons (definition +0x17c, +0x180, +0x184, run in that order by sub_40b980).
    if (v.kind === 'heli') {
      // Its third button swaps between gun and missiles (sub_40e7a0); the first fires the one picked down at the
      // ground, the second straight ahead (sub_40e600).
      if (input.fire3 && !v.fire3Held) {
        v.weapon ^= 1;
        m.events.push({ type: 'weapon', player: p.id, slot: v.weapon, x: v.x, y: v.y });
      }
      if (!held) {
        if (input.fire) heliShot(m, v, true);
        if (input.fire2) heliShot(m, v, false);
      }
    } else {
      if (input.fire && !held) fire(m, v, 0);
      if (v.kind === 'jeep') {
        const t = input.fire2 && !v.fire2Held ? toggleTyres(v, m.world) : null;
        if (t) m.events.push({ type: 'tyres', player: p.id, out: t === 'out', x: v.x, y: v.y });
        if (input.fire3 && !v.fire3Held) flagButton(m, p, v);
      } else {
        // The tank's and the ASV's second button fires raised, at aircraft; the ASV's third lays mines (sub_40d820).
        if (input.fire2) trigger(m, v, true);
        if (v.kind === 'asv' && input.fire3 && !held) fire(m, v, 1);
      }
    }
    v.fire2Held = !!input.fire2;
    v.fire3Held = !!input.fire3;
    stepBarrel(m, v);
    if (v.fuel <= 0) {
      loseVehicle(m, p, 'fuel');
      continue;
    }
    stepPad(m, p, v, still);
    stepFlags(m, p, v);
    stepCamp(m, p, v);
  }
  stepWrecks(m);
  stepDrones(m);
  stepSoldiers(m);
  stepGates(m);
  stepExplosions(m);
  stepTurrets(m);
  stepSubmarine(m);
  stepProjectiles(m);
  stepGrenades(m);
  stepMines(m);
  checkJeeps(m);
  checkWinner(m);
}

// Gun towers, traced from the original:
// - A tower building is woken into a Turret Gun object when it is drawn on the screen of an enemy vehicle
//   (sub_42e180, the building's draw, calls sub_4321b0 with the viewer's vehicle), and that vehicle is its target
//   from then on. The sim has no screens, so "drawn" is a reach round the vehicle (towerSeen).
// - sub_431b20 has it wait the low byte of random(300) ticks (sub_431ce0), then sub_431d00 turns it toward its
//   target at 0x3333 a tick, however far off the target is. Once it is lined up and the target is nearer than
//   0xC00000 (192 px, a true distance: sub_42cd70), it tilts its gun toward the drop to the target at 0xa3d a tick,
//   by no more than 6 steps up or down (level again while it turns), and fires.
// - sub_431f70 first sends a probe (type 3) along the line of fire: if that meets the tower's own side it waits 30
//   ticks, otherwise it fires a shell (type 4) from the end of its gun and waits 60.
// - When the target is gone sub_432060 turns it back to the heading it woke with, then levels the gun, and the
//   object goes, leaving the building to wake again. sub_431ba0 also drops it once it has been on nobody's screen
//   for more than 300 ticks.

/** Buildings that wake into gun towers: TOWER and LARGE_TOWER. */
export const TURRET_BUILDINGS: ReadonlySet<number> = new Set([49, 50]);
export const TURRET_RANGE = 0xc00000;
export const TURRET_TURN = 0x3333;
export const TURRET_RELOAD = 60;
export const TURRET_BLOCKED = 30;
export const TURRET_PITCH_TURN = 0xa3d;
/** The gun tilts no more than 6 steps up or down. */
const TURRET_PITCH_MOST = 0x60000;
/** A woken tower that has been on nobody's screen for longer than this is a building again. */
const TURRET_UNSEEN = 300;
const TURRET_WAKE_DELAY = 300;
const TURRET_SHELL = 4;
/** The end of the gun (model vertices 0x44bbc0, and 0x44be38 on the large tower). */
const TURRET_GUN: Vec3 = [0, -15 * ONE, 0x188000];
const LARGE_TURRET_GUN: Vec3 = [0, -15 * ONE, 0x1d8000];
const LARGE_TOWER = 50;

/** The team a base's buildings, towers and men are on: its players', or -1 (nobody's side) for a base left empty. */
function baseTeam(m: Match, base: number): number {
  return m.players.find((p) => p.base === base)?.team ?? -1;
}

function stepTurrets(m: Match): void {
  const w = m.world;
  // Wake towers on the screen of an enemy vehicle; the first such player in seat order is its target.
  for (const b of w.buildings) {
    const i = b.ty * GRID + b.tx;
    if (!TURRET_BUILDINGS.has(w.building[i]!) || !w.hp[i] || m.turrets.some((t) => t.tile === i)) continue;
    const x = centre(b.tx);
    const y = centre(b.ty);
    const owner = w.owner[i]!;
    const team = owner < 0 ? -1 : baseTeam(m, owner);
    const target = m.players.findIndex((p) => p.vehicle && p.vehicle.team !== team && towerSeen(p.vehicle, x, y));
    if (target < 0) continue;
    // It wakes aimed where its tile's scenery entry says (sub_42e150): heading from byte 3, pitch from byte 0.
    const e = sceneryEntry(i);
    const heading = (w.variety[e]! & 0x3f) << 16;
    const pitch = (w.scenery[e * 2]! & 0xff) << 14;
    m.turrets.push({
      tile: i, base: owner, x, y, heading, pitch, activeAt: m.tick + (m.rng.below(TURRET_WAKE_DELAY) & 0xff), readyAt: 0,
      target, seenAt: m.tick, rest: heading,
    });
  }
  // A destroyed tower stands until its explosion swaps the rubble in; inferred, not traced: its gun is dead by then.
  m.turrets = m.turrets.filter((t) => {
    if (!TURRET_BUILDINGS.has(w.building[t.tile]!) || !w.hp[t.tile]) return false;
    if (m.players.some((p) => p.vehicle && towerSeen(p.vehicle, t.x, t.y))) t.seenAt = m.tick;
    return m.tick - t.seenAt <= TURRET_UNSEEN;
  });
  const gone = new Set<Turret>();
  for (const t of m.turrets) {
    if (m.tick <= t.activeAt) continue;
    const team = t.base < 0 ? -1 : baseTeam(m, t.base);
    const v = t.base >= 0 && m.eliminated[t.base] ? undefined : m.players[t.target]?.vehicle;
    if (!v || v.team === team) {
      // Back to rest: the heading it woke with, then the gun level, and the tower is a building again.
      t.target = -1;
      if (t.heading !== t.rest) t.heading = turnToward(t.heading, t.rest, TURRET_TURN);
      else if (t.pitch !== 0) t.pitch = turnToward(t.pitch, 0, TURRET_PITCH_TURN);
      else gone.add(t);
      continue;
    }
    const aim = headingTo(v.x - t.x, v.y - t.y);
    t.heading = turnToward(t.heading, aim, TURRET_TURN);
    const gun = w.building[t.tile] === LARGE_TOWER ? LARGE_TURRET_GUN : TURRET_GUN;
    const dist = distance(v.x - t.x, v.y - t.y);
    const inRange = t.heading === aim && dist < TURRET_RANGE;
    let tilt = 0;
    if (inRange) {
      tilt = (fineAtan2(gun[2] - v.z, dist) >> 2) & ANGLE_MASK;
      if (tilt > TURRET_PITCH_MOST && tilt < ANGLE_MASK + 1 - TURRET_PITCH_MOST) tilt = tilt > (ANGLE_MASK + 1) >> 1 ? ANGLE_MASK + 1 - TURRET_PITCH_MOST : TURRET_PITCH_MOST;
    }
    t.pitch = turnToward(t.pitch, tilt, TURRET_PITCH_TURN);
    if (!inRange || m.tick < t.readyAt) continue;
    const at: Vec3 = [t.x, t.y, 0];
    if (!clearShot(m, -1, (q) => team >= 0 && q === team, at, gun, t.heading, t.pitch, t.tile)) {
      t.readyAt = m.tick + TURRET_BLOCKED;
      continue;
    }
    const shot = fireProjectile(TURRET_SHELL, -1, team, at, gun, t.heading, t.pitch);
    shot.fromTile = t.tile;
    m.projectiles.push(shot);
    m.events.push({ type: 'fired', shot: TURRET_SHELL, x: shot.x, y: shot.y, z: shot.z });
    t.readyAt = m.tick + TURRET_RELOAD;
  }
  if (gone.size) m.turrets = m.turrets.filter((t) => !gone.has(t));
}
