// Built-in 3- and 4-base maps, made from pieces of the original 2-player maps. They are built wherever those maps
// are (the game server and the dev server, from the art pack's maps or an import's) and kept in memory.
//
// analyseMaps reads the originals and keeps what a new map is built from:
// - blocks: each base's walled compounds, defence clusters and flag houses, with the ground and scenery under them;
// - lift pads: what stands round each base's start;
// - the lift tiles, the plain land tile, the roads that lead onto bridges and how long bridges run;
// - how thickly scenery covers open land, and which kinds.
//
// generateMaps lays those pieces out on new islands with mirror symmetry, as the level editor's symmetry modes do,
// so every base gets the same layout:
// - 4 bases: the four quarters mirror each other (the editor's "Mirror both");
// - 3 bases: the left and right halves mirror each other; base 1 sits on the mirror line at the top and bases 2
//   and 3 below it, all three the same distance apart.
// Each base gets a kit: its lift and pad, a flag compound behind it and a defence block in front, each with its
// mirror image on the other side of the lift; from level 3 a block of its other buildings too, and from level 6 a
// second defence block. The land is made to look like the originals': each base's island is a disc with lobes, its
// coast moved in and out by noise, with islets off it; channels wander; roads run from each lift to its neighbours
// (in steps up a slope) and onto the bridges; and scenery stands in groves with clearings between. Every map must pass checkMap with no errors and every flag in
// reach of every other base; a layout that does not is drawn again with the next seed.
//
// Everything is integer maths or exactly rounded (Math.sqrt), so the same originals give the same maps anywhere.

import type { BuildingDef } from './buildings.js';
import { checkMap } from './mapcheck.js';
import { MAP_FORMAT, MAP_VERSION, decodeTerrain, encodeTerrain, type MapObject, type MapPoint, type RfwMap } from './map.js';
import {
  BRIDGE_END, DEEP_TILE, SHALLOW_TILE, ShorePainter, matchTileTransforms, paintGround, settleCoast, transformCorners, transformPoint,
  transformType, type TileCel, type Transform,
} from './mapedit.js';
import { decodePng, type PngImage } from './png.js';
import { DEEP, LAND, SHALLOW, type ShoreTable } from './shore.js';

/** A piece of an original base: its buildings, flag sites and ground, relative to its top left corner. */
export interface Block {
  /** The original map it came from (its id and name), and its level (1-9). */
  source: string;
  sourceName: string;
  level: number;
  w: number;
  h: number;
  /** Terrain to lay, w x h; -1 where the original had water (the new map's ground stays). */
  terrain: number[];
  /** owned: belongs to the base the block is given to; otherwise neutral scenery. */
  objects: { x: number; y: number; type: string; owned: boolean }[];
  flags: MapPoint[];
  /** Gun towers, bunkers and the like in it. */
  defences: number;
}

/** What stood round an original base's start, relative to it (within 2 tiles). */
export interface Pad {
  source: string;
  objects: { x: number; y: number; type: string; owned: boolean }[];
}

export interface MapAnalysis {
  /** How many original maps were read. */
  maps: number;
  blocks: Block[];
  pads: Pad[];
  /** The terrain under starts: even bases, odd bases. */
  lift: [number, number];
  /** The most common plain land terrain. */
  land: number;
  /** Road terrain leading onto east-west and north-south bridges. */
  road: { ew: number; ns: number };
  /** Bridge lengths in tiles, end to end, sorted. */
  bridges: number[];
  /** Neutral scenery per 1000 tiles of open land, and the kinds with their counts. */
  sceneryPerMille: number;
  scenery: { type: string; count: number }[];
}

/** The game data the generator needs: the building table, shoreline shapes and how tiles mirror. */
export interface GenData {
  defs: readonly BuildingDef[];
  shore: ShoreTable | null;
  /** Terrain each terrain becomes under each transform (matchTileTransforms). */
  turned: Record<Transform, Uint8Array>;
}

const DEFENCE = /TOWER|BNKR|OUTPOST|GUN|TURRET/;
/** Blocks bigger than this either way don't fit a kit. */
const MAX_BLOCK = 12;
/** A kit reaches at most this far left and right of its lift. */
const MAX_HALF = 18;
/** Road terrain by the sides a road runs out to, as the game's tiles are numbered (73 is north-south). */
const ROAD_ARMS = ['ns', 'nse', 'wes', 'wen', 'nsw', 'nesw', 'we', 'se', 'sw', 'ne', 'nw'];
const ROAD_FIRST = 73;
const isRoad = (t: number) => t >= ROAD_FIRST && t < ROAD_FIRST + ROAD_ARMS.length;

const isBridgeEnd = (t: number) => t >= BRIDGE_END.W && t <= BRIDGE_END.S;

