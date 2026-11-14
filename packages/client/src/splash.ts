// The Zombiecheese Productions splash before the title screen, in place of the original's logos and intro movie:
// "ZOMBIE" in rotting flesh, dripping blood and ooze, over "CHEESE" gone mouldy and stinking, with flies. It is drawn
// by code as 90s pixel art at 480 x 270 and animated while the fanfare (music/pieces.ts) plays. main.ts runs it.

import {
  BIG, Mask, Pixels, SMALL, bayer, clamp, fbm, hash, hex, hexes, lettering, noise, outline, ramp, rng, roundCorners,
  type Colour, type Laid,
} from './pixelart.js';

export const SPLASH_W = 480;
export const SPLASH_H = 270;
/** The shortest the splash lasts (ms) when there is no fanfare to wait for. */
export const SPLASH_MS = 6500;

const PAD = 4;
const BLOCK = 6;

const FLESH = hexes('#26351f', '#3c5230', '#577247', '#76925c', '#9db57c', '#c4d3a0');
const BRUISE = hexes('#2c1a30', '#4a2e4c', '#6a4568', '#8c6888');
const WOUND = hexes('#3a0505', '#6e0a0a', '#a3171a', '#d23a32', '#f07a68');
const PUS = hexes('#9aa83a', '#d6d86a');
const STITCH = hexes('#160b08', '#3b2418');
const CHEESE = hexes('#7a4a08', '#a8690e', '#d29a1c', '#f0c03a', '#ffe07a', '#fff4c0');
const HOLE = hexes('#2e1a02', '#5a3504', '#8a560a');
const MOULD = hexes('#22402e', '#35604a', '#4f8460', '#79a876', '#a9c994');
const FUZZ = hexes('#d8e8c8', '#f2f8ea');
const VEIN = hexes('#33506e', '#4b6f92');
const ROT = hexes('#4a300e', '#6b4a1c', '#8a6224');
const BLOOD = hexes('#4a0404', '#8e0e0e', '#c82020', '#ff6a5a');
const OOZE = hexes('#2d5a12', '#4e8a1e', '#7cc02e', '#c8f070');
const STINK = hexes('#3f6a1c', '#6f9e2a', '#a6cc4a');
const BONE = hexes('#7c7058', '#a89c80', '#d4c9a8', '#f2ead2');
const SKY = hexes('#000000', '#05080a', '#0a1110', '#101a16');
const FOG = hexes('#101a16', '#18261e', '#223428', '#2c4232');
const DIRT = hexes('#2a1a0c', '#4a3018', '#6a4a26');
const LINE = hex('#0a0503');
const SHADOW = hex('#020402');
const RIND = hex('#2a1605');
const WING = hex('#a8b4c8');

const easeOut = (t: number) => 1 - (1 - clamp(t)) ** 3;
/** A ball's bounce on landing, 0-1. */
function bounce(t: number): number {
  t = clamp(t);
  if (t < 1 / 2.75) return 7.5625 * t * t;
  if (t < 2 / 2.75) return 7.5625 * (t -= 1.5 / 2.75) * t + 0.75;
  if (t < 2.5 / 2.75) return 7.5625 * (t -= 2.25 / 2.75) * t + 0.9375;
  return 7.5625 * (t -= 2.625 / 2.75) * t + 0.984375;
}

/** A word's picture: its shape, drawn with an outline and shadow, PAD pixels in from the layer's edges. */
interface Layer {
  px: Pixels;
  mask: Mask;
  letters: Laid['letters'];
}

