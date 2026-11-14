// The editor's view of the map, drawn by one of the game's own renderers into a frame sized to the window: the
// classic software renderer (view.ts) with its CRT look, or the modern 3D view (modern/renderer.ts) as the drone's
// feed, by day or at night. Either way the camera is the game's tilted one, or the same camera looking straight
// down. Grid, bases, flag sites, notes, problems and the tool's preview are drawn over it at screen resolution so
// they stay sharp and line up in every look, since both renderers project from the same camera.

import { GRID, buildWorld, createMatch, type MapPoint, type MapProblem, type Match, type World } from '@rfw/sim';
import type { GameAssets, GameData } from '../assets.js';
import { Camera, FOCAL, type ViewRect } from '../camera.js';
import { drawable } from '../mappreview.js';
import { TEAMS } from '../paint.js';
import { CrtLook } from '../display.js';
import { modernAvailable } from '../modern/layout.js';
import type { ModernRenderer } from '../modern/renderer.js';
import { Frame } from '../raster.js';
import { drawView } from '../view.js';
import type { EditorDoc } from './doc.js';

const TILE = 32;
/** The view pitch in 256ths of a turn: the game's camera at rest, or straight down. */
const PITCH = { tilted: 32, top: 64 } as const;
export type ViewMode = keyof typeof PITCH;
/**
 * The modern camera cannot look exactly straight down (its "up" would be along its line of sight), so its top-down
 * view leans a hair off vertical; the overlay uses the same camera, so it still lines up.
 */
const MODERN_TOP_PITCH = 63.5;
/** How the map is drawn: the classic view, or the modern view by day or at night. */
export type Look = 'classic' | 'modern' | 'night';
const MODERN_W = 1280;
const MODERN_H = 720;
/** The minimap's picture of the map, in pixels (drawn at 168 CSS pixels, so sharp on a 2x screen). */
const MINIMAP_PICTURE = 336;
export const BASE_CSS = TEAMS.map((t) => t.css);

/** A small square of a base's colour, for lists. */
export function dot(colour: string): HTMLElement {
  const i = document.createElement('i');
  i.className = 'dot';
  i.style.background = colour;
  return i;
}

export interface Overlay {
  /** Tiles the current tool would change. */
  preview: MapPoint[];
  previewColour: string;
  /** The selection rectangle. */
  selection: { a: MapPoint; b: MapPoint } | null;
  problems: MapProblem[];
  /** The problem picked in the list, drawn brighter. */
  focus: MapProblem | null;
  grid: boolean;
  cursor: MapPoint | null;
}

export class MapView {
  readonly canvas = document.createElement('canvas');
  private readonly ctx = this.canvas.getContext('2d')!;
  private readonly low = document.createElement('canvas');
  private readonly lowCtx = this.low.getContext('2d')!;
  private frame = new Frame(1, 1);
  readonly cam = new Camera({ x: 0, y: 0, w: 1, h: 1, dx: 0, dy: 0, boxW: 1, boxH: 1 });
  mode: ViewMode = 'top';
  /** Screen pixels per frame pixel: 2 keeps the game's chunky look on a big window. */
  pixel = 2;
  /** The ground point at the centre of the view, in map pixels. */
  x = 0;
  y = 0;
  /** Frame pixels per map pixel at the centre of the view. */
  scale = 0.5;
  private match: Match | null = null;
  private builtFor = -1;
  /** The document the world was built from: a newly opened map starts at the same version as an untouched one. */
  private builtDoc: EditorDoc | null = null;
  private assets: GameAssets | null = null;
  private readonly names: ReadonlySet<string>;
  /** Which renderer draws the map. Modern and night fall back to classic until three.js has loaded, or without WebGL. */
  look: Look = 'classic';
  private readonly crt = new CrtLook();
  private modern: ModernRenderer | null = null;
  private modernLoad: Promise<void> | null = null;
  /**
   * The world the modern renderer was given. Each edit builds a new world; its contents are copied into this one so
   * the renderer updates only the tiles and buildings that changed, as it does in a match, instead of starting over.
   */
  private shownWorld: World | null = null;
  private shownDoc: EditorDoc | null = null;
  /** Night preview only: extra moonlight so the whole map can be read (matches and test play never have it). */
  moonlight = true;
  /** Called when the modern view has loaded (or failed to), to draw again. */
  onLoad: () => void = () => {};

