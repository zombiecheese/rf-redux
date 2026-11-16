// The Return Fire: Redux logo at the top of the main menu, in place of a plain heading, and the favicon: 90s pixel
// art drawn by code, "RETURN" in sky-and-earth chrome over "FIRE" in molten metal, with demo-scene flames (the
// spreading-heat fire of mid-90s PC games) licking up behind them, and "REDUX" painted on an olive-drab army plate
// bolted under FIRE. Nothing here comes from the original game.

import { BIG, Pixels, SMALL, fbm, hexes, lettering, outline, ramp, rng, type Colour, type Laid } from './pixelart.js';

export const LOGO_W = 160;
export const LOGO_H = 90;

const CHROME_SKY = hexes('#1c2c5c', '#30509a', '#5a84cc', '#9ec0ee', '#e2eeff', '#ffffff');
const CHROME_EARTH = hexes('#3a2410', '#6a4420', '#9c7038', '#c89e60', '#ecd09a');
const MOLTEN = hexes('#5a0800', '#9a1800', '#d23c00', '#f07a10', '#ffb830', '#ffe880', '#fffbe0');
const [LINE, SHADOW, HORIZON] = [...hexes('#0c0402', '#000000', '#141c30')] as [Colour, Colour, Colour];
/** The REDUX plate: olive drab, lit from the top left, and its sand stencil paint. */
const OLIVE = hexes('#1e2410', '#2e3818', '#424e22', '#56632c', '#6c7a38', '#8a9850');
const STENCIL = hexes('#8c7a4c', '#b8a46c', '#d8c68e', '#f0e2b0');
const [RIVET, RIVET_LIT] = hexes('#151a0a', '#a8b470') as [Colour, Colour];
/** The fire's colours by heat, black to white; heat 0 is clear. */
const FLAME = hexes('#1c0200', '#3c0600', '#5e0c00', '#821400', '#a41e00', '#c02c00', '#d63c00', '#e85400', '#f06c08', '#f68814',
  '#faa420', '#fcbc30', '#fed048', '#fee068', '#fff090', '#fff8c0', '#ffffff');
const HOT = FLAME.length;

/** Chrome: a blue sky above the middle, a dark horizon, brown earth below, as on a thousand 90s logos. */
function chrome(l: Laid, px: Pixels, dx: number, dy: number): void {
  const { mask } = l;
  outline(px, mask, dx, dy, LINE, SHADOW, 2);
  const mid = Math.floor(mask.h * 0.5);
  for (let y = 0; y < mask.h; y++) {
    for (let x = 0; x < mask.w; x++) {
      if (!mask.has(x, y)) continue;
      let c: Colour;
      if (y < mid) c = ramp(CHROME_SKY, y / mid + 0.08, x, y);
      else if (y === mid) c = HORIZON;
      else c = ramp(CHROME_EARTH, (y - mid) / (mask.h - mid) * 0.9 + 0.1, x, y);
      if (!mask.has(x, y - 1) || !mask.has(x - 1, y)) c = CHROME_SKY[5]!;
      px.set(x + dx, y + dy, c);
    }
  }
}

/** Molten metal: white-hot at the top, cooling to red at the bottom, mottled. */
function molten(l: Laid, px: Pixels, dx: number, dy: number): void {
  const { mask } = l;
  outline(px, mask, dx, dy, LINE, SHADOW, 2);
  for (let y = 0; y < mask.h; y++) {
    for (let x = 0; x < mask.w; x++) {
      if (!mask.has(x, y)) continue;
      const edge = !mask.has(x, y - 1) ? 0.25 : !mask.has(x, y + 1) || !mask.has(x + 1, y) ? -0.2 : 0;
      px.set(x + dx, y + dy, ramp(MOLTEN, 1 - y / mask.h * 0.85 + (fbm(x / 6, y / 6, 50) - 0.5) * 0.35 + edge, x, y));
    }
  }
}

/** A painted steel plate with `text` stencilled on it, its top left at (dx, dy); returns the plate's size. */
function plate(text: Laid, px: Pixels, dx: number, dy: number, pad: number): { w: number; h: number } {
  const w = text.mask.w + pad * 2, h = text.mask.h + pad * 2;
  const inside = (x: number, y: number) => {
    // A rectangle with its corners cut off by two pixels.
    const cx = Math.min(x, w - 1 - x), cy = Math.min(y, h - 1 - y);
    return x >= 0 && y >= 0 && x < w && y < h && cx + cy >= 2;
  };
  for (let y = -1; y <= h + 2; y++) {
    for (let x = -1; x <= w + 2; x++) {
      if (inside(x, y)) continue;
      const near = inside(x - 1, y) || inside(x + 1, y) || inside(x, y - 1) || inside(x, y + 1);
      if (near) px.set(x + dx, y + dy, LINE);
      else if (inside(x - 2, y - 2)) px.set(x + dx, y + dy, SHADOW);
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!inside(x, y)) continue;
      // Bevelled: light on the top and left edges, dark on the bottom and right, worn paint between.
      const edge = !inside(x, y - 1) || !inside(x - 1, y) ? 0.3 : !inside(x, y + 1) || !inside(x + 1, y) ? -0.35 : 0;
      px.set(x + dx, y + dy, ramp(OLIVE, 0.62 - y / h * 0.3 + (fbm(x / 4, y / 4, 70) - 0.5) * 0.3 + edge, x, y));
    }
  }
  // A rivet in each corner.
  for (const [rx, ry] of [[2, 2], [w - 3, 2], [2, h - 3], [w - 3, h - 3]] as const) {
    px.set(rx + dx, ry + dy, RIVET);
    px.set(rx + dx - 1, ry + dy - 1, RIVET_LIT);
  }
  // The stencil: sand paint, darker towards the bottom of each letter, worn in places.
  const { mask } = text;
  for (let y = 0; y < mask.h; y++) {
    for (let x = 0; x < mask.w; x++) {
      if (mask.has(x, y)) px.set(x + dx + pad, y + dy + pad, ramp(STENCIL, 1 - y / mask.h * 0.7 + (fbm(x / 3, y / 3, 80) - 0.5) * 0.4, x, y));
    }
  }
  return { w, h };
}

