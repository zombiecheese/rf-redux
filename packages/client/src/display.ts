// Putting the 320 x 240 frame on the page: it fills as much of the window as it can at 4:3, with every game pixel
// a square block, and phones and tablets play in landscape only. The classic view always wears a subtle CRT look.
// The bars left round it are filled with a pixel camo (camo.ts) in the colour of whoever is playing.

import { camoTile, camoTones, TILE } from './camo.js';
import { SCREEN_H, SCREEN_W } from './raster.js';

/**
 * Phones and tablets: a touch screen as the main pointer, or an iPad (which reports itself as a Mac). These play
 * landscape only and without the local split screen, which needs two people at one keyboard.
 */
export function isHandheld(): boolean {
  const coarse = matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;
  const iPad = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  return coarse || iPad || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

/** True while a handheld is held upright, when the game waits for it to be turned. */
export function isPortrait(): boolean {
  return innerHeight > innerWidth;
}

/** Resolves once the window is wider than it is tall (at once if it already is). */
export function untilLandscape(): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      if (isPortrait()) return;
      removeEventListener('resize', check);
      resolve();
    };
    addEventListener('resize', check);
    check();
  });
}

/**
 * Held upright, a handheld takes no keys, taps or clicks at all: the rotate notice covers the page, and nothing
 * behind it (the start prompt, the splash, the title's menu, a dialog) may move on unseen. The landscape lock's
 * first touch still gets through, since it is what turns some screens round.
 */