  constructor(private readonly data: GameData, private readonly doc: () => EditorDoc) {
    this.names = new Set(data.defs.map((d) => d.name));
    this.canvas.className = 'mapview';
  }

  /** Whether the modern view can be drawn here (it needs WebGL). */
  static get modernAvailable(): boolean {
    return modernAvailable();
  }

  /** The look actually on screen: modern only once its renderer is ready. */
  get shownLook(): Look {
    return this.look !== 'classic' && this.modern ? this.look : 'classic';
  }

  /** True while the modern view is wanted but still loading. */
  get loading(): boolean {
    return this.look !== 'classic' && !this.modern && modernAvailable();
  }

  /** The modern view animates (the sea, the drone's feed), so it is drawn every frame. */
  get animated(): boolean {
    return this.shownLook !== 'classic';
  }

  setLook(look: Look): void {
    this.look = look === 'classic' || modernAvailable() ? look : 'classic';
    if (this.look !== 'classic' && !this.modern && !this.modernLoad) {
      this.modernLoad = import('../modern/renderer.js').then((mod) => {
        this.modern = new mod.ModernRenderer({ ...this.data, map: this.doc().toMap() });
      }).catch(() => {
        this.look = 'classic';
      }).finally(() => this.onLoad());
    }
  }

  private pitch(): number {
    return this.mode === 'top' && this.shownLook !== 'classic' ? MODERN_TOP_PITCH : PITCH[this.mode];
  }

  /** Map-to-world offset: a small map sits in the middle of the 128 x 128 world, as the game lays it out. */
  get offset(): { x: number; y: number } {
    const d = this.doc();
    return { x: (GRID - d.width) >> 1, y: (GRID - d.height) >> 1 };
  }

  private world(): Match {
    const d = this.doc();
    if (this.match && this.builtDoc === d && this.builtFor === d.version) return this.match;
    const map = drawable(d.toMap(), this.names);
    const world = buildWorld(map, this.data.defs, this.data.shore);
    this.match = createMatch(world, map, map.bases.map((b) => ({ base: b.id, team: b.id })), 1);
    this.assets = { ...this.data, map };
    this.builtFor = d.version;
    this.builtDoc = d;
    return this.match;
  }

  /** Centres the view on the whole map, zoomed to fit. */
  fit(): void {
    const d = this.doc();
    this.x = (d.width * TILE) / 2;
    this.y = (d.height * TILE) / 2;
    const w = this.canvas.clientWidth / this.pixel || 640;
    const h = this.canvas.clientHeight / this.pixel || 480;
    this.scale = Math.min(2, Math.max(0.05, Math.min(w / (d.width * TILE + 64), h / (d.height * TILE + 64))));
  }

  centreOn(p: MapPoint): void {
    this.x = p.x * TILE + TILE / 2;
    this.y = p.y * TILE + TILE / 2;
  }

  zoom(by: number, around?: { sx: number; sy: number }): void {
    const before = around ? this.ground(around.sx, around.sy) : null;
    this.scale = Math.min(3, Math.max(0.04, this.scale * by));
    if (before && around) {
      this.setup();
      const after = this.ground(around.sx, around.sy);
      if (after) {
        this.x += before.x - after.x;
        this.y += before.y - after.y;
      }
    }
  }

  /** Moves the view by a drag of dx, dy screen pixels. */
  pan(dx: number, dy: number): void {
    const f = 1 / (this.scale * this.pixel);
    this.x -= dx * f;
    this.y -= this.mode === 'top' ? dy * f : dy * f * 1.4;
  }

