// A software rasteriser for the original's cel list (sub_418ef0), drawing into a 320 x 240 frame.
//
// Like the original mappers (sub_40f750 for trapezoids, sub_40fc20 for any quad), a quad is filled scanline by
// scanline: the texture coordinates are interpolated down each edge, then linearly across each span. There is
// no perspective correction inside a quad and no depth buffer; overlap comes from draw order alone.

import type { Cel } from './assets.js';

export const SCREEN_W = 320;
export const SCREEN_H = 240;

/** Draw modes from the cel records (see the render doc, "Draw modes"). */
const MODE_DARK4 = 1;
const MODE_DARK2 = 2;
const MODE_BLEND_A = 3;
const MODE_BLEND_B = 4;
/** Light (the bunker spotlight, cel 2077): the cel's colours stand for brightness, added half-strength (inferred). */
const MODE_LIGHT = 5;
const MODE_SHADOW = 13;
/** A 4 x 4 ordered dither, for drawing part of a cel's pixels. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

export interface Point {
  x: number;
  y: number;
}

export class Frame {
  readonly px: Uint32Array<ArrayBuffer>;
  private clip: { x0: number; y0: number; x1: number; y1: number };

  /** The game always draws 320 x 240; the level editor's view is sized to its window. */
  constructor(readonly w = SCREEN_W, readonly h = SCREEN_H) {
    this.px = new Uint32Array(w * h);
    this.clip = { x0: 0, y0: 0, x1: w, y1: h };
  }

  setClip(x: number, y: number, w: number, h: number): void {
    this.clip = { x0: x, y0: y, x1: x + w, y1: y + h };
  }

  fill(colour: number): void {
    const { x0, y0, x1, y1 } = this.clip;
    for (let y = y0; y < y1; y++) this.px.fill(colour, y * this.w + x0, y * this.w + x1);
  }

  /**
   * Draws a cel over four screen corners, in the cel's corner order: top left, top right, bottom right, bottom left.
   * opaque draws colour 0 too (cel flag 0x20, set on terrain). keep, 1-15, draws only that many sixteenths of the
   * pixels, for effects fading out (sub_423060 picks one of 15 levels; inferred to be a stipple).
   */
  quad(corners: readonly Point[], cel: Cel, opaque = false, modeOverride?: number, keep = 16): void {
    const mode = modeOverride ?? cel.mode;
    const uv = [0, 0, cel.w, 0, cel.w, cel.h, 0, cel.h];
    let minY = Infinity;
    let maxY = -Infinity;
    for (const c of corners) {
      minY = Math.min(minY, c.y);
      maxY = Math.max(maxY, c.y);
    }
    const yStart = Math.max(this.clip.y0, Math.ceil(minY - 0.5));
    const yEnd = Math.min(this.clip.y1 - 1, Math.floor(maxY - 0.5));
    const { px } = this;
    const tex = cel.px;
    const w = cel.w;
    const maxU = cel.w - 1;
    const maxV = cel.h - 1;
    for (let y = yStart; y <= yEnd; y++) {
      const yc = y + 0.5;
      let xl = Infinity;
      let xr = -Infinity;
      let ul = 0;
      let vl = 0;
      let ur = 0;
      let vr = 0;
      for (let e = 0; e < 4; e++) {
        const a = corners[e]!;
        const b = corners[(e + 1) & 3]!;
        if (a.y === b.y || yc < Math.min(a.y, b.y) || yc > Math.max(a.y, b.y)) continue;
        const t = (yc - a.y) / (b.y - a.y);
        const x = a.x + (b.x - a.x) * t;
        const u = uv[e * 2]! + (uv[((e + 1) & 3) * 2]! - uv[e * 2]!) * t;
        const v = uv[e * 2 + 1]! + (uv[((e + 1) & 3) * 2 + 1]! - uv[e * 2 + 1]!) * t;
        if (x < xl) {
          xl = x;
          ul = u;
          vl = v;
        }
        if (x > xr) {
          xr = x;
          ur = u;
          vr = v;
        }
      }
      if (xr < xl) continue;
      const xs = Math.max(this.clip.x0, Math.ceil(xl - 0.5));
      const xe = Math.min(this.clip.x1 - 1, Math.floor(xr - 0.5));
      const span = xr - xl || 1;
      const du = (ur - ul) / span;
      const dv = (vr - vl) / span;
      let u = ul + (xs + 0.5 - xl) * du;
      let v = vl + (xs + 0.5 - xl) * dv;
      let o = y * this.w + xs;
      for (let x = xs; x <= xe; x++, o++, u += du, v += dv) {
        const tu = u < 0 ? 0 : u > maxU ? maxU : u | 0;
        const tv = v < 0 ? 0 : v > maxV ? maxV : v | 0;
        const c = tex[tv * w + tu]!;
        if (c >>> 24 === 0 && !opaque) continue;
        if (keep < 16 && BAYER[((y & 3) << 2) | (x & 3)]! >= keep) continue;
        switch (mode) {
          case MODE_SHADOW:
            px[o] = shade(px[o]!, 27);
            break;
          // Modes 1 and 2 recolour the screen under the cel's shape, like mode 13: their cels are white masks
          // (vehicle shadows such as cels 217, 462 and 579).
          case MODE_DARK4:
            px[o] = shade(px[o]!, 27);
            break;
          case MODE_DARK2:
            px[o] = shade(px[o]!, 29);
            break;
          case MODE_BLEND_A:
          case MODE_BLEND_B:
            px[o] = blend(px[o]!, c);
            break;
          case MODE_LIGHT:
            px[o] = lighten(px[o]!, c);
            break;
          default:
            px[o] = c | 0xff000000;
        }
      }
    }
  }

  /** Draws a cel or bitmap unscaled with its top left at (x, y), skipping transparent pixels. */
  blit(cel: Cel, x: number, y: number): void {
    const { x0, y0, x1, y1 } = this.clip;
    const { px } = this;
    for (let r = Math.max(0, y0 - y); r < cel.h && y + r < y1; r++) {
      for (let c = Math.max(0, x0 - x); c < cel.w && x + c < x1; c++) {
        const colour = cel.px[r * cel.w + c]!;
        if (colour >>> 24 === 0) continue;
        const o = (y + r) * this.w + x + c;
        const mode = cel.mode;
        px[o] = mode === MODE_BLEND_A || mode === MODE_BLEND_B ? blend(px[o]!, colour) : mode === MODE_LIGHT ? lighten(px[o]!, colour) : colour;
      }
    }
  }

  /**
   * Darkens everything inside the clip to a brightness from 0 to 1, as a view fades between the bunker and the map
   * (the view's +0xbc, drawn by sub_422e00 in 32 levels like the colour tables).
   */
  dim(brightness: number): void {
    const k = Math.max(0, Math.min(32, Math.round(brightness * 32)));
    if (k === 32) return;
    const { x0, y0, x1, y1 } = this.clip;
    const { px } = this;
    for (let y = y0; y < y1; y++) for (let o = y * this.w + x0, e = y * this.w + x1; o < e; o++) px[o] = shade(px[o]!, k);
  }

  /** A solid-colour quad, for things whose models are not ported yet. */
  solid(corners: readonly Point[], colour: number): void {
    this.quad(corners, { w: 1, h: 1, px: new Uint32Array([colour]), mode: 0 }, true);
  }
}

/** Darkening level n of the colour tables (sub_424420): colour * (31 - n) / 32, here as a /32 multiplier. */
function shade(c: number, k: number): number {
  const r = ((c & 0xff) * k) >> 5;
  const g = (((c >> 8) & 0xff) * k) >> 5;
  const b = (((c >> 16) & 0xff) * k) >> 5;
  return (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
}

function blend(a: number, b: number): number {
  return (0xff000000 | ((((a & 0xfefefe) >>> 1) + ((b & 0xfefefe) >>> 1)) & 0xffffff)) >>> 0;
}

function lighten(a: number, light: number): number {
  const l = (((light & 0xff) + ((light >> 8) & 0xff) + ((light >> 16) & 0xff)) / 6) | 0;
  const r = Math.min(255, (a & 0xff) + l);
  const g = Math.min(255, ((a >> 8) & 0xff) + l);
  const b = Math.min(255, ((a >> 16) & 0xff) + l);
  return (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
}

/** RGB to the frame's little-endian RGBA word. */
export function rgb(r: number, g: number, b: number): number {
  return (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
}
