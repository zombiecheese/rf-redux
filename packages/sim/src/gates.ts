// Base gates (the Gate class, VA 0x44e370). A gate is a building until a vehicle of its own base drives into
// its trigger zone (sub_40c540, pad kind 3). Then sub_432550 takes the building off its tile and puts a Gate
// object there instead, whose two halves slide apart (sub_4322f0). Once the vehicle that opened it has left the
// zone, it slides shut, and a second after closing it turns back into the building (sub_432460).

import { touch, type Body, type Shape } from './collide.js';
import { approach } from './fixed.js';
import { buildingBody, type World } from './map.js';
import { VEHICLES, type Obstacle, type Vehicle } from './vehicle.js';

export const GATE_H = 43;
export const GATE_V = 44;
/** How far each half slides, 15 px (the Gate's target at +0x70). */
export const GATE_OPEN = 0xf0000;
/** Sliding speed, half a pixel a tick. */
export const GATE_SPEED = 0x8000;
/** Ticks a closed gate waits before it becomes a building again. */
export const GATE_SETTLE = 60;

export interface Gate {
  tile: number;
  /** The building it came from (GATE_H or GATE_V), put back when it settles. */
  building: number;
  /** How far each half has slid, 16.16 pixels (+0x64). */
  opening: number;
  /** Where it is sliding to: GATE_OPEN or 0 (+0x70). */
  target: number;
  /** Ticks since it closed (+0x68). */
  closed: number;
  /** Player whose vehicle opened it. */
  opener: number;
  /** That vehicle: once it is gone or out of the zone, the gate shuts. */
  vehicle: Vehicle | null;
}

const PX = 0x10000;
const HALF = 0x100000;

/** The two halves (the Gate model's shapes at +0x88 and +0xC4), slid apart by opening. */
export function gateShapes(g: Gate): Shape[] {
  const flags = [0, 0, 1, 255];
  const z = [0, HALF];
  const o = HALF + g.opening;
  if (g.building === GATE_H) {
    return [
      { type: 2, flags, z, offset: [-o, 0], bounds: [-PX, -PX, HALF, PX] },
      { type: 2, flags, z, offset: [o, 0], bounds: [-HALF, -PX, PX, PX] },
    ];
  }
  return [
    { type: 2, flags, z, offset: [0, -o], bounds: [-PX, -PX, PX, HALF] },
    { type: 2, flags, z, offset: [0, o], bounds: [-PX, -HALF, PX, PX] },
  ];
}

/** The trigger zone (DAT_0044cdb0): 64 x 64 px round the gate's tile. */
const ZONE: Shape[] = [{ type: 2, flags: [2, 3, 32, 34], z: [0, 0x180000], offset: [0, 0], bounds: [-0x200000, -0x200000, 0x200000, 0x200000] }];

export function gateObstacles(world: World, gates: readonly Gate[]): Obstacle[] {
  return gates.map((g) => ({ body: buildingBody(world, g.tile), shapes: gateShapes(g), tile: g.tile }));
}

/**
 * Opens the gate on a tile (sub_432550) if it is still standing: the building comes off the tile and a Gate takes
 * its place. Returns the new gate, or null.
 */
export function openGate(world: World, tile: number, opener: number, vehicle: Vehicle): Gate | null {
  const building = world.building[tile]!;
  if ((building !== GATE_H && building !== GATE_V) || !world.hp[tile]) return null;
  world.building[tile] = 0;
  return { tile, building, opening: 0, target: GATE_OPEN, closed: 0, opener, vehicle };
}

/** What a gate did this tick, for sounds. */
export type GateSound = 'move' | 'shut' | null;

/**
 * One tick of a gate (sub_4322f0). Returns whether it is still a gate, and the sound it makes. A closing gate that
 * would shut on something slides back and opens again; only soldiers count (sub_40c150 lets vehicles through), so
 * blocked says whether the halves at their new place touch a man.
 */
export function stepGate(
  world: World, g: Gate, inPlay: (v: Vehicle) => boolean, blocked: (g: Gate) => boolean = () => false,
): { keep: boolean; sound: GateSound } {
  let sound: GateSound = null;
  const was = g.opening;
  const closing = g.target < was;
  g.opening = approach(g.opening, g.target, GATE_SPEED);
  if (g.opening === 0) {
    if (g.closed === 0) sound = 'shut';
    g.closed++;
    if (g.closed > GATE_SETTLE) {
      world.building[g.tile] = g.building;
      return { keep: false, sound };
    }
  } else {
    g.closed = 0;
  }
  if (g.opening === GATE_OPEN && g.target === GATE_OPEN) {
    const v = g.vehicle;
    const here: Body = buildingBody(world, g.tile);
    const inZone = v && inPlay(v) && touch(here, ZONE, { x: v.x, y: v.y, z: v.z, heading: v.heading }, VEHICLES[v.kind].shapes);
    if (!inZone) {
      g.target = 0;
      sound = 'move';
    }
  }
  if (closing && blocked(g)) {
    g.target = GATE_OPEN;
    g.opening = was;
  }
  return { keep: true, sound };
}
