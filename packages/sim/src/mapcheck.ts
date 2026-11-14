// Checks a map before it can be played or shared: the format's rules (validateMap), and whether a match on it can
// work: every base has a lift on open land with a way off it and somewhere to hide its flag, bridges have both ends,
// every base has jeeps, and a jeep can reach every other base's flag. The editor shows each problem on the map; the server refuses to
// share a map with errors.

import { stopsVehicle, type BuildingDef } from './buildings.js';
import { GATE_H, GATE_V } from './gates.js';
import {
  GRID, MAP_FORMAT, MAX_BASES, VISIBILITIES, buildWorld, decodeTerrain, validateMap,
  type MapPoint, type RfwMap, type World,
} from './map.js';
import { BRIDGE_END } from './mapedit.js';
import { settingLives } from './match.js';
import { DEEP, LAND, groundAt, type ShoreTable } from './shore.js';
import { hasDeepWater } from './vehicle.js';

export type ProblemLevel = 'error' | 'warning';

export interface MapProblem {
  /** An error stops the map being played or shared; a warning is worth a look. */
  level: ProblemLevel;
  /** A stable name for the kind of problem, e.g. "lift-blocked". */
  code: string;
  message: string;
  /** The tiles it is about, in map coordinates. */
  tiles: MapPoint[];
  base?: number;
}

/** More flag sites than this for one base is allowed but probably a mistake. */
export const MANY_FLAG_SITES = 16;

const label = (base: number) => `Base ${base + 1}`;

