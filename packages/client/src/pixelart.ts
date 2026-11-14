// Helpers for the remake's own code-drawn 90s pixel art (the Zombiecheese Productions splash, the Return Fire: Redux logo
// and the favicon): a pixel buffer, seeded hashes and value noise, ordered dithering, and two blocky bitmap fonts.
// Everything is drawn from code; nothing comes from the original game's files.

/** A colour packed as the bytes of an ImageData pixel (little-endian ABGR); 0 is transparent. */
export type Colour = number;

export const rgb = (r: number, g: number, b: number, a = 255): Colour => ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
/** A colour from "#rrggbb". */
export const hex = (s: string): Colour => rgb(parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16));
export const hexes = (...s: string[]): Colour[] => s.map(hex);

export const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));

/** A picture being drawn, pixel by pixel. */
export class Pixels {
  readonly data: Uint32Array;

  constructor(readonly w: number, readonly h: number) {
    this.data = new Uint32Array(w * h);
  }

  set(x: number, y: number, c: Colour): void {
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.data[y * this.w + x] = c;
  }

  get(x: number, y: number): Colour {
    return x >= 0 && y >= 0 && x < this.w && y < this.h ? this.data[y * this.w + x]! : 0;
  }

  /** Copies another picture's opaque pixels in at (dx, dy), leaving out rows from `clip` down. */
  blit(src: Pixels, dx: number, dy: number, clip = Infinity): void {
    for (let y = 0; y < src.h; y++) {
      const ty = y + dy;
      if (ty < 0 || ty >= this.h || ty >= clip) continue;
      for (let x = 0; x < src.w; x++) {
        const c = src.data[y * src.w + x]!;
        if (c >>> 24) this.set(x + dx, ty, c);
      }
    }
  }

  /** Puts the picture on a canvas of the same size. */
  paint(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D): void {
    const img = new ImageData(new Uint8ClampedArray(this.data.buffer.slice(0)), this.w, this.h);
    ctx.putImageData(img, 0, 0);
  }
}

/** Which pixels belong to a shape. */
export class Mask {
  readonly bits: Uint8Array;

  constructor(readonly w: number, readonly h: number) {
    this.bits = new Uint8Array(w * h);
  }

  has(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h && this.bits[y * this.w + x] === 1;
  }

  put(x: number, y: number, on: boolean): void {
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.bits[y * this.w + x] = on ? 1 : 0;
  }

  /** How many of the four neighbours are outside the shape. */
  open(x: number, y: number): number {
    return +!this.has(x - 1, y) + +!this.has(x + 1, y) + +!this.has(x, y - 1) + +!this.has(x, y + 1);
  }

  /** Whether a pixel outside the shape touches it (eight neighbours): where an outline goes. */
  rim(x: number, y: number): boolean {
    if (this.has(x, y)) return false;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if (this.has(x + i, y + j)) return true;
    return false;
  }

  /** How far (up to `max`) from (x, y) in direction (dx, dy) the shape goes on. */
  depth(x: number, y: number, dx: number, dy: number, max: number): number {
    let n = 0;
    while (n < max && this.has(x + dx * (n + 1), y + dy * (n + 1))) n++;
    return n;
  }
}

// ---- Randomness that is the same on every run -------------------------------------------------------------------