/** "ZOMBIE": chewed edges, sagging bottoms, rotting skin with bruises, open wounds, pus and stitches. */
function zombie(): Layer {
  const { mask: m, letters } = lettering('ZOMBIE', BIG, BLOCK);
  // Chew the edges and let the bottoms sag.
  const bite: number[] = [];
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (m.has(x, y) && m.open(x, y) && hash(x, y, 11) < 0.3) bite.push(x, y);
  for (let i = 0; i < bite.length; i += 2) m.put(bite[i]!, bite[i + 1]!, false);
  const mask = new Mask(m.w, m.h + 6);
  mask.bits.set(m.bits);
  for (let x = 0; x < m.w; x++) {
    for (let y = m.h - 1; y >= 0; y--) {
      if (!m.has(x, y) || m.has(x, y + 1)) continue;
      const sag = Math.floor(noise(x / 3, y, 12) * 4 - 1);
      for (let k = 1; k <= sag; k++) mask.put(x, y + k, true);
    }
  }
  const px = new Pixels(mask.w + PAD * 2, mask.h + PAD * 2);
  outline(px, mask, PAD, PAD, LINE, SHADOW, 3);
  for (let y = 0; y < mask.h; y++) {
    for (let x = 0; x < mask.w; x++) {
      if (!mask.has(x, y)) continue;
      const light = (2 - mask.depth(x, y, 0, -1, 2)) * 0.12 - (2 - mask.depth(x, y, 0, 1, 2)) * 0.14
        + (1 - mask.depth(x, y, -1, 0, 1)) * 0.06 - (1 - mask.depth(x, y, 1, 0, 1)) * 0.06;
      const v = 0.12 + fbm(x / 7, y / 7, 1) * 0.75 + light;
      let c: Colour = ramp(FLESH, v, x, y);
      if (fbm(x / 9, y / 9, 2) > 0.64) c = ramp(BRUISE, v, x, y);
      const w = fbm(x / 5, y / 6, 3);
      if (w > 0.66) c = ramp(WOUND, (w - 0.66) * 4 + light, x, y);
      // Pustules, each with a dark rim under it.
      if (hash(x, y, 4) > 0.993) c = PUS[1]!;
      else if (hash(x, y - 1, 4) > 0.993) c = PUS[0]!;
      px.set(x + PAD, y + PAD, c);
    }
  }
  // Stitched-up gashes across a few letters.
  for (const [lx, ly, len] of [[4, 20, 12], [100, 32, 14], [178, 12, 10], [250, 28, 14]] as const) {
    for (let i = 0; i < len; i++) {
      const x = lx + i, y = ly + Math.round(Math.sin(i / 3) * 1.2);
      if (!mask.has(x, y)) continue;
      px.set(x + PAD, y + PAD, STITCH[1]!);
      if (i % 3 === 1) for (const d of [-2, -1, 1, 2]) if (mask.has(x, y + d)) px.set(x + PAD, y + d + PAD, STITCH[d < 0 ? 0 : 1]!);
    }
  }
  return { px, mask, letters };
}

/** "CHEESE": rounded wedges with holes and bites, blue veins, mould with fuzz, and brown rot. */
function cheese(): Layer {
  const { mask, letters } = lettering('CHEESE', BIG, BLOCK);
  roundCorners(mask, 2);
  // Holes: those that reach the edge bite pieces out instead.
  const holes = new Mask(mask.w, mask.h);
  const centres: [number, number, number][] = [];
  const r = rng(21);
  for (let tries = 0; centres.length < 60 && tries < 2000; tries++) {
    const x = Math.floor(r() * mask.w), y = Math.floor(r() * mask.h);
    if (!mask.has(x, y)) continue;
    const rad = 1.4 + r() * 2.4;
    if (centres.some(([cx, cy, cr]) => Math.hypot(cx - x, cy - y) < cr + rad + 2)) continue;
    centres.push([x, y, rad]);
  }
  for (const [cx, cy, rad] of centres) {
    let edge = false;
    for (let y = Math.floor(cy - rad); y <= cy + rad; y++) {
      for (let x = Math.floor(cx - rad); x <= cx + rad; x++) if (Math.hypot(x - cx, y - cy) <= rad && !mask.has(x, y)) edge = true;
    }
    for (let y = Math.floor(cy - rad); y <= cy + rad; y++) {
      for (let x = Math.floor(cx - rad); x <= cx + rad; x++) {
        if (Math.hypot(x - cx, y - cy) > rad) continue;
        if (!edge) holes.put(x, y, true);
        // Only a small hole at the edge takes a bite; a big one would cut the letter in two.
        else if (rad < 2) mask.put(x, y, false);
      }
    }
  }
  const px = new Pixels(mask.w + PAD * 2, mask.h + PAD * 2);
  outline(px, mask, PAD, PAD, RIND, SHADOW, 3);
  for (let y = 0; y < mask.h; y++) {
    for (let x = 0; x < mask.w; x++) {
      if (!mask.has(x, y)) continue;
      let c: Colour;
      if (holes.has(x, y)) {
        // A hole is lit from the top left, so its upper part is in shadow.
        c = ramp(HOLE, holes.has(x, y - 2) ? (holes.has(x - 1, y - 1) ? 0 : 0.4) : 0.9, x, y);
      } else {
        const light = (3 - mask.depth(x, y, -1, -1, 3)) * 0.1 - (3 - mask.depth(x, y, 1, 1, 3)) * 0.1;
        const lip = holes.has(x - 1, y - 1) && !holes.has(x, y) ? 0.25 : 0;
        const v = 0.45 + fbm(x / 10, y / 10, 6) * 0.35 + light + lip;
        c = ramp(CHEESE, v, x, y);
        const vein = Math.abs(noise(x / 4, y / 14, 8) - 0.5);
        if (vein < 0.018) c = VEIN[vein < 0.008 ? 0 : 1]!;
        const rot = fbm(x / 8, y / 8, 9);
        if (rot > 0.7) c = ramp(ROT, (rot - 0.7) * 5, x, y);
        const mould = fbm(x / 6, y / 6, 7);
        if (mould > 0.66) c = ramp(MOULD, (mould - 0.66) * 4 + light, x, y);
        else if (mould > 0.63 && hash(x, y, 10) > 0.55) c = FUZZ[hash(x, y, 13) > 0.5 ? 1 : 0]!;
      }
      px.set(x + PAD, y + PAD, c);
    }
  }
  return { px, mask, letters };
}