export function blockWhileUpright(): void {
  const block = (e: Event) => {
    if (!isPortrait()) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  // Only what starts something: a key or touch let go after the device was turned up still reaches whatever held it.
  for (const type of ['keydown', 'pointerdown', 'click', 'touchstart'] as const) {
    addEventListener(type, block, { capture: true, passive: false });
  }
}

/**
 * On a handheld, the first touch asks for full screen and a landscape lock where the browser allows it (Android
 * Chrome does; iPhone Safari does neither, so the rotate notice in index.html covers it).
 */
export function lockLandscape(): void {
  addEventListener('pointerdown', () => {
    const root = document.documentElement;
    const lock = () => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape')?.catch(() => {});
    if (!document.fullscreenElement && root.requestFullscreen) root.requestFullscreen().then(lock, () => {});
    else lock();
  }, { once: true, capture: true });
}

/**
 * How the frame is scaled up:
 * - sharp (the default): fills the window. The frame is first enlarged by the next whole number with hard pixel
 *   edges, then smoothed down to the exact size, so every pixel comes out the same size with only a one-pixel
 *   soft seam. Plain nearest-neighbour at a fractional scale makes some pixels a screen pixel wider than others,
 *   which shimmers as the map scrolls.
 * - integer (?scale=integer): only whole-number scales, with a wider border.
 */
export type ScaleMode = 'sharp' | 'integer';

/** Anything the display can put up: the game frame, or one of the original's pictures. */
export type Picture = OffscreenCanvas | HTMLCanvasElement | HTMLImageElement;

/** The classic view's CRT look: how dark the gap under each line is, and how strong the glow. Kept subtle. */
const SCANLINE_ALPHA = 0.22;
/** The dark part of each picture line, as a fraction of its height. */
const SCANLINE_GAP = 0.4;
const GLOW_ALPHA = 0.3;
const VIGNETTE_ALPHA = 0.25;

export class Display {
  readonly canvas = document.createElement('canvas');
  private readonly ctx = this.canvas.getContext('2d')!;
  private readonly big = document.createElement('canvas');
  private readonly bigCtx = this.big.getContext('2d')!;
  private readonly crtLook = new CrtLook();
  /** The camo for the bars round the picture at its current size and placing, drawn once per change. */
  private readonly bars = document.createElement('canvas');
  private readonly barsLow = document.createElement('canvas');
  private barsFor = '';

  /**
   * Whose colour the bars are camouflaged in: the base each view follows, left to right (one in a single view, two
   * in the split screen, where each half of the window takes its own side's colour). Empty outside a match, for a
   * neutral grey camo.
   */
  sides: readonly number[] = [];

  /**
   * @param crt Scanlines and a soft glow over the picture, like a TV of the time. Only drawn when each picture line
   * is at least two screen pixels tall, where the lines can be told apart.
   */
  constructor(public mode: ScaleMode = 'sharp', public crt = true) {
    document.body.appendChild(this.canvas);
  }

  /** Where the picture was last drawn, in CSS pixels, for mapping touches back onto the frame. */
  readonly rect = { x: 0, y: 0, w: SCREEN_W, h: SCREEN_H };

  /**
   * Draws a 4:3 picture centred in the window: the 320 x 240 frame, or one of the original's 640 x 480 screens.
   * `brightness` (0-1) is the palette fade (palette-fx, sub_42fdd0): the original scaled every palette entry
   * towards black, which is the same as darkening the finished picture. smooth draws a picture that is not pixel art
   * (the modern view) with plain smoothing, at any scale.
   */
  present(low: Picture, brightness = 1, smooth = false): void {
    this.hideModern();
    const dpr = devicePixelRatio || 1;
    const cw = Math.round(innerWidth * dpr);
    const ch = Math.round(innerHeight * dpr);
    const { canvas, ctx } = this;
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
      canvas.style.width = `${innerWidth}px`;
      canvas.style.height = `${innerHeight}px`;
    }
    const sw = low.width;
    const sh = low.height;
    const fit = Math.min(cw / sw, ch / sh);
    const scale = this.mode === 'integer' && fit >= 1 ? Math.floor(fit) : fit;
    const w = Math.round(sw * scale);
    const h = Math.round(sh * scale);
    const x = (cw - w) >> 1;
    const y = (ch - h) >> 1;
    Object.assign(this.rect, { x: x / dpr, y: y / dpr, w: w / dpr, h: h / dpr });
    this.drawBars(cw, ch, x, y, w, h);
    const whole = Math.ceil(scale - 1e-6);
    if (smooth) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(low, x, y, w, h);
    } else if (Math.abs(scale - whole) < 1e-6 || scale < 1) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(low, x, y, w, h);
    } else {
      const { big, bigCtx } = this;
      if (big.width !== sw * whole || big.height !== sh * whole) {
        big.width = sw * whole;
        big.height = sh * whole;
      }
      bigCtx.imageSmoothingEnabled = false;
      bigCtx.drawImage(low, 0, 0, big.width, big.height);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'low';
      ctx.drawImage(big, x, y, w, h);
    }
    if (this.crt && !smooth && h / sh >= 2) this.drawCrt(low, x, y, w, h, sh);
    if (brightness < 1) {
      // The bars fade with the picture, so a logo still fades in from black.
      ctx.fillStyle = `rgba(0,0,0,${1 - Math.max(0, brightness)})`;
      ctx.fillRect(0, 0, cw, ch);
    }
  }

  /**
   * The bars round a picture drawn at (x, y, w, h). The camo is laid out in game pixels (the picture's height over
   * 240, so the original's 640 x 480 screens get the game's block size too) on the picture's own grid, so its
   * blocks line up with and match the size of the frame's.
   */
  private drawBars(cw: number, ch: number, x: number, y: number, w: number, h: number): void {
    const { ctx, bars } = this;
    if (x <= 0 && y <= 0 && x + w >= cw && y + h >= ch) return;
    const s = h / SCREEN_H;
    const key = `${cw}x${ch}:${x},${y},${s}:${this.sides.join(',')}`;
    if (this.barsFor !== key) {
      this.barsFor = key;
      const left = Math.ceil(x / s);
      const top = Math.ceil(y / s);
      const lw = Math.ceil((cw - x) / s) + left;
      const lh = Math.ceil((ch - y) / s) + top;
      const low = this.barsLow;
      low.width = lw;
      low.height = lh;
      const lc = low.getContext('2d')!;
      const data = lc.createImageData(lw, lh);
      const px = data.data;
      const pattern = camoTile();
      const first = camoTones(this.sides[0] ?? null);
      const last = camoTones(this.sides[this.sides.length - 1] ?? null);
      // The column where the window's middle falls, where a split screen's two colours meet.
      const middle = Math.floor((cw / 2 - (x - left * s)) / s);
      for (let j = 0; j < lh; j++) {
        const ty = (((j - top) % TILE) + TILE) % TILE;
        for (let i = 0; i < lw; i++) {
          const tx = (((i - left) % TILE) + TILE) % TILE;
          const [r, g, b] = (i < middle ? first : last)[pattern[ty * TILE + tx]!]!;
          const o = (j * lw + i) * 4;
          px[o] = r;
          px[o + 1] = g;
          px[o + 2] = b;
          px[o + 3] = 255;
        }
      }
      lc.putImageData(data, 0, 0);
      bars.width = cw;
      bars.height = ch;
      const bc = bars.getContext('2d')!;
      bc.imageSmoothingEnabled = false;
      bc.drawImage(low, x - left * s, y - top * s, lw * s, lh * s);
    }
    // Only the bars: the picture covers the rest.
    const strip = (sx: number, sy: number, sw: number, sh: number) => {
      if (sw > 0 && sh > 0) ctx.drawImage(bars, sx, sy, sw, sh, sx, sy, sw, sh);
    };
    strip(0, 0, x, ch);
    strip(x + w, 0, cw - x - w, ch);
    strip(0, 0, cw, y);
    strip(0, y + h, cw, ch - y - h);
  }

  /** The modern view's layers over the page, once it has shown: its WebGL picture and the HUD over it. */
  private modern: { gl: HTMLCanvasElement; hud: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null = null;

  /** The HUD's canvas, at the screen's own resolution (for copying the finished picture, with modernPicture). */
  get hudCanvas(): HTMLCanvasElement | null {
    return this.modern?.hud ?? null;
  }

  /**
   * Shows the modern view: its WebGL canvas straight on the page, fitted to the window at w:h with the camo bars
   * round it, and a transparent HUD canvas over it at the screen's own pixels, so its text and lines stay sharp at
   * any size. Returns the HUD's context, cleared, drawn in the modern screen's own units (w x h).
   */
  presentModern(gl: HTMLCanvasElement, w: number, h: number): CanvasRenderingContext2D {
    const dpr = devicePixelRatio || 1;
    const cw = Math.round(innerWidth * dpr);
    const ch = Math.round(innerHeight * dpr);
    const { canvas, ctx } = this;
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
      canvas.style.width = `${innerWidth}px`;
      canvas.style.height = `${innerHeight}px`;
      this.barsFor = '';
    }
    const scale = Math.min(cw / w, ch / h);
    const pw = Math.round(w * scale);
    const ph = Math.round(h * scale);
    const x = (cw - pw) >> 1;
    const y = (ch - ph) >> 1;
    Object.assign(this.rect, { x: x / dpr, y: y / dpr, w: pw / dpr, h: ph / dpr });
    this.drawBars(cw, ch, x, y, pw, ph);
    let m = this.modern;
    if (!m || m.gl !== gl) {
      m?.hud.remove();
      const hud = document.createElement('canvas');
      // Over the page's own canvas (whatever layer it sits in), and never in the way of a tap or click on it.
      const z = Number.parseInt(getComputedStyle(canvas).zIndex, 10) || 0;
      for (const [el, k] of [[gl, 1], [hud, 2]] as const) {
        Object.assign(el.style, { position: 'fixed', zIndex: String(z + k), pointerEvents: 'none', margin: '0', display: 'block' });
        canvas.after(el);
      }
      gl.after(hud);
      m = this.modern = { gl, hud, ctx: hud.getContext('2d')! };
    }
    const { hud } = m;
    for (const el of [gl, hud]) {
      Object.assign(el.style, { left: `${x / dpr}px`, top: `${y / dpr}px`, width: `${pw / dpr}px`, height: `${ph / dpr}px`, visibility: '' });
    }
    if (hud.width !== pw || hud.height !== ph) {
      hud.width = pw;
      hud.height = ph;
    }
    const g = m.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, pw, ph);
    g.setTransform(pw / w, 0, 0, ph / h, 0, 0);
    return g;
  }

  /** Puts the modern view's last picture, HUD and all, into a 2D context (only in the frame it was drawn). */
  modernPicture(g: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
    const m = this.modern;
    if (!m) return;
    g.drawImage(m.gl, x, y, w, h);
    g.drawImage(m.hud, x, y, w, h);
  }

  /** Takes the modern view's layers off the page (the classic view, a menu or a still picture shows instead). */
  hideModern(): void {
    const m = this.modern;
    if (!m || m.hud.style.visibility === 'hidden') return;
    m.gl.style.visibility = 'hidden';
    m.hud.style.visibility = 'hidden';
  }

  /** Takes the display off the page altogether. */
  remove(): void {
    this.canvas.remove();
    this.modern?.hud.remove();
    this.modern?.gl.remove();
    this.modern = null;
  }

  private drawCrt(low: Picture, x: number, y: number, w: number, h: number, rows: number): void {
    this.crtLook.draw(this.ctx, low, x, y, w, h, rows);
  }

}

