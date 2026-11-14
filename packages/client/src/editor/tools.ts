// What the editor's tools do to the map, with the symmetry modes: with symmetry on, every edit is repeated on the
// mirrored or turned tiles, with buildings turned to match and owned by the matching base, so fair maps come out
// fair. Ground painting picks shoreline pieces by itself (paintGround), so mirrored coasts need no tile swapping.

import {
  BRIDGE_END, DEEP, LAND, SHALLOW, paintGround, settleCoast, transformPoint, transformSize, transformType,
  type Ground, type MapPoint, type ShorePainter, type Transform,
} from '@rfw/sim';
import type { EditorDoc, Placed } from './doc.js';

export type Symmetry = 'none' | 'mirrorX' | 'mirrorY' | 'mirrorXY' | 'turn2' | 'turn4';

export const SYMMETRIES: { id: Symmetry; label: string; hint: string }[] = [
  { id: 'none', label: 'Off', hint: 'Edits only where you click' },
  { id: 'mirrorX', label: 'Mirror ↔', hint: 'Left and right halves mirror each other (2 bases)' },
  { id: 'mirrorY', label: 'Mirror ↕', hint: 'Top and bottom halves mirror each other (2 bases)' },
  { id: 'mirrorXY', label: 'Mirror both', hint: 'Four quarters mirror each other (4 bases)' },
  { id: 'turn2', label: 'Turn ½', hint: 'The map turned half way round matches itself (2 bases)' },
  { id: 'turn4', label: 'Turn ¼', hint: 'The map turned a quarter matches itself (4 bases, square maps only)' },
];

/** One mirror image: how a point moves, and which base an owned piece goes to. */
interface Image {
  t: Transform;
  base: (b: number) => number;
}

export function images(sym: Symmetry, w: number, h: number): Image[] {
  switch (sym) {
    case 'mirrorX': return [{ t: 'flipX', base: (b) => b ^ 1 }];
    case 'mirrorY': return [{ t: 'flipY', base: (b) => b ^ 1 }];
    case 'mirrorXY': return [{ t: 'flipX', base: (b) => b ^ 1 }, { t: 'flipY', base: (b) => b ^ 2 }, { t: 'turnHalf', base: (b) => b ^ 3 }];
    case 'turn2': return [{ t: 'turnHalf', base: (b) => b ^ 1 }];
    case 'turn4':
      if (w !== h) return [{ t: 'turnHalf', base: (b) => b ^ 1 }];
      return [{ t: 'turnRight', base: (b) => (b + 1) & 3 }, { t: 'turnHalf', base: (b) => (b + 2) & 3 }, { t: 'turnLeft', base: (b) => (b + 3) & 3 }];
    default: return [];
  }
}

/** The tools' shared state: the map, the game data they need and the current symmetry. */
export interface ToolContext {
  doc: EditorDoc;
  painter: ShorePainter;
  /** Terrain each terrain becomes under each transform (tiles.ts). */
  turned: Record<Transform, Uint8Array>;
  names: ReadonlySet<string>;
  symmetry: Symmetry;
  /** The land tile ground painting lays. */
  land: number;
  /** The lift terrain the original maps put under a start, for even and odd bases, when the game data has maps. */
  lift: readonly number[] | null;
}

const at = (ctx: ToolContext, p: MapPoint, im: Image): MapPoint => {
  const [x, y] = transformPoint(im.t, p.x, p.y, ctx.doc.width, ctx.doc.height);
  return { x, y };
};

/** The points and the image they belong to: the originals first (with no image), then each mirror image. */
function withImages(ctx: ToolContext, points: MapPoint[]): { p: MapPoint; im: Image | null }[] {
  const out: { p: MapPoint; im: Image | null }[] = points.map((p) => ({ p, im: null }));
  for (const im of images(ctx.symmetry, ctx.doc.width, ctx.doc.height)) for (const p of points) out.push({ p: at(ctx, p, im), im });
  return out;
}

export const GROUNDS: Record<'land' | 'shallow' | 'deep', Ground> = { land: LAND, shallow: SHALLOW, deep: DEEP };

