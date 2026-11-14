// Flying debris (the FWall class, VA 0x44abb0). An explosion script's debris op (sub_42d790) breaks the destroyed
// building's model into its faces: each face whose kind (flag bits 8-9) has a program in the op's table flies off as
// a piece (sub_42b4e0, set up by sub_42a610). A piece starts at its face's centre and is driven by its program
// (sub_42b290): its clock goes up by the program's rate a tick, it is gone after the program's frames, and fades out
// from its fade frame. Each op works from one frame to another (the handler table at 0x44ab50):
// - 2 (sub_42aad0): moves it out from the model's centre, its speed closing on a target (picked at random between
//   two when given) by a step a tick.
// - 3 and 4 (sub_42abc0, sub_42aca0): turns it about the up axis and tips it about the across axis, each rate closing
//   on a random target of random sign.
// - 6 (sub_42aeb0): gravity, 0x51e a tick down to at most a pixel a tick, starting from its outward speed.
// - 1 (sub_42a950): moves the piece's colours toward one colour, a step at a time.
// - 5 (sub_42ad80): shows a run of other cels (smoke) for a number of frames.
// - 10 (sub_42b0e0): when it reaches the ground it goes, with a land or water explosion.
// Pieces never go below the ground. They are only looks: the match never sees them.

import { cos, groundAt, mul, sin, terrainAt, type Rng, type World } from '@rfw/sim';
import type { Cel, DebrisPiece, DebrisProgram, EffectsData, Model } from './assets.js';
import { paintedCel } from './paint.js';

/** A piece's state slot before its op first runs (sub_42b1f0 fills ten slots with it). */
const UNSET = 0x7fffffff;
/** Gravity and the fastest fall when an op leaves them 0 (0x44a318, 0x44a31c). */
const GRAVITY = 0x51e;
const FALL_MAX = -0x10000;
/** Ground of terrain 73-83 takes the rough landing explosion. */
const ROUGH = [73, 83] as const;

/** 0x48a080: 1.0 / (i + 1) in 16.16 (sub_41b0e0 fills it at start-up). */
function recip(i: number): number {
  return Math.floor(0x10000 / (i + 1));
}

interface Piece {
  prog: DebrisProgram;
  x: number;
  y: number;
  z: number;
  /** Corners about the piece's centre, 16.16 pixels. */
  verts: [number, number, number][];
  cel: number;
  /** Unit vector from the model's centre to the face's (+0xec), 16.16. */
  normal: [number, number, number];
  /** Movement every moving tick on top of the ops' (+0x34, +0x38, +0x3c), 16.16 pixels. */
  drift: [number, number, number];
  /** A destroyed vehicle's heading: once the piece has a speed, it drifts that way at it (sub_40cb80). */
  forward: number | null;
  speed: number;
  vz: number;
  falling: boolean;
  yaw: number;
  yawRate: number;
  pitch: number;
  pitchRate: number;
  t: number;
  started: boolean;
  slots: number[];
  /** A cel shown in place of its own (op 5), or null. */
  shown: number | null;
  /** Colour fade (op 1): the colour, the largest 5-bit step its cel needs, and the steps taken. */
  tint: { colour: number; max: number; done: number } | null;
  /** A side's face of a base 3 or 4 is repainted (paint.ts). */
  paint: number;
}

export class Debris {
  private pieces: Piece[] = [];
  private tinted = new Map<string, Cel>();

  constructor(
    private readonly data: EffectsData,
    private readonly cel: (i: number) => Cel | undefined,
    private readonly rng: Pick<Rng, 'below'>,
    private readonly explode: (key: string | null | undefined, x: number, y: number) => void,
  ) {}

