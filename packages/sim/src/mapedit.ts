// Map editing helpers shared by the level editor and the server: new maps, ground painting that picks the
// shoreline tiles itself, and the tile and building swaps used when a region is mirrored or turned.
//
// Painting works on the corners of tiles. Every tile corner is land, shallow or deep water; a tile shows
// whichever terrain has those four corners. The corners of each shoreline terrain are read from its shape in
// the game data (shore.json) the same way the game classifies ground, so painted coasts use the original's
// pieces. Deep water never touches land: a deep corner on a tile that also has a land corner becomes shallow.

import { MAP_FORMAT, MAP_VERSION, encodeTerrain, type RfwMap } from './map.js';
import { DEEP, LAND, SHALLOW, groundAt, type Ground, type ShoreTable } from './shore.js';

/** Plain grass, the default land (terrain 3; open ground in sub_42a430). */
export const LAND_TILE = 3;
export const SHALLOW_TILE = 1;
export const DEEP_TILE = 2;

/** Bridge ends (see addBridges in map.ts): west and east ends of an east-west bridge, north and south of the other. */
export const BRIDGE_END = { W: 84, E: 85, N: 86, S: 87 } as const;

export interface NewMapOptions {
  name?: string;
  author?: string;
  width?: number;
  height?: number;
  /** Terrain to fill with. Defaults to land. */
  fill?: number;
}

/** A blank version 2 map with no bases yet. */
export function newMap(o: NewMapOptions = {}): RfwMap {
  const width = o.width ?? 64;
  const height = o.height ?? 64;
  return {
    format: MAP_FORMAT,
    version: MAP_VERSION,
    name: o.name ?? 'Untitled',
    author: o.author ?? '',
    source: null,
    width,
    height,
    players: { min: 1, max: 1 },
    terrain: encodeTerrain(new Uint8Array(width * height).fill(o.fill ?? LAND_TILE)),
    bases: [],
    objects: [],
    settings: { vehicles: { tank: null, jeep: null, asv: null, heli: null }, randomMines: null, aiPool: null, music: null },
    description: '',
    visibility: 'private',
    revision: 0,
    notes: [],
  };
}

/** Corners in order: top left, top right, bottom right, bottom left. */
export type Corners = [Ground, Ground, Ground, Ground];

const PX = 1 << 16;
/** Corners are sampled this far in from the tile's corner, clear of the tile's edges. */
const INSET = 3;
const CORNER_POINTS: readonly [number, number][] = [[INSET, INSET], [32 - INSET, INSET], [32 - INSET, 32 - INSET], [INSET, 32 - INSET]];

/** The ground at each corner of a tile of terrain t, classified as the game does (groundAt). */
export function terrainCorners(shore: ShoreTable | null, t: number): Corners {
  const grid = { width: 1, terrain: Uint8Array.of(t & 127), building: Uint8Array.of(0), shore };
  return CORNER_POINTS.map(([x, y]) => groundAt(grid, x * PX, y * PX)) as Corners;
}

const key = (c: Corners) => c[0] * 27 + c[1] * 9 + c[2] * 3 + c[3];

/** Picks terrain for a tile from the ground at its corners. */
export class ShorePainter {
  /** Each terrain's corners. */
  readonly corners: Corners[] = [];
  /** Shoreline terrains (4-23 and 40-51) by their corners, lowest number first. */
  private readonly byCorners = new Map<number, number[]>();

  constructor(readonly shore: ShoreTable | null) {
    for (let t = 0; t < 128; t++) {
      const c = terrainCorners(shore, t);
      this.corners.push(c);
      if ((t >= 4 && t <= 23) || (t >= 40 && t <= 51)) {
        const k = key(c);
        if (!this.byCorners.has(k)) this.byCorners.set(k, []);
        this.byCorners.get(k)!.push(t);
      }
    }
  }

  /** Whether terrain t is all one kind of ground at its corners. */
  pure(t: number): Ground | null {
    const c = this.corners[t & 127]!;
    return c[0] === c[1] && c[1] === c[2] && c[2] === c[3] ? c[0] : null;
  }

  /** Whether some shoreline piece has exactly these corners. */
  has(c: Corners): boolean {
    return this.byCorners.has(key(c));
  }