/** Paints ground on tiles, fixing the coast round them. Returns whether anything changed. */
export function paintTiles(ctx: ToolContext, points: MapPoint[], ground: Ground): boolean {
  const { doc } = ctx;
  const tiles = withImages(ctx, points).filter(({ p }) => doc.inside(p.x, p.y)).map(({ p }) => doc.index(p.x, p.y));
  const grid = { width: doc.width, height: doc.height, terrain: doc.terrain };
  return paintGround(grid, ctx.painter, tiles, ground, ctx.land).length > 0;
}

/** Sets tiles to one terrain as it is, with no coast fixing (the tile brush). */
export function setTiles(ctx: ToolContext, points: MapPoint[], terrain: number): boolean {
  const { doc } = ctx;
  let changed = false;
  for (const { p, im } of withImages(ctx, points)) {
    if (!doc.inside(p.x, p.y)) continue;
    const t = im ? ctx.turned[im.t][terrain]! : terrain;
    const i = doc.index(p.x, p.y);
    if (doc.terrain[i] !== t) {
      doc.terrain[i] = t;
      changed = true;
    }
  }
  return changed;
}

/** Places a building (type null erases), clearing any start or flag site under it. */
export function placeObjects(ctx: ToolContext, points: MapPoint[], type: string | null, base: number | null): boolean {
  const { doc } = ctx;
  let changed = false;
  for (const { p, im } of withImages(ctx, points)) {
    if (!doc.inside(p.x, p.y)) continue;
    const i = doc.index(p.x, p.y);
    if (type === null) {
      changed = doc.objects.delete(i) || changed;
      continue;
    }
    if (doc.startAt(p.x, p.y) >= 0 || doc.flagAt(p.x, p.y) >= 0) continue;
    const owner = base === null ? null : im ? im.base(base) : base;
    const next: Placed = { type: im ? transformType(im.t, type, ctx.names) : type, base: owner !== null && owner < 4 ? owner : null };
    const cur = doc.objects.get(i);
    if (cur?.type === next.type && cur.base === next.base) continue;
    doc.objects.set(i, next);
    changed = true;
  }
  return changed;
}

/** Puts a base's start on a tile; with symmetry, the matching bases' starts go on the mirrored tiles. */
export function placeStart(ctx: ToolContext, p: MapPoint, base: number): boolean {
  let changed = false;
  for (const { p: q, im } of withImages(ctx, [p])) {
    const b = im ? im.base(base) : base;
    if (b >= 4 || !ctx.doc.inside(q.x, q.y)) continue;
    // Bases are numbered in order, so a new one can only be the next.
    if (b > ctx.doc.bases.length) continue;
    const cur = ctx.doc.bases[b]?.start;
    if (cur && cur.x === q.x && cur.y === q.y) continue;
    const lift = ctx.lift?.[b & 1] ?? ctx.lift?.[0];
    // The tile it leaves goes back to plain land.
    if (cur && lift !== undefined && ctx.doc.terrain[ctx.doc.index(cur.x, cur.y)] === lift) ctx.doc.terrain[ctx.doc.index(cur.x, cur.y)] = ctx.land;
    if (!ctx.doc.setStart(b, q)) continue;
    if (lift !== undefined) ctx.doc.terrain[ctx.doc.index(q.x, q.y)] = lift;
    changed = true;
  }
  return changed;
}

/** Adds or removes a flag site, and the same on the mirrored tiles for the matching bases. */
export function toggleFlag(ctx: ToolContext, p: MapPoint, base: number): boolean {
  const { doc } = ctx;
  if (!doc.bases[base]) return false;
  const adding = !doc.bases[base]!.flagSites.some((s) => s.x === p.x && s.y === p.y);
  for (const { p: q, im } of withImages(ctx, [p])) {
    const b = im ? im.base(base) : base;
    const has = doc.bases[b]?.flagSites.some((s) => s.x === q.x && s.y === q.y);
    if (!doc.bases[b] || !doc.inside(q.x, q.y) || has === adding) continue;
    if (adding && doc.startAt(q.x, q.y) >= 0) continue;
    doc.toggleFlag(b, q);
  }
  return true;
}

/**
 * Lays a bridge from a to b along a row or a column: an end piece at each end; the loader lays the deck between.
 * Returns false if the two points are not in line.
 */
