// The modern view's ground and sea. Each ground tile's art (the same terrain cels the retro view draws) is read for
// what it shows, pixel by pixel: sea, sand, darker sand, grass, road, road edging, planks, or something drawn (pads,
// hazard stripes, rubble) that keeps its own colours. The ground is then painted in the stylised colours with soft
// noise, at 16 texels a tile, and laid over an animated sea that only shows where the ground is sea. The sea's
// shallows, foam and colour come from how far each point is from land.

import * as THREE from 'three';
import { GRID, NO_TERRAIN, type World } from '@rfw/sim';
import type { GameAssets } from '../assets.js';

export const TILE = 32;
/** Sea mask resolution: texels a tile. */
const SHORE_TEX = 4;
const WATER_CEL = 2;

const enum Mat { Water, Sand, Dirt, Grass, Road, RoadLight, Wood, Keep }

const COLOURS: Record<Exclude<Mat, Mat.Water | Mat.Keep>, [number, number, number]> = {
  [Mat.Sand]: [228, 196, 140],
  [Mat.Dirt]: [190, 150, 102],
  [Mat.Grass]: [112, 170, 66],
  [Mat.Road]: [104, 108, 114],
  [Mat.RoadLight]: [176, 178, 180],
  [Mat.Wood]: [140, 92, 52],
};

function classify(r: number, g: number, b: number): Mat {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lum = (r * 3 + g * 6 + b) / 10;
  if (b > r + 12 && b + 10 >= g) return Mat.Water;
  if (g > r + 6 && g > b + 25) return Mat.Grass;
  if (max - min < 22) return lum > 150 ? Mat.RoadLight : lum > 70 ? Mat.Road : Mat.Keep;
  if (r > g && g > b) {
    if (lum < 105) return Mat.Wood;
    if (r > 150 && max - min > 50) return lum > 150 ? Mat.Sand : Mat.Dirt;
    return Mat.Dirt;
  }
  return Mat.Keep;
}

interface CelGround {
  mat: Uint8Array;
  rgb: Uint8Array;
}

/** A tiling value-noise texture, 0-255, for the ground's soft variation. */
function noiseTile(n: number, cells: number, seed: number): Float32Array {
  const grid = new Float32Array(cells * cells);
  let s = seed;
  for (let i = 0; i < grid.length; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    grid[i] = s / 0x7fffffff;
  }
  const out = new Float32Array(n * n);
  const step = n / cells;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const gx = x / step;
      const gy = y / step;
      const x0 = Math.floor(gx);
      const y0 = Math.floor(gy);
      const fx = gx - x0;
      const fy = gy - y0;
      const sx = fx * fx * (3 - 2 * fx);
      const sy = fy * fy * (3 - 2 * fy);
      const at = (i: number, j: number) => grid[((j % cells) * cells) + (i % cells)]!;
      const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
      const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
      out[y * n + x] = a + (b - a) * sy;
    }
  }
  return out;
}

export class Ground {
  readonly group = new THREE.Group();
  private readonly cels = new Map<number, CelGround>();
  private readonly image: ImageData;
  private readonly canvas: HTMLCanvasElement;
  private readonly texture: THREE.CanvasTexture;
  private readonly shoreTex: THREE.DataTexture;
  private readonly shore = new Uint8Array(GRID * SHORE_TEX * GRID * SHORE_TEX);
  /** One texel a tile: 255 where a lift's shaft is open and the ground has a hole. */
  private readonly pits = new Uint8Array(GRID * GRID);
  private readonly pitTex: THREE.DataTexture;
  private readonly terrain = new Uint8Array(GRID * GRID);
  private readonly noise = [noiseTile(256, 8, 7), noiseTile(256, 32, 11)];
  readonly water: THREE.ShaderMaterial;
  /** Ground texels a tile: the art's own 32 where the GPU takes a 4096 texture, else 16. */
  private readonly TEX: number;
  private readonly SIZE: number;