  private setup(): void {
    const w = Math.max(1, Math.floor(this.canvas.clientWidth / this.pixel));
    const h = Math.max(1, Math.floor(this.canvas.clientHeight / this.pixel));
    if (this.frame.w !== w || this.frame.h !== h) {
      this.frame = new Frame(w, h);
      this.low.width = w;
      this.low.height = h;
    }
    const view: ViewRect = { x: 0, y: 0, w, h, dx: 0, dy: 0, boxW: w, boxH: h };
    Object.assign(this.cam.view, view);
    const o = this.offset;
    // The height giving this scale at the centre: FOCAL / (FOCAL + z) = scale.
    this.cam.fix(this.x + o.x * TILE, this.y + o.y * TILE, FOCAL / this.scale - FOCAL, this.pitch());
    this.cam.begin();
  }

  /** The map point (in map pixels) under a point of the canvas, in CSS pixels. */
  ground(sx: number, sy: number): { x: number; y: number } | null {
    const g = this.cam.unproject(sx / this.pixel, sy / this.pixel);
    if (!g) return null;
    const o = this.offset;
    return { x: g.x - o.x * TILE, y: g.y - o.y * TILE };
  }

  /** The map tile under a point of the canvas, or null off the ground. Tiles outside the map are returned too. */
  tileAt(sx: number, sy: number): MapPoint | null {
    const g = this.ground(sx, sy);
    return g ? { x: Math.floor(g.x / TILE), y: Math.floor(g.y / TILE) } : null;
  }

  /** A map point (map pixels, height z) on the canvas, in CSS pixels. */
  screen(x: number, y: number, z = 0): { x: number; y: number } | null {
    const o = this.offset;
    const p = this.cam.project(x + o.x * TILE, y + o.y * TILE, z);
    return p ? { x: p.x * this.pixel, y: p.y * this.pixel } : null;
  }

  render(overlay: Overlay): void {
    const dpr = devicePixelRatio || 1;
    const cw = Math.round(this.canvas.clientWidth * dpr);
    const ch = Math.round(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw;
      this.canvas.height = ch;
    }
    const match = this.world();
    this.adoptShown(match);
    this.setup();
    const ctx = this.ctx;
    const w = this.frame.w * this.pixel;
    const h = this.frame.h * this.pixel;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, cw, ch);
    if (this.shownLook !== 'classic' && this.modern) {
      this.drawModern(match, w * dpr, h * dpr);
    } else {
      this.frame.setClip(0, 0, this.frame.w, this.frame.h);
      drawView(this.frame, this.cam, match, this.assets!, 0);
      this.lowCtx.putImageData(new ImageData(new Uint8ClampedArray(this.frame.px.buffer), this.frame.w, this.frame.h), 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.low, 0, 0, w * dpr, h * dpr);
      // The classic view is always seen through the CRT, as in the game: where each frame line is two or more
      // screen pixels tall, so the lines can be told apart.
      if (this.pixel * dpr >= 2) this.crt.draw(ctx, this.low, 0, 0, Math.round(w * dpr), Math.round(h * dpr), this.frame.h);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawOverlay(overlay);
  }

  /** Keeps one world for the modern renderer per document: a new build's contents are copied into it. */
  private adoptShown(built: Match): void {
    if (this.shownLook === 'classic') return;
    const d = this.doc();
    if (this.shownDoc !== d || !this.shownWorld) {
      this.shownWorld = built.world;
      this.shownDoc = d;
    } else if (built.world !== this.shownWorld) {
      adopt(this.shownWorld, built.world);
      built.world = this.shownWorld;
    }
  }

