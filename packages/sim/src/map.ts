// Map files in the rfw-map format (docs/map-format.md). Original .RFM maps are converted to it by
// tools/convert_assets.py; the level editor will write the same format.

import { BUILDING, type BuildingDef } from './buildings.js';
import type { Body } from './collide.js';
import { MsvcRand } from './rng.js';
import type { ShoreTable } from './shore.js';

export const MAP_FORMAT = 'rfw-map';
/** The version new maps are written in. Version 1 files (the converted originals) still load unchanged. */
export const MAP_VERSION = 2;
export const MAX_BASES = 4;
export const MAX_NAME = 64;
export const MAX_DESCRIPTION = 2000;
export const MAX_NOTES = 200;

export interface MapPoint {
  x: number;
  y: number;
}

/** One base: a player slot. The lobby assigns each base to a team. */
export interface MapBase {
  id: number;
  start: MapPoint;
  /** Buildings the flag can be hidden in. One is picked at random when the match starts. */
  flagSites: MapPoint[];
  /** Version 2: this base's own vehicle counts, over the map's settings.vehicles. Missing or null fields use those. */
  vehicles?: Partial<VehicleCounts> | null;
}

export interface VehicleCounts {
  tank: number | null;
  jeep: number | null;
  asv: number | null;
  heli: number | null;
}

export interface MapObject {
  /** Building type name from the original BNO_ table, e.g. "BUNKER_N". */
  type: string;
  x: number;
  y: number;
  /** Owning base id, or null for neutral scenery. */
  base: number | null;
}

/** Per-map overrides. A null value means the game default (see docs/map-format.md). */
export interface MapSettings {
  vehicles: VehicleCounts;
  randomMines: number | null;
  aiPool: number | null;
  /** Version 2: the music track to play, by id, or null for the game's choice. */
  music?: string | null;
}

/** Who can see a map in the map library: only its author, anyone with the link, or everyone. */
export type MapVisibility = 'private' | 'unlisted' | 'public';
export const VISIBILITIES: readonly MapVisibility[] = ['private', 'unlisted', 'public'];

/** An editor note pinned to a tile. Notes are for the map's authors and never affect a match. */
export interface MapNote {
  x: number;
  y: number;
  text: string;
}

/** Where a converted original 2-player map came from. */
export interface MapSource {
  file: string;
  level: number | null;
  /** Seed for the scenery offsets: the sum of the original map's tile codes. */
  scenerySeed?: number;
}

export interface RfwMap {
  format: typeof MAP_FORMAT;
  version: number;
  name: string;
  author: string;
  /** Set for maps converted from the original game. */
  source: MapSource | null;
  width: number;
  height: number;
  /** Player slots the map supports, at most one per base. Converted originals are 2 to 2. */
  players: { min: number; max: number };
  /** Base64 of width * height bytes, row by row: terrain sprite index 0-127, or 255 for none. */
  terrain: string;
  bases: MapBase[];
  objects: MapObject[];
  settings: MapSettings;
  // Version 2 fields, all optional. The map library sets id, authorId, visibility and revision; on upload the
  // server keeps its own values for those, so they only matter in exported files.
  description?: string;
  id?: string | null;
  authorId?: string | null;
  visibility?: MapVisibility;
  revision?: number;
  /** The editor's notes layer. */
  notes?: MapNote[];
}

export interface Placement {
  building: number;
  base: number | null;
  tx: number;
  ty: number;
}

export interface World {
  name: string;
  width: number;
  height: number;
  /** Terrain sprite index per tile (grid bits 0-6 in the original). */
  terrain: Uint8Array;
  /** Building id per tile, 0 for none (grid bits 7-13). */
  building: Uint8Array;
  /** Owning base per tile, -1 for neutral (grid bits 14-15). */
  owner: Int8Array;
  /** Building hit points per tile, 0 for indestructible or none (grid bits 25-27). */
  hp: Uint8Array;
  /** The building table, indexed by building id. */
  defs: readonly BuildingDef[];
  /** Shoreline shapes from the game data (shore.json), or null to treat shoreline tiles as land. */
  shore: ShoreTable | null;
  /** Buildings as placed at load, for renderers that draw them once. */
  buildings: Placement[];
  /** Scenery offsets: 256 entries of x then y, whole pixels, -12 to 12 (see sceneryOffsets). */
  scenery: Int8Array;
  /** The scenery table's fourth byte for each entry, 0-255 (see sceneryVariety and tileVariety). */
  variety: Uint8Array;
  bases: { id: number; start: { tx: number; ty: number }; flagSites: { tx: number; ty: number }[] }[];
}

export const GRID = 128;
export const NO_TERRAIN = 255;
const WATER = 2;

/** Open water terrain. Shoreline tiles are classified point by point; see shore.ts. */
export const WATER_TERRAIN = new Set([WATER]);

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function encodeTerrain(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1] ?? 0;
    const c = bytes[i + 2] ?? 0;
    const n = (a << 16) | (b << 8) | c;
    out += B64[n >> 18]! + B64[(n >> 12) & 63]!;
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63]! : '=';
    out += i + 2 < bytes.length ? B64[n & 63]! : '=';
  }
  return out;
}

