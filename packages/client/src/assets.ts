import { buildingDefs, type BuildingDef, type BuildingRecord, type ExplosionOp, type ExplosionScript, type RfwMap, type ShoreTable, type VehicleKind } from '@rfw/sim';
import { extras } from './extras.js';

/** One cel's place in the atlas. `packed` is the cel record's word at +0x34, which is its draw mode. */
interface Frame {
  cel: number;
  atlas: number;
  x: number;
  y: number;
  w: number;
  h: number;
  packed: number;
}

/** A quad model as exported by tools/convert_assets.py: vertices in pixels (z up), faces of four corners. */
export interface Model {
  verts: [number, number, number][];
  /**
   * keep draws only that many sixteenths of the pixels (fading); image replaces the cel (debris colour fades); pair is
   * how far on the Green side's cel is, for a face that is a side's without adding the variant (paint.ts).
   */
  faces: { cel: number; flags: number; cull: [number, number]; v: [number, number, number, number]; keep?: number; image?: Cel; pair?: number }[];
  /** Face draw order for each eighth of a turn, for models drawn by heading sector (sub_41b2b0). */
  sectors?: number[][];
  /** Draw-order lift (model word 8), pixels; missing from assets converted before it was exported. */
  lift?: number;
}

/** One model of a building's chain, drawn as its own object at the building's point plus offset (sub_41afb0). */
export interface BuildingPart {
  model: Model | null;
  offset: [number, number, number];
}

/**
 * Vehicle models from vehicles.json: body plus turret, rotor, shadow, wreck and the helicopter's falling wreck, and the
 * attack drone's body and shadow, and the shots' bodies and shadows (each missing from assets converted before it
 * was added).
 */
type Parts = Partial<Record<'body' | 'turret' | 'rotor' | 'blade' | 'shadow' | 'wreck' | 'falling' | 'wake' | 'float' | 'tyres', Model>>;
export type ShotModel = 'tracer' | 'shell' | 'missile' | 'big';
export type VehicleModels = Record<VehicleKind, Parts> & { drone?: Parts; shots?: Partial<Record<ShotModel, Parts>> };

/** A cel's pixels as 32-bit RGBA (little-endian ABGR); alpha 0 marks colour 0, the transparent colour. */
export interface Cel {
  w: number;
  h: number;
  px: Uint32Array;
  mode: number;
}

/** The cockpit panels and the split screen's post: the art pack's (tools/art/screens.mjs), else the asset pack's. */
export const SCREENS = ['1pbscrl', '2pbscrl', '2pmscr'] as const;
export type ScreenName = (typeof SCREENS)[number];

export interface GameAssets {
  defs: BuildingDef[];
  /** Shoreline shapes for the terrain classifier. */
  shore: ShoreTable;
  screens: Record<ScreenName, Cel>;
  /** Each building's head model (the one its record points to). */
  models: (Model | null)[];
  /** Every model of each building's chain, head first (only the head, unlifted, for older assets). */
  parts: BuildingPart[][];
  /** A destroyed bridge's deck stubs (see variety.ts, bridgeStub), or none for older assets. */
  bridgeStubs: (Model | null)[];
  vehicles: VehicleModels;
  map: RfwMap;
  /** The original's explosions, or null for assets converted before they were exported. */
  effects: EffectsData | null;
  /** Each building's explosion when destroyed (record +0x2c), a key into effects.defs. */
  explosions: (string | null)[];
  /** Bushes, cacti and planters crushed by a vehicle use another (record +0x28, sub_436640). */
  crushExplosions: (string | null)[];
  /** Each building's faces that fly off as debris (see debris.ts). */
  debris: DebrisPiece[][];
  cel(index: number): Cel | undefined;
}

export type { ExplosionOp };

/** An explosion definition (the Expl class, VA 0x44bb70): its script (see @rfw/sim explosions.ts) and its faces. */
export interface ExplosionDef extends ExplosionScript {
  /** Draw-order lift (+0x50), 16.16 pixels. */
  lift: number;
  scale: number;
  scaleZ: boolean;
  verts: [number, number, number][];
  /** Each face shows cel + frame - first from frame first to last, fading from frame fade on; pick groups faces. */
  faces: { cel: number; first: number; last: number; fade: number; pick: number; v: [number, number, number, number] }[];
}

/** A program driving debris pieces (sub_42b290): ops are [opcode, first frame, last frame, 4 arguments]. */
export interface DebrisProgram {
  rate: number;
  frames: number;
  fade: number;
  ops: number[][];
}

/** A model face that flies off as debris: its cel, whether the owner is added, its kind (1-3) and corners, 16.16. */
export interface DebrisPiece {
  cel: number;
  add: boolean;
  kind: number;
  offset: [number, number, number];
  v: [number, number, number][];
}

