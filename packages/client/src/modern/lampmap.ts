// The buildings' lamps at night, every one of them lit at once: their light and shadows worked out on the map and
// kept in a texture (the lamp map) that the ground, buildings and vehicles add to their lighting. A scene can only
// afford a few real lights, and a town has a lamp at every door, so lighting only the nearest few left most of the
// screen dark. The lamps never move, so their light is worked out once (and again round a building that changes):
// each lamp's light is cut off where a building stands in its way, its cage throws bars and smudges round it, and
// the materials make it flicker as a lamp does.

import * as THREE from 'three';
import { GRID, type World } from '@rfw/sim';
import { lookOf, type Box } from './buildings.js';
import { LIGHT_TIME } from './look.js';

/** A lamp: where it stands (pixels, z up), how bright it is (as a point light's intensity) and its colour. */
export type Lamp = { x: number; y: number; z: number; power: number; colour: number };

const TILE = 32;
const WORLD = GRID * TILE;
/** Pixels per texel of the lamp map. */
const CELL = 4;
const SIZE = WORLD / CELL;
/** How far a lamp's light reaches (pixels), and how it falls away (as a three.js point light's decay). */
export const LAMP_REACH = 150;
const DECAY = 1.5;
/** The brightest light the map holds (irradiance); stored as the square root of the share of it. */
const LAMP_MAX = 320;
/** Directions round each lamp, and steps out along each, when working out what stands in its way. */
const RAYS = 360;
const STEP = 2;
const STEPS = Math.ceil(LAMP_REACH / STEP) + 1;
/** The buildings that stand in a lamp's way, as solid blocks; and trees and the like, which block less of it. */
const SOLID = new Set(['house', 'factory', 'hq', 'hospital', 'fuel', 'prison', 'gate', 'wall', 'tower', 'towerBase', 'outpost', 'tent', 'ammo']);
const PLANTS = new Set(['tree', 'palm', 'bush', 'cactus', 'rock']);

