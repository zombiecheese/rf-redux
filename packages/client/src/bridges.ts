// A destroyed bridge (building 76) keeps the broken ends of its deck: its sort callback (sub_436d00) swaps in one of
// six stub models, picked by sub_436c20 from the tiles beside it.
import { GRID, type World } from '@rfw/sim';

const BRIDGE_H = 74;
const BRIDGE_V = 75;
/** Terrain cels of the bridge ends: west, east, north, south. */
const END_W = 84;
const END_E = 85;
const END_N = 86;
const END_S = 87;

export const BROKEN_BRIDGE = 76;

/**
 * Which stub a destroyed bridge shows, as an index into its six: bridge (or its end) on both sides across (0), only
 * to the west (1) or east (2), above and below (3), only above (4) or below (5). With no bridge beside it, it draws
 * nothing; the original then also takes the building off the tile.
 */
export function bridgeStub(world: World, i: number): number | null {
  const at = (k: number, building: number, end: number) =>
    k >= 0 && k < world.building.length && (world.building[k] === building || (world.terrain[k]! & 0x7f) === end);
  const west = at(i - 1, BRIDGE_H, END_W);
  const east = at(i + 1, BRIDGE_H, END_E);
  if (west) return east ? 0 : 1;
  if (east) return 2;
  const north = at(i - GRID, BRIDGE_V, END_N);
  const south = at(i + GRID, BRIDGE_V, END_S);
  if (north) return south ? 3 : 4;
  return south ? 5 : null;
}
