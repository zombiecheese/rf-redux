import type { ExplosionScript } from './explosions.js';
import { mul } from './fixed.js';
import { placeBuilding, type World } from './map.js';
import type { Rng } from './rng.js';

/**
 * Applies a hit to the building on tile i, following sub_42e8c0. The damage is 16.16; the building's armour
 * is subtracted first, and the multiplier applied when it has one. Each hit removes at least one hit point.
 * Returns true when the building was destroyed by this hit. One with an explosion (sub_42e6a0) is left standing
 * with no hit points for its explosion's script to replace (see explosions.ts); crushed scenery uses its crush
 * explosion. Others become rubble at once.
 */
export function damageBuilding(world: World, i: number, damage: number, rng: Rng, crushed = false): boolean {
  const hp = world.hp[i]!;
  if (!hp) return false;
  const def = world.defs[world.building[i]!]!;
  const hits = buildingHits(def, damage);
  if (!hits) return false;
  if (hits < hp) {
    world.hp[i] = hp - hits;
    return false;
  }
  if (destroyExplosion(world.defs[world.building[i]!]!, crushed)) world.hp[i] = 0;
  else destroyBuilding(world, i, rng);
  return true;
}

/** Hit points a hit takes off a building (sub_42e7f0): none when its armour stops it, else at least one. */
export function buildingHits(def: { armour: number; multiplier: number }, damage: number): number {
  let d = damage - def.armour;
  if (d <= 0) return 0;
  if (def.multiplier) d = mul(d, def.multiplier);
  return Math.max(1, d >> 16);
}

/** The explosion a destroyed building makes (record +0x2c, or +0x28 when crushed, sub_436640). */
export function destroyExplosion(def: { explosion: ExplosionScript | null; crushExplosion: ExplosionScript | null }, crushed: boolean): ExplosionScript | null {
  return (crushed && def.crushExplosion) || def.explosion;
}

/**
 * Turns a destroyed building into what it becomes (sub_42e600): its next building, if it has one, and
 * possibly new terrain, with a random variant when the record's flags ask for one. building and owner default to
 * the tile's; a rubble op passes the ones it took off the tile.
 */
export function destroyBuilding(world: World, i: number, rng: Rng, building = world.building[i]!, base = world.owner[i]!): void {
  const def = world.defs[building]!;
  const variant = def.flags & 4 ? rng.below(4) : def.flags & 2 ? rng.below(2) : 0;
  const owner = base < 0 ? null : base;
  if (def.becomes) {
    placeBuilding(world, i, def.becomes, owner);
    if (def.becomesTerrain) world.terrain[i] = def.becomesTerrain + variant;
  } else {
    world.building[i] = 0;
    world.hp[i] = 0;
    world.terrain[i] = def.becomesTerrain + variant;
  }
}