/** Reads the converted original maps (sorted by id, so the result never depends on file order). */
export function analyseMaps(originals: readonly { id: string; map: RfwMap }[], data: Pick<GenData, 'shore'>): MapAnalysis {
  const painter = new ShorePainter(data.shore);
  const list = [...originals].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const blocks: Block[] = [];
  const pads: Pad[] = [];
  const liftVotes = [new Map<number, number>(), new Map<number, number>()];
  const landVotes = new Map<number, number>();
  const ewVotes = new Map<number, number>();
  const nsVotes = new Map<number, number>();
  const bridges: number[] = [];
  const scenery = new Map<string, number>();
  let openLand = 0;
  let neutral = 0;
  const vote = (m: Map<number, number>, k: number) => m.set(k, (m.get(k) ?? 0) + 1);
  const top = (m: Map<number, number>, fallback: number) => {
    let best = fallback;
    let n = 0;
    for (const [k, c] of [...m].sort((a, b) => a[0] - b[0])) if (c > n) [best, n] = [k, c];
    return best;
  };

  for (const { id, map } of list) {
    const w = map.width;
    const h = map.height;
    const terrain = decodeTerrain(map.terrain);
    const t = (x: number, y: number) => terrain[y * w + x]! & 127;
    const isLand = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && painter.pure(t(x, y)) === LAND;
    const level = map.source?.level ?? 5;
    const at = new Map<number, MapObject>();
    for (const o of map.objects) at.set(o.y * w + o.x, o);
    const starts = new Set(map.bases.map((b) => b.start.y * w + b.start.x));

    for (const b of map.bases) vote(liftVotes[b.id & 1]!, t(b.start.x, b.start.y));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const k = t(x, y);
        if (painter.pure(k) === LAND && !isBridgeEnd(k)) {
          vote(landVotes, k);
          const o = at.get(y * w + x);
          if (!o || o.base === null) openLand++;
          if (o && o.base === null) {
            neutral++;
            scenery.set(o.type, (scenery.get(o.type) ?? 0) + 1);
          }
        }
        // Bridges: the tile before each west and north end is the road leading on; the length runs to the far end.
        if (k === BRIDGE_END.W) {
          if (x > 0 && isLand(x - 1, y) && t(x - 1, y) !== 0) vote(ewVotes, t(x - 1, y));
          let e = x + 1;
          while (e < w && t(e, y) !== BRIDGE_END.E) e++;
          if (e < w) bridges.push(e - x + 1);
        } else if (k === BRIDGE_END.N) {
          if (y > 0 && isLand(x, y - 1) && t(x, y - 1) !== 0) vote(nsVotes, t(x, y - 1));
          let e = y + 1;
          while (e < h && t(x, e) !== BRIDGE_END.S) e++;
          if (e < h) bridges.push(e - y + 1);
        }
      }
    }

    for (const b of map.bases) {
      // The pad: everything within two tiles of the start.
      const pad: Pad = { source: id, objects: [] };
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const o = at.get((b.start.y + dy) * w + b.start.x + dx);
          if (o && (o.base === null || o.base === b.id) && isLand(b.start.x + dx, b.start.y + dy)) {
            pad.objects.push({ x: dx, y: dy, type: o.type, owned: o.base !== null });
          }
        }
      }
      pads.push(pad);

      // Blocks: this base's buildings and flag sites, grouped where they stand within two tiles of each other.
      const pts = [...map.objects.filter((o) => o.base === b.id).map((o) => ({ x: o.x, y: o.y })), ...b.flagSites];
      const index = new Map(pts.map((p, i) => [p.y * w + p.x, i]));
      const seen = new Uint8Array(pts.length);
      for (let i = 0; i < pts.length; i++) {
        if (seen[i]) continue;
        const group: MapPoint[] = [];
        const stack = [i];
        seen[i] = 1;
        while (stack.length) {
          const p = pts[stack.pop()!]!;
          group.push(p);
          for (let dy = -2; dy <= 2; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
              const j = index.get((p.y + dy) * w + p.x + dx);
              if (j !== undefined && !seen[j]) {
                seen[j] = 1;
                stack.push(j);
              }
            }
          }
        }
        const block = cutBlock(map, b.id, group, terrain, at, starts, isLand, level, id);
        if (block) blocks.push(block);
      }
    }
  }

  const bw = top(ewVotes, 0);
  return {
    maps: list.length,
    blocks,
    pads,
    lift: [top(liftVotes[0]!, 90), top(liftVotes[1]!, 91)],
    land: top(landVotes, 3),
    road: { ew: bw, ns: top(nsVotes, bw) },
    bridges: bridges.sort((a, b) => a - b),
    sceneryPerMille: openLand ? Math.floor((neutral * 1000) / openLand) : 0,
    scenery: [...scenery].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count || (a.type < b.type ? -1 : 1)),
  };
}

/** A group of one base's buildings as a block, or null if it is too big, too small, or not all on land. */
function cutBlock(
  map: RfwMap, base: number, group: MapPoint[], terrain: Uint8Array, at: Map<number, MapObject>, starts: Set<number>,
  isLand: (x: number, y: number) => boolean, level: number, source: string,
): Block | null {
  const w = map.width;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -1;
  let y1 = -1;
  for (const p of group) {
    if (!isLand(p.x, p.y)) return null;
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  const bw = x1 - x0 + 1;
  const bh = y1 - y0 + 1;
  if (group.length < 4 || bw > MAX_BLOCK || bh > MAX_BLOCK || bw < 2 || bh < 2) return null;
  const flagSet = new Set(map.bases[base]!.flagSites.map((p) => p.y * w + p.x));
  const block: Block = { source, sourceName: map.name, level, w: bw, h: bh, terrain: [], objects: [], flags: [], defences: 0 };
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * w + x;
      if (starts.has(i)) return null;
      const land = isLand(x, y);
      block.terrain.push(land ? terrain[i]! & 127 : -1);
      if (flagSet.has(i)) {
        block.flags.push({ x: x - x0, y: y - y0 });
        continue;
      }
      const o = at.get(i);
      if (!o || !land) continue;
      // Another base's building inside means the two bases' works are tangled; leave the block out.
      if (o.base !== null && o.base !== base) return null;
      block.objects.push({ x: x - x0, y: y - y0, type: o.type, owned: o.base !== null });
      if (o.base !== null && DEFENCE.test(o.type)) block.defences++;
    }
  }
  // Bridge ends belong to their bridges.
  if (block.terrain.some((t) => t >= 0 && isBridgeEnd(t))) return null;
  return block;
}

