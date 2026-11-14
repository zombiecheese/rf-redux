// Building behaviour from the original's 91-entry building table (RFIRE.BIN VA 0x447030, 56 bytes each).
// The converter exports each record's name and its 13 words from +0x08 as `raw`, so raw[i] is record
// offset 0x08 + 4 * i. The table itself is an original game file and is loaded at run time, never committed.

import type { Shape } from './collide.js';
import type { ExplosionScript } from './explosions.js';

/** One record as exported by tools/convert_assets.py (buildings.json). */
export interface BuildingRecord {
  name: string;
  raw: readonly number[];
  /** The model's collision shapes (model word 2), when the converter exported them. */
  shapes?: readonly Shape[];
  /** Its explosion when destroyed (+0x2c), a key into the exported explosions, when the converter exported them. */
  explosion?: string | null;
  /** Its explosion when crushed (+0x28; bushes, cacti and planters). */
  crushExplosion?: string | null;
}

/**
 * What happens when a vehicle touches a building, from the record's contact callback (+0x14):
 * - block: the default (no callback, or one that returns 0): the vehicle stops, and remembers the building.
 * - rock (sub_436610): blocks jeeps; anything heavier drives over.
 * - scenery (sub_436640, bushes, cacti and planters): a planter's low part (mask 4) never blocks; jeeps are
 *   blocked; others crush it when going faster than half a pixel a tick, else are blocked.
 * - tent (sub_436a50): crushed by anything faster than half a pixel a tick, else blocks.
 * - pad (sub_4366f0, depots and gates): touching a pad part (flag byte 8 bit 2) records it and passes.
 * - flag (sub_432d80, the opened flag building): a jeep picks the flag up; it blocks everything.
 */
export type ContactKind = 'block' | 'rock' | 'scenery' | 'tent' | 'pad' | 'flag';


export interface BuildingDef {
  id: number;
  name: string;
  /** Hit points set at load (record +0x11, sub_42e4f0). 0 means it cannot be destroyed. */
  hp: number;
  /** Terrain written under the building when it is placed (record +0x10), or null to keep the map's. */
  placeTerrain: number | null;
  /** Record flags at +0x0c: 8 adds the owner to placeTerrain; bits 2 and 4 pick a random rubble variant. */
  flags: number;
  /** Subtracted from each hit before it counts (record +0x20, 16.16). */
  armour: number;
  /** Multiplies each hit when non-zero (record +0x24, 16.16). */
  multiplier: number;
  /** Building it turns into when destroyed (record +0x31), 0 for none. */
  becomes: number;
  /** Terrain written when destroyed (record +0x30), 0 to keep the current terrain. */
  becomesTerrain: number;
  /** True for buildings that ground vehicles cannot drive through. */
  solid: boolean;
  /** Collision shapes, sorted by height. Without exported shapes a solid building fills its tile. */
  shapes: readonly Shape[];
  contact: ContactKind;
  /** Placed off-centre by the map's scenery offsets (model callback sub_4365c0). */
  jitter: boolean;
  /** The explosion that brings it down (explosions.ts), or null to become rubble at once. */
  explosion: ExplosionScript | null;
  /** The one used when a vehicle crushes it, where it has its own. */
  crushExplosion: ExplosionScript | null;
}

export const BUILDING = {
  NOTHING: 0,
  AMMO: 14,
  FLAG: 22,
  DMG_FLAG: 62,
  DEST_FLAG: 63,
  FUEL_N: 39,
  FUEL_W: 42,
  BRIDGE_H: 74,
  BRIDGE_V: 75,
} as const;

// Scenery a vehicle can push through, and the rubble left behind by destroyed buildings. Vehicles collide with
// the real shapes (collide.ts); this list is what bots and projectiles treat as open ground, and what a building
// without exported shapes falls back to.
const PASSABLE = new Set([
  0, 1, 2, 3, 4, 5, 6, 11, 12, 13, 51, 52, 53, 61, 63, 64, 65, 66, 67, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85,
  86, 87, 88, 89,
]);

const CONTACT: Record<number, ContactKind> = {
  1: 'scenery', 2: 'scenery', 6: 'scenery', 11: 'scenery', 12: 'scenery', 13: 'scenery',
  7: 'rock', 8: 'rock', 9: 'rock', 10: 'rock',
  14: 'pad', 39: 'pad', 40: 'pad', 41: 'pad', 42: 'pad', 43: 'pad', 44: 'pad',
  47: 'tent', 48: 'tent',
  63: 'flag',
};

/** Bushes, palms, cacti, rocks and their rubble: the buildings whose model callback is sub_4365c0. */
const JITTER = new Set([1, 2, 3, 4, 6, 7, 8, 9, 10, 84, 85, 87, 88]);

const HALF_TILE = 16 << 16;
/** Stands in for a solid building's shapes when none were exported: a box filling the tile, 16 px high. */
export const TILE_BOX: readonly Shape[] = [
  { type: 2, flags: [0, 0, 1, 255], z: [0, HALF_TILE], offset: [0, 0], bounds: [-HALF_TILE, -HALF_TILE, HALF_TILE, HALF_TILE] },
];

function signed(n: number): number {
  return n | 0;
}

/**
 * The building table. explosions holds the exported explosion definitions (effects.json); without them destroyed
 * buildings become rubble at once.
 */
export function buildingDefs(records: readonly BuildingRecord[], explosions: Readonly<Record<string, ExplosionScript>> = {}): BuildingDef[] {
  return records.map((r, id) => {
    const raw = r.raw;
    const word = (i: number) => signed(raw[i] ?? 0);
    const hpByte = (word(2) >> 8) & 0xff;
    // sub_42e4f0 clamps to 1..15 and stores the value in grid bits 25-27, so only the low 3 bits survive.
    const hp = hpByte === 0 ? 0 : Math.min(15, Math.max(1, hpByte)) & 7;
    const terrainByte = word(2) & 0xff;
    return {
      id,
      name: r.name,
      hp,
      placeTerrain: terrainByte === 0xff ? null : terrainByte,
      flags: word(1),
      armour: word(6),
      multiplier: word(7),
      becomes: (word(10) >> 8) & 0xff,
      becomesTerrain: word(10) & 0xff,
      solid: !PASSABLE.has(id),
      shapes: r.shapes ?? (PASSABLE.has(id) ? [] : TILE_BOX),
      contact: CONTACT[id] ?? 'block',
      jitter: JITTER.has(id),
      explosion: (r.explosion && explosions[r.explosion]) || null,
      crushExplosion: (r.crushExplosion && explosions[r.crushExplosion]) || null,
    };
  });
}

/** The layers a vehicle's shapes collide with (byte 11 of the vehicle shapes). */
const VEHICLE_MASK = 39;

/**
 * Whether a ground vehicle at full speed is stopped by this building, for planning routes: rocks and bushes stop
 * only jeeps, tents are crushed, bridges (layer 64) are never touched, and anything else with shapes stops it.
 */
export function stopsVehicle(def: BuildingDef, jeep: boolean): boolean {
  if (!def.shapes.some((s) => s.flags[2]! & VEHICLE_MASK)) return false;
  if (def.contact === 'rock' || def.contact === 'scenery') return jeep;
  return def.contact !== 'tent';
}
