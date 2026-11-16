// Computer players. The original has no bots in two-player games, so this is new behaviour, kept simple and
// deterministic (integers only, no randomness of its own) so a server and every client compute the same moves.
//
// A bot waits in its bunker until every human player has launched a vehicle, or START_GRACE after the first did (see
// createBot). Then its plan, each tick:
// - With a flag, it goes home: an enemy flag is captured on arrival, its own side's is docked to hide it again.
// - A jeep fetches the nearest free enemy flag, or brings its own side's back. A careful bot (level 3 up) first
//   clears the gun towers round the flag with a tank or helicopter, and its jeeps steer clear of towers. Jeeps
//   float across deep water on their tyres, throw grenades at enemy vehicles close by, and otherwise stay in the
//   bunker while the bot has something else to fight with: a base with no jeeps left is out.
// - Tanks, helicopters and ASVs hunt an enemy jeep carrying their side's flag, stop one closing on it, clear the
//   towers round an exposed enemy flag, and otherwise shell the enemy's possible flag sites, teammates spreading
//   over different ones. They shoot the nearest enemy in reach (the tank and ASV fire raised at helicopters, the
//   helicopter fires ahead at them), the helicopter uses missiles on armour and buildings, and the ASV lays
//   mines round enemy lifts and in the path of a chaser.
// - It goes home to refuel, and to repair when badly hit (docking gives back a fresh vehicle).
// Routes come from a shortest-path field over the tile grid that keeps out of what would stop the vehicle, and
// costs water, enemy tower ranges and the bot's own side's mines.
//
// The match difficulty (1-9), or the bot's own when it has one (online lobbies set it per seat), sets how well it
// plays (see botSkill). Drones and random mines follow the match difficulty.

import { stopsVehicle } from './buildings.js';
import { ANGLE_MASK, FIXED_SHIFT, ONE, TICK_MS, TILE_SHIFT, distance, headingTo } from './fixed.js';
import { GATE_H, GATE_V } from './gates.js';
import { GRID } from './map.js';
import { TURRET_BUILDINGS, TURRET_RANGE, UNLIMITED, type Flag, type Match, type Player } from './match.js';
import { DEEP, LAND, groundAt } from './shore.js';
import { TURRET_SWING, VEHICLES, airborne, hasDeepWater, type Vehicle, type VehicleInput, type VehicleKind } from './vehicle.js';
import { GRENADE_RANGE, PROJECTILES, mineArmed } from './weapons.js';

export interface BotState {
  goal: number;
  field: Int32Array | null;
  /** The vehicle the field was planned for: jeeps float over water and go round rocks heavier vehicles cross. */
  fieldKind: VehicleKind | null;
  fieldAt: number;
  /** Ticks spent trying to drive or turn without moving, and where it was last tick. */
  stuck: number;
  last: number;
  /** Backs up and turns until this tick. */
  reverseUntil: number;
  /** The enemy player it has seen, and the tick it first saw them (for its reaction time). */
  enemy: number;
  seenAt: number;
  /** Where that enemy was last tick, to lead the shot. */
  enemyX: number;
  enemyY: number;
  /** Its own skill level, 1-9, or null to play at the match difficulty. */
  difficulty: number | null;
  /** By flag: the tick it saw the flag lying free, or -1 (for the time it takes to notice, see botSkill). */
  seen: number[];
  /** The human players it still waits for: those who have not launched a vehicle yet. */
  waitFor: number[];
  /** The tick the first human it waited for launched, or -1: the rest get START_GRACE from then. */
  firstLaunch: number;
  /**
   * Times it has gone home hurt to repair since a vehicle was last destroyed anywhere. Two bots that each back off
   * to repair would otherwise trade the same shots for ever, so after REPAIR_PATIENCE trips it fights on.
   */
  repairs: number;
  /** The lift a jeep is taking an enemy flag to: its own, or a nearer one of its team's. */
  flagHome?: number;
  /**
   * Its own run of random numbers (xorshift32 state; 0 until its first think seeds it from the match's and its
   * seat). It never draws from the match's, which every client must step alike, so two bots on a mirrored map do
   * not play out the same duel every game.
   */
  luck: number;
  /** In the bunker: the tick it has picked its next vehicle by, or -1 (it takes a moment, longer at low skill). */
  launchAt: number;
  /** The enemy base it set out for on this sortie, or -1 (pickBase). */
  target: number;
}

export interface BotMove {
  input?: VehicleInput;
  launch?: VehicleKind;
  dock?: boolean;
}

/**
 * How long, after the first human launches, the bots wait for the others who are still picking a vehicle. Without
 * it the bots would go for a slower player's flag while they sat on the lift screen; with no limit one player
 * idling in the bunker would hold the bots back for good.
 */
export const START_GRACE = Math.round(45_000 / TICK_MS);

/**
 * A bot at its own difficulty (null for the match's). waitFor lists the human players: the bot does nothing until
 * every one of them has launched a vehicle, or START_GRACE after the first of them did, so nobody is overrun while still on the lift screen. Leave it empty for a bot that plays at once (no
 * humans, or a match already under way). firstLaunch is the tick a human already launched at, for a bot that
 * joins part way through the wait (a seat taken over online).
 */