export function decodeTerrain(text: string): Uint8Array {
  const clean = text.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    let n = 0;
    for (let k = 0; k < 4; k++) {
      const ch = clean[i + k];
      const v = ch === undefined ? 0 : B64.indexOf(ch);
      if (v < 0) throw new Error(`Terrain has an invalid character "${ch}"`);
      n = (n << 6) | v;
    }
    if (o < out.length) out[o++] = n >> 16;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

/** A vehicle count: null for the default, a whole number 0-99, or 255 for unlimited (the original's 0xFF). */
const count = (n: unknown) => n === null || n === undefined || n === 255 || (Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 99);

/** Throws with a readable message if the map breaks the format's rules. */
export function validateMap(map: RfwMap): void {
  const fail = (msg: string): never => {
    throw new Error(`Map "${map.name}": ${msg}`);
  };
  if (map.format !== MAP_FORMAT) fail(`format is "${map.format}", expected "${MAP_FORMAT}"`);
  if (map.version !== 1 && map.version !== MAP_VERSION) fail(`version ${map.version} is not supported`);
  if (!Number.isInteger(map.width) || !Number.isInteger(map.height) || map.width < 1 || map.height < 1 || map.width > GRID || map.height > GRID) {
    fail(`size ${map.width}x${map.height} is outside 1-${GRID}`);
  }
  const terrain = decodeTerrain(map.terrain);
  if (terrain.length !== map.width * map.height) fail('terrain does not match the map size');
  if (terrain.some((t) => t > 127 && t !== NO_TERRAIN)) fail('terrain has a value above 127');
  if (map.bases.length < 1 || map.bases.length > MAX_BASES) fail(`has ${map.bases.length} bases, expected 1-${MAX_BASES}`);
  const inside = (p: MapPoint) => p.x >= 0 && p.y >= 0 && p.x < map.width && p.y < map.height;
  map.bases.forEach((b, i) => {
    if (b.id !== i) fail(`base ${i} has id ${b.id}`);
    if (!b.start || !inside(b.start)) fail(`base ${i} needs a start point inside the map`);
    if (b.flagSites.some((p) => !inside(p))) fail(`base ${i} has a flag site outside the map`);
    if (b.vehicles) for (const [k, n] of Object.entries(b.vehicles)) if (!count(n)) fail(`base ${i} has a bad ${k} count`);
  });
  for (const [k, n] of Object.entries(map.settings.vehicles)) if (!count(n)) fail(`has a bad ${k} count`);
  if (map.name.length > MAX_NAME) fail(`name is longer than ${MAX_NAME} characters`);
  if ((map.description?.length ?? 0) > MAX_DESCRIPTION) fail(`description is longer than ${MAX_DESCRIPTION} characters`);
  if (map.visibility !== undefined && !VISIBILITIES.includes(map.visibility)) fail(`visibility "${map.visibility}" is not one of ${VISIBILITIES.join(', ')}`);
  if ((map.notes?.length ?? 0) > MAX_NOTES) fail(`has more than ${MAX_NOTES} notes`);
  if (map.notes?.some((n) => !inside(n))) fail('has a note outside the map');
  if (map.players.min < 1 || map.players.min > map.players.max || map.players.max > map.bases.length) {
    fail(`players ${map.players.min}-${map.players.max} does not fit its ${map.bases.length} bases`);
  }
  for (const o of map.objects) {
    if (!inside(o)) fail(`${o.type} at ${o.x},${o.y} is outside the map`);
    if (o.base !== null && !map.bases[o.base]) fail(`${o.type} belongs to missing base ${o.base}`);
  }
}

/** Puts a building on a tile the way sub_42e4f0 does: its own terrain, its hit points and its owner. */
export function placeBuilding(world: World, i: number, id: number, base: number | null): void {
  const def = world.defs[id];
  if (!def) throw new Error(`Unknown building id ${id}`);
  if (def.placeTerrain !== null) world.terrain[i] = def.flags === 8 ? def.placeTerrain + (base ?? 0) : def.placeTerrain;
  world.building[i] = id;
  world.hp[i] = def.hp;
  world.owner[i] = base ?? -1;
}

/**
 * Lays a map out on the 128 x 128 world grid. Smaller maps are centred, as the original does.
 * defs is the building table in order, so a name's index is its building id; shore is the shoreline shapes.
 */
export function buildWorld(map: RfwMap, defs: readonly BuildingDef[], shore: ShoreTable | null = null): World {
  validateMap(map);
  const ox = (GRID - map.width) >> 1;
  const oy = (GRID - map.height) >> 1;
  const src = decodeTerrain(map.terrain);
  // The original fills the grid with open water before loading a map.
  const terrain = new Uint8Array(GRID * GRID).fill(WATER);
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) terrain[(y + oy) * GRID + x + ox] = src[y * map.width + x]!;
  }
  const world: World = {
    name: map.name,
    width: GRID,
    height: GRID,
    terrain,
    building: new Uint8Array(GRID * GRID),
    owner: new Int8Array(GRID * GRID).fill(-1),
    hp: new Uint8Array(GRID * GRID),
    defs,
    shore,
    buildings: [],
    scenery: sceneryOffsets(map.source?.scenerySeed ?? 0),
    variety: sceneryVariety(map.source?.scenerySeed ?? 0),
    bases: [],
  };
  const ids = new Map(defs.map((d) => [d.name, d.id]));
  for (const o of map.objects) {
    const id = ids.get(o.type);
    if (id === undefined) throw new Error(`Map "${map.name}": unknown building type ${o.type}`);
    placeBuilding(world, (o.y + oy) * GRID + o.x + ox, id, o.base);
  }
  for (const b of map.bases) {
    const flagSites = b.flagSites.map((p) => ({ tx: p.x + ox, ty: p.y + oy }));
    if (ids.has('FLAG')) for (const p of flagSites) placeBuilding(world, p.ty * GRID + p.tx, BUILDING.FLAG, b.id);
    world.bases.push({ id: b.id, start: { tx: b.start.x + ox, ty: b.start.y + oy }, flagSites });
  }
  if (defs.length > BUILDING.BRIDGE_V) addBridges(world);
  for (let i = 0; i < GRID * GRID; i++) {
    const id = world.building[i]!;
    if (id) world.buildings.push({ building: id, base: world.owner[i]! < 0 ? null : world.owner[i]!, tx: i % GRID, ty: (i / GRID) | 0 });
  }
  return world;
}

