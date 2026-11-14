// What happens on the modern view's sea, and how deep it is.
//
// - The depth: the same shallow and deep water the match plays by (shore.ts), worked out across the map at four
//   pixels a texel. The sea shader shows the shallows as a sandy bottom seen through clear water and deep water as
//   dark blue, with a drop-off line along the edge of the shelf, so a player can read where a tank would sink.
// - The marks: what vehicles leave on the water, painted into a texture over the whole map that fades as it goes:
//   foam (red), chop, the small broken waves of downwash and wakes (green), and silt churned up from the bottom
//   (blue). Most of it comes from little patches of disturbed water that drift out and fade (a floating jeep's V,
//   a helicopter's downwash spreading across the surface), stamped into the texture each frame.
// - The rings: ripples spreading from a point (a vehicle wading or sinking, a splash, a man swimming), kept as a
//   short list the sea shader works out itself.
//
// None of it touches the match, and it is all cheap enough for a phone: one small render each frame, a few
// hundred points, and a ring list of a couple of dozen.

import * as THREE from 'three';
import { DEEP, GRID, groundAt, type World } from '@rfw/sim';

const TILE = 32;
const WORLD = GRID * TILE;
/** Texels a tile of the depth map, and of the marks texture. */
const DEPTH_TEX = 8;
const MARKS = 1024;
/** Patches of disturbed water at once, and points stamped in a frame. */
const MAX_PATCHES = 1400;
const MAX_STAMPS = 2400;
/** Ripple rings the sea shader works out. */
export const RINGS = 24;

/** A patch of disturbed water drifting across the surface: where it is and goes (px, px/s), and what it leaves. */
interface Patch {
  x: number; y: number; vx: number; vy: number;
  age: number; life: number;
  /** Size (px across) at birth and at the end of its life. */
  s0: number; s1: number;
  foam: number; chop: number; silt: number;
  /** Drag per second (fraction of speed kept). */
  drag: number;
}

interface Ring { x: number; y: number; age: number; life: number; speed: number; amp: number }

const STAMP_VERTEX = /* glsl */ `
  attribute vec2 at;
  attribute float size;
  attribute vec4 mark;
  uniform float texels;
  varying vec4 vMark;
  void main() {
    vMark = mark;
    gl_PointSize = max(1.0, size * texels);
    gl_Position = vec4(at * 2.0 - 1.0, 0.0, 1.0);
  }`;

const STAMP_FRAGMENT = /* glsl */ `
  varying vec4 vMark;
  void main() {
    vec2 d = gl_PointCoord * 2.0 - 1.0;
    float r = dot(d, d);
    if (r > 1.0) discard;
    // A soft patch; a ring (mark.a) is strongest at its rim.
    float a = vMark.a > 0.5 ? smoothstep(0.35, 0.8, r) * (1.0 - smoothstep(0.8, 1.0, r)) : (1.0 - r) * (1.0 - r);
    gl_FragColor = vec4(vMark.rgb * a, 0.0);
  }`;

export class WaterMarks {
  readonly target: THREE.WebGLRenderTarget;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly fade: THREE.Mesh;
  private readonly fadeMaterial: THREE.MeshBasicMaterial;
  private readonly at = new Float32Array(MAX_STAMPS * 2);
  private readonly size = new Float32Array(MAX_STAMPS);
  private readonly mark = new Float32Array(MAX_STAMPS * 4);
  private readonly geo = new THREE.BufferGeometry();
  private stamps = 0;
  private readonly patches: Patch[] = [];
  private readonly rings: Ring[] = [];
  /** The rings for the sea shader: x, y (px), radius (px) and height. */
  readonly ringData = Array.from({ length: RINGS }, () => new THREE.Vector4(0, 0, 0, 0));
  private cleared = false;