export function placeBridge(ctx: ToolContext, a: MapPoint, b: MapPoint): boolean {
  if (a.x !== b.x && a.y !== b.y) return false;
  if (a.x === b.x && a.y === b.y) return false;
  const across = a.y === b.y;
  const [s, e] = across ? (a.x < b.x ? [a, b] : [b, a]) : a.y < b.y ? [a, b] : [b, a];
  const ends: [MapPoint, number][] = [[s!, across ? BRIDGE_END.W : BRIDGE_END.N], [e!, across ? BRIDGE_END.E : BRIDGE_END.S]];
  for (const [p, t] of ends) setTiles(ctx, [p], t);
  // Nothing may stand on the deck.
  const deck: MapPoint[] = [];
  for (let x = s!.x; x <= e!.x; x++) for (let y = s!.y; y <= e!.y; y++) deck.push({ x, y });
  placeObjects(ctx, deck, null, null);
  return true;
}

// ---- Shapes ------------------------------------------------------------------------------------------------------

/** An n x n square of tiles centred on p. */
export function square(p: MapPoint, n: number): MapPoint[] {
  const out: MapPoint[] = [];
  const h = (n - 1) >> 1;
  for (let y = p.y - h; y < p.y - h + n; y++) for (let x = p.x - h; x < p.x - h + n; x++) out.push({ x, y });
  return out;
}

/** Tiles on a line from a to b (Bresenham), each widened to an n x n square. */
export function line(a: MapPoint, b: MapPoint, n = 1): MapPoint[] {
  const seen = new Set<string>();
  const out: MapPoint[] = [];
  const dx = Math.abs(b.x - a.x);
  const dy = -Math.abs(b.y - a.y);
  const sx = a.x < b.x ? 1 : -1;
  const sy = a.y < b.y ? 1 : -1;
  let err = dx + dy;
  let { x, y } = a;
  for (;;) {
    for (const q of square({ x, y }, n)) {
      const k = `${q.x},${q.y}`;
      if (!seen.has(k)) {
        seen.add(k);
        out.push(q);
      }
    }
    if (x === b.x && y === b.y) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return out;
}

/** Every tile of the rectangle with corners a and b. */
export function rect(a: MapPoint, b: MapPoint): MapPoint[] {
  const out: MapPoint[] = [];
  for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y++) for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x++) out.push({ x, y });
  return out;
}

/** The connected tiles (edge neighbours) from p for which same() holds. */
export function region(doc: EditorDoc, p: MapPoint, same: (i: number) => boolean): MapPoint[] {
  if (!doc.inside(p.x, p.y) || !same(doc.index(p.x, p.y))) return [];
  const seen = new Uint8Array(doc.width * doc.height);
  const stack = [doc.index(p.x, p.y)];
  seen[stack[0]!] = 1;
  const out: MapPoint[] = [];
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % doc.width;
    const y = (i - x) / doc.width;
    out.push({ x, y });
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
      if (!doc.inside(nx, ny)) continue;
      const n = doc.index(nx, ny);
      if (seen[n] || !same(n)) continue;
      seen[n] = 1;
      stack.push(n);
    }
  }
  return out;
}

// ---- Copy and paste ------------------------------------------------------------------------------------------------

export interface Clip {
  w: number;
  h: number;
  terrain: Uint8Array;
  objects: Map<number, Placed>;
}

export function copy(doc: EditorDoc, a: MapPoint, b: MapPoint): Clip {
  const x0 = Math.max(0, Math.min(a.x, b.x));
  const y0 = Math.max(0, Math.min(a.y, b.y));
  const x1 = Math.min(doc.width - 1, Math.max(a.x, b.x));
  const y1 = Math.min(doc.height - 1, Math.max(a.y, b.y));
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const terrain = new Uint8Array(w * h);
  const objects = new Map<number, Placed>();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      terrain[y * w + x] = doc.terrain[doc.index(x0 + x, y0 + y)]!;
      const o = doc.objects.get(doc.index(x0 + x, y0 + y));
      if (o) objects.set(y * w + x, { ...o });
    }
  }
  return { w, h, terrain, objects };
}

/** The clip mirrored or turned, with its tiles and buildings turned to match. */
export function transformClip(clip: Clip, t: Transform, turned: Record<Transform, Uint8Array>, names: ReadonlySet<string>): Clip {
  const [w, h] = transformSize(t, clip.w, clip.h);
  const terrain = new Uint8Array(w * h);
  const objects = new Map<number, Placed>();
  for (let y = 0; y < clip.h; y++) {
    for (let x = 0; x < clip.w; x++) {
      const [nx, ny] = transformPoint(t, x, y, clip.w, clip.h);
      terrain[ny * w + nx] = turned[t][clip.terrain[y * clip.w + x]! & 127]!;
      const o = clip.objects.get(y * clip.w + x);
      if (o) objects.set(ny * w + nx, { type: transformType(t, o.type, names), base: o.base });
    }
  }
  return { w, h, terrain, objects };
}