// ---- Generating ----------------------------------------------------------------------------------------------------

/** One map to make: how many bases, the level its pieces come from (1-9), and its name. */
export interface MapPlan {
  id: string;
  name: string;
  bases: 3 | 4;
  level: number;
  seed: number;
}

/** The built-in maps: eight with 3 bases and eight with 4, from easy to hard. */
export const MAP_PLANS: readonly MapPlan[] = [
  { id: 'tri01', name: 'Three Kings', bases: 3, level: 2, seed: 0x3a01 },
  { id: 'tri02', name: 'Trident', bases: 3, level: 3, seed: 0x3a02 },
  { id: 'tri03', name: 'Three\'s a Crowd', bases: 3, level: 4, seed: 0x3a03 },
  { id: 'tri04', name: 'Delta Force', bases: 3, level: 5, seed: 0x3a04 },
  { id: 'tri05', name: 'Triple Threat', bases: 3, level: 6, seed: 0x3a05 },
  { id: 'tri06', name: 'Pyramid Scheme', bases: 3, level: 7, seed: 0x3a06 },
  { id: 'tri07', name: 'Love Triangle', bases: 3, level: 8, seed: 0x3a07 },
  { id: 'tri08', name: 'Bermuda Triangle', bases: 3, level: 9, seed: 0x3a08 },
  { id: 'quad01', name: 'Four Corners', bases: 4, level: 2, seed: 0x4a01 },
  { id: 'quad02', name: 'Square Dance', bases: 4, level: 3, seed: 0x4a02 },
  { id: 'quad03', name: 'Cloverleaf', bases: 4, level: 4, seed: 0x4a03 },
  { id: 'quad04', name: 'Compass Rose', bases: 4, level: 5, seed: 0x4a04 },
  { id: 'quad05', name: 'Crossroads', bases: 4, level: 6, seed: 0x4a05 },
  { id: 'quad06', name: 'Quartered', bases: 4, level: 7, seed: 0x4a06 },
  { id: 'quad07', name: 'Four Horsemen', bases: 4, level: 8, seed: 0x4a07 },
  { id: 'quad08', name: 'Checkmate', bases: 4, level: 9, seed: 0x4a08 },
];

/** Tries per map before giving up on it. */
const TRIES = 40;

export interface GeneratedMap {
  id: string;
  map: RfwMap;
  /** The level it is listed under (1-9). */
  level: number;
}

/** Every plan that could be built. A plan with no layout that passes the checks is left out. */
export function generateMaps(a: MapAnalysis, data: GenData, plans: readonly MapPlan[] = MAP_PLANS): GeneratedMap[] {
  const out: GeneratedMap[] = [];
  for (const plan of plans) {
    const map = generateMap(a, data, plan);
    if (map) out.push({ id: plan.id, map, level: plan.level });
  }
  return out;
}

/** One map from a plan, or null if no layout passes the checks. */
export function generateMap(a: MapAnalysis, data: GenData, plan: MapPlan): RfwMap | null {
  if (!a.blocks.length) return null;
  for (let attempt = 0; attempt < TRIES; attempt++) {
    const map = layout(a, data, plan, new Rand(plan.seed * 7919 + attempt * 104729 + 1));
    if (!map) continue;
    const problems = checkMap(map, data.defs, data.shore);
    if (!problems.some((p) => p.level === 'error' || p.code === 'unreachable')) return map;
  }
  return null;
}

/** Deterministic random numbers for the generator (mulberry32). */
class Rand {
  constructor(private s: number) {}

  next(): number {
    this.s = (this.s + 0x6d2b79f5) | 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** An integer in [lo, hi]. */
  int(lo: number, hi: number): number {
    return lo + (this.next() % (hi - lo + 1));
  }

  pick<T>(list: readonly T[]): T {
    return list[this.next() % list.length]!;
  }
}

/** A hash of a tile and a seed, 0-255: the same tile always gets the same value. */
function hash(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) & 255;
}

/** Smooth noise, 0-255, from a lattice of hashed values every cell tiles, blended in between. */
function noise(x: number, y: number, cell: number, seed: number): number {
  const ix = Math.floor(x / cell);
  const iy = Math.floor(y / cell);
  const fx = x - ix * cell;
  const fy = y - iy * cell;
  const a = hash(ix, iy, seed);
  const b = hash(ix + 1, iy, seed);
  const c = hash(ix, iy + 1, seed);
  const d = hash(ix + 1, iy + 1, seed);
  const top = a * (cell - fx) + b * fx;
  const bottom = c * (cell - fx) + d * fx;
  return Math.floor((top * (cell - fy) + bottom * fy) / (cell * cell));
}

/** A kit item: a block placed with its top left at (x, y) relative to the lift, maybe mirrored. */
interface Placed {
  block: Block;
  x: number;
  y: number;
  flip: boolean;
}