  /**
   * Terrain for a tile with these corners. current is kept when it already fits, so roads, sand and the like stay
   * as painted; land is the tile to use for plain land. The game has no piece for some patterns: a corner of one
   * ground in a tile of another (the original's shallow-to-deep boxes cannot make an inside corner, for one) takes
   * the plain tile of the other three, so the coast turns that corner on the neighbouring edge pieces, as the
   * original maps do. Any other pattern no piece has (two opposite land corners, say) gets the piece matching the
   * most corners.
   */
  pick(c: Corners, current: number, land = LAND_TILE): number {
    const cur = this.corners[current & 127];
    if (cur && key(cur) === key(c)) return current;
    const plain = (g: Ground) => (g === LAND ? land : g === SHALLOW ? SHALLOW_TILE : DEEP_TILE);
    if (c[0] === c[1] && c[1] === c[2] && c[2] === c[3]) return plain(c[0]);
    const exact = this.byCorners.get(key(c));
    if (exact) return exact[0]!;
    const most = c.find((g) => c.filter((x) => x === g).length === 3);
    if (most !== undefined) {
      // Keep a tile that is already plain ground of that kind (sand, a road), as an exact fit would be kept.
      return cur && this.pure(current) === most ? current : plain(most);
    }
    let best = c.includes(LAND) ? land : SHALLOW_TILE;
    let score = -1;
    for (const list of this.byCorners.values()) {
      const t = list[0]!;
      const tc = this.corners[t]!;
      let s = 0;
      for (let i = 0; i < 4; i++) if (tc[i] === c[i]) s++;
      if (s > score) {
        score = s;
        best = t;
      }
    }
    return best;
  }
}

/** A terrain grid being edited: width x height bytes, row by row, as in the map file. */
export interface TerrainGrid {
  width: number;
  height: number;
  terrain: Uint8Array;
}

/**
 * The corner grid, (width + 1) x (height + 1): each corner takes the ground most of the tiles around it give it,
 * land before shallow before deep on a tie. Outside the map is deep water, as the world around a small map is.
 */
export function cornerGrid(g: TerrainGrid, painter: ShorePainter): Uint8Array {
  const cw = g.width + 1;
  const out = new Uint8Array(cw * (g.height + 1));
  const votes = [0, 0, 0];
  for (let cy = 0; cy <= g.height; cy++) {
    for (let cx = 0; cx <= g.width; cx++) {
      votes[0] = votes[1] = votes[2] = 0;
      // The tiles touching this corner, and which of their corners it is.
      for (const [dx, dy, corner] of [[-1, -1, 2], [0, -1, 3], [0, 0, 0], [-1, 0, 1]] as const) {
        const tx = cx + dx;
        const ty = cy + dy;
        if (tx < 0 || ty < 0 || tx >= g.width || ty >= g.height) continue;
        votes[painter.corners[g.terrain[ty * g.width + tx]! & 127]![corner]]!++;
      }
      const [land, shallow, deep] = votes as [number, number, number];
      out[cy * cw + cx] = land > 0 && land >= shallow && land >= deep ? LAND : shallow > 0 && shallow >= deep ? SHALLOW : DEEP;
    }
  }
  return out;
}

/**
 * Paints ground on tiles (indices into g.terrain) and fixes the shoreline around them. land is the terrain for new
 * land tiles. Returns the indices of the tiles that changed.
 */
export function paintGround(g: TerrainGrid, painter: ShorePainter, tiles: Iterable<number>, ground: Ground, land = LAND_TILE): number[] {
  const corners = cornerGrid(g, painter);
  const cw = g.width + 1;
  let x0 = g.width;
  let y0 = g.height;
  let x1 = -1;
  let y1 = -1;
  const painted = new Set<number>();
  for (const i of tiles) {
    if (i < 0 || i >= g.width * g.height) continue;
    painted.add(i);
    const tx = i % g.width;
    const ty = (i - tx) / g.width;
    for (const [dx, dy] of [[0, 0], [1, 0], [1, 1], [0, 1]] as const) corners[(ty + dy) * cw + tx + dx] = ground;
    x0 = Math.min(x0, tx);
    y0 = Math.min(y0, ty);
    x1 = Math.max(x1, tx);
    y1 = Math.max(y1, ty);
  }
  if (x1 < 0) return [];
  // Tiles whose corners may have changed: the painted ones and a ring around them.
  x0 = Math.max(0, x0 - 1);
  y0 = Math.max(0, y0 - 1);
  x1 = Math.min(g.width - 1, x1 + 1);
  y1 = Math.min(g.height - 1, y1 + 1);
  const cornersOf = (tx: number, ty: number): Corners =>
    [corners[ty * cw + tx]!, corners[ty * cw + tx + 1]!, corners[(ty + 1) * cw + tx + 1]!, corners[(ty + 1) * cw + tx]!] as Corners;
  // Deep water may not touch land.
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const c = cornersOf(tx, ty);
      if (!c.includes(LAND) || !c.includes(DEEP)) continue;
      for (const [k, dx, dy] of [[0, 0, 0], [1, 1, 0], [2, 1, 1], [3, 0, 1]] as const) {
        if (c[k] === DEEP) corners[(ty + dy) * cw + tx + dx] = SHALLOW;
      }
    }
  }
  const changed: number[] = [];
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const i = ty * g.width + tx;
      const current = g.terrain[i]!;
      // A painted land tile takes the chosen land; others keep what they have where it still fits.
      const keep = painted.has(i) && ground === LAND ? land : current;
      const t = painter.pick(cornersOf(tx, ty), keep, land);
      if (t !== current) {
        g.terrain[i] = t;
        changed.push(i);
      }
    }
  }
  return changed;
}

