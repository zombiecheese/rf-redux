// The game data the server runs matches with: the building table and shoreline shapes, and maps. Each file comes
// from the art pack (the built client's art/pack: the project's own tables and sprites, and the two-player maps)
// when it has it, else from the converted assets in ASSETS_DIR. Built-in maps are those two-player maps and the
// 3- and 4-base maps made from them (builtInMaps in the sim), which are made here when the data loads and kept in
// memory, never written out; the server serves them under /generated/maps/ as if they were files. Other modules
// (the level editor's shared maps) add sources with addSource, so a lobby can be set to any map a source knows.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import {
  buildingDefs, builtInMaps, generatedIndex, validateMap,
  type BuildingDef, type BuildingRecord, type ExplosionScript, type MapIndexEntry, type RfwMap, type ShoreTable,
} from '@rfw/sim';

export interface MapEntry {
  id: string;
  name: string;
  level?: number;
  players: { min: number; max: number };
  bases: number;
  /** Where it came from: 'original', 'generated' (made from the originals) or a source's name. */
  source: string;
}

export interface MapSource {
  name: string;
  /** The map with this id, if the source has it and the user may play it (null for anyone). */
  get(id: string, userId: string | null): RfwMap | null;
}

export class Maps {
  defs: BuildingDef[] = [];
  shore: ShoreTable | null = null;
  private index: MapEntry[] = [];
  /** maps/index.json as the client gets it: the originals, then the generated maps. */
  private files: MapIndexEntry[] = [];
  private readonly generated = new Map<string, RfwMap>();
  private readonly cache = new Map<string, RfwMap>();
  private readonly sources: MapSource[] = [];

  /**
   * dir is the asset pack. tables, when given, is the art pack (the built client's art/pack): each file it has
   * (tables, sprites, maps) is used in place of the asset pack's, as the client does.
   */
  constructor(private readonly dir: string, private readonly tables: string | null = null) {
    this.reload();
  }

  get ready(): boolean {
    return this.defs.length > 0;
  }

  /** (Re)reads the game data. */
  reload(): void {
    this.cache.clear();
    this.generated.clear();
    const table = (p: string) => this.file(p);
    const file = table;
    if (!existsSync(table('buildings.json'))) {
      this.defs = [];
      this.index = [];
      this.files = [];
      return;
    }
    const records = JSON.parse(readFileSync(table('buildings.json'), 'utf8')) as BuildingRecord[];
    const effects = existsSync(table('effects.json'))
      ? (JSON.parse(readFileSync(table('effects.json'), 'utf8')) as { defs?: Record<string, ExplosionScript> }).defs
      : undefined;
    this.defs = buildingDefs(records, effects);
    this.shore = existsSync(table('shore.json')) ? (JSON.parse(readFileSync(table('shore.json'), 'utf8')) as ShoreTable) : null;
    const index = existsSync(file('maps/index.json')) ? (JSON.parse(readFileSync(file('maps/index.json'), 'utf8')) as MapIndexEntry[]) : [];
    let made: MapIndexEntry[] = [];
    try {
      const read = (p: string) => (existsSync(file(p)) ? new Uint8Array(readFileSync(file(p))) : null);
      const maps = builtInMaps(read, (d) => new Uint8Array(inflateSync(d)), this.defs);
      for (const g of maps) this.generated.set(g.id, g.map);
      made = generatedIndex(maps);
    } catch (err) {
      console.error('Could not make the 3- and 4-base maps', err);
    }
    this.files = [...index, ...made];
    this.index = [
      ...index.map((m) => ({ ...m, bases: m.players.max, source: 'original' })),
      ...made.map((m) => ({ ...m, bases: m.players.max, source: 'generated' })),
    ];
  }

  /** Where a pack file is: the art pack's when it has one, else the asset pack's. */
  private file(p: string): string {
    return this.tables && existsSync(join(this.tables, p)) ? join(this.tables, p) : join(this.dir, p);
  }

  /** maps/index.json with the generated maps added, for /generated/maps/index.json. */
  indexFile(): MapIndexEntry[] {
    return this.files;
  }

  /** A generated map by id, for /generated/maps/<id>.json; null for anything else. */
  generatedMap(id: string): RfwMap | null {
    return this.generated.get(id) ?? null;
  }

  /** Lets a level-editor module offer its maps to lobbies. */
  addSource(source: MapSource): void {
    this.sources.push(source);
  }

  /** The built-in maps, for the lobby map picker. */
  list(): MapEntry[] {
    return this.index;
  }

  builtIn(id: string): boolean {
    return this.index.some((m) => m.id === id);
  }

  get(id: string, userId: string | null = null): RfwMap | null {
    if (this.builtIn(id)) {
      const made = this.generated.get(id);
      if (made) return made;
      let map = this.cache.get(id);
      if (!map) {
        if (!/^[A-Za-z0-9_-]+$/.test(id)) return null;
        const path = this.file(`maps/${id}.json`);
        if (!existsSync(path)) return null;
        map = JSON.parse(readFileSync(path, 'utf8')) as RfwMap;
        validateMap(map);
        this.cache.set(id, map);
      }
      return map;
    }
    for (const s of this.sources) {
      const map = s.get(id, userId);
      if (map) {
        validateMap(map);
        return map;
      }
    }
    return null;
  }

  name(id: string): string {
    return this.index.find((m) => m.id === id)?.name ?? this.get(id)?.name ?? id;
  }
}