/** Small print in bone, with its outline. */
function bone(text: string, block: number): Layer {
  const { mask, letters } = lettering(text, SMALL, block);
  const px = new Pixels(mask.w + PAD * 2, mask.h + PAD * 2);
  outline(px, mask, PAD, PAD, LINE, SHADOW, 1);
  for (let y = 0; y < mask.h; y++) for (let x = 0; x < mask.w; x++) if (mask.has(x, y)) px.set(x + PAD, y + PAD, ramp(BONE, 1 - y / mask.h + 0.1, x, y));
  return { px, mask, letters };
}

interface Drip {
  /** Where it hangs from, in screen pixels. */
  x: number;
  y: number;
  ooze: boolean;
  width: number;
  speed: number;
  max: number;
  len: number;
  wait: number;
}

interface Drop {
  x: number;
  y: number;
  vy: number;
  ooze: boolean;
}

interface Splash {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  ooze: boolean;
}

export class SplashArt {
  private readonly frame = new Pixels(SPLASH_W, SPLASH_H);
  private readonly zombie = zombie();
  private readonly cheese = cheese();
  private readonly productions = bone('PRODUCTIONS', 2);
  private readonly prompt = bone('PRESS ANY KEY OR TAP', 2);
  private readonly zx: number;
  private readonly zy = 34;
  private readonly cx: number;
  private readonly cy = 124;
  private readonly drips: Drip[] = [];
  private readonly drops: Drop[] = [];
  private readonly splashes: Splash[] = [];
  /** Blood and ooze that landed on the cheese, in its layer's pixels. */
  private readonly stains = new Map<number, Colour>();
  private readonly random = rng(7);
  private last = 0;

  constructor() {
    this.zx = (SPLASH_W - this.zombie.px.w) >> 1;
    this.cx = (SPLASH_W - this.cheese.px.w) >> 1;
    // Drips hang from the bottoms of the strokes, a few pixels apart.
    const m = this.zombie.mask;
    const spots: [number, number][] = [];
    for (let x = 1; x < m.w - 1; x++) {
      for (let y = m.h - 1; y > m.h / 3; y--) {
        if (m.has(x, y) && !m.has(x, y + 1) && !m.has(x, y + 2) && m.has(x - 1, y) && m.has(x + 1, y)) spots.push([x, y]);
      }
    }
    const r = rng(3);
    for (let tries = 0; this.drips.length < 20 && tries < 500; tries++) {
      const [x, y] = spots[Math.floor(r() * spots.length)]!;
      if (this.drips.some((d) => Math.abs(d.x - (x + this.zx + PAD)) < 8)) continue;
      const ooze = r() < 0.3;
      this.drips.push({
        x: x + this.zx + PAD, y: y + this.zy + PAD + 1, ooze, width: ooze ? 3 : r() < 0.5 ? 1 : 2,
        speed: ooze ? 3 + r() * 4 : 5 + r() * 9, max: 6 + r() * (ooze ? 12 : 20), len: 0, wait: r() * 2.5,
      });
    }
  }

  /** "PRESS ANY KEY OR TAP" in the dark, for a browser that will only play the fanfare after one. */
  drawPrompt = (ctx: OffscreenCanvasRenderingContext2D, ms: number): void => {
    const f = this.frame;
    this.sky(ms);
    if (Math.floor(ms / 650) % 2 === 0 || ms < 650) f.blit(this.prompt.px, (SPLASH_W - this.prompt.px.w) >> 1, (SPLASH_H - this.prompt.px.h) >> 1);
    f.paint(ctx);
  };