export interface EffectsData {
  defs: Record<string, ExplosionDef>;
  /** Models the scripts show in place of the explosion's own faces (flashes, the patch a sunk wreck leaves). */
  models: Record<string, Model | null>;
  /** By how a shot ended (0 ground, 1 water, 2 ground of terrain 73-83, 3 an object, 4 a building): guns, others. */
  shots: (string | null)[][];
  mine: string;
  drone: string;
  /** By vehicle: tank, jeep, ASV, helicopter. */
  vehicles: (string | null)[];
  splash: string;
  sunk: string;
  /** Muzzle flashes made on the firing vehicle (missing from older assets). */
  muzzle?: Partial<Record<VehicleKind, string | null>>;
  /** The puffs a death missile trails (missing from older assets). */
  smoke?: string | null;
  /** Debris programs, and the pieces of models a script names itself (each missing from older assets). */
  debris?: Record<string, DebrisProgram>;
  pieces?: Record<string, DebrisPiece[]>;
  /** Explosions for debris landing (sub_42b0e0). */
  debrisLanding?: { land: string; rough: string; water: string[] };
  /**
   * The pieces of a helicopter wreck blowing apart (its body, or its falling wreck model) and of a downed drone, for
   * each eighth of a turn, and the programs for face kinds 1-3: in the air, or for a wreck no higher than 10 px
   * (sub_40c8f0, sub_40a010).
   */
  vehicleDebris?: {
    air: (string | null)[];
    ground: (string | null)[];
    pieces: Record<'heli' | 'heliWreck' | 'drone', DebrisPiece[][]>;
  };
  /** The planks a destroyed bridge throws (sub_436d50): their program and cel (missing from older assets). */
  bridgePlank?: { program: string | null; cel: number };
}

const BASE = '/generated';