  /**
   * The whole map straight down in the look being previewed, size x size pixels, for the minimap and the drafts'
   * thumbnails. It covers map pixels 0 to the longer side on both axes, so a tile maps to the same place as on the
   * minimap. Null until the world is built.
   */
  snapshot(size: number): HTMLCanvasElement | null {
    const d = this.doc();
    const match = this.world();
    this.adoptShown(match);
    const span = Math.max(d.width, d.height) * TILE;
    const scale = size / span;
    const o = this.offset;
    const cam = new Camera({ x: 0, y: 0, w: size, h: size, dx: 0, dy: 0, boxW: size, boxH: size });
    const modern = this.shownLook !== 'classic' ? this.modern : null;
    cam.fix(span / 2 + o.x * TILE, span / 2 + o.y * TILE, FOCAL / scale - FOCAL, modern ? MODERN_TOP_PITCH : PITCH.top);
    cam.begin();
    const out = document.createElement('canvas');
    out.width = size;
    out.height = size;
    const g = out.getContext('2d')!;
    if (modern) {
      const rect = { x: 0, y: 0, w: Math.min(size, MODERN_H), h: Math.min(size, MODERN_H) };
      modern.draw(match, [{ cam, rect, viewer: 0, skip: false }], { wrecks: [], splats: [] });
      g.drawImage(modern.canvas, 0, 0, rect.w, rect.h, 0, 0, size, size);
    } else {
      const frame = new Frame(size, size);
      frame.setClip(0, 0, size, size);
      drawView(frame, cam, match, this.assets!, 0);
      g.putImageData(new ImageData(new Uint8ClampedArray(frame.px.buffer), size, size), 0, 0);
    }
    return out;
  }

  /**
   * The modern view: the renderer draws the same camera into a part of its 1280 x 720 screen with the view's own
   * shape, always as the drone's feed (the modern view's look), by day or at night, and that part is scaled up here.
   */
  private drawModern(built: Match, w: number, h: number): void {
    const modern = this.modern!;
    const aspect = this.frame.w / this.frame.h;
    const rect = aspect > MODERN_W / MODERN_H
      ? { x: 0, y: 0, w: MODERN_W, h: Math.max(1, Math.round(MODERN_W / aspect)) }
      : { x: 0, y: 0, w: Math.max(1, Math.round(MODERN_H * aspect)), h: MODERN_H };
    modern.setNight(this.look === 'night');
    modern.setMoonlight(this.look === 'night' && this.moonlight ? 1 : 0);
    modern.setLook(true, false);
    modern.draw(built, [{ cam: this.cam, rect, viewer: 0, skip: false }], { wrecks: [], splats: [] });
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(modern.canvas, rect.x, rect.y, rect.w, rect.h, 0, 0, Math.round(w), Math.round(h));
  }

  private quad(x: number, y: number, w = 1, h = 1, inset = 0): { x: number; y: number }[] | null {
    const pts = [
      this.screen(x * TILE + inset, y * TILE + inset), this.screen((x + w) * TILE - inset, y * TILE + inset),
      this.screen((x + w) * TILE - inset, (y + h) * TILE - inset), this.screen(x * TILE + inset, (y + h) * TILE - inset),
    ];
    return pts.every(Boolean) ? (pts as { x: number; y: number }[]) : null;
  }

