// The full-screen pictures around the game: the remake's own splash (splash.ts) in place of the original's opening
// logos and intro movie, then the title screen and pause screen. The win scene (winscene.ts) plays through
// `animation`.
// Each picture is shown at the window's size through the same Display as the game, and fades the way the original
// faded its palette towards black.

import { loadPicture } from './assets.js';
import type { Display, Picture } from './display.js';
import { SCREEN_H, SCREEN_W } from './raster.js';

const TITLE_ART = new URL('./title/title-art.png', import.meta.url).href;

export class Stage {
  private readonly low = new OffscreenCanvas(SCREEN_W, SCREEN_H);
  private readonly lowCtx = this.low.getContext('2d')!;
  private readonly pictures = new Map<string, Promise<HTMLImageElement | null>>();
  private title: Promise<HTMLImageElement | null> | null = null;
  private still: { draw: () => void } | null = null;
  /**
   * Bumped by everything that takes the screen, so a fade or movie that was skipped or overtaken stops drawing
   * instead of painting over what replaced it.
   */
  private owner = 0;

  constructor(private readonly display: Display) {
    // A still picture stays drawn at the right size when the window changes.
    addEventListener('resize', () => this.still?.draw());
  }

  /** The original drew its 640 x 480 pictures when the window could hold them, else the 320 x 240 ones. */
  private get hiRes(): boolean {
    const dpr = devicePixelRatio || 1;
    return innerWidth * dpr >= 640 && innerHeight * dpr >= 480;
  }

  picture(name: string): Promise<HTMLImageElement | null> {
    let p = this.pictures.get(name);
    if (!p) this.pictures.set(name, (p = loadPicture(name)));
    return p;
  }

  /** The hi-res picture when the window suits it and it exists, else the low-res one. */
  async pick(low: string, hi?: string): Promise<HTMLImageElement | null> {
    if (hi && this.hiRes) {
      const img = await this.picture(hi);
      if (img) return img;
    }
    return this.picture(low);
  }

  /** Shows a picture and leaves it up (title, pause), until something else is drawn. */
  show(img: Picture | null): void {
    this.owner++;
    const draw = () => {
      if (img) this.display.present(img);
      else this.blank();
    };
    this.still = { draw };
    draw();
  }

  /**
   * The title screen's art: the remake's own widescreen picture of all four sides (drawn by tools/title-art), so it
   * is there with or without the imported assets.
   */
  titleArt(): Promise<HTMLImageElement | null> {
    this.title ??= (async () => {
      const img = new Image();
      img.src = TITLE_ART;
      try {
        await img.decode();
        return img;
      } catch {
        return null;
      }
    })();
    return this.title;
  }

  blank(): void {
    this.release();
    this.lowCtx.fillStyle = '#000';
    this.lowCtx.fillRect(0, 0, SCREEN_W, SCREEN_H);
    this.display.present(this.low);
  }

  /** Hands the screen to the game: nothing here draws until the next picture. */
  release(): void {
    this.owner++;
    this.still = null;
  }

  /**
   * Draws `source` with the brightness from `level(elapsed)` each frame for `ms`; skip ends it early. Resolves
   * false if something else took the screen meanwhile. smooth draws a picture that is not pixel art (the modern view).
   */
  private animate(source: () => Picture, ms: number,
    level: (t: number) => number, skip?: AbortSignal, smooth = false): Promise<boolean> {
    this.still = null;
    const mine = ++this.owner;
    return new Promise((resolve) => {
      const start = performance.now();
      const frame = (now: number) => {
        if (mine !== this.owner) return resolve(false);
        const t = now - start;
        if (skip?.aborted || t >= ms) {
          this.display.present(source(), level(ms), smooth);
          return resolve(true);
        }
        this.display.present(source(), level(t), smooth);
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
  }

  /**
   * Plays a code-drawn animation of w x h pixels (draw is given the ms since it began) until ms, or until skip,
   * fading in over its first fadeIn ms and out over its last fadeOut. Resolves false if something else took the
   * screen meanwhile. smooth: as for animate.
   */
  animation(w: number, h: number, draw: (ctx: OffscreenCanvasRenderingContext2D, ms: number) => void, ms: number,
    fadeIn: number, fadeOut: number, skip?: AbortSignal, smooth = false): Promise<boolean> {
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d')!;
    return this.animate(() => canvas, ms, (t) => {
      draw(ctx, t);
      return Math.min(fadeIn ? t / fadeIn : 1, fadeOut ? (ms - t) / fadeOut : 1, 1);
    }, skip, smooth);
  }

  /** Fades whatever picture is given (the last game frame) to black. */
  fadeOut(img: Picture, ms: number, skip?: AbortSignal, smooth = false): Promise<boolean> {
    return this.animate(() => img, ms, (e) => 1 - e / ms, skip, smooth);
  }
}