  /** The splash `ms` into its run. */
  draw = (ctx: OffscreenCanvasRenderingContext2D, ms: number): void => {
    const dt = clamp((ms - this.last) / 1000, 0, 0.1);
    this.last = ms;
    const f = this.frame;
    this.sky(ms);

    // CHEESE drops in from above, behind ZOMBIE, and bounces.
    const fall = (ms - 900) / 650;
    if (fall > 0) {
      const y = Math.round(-this.cheese.px.h + (this.cy + this.cheese.px.h) * bounce(fall));
      f.blit(this.cheese.px, this.cx, y);
      if (fall >= 1) this.stained();
    }

    // ZOMBIE claws up out of the ground, shaking.
    const rise = easeOut(ms / 1100);
    const ground = this.zy + this.zombie.px.h - PAD + 2;
    const shake = rise < 1 ? Math.round(Math.sin(ms / 23) * 1.5) : 0;
    f.blit(this.zombie.px, this.zx + shake, this.zy + Math.round((1 - rise) * (this.zombie.px.h + 6)), rise < 1 ? ground : Infinity);
    if (ms < 1700) this.dirt(ground, ms);

    if (ms > 1150) this.dripping(dt);
    if (ms > 1700) this.stink(ms);
    if (ms > 1900) this.flies(ms);

    // PRODUCTIONS spelled out a letter at a time, each one flashing as it lands.
    const p = this.productions;
    const px0 = (SPLASH_W - p.px.w) >> 1, py0 = 206;
    p.letters.forEach((l, i) => {
      const at = ms - 2100 - i * 70;
      if (at < 0) return;
      for (let y = 0; y < p.px.h; y++) {
        for (let x = l.x0 + PAD - 1; x < l.x1 + PAD + 2; x++) {
          const c = p.px.get(x, y);
          if (c >>> 24) f.set(px0 + x, py0 + y, at < 90 && p.mask.has(x - PAD, y - PAD) ? BONE[3]! : c);
        }
      }
    });
    // Blood rules either side of it.
    const rule = Math.round(easeOut((ms - 3000) / 600) * 70);
    for (let i = 0; i < rule; i++) {
      for (const [x, s] of [[px0 - 8 - i, -1], [px0 + p.px.w + 7 + i, 1]] as const) {
        f.set(x, py0 + 10, BLOOD[1]!);
        f.set(x, py0 + 11, BLOOD[0]!);
        if (hash(x, 0, 30) > 0.9 && i < rule - 3) for (let k = 0; k < 1 + hash(x, 1, 30) * 4; k++) f.set(x, py0 + 12 + k, BLOOD[s < 0 ? 0 : 1]!);
      }
    }
    f.paint(ctx);
  };

  /** The night sky, and fog rolling along the bottom. */
  private sky(ms: number): void {
    const f = this.frame;
    for (let y = 0; y < SPLASH_H; y++) {
      for (let x = 0; x < SPLASH_W; x++) {
        let c = ramp(SKY, (y / SPLASH_H) * 0.9, x, y);
        if (y > 200) {
          const v = fbm((x + ms * 0.012) / 46, y / 9, 40) * 1.3 - 0.6 + (y - 200) / 140;
          if (v > 0.1) c = ramp(FOG, v, x, y);
        }
        f.data[y * SPLASH_W + x] = c;
      }
    }
  }

  /** Clods of earth thrown up as ZOMBIE breaks through. */
  private dirt(ground: number, ms: number): void {
    const f = this.frame;
    const fade = clamp(1 - (ms - 1100) / 600);
    for (let x = this.zx - 6; x < this.zx + this.zombie.px.w + 6; x++) {
      const h = Math.round((1 + noise(x / 5, 0, 31) * 3) * fade);
      for (let k = 0; k < h; k++) if (bayer(x, ground + k) < fade) f.set(x, ground - k, ramp(DIRT, 1 - k / 4, x, k));
    }
    for (let i = 0; i < 40; i++) {
      const t = (ms % 700) / 700 + hash(i, 0, 32);
      const s = t % 1;
      const x = this.zx + hash(i, 1, 32) * this.zombie.px.w + (hash(i, 2, 32) - 0.5) * 40 * s;
      const y = ground - (hash(i, 3, 32) * 50 * s - 60 * s * s);
      if (y < ground && fade > 0.2) f.set(Math.round(x), Math.round(y), DIRT[1 + (i & 1)]!);
    }
  }