export function createBot(difficulty: number | null = null, waitFor: readonly number[] = [], firstLaunch = -1): BotState {
  return {
    goal: -1, field: null, fieldKind: null, fieldAt: 0, stuck: 0, last: 0, reverseUntil: 0, enemy: -1, seenAt: 0, enemyX: 0, enemyY: 0,
    difficulty, seen: [], waitFor: [...waitFor], firstLaunch, repairs: 0, luck: 0, launchAt: -1, target: -1,
  };
}

/**
 * Whether a bot is still waiting for the humans to launch. A human counts once they have launched (or their base is
 * out), even if they dock again; once nobody is left to wait for, or the grace is up, it stops waiting for good.
 */
export function botWaiting(m: Match, bot: BotState): boolean {
  // Once a start gate has opened, every human has had their chance to go up: the bots set off.
  if (m.startTick > 0) bot.waitFor = [];
  if (!bot.waitFor.length) return false;
  const left = bot.waitFor.filter((h) => {
    const p = m.players[h];
    return !!p && p.state === 'bunker' && !m.eliminated[p.base];
  });
  if (left.length < bot.waitFor.length && bot.firstLaunch < 0) bot.firstLaunch = m.tick;
  bot.waitFor = left;
  if (bot.firstLaunch >= 0 && m.tick - bot.firstLaunch >= START_GRACE) bot.waitFor = [];
  return bot.waitFor.length > 0;
}

const STEP = 1 << FIXED_SHIFT;
const HALF_TILE = 1 << (TILE_SHIFT - 1);
/**
 * A shot flies along the whole heading step its gun's heading falls in (the sine table has 64 entries and the
 * heading is cut down to one). So a bot aims its gun at the middle of the step that points at the target: aiming at
 * the step's start, a gun that settled a shade short fired one whole step off. That miss was always to the same
 * hand, so of two bots facing each other across the map the one looking east out-shot the one looking west.
 */
const AIM_CENTRE = STEP >> 1;
/** Fire when within 2 heading steps of lined up. */
const AIM_SLACK = 2 * STEP;
// Shots fly in 3D: a helicopter's first button brings them down about 60 px ahead of it, so it fires from about
// there and backs off if closer.
const HELI_REACH = 60 * ONE;
const HELI_REACH_SLACK = 20 * ONE;

export interface BotSkill {
  /** Engages enemy vehicles this close, in world units. */
  engageRange: number;
  /** Ticks between first seeing an enemy and shooting at it. */
  reaction: number;
  /** Aim wanders up to this many heading steps either side. */
  aimError: number;
  /** Goes home to repair below this many sixteenths of its health; 0 fights on to the end. */
  retreat: number;
  /** Keeps its jeeps out of tower range. */
  careful: boolean;
  /** Gun towers it lets cover a flag before it clears them ahead of sending a jeep. */
  towers: number;
  /** Hunts the jeep carrying its side's flag and stops enemy jeeps closing on it. */
  defends: boolean;
  /** Its ASVs lay mines. */
  mines: boolean;
  /** Ticks before it acts on a flag that has come into the open. */
  notice: number;
  /** How far it leads a moving target, in quarters of the way. */
  lead: number;
}

/**
 * How a bot plays at a difficulty from 1 to 9. Level 1 picks fights at 3 tiles, reacts in 80 ticks, aims up to 4
 * steps off and simply rushes; level 5 fights at 7 tiles, reacts in 40 ticks, aims dead on, clears towers before
 * sending jeeps, defends its flag, lays mines and goes home to repair under 3/16 health; level 9 fights at 11
 * tiles, reacts at once and repairs under 6/16.
 */
export function botSkill(difficulty: number): BotSkill {
  return {
    engageRange: (2 + difficulty) << TILE_SHIFT,
    reaction: (9 - difficulty) * 10,
    aimError: Math.max(0, 5 - difficulty),
    retreat: Math.max(0, Math.min(6, difficulty - 2)),
    careful: difficulty >= 3,
    towers: difficulty >= 3 ? TOWER_LIMIT : 99,
    defends: difficulty >= 2,
    mines: difficulty >= 4,
    notice: (9 - difficulty) * 40,
    lead: Math.max(0, Math.min(4, difficulty - 2)),
  };
}

/** An integer in [0, n) from the bot's own random numbers. */
function roll(bot: BotState, n: number): number {
  let x = bot.luck;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  bot.luck = x | 0 || 1;
  return (x >>> 0) % n;
}

/** Trips home to repair a bot makes with nothing destroyed in between before it stops backing off. */
const REPAIR_PATIENCE = 1;
/** The towers a careful bot lets cover a flag. */
const TOWER_LIMIT = 1;
/** Stand off this far (tiles) from a building being shelled. */
const SHELL_RANGE = 4;
/** Drive only when within an eighth of a turn of the way ahead. */
const DRIVE_SLACK = 8 * STEP;
const STUCK_TICKS = 45;
const REVERSE_TICKS = 30;
const FIELD_REFRESH = 120;
const UNREACHABLE = 0x7fffffff;
/** Order of preference for attacking, and the order when the target can't be reached over land. */
const ATTACKERS: readonly VehicleKind[] = ['tank', 'heli', 'asv'];
const BY_AIR: readonly VehicleKind[] = ['heli', 'tank', 'asv'];
/**
 * A careful bot sends no jeep for a flag with an enemy tank, helicopter or ASV this close (tiles), and before
 * swapping for one hunts down any within FLAG_CLEAR, so the guard can't simply wait for the jeep. A jeep already
 * out keeps going.
 */
