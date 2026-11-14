// The bunker lift, both ends of it: the elevator in the bunker screen and the lift on the map (the "Storage"
// objects, classes 0x44db40 for a launch and 0x44db90 for a dock).
//
// Launching (sub_417ad0, the bunker screen, when fire is pressed with the screen fully lit):
// - The bunker runs the chosen bay's elevator script (sub_418040; one per vehicle, table 0x4491c0 + 0x20): the lift
//   comes up to the bay's row, the vehicle slides across onto it, and the two rise together while the screen fades
//   out (sub_417990). Positions are the lift's height in the shaft (+0xd0) and the vehicle's offset from its bay
//   (+0xd4, +0xd8), 16.16 pixels.
// - Meanwhile a lift object waits under the base's lift tile, 32 px down (sub_40b510). Once the fade ends
//   (sub_417990 clears its +0x70) it opens the tile (terrain 0x5c, the hazard frame round an open hole) and rises
//   0x4ccc (0.3 px) a tick with the vehicle on it (sub_42ef20), while the map fades in (sub_4183e0). Its hatch
//   doors slide apart 0.3 px a tick as it rises (sub_42ea10). A tick after it reaches the top the tile is closed
//   again and the vehicle is made on it (sub_42ec50, sub_40b1c0), facing heading 32, or 24 for the helicopter.
//
// Docking (sub_42f110): the vehicle comes off the map at once and its life is returned, and a lift object with the
// vehicle on it, where it stood and as it faced, opens the tile and sinks 0.3 px a tick (sub_42efc0) while the
// doors close over it (their timer starts at 70 and counts down). Once it is 16 px down the player's screen fades
// out (sub_418390) to the bunker, which fades in (sub_418290, sub_417ad0). The lift goes on down to 32 px, and is
// gone, the tile closed again, when the doors have shut too (sub_42f0a0).
//
// Every lift object clears mines lying within 20 px of its middle each tick (sub_42ec50).

import { ONE, TILE_SIZE } from './fixed.js';
import { GRID } from './map.js';
import type { Match, Player } from './match.js';
import { makeVehicle, type Vehicle, type VehicleKind } from './vehicle.js';

/** How far the lift moves a tick, and how deep it goes (32 px). */
export const LIFT_SPEED = 0x4ccc;
export const LIFT_DEPTH = 0x200000;
/** A docking player's screen starts to fade once the lift is this far down (16 px). */
const FADE_DEPTH = 0x100000;
/** Screen fades (+0xbc of the view), a tick: about 14 ticks from dark to lit. */
export const FADE_STEP = 0x11eb;
/** The doors' timer on a docking lift (+0x68): they are drawn closing over the last 60 of these. */
export const DOCK_DOORS = 70;
/** The doors are out of sight once they have slid this far apart (18 px). */
export const DOORS_OPEN = 0x120000;
/** The open lift's tile: the hazard frame round a hole. */
export const LIFT_HOLE = 0x5c;
/** Mines within this many pixels of a lift's middle are cleared (squared, sub_42cda0). */
const CLEAR_REACH2 = 400;
/** Facing as the vehicle comes up (sub_40b510). */
const LAUNCH_HEADING = 32 << 16;
const HELI_LAUNCH_HEADING = 24 << 16;

/** The elevator in the bunker screen while a vehicle goes up. */
export interface Elevator {
  kind: VehicleKind;
  /** The script step it is on. */
  op: number;
  /** The lift's height in the shaft (+0xd0; it starts at 110 px, level with the lower bays, and goes up as it falls). */
  lift: number;
  /** The vehicle's offset from its bay (+0xd4, +0xd8). */
  dx: number;
  dy: number;
}

/** A bunker lift on the map with a vehicle on it. */
export interface Lift {
  player: number;
  tile: number;
  /** waiting for the bunker, rising, at the top (out next tick), or sinking with a docked vehicle. */
  phase: 'wait' | 'rise' | 'up' | 'sink';
  /** The platform's height (+0x48): -32 px to 0. */
  z: number;
  /** The doors' timer (+0x68): they are drawn slid apart by 0.3 px a tick of it. */
  doors: number;
  /** The tile's terrain before the hole opened. */
  pad: number;
  /** The vehicle on it, at its place on the map (its own z stays 0; it is drawn at the platform's). */
  vehicle: Vehicle;
}

