// The map being edited: its terrain grid, one building per tile, its bases and notes, and its settings, with an
// undo history of whole snapshots (a 128 x 128 map is 16 KB of terrain, so a hundred steps are cheap).

import {
  MAP_VERSION, MAX_BASES, decodeTerrain, encodeTerrain, type MapBase, type MapNote, type MapObject, type MapPoint, type MapVisibility, type RfwMap,
} from '@rfw/sim';

export interface Placed {
  type: string;
  base: number | null;
}

/** Everything about the map besides its grid, bases, buildings and notes. */
export type MapMeta = Omit<RfwMap, 'width' | 'height' | 'terrain' | 'bases' | 'objects' | 'notes'>;

interface Snapshot {
  meta: string;
  width: number;
  height: number;
  terrain: Uint8Array;
  objects: [number, Placed][];
  bases: string;
  notes: string;
}

const HISTORY = 100;

/** Where a map is kept in the server's map library. */
export interface LibraryRef {
  id: string;
  /** The revision this copy was saved as or opened from. */
  revision: number;
  visibility: MapVisibility;
}

export class EditorDoc {
  meta: MapMeta;
  width: number;
  height: number;
  terrain: Uint8Array;
  /** Buildings by tile index (y * width + x). */
  objects = new Map<number, Placed>();
  bases: MapBase[];
  notes: MapNote[];
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  /** Bumped by every change, so views know to redraw and drafts to save. */
  version = 0;
  /** The version last saved. */
  saved = 0;
  /** The library copy this map belongs to, if any. Kept out of the undo history, so undo never brings back an old revision. */
  library: LibraryRef | null;

  constructor(map: RfwMap) {
    const { width, height, terrain, bases, objects, notes, ...meta } = map;
    this.meta = structuredClone(meta);
    this.width = width;
    this.height = height;
    this.terrain = decodeTerrain(terrain);
    for (const o of objects) this.objects.set(o.y * width + o.x, { type: o.type, base: o.base });
    this.bases = structuredClone(bases);
    this.notes = structuredClone(notes ?? []);
    this.library = map.id && map.revision ? { id: map.id, revision: map.revision, visibility: map.visibility ?? 'private' } : null;
  }

  get dirty(): boolean {
    return this.version !== this.saved;
  }