const FLAG_WATCH = 7;
const FLAG_CLEAR = 12;
/** Tower reach in tiles: a circle, as the towers measure it (stepTurrets in match.ts). */
const TOWER_TILES = TURRET_RANGE >> TILE_SHIFT;

/** Whether a tower's range covers a tile. */
function inTowerRange(tower: number, tile: number): boolean {
  const dx = (tower % GRID) - (tile % GRID);
  const dy = Math.floor(tower / GRID) - Math.floor(tile / GRID);
  return dx * dx + dy * dy <= TOWER_TILES * TOWER_TILES;
}
// Route costs: a step, and extra for deep water (a jeep floats at a quarter speed), tower range and own mines.
const STEP_COST = 4;
const WATER_COST = 8;
const TOWER_COST_JEEP = 24;
const TOWER_COST = 2;
const MINE_COST = 40;

const tileOf = (x: number, y: number) => (y >> TILE_SHIFT) * GRID + (x >> TILE_SHIFT);
const centre = (t: number) => ({ x: ((t % GRID) << TILE_SHIFT) + HALF_TILE, y: (Math.floor(t / GRID) << TILE_SHIFT) + HALF_TILE });

function tileDistance(a: number, b: number): number {
  return Math.max(Math.abs((a % GRID) - (b % GRID)), Math.abs(Math.floor(a / GRID) - Math.floor(b / GRID)));
}

function teamOf(m: Match, base: number): number | null {
  return m.players.find((p) => p.base === base)?.team ?? null;
}

const has = (p: Player, k: VehicleKind) => p.lives[k] > 0 || p.lives[k] === UNLIMITED;

/** Standing gun towers that would fire on this team: enemy bases' still in the game, and neutral ones. */
function enemyTowers(m: Match, team: number): number[] {
  const w = m.world;
  const out: number[] = [];
  for (const b of w.buildings) {
    const i = b.ty * GRID + b.tx;
    if (!TURRET_BUILDINGS.has(w.building[i]!) || !w.hp[i]) continue;
    const owner = w.owner[i]!;
    if (owner >= 0 && (m.eliminated[owner] || teamOf(m, owner) === team)) continue;
    out.push(i);
  }
  return out;
}

/** Enemy towers that cover a tile, nearest to `from` first. */
function guards(towers: readonly number[], tile: number, from: number): number[] {
  return towers.filter((t) => inTowerRange(t, tile)).sort((a, b) => tileDistance(a, from) - tileDistance(b, from) || a - b);
}

/**
 * The flag a jeep should fetch: the nearest free enemy flag, or, for a bot that defends, its own side's flag lying
 * in the open while a flag building is left to hide it in again.
 */
function fetchTarget(m: Match, p: Player, bot: BotState, skill: BotSkill, from: number): Flag | null {
  let best: Flag | null = null;
  let bestD = 0;
  for (const [i, f] of m.flags.entries()) {
    if (!f.revealed || f.carrier >= 0 || m.eliminated[f.base]) continue;
    if ((bot.seen[i] ?? -1) < 0 || m.tick - bot.seen[i]! < skill.notice) continue;
    const team = teamOf(m, f.base);
    if (team === null) continue;
    if (team === p.team) {
      if (!skill.defends) continue;
      const sites = m.world.bases[f.base]!.flagSites;
      if (!sites.some((s) => m.world.hp[s.ty * GRID + s.tx] && s.ty * GRID + s.tx !== tileOf(f.x, f.y))) continue;
    }
    const d = tileDistance(tileOf(f.x, f.y), from);
    if (!best || d < bestD) {
      best = f;
      bestD = d;
    }
  }
  return best;
}

/** Enemy fighting vehicles (not jeeps) within this many tiles of a tile, nearest it first. */
function vehicleGuards(m: Match, team: number, tile: number, range: number): Vehicle[] {
  const out: Vehicle[] = [];
  for (const q of m.players) {
    const e = q.vehicle;
    if (!e || q.team === team || q.state !== 'driving' || e.kind === 'jeep') continue;
    if (tileDistance(tileOf(e.x, e.y), tile) <= range) out.push(e);
  }
  return out.sort((a, b) => tileDistance(tileOf(a.x, a.y), tile) - tileDistance(tileOf(b.x, b.y), tile) || a.player - b.player);
}

/** Enemy vehicles carrying this team's flags. */
function flagThieves(m: Match, team: number): Vehicle[] {
  const out: Vehicle[] = [];
  for (const f of m.flags) {
    if (f.carrier < 0 || teamOf(m, f.base) !== team) continue;
    const q = m.players[f.carrier];
    if (q?.vehicle && q.team !== team) out.push(q.vehicle);
  }
  return out;
}

/**
 * While one of this team's flags lies in the open, the enemy jeeps out (that carry no flag) and the flag each
 * would make for: the nearest.
 */