/** A base's kit facing north (its front towards smaller y), lift at 0,0. It is its own mirror image left to right. */
interface Kit {
  items: Placed[];
  pad: { x: number; y: number; type: string; owned: boolean }[];
  /** Extent: left/right half width, and how far it runs in front (north) and behind (south). */
  half: number;
  front: number;
  behind: number;
}

/** A building's type after mirroring left to right and/or top to bottom. */
function turnType(type: string, fx: boolean, fy: boolean, names: ReadonlySet<string>): string {
  if (fx && fy) return transformType('turnHalf', type, names);
  if (fx) return transformType('flipX', type, names);
  if (fy) return transformType('flipY', type, names);
  return type;
}

function turnTerrain(t: number, fx: boolean, fy: boolean, turned: GenData['turned']): number {
  if (fx && fy) return turned.turnHalf[t]!;
  if (fx) return turned.flipX[t]!;
  if (fy) return turned.flipY[t]!;
  return t;
}

/** Blocks near the plan's level, widening the band until there are some. */
function near<T extends { level: number }>(list: readonly T[], level: number): T[] {
  for (let band = 0; band <= 8; band++) {
    const found = list.filter((b) => Math.abs(b.level - level) <= band);
    if (found.length) return found;
  }
  return [...list];
}

function makeKit(a: MapAnalysis, plan: MapPlan, rand: Rand, names: ReadonlySet<string>): Kit | null {
  const flagBlocks = near(a.blocks.filter((b) => b.flags.length > 0 && b.flags.length <= 4), plan.level);
  const defenceBlocks = near(a.blocks.filter((b) => b.flags.length === 0 && b.defences > 0), plan.level);
  if (!flagBlocks.length || !defenceBlocks.length) return null;
  const flag = rand.pick(flagBlocks);
  const defence = rand.pick(defenceBlocks);
  const gap = 3;
  // Left side: the flag compound behind the lift, the defences in front; then the same mirrored on the right.
  const left: Placed[] = [
    { block: flag, x: -gap - flag.w + 1 - 1, y: gap, flip: false },
    { block: defence, x: -gap - defence.w + 1 - 1, y: -gap - defence.h + 1, flip: false },
  ];
  // From level 3 a base has a block of its other buildings beside the flag compound, and from level 6 a second
  // defence block beside the first, as the originals' bases grow with their level. Neither may make the kit too wide.
  const others = near(a.blocks.filter((b) => b.flags.length === 0 && b.defences === 0), plan.level);
  if (plan.level >= 3 && others.length) {
    const town = rand.pick(others);
    const x = left[0]!.x - 2 - town.w;
    if (-x <= MAX_HALF) left.push({ block: town, x, y: gap, flip: false });
  }
  if (plan.level >= 6) {
    const second = rand.pick(defenceBlocks);
    const x = left[1]!.x - 2 - second.w;
    if (-x <= MAX_HALF) left.push({ block: second, x, y: -gap - second.h + 1, flip: false });
  }
  const items = [...left, ...left.map((p) => ({ block: p.block, x: -(p.x + p.block.w - 1), y: p.y, flip: true }))];
  // The pad from an original start: its left half, mirrored onto the right; on the middle column only pieces that
  // look the same mirrored. The lift's own row and column stay clear: the roads out of the base run along them.
  const padFrom = a.pads.length ? rand.pick(a.pads) : { source: '', objects: [] };
  const pad: Kit['pad'] = [];
  for (const o of padFrom.objects) {
    if (o.x < 0 && o.y !== 0) pad.push(o, { ...o, x: -o.x, type: turnType(o.type, true, false, names) });
  }
  const half = Math.max(2, ...items.map((p) => Math.max(-p.x, p.x + p.block.w - 1)));
  const front = Math.max(2, ...items.map((p) => -p.y));
  const behind = Math.max(2, ...items.map((p) => p.y + p.block.h - 1));
  return { items, pad, half, front, behind };
}

/** Where a base goes and which way its kit faces: north (front to smaller y) or south. */
interface Seat {
  x: number;
  y: number;
  south: boolean;
}

/** A land shape: a disc, or a thick line between two points. Its edge wanders in and out by up to `rough` tiles. */
interface Shape {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  r: number;
  rough: number;
}

/** A straight bridge to lay: along a row (ew) or a column, crossing the mirror line at `at`. */
interface BridgePlan {
  ew: boolean;
  /** The row (ew) or column it runs along. */
  line: number;
  /** The mirror line it crosses: the tile column/row (odd sizes) or the gap after it (even sizes). */
  mid: number;
  even: boolean;
  /** The rows (ew) or columns the channel under it runs across. */
  from: number;
  to: number;
}