async function json<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}/${path}`);
  if (!res.ok) throw new Error(`Missing ${BASE}/${path}. The art pack should have it: run npm run art (see docs/assets.md).`);
  return (await res.json()) as T;
}

async function pixels(path: string, base = BASE): Promise<{ w: number; h: number; data: Uint32Array }> {
  const img = new Image();
  img.src = `${base}/${path}`;
  await img.decode();
  const canvas = new OffscreenCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, img.width, img.height).data;
  return { w: img.width, h: img.height, data: new Uint32Array(data.buffer.slice(0)) };
}

/** A map in maps/index.json: the Level Selector's list (level 1-9 from the original's own grouping). */
export interface MapEntry {
  id: string;
  name: string;
  level: number;
  players: { min: number; max: number };
}

let index: Promise<MapEntry[]> | null = null;

/** Every converted map, by level then id; empty for assets converted before the index was written. */
export function loadMapIndex(): Promise<MapEntry[]> {
  index ??= json<MapEntry[]>('maps/index.json').catch(() => []);
  return index;
}

/** One of the original's full-screen pictures (title, logos, pause, banners), or null if it was not imported. */
export async function loadPicture(name: string): Promise<HTMLImageElement | null> {
  const img = new Image();
  img.src = `${BASE}/screens/${name}.png`;
  try {
    await img.decode();
    return img;
  } catch {
    return null;
  }
}

/**
 * The art pack: this project's own sprites (assets/art, built by `npm run art`), drawn in place of the asset pack's
 * cels of the same number. ?art=0 in the address leaves it out, to compare with the pack underneath.
 */
const ART = '/art/pack';
const artWanted = (): boolean => new URLSearchParams(globalThis.location?.search ?? '').get('art') !== '0';

/** How many of the art pack's sprites are in use (0 without one, or with ?art=0), for System Info. */
export let artSprites = 0;

async function loadArt(cels: Map<number, Cel>): Promise<void> {
  artSprites = 0;
  if (!artWanted()) return;
  let frames: (Omit<Frame, 'packed'> & { packed?: number })[];
  try {
    const res = await fetch(`${ART}/sprites/frames.json`);
    if (!res.ok) return;
    frames = (await res.json()) as typeof frames;
  } catch {
    return;
  }
  if (!frames.length) return;
  const count = Math.max(...frames.map((f) => f.atlas)) + 1;
  const atlases = await Promise.all(Array.from({ length: count }, (_, i) => pixels(`sprites/atlas-${i}.png`, ART).catch(() => null)));
  for (const f of frames) {
    const atlas = atlases[f.atlas];
    if (!atlas) continue;
    const px = new Uint32Array(f.w * f.h);
    for (let y = 0; y < f.h; y++) px.set(atlas.data.subarray((f.y + y) * atlas.w + f.x, (f.y + y) * atlas.w + f.x + f.w), y * f.w);
    // The draw mode stays the pack's unless the art names its own.
    cels.set(f.cel, { w: f.w, h: f.h, px, mode: f.packed ?? cels.get(f.cel)?.mode ?? 0 });
    artSprites++;
  }
}

/**
 * One of the model and number tables (buildings, vehicles, effects, shore): the art pack's own when it has one
 * (tools/art/models), else the asset pack's. ?art=0 does not change this: the tables shape the match itself, and
 * every player in one must use the same.
 */
async function table<T>(path: string): Promise<T> {
  try {
    const res = await fetch(`${ART}/${path}`);
    if (res.ok) return (await res.json()) as T;
  } catch {
    // No art pack: the asset pack's table.
  }
  return json<T>(path);
}

export type GameData = Omit<GameAssets, 'map'>;
type Common = GameData;
let common: Promise<Common> | null = null;

/** Everything but the map, loaded once and shared by every match (and the level editor). */
export function loadCommon(): Promise<Common> {
  common ??= loadCommonOnce().catch((err: unknown) => {
    common = null;
    throw err;
  });
  return common;
}

export async function loadAssets(mapId: string): Promise<GameAssets> {
  const [c, map] = await Promise.all([loadCommon(), loadMap(mapId)]);
  return { ...c, map };
}

/** The assets with a map handed over whole (online matches send theirs, which may be a custom map). */
export async function loadAssetsWith(map: RfwMap): Promise<GameAssets> {
  return { ...(await loadCommon()), map };
}

/** One of the converted original maps, by its id in maps/index.json. */
export function loadMap(mapId: string): Promise<RfwMap> {
  return json<RfwMap>(`maps/${mapId}.json`);
}

async function loadCommonOnce(): Promise<Common> {
  const [frames, buildings, vehicles, shore, effects] = await Promise.all([
    // Every sprite is the art pack's, unless the extras folder holds an older pack's to draw under them.
    extras().then((have) => (have.has('sprites/frames.json') ? json<Frame[]>('sprites/frames.json').catch(() => [] as Frame[]) : ([] as Frame[]))),
    table<BuildingTable>('buildings.json'),
    table<VehicleModels>('vehicles.json'),
    table<ShoreTable>('shore.json'),
    table<EffectsData>('effects.json').catch(() => null),
  ]);
  const screens = Object.fromEntries(
    await Promise.all(SCREENS.map(async (name) => {
      const { w, h, data } = await pixels(`screens/${name}.png`, ART).catch(() => pixels(`screens/${name}.png`));
      return [name, { w, h, px: data, mode: 0 }] as const;
    })),
  ) as Record<ScreenName, Cel>;
  const atlasCount = Math.max(-1, ...frames.map((f) => f.atlas)) + 1;
  const atlases = await Promise.all(Array.from({ length: atlasCount }, (_, i) => pixels(`sprites/atlas-${i}.png`)));
  const cels = new Map<number, Cel>();
  for (const f of frames) {
    const atlas = atlases[f.atlas];
    if (!atlas) continue;
    const px = new Uint32Array(f.w * f.h);
    for (let y = 0; y < f.h; y++) px.set(atlas.data.subarray((f.y + y) * atlas.w + f.x, (f.y + y) * atlas.w + f.x + f.w), y * f.w);
    cels.set(f.cel, { w: f.w, h: f.h, px, mode: f.packed });
  }
  await loadArt(cels);
  return assemble({ buildings, vehicles, shore, effects, screens, cels });
}

/** The building table as the packs hold it: each record with its models, stubs and debris. */
export type BuildingTable = (BuildingRecord & { model: Model | null; parts?: BuildingPart[]; stubs?: (Model | null)[]; debris?: DebrisPiece[] })[];

/** The game's assets, bar the map, from a pack's tables, pictures and sprites once they are read. */
export function assemble(pack: { buildings: BuildingTable; vehicles: VehicleModels; shore: ShoreTable; effects: EffectsData | null; screens: Record<ScreenName, Cel>; cels: Map<number, Cel> }): Common {
  const { buildings, vehicles, shore, effects, screens, cels } = pack;
  return { defs: buildingDefs(buildings, effects?.defs), shore, screens, models: buildings.map((b) => b.model),
    parts: buildings.map((b) => b.parts ?? [{ model: b.model, offset: [0, 0, 0] }]),
    bridgeStubs: buildings.find((b) => b.stubs)?.stubs ?? [], vehicles, effects,
    explosions: buildings.map((b) => b.explosion ?? null), crushExplosions: buildings.map((b) => b.crushExplosion ?? null), debris: buildings.map((b) => b.debris ?? []), cel: (i) => cels.get(i),
  };
}