// Elevator steps, from the scripts at 0x449108 (tank), 0x448fc0 (jeep), 0x448f30 (ASV) and 0x449050 (helicopter).
// Each is [step, argument, rate, target, chain]: chain runs the next step in the same tick once this one is done.
// The scripts' sound steps (sub_417810) and console step (sub_417900) take no time and are left out.
const RAISE = 0; // sub_417a90: the lift comes up at rate to target.
const SLIDE = 1; // sub_417a40: the vehicle slides across by rate until the next step would pass target.
const RISE = 2; // sub_4179f0: the lift and vehicle go up together by rate to target.
const FADE = 3; // sub_417990: they go on up by rate while the screen fades by target a tick.
type Step = readonly [op: number, rate: number, target: number, chain: boolean];
const HALF = 0x8000;
const SCRIPTS: Record<VehicleKind, readonly Step[]> = {
  tank: [[RAISE, HALF, 72 * ONE, true], [SLIDE, -HALF, -35 * ONE, false], [RISE, HALF, 60 * ONE, true], [FADE, HALF, FADE_STEP, true]],
  jeep: [[SLIDE, -HALF, -35 * ONE, true], [RISE, HALF, 80 * ONE, false], [FADE, HALF, FADE_STEP, false]],
  asv: [[SLIDE, HALF, 36 * ONE, true], [RISE, HALF, 80 * ONE, false], [FADE, HALF, FADE_STEP, false]],
  heli: [[RAISE, HALF, 72 * ONE, true], [SLIDE, HALF, 36 * ONE, false], [RISE, HALF, 60 * ONE, true], [FADE, HALF, FADE_STEP, true]],
};
/** The lift's resting height in the shaft. */
export const ELEVATOR_REST = 110 * ONE;

function tileCentre(tile: number): [number, number] {
  return [(tile % GRID) * TILE_SIZE + TILE_SIZE / 2, Math.floor(tile / GRID) * TILE_SIZE + TILE_SIZE / 2];
}

function liftTile(m: Match, p: Player): number {
  const s = m.world.bases[p.base]!.start;
  return s.ty * GRID + s.tx;
}

/** A player's lift on the map: the one bringing a vehicle up, or the one taking it down. */
export function liftOf(m: Match, player: number): Lift | undefined {
  return m.lifts.find((l) => l.player === player);
}

/** Opens the tile for a lift, remembering what it was (or what another lift there remembered). */
function openTile(m: Match, l: Lift): void {
  const t = m.world.terrain;
  const other = m.lifts.find((o) => o !== l && o.tile === l.tile && o.phase !== 'wait');
  l.pad = other ? other.pad : t[l.tile]!;
  t[l.tile] = (t[l.tile]! & ~127) | LIFT_HOLE;
}

function closeTile(m: Match, l: Lift): void {
  if (m.lifts.some((o) => o !== l && o.tile === l.tile && o.phase !== 'wait')) return;
  m.world.terrain[l.tile] = l.pad;
}

/** Starts a launch: the elevator in the bunker, and the lift waiting under the map with the vehicle made ready. */
export function startLaunch(m: Match, p: Player, kind: VehicleKind): Vehicle {
  const tile = liftTile(m, p);
  const [x, y] = tileCentre(tile);
  const v = makeVehicle(kind, p.id, p.team, p.base, x, y);
  v.heading = kind === 'heli' ? HELI_LAUNCH_HEADING : LAUNCH_HEADING;
  p.elevator = { kind, op: 0, lift: ELEVATOR_REST, dx: 0, dy: 0 };
  m.lifts.push({ player: p.id, tile, phase: 'wait', z: -LIFT_DEPTH, doors: 0, pad: m.world.terrain[tile]!, vehicle: v });
  return v;
}

/** Starts a dock: the vehicle goes down on the lift where it stands. */
export function startDock(m: Match, p: Player, v: Vehicle): void {
  const l: Lift = { player: p.id, tile: liftTile(m, p), phase: 'sink', z: 0, doors: DOCK_DOORS, pad: 0, vehicle: v };
  openTile(m, l);
  m.lifts.push(l);
}

/** One tick of the bunker elevator (sub_418040). Returns true once the script has run out. */
export function stepElevator(p: Player): boolean {
  const e = p.elevator;
  if (!e) return true;
  const script = SCRIPTS[e.kind];
  for (;;) {
    const s = script[e.op];
    if (!s) return true;
    const [op, rate, target, chain] = s;
    let done = false;
    switch (op) {
      case RAISE:
        e.lift -= rate;
        if (e.lift <= target) {
          e.lift = target;
          done = true;
        }
        break;
      case SLIDE: {
        const next = e.dx + rate;
        if (rate >= 0 ? next > target : next < target) done = true;
        else e.dx = next;
        break;
      }
      case RISE: {
        let step = rate;
        if (e.lift - step <= target) {
          step = e.lift - target;
          done = true;
        }
        e.lift -= step;
        e.dy -= step;
        break;
      }
      case FADE:
        e.lift -= rate;
        e.dy -= rate;
        p.fade -= target;
        if (p.fade <= 0) {
          p.fade = 0;
          done = true;
        }
        break;
    }
    if (!done) return false;
    e.op++;
    if (!chain) return false;
  }
}