const BRIDGE_W = 84;
const BRIDGE_E = 85;
const BRIDGE_N = 86;
const BRIDGE_S = 87;

/**
 * The original loader (sub_414130) builds bridges after reading the tiles: every tile between a terrain 84
 * and the next 85 to its east gets building 74, and every tile between an 86 and the next 87 to its south
 * gets building 75. The bridge takes the owner of the tile it starts from.
 */
function addBridges(world: World): void {
  const t = world.terrain;
  const end = GRID * GRID;
  for (let i = 0; i < end; i++) {
    const owner = world.owner[i]! < 0 ? null : world.owner[i]!;
    if ((t[i]! & 127) === BRIDGE_W) {
      for (let j = i + 1; j < end && (t[j]! & 127) !== BRIDGE_E; j++) placeBuilding(world, j, BUILDING.BRIDGE_H, owner);
    }
    if ((t[i]! & 127) === BRIDGE_N) {
      for (let j = i + GRID; j < end && (t[j]! & 127) !== BRIDGE_S; j += GRID) placeBuilding(world, j, BUILDING.BRIDGE_V, owner);
    }
  }
}

/**
 * The scenery offsets (sub_436540): with the C runtime's rand() seeded from the map, 256 entries of x and y offset
 * (-12 to 12 px) and two more draws the renderer uses (0-10 and 0-255), which are drawn here only to keep the
 * sequence. A bush, palm or rock sits off its tile's centre by the entry for its tile's position modulo 16.
 */
export function sceneryOffsets(seed: number): Int8Array {
  const r = new MsvcRand(seed);
  const out = new Int8Array(512);
  for (let i = 0; i < 256; i++) {
    out[i * 2] = r.below(25) - 12;
    out[i * 2 + 1] = r.below(25) - 12;
    r.below(11);
    r.below(256);
  }
  return out;
}

/**
 * The last of each scenery entry's four draws (0-255): several buildings take a look from it, such as which way
 * rubble is turned, and a gun tower takes its aim before it wakes (see tileVariety).
 */
export function sceneryVariety(seed: number): Uint8Array {
  const r = new MsvcRand(seed);
  const out = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    r.below(25);
    r.below(25);
    r.below(11);
    out[i] = r.below(256);
  }
  return out;
}

/**
 * The scenery entry sub_42e4c0 gives tile i. It indexes the table from the tile's grid index (y * 128 + x), so its
 * row comes from bits 5-8 of that index, two bits of x and two of y, not from y modulo 16 as the offsets do.
 */
export function sceneryEntry(i: number): number {
  return (i & 15) + ((i & 0x1e0) >> 1);
}

/** The variety byte for tile i (scenery entry byte 3, via sub_42e4c0). */
export function tileVariety(world: World, i: number): number {
  return world.variety[sceneryEntry(i)]!;
}

/** Where the building on tile i stands, for collision: its tile's centre, moved by the scenery offsets (sub_4365c0). */
export function buildingBody(world: World, i: number): Body {
  const tx = i % world.width;
  const ty = (i / world.width) | 0;
  let x = (tx << 21) + (1 << 20);
  let y = (ty << 21) + (1 << 20);
  if (world.defs[world.building[i]!]?.jitter) {
    const e = ((ty & 15) << 4) + (tx & 15);
    x += world.scenery[e * 2]! << 16;
    y += world.scenery[e * 2 + 1]! << 16;
  }
  return { x, y, z: 0, heading: 0 };
}

export function terrainAt(world: World, tx: number, ty: number): number {
  if (tx < 0 || ty < 0 || tx >= world.width || ty >= world.height) return NO_TERRAIN;
  return world.terrain[ty * world.width + tx]!;
}
