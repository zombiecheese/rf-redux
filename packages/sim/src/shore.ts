// What the ground is at a point: land, shallow water or deep water (sub_42f410 for a point, sub_42f280 for an
// object). Shoreline tiles are part land and part water, so the original keeps a shape for each:
// - terrain 4-23: a polygon, rotated in quarter turns about the tile centre. Depending on the tile, inside the
//   polygon is land and outside shallow water, or the other way round.
// - terrain 24-39: shallow water.
// - terrain 40-51: a box of shallow water; the rest of the tile is deep water.
// The shapes are game data, exported by tools/convert_assets.py to shore.json and passed to buildWorld.

import { crosses } from './collide.js';
import { FIXED_SHIFT, TILE_SHIFT } from './fixed.js';

export const LAND = 0;
export const SHALLOW = 1;
export const DEEP = 2;
export type Ground = typeof LAND | typeof SHALLOW | typeof DEEP;

export interface ShorePolygon {
  /** True when inside the polygon is land (table flag byte 0). */
  insideIsLand: boolean;
  /** Rotation in heading steps (0, 16, 32 or 48). */
  rotation: number;
  /** Shape words 5-6: offset of the shape from the tile centre. */
  offset: [number, number];
  /** Shape words 7-10: left, top, right, bottom relative to the tile centre (not rotated). */
  bounds: [number, number, number, number];
  /** Vertices relative to the shape's centre, 16.16 pixels. */
  verts: [number, number][];
  /** Vertex indices of the edges, in order. */
  edges: number[];
}

export interface ShoreTable {
  /** Keyed by terrain 4-23. */
  polygons: Record<string, ShorePolygon>;
  /** Keyed by terrain 40-51: left, top, right, bottom of the shallow part relative to the tile centre. */
  boxes: Record<string, [number, number, number, number]>;
}

/** Things the classifier needs from the world, kept narrow so map.ts can depend on this file. */
export interface ShoreGrid {
  width: number;
  terrain: Uint8Array;
  building: Uint8Array;
  shore: ShoreTable | null;
}

const BRIDGES = new Set([74, 75]);
/** Anything this high is in the air (sub_42f410 returns land above 1 px). */
const AIRBORNE = 1 << FIXED_SHIFT;
const HALF_TILE = 1 << (TILE_SHIFT - 1);

/** Rotates by a whole number of quarter turns, as the original's matrices (built at sub_41ae50) do exactly. */
function rotate(x: number, y: number, steps: number): [number, number] {
  switch ((steps >> 4) & 3) {
    case 1: return [-y, x];
    case 2: return [-x, -y];
    case 3: return [y, -x];
    default: return [x, y];
  }
}

/**
 * Point in a shore polygon (sub_41e060 with a point against a type-3 shape): outside its bounds is outside;
 * otherwise inside when the line from the point to the shape's centre crosses none of its edges.
 */
function inPolygon(p: ShorePolygon, x: number, y: number, tileX: number, tileY: number): boolean {
  const cx = tileX + p.offset[0];
  const cy = tileY + p.offset[1];
  const [l, t, r, b] = p.bounds;
  if (x - cx < l || x - cx > r || y - cy < t || y - cy > b) return false;
  const v = p.verts.map(([vx, vy]) => {
    const [rx, ry] = rotate(vx, vy, p.rotation);
    return [rx + cx, ry + cy] as const;
  });
  let prev = v[p.edges.length - 1]!;
  for (const i of p.edges) {
    const cur = v[i]!;
    if (crosses(x, y, cx, cy, cur[0], cur[1], prev[0], prev[1])) return false;
    prev = cur;
  }
  return true;
}

/** The ground at a world point and height. */
export function groundAt(w: ShoreGrid, x: number, y: number, z = 0): Ground {
  if (z > AIRBORNE) return LAND;
  const tx = x >> TILE_SHIFT;
  const ty = y >> TILE_SHIFT;
  // Off the grid the original reads a spare cell that is open water.
  if (x < 0 || y < 0 || tx >= w.width || ty >= w.width) return DEEP;
  const i = ty * w.width + tx;
  const t = w.terrain[i]! & 127;
  if (t > 51 || BRIDGES.has(w.building[i]!)) return LAND;
  if (t === 1) return SHALLOW;
  if (t === 2) return DEEP;
  if (t < 4) return LAND;
  const tileX = (tx << TILE_SHIFT) + HALF_TILE;
  const tileY = (ty << TILE_SHIFT) + HALF_TILE;
  if (t < 24) {
    const p = w.shore?.polygons[t];
    // Without the shapes, call the whole tile land.
    if (!p) return LAND;
    return inPolygon(p, x, y, tileX, tileY) === p.insideIsLand ? LAND : SHALLOW;
  }
  if (t < 40) return SHALLOW;
  const box = w.shore?.boxes[t];
  if (!box) return SHALLOW;
  const dx = x - tileX;
  const dy = y - tileY;
  return dx >= box[0] && dx <= box[2] && dy >= box[1] && dy <= box[3] ? SHALLOW : DEEP;
}