  constructor(private readonly assets: GameAssets, world: World, sun: THREE.Vector3, fine: boolean) {
    this.TEX = fine ? 32 : 16;
    this.SIZE = GRID * this.TEX;
    const SIZE = this.SIZE;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.SIZE;
    this.canvas.height = this.SIZE;
    this.image = new ImageData(this.SIZE, this.SIZE);
    this.terrain.set(world.terrain);
    this.paint(0, 0, GRID, GRID);
    this.canvas.getContext('2d')!.putImageData(this.image, 0, 0);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.texture.generateMipmaps = true;
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;

    this.pitTex = new THREE.DataTexture(this.pits, GRID, GRID, THREE.RedFormat, THREE.UnsignedByteType);
    // Rows run south to north: row 0 is the map's southern edge, where a texture's v is 0.
    this.pitTex.needsUpdate = true;
    const mat = new THREE.MeshLambertMaterial({ map: this.texture, alphaTest: 0.5 });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.pits = { value: this.pitTex };
      shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', 'uniform sampler2D pits;\nvoid main() {')
        .replace('#include <alphatest_fragment>', `#include <alphatest_fragment>
          {
            vec2 t = vMapUv * ${GRID}.0;
            vec2 f = fract(t);
            if (texture2D(pits, (floor(t) + 0.5) / ${GRID}.0).r > 0.5 && f.x > 0.06 && f.x < 0.94 && f.y > 0.06 && f.y < 0.94) discard;
          }`);
    };
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(GRID * TILE, GRID * TILE), mat);
    plane.rotateX(-Math.PI / 2);
    plane.position.set((GRID * TILE) / 2, 0, (GRID * TILE) / 2);
    plane.receiveShadow = true;
    this.group.add(plane);