function flagRaiders(m: Match, team: number): { jeep: Vehicle; flag: number }[] {
  const own = m.flags.filter((f) => f.revealed && f.carrier < 0 && !m.eliminated[f.base] && teamOf(m, f.base) === team);
  if (!own.length) return [];
  const out: { jeep: Vehicle; flag: number }[] = [];
  for (const q of m.players) {
    const e = q.vehicle;
    if (!e || q.team === team || q.state !== 'driving' || e.kind !== 'jeep' || m.flags.some((f) => f.carrier === q.id)) continue;
    const at = tileOf(e.x, e.y);
    const flag = own.map((f) => tileOf(f.x, f.y)).sort((a, b) => tileDistance(a, at) - tileDistance(b, at) || a - b)[0]!;
    out.push({ jeep: e, flag });
  }
  return out;
}

/**
 * The building to shell: one of the enemy's possible flag sites, the nearest first, teammates each taking a
 * different one of the nearest few; a careful bot shells the towers covering it first.
 */
function attackTarget(m: Match, p: Player, bot: BotState, skill: BotSkill, from: number, towers: readonly number[], choose = false): number | null {
  const enemy = (id: number) => {
    const team = teamOf(m, id);
    return !m.eliminated[id] && team !== null && team !== p.team;
  };
  // It picks a base to go for each time it sets out, and sticks to it for the sortie.
  if (choose || !enemy(bot.target)) bot.target = pickBase(m, p, enemy);
  const sites: { tile: number; base: number }[] = [];
  for (const b of m.world.bases) {
    if (!enemy(b.id)) continue;
    const standing = b.flagSites.map((s) => s.ty * GRID + s.tx).filter((i) => m.world.hp[i]);
    // With no flag building left its flag lies in the open; until a jeep takes it, make for its lift.
    for (const tile of standing.length ? standing : [b.start.ty * GRID + b.start.tx]) sites.push({ tile, base: b.id });
  }
  if (!sites.length) return null;
  const picked = (s: { base: number }) => (s.base === bot.target ? 0 : 1);
  sites.sort((a, b) => picked(a) - picked(b) || tileDistance(a.tile, from) - tileDistance(b.tile, from) || a.tile - b.tile);
  const mates = m.players.filter((q) => q.team === p.team && !m.eliminated[q.base]);
  const spread = Math.min(sites.length, mates.length, 3);
  const site = sites[Math.max(0, mates.indexOf(p)) % spread]!.tile;
  const covering = guards(towers, site, from);
  return covering.length > skill.towers ? covering[0]! : site;
}

/**
 * The enemy base to go for when no flag lies in the open. Each team draws its target afresh every SORTIE_EPOCH
 * ticks, from the match's own numbers, so no side is always the one attacked first; team mates count on round the
 * map from that draw, so two allies split up over two enemies. Fixed orders were tried first (the nearest base, the
 * next round the map, mutual neighbours): on a map with three or four bases each of them left one base with a
 * closer or a second attacker in every match, and that base nearly always went out first.
 */
function pickBase(m: Match, p: Player, enemy: (base: number) => boolean): number {
  const ring = ringOrder(m);
  const mates = m.players.filter((q) => q.team === p.team && !m.eliminated[q.base]).map((q) => q.base).sort((a, b) => a - b);
  // The draw: the same for every bot on the team this epoch, different from match to match (the flags' hiding places).
  let h = Math.imul(p.team + 1, 0x9e3779b9) ^ Math.imul(Math.floor(m.tick / SORTIE_EPOCH) + 1, 0x85ebca6b);
  m.flags.forEach((f, i) => (h = Math.imul(h ^ (f.site + i), 0xc2b2ae35)));
  h ^= h >>> 15;
  // Counted from the team's first base, so team mates share one order and take different bases from it.
  const first = ring.indexOf(mates[0] ?? p.base);
  const order = ring.map((_, k) => ring[(first + 1 + k) % ring.length]!).filter((b) => enemy(b));
  if (!order.length) return -1;
  return order[((h >>> 0) + Math.max(0, mates.indexOf(p.base))) % order.length]!;
}

/** How long a team keeps the base it drew, in ticks (a minute). */
const SORTIE_EPOCH = 1800;

/** The map's bases in order round their middle, by the heading from it to each base's lift (integers only). */
function ringOrder(m: Match): number[] {
  const bases = m.world.bases;
  const n = bases.length;
  const sx = bases.reduce((a, b) => a + b.start.tx, 0);
  const sy = bases.reduce((a, b) => a + b.start.ty, 0);
  const angle = (id: number) => headingTo(bases[id]!.start.tx * n - sx, bases[id]!.start.ty * n - sy);
  return bases.map((b) => b.id).sort((a, b) => angle(a) - angle(b) || a - b);
}

/** Bots keep out of buildings that would stop their vehicle, except their own base's gates; only jeeps float. */
function blocks(m: Match, tx: number, ty: number, v: Vehicle): boolean {
  if (tx < 0 || ty < 0 || tx >= GRID || ty >= GRID) return true;
  if (v.kind !== 'jeep' && hasDeepWater(m.world, tx, ty)) return true;
  const i = ty * GRID + tx;
  const b = m.world.building[i]!;
  if (!b) return false;
  if ((b === GATE_H || b === GATE_V) && m.world.owner[i] === v.base) return false;
  return stopsVehicle(m.world.defs[b]!, v.kind === 'jeep');
}