/**
 * The classic view's CRT look: scanlines, a soft glow and a vignette over a picture already drawn at (x, y, w, h) in
 * a 2D context's pixels. Shared by the game's display and the level editor's Classic preview.
 */
export class CrtLook {
  /** The glow: the picture at half size, smoothed back up and screened over it, which blurs and brightens. */
  private readonly glow = document.createElement('canvas');
  private readonly glowCtx = this.glow.getContext('2d')!;
  /** Scanlines and a vignette for the picture's current size, drawn once and laid over every frame. */
  private readonly lines = document.createElement('canvas');
  private linesFor = '';

  /** rows is the picture's height in its own pixels: one scanline under each. */
  draw(ctx: CanvasRenderingContext2D, low: Picture, x: number, y: number, w: number, h: number, rows: number): void {
    const { glow, glowCtx, lines } = this;
    const gw = Math.max(1, low.width >> 1);
    const gh = Math.max(1, low.height >> 1);
    if (glow.width !== gw || glow.height !== gh) {
      glow.width = gw;
      glow.height = gh;
    }
    glowCtx.imageSmoothingEnabled = true;
    glowCtx.drawImage(low, 0, 0, gw, gh);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = GLOW_ALPHA;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(glow, x, y, w, h);
    ctx.restore();
    const key = `${w}x${h}x${rows}`;
    if (this.linesFor !== key) {
      this.linesFor = key;
      lines.width = w;
      lines.height = h;
      const l = lines.getContext('2d')!;
      const step = h / rows;
      l.fillStyle = `rgba(0,0,0,${SCANLINE_ALPHA})`;
      for (let i = 0; i < rows; i++) l.fillRect(0, (i + 1 - SCANLINE_GAP) * step, w, SCANLINE_GAP * step);
      const v = l.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.45, w / 2, h / 2, Math.hypot(w, h) / 2);
      v.addColorStop(0, 'rgba(0,0,0,0)');
      v.addColorStop(1, `rgba(0,0,0,${VIGNETTE_ALPHA})`);
      l.fillStyle = v;
      l.fillRect(0, 0, w, h);
    }
    ctx.drawImage(lines, x, y);
  }
}