  toMap(): RfwMap {
    const objects: MapObject[] = [];
    for (const [i, o] of [...this.objects].sort((a, b) => a[0] - b[0])) {
      objects.push({ type: o.type, x: i % this.width, y: Math.floor(i / this.width), base: o.base });
    }
    const map: RfwMap = {
      ...structuredClone(this.meta), version: MAP_VERSION, width: this.width, height: this.height, terrain: encodeTerrain(this.terrain),
      bases: structuredClone(this.bases), objects, notes: structuredClone(this.notes),
    };
    // Every base is a player slot; bots fill the ones nobody takes.
    const max = Math.max(1, this.bases.length);
    map.players = { min: Math.min(Math.max(1, map.players.min), max), max };
    map.id = this.library?.id ?? null;
    map.revision = this.library?.revision ?? 0;
    if (this.library) map.visibility = this.library.visibility;
    return map;
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  index(x: number, y: number): number {
    return y * this.width + x;
  }

  // ---- History ----------------------------------------------------------------------------------------------------

  private snapshot(): Snapshot {
    return {
      meta: JSON.stringify(this.meta), width: this.width, height: this.height, terrain: this.terrain.slice(),
      objects: [...this.objects].map(([i, o]) => [i, { ...o }]), bases: JSON.stringify(this.bases), notes: JSON.stringify(this.notes),
    };
  }

  private restore(s: Snapshot): void {
    this.meta = JSON.parse(s.meta) as MapMeta;
    this.width = s.width;
    this.height = s.height;
    this.terrain = s.terrain.slice();
    this.objects = new Map(s.objects.map(([i, o]) => [i, { ...o }]));
    this.bases = JSON.parse(s.bases) as MapBase[];
    this.notes = JSON.parse(s.notes) as MapNote[];
  }

  /** Call before a change: the state now becomes one undo step. */
  checkpoint(): void {
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > HISTORY) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  /** Call after a change. */
  touch(): void {
    this.version++;
  }

  /** Drops the last checkpoint when the change it was for did nothing. */
  dropCheckpoint(): void {
    this.undoStack.pop();
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): boolean {
    const s = this.undoStack.pop();
    if (!s) return false;
    this.redoStack.push(this.snapshot());
    this.restore(s);
    this.touch();
    return true;
  }

  redo(): boolean {
    const s = this.redoStack.pop();
    if (!s) return false;
    this.undoStack.push(this.snapshot());
    this.restore(s);
    this.touch();
    return true;
  }

  // ---- Edits (callers checkpoint first) ---------------------------------------------------------------------------

  /** The base whose start is on this tile, or -1. */
  startAt(x: number, y: number): number {
    return this.bases.findIndex((b) => b.start.x === x && b.start.y === y);
  }

  /** The base with a flag site on this tile, or -1. */
  flagAt(x: number, y: number): number {
    return this.bases.findIndex((b) => b.flagSites.some((p) => p.x === x && p.y === y));
  }

  /** Puts a base's start (its lift) on a tile, adding the base if it is new. Returns false past the fourth base. */
  setStart(base: number, p: MapPoint): boolean {
    if (base >= MAX_BASES) return false;
    while (this.bases.length <= base) this.bases.push({ id: this.bases.length, start: { ...p }, flagSites: [] });
    this.bases[base]!.start = { ...p };
    this.objects.delete(this.index(p.x, p.y));
    return true;
  }

  /** Adds a flag site for a base, or takes it away if it is there already. */
  toggleFlag(base: number, p: MapPoint): void {
    const b = this.bases[base];
    if (!b) return;
    const k = b.flagSites.findIndex((s) => s.x === p.x && s.y === p.y);
    if (k >= 0) b.flagSites.splice(k, 1);
    else {
      for (const other of this.bases) other.flagSites = other.flagSites.filter((s) => s.x !== p.x || s.y !== p.y);
      b.flagSites.push({ ...p });
    }
  }

  /** Removes a base. Later bases move down one, and so do the buildings they own. */
  removeBase(base: number): void {
    if (!this.bases[base]) return;
    this.bases.splice(base, 1);
    this.bases.forEach((b, i) => (b.id = i));
    for (const [i, o] of this.objects) {
      if (o.base === base) this.objects.set(i, { ...o, base: null });
      else if (o.base !== null && o.base > base) this.objects.set(i, { ...o, base: o.base - 1 });
    }
  }

  /**
   * Resizes the map. The old map keeps its place at (dx, dy) in the new one; new tiles are filled with fill, and
   * anything left outside goes.
   */
  resize(width: number, height: number, dx: number, dy: number, fill: number): void {
    const terrain = new Uint8Array(width * height).fill(fill);
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < width && ny < height) terrain[ny * width + nx] = this.terrain[y * this.width + x]!;
      }
    }
    const objects = new Map<number, Placed>();
    for (const [i, o] of this.objects) {
      const nx = (i % this.width) + dx;
      const ny = Math.floor(i / this.width) + dy;
      if (nx >= 0 && ny >= 0 && nx < width && ny < height) objects.set(ny * width + nx, o);
    }
    const fits = (p: MapPoint) => p.x + dx >= 0 && p.y + dy >= 0 && p.x + dx < width && p.y + dy < height;
    const move = (p: MapPoint) => ({ x: p.x + dx, y: p.y + dy });
    for (const b of this.bases) {
      b.start = fits(b.start) ? move(b.start) : { x: Math.min(width - 1, Math.max(0, b.start.x + dx)), y: Math.min(height - 1, Math.max(0, b.start.y + dy)) };
      b.flagSites = b.flagSites.filter(fits).map(move);
    }
    this.notes = this.notes.filter(fits).map((n) => ({ ...n, ...move(n) }));
    this.width = width;
    this.height = height;
    this.terrain = terrain;
    this.objects = objects;
  }
}