/** Every problem with the map, errors first. defs is the building table; shore the shoreline shapes, if loaded. */
export function checkMap(map: RfwMap, defs: readonly BuildingDef[], shore: ShoreTable | null = null): MapProblem[] {
  const out: MapProblem[] = [];
  const add = (level: ProblemLevel, code: string, message: string, tiles: MapPoint[] = [], base?: number) =>
    out.push({ level, code, message, tiles, ...(base === undefined ? {} : { base }) });

  if (!map.bases?.length) {
    add('error', 'no-bases', 'Place at least one base: a start point (its lift) and a flag site.');
    return out;
  }
  try {
    validateMap(map);
  } catch (err) {
    add('error', 'format', (err as Error).message.replace(/^Map "[^"]*": /, ''));
    return out;
  }
  const names = new Map(defs.map((d) => [d.name, d]));
  const unknown = map.objects.filter((o) => !names.has(o.type));
  if (unknown.length) {
    add('error', 'unknown-type', `Unknown building types: ${[...new Set(unknown.map((o) => o.type))].join(', ')}.`, unknown.map(({ x, y }) => ({ x, y })));
    return out;
  }

  const w = map.width;
  const at = (p: MapPoint) => p.y * w + p.x;
  const objectAt = new Map<number, number>();
  const stacked: MapPoint[] = [];
  map.objects.forEach((o, k) => {
    if (objectAt.has(at(o))) stacked.push({ x: o.x, y: o.y });
    objectAt.set(at(o), k);
  });
  if (stacked.length) add('warning', 'stacked', 'Some tiles have more than one building; only the last one is kept.', stacked);

  // Bridges: the loader lays deck from each west end to the next east end, and each north end to the next south
  // end, running on past the end of the row or column, so an end without its partner floods the map with deck.
  const terrain = decodeTerrain(map.terrain);
  const open: MapPoint[] = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < w; x++) {
      const t = terrain[y * w + x]! & 127;
      if (t === BRIDGE_END.W) {
        let k = x + 1;
        while (k < w && (terrain[y * w + k]! & 127) !== BRIDGE_END.E) k++;
        if (k >= w) open.push({ x, y });
      } else if (t === BRIDGE_END.N) {
        let k = y + 1;
        while (k < map.height && (terrain[k * w + x]! & 127) !== BRIDGE_END.S) k++;
        if (k >= map.height) open.push({ x, y });
      }
    }
  }
  if (open.length) add('error', 'bridge-open', 'A bridge has no far end (east of a west end, or south of a north end).', open);

  let world: World;
  try {
    world = buildWorld(map, defs, shore);
  } catch (err) {
    add('error', 'format', (err as Error).message.replace(/^Map "[^"]*": /, ''));
    return sorted(out);
  }
  const ox = (GRID - map.width) >> 1;
  const oy = (GRID - map.height) >> 1;
  const toWorld = (p: MapPoint) => (p.y + oy) * GRID + p.x + ox;
  const centre = (i: number) => [((i % GRID) << 21) + (1 << 20), (Math.floor(i / GRID) << 21) + (1 << 20)] as const;
  const groundOf = (i: number) => groundAt(world, ...centre(i));

  // Tiles a ground vehicle can cross, or clear by shooting: anything that stops it but can be destroyed.
  const crossable = (i: number, jeep: boolean) => {
    const x = i % GRID;
    const y = (i - x) / GRID;
    if (hasDeepWater(world, x, y)) return false;
    const b = world.building[i]!;
    if (!b || b === GATE_H || b === GATE_V) return true;
    const def = world.defs[b]!;
    return !stopsVehicle(def, jeep) || world.hp[i]! > 0;
  };

  const starts = new Map<number, number>();
  const sites = new Map<number, number>();
  map.bases.forEach((b, id) => {
    const s = toWorld(b.start);
    if (starts.has(s)) add('error', 'start-shared', `${label(id)} starts on the same tile as ${label(starts.get(s)!)}.`, [b.start], id);
    starts.set(s, id);
    if (objectAt.has(at(b.start))) add('error', 'lift-blocked', `${label(id)}'s lift has a building on it.`, [b.start], id);
    else if (groundOf(s) !== LAND) add('error', 'lift-water', `${label(id)}'s lift is in the water; put it on land.`, [b.start], id);
    else {
      const exits = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => {
        const x = b.start.x + dx!;
        const y = b.start.y + dy!;
        return x >= 0 && y >= 0 && x < map.width && y < map.height && crossable(toWorld({ x, y }), false);
      });
      if (!exits.length) add('error', 'lift-boxed', `Vehicles can't drive off ${label(id)}'s lift.`, [b.start], id);
    }
    // A base with no jeeps is out as soon as the match starts.
    if (settingLives(map, id).jeep === 0) add('error', 'no-jeeps', `${label(id)} has no jeeps, so it would be out at the start.`, [b.start], id);
    if (!b.flagSites.length) add('error', 'no-flag', `${label(id)} needs a flag site.`, [b.start], id);
    if (b.flagSites.length > MANY_FLAG_SITES) add('warning', 'many-flags', `${label(id)} has ${b.flagSites.length} flag sites.`, [], id);
    for (const p of b.flagSites) {
      const i = toWorld(p);
      if (sites.has(i) && sites.get(i) !== id) add('error', 'flag-shared', `${label(id)} and ${label(sites.get(i)!)} share a flag site.`, [p], id);
      else if (sites.has(i)) add('warning', 'flag-twice', `${label(id)} lists the same flag site twice.`, [p], id);
      sites.set(i, id);
      if (i === s) add('error', 'flag-on-lift', `${label(id)}'s flag site is on its lift.`, [p], id);
      if (objectAt.has(at(p))) add('warning', 'flag-covers', `${label(id)}'s flag site replaces the building under it.`, [p], id);
      if (groundOf(i) === DEEP) add('error', 'flag-water', `${label(id)}'s flag site is in deep water.`, [p], id);
    }
  });
  for (const [i, id] of sites) {
    if (starts.has(i) && starts.get(i) !== id) {
      add('error', 'flag-on-lift', `${label(id)}'s flag site is on ${label(starts.get(i)!)}'s lift.`, [fromWorld(i, ox, oy)], id);
    }
  }

  // Can a jeep from each base get to every other base's flag? Buildings that can be destroyed count as open, since
  // a tank can clear them.
  if (map.bases.length > 1 && !out.some((p) => p.level === 'error')) {
    for (const a of map.bases) {
      const reach = flood(toWorld(a.start), (i) => crossable(i, true));
      for (const b of map.bases) {
        if (b.id === a.id) continue;
        const ok = b.flagSites.some((p) => {
          const i = toWorld(p);
          // The flag building itself is solid; reaching a tile next to it is enough.
          return reach[i] || neighbours(i).some((n) => reach[n]);
        });
        if (!ok) {
          add('warning', 'unreachable', `A jeep from ${label(a.id)} can't reach ${label(b.id)}'s flag, so ${label(b.id)} can only be beaten by destroying all its jeeps.`, [b.start, ...b.flagSites], b.id);
        }
      }
    }
  }
  return sorted(out);
}

function sorted(list: MapProblem[]): MapProblem[] {
  return list.sort((a, b) => (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1));
}

function fromWorld(i: number, ox: number, oy: number): MapPoint {
  return { x: (i % GRID) - ox, y: Math.floor(i / GRID) - oy };
}

function neighbours(i: number): number[] {
  const x = i % GRID;
  const out: number[] = [];
  if (x > 0) out.push(i - 1);
  if (x < GRID - 1) out.push(i + 1);
  if (i >= GRID) out.push(i - GRID);
  if (i < GRID * (GRID - 1)) out.push(i + GRID);
  return out;
}

/** The tiles reachable from start through tiles that pass, moving between edge neighbours. */
function flood(start: number, pass: (i: number) => boolean): Uint8Array {
  const seen = new Uint8Array(GRID * GRID);
  const queue = [start];
  seen[start] = 1;
  while (queue.length) {
    const i = queue.pop()!;
    for (const n of neighbours(i)) {
      if (seen[n] || !pass(n)) continue;
      seen[n] = 1;
      queue.push(n);
    }
  }
  return seen;
}

/** Only the errors: a map with none can be played and shared. */
export function mapErrors(map: RfwMap, defs: readonly BuildingDef[], shore: ShoreTable | null = null): MapProblem[] {
  return checkMap(map, defs, shore).filter((p) => p.level === 'error');
}