/** How many ticks a vehicle's elevator script takes. */
export function elevatorTicks(kind: VehicleKind): number {
  const p = { elevator: { kind, op: 0, lift: ELEVATOR_REST, dx: 0, dy: 0 }, fade: ONE } as Player;
  let n = 1;
  while (!stepElevator(p)) n++;
  return n;
}

/**
 * One tick of every lift on the map (sub_42ec50 and each lift's state). A launch that reaches the top puts its
 * vehicle in play; returns nothing, the player's state says what happened.
 */
export function stepLifts(m: Match): void {
  for (const l of [...m.lifts]) {
    const [cx, cy] = tileCentre(l.tile);
    m.mines = m.mines.filter((mine) => {
      const dx = (mine.x - cx) >> 16;
      const dy = (mine.y - cy) >> 16;
      return dx * dx + dy * dy >= CLEAR_REACH2;
    });
    const p = m.players[l.player]!;
    switch (l.phase) {
      case 'wait':
        // The bunker's fade has ended; a docking lift still going down here goes first.
        if (p.elevator || m.lifts.some((o) => o !== l && o.tile === l.tile && o.phase === 'sink')) break;
        openTile(m, l);
        l.phase = 'rise';
        l.z = -LIFT_DEPTH;
        break;
      case 'rise':
        l.doors++;
        if (l.z >= 0) {
          l.phase = 'up';
          break;
        }
        l.z = Math.min(0, l.z + LIFT_SPEED);
        break;
      case 'up':
        closeTile(m, l);
        m.lifts.splice(m.lifts.indexOf(l), 1);
        if (p.state !== 'launching') break;
        p.vehicle = l.vehicle;
        p.state = 'driving';
        break;
      case 'sink':
        l.z -= LIFT_SPEED;
        l.doors = Math.max(0, l.doors - 1);
        if (l.z <= -LIFT_DEPTH && l.doors <= 0) {
          l.z = -LIFT_DEPTH;
          closeTile(m, l);
          m.lifts.splice(m.lifts.indexOf(l), 1);
        }
        break;
    }
  }
}

/** The player's screen: the bunker fading in, the elevator, the map fading in or out round the lift. */
export function stepScreen(m: Match, p: Player): void {
  switch (p.state) {
    case 'bunker':
    case 'driving':
      p.fade = Math.min(ONE, p.fade + FADE_STEP);
      break;
    case 'launching':
      if (p.elevator) {
        if (stepElevator(p)) p.elevator = null;
      } else p.fade = Math.min(ONE, p.fade + FADE_STEP);
      break;
    case 'docking': {
      // The lift has moved this tick already; the original looks at where it was (sub_42efc0).
      const l = liftOf(m, p.id);
      if (p.fade < ONE || !l || l.z + LIFT_SPEED < -FADE_DEPTH) p.fade -= FADE_STEP;
      if (p.fade <= 0) {
        p.fade = 0;
        p.state = 'bunker';
      }
      break;
    }
    default:
      break;
  }
}

/** Calls off a launch whose base has been eliminated: the elevator stops and the lift goes away. */
export function cancelLaunch(m: Match, p: Player): void {
  p.elevator = null;
  const l = liftOf(m, p.id);
  if (!l || l.phase === 'sink') return;
  if (l.phase !== 'wait') closeTile(m, l);
  m.lifts.splice(m.lifts.indexOf(l), 1);
}

/**
 * Finishes a player's launch or dock at once, as if the lift had run its course: for tests and tools that want a
 * vehicle out (or back in the bunker) without waiting.
 */
export function skipLift(m: Match, playerId: number): void {
  const p = m.players[playerId];
  if (!p) return;
  const l = liftOf(m, playerId);
  if (l) {
    if (l.phase !== 'wait') closeTile(m, l);
    m.lifts.splice(m.lifts.indexOf(l), 1);
  }
  p.elevator = null;
  p.fade = ONE;
  if (p.state === 'launching' && l) {
    p.vehicle = l.vehicle;
    p.state = 'driving';
  } else if (p.state === 'docking') p.state = 'bunker';
}