/** Extra route cost per tile: deep water for a jeep, enemy tower range and the bot's own side's armed mines. */
function routeCosts(m: Match, v: Vehicle, careful: boolean): Int32Array {
  const cost = new Int32Array(GRID * GRID);
  const tower = v.kind === 'jeep' && careful ? TOWER_COST_JEEP : TOWER_COST;
  for (const t of enemyTowers(m, v.team)) {
    const tx = t % GRID;
    const ty = Math.floor(t / GRID);
    for (let y = Math.max(0, ty - TOWER_TILES); y <= Math.min(GRID - 1, ty + TOWER_TILES); y++) {
      for (let x = Math.max(0, tx - TOWER_TILES); x <= Math.min(GRID - 1, tx + TOWER_TILES); x++) {
        if (inTowerRange(t, y * GRID + x)) cost[y * GRID + x] = cost[y * GRID + x]! + tower;
      }
    }
  }
  for (const mine of m.mines) if (mine.team === v.team && mineArmed(mine)) { const i = tileOf(mine.x, mine.y); cost[i] = cost[i]! + MINE_COST; }
  if (v.kind === 'jeep') {
    for (let i = 0; i < GRID * GRID; i++) if (hasDeepWater(m.world, i % GRID, (i - (i % GRID)) / GRID)) cost[i] = cost[i]! + WATER_COST;
  }
  return cost;
}

/** Route costs to the goal over tiles the vehicle can cross (Dijkstra on a binary heap). The goal may be solid. */
function distanceField(m: Match, goal: number, v: Vehicle, careful: boolean): Int32Array {
  const d = new Int32Array(GRID * GRID).fill(UNREACHABLE);
  const extra = routeCosts(m, v, careful);
  const heap = new Int32Array(GRID * GRID * 4);
  const keys = new Int32Array(GRID * GRID * 4);
  let size = 0;
  const push = (i: number, k: number) => {
    let c = size++;
    while (c > 0) {
      const parent = (c - 1) >> 1;
      if (keys[parent]! < k || (keys[parent] === k && heap[parent]! < i)) break;
      heap[c] = heap[parent]!;
      keys[c] = keys[parent]!;
      c = parent;
    }
    heap[c] = i;
    keys[c] = k;
  };
  const pop = (): number => {
    const top = heap[0]!;
    const i = heap[--size]!;
    const k = keys[size]!;
    let c = 0;
    for (;;) {
      let child = 2 * c + 1;
      if (child >= size) break;
      const r = child + 1;
      if (r < size && (keys[r]! < keys[child]! || (keys[r] === keys[child] && heap[r]! < heap[child]!))) child = r;
      if (keys[child]! > k || (keys[child] === k && heap[child]! > i)) break;
      heap[c] = heap[child]!;
      keys[c] = keys[child]!;
      c = child;
    }
    heap[c] = i;
    keys[c] = k;
    return top;
  };
  d[goal] = 0;
  push(goal, 0);
  while (size > 0) {
    const k = keys[0]!;
    const i = pop();
    if (k > d[i]!) continue;
    const x = i % GRID;
    const y = (i - x) / GRID;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= GRID || ny >= GRID || blocks(m, nx, ny, v)) continue;
      const n = ny * GRID + nx;
      const nd = k + STEP_COST + extra[n]!;
      if (nd >= d[n]! || size >= heap.length) continue;
      d[n] = nd;
      push(n, nd);
    }
  }
  return d;
}

function steer(v: Vehicle, aim: number, drive: boolean): VehicleInput {
  const diff = (aim - v.heading) & ANGLE_MASK;
  const half = (ANGLE_MASK + 1) >> 1;
  const off = diff < half ? diff : ANGLE_MASK + 1 - diff;
  const rate = VEHICLES[v.kind].turnRate;
  const turn = off <= rate >> 1 ? 0 : diff < half ? 1 : -1;
  return { throttle: drive && off <= DRIVE_SLACK ? 1 : 0, turn };
}

/** How far a heading is off another, in 16.16 steps. */
function headingOff(a: number, b: number): number {
  return Math.min((a - b) & ANGLE_MASK, (b - a) & ANGLE_MASK);
}

/** How far a vehicle's main gun carries, less a little: firing from further only wastes the shots. */
function reach(v: Vehicle): number {
  if (v.kind === 'heli') return HELI_REACH + HELI_REACH_SLACK;
  const w = VEHICLES[v.kind].weapons[0]!;
  if (typeof w.projectile !== 'number') return GRENADE_RANGE;
  const p = PROJECTILES[w.projectile]!;
  return p.speed * p.life - (16 << FIXED_SHIFT);
}

/** How fast its shot flies, in world units a tick. */
function shotSpeed(v: Vehicle): number {
  const w = VEHICLES[v.kind].weapons[v.kind === 'heli' ? v.weapon : 0]!;
  return typeof w.projectile === 'number' ? PROJECTILES[w.projectile]!.speed : GRENADE_RANGE >> 5;
}

/** Whether a vehicle's guns can reach an enemy: only the tank, the ASV and a helicopter can hit one in the air. */
function canHit(v: Vehicle, e: Vehicle): boolean {
  if (v.kind === 'jeep') return false;
  return !airborne(e) || v.kind !== 'heli' || airborne(v);
}