/**
 * Reads a map from untrusted JSON (an imported file or an upload): checks every field's type, then the format's
 * rules, and returns a clean copy holding only the format's fields. Throws with a readable message.
 */
export function parseMap(json: unknown): RfwMap {
  const fail = (msg: string): never => {
    throw new Error(`Not a valid map: ${msg}`);
  };
  const obj = (v: unknown, what: string) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : fail(`${what} is not an object`));
  const arr = (v: unknown, what: string) => (Array.isArray(v) ? v : fail(`${what} is not a list`));
  const int = (v: unknown, what: string) => (Number.isInteger(v) ? (v as number) : fail(`${what} is not a whole number`));
  const str = (v: unknown, what: string) => (typeof v === 'string' ? v : fail(`${what} is not text`));
  const optInt = (v: unknown, what: string) => (v === null || v === undefined ? null : int(v, what));
  const point = (v: unknown, what: string): MapPoint => {
    const p = obj(v, what);
    return { x: int(p.x, `${what}.x`), y: int(p.y, `${what}.y`) };
  };
  const counts = (v: unknown, what: string) => {
    const c = obj(v, what);
    return { tank: optInt(c.tank, `${what}.tank`), jeep: optInt(c.jeep, `${what}.jeep`), asv: optInt(c.asv, `${what}.asv`), heli: optInt(c.heli, `${what}.heli`) };
  };

  const m = obj(json, 'the file');
  if (m.format !== MAP_FORMAT) fail(`format is not "${MAP_FORMAT}"`);
  const bases = arr(m.bases, 'bases');
  if (bases.length > MAX_BASES) fail(`it has more than ${MAX_BASES} bases`);
  const settings = obj(m.settings, 'settings');
  const players = obj(m.players, 'players');
  const source = m.source === null || m.source === undefined ? null : obj(m.source, 'source');
  const map: RfwMap = {
    format: MAP_FORMAT,
    version: int(m.version, 'version'),
    name: str(m.name, 'name'),
    author: str(m.author ?? '', 'author'),
    source: source && {
      file: str(source.file, 'source.file'),
      level: optInt(source.level, 'source.level'),
      ...(source.scenerySeed === undefined ? {} : { scenerySeed: int(source.scenerySeed, 'source.scenerySeed') }),
    },
    width: int(m.width, 'width'),
    height: int(m.height, 'height'),
    players: { min: int(players.min, 'players.min'), max: int(players.max, 'players.max') },
    terrain: str(m.terrain, 'terrain'),
    bases: bases.map((v, i) => {
      const b = obj(v, `base ${i}`);
      return {
        id: int(b.id, `base ${i} id`),
        start: point(b.start, `base ${i} start`),
        flagSites: arr(b.flagSites, `base ${i} flagSites`).map((p, k) => point(p, `base ${i} flag site ${k}`)),
        ...(b.vehicles === undefined || b.vehicles === null ? {} : { vehicles: counts(b.vehicles, `base ${i} vehicles`) }),
      };
    }),
    objects: arr(m.objects, 'objects').map((v, i) => {
      const o = obj(v, `object ${i}`);
      return { type: str(o.type, `object ${i} type`), x: int(o.x, `object ${i} x`), y: int(o.y, `object ${i} y`), base: optInt(o.base, `object ${i} base`) };
    }),
    settings: {
      vehicles: counts(settings.vehicles, 'settings.vehicles'),
      randomMines: optInt(settings.randomMines, 'settings.randomMines'),
      aiPool: optInt(settings.aiPool, 'settings.aiPool'),
      ...(settings.music === undefined ? {} : { music: settings.music === null ? null : str(settings.music, 'settings.music') }),
    },
  };
  if (m.description !== undefined) map.description = str(m.description, 'description');
  if (m.id !== undefined) map.id = m.id === null ? null : str(m.id, 'id');
  if (m.authorId !== undefined) map.authorId = m.authorId === null ? null : str(m.authorId, 'authorId');
  if (m.visibility !== undefined) {
    const v = str(m.visibility, 'visibility');
    if (!(VISIBILITIES as readonly string[]).includes(v)) fail(`visibility "${v}" is unknown`);
    map.visibility = v as RfwMap['visibility'];
  }
  if (m.revision !== undefined) map.revision = int(m.revision, 'revision');
  if (m.notes !== undefined) {
    map.notes = arr(m.notes, 'notes').map((v, i) => {
      const n = obj(v, `note ${i}`);
      return { ...point(n, `note ${i}`), text: str(n.text, `note ${i} text`).slice(0, 500) };
    });
  }
  if (map.settings.randomMines !== null && (map.settings.randomMines < 0 || map.settings.randomMines > 200)) fail('randomMines is outside 0-200');
  if (map.settings.aiPool !== null && (map.settings.aiPool < 0 || map.settings.aiPool > 5)) fail('aiPool is outside 0-5');
  try {
    validateMap(map);
  } catch (err) {
    fail((err as Error).message.replace(/^Map "[^"]*": /, ''));
  }
  for (const o of map.objects) if (o.x < 0 || o.y < 0) fail(`${o.type} is outside the map`);
  return map;
}