/**
 * Re-picks the coast pieces in a box of tiles (all of them by default) from the corner grid, as painting does: for
 * seams left by pasting or mirroring. Plain land, shallows and deep water that already fit are kept. Returns the
 * indices of the tiles that changed.
 */
export function settleCoast(g: TerrainGrid, painter: ShorePainter, land = LAND_TILE, box = { x0: 0, y0: 0, x1: g.width - 1, y1: g.height - 1 }): number[] {
  const corners = cornerGrid(g, painter);
  const cw = g.width + 1;
  const x0 = Math.max(0, box.x0);
  const y0 = Math.max(0, box.y0);
  const x1 = Math.min(g.width - 1, box.x1);
  const y1 = Math.min(g.height - 1, box.y1);
  const changed: number[] = [];
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const c = [corners[ty * cw + tx]!, corners[ty * cw + tx + 1]!, corners[(ty + 1) * cw + tx + 1]!, corners[(ty + 1) * cw + tx]!] as Corners;
      if (c.includes(LAND) && c.includes(DEEP)) for (let k = 0; k < 4; k++) if (c[k] === DEEP) c[k] = SHALLOW;
      const i = ty * g.width + tx;
      const t = painter.pick(c, g.terrain[i]!, land);
      if (t !== g.terrain[i]) {
        g.terrain[i] = t;
        changed.push(i);
      }
    }
  }
  return changed;
}

/** A mirror or quarter turn of a region: flip across the vertical axis (x), the horizontal axis (y), or turn. */
export type Transform = 'flipX' | 'flipY' | 'turnRight' | 'turnLeft' | 'turnHalf';

/** Where a point of a w x h region goes, and the region's new size. */
export function transformPoint(t: Transform, x: number, y: number, w: number, h: number): [number, number] {
  switch (t) {
    case 'flipX': return [w - 1 - x, y];
    case 'flipY': return [x, h - 1 - y];
    case 'turnHalf': return [w - 1 - x, h - 1 - y];
    case 'turnRight': return [h - 1 - y, x];
    case 'turnLeft': return [y, w - 1 - x];
  }
}

export function transformSize(t: Transform, w: number, h: number): [number, number] {
  return t === 'turnRight' || t === 'turnLeft' ? [h, w] : [w, h];
}

type Side = 'N' | 'E' | 'S' | 'W';
const SIDE: Record<Transform, Record<Side, Side>> = {
  flipX: { N: 'N', E: 'W', S: 'S', W: 'E' },
  flipY: { N: 'S', E: 'E', S: 'N', W: 'W' },
  turnHalf: { N: 'S', E: 'W', S: 'N', W: 'E' },
  turnRight: { N: 'E', E: 'S', S: 'W', W: 'N' },
  turnLeft: { N: 'W', E: 'N', S: 'E', W: 'S' },
};

/** A bridge end terrain after the transform (an east-west bridge turned is a north-south one). */
export function transformBridgeEnd(t: Transform, terrain: number): number {
  const side = (Object.keys(BRIDGE_END) as Side[]).find((s) => BRIDGE_END[s] === (terrain & 127));
  return side ? BRIDGE_END[SIDE[t][side]] : terrain;
}