/** The bot's controls for this tick. Call once per tick before stepMatch. */
export function botThink(m: Match, playerId: number, bot: BotState): BotMove {
  const p = m.players[playerId];
  if (!p || m.winner !== null || m.eliminated[p.base]) return {};
  // Behind a start gate only a bot playing for one of the humans it waits for (one who left) picks, and at once.
  if (m.gate) {
    if (!m.gate.waiting.includes(playerId)) return {};
  } else if (botWaiting(m, bot)) return {};
  const skill = botSkill(bot.difficulty ?? m.difficulty);
  if (!bot.luck) bot.luck = (m.rng.peek() ^ Math.imul(playerId + 1, 0x9e3779b9)) | 0 || 1;
  // m.events still holds the last tick's: a vehicle lost anywhere means the fight is getting somewhere.
  if (m.events.some((e) => e.type === 'destroyed')) bot.repairs = 0;
  const home = m.world.bases[p.base]!.start;
  const homeTile = home.ty * GRID + home.tx;
  const towers = enemyTowers(m, p.team);
  m.flags.forEach((f, i) => {
    const free = f.revealed && f.carrier < 0;
    if (!free) bot.seen[i] = -1;
    else if ((bot.seen[i] ?? -1) < 0) bot.seen[i] = m.tick;
  });
  const attackersLeft = ATTACKERS.some((k) => has(p, k));

  if (p.state !== 'bunker') bot.launchAt = -1;
  else {
    if (bot.launchAt < 0) bot.launchAt = m.tick + roll(bot, 20 + skill.reaction * 2);
    if (m.tick < bot.launchAt) return {};
  }
  if (p.state === 'bunker') {
    const flag = fetchTarget(m, p, bot, skill, homeTile);
    if (flag && has(p, 'jeep')) {
      const at = tileOf(flag.x, flag.y);
      const clear = !attackersLeft || (guards(towers, at, homeTile).length <= skill.towers && !(skill.careful && vehicleGuards(m, p.team, at, FLAG_WATCH).length));
      if (clear) return { launch: 'jeep' };
    }
    // Something that can get there: over land if a tank can, else by air.
    const target = flagThieves(m, p.team)[0] ?? null;
    const goal = target ? tileOf(target.x, target.y) : attackTarget(m, p, bot, skill, homeTile, towers, true);
    // A helicopter is the one fast enough to catch a jeep with the flag.
    let order = target ? BY_AIR : ATTACKERS;
    if (goal !== null && !target) {
      const probe = { kind: 'tank', base: p.base, team: p.team } as Vehicle;
      if (distanceField(m, goal, probe, false)[homeTile] === UNREACHABLE) order = BY_AIR;
    }
    const kind = order.find((k) => has(p, k)) ?? (has(p, 'jeep') ? 'jeep' : undefined);
    return kind ? { launch: kind } : {};
  }
  const v = p.vehicle;
  if (!v || p.state !== 'driving') return {};
  const def = VEHICLES[v.kind];
  const here = tileOf(v.x, v.y);
  const carrying = m.flags.find((f) => f.carrier === playerId);

  // Where to go. Home with a flag, low on fuel or badly hit, or to swap for the vehicle the job needs.
  let goal = homeTile;
  let attack = false;
  /** An enemy vehicle being hunted: the goal follows it, and it is shot first. */
  let prey: Vehicle | null = null;
  /** Waiting by its side's flag for an enemy jeep. */
  let guard = false;
  const lowFuel = v.fuel < def.fuel >> 2;
  const hurt = bot.repairs < REPAIR_PATIENCE && v.health * 16 < def.health * skill.retreat;
  if (!carrying && !lowFuel && !hurt) {
    const flag = v.kind === 'jeep' || has(p, 'jeep') ? fetchTarget(m, p, bot, skill, here) : null;
    const flagTile = flag ? tileOf(flag.x, flag.y) : -1;
    const covering = flag ? guards(towers, flagTile, here) : [];
    const guarded = covering.length > skill.towers ? covering : [];
    const watchers = flag && skill.careful && v.kind !== 'jeep' ? vehicleGuards(m, p.team, flagTile, FLAG_CLEAR) : [];
    if (v.kind === 'jeep') {
      if (flag && (!guarded.length || !attackersLeft || tileDistance(flagTile, here) <= 2)) goal = flagTile;
      else if (!attackersLeft) {
        const t = attackTarget(m, p, bot, skill, here, towers);
        if (t !== null) {
          goal = t;
          attack = true;
        }
      }
    } else {
      const near = (a: Vehicle, b: Vehicle) => tileDistance(tileOf(a.x, a.y), here) - tileDistance(tileOf(b.x, b.y), here) || a.player - b.player;
      const thieves = skill.defends ? flagThieves(m, p.team).sort(near) : [];
      const raiders = skill.defends ? flagRaiders(m, p.team).sort((a, b) => near(a.jeep, b.jeep)) : [];
      if (thieves.length) {
        prey = thieves[0]!;
        goal = tileOf(prey.x, prey.y);
        // A jeep outruns everything but the helicopter, so ground vehicles cut it off at its own lift when they
        // can get there first.
        const lift = m.world.bases[prey.base]!.start;
        const liftTile = lift.ty * GRID + lift.tx;
        if (!def.flies && tileDistance(liftTile, here) <= tileDistance(liftTile, goal)) goal = liftTile;
      } else if (raiders.length) {
        // An enemy jeep is out while its flag lies in the open: wait by the flag for it.
        prey = raiders[0]!.jeep;
        goal = raiders[0]!.flag;
        guard = true;
      } else if (watchers.length) {
        // An enemy sits by the flag: drive it off before sending a jeep.
        prey = watchers[0]!;
        goal = tileOf(prey.x, prey.y);
      } else if (flag && guarded.length) {
        goal = guarded[0]!;
        attack = true;
      } else if (!flag) {
        const t = attackTarget(m, p, bot, skill, here, towers);
        if (t !== null) {
          goal = t;
          attack = true;
        }
      }
      // Else a flag lies free and unguarded: home, to send a jeep.
    }
  }
  // A jeep home with its own side's flag docks to hide it again; an enemy flag is captured on arrival.
  const carryingEnemy = !!carrying && teamOf(m, carrying.base) !== p.team;
  // An enemy flag counts at any base of the jeep's team that is still in the match, so it goes to the one it can
  // reach soonest (its own on a tie). The choice is kept while that base stands, so the jeep does not dither.
  if (carryingEnemy) {
    const stands = (tile: number) => m.world.bases.some((b) => b.start.ty * GRID + b.start.tx === tile && !m.eliminated[b.id] && teamOf(m, b.id) === p.team);
    if (bot.flagHome === undefined || !stands(bot.flagHome)) {
      bot.flagHome = homeTile;
      let best = distanceField(m, homeTile, v, skill.careful)[here]!;
      for (const b of m.world.bases) {
        const tile = b.start.ty * GRID + b.start.tx;
        if (b.id === p.base || !stands(tile)) continue;
        const d = distanceField(m, tile, v, skill.careful)[here]!;
        if (d < best) {
          best = d;
          bot.flagHome = tile;
        }
      }
    }
    goal = bot.flagHome;
  } else bot.flagHome = undefined;
  if (goal === homeTile && here === homeTile && !carryingEnemy) {
    if (hurt && !carrying && !lowFuel) bot.repairs++;
    return { dock: true };
  }

  // Shoot the nearest enemy in reach (the hunted one first), once it has had time to react.
  let aim: number | null = null;
  let up = false;
  let at: { x: number; y: number } = { x: 0, y: 0 };
  let target: Vehicle | null = null;
  let targetD = 0;
  let grenade = false;
  for (const q of m.players) {
    const e = q.vehicle;
    if (!e || q.state !== 'driving' || e.team === v.team) continue;
    const d = Math.max(Math.abs(e.x - v.x), Math.abs(e.y - v.y));
    if (v.kind === 'jeep') {
      if (!airborne(e) && d < GRENADE_RANGE) grenade = true;
      continue;
    }
    if (!canHit(v, e) || d > Math.min(skill.engageRange, reach(v))) continue;
    const better = !target || ((e === prey) === (target === prey) ? d < targetD : e === prey);
    if (better) {
      target = e;
      targetD = d;
    }
  }
  if (target) {
    if (bot.enemy !== target.player) {
      bot.enemy = target.player;
      // It takes a moment longer some times than others to pick a new enemy out.
      bot.seenAt = m.tick + roll(bot, 4 + (skill.reaction >> 2));
      bot.enemyX = target.x;
      bot.enemyY = target.y;
    }
    // Lead it: where it will be when the shot gets there, at the speed it moved last tick.
    const flight = Math.min(60, Math.trunc(distance(target.x - v.x, target.y - v.y) / shotSpeed(v)));
    const ahead = (flight * skill.lead) >> 2;
    const aimX = target.x + (target.x - bot.enemyX) * ahead;
    const aimY = target.y + (target.y - bot.enemyY) * ahead;
    bot.enemyX = target.x;
    bot.enemyY = target.y;
    if (m.tick - bot.seenAt >= skill.reaction) {
      // A deterministic wobble that changes every 32 ticks.
      const span = 2 * skill.aimError + 1;
      const wobble = (((m.tick >> 5) + playerId * 7) % span) - skill.aimError;
      aim = (headingTo(aimX - v.x, aimY - v.y) + wobble * STEP + AIM_CENTRE) & ANGLE_MASK;
      up = airborne(target);
      at = target;
    }
  } else bot.enemy = -1;
  let building = false;
  if (aim === null && attack && tileDistance(goal, here) <= SHELL_RANGE) {
    at = centre(goal);
    aim = (headingTo(at.x - v.x, at.y - v.y) + AIM_CENTRE) & ANGLE_MASK;
    building = true;
  }
  // Heading home it keeps going: only the tank, its turret free of the hull, shoots on the way.
  const leaving = !!carrying || lowFuel || hurt;
  let gunner: VehicleInput | null = null;
  if (aim !== null && v.kind === 'tank') {
    // The tank swings its turret onto the target and, unless heading home, keeps the hull still.
    const gun = (v.heading + v.turret) & ANGLE_MASK;
    const diff = (aim - gun) & ANGLE_MASK;
    const off = Math.min(diff, ANGLE_MASK + 1 - diff);
    const swing = off > TURRET_SWING >> 1;
    const right = diff < (ANGLE_MASK + 1) >> 1;
    const shoot = off <= AIM_SLACK;
    gunner = { throttle: 0, turn: 0, fire: shoot && !up, fire2: shoot && up, turretLeft: swing && !right, turretRight: swing && right };
    if (!leaving) return { input: gunner };
  } else if (aim !== null && !leaving) {
    const lined = headingOff(aim, v.heading) <= AIM_SLACK;
    const input = steer(v, aim, false);
    if (v.kind === 'heli') {
      if (up) return { input: { ...input, fire2: lined } };
      // Missiles on armour and buildings, the gun on the rest; the third button swaps them.
      const want = (building || (target && target.kind !== 'jeep')) && v.ammo[1]! > 0 ? 1 : 0;
      const gap = distance(at.x - v.x, at.y - v.y) - HELI_REACH;
      if (gap < 0) input.throttle = -1;
      const swap = v.weapon !== want && !v.fire3Held;
      return { input: { ...input, fire: lined && Math.abs(gap) <= HELI_REACH_SLACK && v.weapon === want, fire3: swap } };
    }
    // The ASV fires raised at helicopters.
    return { input: { ...input, fire: lined && !up, fire2: lined && up } };
  }

  // On guard, it holds its ground once close to the flag.
  if (guard && tileDistance(goal, here) <= 2) return { input: { throttle: 0, turn: 0 } };

  // Get unstuck: back up while turning.
  if (m.tick < bot.reverseUntil) return { input: { throttle: -1, turn: 1 } };

  let next = centre(goal);
  if (!def.flies) {
    if (bot.goal !== goal || bot.fieldKind !== v.kind || !bot.field || m.tick - bot.fieldAt >= FIELD_REFRESH) {
      bot.goal = goal;
      bot.fieldKind = v.kind;
      bot.field = distanceField(m, goal, v, skill.careful);
      bot.fieldAt = m.tick;
    }
    const field = bot.field;
    const tx = here % GRID;
    const ty = (here - tx) / GRID;
    let best = field[here]!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
      const nx = tx + dx;
      const ny = ty + dy;
      if (nx < 0 || ny < 0 || nx >= GRID || ny >= GRID) continue;
      const n = ny * GRID + nx;
      // Diagonal steps only where both side tiles are open, so the bot does not clip a corner.
      if (dx && dy && (blocks(m, tx + dx, ty, v) || blocks(m, tx, ty + dy, v))) continue;
      if (field[n]! < best) {
        best = field[n]!;
        next = centre(n);
      }
    }
  }
  const input = steer(v, (headingTo(next.x - v.x, next.y - v.y) + AIM_CENTRE) & ANGLE_MASK, true);
  if (gunner) Object.assign(input, { fire: gunner.fire, fire2: gunner.fire2, turretLeft: gunner.turretLeft, turretRight: gunner.turretRight });
  if (v.kind === 'jeep') {
    // Tyres out to float over deep water, and in again once it is past.
    const ground = groundAt(m.world, v.x, v.y);
    const wet = ground === DEEP || (ground !== LAND && hasDeepWater(m.world, next.x >> TILE_SHIFT, next.y >> TILE_SHIFT));
    if (wet !== v.tyres && !v.fire2Held) input.fire2 = true;
    if (grenade) input.fire = true;
  } else if (v.kind === 'asv' && skill.mines && v.ammo[1]! > 0 && !v.fire3Held && layMineHere(m, v, here, homeTile)) {
    input.fire3 = true;
  }
  // Wedged: pushing on without moving, or turning on the spot against something that undoes the turn.
  const pose = (v.x >> 16) * 31 + (v.y >> 16) * 17 + (v.heading >> 16);
  const wedged = (input.throttle > 0 && Math.abs(v.speed) < def.accel) || (input.turn !== 0 && pose === bot.last);
  bot.last = pose;
  if (wedged) {
    if (++bot.stuck >= STUCK_TICKS) {
      bot.stuck = 0;
      bot.reverseUntil = m.tick + REVERSE_TICKS;
    }
  } else {
    bot.stuck = 0;
  }
  return { input };
}

/**
 * Where an ASV lays a mine: two to four tiles from an enemy base's lift, where its vehicles come out, or with an
 * enemy ground vehicle close behind. Never near its own lift, where its own side would drive over it.
 */
function layMineHere(m: Match, v: Vehicle, here: number, homeTile: number): boolean {
  if (tileDistance(here, homeTile) <= 4 || m.mines.some((x) => tileOf(x.x, x.y) === here)) return false;
  for (const b of m.world.bases) {
    if (m.eliminated[b.id] || teamOf(m, b.id) === v.team) continue;
    const d = tileDistance(here, b.start.ty * GRID + b.start.tx);
    if (d >= 2 && d <= 4) return true;
  }
  for (const q of m.players) {
    const e = q.vehicle;
    if (!e || q.state !== 'driving' || e.team === v.team || airborne(e)) continue;
    if (Math.max(Math.abs(e.x - v.x), Math.abs(e.y - v.y)) > 3 << TILE_SHIFT) continue;
    if (headingOff(headingTo(e.x - v.x, e.y - v.y), v.heading) > 16 * STEP) return true;
  }
  return false;
}