  private path(pts: { x: number; y: number }[]): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(pts[0]!.x, pts[0]!.y);
    for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
    ctx.closePath();
  }

  private drawOverlay(o: Overlay): void {
    const ctx = this.ctx;
    const d = this.doc();
    // The map's edge, and the grid when it is on and the tiles are big enough to see it.
    const edge = this.quad(0, 0, d.width, d.height);
    if (edge) {
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 1;
      this.path(edge);
      ctx.stroke();
    }
    if (o.grid && this.scale * this.pixel >= 0.3) {
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath();
      for (let x = 1; x < d.width; x++) {
        const a = this.screen(x * TILE, 0);
        const b = this.screen(x * TILE, d.height * TILE);
        if (a && b) {
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
        }
      }
      for (let y = 1; y < d.height; y++) {
        const a = this.screen(0, y * TILE);
        const b = this.screen(d.width * TILE, y * TILE);
        if (a && b) {
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
        }
      }
      ctx.stroke();
    }
    // Problems: red for errors, amber for warnings.
    for (const p of o.problems) {
      const lit = p === o.focus;
      for (const t of p.tiles) {
        const q = this.quad(t.x, t.y, 1, 1, -2);
        if (!q) continue;
        ctx.strokeStyle = p.level === 'error' ? (lit ? '#ff6060' : 'rgba(255,60,60,0.85)') : lit ? '#ffd060' : 'rgba(255,190,40,0.8)';
        ctx.lineWidth = lit ? 3 : 2;
        ctx.setLineDash([4, 3]);
        this.path(q);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    // Bases: the lift as a square in the base's colour with its number, flag sites as small flags.
    d.bases.forEach((b, i) => {
      const colour = BASE_CSS[i] ?? '#fff';
      const q = this.quad(b.start.x, b.start.y, 1, 1, 3);
      if (q) {
        ctx.strokeStyle = colour;
        ctx.lineWidth = 3;
        this.path(q);
        ctx.stroke();
        const c = this.screen(b.start.x * TILE + TILE / 2, b.start.y * TILE + TILE / 2);
        if (c) this.label(String(i + 1), c.x, c.y, colour);
      }
      for (const f of b.flagSites) {
        const foot = this.screen(f.x * TILE + TILE / 2, f.y * TILE + TILE / 2);
        const top = this.screen(f.x * TILE + TILE / 2, f.y * TILE + TILE / 2, 40);
        if (!foot || !top) continue;
        const pole = this.mode === 'top' ? { x: foot.x, y: foot.y - Math.max(10, 24 * this.scale * this.pixel) } : top;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(foot.x, foot.y);
        ctx.lineTo(pole.x, pole.y);
        ctx.stroke();
        ctx.fillStyle = colour;
        ctx.beginPath();
        ctx.moveTo(pole.x, pole.y);
        ctx.lineTo(pole.x + 12, pole.y + 4);
        ctx.lineTo(pole.x, pole.y + 8);
        ctx.fill();
      }
    });
    for (const n of d.notes) {
      const c = this.screen(n.x * TILE + TILE / 2, n.y * TILE + TILE / 2);
      if (!c) continue;
      ctx.fillStyle = '#fff6a0';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      ctx.fillRect(c.x - 6, c.y - 6, 12, 12);
      ctx.strokeRect(c.x - 6, c.y - 6, 12, 12);
      if (this.scale * this.pixel >= 0.5) this.label(n.text.slice(0, 40), c.x + 10, c.y, '#fff6a0', 'left');
    }
    if (o.preview.length) {
      ctx.fillStyle = o.previewColour;
      for (const t of o.preview) {
        const q = this.quad(t.x, t.y);
        if (!q) continue;
        this.path(q);
        ctx.fill();
      }
    }
    if (o.selection) {
      const { a, b } = o.selection;
      const q = this.quad(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(a.x - b.x) + 1, Math.abs(a.y - b.y) + 1);
      if (q) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 4]);
        this.path(q);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    if (o.cursor) {
      const q = this.quad(o.cursor.x, o.cursor.y);
      if (q) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        this.path(q);
        ctx.stroke();
      }
    }
  }

  private label(text: string, x: number, y: number, colour: string, align: CanvasTextAlign = 'center'): void {
    const ctx = this.ctx;
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#000';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = colour;
    ctx.fillText(text, x, y);
  }

  /** The four corners of the view on the ground, in map pixels, where they meet it. */
  viewCorners(): ({ x: number; y: number } | null)[] {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    // The top of a tilted view can be above the horizon; come down until the ground is there.
    const top = (sx: number) => {
      for (let sy = 0; sy < h; sy += 8) {
        const g = this.ground(sx, sy);
        if (g) return g;
      }
      return null;
    };
    return [top(0), top(w), this.ground(w, h), this.ground(0, h)];
  }
}

/** Copies a newly built world's contents into the one already on screen, keeping its arrays. */
function adopt(into: World, from: World): void {
  const a = into as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(from)) {
    const old = a[k];
    if (ArrayBuffer.isView(v) && ArrayBuffer.isView(old) && (old as Uint8Array).length === (v as Uint8Array).length) (old as Uint8Array).set(v as Uint8Array);
    else a[k] = v;
  }
}