  constructor() {
    this.target = new THREE.WebGLRenderTarget(MARKS, MARKS, { depthBuffer: false, type: THREE.UnsignedByteType, format: THREE.RGBAFormat });
    this.target.texture.minFilter = THREE.LinearFilter;
    this.target.texture.magFilter = THREE.LinearFilter;
    this.target.texture.generateMipmaps = false;
    // Everything on the sea fades: foam over a second or two, chop faster, silt slowest (ReverseSubtract: dst - src).
    this.fadeMaterial = new THREE.MeshBasicMaterial({
      color: 0x000000, transparent: true, depthTest: false, depthWrite: false,
      blending: THREE.CustomBlending, blendEquation: THREE.ReverseSubtractEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    });
    this.fadeMaterial.toneMapped = false;
    this.fade = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.fadeMaterial);
    this.fade.frustumCulled = false;
    this.fade.renderOrder = 0;
    this.geo.setAttribute('at', new THREE.BufferAttribute(this.at, 2).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('mark', new THREE.BufferAttribute(this.mark, 4).setUsage(THREE.DynamicDrawUsage));
    // three.js wants a position to count the points by.
    this.geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_STAMPS * 3), 3));
    const points = new THREE.Points(this.geo, new THREE.ShaderMaterial({
      uniforms: { texels: { value: MARKS / WORLD } },
      vertexShader: STAMP_VERTEX,
      fragmentShader: STAMP_FRAGMENT,
      transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    }));
    points.frustumCulled = false;
    points.renderOrder = 1;
    this.scene.add(this.fade, points);
  }

  get texture(): THREE.Texture {
    return this.target.texture;
  }

  /** Paints a mark into this frame's texture: a soft patch (or a ring) size px across. */
  stamp(x: number, y: number, size: number, foam: number, chop: number, silt: number, ring = false): void {
    if (this.stamps >= MAX_STAMPS || x < 0 || y < 0 || x > WORLD || y > WORLD) return;
    const i = this.stamps++;
    this.at[i * 2] = x / WORLD;
    this.at[i * 2 + 1] = y / WORLD;
    this.size[i] = size;
    this.mark[i * 4] = foam;
    this.mark[i * 4 + 1] = chop;
    this.mark[i * 4 + 2] = silt;
    this.mark[i * 4 + 3] = ring ? 1 : 0;
  }

  /** A patch of disturbed water that drifts and spreads, leaving its marks along the way. */
  patch(p: Omit<Patch, 'age'>): void {
    if (this.patches.length >= MAX_PATCHES) return;
    this.patches.push({ ...p, age: 0 });
  }

  /** A ripple ring from a point: amp its height, spreading at speed px/s for life seconds. */
  ring(x: number, y: number, amp: number, speed = 26, life = 1.6): void {
    if (this.rings.length >= RINGS) {
      // The faintest goes.
      let k = 0;
      let weakest = Infinity;
      for (let i = 0; i < this.rings.length; i++) {
        const r = this.rings[i]!;
        const left = r.amp * (1 - r.age / r.life);
        if (left < weakest) {
          weakest = left;
          k = i;
        }
      }
      if (weakest > amp) return;
      this.rings.splice(k, 1);
    }
    this.rings.push({ x, y, age: 0, life, speed, amp });
  }

  /** Moves the patches and rings on, and draws this frame's marks into the texture. */
  render(gl: THREE.WebGLRenderer, dt: number): void {
    for (let i = this.patches.length - 1; i >= 0; i--) {
      const p = this.patches[i]!;
      p.age += dt;
      if (p.age >= p.life) {
        this.patches[i] = this.patches[this.patches.length - 1]!;
        this.patches.pop();
        continue;
      }
      const keep = Math.pow(p.drag, dt);
      p.vx *= keep;
      p.vy *= keep;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const t = p.age / p.life;
      // Each frame adds a little, so the mark builds where a patch lingers and trails where it moves.
      const k = Math.min(1, dt * 60) * (1 - t) * 0.12;
      this.stamp(p.x, p.y, p.s0 + (p.s1 - p.s0) * t, p.foam * k, p.chop * k, p.silt * k);
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]!;
      r.age += dt;
      if (r.age >= r.life) this.rings.splice(i, 1);
    }
    for (let i = 0; i < RINGS; i++) {
      const r = this.rings[i];
      const v = this.ringData[i]!;
      if (!r) v.set(0, 0, 0, 0);
      else {
        const t = r.age / r.life;
        v.set(r.x, r.y, 2 + r.age * r.speed, r.amp * (1 - t) * (1 - t));
      }
    }
    this.geo.setDrawRange(0, this.stamps);
    for (const name of ['at', 'size', 'mark']) (this.geo.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
    // Foam lasts about two seconds, chop one, silt five.
    this.fadeMaterial.color.setRGB(dt * 0.55, dt * 1.0, dt * 0.22);
    const before = gl.getRenderTarget();
    const auto = gl.autoClear;
    gl.setRenderTarget(this.target);
    if (!this.cleared) {
      gl.setClearColor(0x000000, 0);
      gl.clear(true, false, false);
      this.cleared = true;
    }
    gl.autoClear = false;
    gl.render(this.scene, this.camera);
    gl.autoClear = auto;
    gl.setRenderTarget(before);
    this.stamps = 0;
  }

  /** A fresh map: nothing on the water. */
  clear(): void {
    this.patches.length = 0;
    this.rings.length = 0;
    this.cleared = false;
  }

  dispose(): void {
    this.target.dispose();
    this.geo.dispose();
    this.fade.geometry.dispose();
    this.fadeMaterial.dispose();
  }
}