  /**
   * Throws a model's pieces from a point (16.16), with the programs for face kinds 1-3. variant (and paint) is the owner's. A
   * vehicle's or drone's model is turned to its heading first (sub_42b4e0), and its pieces may drift: with the
   * drone's velocity (sub_40a120), along the vehicle's heading (sub_40cb80), or as a bridge's planks fly (sub_436d50).
   */
  throw(
    pieces: readonly DebrisPiece[], programs: readonly (string | null)[], x: number, y: number, z: number, variant: number,
    opts: { heading?: number; drift?: [number, number] | [number, number, number]; forward?: boolean; paint?: number } = {},
  ): void {
    const h = opts.heading ?? 0;
    const turn = (v: readonly number[]): [number, number, number] =>
      h ? [mul(v[0]!, cos(h)) - mul(v[1]!, sin(h)), mul(v[0]!, sin(h)) + mul(v[1]!, cos(h)), v[2]!] : [v[0]!, v[1]!, v[2]!];
    for (const piece of pieces) {
      const prog = this.data.debris?.[programs[piece.kind - 1] ?? ''];
      if (!prog) continue;
      const p = { ...piece, offset: turn(piece.offset), v: piece.v.map(turn) };
      const c: [number, number, number] = [0, 0, 0];
      for (const v of p.v) for (let k = 0; k < 3; k++) c[k]! += v[k]!;
      for (let k = 0; k < 3; k++) c[k] = c[k]! >> 2;
      const len = Math.floor(Math.hypot(c[0], c[1], c[2]) / 65536);
      const n = recip(len);
      this.pieces.push({
        prog, x: x + p.offset[0] + c[0], y: y + p.offset[1] + c[1], z: z + p.offset[2] + c[2],
        verts: p.v.map((v) => [v[0]! - c[0], v[1]! - c[1], v[2]! - c[2]]),
        cel: p.cel + (p.add ? variant : 0),
        normal: len ? [(c[0] >> 16) * n, (c[1] >> 16) * n, (c[2] >> 16) * n] : [0, 0, 0],
        drift: [opts.drift?.[0] ?? 0, opts.drift?.[1] ?? 0, opts.drift?.[2] ?? 0], forward: opts.forward ? h : null,
        speed: 0, vz: 0, falling: false, yaw: 0, yawRate: 0, pitch: 0, pitchRate: 0, t: 0, started: false,
        slots: new Array<number>(10).fill(UNSET), shown: null, tint: null, paint: p.add ? opts.paint ?? 0 : 0,
      });
    }
  }

  /** One tick of every piece (sub_42b290). */
  step(world: World): void {
    this.pieces = this.pieces.filter((p) => this.think(p, world));
  }

  private think(p: Piece, world: World): boolean {
    if (!p.started) {
      p.started = true;
      p.t = 0x10000;
    } else {
      p.t += p.prog.rate;
      if (p.t >= p.prog.frames * 0x10000) return false;
    }
    const f = p.t >> 16;
    const d: [number, number, number] = [p.drift[0], p.drift[1], p.drift[2]];
    let moved = false;
    for (let i = 0; i < p.prog.ops.length; i++) {
      const [code, from, to, a, b, c, e] = p.prog.ops[i]! as [number, number, number, number, number, number, number];
      const slot = i < 10 ? i : -1;
      const get = () => (slot < 0 ? UNSET : p.slots[slot]!);
      const set = (v: number) => {
        if (slot >= 0) p.slots[slot] = v;
      };
      const during = f >= from && f <= to;
      switch (code) {
        case 0:
          if (from <= p.t) return false;
          break;
        case 1:
          if (during) this.fade(p, a, from, to, f);
          break;
        case 2: {
          if (!during) break;
          let target = get();
          if (target === UNSET) {
            target = e ? this.rng.below((b - e) >> 4) * 16 + e : b;
            set(target);
            if (a !== -1) p.speed = a;
          }
          p.speed = approach(p.speed, target, c);
          d[0] += mul(p.normal[0], p.speed);
          d[1] += mul(p.normal[1], p.speed);
          if (!p.falling) d[2] += mul(p.normal[2], p.speed);
          moved = true;
          break;
        }
        case 3:
        case 4: {
          if (!during) break;
          const yaw = code === 3;
          let target = get();
          if (target === UNSET) {
            if (a !== -1) {
              if (yaw) p.yawRate = a;
              else p.pitchRate = a;
            }
            target = c;
            if (c !== e) {
              const k = (e - c + 0x20000) >> 9;
              target = (this.rng.below(k) + this.rng.below(k)) * 0x100 + c;
              if (this.rng.below(4) & 1) target = -target;
            }
            set(target);
          }
          if (yaw) {
            p.yawRate = approach(p.yawRate, target, b);
            p.yaw = (p.yaw + p.yawRate) & 0x3fffff;
          } else {
            p.pitchRate = approach(p.pitchRate, target, b);
            p.pitch = (p.pitch + p.pitchRate) & 0x3fffff;
          }
          break;
        }
        case 5:
          if (f < from) break;
          p.shown = f - from < to ? a + f - from : null;
          break;
        case 6: {
          if (!during) break;
          if (get() === UNSET) {
            set(0);
            if (a & 1) p.vz = mul(p.normal[2], p.speed);
            p.falling = true;
          }
          p.vz = Math.max(c || FALL_MAX, p.vz - (b || GRAVITY));
          d[2] += p.vz;
          moved = true;
          break;
        }
        case 10: {
          if (!during || get() !== UNSET || p.z > 0) break;
          set(0);
          const ground = groundAt(world, p.x, p.y);
          if (!a && !ground) break;
          const landing = this.data.debrisLanding;
          if (ground) {
            // Inferred: the original picks the splash's size by a length not traced; the smallest is used.
            this.explode(landing?.water[0], p.x, p.y);
          } else {
            const t = terrainAt(world, p.x >> 21, p.y >> 21) & 0x7f;
            this.explode(t >= ROUGH[0] && t <= ROUGH[1] ? landing?.rough : landing?.land, p.x, p.y);
          }
          return false;
        }
      }
    }
    if (p.forward !== null) {
      // Inferred: the original adds this once the ops first run, from the speed they set.
      p.drift[0] += mul(sin(p.forward), p.speed);
      p.drift[1] -= mul(cos(p.forward), p.speed);
      p.forward = null;
    }
    if (moved) {
      if (d[2] + p.z < 0) d[2] = -p.z;
      p.x += d[0];
      p.y += d[1];
      p.z += d[2];
    }
    return true;
  }