/** The whole map in miniature: a pixel or more per tile, buildings dark, bases in their colours, and the view. */
export class Minimap {
  readonly canvas = document.createElement('canvas');
  private readonly ctx = this.canvas.getContext('2d')!;
  /** The map in the previewed look (MapView.snapshot), redrawn a moment after edits stop, or null for flat colours. */
  private picture: HTMLCanvasElement | null = null;
  private image: ImageData | null = null;
  private builtFor = -1;
  private builtDoc: EditorDoc | null = null;
  private builtLook = '';
  private due = 0;

  constructor(private readonly colours: [number, number, number][], private readonly doc: () => EditorDoc) {
    this.canvas.className = 'minimap';
  }

  /** Map tile under a point of the minimap. */
  tileAt(sx: number, sy: number): MapPoint {
    const d = this.doc();
    const k = this.canvas.clientWidth / Math.max(d.width, d.height);
    return { x: Math.floor(sx / k), y: Math.floor(sy / k) };
  }

  /** Whether the picture is waiting to be redrawn. */
  get waiting(): boolean {
    return this.due > 0;
  }

  /** busy: an edit is under way (a drag), so the picture waits for it to end. */
  render(view: MapView, busy = false): void {
    const d = this.doc();
    const look = view.shownLook;
    const stale = this.builtDoc !== d || this.builtFor !== d.version || this.builtLook !== look;
    if (stale || !this.image || this.image.width !== d.width || this.image.height !== d.height) {
      // Flat colours at once, so the minimap never lags an edit; the proper picture follows when things settle.
      if (this.builtDoc !== d || this.builtFor !== d.version || !this.image) {
        const img = new ImageData(d.width, d.height);
        for (let i = 0; i < d.width * d.height; i++) {
          const [r, g, b] = this.colours[d.terrain[i]! & 127]!;
          const dark = d.objects.has(i) ? 0.45 : 1;
          img.data.set([r * dark, g * dark, b * dark, 255], i * 4);
        }
        this.image = img;
      }
      if (this.builtDoc !== d || this.builtLook !== look) this.picture = null;
      this.builtFor = d.version;
      this.builtDoc = d;
      this.builtLook = look;
      this.due = performance.now() + (this.picture ? 600 : 0);
    }
    if (this.due && !busy && performance.now() >= this.due) {
      this.due = 0;
      this.picture = view.snapshot(MINIMAP_PICTURE);
    }
    const size = this.canvas.clientWidth;
    const dpr = devicePixelRatio || 1;
    if (this.canvas.width !== size * dpr) {
      this.canvas.width = size * dpr;
      this.canvas.height = size * dpr;
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#123';
    ctx.fillRect(0, 0, size, size);
    const k = size / Math.max(d.width, d.height);
    if (this.picture && !this.due) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.picture, 0, 0, size, size);
    } else {
      const tmp = new OffscreenCanvas(d.width, d.height);
      tmp.getContext('2d')!.putImageData(this.image!, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(tmp, 0, 0, d.width * k, d.height * k);
    }
    d.bases.forEach((b, i) => {
      ctx.fillStyle = BASE_CSS[i]!;
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      const s = Math.max(4, 3 * k);
      ctx.fillRect((b.start.x + 0.5) * k - s / 2, (b.start.y + 0.5) * k - s / 2, s, s);
      ctx.strokeRect((b.start.x + 0.5) * k - s / 2, (b.start.y + 0.5) * k - s / 2, s, s);
    });
    const c = view.viewCorners();
    if (c.every(Boolean)) {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.beginPath();
      c.forEach((p, i) => (i ? ctx.lineTo((p!.x / 32) * k, (p!.y / 32) * k) : ctx.moveTo((p!.x / 32) * k, (p!.y / 32) * k)));
      ctx.closePath();
      ctx.stroke();
    }
  }
}