function layout(a: MapAnalysis, data: GenData, plan: MapPlan, rand: Rand): RfwMap | null {
  const names = new Set(data.defs.map((d) => d.name));
  const painter = new ShorePainter(data.shore);
  const kit = makeKit(a, plan, rand, names);
  if (!kit) return null;
  const margin = 5;

  // Seats, map size, and the land shapes in the source part (the part the rest mirrors).
  let width: number;
  let height: number;
  const seats: Seat[] = [];
  const shapes: Shape[] = [];
  const bridges: BridgePlan[] = [];
  const islandR = kit.half + 5;
  const linkR = rand.int(3, 5);
  /** Half the channel a bridge crosses, from the analysed bridge lengths. */
  const median = a.bridges.length ? a.bridges[a.bridges.length >> 1]! : 8;
  const channel = Math.max(3, Math.min(6, (median >> 1) - 1));
  const disc = (x: number, y: number, r: number, rough = 4) => shapes.push({ ax: x, ay: y, bx: x, by: y, r, rough });
  const link = (ax: number, ay: number, bx: number, by: number) => shapes.push({ ax, ay, bx, by, r: linkR, rough: 2 });
  /** A base's island: a disc with two to four lobes off it, so no two islands have the same outline. */
  const island = (x: number, y: number) => {
    disc(x, y, islandR);
    for (let k = rand.int(2, 4); k > 0; k--) {
      const r = rand.int(islandR >> 1, (islandR * 2) / 3 | 0);
      disc(x + (rand.int(-islandR, islandR) >> 1), y + (rand.int(-islandR, islandR) >> 1), r, 5);
    }
  };
  /** Roads, as runs along a row or a column in the source part; every mirror image is laid too. */
  const roads: { ax: number; ay: number; bx: number; by: number }[] = [];
  const road = (ax: number, ay: number, bx: number, by: number) => roads.push({ ax, ay, bx, by });

  if (plan.bases === 4) {
    // Quarter 0 is the top left; base 1 mirrors it left to right, base 2 top to bottom, base 3 both.
    const cx = Math.max(islandR, kit.half + 5) + margin + rand.int(0, 6);
    const cy = Math.max(islandR, kit.behind + 5) + margin + rand.int(0, 6);
    const halfW = Math.min(64, cx + kit.half + channel + rand.int(6, 22));
    const halfH = Math.min(64, cy + kit.front + channel + rand.int(6, 22));
    width = Math.min(128, halfW * 2);
    height = Math.min(128, halfH * 2);
    if (cx + kit.half + channel + 2 >= width / 2 || cy + kit.front + channel + 2 >= height / 2) return null;
    // Kits face south in the top quarters, north in the bottom ones: front towards the middle of the map.
    seats.push({ x: cx, y: cy, south: true }, { x: width - 1 - cx, y: cy, south: true });
    seats.push({ x: cx, y: height - 1 - cy, south: false }, { x: width - 1 - cx, y: height - 1 - cy, south: false });
    island(cx, cy);
    const style = rand.int(0, 3);
    // A road from the lift to each neighbour, and out the back of the base.
    road(cx, cy, width >> 1, cy);
    road(cx, cy - kit.behind - 1, cx, height >> 1);
    // Links to the neighbours across each mirror line: land, or a channel with a bridge over it.
    link(cx, cy, width >> 1, cy);
    link(cx, cy, cx, height >> 1);
    // A bridge on each mirrored link: the top and bottom pairs, or the left and right ones.
    if (style & 1) for (const line of [cy, height - 1 - cy]) bridges.push({ ew: true, line, mid: (width >> 1) - 1, even: true, from: 0, to: height - 1 });
    if (style & 2) for (const line of [cx, width - 1 - cx]) bridges.push({ ew: false, line, mid: (height >> 1) - 1, even: true, from: 0, to: width - 1 });
    // An island in the middle, joined to every base, when nothing is bridged.
    if (style === 0) {
      disc(width >> 1, height >> 1, rand.int(8, 16), 5);
      link(cx, cy, width >> 1, height >> 1);
    }
  } else {
    // Base 1 on the mirror line at the top, facing south; bases 2 and 3 below, mirror images, facing north.
    const dx = Math.max(kit.half + channel + 3, rand.int(27, 42));
    // The three seats make a triangle with equal sides: dy = dx * sqrt(3), rounded.
    const dy = Math.floor((dx * 1732 + 500) / 1000);
    const y0 = Math.max(islandR, kit.behind + 5) + margin + rand.int(0, 3);
    const y1 = y0 + dy;
    const x1 = islandR + margin + rand.int(0, 4);
    const mid = x1 + dx;
    width = mid * 2 + 1;
    height = y1 + Math.max(islandR, kit.behind + 5) + margin + rand.int(0, 3);
    if (width > 128 || height > 128) return null;
    if (y0 + kit.front + 4 >= y1 - kit.front - 4 - linkR) return null;
    seats.push({ x: mid, y: y0, south: true }, { x: x1, y: y1, south: false }, { x: width - 1 - x1, y: y1, south: false });
    island(mid, y0);
    island(x1, y1);
    link(x1, y1, mid, y0);
    link(x1, y1, mid, y1);
    // Roads: along the bottom between bases 2 and 3, out of base 1 towards the middle, and up the slope from
    // base 2 to base 1 in steps.
    road(x1 - kit.half - 1, y1, mid, y1);
    road(mid, y0 - kit.behind - 1, mid, y0 + kit.front + 6);
    road(x1, y1 + kit.behind + 1, x1, y1 - kit.front - 2);
    const steps = 5;
    let px = x1;
    let py = y1 - kit.front - 2;
    for (let k = 1; k <= steps; k++) {
      const qx = x1 + (((mid - x1) * k) / steps | 0);
      const qy = k === steps ? y0 + kit.front + 6 : y1 - kit.front - 2 + (((y0 + kit.front + 6 - (y1 - kit.front - 2)) * k) / steps | 0);
      road(px, py, qx, py);
      road(qx, py, qx, qy);
      px = qx;
      py = qy;
    }
    const style = rand.int(0, 2);
    // The channel runs from below base 1's front down to the bottom edge.
    if (style >= 1) bridges.push({ ew: true, line: y1, mid, even: false, from: y0 + kit.front + linkR + 4, to: height - 1 });
    // A middle island, where the three ways meet.
    if (style !== 1) disc(mid, (y0 + y1 * 2) / 3 | 0, rand.int(7, 13), 5);
  }
  // Islets off the coast, as the originals have: small, and anywhere in the source part.
  for (let k = rand.int(3, 7); k > 0; k--) {
    const sw = plan.bases === 4 ? width >> 1 : width >> 1;
    const sh = plan.bases === 4 ? height >> 1 : height;
    if (sw < 12 || sh < 12) break;
    disc(rand.int(5, sw - 4), rand.int(5, sh - 6), rand.int(2, 4), 2);
  }

  // The source part's coordinates for any tile: the map is drawn once and mirrored, so it comes out symmetric.
  const fold = (x: number, y: number): [number, number] =>
    plan.bases === 4 ? [Math.min(x, width - 1 - x), Math.min(y, height - 1 - y)] : [Math.min(x, width - 1 - x), y];

  // Kit footprints are always land: each block with a ring round it, the pad, and the lift's row and column out
  // to the blocks, so the base holds together however the coast wanders.
  const footprint = new Uint8Array(width * height);
  for (const s of seats) {
    const rects: [number, number, number, number][] = [[-2, -2, 2, 2], [-kit.half, -1, kit.half, 1], [-1, -kit.front, 1, kit.behind]];
    for (const p of kit.items) rects.push([p.x - 2, p.y - 2, p.x + p.block.w + 1, p.y + p.block.h + 1]);
    for (const [kx0, ky0, kx1, ky1] of rects) {
      for (let ky = ky0; ky <= ky1; ky++) {
        for (let kx = kx0; kx <= kx1; kx++) {
          const x = s.x + kx;
          const y = s.y + (s.south ? -ky : ky);
          if (x < 2 || y < 2 || x >= width - 2 || y >= height - 2) return null;
          footprint[y * width + x] = 1;
        }
      }
    }
  }

  // Ground: land where the shapes, roughened by noise, say so; shallows round it; deep water elsewhere.
  const seed = rand.next() & 0xffff;
  // In 32nds of a tile: how far inside the nearest shape's edge, the edge moved by noise.
  const score = (x: number, y: number): number => {
    const [fx, fy] = fold(x, y);
    const n = Math.floor((noise(fx, fy, 11, seed) + noise(fx, fy, 6, seed + 1) + noise(fx, fy, 3, seed + 6) - 382) / 3);
    let best = -4096;
    for (const s of shapes) {
      const vx = s.bx - s.ax;
      const vy = s.by - s.ay;
      const len2 = vx * vx + vy * vy;
      let px = s.ax;
      let py = s.ay;
      if (len2) {
        const t = Math.max(0, Math.min(len2, (fx - s.ax) * vx + (fy - s.ay) * vy));
        px = s.ax + (vx * t) / len2;
        py = s.ay + (vy * t) / len2;
      }
      const d = Math.sqrt((fx - px) * (fx - px) + (fy - py) * (fy - py));
      best = Math.max(best, Math.floor(32 * (s.r - d)) + Math.floor((n * s.rough) / 4));
    }
    return best;
  };
  const terrain = new Uint8Array(width * height).fill(DEEP_TILE);
  const grid = { width, height, terrain };
  const land: number[] = [];
  const shallow: number[] = [];
  const water = new Uint8Array(width * height);
  for (const b of bridges) {
    // The channel the bridge crosses: water across the whole map along the mirror line.
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const along = b.ew ? x : y;
        const across = b.ew ? y : x;
        if (across < b.from || across > b.to) continue;
        const off = b.even ? (along <= b.mid ? b.mid - along : along - b.mid - 1) : Math.abs(along - b.mid);
        // The channel's banks wander by a tile or two along its length.
        if (off < channel + ((noise(across, b.line, 5, seed + 9) * 4) >> 8) - 1) water[y * width + x] = 1;
      }
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const s = score(x, y);
      const edge = x < 2 || y < 2 || x >= width - 2 || y >= height - 2;
      if (footprint[i] || (!edge && !water[i] && s > 0)) land.push(i);
      else if (!edge && !water[i] && s > -64) shallow.push(i);
    }
  }
  paintGround(grid, painter, shallow, SHALLOW, a.land);
  paintGround(grid, painter, land, LAND, a.land);

  // Kits.
  const objects = new Map<number, MapObject>();
  const flagSites: MapPoint[][] = seats.map(() => []);
  const flagAt = new Set<number>();
  const pure = (i: number) => painter.pure(terrain[i]!) === LAND;
  seats.forEach((s, base) => {
    const put = (kx: number, ky: number) => [s.x + kx, s.y + (s.south ? -ky : ky)] as const;
    for (const p of kit.items) {
      const { block } = p;
      for (let by = 0; by < block.h; by++) {
        for (let bx = 0; bx < block.w; bx++) {
          const src = by * block.w + bx;
          const kx = p.x + (p.flip ? block.w - 1 - bx : bx);
          const ky = p.y + by;
          const [x, y] = put(kx, ky);
          const i = y * width + x;
          const t = block.terrain[src]!;
          if (t >= 0 && pure(i)) terrain[i] = turnTerrain(t, p.flip, s.south, data.turned);
        }
      }
      for (const f of block.flags) {
        const [x, y] = put(p.x + (p.flip ? block.w - 1 - f.x : f.x), p.y + f.y);
        flagSites[base]!.push({ x, y });
        flagAt.add(y * width + x);
      }
      for (const o of block.objects) {
        const [x, y] = put(p.x + (p.flip ? block.w - 1 - o.x : o.x), p.y + o.y);
        objects.set(y * width + x, { type: turnType(o.type, p.flip, s.south, names), x, y, base: o.owned ? base : null });
      }
    }
    for (const o of kit.pad) {
      const [x, y] = put(o.x, o.y);
      objects.set(y * width + x, { type: turnType(o.type, false, s.south, names), x, y, base: o.owned ? base : null });
    }
    terrain[s.y * width + s.x] = a.lift[base & 1]!;
  });
  for (const i of flagAt) objects.delete(i);

  // Bridges, with a stretch of road leading on at each end.
  const deck = new Set<number>();
  for (const b of bridges) {
    const at = (along: number) => (b.ew ? b.line * width + along : along * width + b.line);
    const size = b.ew ? width : height;
    // From the mirror line out to the first plain land: that is where the end goes.
    let start = b.even ? b.mid : b.mid - 1;
    while (start >= 0 && !pure(at(start))) start--;
    const end = size - 1 - start;
    if (start < 2 || end - start < 3 || footprint[at(start)]) return null;
    for (let k = start; k <= end; k++) {
      deck.add(at(k));
      objects.delete(at(k));
    }
    terrain[at(start)] = b.ew ? BRIDGE_END.W : BRIDGE_END.N;
    terrain[at(end)] = b.ew ? BRIDGE_END.E : BRIDGE_END.S;
    const road = b.ew ? a.road.ew : a.road.ns;
    for (let k = 1; k <= 4; k++) {
      for (const along of [start - k, end + k]) {
        const i = at(along);
        if (along < 0 || along >= size || !pure(i) || footprint[i] || flagAt.has(i)) break;
        terrain[i] = road;
        objects.delete(i);
        deck.add(i);
      }
    }
  }
  // Roads: each run and its mirror images, on plain land only, then every road tile takes the piece for the sides
  // it has road, a bridge end or a lift on.
  const lifts = new Set(seats.map((s) => s.y * width + s.x));
  const paved = new Set<number>();
  const pave = (x: number, y: number) => {
    const images = plan.bases === 4 ? [[x, y], [width - 1 - x, y], [x, height - 1 - y], [width - 1 - x, height - 1 - y]] : [[x, y], [width - 1 - x, y]];
    for (const [mx, my] of images) {
      if (mx! < 2 || my! < 2 || mx! >= width - 2 || my! >= height - 2) continue;
      const i = my! * width + mx!;
      if (lifts.has(i) || flagAt.has(i) || terrain[i] !== a.land || objects.get(i)?.base != null) continue;
      objects.delete(i);
      paved.add(i);
    }
  };
  for (const r of roads) {
    for (let x = Math.min(r.ax, r.bx); x <= Math.max(r.ax, r.bx); x++) pave(x, r.ay);
    for (let y = Math.min(r.ay, r.by); y <= Math.max(r.ay, r.by); y++) pave(r.bx, y);
  }
  for (const i of deck) if (isRoad(terrain[i]!)) paved.add(i);
  const joins = (i: number) => paved.has(i) || lifts.has(i) || isBridgeEnd(terrain[i]!);
  for (const i of paved) {
    const x = i % width;
    const arms = (joins(i - width) ? 'n' : '') + (x + 1 < width && joins(i + 1) ? 'e' : '') + (joins(i + width) ? 's' : '') + (x > 0 && joins(i - 1) ? 'w' : '');
    // A dead end is a straight piece; the pieces are named with their arms in the tile set's own order.
    const straight = arms === 'n' || arms === 's' ? 'ns' : arms === 'e' || arms === 'w' ? 'we' : arms;
    const piece = ROAD_ARMS.findIndex((p) => p.length === straight.length && [...straight].every((c) => p.includes(c)));
    terrain[i] = piece < 0 ? a.land : ROAD_FIRST + piece;
    if (piece >= 0) deck.add(i);
  }
  settleCoast(grid, painter, a.land);
  // The game has no piece for some coast corners in one orientation but does in another (shore.json lacks some
  // inside corners), so the painter can pick a piece on one side and plain ground on the mirrored side. Such tiles
  // take the plain ground of their three matching corners on every side, so the ground stays the same everywhere.
  const mirrors: Transform[] = plan.bases === 4 ? ['flipX', 'flipY', 'turnHalf'] : ['flipX'];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [fx, fy] = fold(x, y);
      if (fx !== x || fy !== y) continue;
      const i = y * width + x;
      const c = painter.corners[terrain[i]!]!;
      const twins = mirrors.map((t) => {
        const [mx, my] = transformPoint(t, x, y, width, height);
        return { j: my * width + mx, want: transformCorners(t, c) };
      });
      if (twins.every(({ j, want }) => painter.corners[terrain[j]!]!.every((g, k) => g === want[k]))) continue;
      const most = c.find((g) => c.filter((h) => h === g).length >= 3);
      const plain = most === LAND ? a.land : most === SHALLOW ? SHALLOW_TILE : most === DEEP ? DEEP_TILE : null;
      if (plain === null) return null;
      terrain[i] = plain;
      for (const { j } of twins) terrain[j] = plain;
    }
  }

  // Scenery on open land, as thick as the originals have it, the same on mirrored tiles.
  const kinds = a.scenery.filter((k) => transformType('flipX', k.type, names) === k.type && transformType('flipY', k.type, names) === k.type);
  const total = kinds.reduce((n, k) => n + k.count, 0);
  if (total) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (footprint[i] || deck.has(i) || objects.has(i) || flagAt.has(i) || !pure(i) || terrain[i] !== a.land) continue;
        const [fx, fy] = fold(x, y);
        const roll = (hash(fx, fy, seed + 2) << 8) | hash(fx, fy, seed + 3);
        // In groves and clearings, as the originals plant it: about the same in all, thick in places and bare in others.
        const grove = noise(fx, fy, 7, seed + 8);
        const thick = grove > 160 ? 5 : grove > 120 ? 2 : 0;
        if ((roll * 1000) >> 16 >= (a.sceneryPerMille * thick) >> 1) continue;
        let pick = hash(fx, fy, seed + 4) * 256 + hash(fx, fy, seed + 5);
        pick = Math.floor((pick * total) / 65536);
        let kind = kinds[0]!;
        for (const k of kinds) {
          if (pick < k.count) {
            kind = k;
            break;
          }
          pick -= k.count;
        }
        objects.set(i, { type: kind.type, x, y, base: null });
      }
    }
  }
  for (const i of lifts) objects.delete(i);

  const sources = [...new Set(kit.items.map((p) => `"${p.block.sourceName}"`))];
  const n = plan.bases;
  return {
    format: MAP_FORMAT,
    version: MAP_VERSION,
    name: plan.name,
    author: 'Return Fire: Redux',
    source: null,
    width,
    height,
    players: { min: 2, max: n },
    terrain: encodeTerrain(terrain),
    bases: seats.map((s, id) => ({ id, start: { x: s.x, y: s.y }, flagSites: flagSites[id]! })),
    objects: [...objects.keys()].sort((p, q) => p - q).map((i) => objects.get(i)!),
    settings: { vehicles: { tank: null, jeep: null, asv: null, heli: null }, randomMines: null, aiPool: null, music: null },
    description:
      `A ${n}-base map built from pieces of the original two-player maps (${sources.join(', ')}). ` +
      (n === 4 ? 'The four quarters mirror each other' : 'The left and right halves mirror each other and the three bases are the same distance apart') +
      ', so every base has the same compounds and defences.',
  };
}