  /**
   * Op 1: the first time, the largest 5-bit channel step from the cel's colours to the target; then, over the op's
   * frames, that many steps in proportion. a < 0 takes a colour (the op's next argument) of cel -a's palette; the
   * converted cels keep no palette, so (inferred) the average colour of that cel stands in for it.
   */
  private fade(p: Piece, a: number, from: number, to: number, f: number): void {
    const own = this.cel(p.cel);
    if (!own) return;
    if (!p.tint) {
      const colour = a < 0 ? average(this.cel(-a)) : rgb555(a);
      let max = 0;
      for (const c of own.px) {
        if (c >>> 24 === 0) continue;
        for (let s = 0; s < 24; s += 8) max = Math.max(max, Math.abs((((c >> s) & 0xff) >> 3) - (((colour >> s) & 0xff) >> 3)));
      }
      p.tint = { colour, max, done: 0 };
    }
    const steps = Math.min(p.tint.max, (recip(to - from + 1) * (f - from + 1) * p.tint.max) >> 16);
    if (steps > p.tint.done) p.tint.done = steps;
  }

  /** The pieces to draw, as one-face models at their centres. */
  current(): { model: Model; x: number; y: number; z: number; heading: number }[] {
    const out: { model: Model; x: number; y: number; z: number; heading: number }[] = [];
    for (const p of this.pieces) {
      const f = p.t >> 16;
      let keep = 16;
      if (f >= p.prog.fade) {
        const level = 0x10000 - recip(p.prog.frames - p.prog.fade + 1) * (f - p.prog.fade + 1);
        keep = (level >> 12) - 1;
        if (keep < 1) continue;
      }
      const cel = p.shown ?? p.cel;
      const image = p.shown !== null ? undefined
        : p.tint?.done ? this.tintedCel(cel, p.tint.colour, p.tint.done, p.paint)
        : p.paint ? paintedCel(this.cel, cel, 1, p.paint) : undefined;
      const a = (p.pitch / 0x400000) * Math.PI * 2;
      const cs = Math.cos(a);
      const sn = Math.sin(a);
      const verts = p.verts.map(([x, y, z]): [number, number, number] => {
        const [vx, vy, vz] = [x / 65536, y / 65536, z / 65536];
        return [vx, vy * cs - vz * sn, vy * sn + vz * cs];
      });
      out.push({ model: { verts, faces: [{ cel, flags: 0, cull: [0, 0], v: [0, 1, 2, 3], keep, image }] }, x: p.x / 65536, y: p.y / 65536, z: p.z / 65536, heading: p.yaw });
    }
    return out;
  }

  /** A cel with every channel moved toward a colour by some 5-bit steps (sub_422ea0 on the piece's palette). */
  private tintedCel(index: number, colour: number, steps: number, paint: number): Cel | undefined {
    const key = `${index}:${colour}:${steps}:${paint}`;
    let cel = this.tinted.get(key);
    if (cel) return cel;
    const own = paintedCel(this.cel, index, 1, paint);
    if (!own) return undefined;
    const px = own.px.map((c) => {
      if (c >>> 24 === 0) return c;
      let out = c & 0xff000000;
      for (let s = 0; s < 24; s += 8) {
        const v = (c >> s) & 0xff;
        const t = (colour >> s) & 0xff;
        out |= (v < t ? Math.min(t, v + steps * 8) : Math.max(t, v - steps * 8)) << s;
      }
      return out >>> 0;
    });
    cel = { ...own, px };
    this.tinted.set(key, cel);
    return cel;
  }
}

function approach(v: number, target: number, step: number): number {
  if (v < target) return Math.min(target, v + step);
  if (v > target) return Math.max(target, v - step);
  return v;
}

/** A 15-bit 5:5:5 colour as packed RGBA (little-endian ABGR). */
function rgb555(c: number): number {
  const r = ((c >> 10) & 31) << 3;
  const g = ((c >> 5) & 31) << 3;
  const b = (c & 31) << 3;
  return (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
}

function average(cel: Cel | undefined): number {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (const c of cel?.px ?? []) {
    if (c >>> 24 === 0) continue;
    r += c & 0xff;
    g += (c >> 8) & 0xff;
    b += (c >> 16) & 0xff;
    n++;
  }
  if (!n) return 0xff808080;
  return (0xff000000 | (Math.round(b / n) << 16) | (Math.round(g / n) << 8) | Math.round(r / n)) >>> 0;
}