/**
 * The water's depth over the map, for the sea shader: red is 1 in deep water and 0 in the shallows (and on land,
 * so the sea under a shore's edge shows shallow), lightly blurred so the shelf's edge is smooth; green is the same
 * blurred over a few tiles, so deep water darkens away from the shelf.
 */
export class DepthMap {
  readonly texture: THREE.DataTexture;
  private readonly n = GRID * DEPTH_TEX;
  private readonly deep = new Float32Array(this.n * this.n);
  private readonly data = new Uint8Array(this.n * this.n * 2);

  constructor(world: World) {
    this.texture = new THREE.DataTexture(this.data, this.n, this.n, THREE.RGFormat, THREE.UnsignedByteType);
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    this.update(world);
  }

  /**
   * Works the depth out again over tiles [x0, x1) x [y0, y1) (the terrain changed there; all the map when left out),
   * and the blur round them.
   */
  update(world: World, x0 = 0, y0 = 0, x1 = GRID, y1 = GRID): void {
    const n = this.n;
    const step = TILE / DEPTH_TEX;
    for (let ty = y0; ty < y1; ty++) {
      for (let tx = x0; tx < x1; tx++) {
        const t = world.terrain[ty * GRID + tx]! & 127;
        // Plain tiles are one ground all over; shoreline tiles are worked out point by point.
        const plain = t === 2 ? 1 : t === 1 || (t >= 24 && t < 40) || t < 4 || t > 51 ? 0 : -1;
        for (let j = 0; j < DEPTH_TEX; j++) {
          for (let i = 0; i < DEPTH_TEX; i++) {
            const x = tx * DEPTH_TEX + i;
            const y = ty * DEPTH_TEX + j;
            let d = plain;
            if (d < 0) d = groundAt(world, Math.round((x * step + step / 2) * 65536), Math.round((y * step + step / 2) * 65536)) === DEEP ? 1 : 0;
            this.deep[y * n + x] = d;
          }
        }
      }
    }
    // The blurs reach BROAD texels: work them out over the changed texels and that much round them, from a window
    // that much bigger again (its own edges come out wrong, but are not kept, except at the map's edge, where
    // beyond counts as deep water, as it is).
    const BROAD = 6 * 2;
    const ax0 = Math.max(0, x0 * DEPTH_TEX - BROAD);
    const ay0 = Math.max(0, y0 * DEPTH_TEX - BROAD);
    const ax1 = Math.min(n, x1 * DEPTH_TEX + BROAD);
    const ay1 = Math.min(n, y1 * DEPTH_TEX + BROAD);
    const bx0 = Math.max(0, ax0 - BROAD);
    const by0 = Math.max(0, ay0 - BROAD);
    const w = Math.min(n, ax1 + BROAD) - bx0;
    const h = Math.min(n, ay1 + BROAD) - by0;
    const win = new Float32Array(w * h);
    for (let y = 0; y < h; y++) win.set(this.deep.subarray((by0 + y) * n + bx0, (by0 + y) * n + bx0 + w), y * w);
    const sharp = blur(win, w, h, 1, 1);
    const broad = blur(win, w, h, 6, 2);
    for (let y = ay0; y < ay1; y++) {
      for (let x = ax0; x < ax1; x++) {
        const k = (y - by0) * w + (x - bx0);
        const i = y * n + x;
        this.data[i * 2] = Math.round(sharp[k]! * 255);
        // Deep water darkens from the shelf out over a few tiles.
        this.data[i * 2 + 1] = Math.round(Math.min(1, broad[k]! * sharp[k]!) * 255);
      }
    }
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
  }
}

/** Separable box blur of a w x h grid, radius r texels, passes times (beyond its edges counts as deep water). */
function blur(src: Float32Array, w: number, h: number, r: number, passes: number): Float32Array {
  let cur = src;
  const span = r * 2 + 1;
  for (let p = 0; p < passes; p++) {
    const tmp = new Float32Array(w * h);
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      let s = 0;
      for (let i = -r; i <= r; i++) s += i < 0 || i >= w ? 1 : cur[y * w + i]!;
      for (let x = 0; x < w; x++) {
        tmp[y * w + x] = s / span;
        const add = x + r + 1;
        const drop = x - r;
        s += (add >= w ? 1 : cur[y * w + add]!) - (drop < 0 ? 1 : cur[y * w + drop]!);
      }
    }
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = -r; i <= r; i++) s += i < 0 || i >= h ? 1 : tmp[i * w + x]!;
      for (let y = 0; y < h; y++) {
        out[y * w + x] = s / span;
        const add = y + r + 1;
        const drop = y - r;
        s += (add >= h ? 1 : tmp[add * w + x]!) - (drop < 0 ? 1 : tmp[drop * w + x]!);
      }
    }
    cur = out;
  }
  return cur;
}