/** The spreading-heat fire: heat rises a row at a time, drifting sideways and cooling at random. */
class Fire {
  readonly heat: Uint8Array;

  constructor(readonly w: number, readonly h: number, private readonly random: () => number) {
    this.heat = new Uint8Array(w * h);
  }

  /** Keeps `sources` (x, y pairs) burning and lets the heat rise one step, cooling faster for more `cool`. */
  step(sources: readonly number[], fuel: number, cool = 0): void {
    const { w, h, heat } = this;
    for (let i = 0; i < sources.length; i += 2) {
      if (this.random() < fuel) heat[sources[i + 1]! * w + sources[i]!] = HOT;
    }
    for (let y = 1; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const r = Math.floor(this.random() * 3);
        const to = Math.min(w - 1, Math.max(0, x - r + 1));
        heat[(y - 1) * w + to] = Math.max(0, heat[y * w + x]! - (r & 1) - (cool && this.random() < cool ? 1 : 0));
      }
    }
  }

  /** Draws the flames into px where they are hot enough to show. */
  paint(px: Pixels): void {
    for (let i = 0; i < this.heat.length; i++) {
      const v = this.heat[i]!;
      if (v > 1) px.data[i] = FLAME[Math.min(HOT - 1, v - 1)]!;
    }
  }
}

/** The menu's logo, on a canvas that animates while it is on the page. */
export class Logo {
  readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly letters = new Pixels(LOGO_W, LOGO_H);
  private readonly frame = new Pixels(LOGO_W, LOGO_H);
  private readonly fire = new Fire(LOGO_W, LOGO_H, rng(5));
  private readonly sources: number[] = [];
  private raf = 0;
  private last = 0;

  constructor() {
    const c = this.canvas;
    c.width = LOGO_W;
    c.height = LOGO_H;
    c.className = 'menu-logo';
    c.setAttribute('role', 'img');
    c.setAttribute('aria-label', 'Return Fire: Redux');
    this.ctx = c.getContext('2d')!;
    const ret = lettering('RETURN', BIG, 3);
    const fire = lettering('FIRE', BIG, 4);
    const redux = lettering('REDUX', SMALL, 2);
    const fx = (LOGO_W - fire.mask.w) >> 1, fy = 32;
    chrome(ret, this.letters, (LOGO_W - ret.mask.w) >> 1, 2);
    molten(fire, this.letters, fx, fy);
    // FIRE is burning: the flames rise out of every stroke and up past RETURN.
    for (let y = 0; y < fire.mask.h; y++) for (let x = 0; x < fire.mask.w; x++) if (fire.mask.has(x, y)) this.sources.push(x + fx, y + fy);
    // REDUX is bolted on below, over FIRE's feet.
    const pad = 4;
    plate(redux, this.letters, (LOGO_W - redux.mask.w - pad * 2) >> 1, LOGO_H - redux.mask.h - pad * 2 - 4, pad);
    // Warm the fire up, so it is already burning when the menu first opens.
    for (let i = 0; i < 60; i++) this.fire.step(this.sources, 0.9);
    this.draw();
  }

  /** Animates while the canvas is on the page (the menu's first page), and stops once it is taken off. */
  start(): void {
    if (this.raf || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const tick = (now: number) => {
      if (!this.canvas.isConnected) {
        this.raf = 0;
        return;
      }
      if (now - this.last > 45) {
        this.last = now;
        this.fire.step(this.sources, 0.9);
        this.draw();
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  /** One step of the fire, drawn: for the logo shown on a picture of its own (the classic loading screen). */
  step(): void {
    this.fire.step(this.sources, 0.9);
    this.draw();
  }

  private draw(): void {
    this.frame.data.fill(0);
    this.fire.paint(this.frame);
    this.frame.blit(this.letters, 0, 0);
    this.frame.paint(this.ctx);
  }
}

/**
 * The favicon (32 x 32): "RF" in chrome on a dark badge, with the fire behind. tools/favicon.mjs writes it out as
 * packages/client/favicon.svg.
 */
export function favicon(): Pixels {
  const size = 32;
  const px = new Pixels(size, size);
  const fire = new Fire(size, size, rng(9));
  const sources: number[] = [];
  for (let x = 2; x < size - 2; x++) sources.push(x, size - 1);
  for (let i = 0; i < 80; i++) fire.step(sources, 0.95, 0.5);
  const [badge, rim] = hexes('#10141c', '#3a4252') as [Colour, Colour];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // A rounded square.
      const cx = Math.max(0, Math.abs(x - 15.5) - 11), cy = Math.max(0, Math.abs(y - 15.5) - 11);
      const d = Math.hypot(cx, cy);
      if (d > 4.6) continue;
      const v = fire.heat[y * size + x]!;
      px.set(x, y, d > 3.6 ? rim : v > 1 ? FLAME[Math.min(HOT - 1, v - 1)]! : badge);
    }
  }
  const rf = lettering('RF', SMALL, 2);
  chrome(rf, px, (size - rf.mask.w) >> 1, 7);
  return px;
}