/**
 * The building type a placed type becomes after the transform, from its name: a _N, _E, _S or _W suffix is a
 * facing and _H or _V an axis. Returns the name unchanged when it has neither, or when the turned name is not in
 * names (the building table has no such piece).
 */
export function transformType(t: Transform, name: string, names: ReadonlySet<string>): string {
  const m = /^(.*_)([NESWHV])$/.exec(name);
  if (!m) return name;
  const [, stem, s] = m as unknown as [string, string, string];
  let next = s;
  if (s === 'H' || s === 'V') {
    if (t === 'turnRight' || t === 'turnLeft') next = s === 'H' ? 'V' : 'H';
  } else next = SIDE[t][s as Side];
  const out = stem + next;
  return names.has(out) ? out : name;
}

/** The corners of a tile after the transform. */
export function transformCorners(t: Transform, c: Corners): Corners {
  // Corner k sits at these unit-square points; move each and see which corner it lands on.
  const at: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const out = [...c] as Corners;
  at.forEach(([x, y], k) => {
    const [nx, ny] = transformPoint(t, x, y, 2, 2);
    out[at.findIndex(([ax, ay]) => ax === nx && ay === ny)] = c[k]!;
  });
  return out;
}

// ---- Matching tiles under a transform ----------------------------------------------------------------------------

/** A tile picture: w x h pixels, RGBA packed little-endian (red in the low byte), as canvas ImageData gives them. */
export interface TileCel {
  w: number;
  h: number;
  px: Uint32Array;
}

export const TRANSFORMS: readonly Transform[] = ['flipX', 'flipY', 'turnRight', 'turnLeft', 'turnHalf'];

/** A cel's pixels mirrored or turned (square cels only). */
function transformCel(cel: TileCel, t: Transform): Uint32Array {
  const n = cel.w;
  const out = new Uint32Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const [nx, ny] = t === 'flipX' ? [n - 1 - x, y] : t === 'flipY' ? [x, n - 1 - y] : t === 'turnHalf' ? [n - 1 - x, n - 1 - y]
        : t === 'turnRight' ? [n - 1 - y, x] : [y, n - 1 - x];
      out[ny * n + nx] = cel.px[y * n + x]!;
    }
  }
  return out;
}

/** How alike two pictures are: the mean difference per colour channel, 0 for identical. */
function difference(a: Uint32Array, b: Uint32Array): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    d += Math.abs((x & 255) - (y & 255)) + Math.abs(((x >> 8) & 255) - ((y >> 8) & 255)) + Math.abs(((x >> 16) & 255) - ((y >> 16) & 255));
  }
  return d / (a.length * 3);
}

/** Close enough to count as the same picture: tiles are hand drawn, so a mirrored piece is rarely exact. */
const SAME = 12;

/**
 * Which terrain each terrain becomes under each transform. Shoreline pieces go by their corners (exact, from the
 * shapes) and bridge ends by their side; everything else by finding the tile whose picture looks most like the
 * mirrored or turned one. A tile with no look-alike stays as it is. cel gives a terrain tile's picture; the level
 * editor passes the loaded sprites and the server the sprite atlas it decodes.
 */
export function matchTileTransforms(cel: (t: number) => TileCel | null, painter: ShorePainter): Record<Transform, Uint8Array> {
  const cels = Array.from({ length: 128 }, (_, t) => cel(t));
  const out = {} as Record<Transform, Uint8Array>;
  for (const tr of TRANSFORMS) {
    const table = new Uint8Array(128);
    for (let t = 0; t < 128; t++) {
      table[t] = t;
      if (Object.values(BRIDGE_END).includes(t as 84)) {
        table[t] = transformBridgeEnd(tr, t);
        continue;
      }
      const pure = painter.pure(t);
      if (pure === null) {
        table[t] = painter.pick(transformCorners(tr, painter.corners[t]!), -1);
        continue;
      }
      const cel = cels[t];
      if (!cel || cel.w !== cel.h) continue;
      const want = transformCel(cel, tr);
      if (difference(want, cel.px) <= SAME) continue;
      let best = t;
      let score = Infinity;
      for (let u = 0; u < 128; u++) {
        const c = cels[u];
        if (!c || c.w !== cel.w || c.h !== cel.h || painter.pure(u) !== pure) continue;
        const d = difference(want, c.px);
        if (d < score) {
          score = d;
          best = u;
        }
      }
      if (score <= SAME) table[t] = best;
    }
    out[tr] = table;
  }
  return out;
}