    this.shoreTex = new THREE.DataTexture(this.shore, GRID * SHORE_TEX, GRID * SHORE_TEX, THREE.RedFormat, THREE.UnsignedByteType);
        this.shoreTex.magFilter = THREE.LinearFilter;
    this.shoreTex.minFilter = THREE.LinearFilter;
    this.makeShore();
    this.water = waterMaterial(this.shoreTex, this.pitTex, sun);
    const margin = 4096;
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(GRID * TILE + margin * 2, GRID * TILE + margin * 2, 1, 1), this.water);
    sea.rotateX(-Math.PI / 2);
    sea.position.set((GRID * TILE) / 2, -1.2, (GRID * TILE) / 2);
    this.group.add(sea);
  }

  /** Repaints tiles whose terrain changed (a building become rubble, a lift's pad), and the lifts' open shafts. */
  update(world: World, openLifts: Iterable<number>): void {
    let x0 = GRID;
    let y0 = GRID;
    let x1 = -1;
    let y1 = -1;
    for (let i = 0; i < GRID * GRID; i++) {
      if (world.terrain[i] === this.terrain[i]) continue;
      this.terrain[i] = world.terrain[i]!;
      const x = i % GRID;
      const y = (i / GRID) | 0;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
    if (x1 >= 0) {
      const px0 = Math.max(0, x0 - 1);
      const py0 = Math.max(0, y0 - 1);
      const px1 = Math.min(GRID, x1 + 2);
      const py1 = Math.min(GRID, y1 + 2);
      this.paint(px0, py0, px1, py1);
      this.canvas.getContext('2d')!.putImageData(this.image, 0, 0, px0 * this.TEX, py0 * this.TEX, (px1 - px0) * this.TEX, (py1 - py0) * this.TEX);
      this.texture.needsUpdate = true;
      this.makeShore();
    }
    const want = new Set(openLifts);
    let changed = false;
    for (let i = 0; i < this.pits.length; i++) {
      const v = want.has(i) ? 255 : 0;
      const at = (GRID - 1 - ((i / GRID) | 0)) * GRID + (i % GRID);
      if (this.pits[at] !== v) {
        this.pits[at] = v;
        changed = true;
      }
    }
    if (changed) this.pitTex.needsUpdate = true;
  }

  tick(seconds: number): void {
    this.water.uniforms.time!.value = seconds;
  }

  private celGround(cel: number): CelGround {
    let g = this.cels.get(cel);
    if (g) return g;
    const c = this.assets.cel(cel);
    const mat = new Uint8Array(this.TEX * this.TEX);
    const rgb = new Uint8Array(this.TEX * this.TEX * 3);
    if (c) {
      const sx = c.w / this.TEX;
      const sy = c.h / this.TEX;
      for (let y = 0; y < this.TEX; y++) {
        for (let x = 0; x < this.TEX; x++) {
          const votes = new Uint8Array(8);
          let r = 0;
          let gg = 0;
          let b = 0;
          let n = 0;
          for (let j = 0; j < sy; j++) {
            for (let i = 0; i < sx; i++) {
              const p = c.px[Math.floor(y * sy + j) * c.w + Math.floor(x * sx + i)]!;
              const pr = p & 255;
              const pg = (p >> 8) & 255;
              const pb = (p >> 16) & 255;
              votes[classify(pr, pg, pb)]!++;
              r += pr;
              gg += pg;
              b += pb;
              n++;
            }
          }
          let best = 0;
          for (let k = 1; k < 8; k++) if (votes[k]! > votes[best]!) best = k;
          const o = y * this.TEX + x;
          mat[o] = best;
          rgb[o * 3] = r / n;
          rgb[o * 3 + 1] = gg / n;
          rgb[o * 3 + 2] = b / n;
        }
      }
    }
    // The art's speckles (a light grain of sand, a dot on the road) would come out as specks of another material:
    // each texel takes the commonest material round it.
    const T = this.TEX;
    const smooth = new Uint8Array(mat.length);
    for (let y = 0; y < T; y++) {
      for (let x = 0; x < T; x++) {
        const votes = new Uint8Array(8);
        for (let j = -1; j <= 1; j++) {
          for (let i = -1; i <= 1; i++) votes[mat[Math.min(T - 1, Math.max(0, y + j)) * T + Math.min(T - 1, Math.max(0, x + i))]!]!++;
        }
        let best = mat[y * T + x]!;
        for (let k = 0; k < 8; k++) if (votes[k]! > votes[best]!) best = k;
        smooth[y * T + x] = best;
      }
    }
    g = { mat: smooth, rgb };
    this.cels.set(cel, g);
    return g;
  }

  /** Paints tiles [x0, x1) x [y0, y1) into the image, with a soft blur across tile edges. */
  private paint(x0: number, y0: number, x1: number, y1: number): void {
    const px = this.image.data;
    const [big, fine] = this.noise as [Float32Array, Float32Array];
    for (let ty = y0; ty < y1; ty++) {
      for (let tx = x0; tx < x1; tx++) {
        const t = this.terrain[ty * GRID + tx]!;
        const g = this.celGround(t === NO_TERRAIN ? WATER_CEL : t & 127);
        for (let y = 0; y < this.TEX; y++) {
          for (let x = 0; x < this.TEX; x++) {
            const gx = tx * this.TEX + x;
            const gy = ty * this.TEX + y;
            const o = (gy * this.SIZE + gx) * 4;
            const k = y * this.TEX + x;
            const m = g.mat[k]! as Mat;
            if (m === Mat.Water) {
              px[o] = 214;
              px[o + 1] = 190;
              px[o + 2] = 140;
              px[o + 3] = 0;
              continue;
            }
            const nx = (gx * 16 / this.TEX) | 0;
            const ny = (gy * 16 / this.TEX) | 0;
            const n = (big[(ny & 255) * 256 + (nx & 255)]! - 0.5) * 0.18 + (fine[((ny * 3) & 255) * 256 + ((nx * 3) & 255)]! - 0.5) * 0.1;
            let r: number;
            let gg: number;
            let b: number;
            if (m === Mat.Keep) {
              r = g.rgb[k * 3]!;
              gg = g.rgb[k * 3 + 1]!;
              b = g.rgb[k * 3 + 2]!;
            } else {
              const c = COLOURS[m];
              // Mostly the stylised colour, with a little of the art's own shading for its shapes.
              const keep = m === Mat.Wood ? 0.45 : 0.1;
              r = c[0] * (1 - keep) + g.rgb[k * 3]! * keep;
              gg = c[1] * (1 - keep) + g.rgb[k * 3 + 1]! * keep;
              b = c[2] * (1 - keep) + g.rgb[k * 3 + 2]! * keep;
            }
            const f = 1 + n;
            px[o] = Math.min(255, r * f);
            px[o + 1] = Math.min(255, gg * f);
            px[o + 2] = Math.min(255, b * f);
            px[o + 3] = 255;
          }
        }
      }
    }
    this.soften(x0 * this.TEX, y0 * this.TEX, x1 * this.TEX, y1 * this.TEX);
  }

  /** A light 3 x 3 blur of the land's colours and the edge's alpha, so material edges and shores come out smooth. */
  private soften(x0: number, y0: number, x1: number, y1: number): void {
    const px = this.image.data;
    const w = x1 - x0;
    const h = y1 - y0;
    const src = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) src.set(px.subarray(((y0 + y) * this.SIZE + x0) * 4, ((y0 + y) * this.SIZE + x1) * 4), y * w * 4);
    const R = this.TEX >= 32 ? 2 : 1;
    for (let y = R; y < h - R; y++) {
      for (let x = R; x < w - R; x++) {
        const o = (y * w + x) * 4;
        let a = 0;
        const sum = [0, 0, 0];
        let land = 0;
        for (let j = -R; j <= R; j++) {
          for (let i = -R; i <= R; i++) {
            const q = o + (j * w + i) * 4;
            const al = src[q + 3]!;
            a += al;
            if (al) {
              sum[0]! += src[q]!;
              sum[1]! += src[q + 1]!;
              sum[2]! += src[q + 2]!;
              land++;
            }
          }
        }
        const d = ((y0 + y) * this.SIZE + x0 + x) * 4;
        // Only the shore's edge is softened (for a smooth cut-out); a fine texture keeps its colours crisp, and a
        // coarse one takes a light blur so its materials meet softly.
        if (land && this.TEX < 32) {
          px[d] = (px[d]! + sum[0]! / land) / 2;
          px[d + 1] = (px[d + 1]! + sum[1]! / land) / 2;
          px[d + 2] = (px[d + 2]! + sum[2]! / land) / 2;
        }
        px[d + 3] = a / ((R * 2 + 1) * (R * 2 + 1));
      }
    }
  }

  /** How near each point of the sea is to land: 255 on land, falling off over about two tiles. */
  private makeShore(): void {
    const n = GRID * SHORE_TEX;
    const step = this.TEX / SHORE_TEX;
    const px = this.image.data;
    const land = new Float32Array(n * n);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        let a = 0;
        for (let j = 0; j < step; j++) for (let i = 0; i < step; i++) a += px[((y * step + j) * this.SIZE + x * step + i) * 4 + 3]!;
        land[y * n + x] = a / (step * step * 255);
      }
    }
    // Two passes of a separable box blur, radius 4 texels (one tile), keeping land itself at full.
    let cur = land;
    for (let pass = 0; pass < 2; pass++) {
      const tmp = new Float32Array(n * n);
      const out = new Float32Array(n * n);
      const r = 4;
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          let s = 0;
          for (let i = -r; i <= r; i++) s += cur[y * n + Math.min(n - 1, Math.max(0, x + i))]!;
          tmp[y * n + x] = s / (r * 2 + 1);
        }
      }
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          let s = 0;
          for (let i = -r; i <= r; i++) s += tmp[Math.min(n - 1, Math.max(0, y + i)) * n + x]!;
          out[y * n + x] = Math.max(land[y * n + x]!, s / (r * 2 + 1));
        }
      }
      cur = out;
    }
    for (let i = 0; i < n * n; i++) this.shore[(n - 1 - ((i / n) | 0)) * n + (i % n)] = Math.min(255, cur[i]! * 255 * 1.6);
    this.shoreTex.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
    this.shoreTex.dispose();
    this.pitTex.dispose();
    this.water.dispose();
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
  }
}