const hash = (x: number, y: number) => {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
};
const noise = (x: number, y: number) => {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let fx = x - ix;
  let fy = y - iy;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy) + (hash(ix + 1, iy) - hash(ix, iy)) * fx;
  const b = hash(ix, iy + 1) + (hash(ix + 1, iy + 1) - hash(ix, iy + 1)) * fx;
  return a + (b - a) * fy;
};
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class LampMap {
  readonly texture: THREE.DataTexture;
  private readonly data = new Uint8Array(SIZE * SIZE * 4);
  /** Light (irradiance on the ground, linear RGB) per texel, and the strongest lamp's share and seed there. */
  private readonly light = new Float32Array(SIZE * SIZE * 3);
  private readonly best = new Float32Array(SIZE * SIZE);
  /** Height of what stands on each texel (pixels; 0 nothing that blocks light). */
  private readonly height = new Float32Array(SIZE * SIZE);
  /** Per ray and step from the lamp being worked out: whether its light reaches the ground there. */
  private readonly lit = new Uint8Array(RAYS * STEPS);

  constructor() {
    this.texture = new THREE.DataTexture(this.data, SIZE, SIZE, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;
  }

  /**
   * Works out the lamps' light over a rectangle of the map (pixels; all of it when left out): what stands there
   * from world and boxes, and every lamp whose light reaches into it.
   */
  bake(world: World, boxes: readonly (Box | null)[], lamps: readonly Lamp[], area?: { x0: number; y0: number; x1: number; y1: number }): void {
    const a = area ?? { x0: 0, y0: 0, x1: WORLD, y1: WORLD };
    const c0 = Math.max(0, Math.floor(a.x0 / CELL));
    const r0 = Math.max(0, Math.floor(a.y0 / CELL));
    const c1 = Math.min(SIZE, Math.ceil(a.x1 / CELL));
    const r1 = Math.min(SIZE, Math.ceil(a.y1 / CELL));
    this.solids(world, boxes);
    for (let r = r0; r < r1; r++) {
      this.light.fill(0, (r * SIZE + c0) * 3, (r * SIZE + c1) * 3);
      this.best.fill(0, r * SIZE + c0, r * SIZE + c1);
    }
    const seeds = new Uint8Array(SIZE * SIZE);
    for (const lamp of lamps) {
      if (lamp.x + LAMP_REACH < a.x0 || lamp.x - LAMP_REACH > a.x1 || lamp.y + LAMP_REACH < a.y0 || lamp.y - LAMP_REACH > a.y1) continue;
      this.one(lamp, c0, r0, c1, r1, seeds);
    }
    for (let r = r0; r < r1; r++) {
      for (let c = c0; c < c1; c++) {
        const i = r * SIZE + c;
        for (let k = 0; k < 3; k++) this.data[i * 4 + k] = Math.round(Math.sqrt(Math.min(1, this.light[i * 3 + k]! / LAMP_MAX)) * 255);
        if (this.best[i]! > 0) this.data[i * 4 + 3] = seeds[i]!;
      }
    }
    this.texture.needsUpdate = true;
  }

  /** What stands on the map, for the lamps' shadows: the solid buildings' bodies, as tall as they are. */
  private solids(world: World, boxes: readonly (Box | null)[]): void {
    this.height.fill(0);
    for (let i = 0; i < GRID * GRID; i++) {
      const bid = world.building[i]!;
      const def = bid ? world.defs[bid] : null;
      const b = boxes[bid];
      const look = def ? lookOf(def.name) : 'none';
      if (!def || !b || !(SOLID.has(look) || PLANTS.has(look))) continue;
      // A tree's crown and trunk let some light by round their edges: they block the middle of their footprint.
      const k = SOLID.has(look) ? 1 : 0.5;
      let ox = (i % GRID) * TILE + TILE / 2;
      let oy = Math.floor(i / GRID) * TILE + TILE / 2;
      if (def.jitter) {
        const e = ((Math.floor(i / GRID) & 15) << 4) + ((i % GRID) & 15);
        ox += world.scenery[e * 2]!;
        oy += world.scenery[e * 2 + 1]!;
      }
      const h = b.h + b.oz;
      const mx = ox + b.ox + (b.x0 + b.x1) / 2;
      const my = oy + b.oy + (b.y0 + b.y1) / 2;
      const hw = ((b.x1 - b.x0) / 2) * k;
      const hd = ((b.y1 - b.y0) / 2) * k;
      const cx0 = Math.max(0, Math.round((mx - hw) / CELL));
      const cx1 = Math.min(SIZE, Math.max(Math.round((mx - hw) / CELL) + 1, Math.round((mx + hw) / CELL)));
      const cy0 = Math.max(0, Math.round((my - hd) / CELL));
      const cy1 = Math.min(SIZE, Math.max(Math.round((my - hd) / CELL) + 1, Math.round((my + hd) / CELL)));
      for (let y = cy0; y < cy1; y++) for (let x = cx0; x < cx1; x++) this.height[y * SIZE + x] = Math.max(this.height[y * SIZE + x]!, h);
    }
  }

  /** Adds one lamp's light to the texels of the rectangle it reaches. */
  private one(lamp: Lamp, c0: number, r0: number, c1: number, r1: number, seeds: Uint8Array): void {
    const zl = lamp.z;
    // Out along each ray: the ground is lit at a distance once every building passed on the way is low enough for
    // the line from the lamp to clear it (a building as tall as the lamp shades everything beyond it).
    for (let ray = 0; ray < RAYS; ray++) {
      const t = (ray / RAYS) * Math.PI * 2;
      const dx = Math.sin(t);
      const dy = Math.cos(t);
      let until = 0;
      for (let s = 0; s < STEPS; s++) {
        const d = s * STEP;
        const cx = Math.floor((lamp.x + dx * d) / CELL);
        const cy = Math.floor((lamp.y + dy * d) / CELL);
        const h = cx >= 0 && cy >= 0 && cx < SIZE && cy < SIZE ? this.height[cy * SIZE + cx]! : 0;
        if (h > 0 && d > 0) until = Math.max(until, h >= zl ? Infinity : (d * zl) / (zl - h));
        this.lit[ray * STEPS + s] = d >= until ? 1 : 0;
      }
    }
    const k = hash(Math.floor(lamp.x / 4 + 0.5), Math.floor(lamp.y / 4 + 0.5)) * 23;
    const seed = Math.round((k / 23) * 255);
    const col = new THREE.Color(lamp.colour);
    const lx0 = Math.max(c0, Math.floor((lamp.x - LAMP_REACH) / CELL));
    const lx1 = Math.min(c1, Math.ceil((lamp.x + LAMP_REACH) / CELL));
    const ly0 = Math.max(r0, Math.floor((lamp.y - LAMP_REACH) / CELL));
    const ly1 = Math.min(r1, Math.ceil((lamp.y + LAMP_REACH) / CELL));
    for (let cy = ly0; cy < ly1; cy++) {
      for (let cx = lx0; cx < lx1; cx++) {
        const px = (cx + 0.5) * CELL - lamp.x;
        const py = (cy + 0.5) * CELL - lamp.y;
        const d = Math.hypot(px, py);
        const r = Math.hypot(d, zl);
        if (r >= LAMP_REACH) continue;
        const a = Math.atan2(px, py);
        const ray = ((Math.round((a / (Math.PI * 2)) * RAYS) % RAYS) + RAYS) % RAYS;
        if (!this.lit[ray * STEPS + Math.min(STEPS - 1, Math.round(d / STEP))]) continue;
        // As a three.js point light falls away, on the ground (lit from above at this slant).
        const fade = Math.max(0, 1 - (r / LAMP_REACH) ** 4) ** 2;
        let e = (lamp.power * fade * (zl / r)) / Math.max(r ** DECAY, 0.01);
        // The lamp's cage and grimy glass: bars round it and smudges (the live lights' lampGrain, look.ts).
        const bars = smooth(0.5, 0.95, Math.abs(Math.sin(a * 4 + k * 1.7)));
        const smudge = noise(a * 2.5 + k * 11, (-zl / r) * 5 + k * 11);
        e *= (1 - 0.5 * bars) * (0.6 + 0.6 * smudge);
        const i = cy * SIZE + cx;
        this.light[i * 3] = this.light[i * 3]! + e * col.r;
        this.light[i * 3 + 1] = this.light[i * 3 + 1]! + e * col.g;
        this.light[i * 3 + 2] = this.light[i * 3 + 2]! + e * col.b;
        if (e > this.best[i]!) {
          this.best[i] = e;
          seeds[i] = seed;
        }
      }
    }
  }
}

/**
 * Teaches a lit material to add the lamp map's light at night (night is a uniform, 0 by day, 1 at night): the
 * ground where it is, a wall from the ground just in front of it (so a wall facing away from a lamp stays dark), and
 * little on roofs and high up, as the lamps hang low. Each lamp flickers as the live lights do.
 */
export function lampLight(shader: { uniforms: Record<string, THREE.IUniform>; vertexShader: string; fragmentShader: string }, map: THREE.Texture, night: THREE.IUniform): void {
  shader.uniforms.lampMap = { value: map };
  shader.uniforms.lampNight = night;
  shader.uniforms.lampTime = LIGHT_TIME;
  shader.vertexShader = shader.vertexShader
    .replace('void main() {', 'varying vec3 vLampWorld;\nvoid main() {')
    .replace('#include <project_vertex>', `#include <project_vertex>
  {
    vec4 lw = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
      lw = instanceMatrix * lw;
    #endif
    vLampWorld = (modelMatrix * lw).xyz;
  }`);
  shader.fragmentShader = shader.fragmentShader
    .replace('void main() {', `uniform sampler2D lampMap;
uniform float lampNight;
uniform float lampTime;
varying vec3 vLampWorld;
float lampHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float lampNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(lampHash(i), lampHash(i + vec2(1.0, 0.0)), f.x), mix(lampHash(i + vec2(0.0, 1.0)), lampHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {`)
    .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
  if (lampNight > 0.0) {
    vec3 wn = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
    vec4 s = texture2D(lampMap, (vLampWorld.xz + wn.xz * 3.0) / ${WORLD.toFixed(1)});
    vec3 e = s.rgb * s.rgb * ${LAMP_MAX.toFixed(1)};
    float flick = 0.84 + 0.16 * lampNoise(vec2(lampTime * 8.0, s.a * 23.0 * 13.0));
    float facing = wn.y > 0.5 ? (vLampWorld.y > 6.0 ? 0.2 : 1.0) : (wn.y < -0.5 ? 0.0 : 1.2);
    facing *= clamp(1.0 - vLampWorld.y / 40.0, 0.0, 1.0);
    reflectedLight.directDiffuse += e * facing * flick * lampNight * BRDF_Lambert(material.diffuseColor);
  }`);
}