// ---- From the converted assets -------------------------------------------------------------------------------------

/** Reads a converted assets file by its path in the assets folder (e.g. "maps/index.json"), or null if missing. */
export type AssetFile = (path: string) => Uint8Array | null;

/** An entry of maps/index.json: the Level Selector's and the lobbies' list. */
export interface MapIndexEntry {
  id: string;
  name: string;
  level: number;
  players: { min: number; max: number };
}

/**
 * The built-in 3- and 4-base maps, made from the converted assets: the original maps, buildings, shoreline shapes
 * and the sprite atlas (for which tiles mirror into which). Empty when the assets have no maps.
 */
export function builtInMaps(read: AssetFile, inflate: (data: Uint8Array) => Uint8Array, defs: readonly BuildingDef[], plans: readonly MapPlan[] = MAP_PLANS): GeneratedMap[] {
  const json = <T>(path: string): T | null => {
    const bytes = read(path);
    return bytes ? (JSON.parse(new TextDecoder().decode(bytes)) as T) : null;
  };
  const index = json<MapIndexEntry[]>('maps/index.json');
  const frames = json<{ cel: number; atlas: number; x: number; y: number; w: number; h: number }[]>('sprites/frames.json');
  if (!index?.length || !defs.length) return [];
  const shore = json<ShoreTable>('shore.json');
  const originals: { id: string; map: RfwMap }[] = [];
  for (const e of index) {
    const map = json<RfwMap>(`maps/${e.id}.json`);
    // Only the converted originals: a map with no source is not one.
    if (map?.source) originals.push({ id: e.id, map });
  }
  // Terrain tile pictures 0-127, cut from the atlases.
  const atlases = new Map<number, PngImage | null>();
  const atlas = (k: number) => {
    if (!atlases.has(k)) {
      const bytes = read(`sprites/atlas-${k}.png`);
      atlases.set(k, bytes ? decodePng(bytes, inflate) : null);
    }
    return atlases.get(k)!;
  };
  // Without the sprites, tiles other than coast pieces and bridge ends stay as they are when mirrored.
  const byCel = new Map((frames ?? []).filter((f) => f.cel < 128).map((f) => [f.cel, f]));
  const cel = (t: number): TileCel | null => {
    const f = byCel.get(t);
    const img = f && atlas(f.atlas);
    if (!f || !img) return null;
    const px = new Uint32Array(f.w * f.h);
    for (let y = 0; y < f.h; y++) px.set(img.px.subarray((f.y + y) * img.w + f.x, (f.y + y) * img.w + f.x + f.w), y * f.w);
    return { w: f.w, h: f.h, px };
  };
  const painter = new ShorePainter(shore);
  const data: GenData = { defs, shore, turned: matchTileTransforms(cel, painter) };
  return generateMaps(analyseMaps(originals, data), data, plans);
}

/** The index entries for generated maps, to list after the originals. */
export function generatedIndex(maps: readonly GeneratedMap[]): MapIndexEntry[] {
  return maps.map((g) => ({ id: g.id, name: g.map.name, level: g.level, players: g.map.players }));
}
