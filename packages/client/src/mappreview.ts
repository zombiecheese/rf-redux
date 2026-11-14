// Map previews for the screens that pick a map (the Level Selector, the lobby's map picker, the lobby itself and the
// editor's Shared Maps): the whole map drawn by the game's own renderer looking straight down, as the level editor's
// top view does, with each base's start marked in its colour. Flag sites are left off: finding the flag is the game.

import { BRIDGE_END, GRID, WATER_TERRAIN, buildWorld, createMatch, decodeTerrain, encodeTerrain, type RfwMap } from '@rfw/sim';
import type { GameData } from './assets.js';
import { Camera } from './camera.js';
import { el } from './dialogs.js';
import { TEAMS } from './paint.js';
import { Frame } from './raster.js';
import { drawView } from './view.js';

const TILE = 32;
const FOCAL = 300;
/** Straight down, in 256ths of a turn. */
const TOP = 64;
/** The picture's longest side in frame pixels, before the pixels per tile are rounded down. */
const SIZE = 384;
/** Open sea left around the land when a map is cropped to it. */
const MARGIN = 4;

/**
 * The map as the renderer needs it, even while it is unfinished: a stand-in base until there is one, bridge ends
 * without a partner shown as land (the loader would deck over the rest of the map), and unknown buildings left out.
 */
export function drawable(map: RfwMap, names: ReadonlySet<string>): RfwMap {
  const terrain = decodeTerrain(map.terrain);
  const w = map.width;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < w; x++) {
      const t = terrain[y * w + x]! & 127;
      if (t === BRIDGE_END.W) {
        let k = x + 1;
        while (k < w && (terrain[y * w + k]! & 127) !== BRIDGE_END.E) k++;
        if (k >= w) terrain[y * w + x] = 3;
      } else if (t === BRIDGE_END.N) {
        let k = y + 1;
        while (k < map.height && (terrain[k * w + x]! & 127) !== BRIDGE_END.S) k++;
        if (k >= map.height) terrain[y * w + x] = 3;
      }
    }
  }
  return {
    ...map, terrain: encodeTerrain(terrain), objects: map.objects.filter((o) => names.has(o.type)),
    bases: map.bases.length ? map.bases : [{ id: 0, start: { x: 0, y: 0 }, flagSites: [] }],
    players: { min: 1, max: Math.max(1, map.bases.length) },
  };
}

/**
 * The square of the map worth showing: the land, its buildings and the bases with a little sea around them. Most of
 * the original maps are islands in a 128 x 128 sea, which would otherwise be a speck in the middle of the picture.
 */
export function landSquare(map: RfwMap): { x: number; y: number; size: number } {
  const terrain = decodeTerrain(map.terrain);
  let x0 = map.width;
  let y0 = map.height;
  let x1 = -1;
  let y1 = -1;
  const take = (x: number, y: number) => {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  };
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) if (!WATER_TERRAIN.has(terrain[y * map.width + x]! & 127)) take(x, y);
  }
  for (const o of map.objects) take(o.x, o.y);
  for (const b of map.bases) take(b.start.x, b.start.y);
  if (x1 < 0) return { x: 0, y: 0, size: Math.max(map.width, map.height) };
  const size = Math.min(Math.max(map.width, map.height), Math.max(x1 - x0, y1 - y0) + 1 + MARGIN * 2);
  const place = (lo: number, hi: number, extent: number) => Math.max(Math.min(extent - size, Math.round((lo + hi + 1 - size) / 2)), Math.min(0, extent - size) >> 1);
  return { x: place(x0, x1, map.width), y: place(y0, y1, map.height), size };
}