/** The sea: deep blue to turquoise shallows by the shore mask, rolling waves, a foam line, and sun glints. */
function waterMaterial(shore: THREE.Texture, pits: THREE.Texture, sun: THREE.Vector3): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      shore: { value: shore },
      pits: { value: pits },
      sun: { value: sun.clone().normalize() },
      span: { value: GRID * TILE },
      /** The light on the water: white by day, a dim moonlit blue at night. */
      tint: { value: new THREE.Color(1, 1, 1) },
      glint: { value: new THREE.Color(1.0, 0.97, 0.88) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float time;
      uniform sampler2D shore;
      uniform sampler2D pits;
      uniform vec3 sun;
      uniform float span;
      uniform vec3 tint;
      uniform vec3 glint;
      varying vec3 vWorld;
      float wave(vec2 p, vec2 d, float f, float s) { return sin(dot(p, d) * f + time * s); }
      void main() {
        vec2 uv = vec2(vWorld.x / span, 1.0 - vWorld.z / span);
        float near = 0.0;
        if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) {
          near = texture2D(shore, uv).r;
          vec2 t = uv * ${GRID}.0;
          if (texture2D(pits, (floor(t) + 0.5) / ${GRID}.0).r > 0.5) discard;
        }
        vec2 p = vWorld.xz;
        // Slopes of a few travelling waves make the surface normal.
        float dx = 0.0;
        float dz = 0.0;
        vec2 d1 = normalize(vec2(0.8, 0.6)); float w1 = cos(dot(p, d1) * 0.09 + time * 1.3);
        vec2 d2 = normalize(vec2(-0.5, 0.9)); float w2 = cos(dot(p, d2) * 0.13 + time * 1.7);
        vec2 d3 = normalize(vec2(0.2, -1.0)); float w3 = cos(dot(p, d3) * 0.23 + time * 2.3);
        vec2 d4 = normalize(vec2(-0.9, -0.3)); float w4 = cos(dot(p, d4) * 0.31 + time * 2.9);
        dx = d1.x * w1 * 0.18 + d2.x * w2 * 0.14 + d3.x * w3 * 0.1 + d4.x * w4 * 0.08;
        dz = d1.y * w1 * 0.18 + d2.y * w2 * 0.14 + d3.y * w3 * 0.1 + d4.y * w4 * 0.08;
        vec3 n = normalize(vec3(-dx, 1.0, -dz));
        vec3 deep = vec3(0.04, 0.27, 0.45);
        vec3 shallow = vec3(0.16, 0.66, 0.70);
        vec3 col = mix(deep, shallow, smoothstep(0.0, 0.9, near));
        // Foam where the sea meets the sand, breathing in and out.
        float edge = near + 0.06 * sin(time * 1.6 + (p.x + p.y) * 0.05);
        float ripple = 0.5 + 0.25 * (wave(p, d1, 0.21, 1.9) + wave(p, d2, 0.17, -1.3));
        float foam = smoothstep(0.86, 0.96, edge) * (0.5 + 0.5 * ripple) * 0.85;
        float caps = smoothstep(0.8, 1.0, wave(p, d3, 0.06, 0.9) * wave(p, d4, 0.05, 1.1)) * 0.08 * (1.0 - near);
        col = mix(col, vec3(0.95, 0.98, 1.0), clamp(foam + caps, 0.0, 1.0));
        // Sun on the water from a camera above and to the south.
        vec3 view = normalize(vec3(0.0, 1.0, 0.6));
        vec3 h = normalize(view + sun);
        float spec = pow(max(dot(n, h), 0.0), 90.0) * 0.9;
        float diff = 0.75 + 0.25 * max(dot(n, sun), 0.0);
        col = col * diff * tint + glint * spec;
        gl_FragColor = vec4(pow(col, vec3(2.2)), 1.0);
        #include <colorspace_fragment>
      }`,
  });
}