/** A hash of a pixel to 0-1. */
export function hash(x: number, y: number, seed = 0): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise, 0-1. */
export function noise(x: number, y: number, seed = 0): number {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, seed), b = hash(xi + 1, yi, seed), c = hash(xi, yi + 1, seed), d = hash(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Three octaves of noise, 0-1. */
export function fbm(x: number, y: number, seed = 0): number {
  return (noise(x, y, seed) * 4 + noise(x * 2, y * 2, seed + 1) * 2 + noise(x * 4, y * 4, seed + 2)) / 7;
}

/** A seeded random number generator (mulberry32), for laying things out. */
export function rng(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
/** The 4 x 4 ordered-dither threshold at a pixel, 0-1. */
export const bayer = (x: number, y: number) => (BAYER[((y & 3) << 2) | (x & 3)]! + 0.5) / 16;

/** The colour v (0-1) falls on along a ramp, dithered between steps as 8-bit art was. */
export function ramp(cols: readonly Colour[], v: number, x: number, y: number): Colour {
  const f = clamp(v) * (cols.length - 1);
  const i = Math.floor(f);
  return cols[Math.min(cols.length - 1, i + (f - i > bayer(x, y) ? 1 : 0))]!;
}

// ---- Fonts ------------------------------------------------------------------------------------------------------

/** A bitmap font: each glyph's rows top to bottom, "#" for a filled cell. */
export type Font = Record<string, string>;

/** Chunky 7 x 9 capitals (T is 8 wide, I 6) for the logos. */
export const BIG: Font = {
  Z: '#######/#######/....##./...##../..##.../.##..../##...../#######/#######',
  O: '.#####./##...##/##...##/##...##/##...##/##...##/##...##/##...##/.#####.',
  M: '##...##/###.###/#######/##.#.##/##...##/##...##/##...##/##...##/##...##',
  B: '######./##...##/##...##/######./##...##/##...##/##...##/##...##/######.',
  I: '######/..##../..##../..##../..##../..##../..##../..##../######',
  E: '#######/##...../##...../######./##...../##...../##...../##...../#######',
  C: '.######/##...../##...../##...../##...../##...../##...../##...../.######',
  H: '##...##/##...##/##...##/#######/##...##/##...##/##...##/##...##/##...##',
  S: '.######/##...../##...../.#####./.....##/.....##/.....##/.....##/######.',
  R: '######./##...##/##...##/######./####.../##.##../##..##./##...##/##...##',
  T: '########/########/...##.../...##.../...##.../...##.../...##.../...##.../...##...',
  U: '##...##/##...##/##...##/##...##/##...##/##...##/##...##/##...##/.#####.',
  N: '##...##/###..##/####.##/##.####/##..###/##...##/##...##/##...##/##...##',
  F: '#######/##...../##...../######./##...../##...../##...../##...../##.....',
};

/** 5 x 7 capitals for small print. */
export const SMALL: Font = {
  A: '.###./#...#/#...#/#####/#...#/#...#/#...#',
  B: '####./#...#/#...#/####./#...#/#...#/####.',
  C: '.####/#..../#..../#..../#..../#..../.####',
  D: '####./#...#/#...#/#...#/#...#/#...#/####.',
  E: '#####/#..../#..../####./#..../#..../#####',
  F: '#####/#..../#..../####./#..../#..../#....',
  I: '###/.#./.#./.#./.#./.#./###',
  K: '#...#/#..#./#.#../##.../#.#../#..#./#...#',
  N: '#...#/##..#/#.#.#/#..##/#...#/#...#/#...#',
  O: '.###./#...#/#...#/#...#/#...#/#...#/.###.',
  P: '####./#...#/#...#/####./#..../#..../#....',
  R: '####./#...#/#...#/####./#.#../#..#./#...#',
  S: '.####/#..../#..../.###./....#/....#/####.',
  T: '#####/..#../..#../..#../..#../..#../..#..',
  U: '#...#/#...#/#...#/#...#/#...#/#...#/.###.',
  W: '#...#/#...#/#...#/#.#.#/#.#.#/##.##/#...#',
  X: '#...#/#...#/.#.#./..#../.#.#./#...#/#...#',
  Y: '#...#/#...#/.#.#./..#../..#../..#../..#..',
  ' ': '.../.../.../.../.../.../...',
};

/** Where each letter of a laid-out line starts and ends, in pixels. */
export interface Laid {
  mask: Mask;
  letters: { x0: number; x1: number }[];
}

/** A line of text as a mask: each font cell `block` pixels square, `gap` cells between letters. */
export function lettering(text: string, font: Font, block: number, gap = 1): Laid {
  const glyphs = [...text].map((ch) => font[ch]!.split('/'));
  const height = glyphs[0]!.length * block;
  const width = glyphs.reduce((w, g) => w + g[0]!.length, 0) * block + (glyphs.length - 1) * gap * block;
  const mask = new Mask(width, height);
  const letters: Laid['letters'] = [];
  let at = 0;
  for (const g of glyphs) {
    g.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) {
        if (row[i] !== '#') continue;
        for (let y = 0; y < block; y++) for (let x = 0; x < block; x++) mask.put(at + i * block + x, j * block + y, true);
      }
    });
    letters.push({ x0: at, x1: at + g[0]!.length * block });
    at += (g[0]!.length + gap) * block;
  }
  return { mask, letters };
}

/** Rounds a shape's outer corners off by a pixel, `times` over. */
export function roundCorners(m: Mask, times = 1): void {
  for (let k = 0; k < times; k++) {
    const off: number[] = [];
    for (let y = 0; y < m.h; y++) {
      for (let x = 0; x < m.w; x++) {
        if (!m.has(x, y)) continue;
        const h = !m.has(x - 1, y) || !m.has(x + 1, y);
        const v = !m.has(x, y - 1) || !m.has(x, y + 1);
        if (h && v) off.push(x, y);
      }
    }
    for (let i = 0; i < off.length; i += 2) m.put(off[i]!, off[i + 1]!, false);
  }
}

/**
 * Draws a shape's outline (one pixel round it) and a drop shadow (`shadow` pixels down and right) into `p`, at
 * (dx, dy), where they do not cover the shape.
 */
export function outline(p: Pixels, m: Mask, dx: number, dy: number, line: Colour, shade: Colour, shadow = 2): void {
  for (let y = -1; y <= m.h + shadow + 1; y++) {
    for (let x = -1; x <= m.w + shadow + 1; x++) {
      if (m.has(x, y)) continue;
      if (m.rim(x, y)) p.set(x + dx, y + dy, line);
      else if (shade && (m.has(x - shadow, y - shadow) || m.rim(x - shadow, y - shadow))) p.set(x + dx, y + dy, shade);
    }
  }
}