/**
 * Pastes a clip with its top left at p, replacing the buildings there, and settles the coast along its edges.
 * Starts and flag sites are left alone.
 */
export function paste(ctx: ToolContext, clip: Clip, p: MapPoint): void {
  const { doc } = ctx;
  for (let y = 0; y < clip.h; y++) {
    for (let x = 0; x < clip.w; x++) {
      const mx = p.x + x;
      const my = p.y + y;
      if (!doc.inside(mx, my)) continue;
      const i = doc.index(mx, my);
      doc.terrain[i] = clip.terrain[y * clip.w + x]!;
      const o = clip.objects.get(y * clip.w + x);
      if (doc.startAt(mx, my) >= 0 || doc.flagAt(mx, my) >= 0) continue;
      if (o) doc.objects.set(i, { ...o });
      else doc.objects.delete(i);
    }
  }
  const grid = { width: doc.width, height: doc.height, terrain: doc.terrain };
  settleCoast(grid, ctx.painter, ctx.land, { x0: p.x - 1, y0: p.y - 1, x1: p.x + clip.w, y1: p.y + clip.h });
}

/**
 * Makes the whole map symmetric: copies the source part (the left half, top half or top-left quarter) onto the
 * others, mirrored or turned, and gives each base's mirror image its matching base.
 */
export function mirrorMap(ctx: ToolContext): void {
  const { doc } = ctx;
  const ims = images(ctx.symmetry, doc.width, doc.height);
  if (!ims.length) return;
  const w = doc.width;
  const h = doc.height;
  // The source part: tiles left of the mirror line, above it, or both, or the matching wedge for turns.
  const source = (x: number, y: number): boolean => {
    switch (ctx.symmetry) {
      case 'mirrorX': return x < w / 2;
      case 'mirrorY': return y < h / 2;
      case 'mirrorXY': return x < w / 2 && y < h / 2;
      case 'turn2': return y < h / 2 || (y === (h - 1) / 2 && x < w / 2);
      case 'turn4': return w === h ? x < w / 2 && y < h / 2 : y < h / 2;
      default: return true;
    }
  };
  const terrain = doc.terrain.slice();
  const objects = new Map(doc.objects);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!source(x, y)) continue;
      const i = y * w + x;
      for (const im of ims) {
        const [nx, ny] = transformPoint(im.t, x, y, w, h);
        if (source(nx, ny)) continue;
        const j = ny * w + nx;
        terrain[j] = ctx.turned[im.t][doc.terrain[i]! & 127]!;
        const o = doc.objects.get(i);
        if (o) objects.set(j, { type: transformType(im.t, o.type, ctx.names), base: o.base === null ? null : im.base(o.base) });
        else objects.delete(j);
      }
    }
  }
  doc.terrain = terrain;
  doc.objects = objects;
  settleCoast({ width: w, height: h, terrain }, ctx.painter, ctx.land);
  // Bases in the source part are copied to their partners.
  const keep = doc.bases.filter((b) => source(b.start.x, b.start.y));
  if (keep.length) {
    const bases = new Map<number, { start: MapPoint; flagSites: MapPoint[] }>();
    keep.forEach((b) => bases.set(b.id, { start: b.start, flagSites: b.flagSites.filter((p) => source(p.x, p.y)) }));
    for (const b of keep) {
      for (const im of ims) {
        const id = im.base(b.id);
        if (id >= 4 || bases.has(id)) continue;
        const move = (p: MapPoint) => {
          const [x, y] = transformPoint(im.t, p.x, p.y, w, h);
          return { x, y };
        };
        bases.set(id, { start: move(b.start), flagSites: bases.get(b.id)!.flagSites.map(move) });
      }
    }
    const ids = [...bases.keys()].sort((a, b) => a - b);
    // Base ids must run 0, 1, 2...; a gap (a mirror image of base 3 only) is closed up.
    doc.bases = ids.map((id, k) => ({ ...doc.bases[id], id: k, ...bases.get(id)! }));
  }
}