  private dripping(dt: number): void {
    const f = this.frame;
    for (const d of this.drips) {
      if (d.wait > 0) d.wait -= dt;
      else {
        d.len += d.speed * dt * (1.2 - d.len / d.max);
        if (d.len >= d.max * 0.98) {
          this.drops.push({ x: d.x, y: d.y + d.len, vy: 20, ooze: d.ooze });
          d.len = d.max * (0.4 + this.random() * 0.2);
          d.wait = 0.2 + this.random() * 1.4;
        }
      }
      const cols = d.ooze ? OOZE : BLOOD;
      const len = Math.round(d.len);
      for (let k = 0; k < len; k++) {
        // Thinner as the strand stretches.
        const w = k > len - 3 ? d.width : Math.max(1, d.width - (k > len / 2 ? 1 : 0));
        for (let i = 0; i < w; i++) f.set(d.x + i, d.y + k, cols[i === 0 && w > 1 ? 2 : 1]!);
      }
      if (len > 1) {
        // A bead at the end, with a glint.
        const bx = d.x + (d.width >> 1), by = d.y + len;
        for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if (Math.abs(i) + Math.abs(j) < 2 || d.width > 1) f.set(bx + i, by + j, cols[1]!);
        f.set(bx, by + 2, cols[0]!);
        f.set(bx - 1, by - 1, cols[3]!);
      }
    }
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i]!;
      d.vy += 420 * dt;
      d.y += d.vy * dt;
      const lx = d.x - this.cx - PAD, ly = Math.round(d.y) - this.cy - PAD;
      const landed = this.cheese.mask.has(lx, ly) || d.y >= SPLASH_H - 4;
      if (landed) {
        this.drops.splice(i, 1);
        const cols = d.ooze ? OOZE : BLOOD;
        if (this.cheese.mask.has(lx, ly)) {
          for (let k = 0; k < 6; k++) {
            const sx = lx + Math.round((this.random() - 0.5) * 5), sy = ly + Math.round(this.random() * 3);
            if (this.cheese.mask.has(sx, sy)) this.stains.set(sy * this.cheese.mask.w + sx, cols[k < 2 ? 0 : 1]!);
          }
        }
        for (let k = 0; k < 5; k++) {
          this.splashes.push({ x: d.x, y: d.y - 1, vx: (this.random() - 0.5) * 70, vy: -30 - this.random() * 50, life: 0.35, ooze: d.ooze });
        }
        continue;
      }
      const cols = d.ooze ? OOZE : BLOOD;
      f.set(d.x, Math.round(d.y), cols[1]!);
      f.set(d.x, Math.round(d.y) - 1, cols[2]!);
      f.set(d.x + 1, Math.round(d.y), cols[0]!);
    }
    for (let i = this.splashes.length - 1; i >= 0; i--) {
      const s = this.splashes[i]!;
      s.life -= dt;
      if (s.life <= 0) {
        this.splashes.splice(i, 1);
        continue;
      }
      s.vy += 300 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      f.set(Math.round(s.x), Math.round(s.y), (s.ooze ? OOZE : BLOOD)[2]!);
    }
  }

  private stained(): void {
    const w = this.cheese.mask.w;
    for (const [i, c] of this.stains) this.frame.set(this.cx + PAD + (i % w), this.cy + PAD + Math.floor(i / w), c);
  }

  /** Stink lines curling up off the cheese. */
  private stink(ms: number): void {
    const f = this.frame;
    const fade = clamp((ms - 1700) / 800);
    const top = this.cy + PAD - 2;
    this.cheese.letters.forEach((l, i) => {
      const ex = this.cx + PAD + ((l.x0 + l.x1) >> 1);
      for (let k = 0; k < 22; k++) {
        const y = top - 4 - k;
        const sway = Math.sin((k - ms * 0.012) / 3 + i * 1.7) * (1.5 + k * 0.15);
        if (bayer(ex, y) > fade * (1 - k / 26)) continue;
        const c = ramp(STINK, 1 - k / 22, ex, y);
        f.set(Math.round(ex + sway), y, c);
        f.set(Math.round(ex + sway) + 1, y, c);
        f.set(Math.round(ex - sway + 7), y - 5, ramp(STINK, 0.7 - k / 30, ex, y));
      }
    });
  }

  /** Flies buzzing round the cheese. */
  private flies(ms: number): void {
    const f = this.frame;
    const cx = SPLASH_W / 2, cy = this.cy + 6;
    for (let i = 0; i < 4; i++) {
      const a = ms * (0.0021 + i * 0.0004) + i * 1.9;
      const x = Math.round(cx + Math.cos(a) * (120 + i * 18) + Math.sin(a * 3.7) * 7);
      const y = Math.round(cy + Math.sin(a * 1.4) * (22 + i * 4) + Math.cos(a * 5.1) * 3);
      f.set(x, y, LINE);
      f.set(x + 1, y, LINE);
      const flap = Math.floor(ms / 35 + i) % 2;
      f.set(x - flap, y - 1, WING);
      f.set(x + 1 + flap, y - 1, WING);
    }
  }
}