/** The map seen from straight above, cropped to its land (landSquare), 2 to 8 pixels a tile, with numbered base starts. */
export function mapPicture(data: GameData, source: RfwMap): HTMLCanvasElement {
  const map = drawable(source, new Set(data.defs.map((d) => d.name)));
  const crop = landSquare(source);
  const p = Math.max(2, Math.min(8, Math.floor(SIZE / crop.size)));
  const w = crop.size * p;
  const h = w;
  const frame = new Frame(w, h);
  const cam = new Camera({ x: 0, y: 0, w, h, dx: 0, dy: 0, boxW: w, boxH: h });
  const ox = (GRID - map.width) >> 1;
  const oy = (GRID - map.height) >> 1;
  const scale = p / TILE;
  cam.fix((ox + crop.x + crop.size / 2) * TILE, (oy + crop.y + crop.size / 2) * TILE, FOCAL / scale - FOCAL, TOP);
  const world = buildWorld(map, data.defs, data.shore);
  const match = createMatch(world, map, map.bases.map((b) => ({ base: b.id, team: b.id })), 1);
  drawView(frame, cam, match, { ...data, map }, 0);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(frame.px.buffer), w, h), 0, 0);
  // Each base's lift: a disc in its colour with its number, sized to read at any map size.
  const r = Math.max(7, p * 1.4);
  ctx.font = `700 ${Math.round(r * 1.25)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  source.bases.forEach((b, i) => {
    const x = (b.start.x - crop.x + 0.5) * p;
    const y = (b.start.y - crop.y + 0.5) * p;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = TEAMS[i]?.css ?? '#fff';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(0, 0, 0, .75)';
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.fillText(String(i + 1), x, y + 0.5);
  });
  return canvas;
}

/** Pictures already drawn, by the key their screen gave them (an id, and a revision where maps change). */
interface Picture {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  bases: number;
}
const pictures = new Map<string, Promise<Picture | null>>();
const KEEP = 60;

function picture(key: string, data: () => Promise<GameData>, load: () => Promise<RfwMap | null>): Promise<Picture | null> {
  let made = pictures.get(key);
  if (!made) {
    made = Promise.all([data(), load()])
      .then(([d, map]) => (map ? { canvas: mapPicture(d, map), width: map.width, height: map.height, bases: map.bases.length } : null))
      .catch(() => null);
    pictures.set(key, made);
    // A failed load is tried again next time; the oldest pictures go first once there are many.
    void made.then((c) => c || pictures.delete(key));
    if (pictures.size > KEEP) pictures.delete(pictures.keys().next().value!);
  }
  return made;
}

export interface PreviewInfo {
  name: string;
  /** How many bases, when known before the map loads (list entries carry it). */
  bases?: number;
  /** A line under the name: the map's group, author and so on. */
  note?: string;
}

/**
 * A preview panel: the picture, the map's name and a line about it. show() swaps the map; pictures are made once
 * and kept, and only the last map asked for is shown, so scrolling a list with the arrow keys stays quick.
 */
export class MapPreview {
  readonly root: HTMLElement;
  private readonly screen = el('canvas', { class: 'map-preview-picture' });
  private readonly frame = el('div', { class: 'map-preview-frame' }, this.screen);
  private readonly name = el('b', { class: 'map-preview-name' });
  private readonly meta = el('div', { class: 'map-preview-meta' });
  private readonly bases = el('div', { class: 'map-preview-bases' });
  /** Room under the text for a screen's own buttons (the lobby host's Change). */
  readonly actions = el('div', { class: 'map-preview-actions' });
  private wanted = '';
  private timer = 0;
  private info: PreviewInfo = { name: '' };
  /** The loaded map's size and bases, which beat what the list said. */
  private size: { width: number; height: number; bases: number } | null = null;

  /** compact: a smaller picture beside the text (the lobby); bare: the picture alone, for screens that say the rest. */
  constructor(private readonly data: () => Promise<GameData>, opts: { compact?: boolean; bare?: boolean } = {}) {
    this.root = el('div', { class: 'map-preview' + (opts.compact ? ' compact' : '') }, this.frame,
      ...(opts.bare ? [] : [el('div', { class: 'map-preview-text' }, this.name, this.meta, this.bases, this.actions)]));
  }

  /** Shows a map; load fetches it (null when it can't be had, which shows the name without a picture). */
  show(key: string, info: PreviewInfo, load: () => Promise<RfwMap | null>): void {
    this.info = info;
    if (key === this.wanted) {
      // The same map, perhaps better described (the lobby learns a map's group once the map list arrives).
      this.describe();
      return;
    }
    this.wanted = key;
    this.size = null;
    this.describe();
    this.screen.hidden = true;
    this.frame.classList.add('loading');
    this.frame.classList.remove('none');
    clearTimeout(this.timer);
    // A short wait, so holding an arrow key down the list draws only where it stops.
    this.timer = window.setTimeout(() => {
      void picture(key, this.data, load).then((p) => {
        if (key !== this.wanted) return;
        this.frame.classList.remove('loading');
        if (!p) {
          this.frame.classList.add('none');
          return;
        }
        const c = p.canvas;
        this.screen.width = c.width;
        this.screen.height = c.height;
        this.screen.getContext('2d')!.drawImage(c, 0, 0);
        this.screen.hidden = false;
        this.size = p;
        this.describe();
      });
    }, pictures.has(key) ? 0 : 60);
  }

  /** Shows nothing (an empty list). */
  clear(text = ''): void {
    this.wanted = '';
    clearTimeout(this.timer);
    this.info = { name: text };
    this.size = null;
    this.describe();
    this.screen.hidden = true;
    this.frame.classList.remove('loading');
    this.frame.classList.add('none');
  }

  private describe(): void {
    const s = this.size;
    this.name.textContent = this.info.name;
    this.meta.textContent = [this.info.note, s && `${s.width} × ${s.height} tiles`].filter(Boolean).join(' · ');
    const n = s?.bases ?? this.info.bases ?? 0;
    this.bases.replaceChildren(...TEAMS.slice(0, n).map((t, i) => {
      const dot = el('i');
      dot.style.background = t.css;
      return el('span', { class: 'map-preview-base' }, dot, `${i + 1} ${t.name}`);
    }));
  }
}
