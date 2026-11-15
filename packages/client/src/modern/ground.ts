// The modern view's ground and sea. Each ground tile's art (the same terrain cels the retro view draws) is read for
// what it shows, pixel by pixel: sea, sand, darker sand, grass, road, road edging, planks, or something drawn (pads,
// hazard stripes, rubble) that keeps its own colours. The ground is then painted in the stylised colours with soft
// noise, at 16 texels a tile, and laid over an animated sea that only shows where the ground is sea. The sea's
// shallows, foam and colour come from how far each point is from land.

import * as THREE from 'three';
import { LIGHT_TIME, THERMAL, grainLights } from './look.js';
import { DepthMap, RINGS } from './water.js';
import { ART } from './art.js';
import { photoMaps, photoShader, type PhotoMaps } from './photoground.js';
import { GRID, NO_TERRAIN, type World } from '@rfw/sim';
import type { GameAssets } from '../assets.js';

export const TILE = 32;
/** Sea mask resolution: texels a tile. */
const SHORE_TEX = 4;
const WATER_CEL = 2;
/** The photo ground's material map (the splat): texels a tile. */
const SPLAT_TEX = 8;

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
  /** Each point's sand, soil, lawn and paving for the photo ground (rows south to north), and its texture. */
  private readonly splat = new Uint8Array(GRID * SPLAT_TEX * GRID * SPLAT_TEX * 4);
  private readonly splatTex: THREE.DataTexture;
  private readonly photo = { value: null as PhotoMaps | null };
  private readonly photoOn: THREE.IUniform = { value: 0 };
  /** How deep the sea is, as the match plays it: the shallows and deep water. */
  private readonly depth: DepthMap;
  /** Ground texels a tile: the art's own 32 where the GPU takes a 4096 texture, else 16. */
  private readonly TEX: number;
  private readonly SIZE: number;

  /** lit, when given, teaches the ground's material more lighting (the buildings' lamps at night). */
  constructor(private readonly assets: GameAssets, world: World, sun: THREE.Vector3, fine: boolean, sea: SeaInputs, lit?: (shader: THREE.WebGLProgramParametersWithUniforms) => void) {
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
    this.splatTex = new THREE.DataTexture(this.splat, GRID * SPLAT_TEX, GRID * SPLAT_TEX, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.splatTex.magFilter = this.splatTex.minFilter = THREE.LinearFilter;
    this.paintSplat(0, 0, GRID, GRID);
    // The garden from photo scans where the device takes it (art.ts), else the painted ground on its own.
    const photo = ART.photoGround;
    const mat = photo
      ? new THREE.MeshStandardMaterial({ map: this.texture, alphaTest: 0.5, roughness: 0.95, metalness: 0 })
      : new THREE.MeshLambertMaterial({ map: this.texture, alphaTest: 0.5 });
    if (photo) {
      void photoMaps().then((m) => {
        this.photo.value = m;
        this.photoOn.value = 1;
      });
    }
    mat.onBeforeCompile = (shader) => {
      if (photo) photoShader(shader, this.splatTex, this.photo, this.photoOn, GRID * TILE);
      shader.uniforms.pits = { value: this.pitTex };
      shader.uniforms.thermal = THERMAL;
      shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', 'uniform sampler2D pits;\nuniform float thermal;\nvoid main() {')
        // The ground on the thermal camera: cool, its sand and grass and roads just told apart.
        .replace('#include <dithering_fragment>', `#include <dithering_fragment>
          if (thermal > 0.5) gl_FragColor = vec4(vec3(0.2 + dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11)) * 0.26), 1.0);`)
        .replace('#include <alphatest_fragment>', `#include <alphatest_fragment>
          {
            vec2 t = vMapUv * ${GRID}.0;
            vec2 f = fract(t);
            if (texture2D(pits, (floor(t) + 0.5) / ${GRID}.0).r > 0.5 && f.x > 0.06 && f.x < 0.94 && f.y > 0.06 && f.y < 0.94) discard;
          }`);
      grainLights(shader);
      lit?.(shader);
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
    this.depth = new DepthMap(world);
    this.water = waterMaterial(this.shoreTex, this.pitTex, this.depth.texture, sun, sea);
    const margin = 4096;
    const ocean = new THREE.Mesh(new THREE.PlaneGeometry(GRID * TILE + margin * 2, GRID * TILE + margin * 2, 1, 1), this.water);
    ocean.rotateX(-Math.PI / 2);
    ocean.position.set((GRID * TILE) / 2, -1.2, (GRID * TILE) / 2);
    this.group.add(ocean);
  }

  /** Repaints tiles whose terrain changed (a building become rubble, a lift's pad), and the lifts' open shafts. */
  update(world: World, openLifts: Iterable<number>): void {
    let x0 = GRID;
    let y0 = GRID;
    let x1 = -1;
    let y1 = -1;
    let wet = false;
    for (let i = 0; i < GRID * GRID; i++) {
      if (world.terrain[i] === this.terrain[i]) continue;
      // Only water and shore tiles change the sea's depth.
      const was = this.terrain[i]! & 127;
      const now = world.terrain[i]! & 127;
      if ((was >= 1 && was <= 51) || (now >= 1 && now <= 51)) wet = true;
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
      this.paintSplat(px0, py0, px1, py1);
      this.makeShore();
      if (wet) this.depth.update(world, x0, y0, x1 + 1, y1 + 1);
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

  /**
   * The photo ground's splat for tiles [x0, x1) x [y0, y1): each texel's share of sand, soil, lawn and paving among
   * the art's texels it covers, softened a texel across so materials meet in a blend.
   */
  private paintSplat(x0: number, y0: number, x1: number, y1: number): void {
    const N = GRID * SPLAT_TEX;
    const step = this.TEX / SPLAT_TEX;
    const raw = new Float32Array(N * N * 4);
    const ax0 = Math.max(0, x0 - 1);
    const ay0 = Math.max(0, y0 - 1);
    const ax1 = Math.min(GRID, x1 + 1);
    const ay1 = Math.min(GRID, y1 + 1);
    const slot: Partial<Record<Mat, number>> = { [Mat.Sand]: 0, [Mat.Dirt]: 1, [Mat.Grass]: 2, [Mat.Road]: 3, [Mat.RoadLight]: 3 };
    for (let ty = ay0; ty < ay1; ty++) {
      for (let tx = ax0; tx < ax1; tx++) {
        const t = this.terrain[ty * GRID + tx]!;
        const g = this.celGround(t === NO_TERRAIN ? WATER_CEL : t & 127);
        for (let y = 0; y < this.TEX; y++) {
          for (let x = 0; x < this.TEX; x++) {
            const k = slot[g.mat[y * this.TEX + x]! as Mat];
            if (k === undefined) continue;
            const sx = tx * SPLAT_TEX + Math.floor(x / step);
            const sy = ty * SPLAT_TEX + Math.floor(y / step);
            const at = (sy * N + sx) * 4 + k;
            raw[at] = raw[at]! + 1 / (step * step);
          }
        }
      }
    }
    for (let sy = y0 * SPLAT_TEX; sy < y1 * SPLAT_TEX; sy++) {
      for (let sx = x0 * SPLAT_TEX; sx < x1 * SPLAT_TEX; sx++) {
        // Rows run south to north in the texture: the map's first row is its northern edge.
        const o = ((N - 1 - sy) * N + sx) * 4;
        for (let c = 0; c < 4; c++) {
          let s = 0;
          for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) s += raw[(Math.min(N - 1, Math.max(0, sy + j)) * N + Math.min(N - 1, Math.max(0, sx + i))) * 4 + c]! * (i || j ? 1 : 4);
          this.splat[o + c] = Math.round(Math.min(1, s / 12) * 255);
        }
      }
    }
    this.splatTex.needsUpdate = true;
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
    this.splatTex.dispose();
    this.shoreTex.dispose();
    this.pitTex.dispose();
    this.depth.dispose();
    this.water.dispose();
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
  }
}

/** What the sea shows besides itself: the marks and ripples on it (water.ts), the lamps' light, and the headlights. */
export interface SeaInputs {
  marks: THREE.Texture;
  rings: THREE.Vector4[];
  lampMap: THREE.Texture;
  glare: THREE.Texture;
  /** 0 by day, 1 at night. */
  night: THREE.IUniform;
  /** Up to four headlights: where each is, where it points, its colour (by its strength; black when off) and its cone (outer and inner cosines). */
  heads: { pos: THREE.Vector3[]; dir: THREE.Vector3[]; col: THREE.Vector3[]; cone: THREE.Vector2[] };
  /** Where the moon stands in the sky (a direction), for its path of light on the sea. */
  moon: THREE.Vector3;
  /** The flashes of blasts (fx.ts): where each is, and how bright now (0 when out). */
  flashes: { pos: THREE.Vector3[]; power: number[] };
}

/**
 * The sea. The shallows are clear water over a sandy bottom, with light playing on the sand; deep water is dark
 * blue, darker away from the shelf, with a pale rim and a dark drop-off along the shelf's edge. Rolling waves (calmer
 * in the shallows), a foam line on the shore, and what the vehicles leave on it: foam, chop, silt and ripples. At
 * night it shows the moon's path, the lamps' light and their reflections streaking toward the camera, and the
 * headlights' beams and glints.
 */
function waterMaterial(shore: THREE.Texture, pits: THREE.Texture, depth: THREE.Texture, sun: THREE.Vector3, sea: SeaInputs): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      shore: { value: shore },
      pits: { value: pits },
      depth: { value: depth },
      marks: { value: sea.marks },
      rings: { value: sea.rings },
      lampMap: { value: sea.lampMap },
      lampGlare: { value: sea.glare },
      lampNight: sea.night,
      lampTime: LIGHT_TIME,
      headPos: { value: sea.heads.pos },
      headDir: { value: sea.heads.dir },
      headCol: { value: sea.heads.col },
      headCone: { value: sea.heads.cone },
      moon: { value: sea.moon },
      flashPos: { value: sea.flashes.pos },
      flashPower: { value: sea.flashes.power },
      sun: { value: sun.clone().normalize() },
      span: { value: GRID * TILE },
      /** The light on the water: white by day, a dim moonlit blue at night. */
      tint: { value: new THREE.Color(1, 1, 1) },
      glint: { value: new THREE.Color(1.0, 0.97, 0.88) },
      thermal: THERMAL,
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
      uniform sampler2D depth;
      uniform sampler2D marks;
      uniform sampler2D lampMap;
      uniform sampler2D lampGlare;
      uniform float lampNight;
      uniform float lampTime;
      uniform vec4 rings[${RINGS}];
      uniform vec3 headPos[4];
      uniform vec3 headDir[4];
      uniform vec3 headCol[4];
      uniform vec2 headCone[4];
      uniform vec3 moon;
      uniform vec3 flashPos[4];
      uniform float flashPower[4];
      uniform vec3 sun;
      uniform float span;
      uniform vec3 tint;
      uniform vec3 glint;
      uniform float thermal;
      varying vec3 vWorld;
      float wave(vec2 p, vec2 d, float f, float s) { return sin(dot(p, d) * f + time * s); }
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
      }
      void main() {
        vec2 uv = vec2(vWorld.x / span, 1.0 - vWorld.z / span);
        vec2 wuv = vWorld.xz / span;
        float near = 0.0;
        vec2 dm = vec2(1.0);
        vec4 mk = vec4(0.0);
        if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) {
          near = texture2D(shore, uv).r;
          vec2 t = uv * ${GRID}.0;
          if (texture2D(pits, (floor(t) + 0.5) / ${GRID}.0).r > 0.5) discard;
          dm = texture2D(depth, wuv).rg;
          mk = texture2D(marks, wuv);
        }
        vec2 p = vWorld.xz;
        // 0 in the shallows, 1 in deep water; the shelf's edge is where the match's ground changes.
        float deep = smoothstep(0.42, 0.58, dm.r);
        float chop = clamp(mk.g, 0.0, 1.0);
        // Slopes of a few travelling waves make the surface normal: calmer over the shallows.
        vec2 d1 = normalize(vec2(0.8, 0.6)); float w1 = cos(dot(p, d1) * 0.09 + time * 1.3);
        vec2 d2 = normalize(vec2(-0.5, 0.9)); float w2 = cos(dot(p, d2) * 0.13 + time * 1.7);
        vec2 d3 = normalize(vec2(0.2, -1.0)); float w3 = cos(dot(p, d3) * 0.23 + time * 2.3);
        vec2 d4 = normalize(vec2(-0.9, -0.3)); float w4 = cos(dot(p, d4) * 0.31 + time * 2.9);
        float amp = mix(0.45, 1.0, deep);
        float dx = (d1.x * w1 * 0.18 + d2.x * w2 * 0.14 + d3.x * w3 * 0.1 + d4.x * w4 * 0.08) * amp;
        float dz = (d1.y * w1 * 0.18 + d2.y * w2 * 0.14 + d3.y * w3 * 0.1 + d4.y * w4 * 0.08) * amp;
        // Chop: small broken waves where something has stirred the water.
        if (chop > 0.004) {
          vec2 q = p * 0.55;
          float a = noise(q + vec2(time * 5.0, -time * 3.5)) - noise(q * 1.9 - vec2(time * 4.0, time * 5.5));
          float b = noise(q.yx * 1.3 + vec2(-time * 4.5, time * 3.0)) - noise(q * 2.3 + vec2(time * 6.0, time * 2.0));
          dx += a * 1.1 * chop;
          dz += b * 1.1 * chop;
        }
        // Ripples spreading from where something broke the surface.
        float crest = 0.0;
        for (int i = 0; i < ${RINGS}; i++) {
          vec4 r = rings[i];
          if (r.w <= 0.002) continue;
          vec2 d = p - r.xy;
          float l = length(d);
          float x = l - r.z;
          float w = 2.5 + r.z * 0.1;
          if (abs(x) > w * 2.5) continue;
          float env = exp(-x * x / (w * w)) * r.w;
          float s = cos(x * 1.25) * env;
          vec2 dir = d / max(l, 0.001);
          dx += dir.x * s;
          dz += dir.y * s;
          crest += max(0.0, sin(x * 1.25)) * env;
        }
        vec3 n = normalize(vec3(-dx, 1.0, -dz));

        // Deep water: dark blue, darker out from the shelf.
        vec3 col = mix(vec3(0.03, 0.25, 0.43), vec3(0.012, 0.11, 0.27), dm.g);
        // The shallows: clear water over sand, rippled, with light playing on the bottom (not at night).
        float grain = noise(p * 0.07) * 0.6 + noise(p * 0.29) * 0.4;
        float bed = 0.5 + 0.5 * sin(dot(p, vec2(0.33, 0.11)) + grain * 5.0);
        vec3 bottom = vec3(0.84, 0.73, 0.52) * (0.84 + 0.18 * grain) * (0.93 + 0.07 * bed);
        vec3 shallow = mix(vec3(0.12, 0.62, 0.66), bottom, 0.4 + 0.3 * smoothstep(0.2, 0.9, near));
        vec2 cq = p * 0.11 + n.xz * 1.5;
        float c1 = noise(cq + vec2(time * 0.35, time * 0.2));
        float c2 = noise(cq * 1.3 - vec2(time * 0.25, -time * 0.3) + 3.7);
        float caustic = pow(clamp(1.0 - abs(c1 - c2) * 3.2, 0.0, 1.0), 4.0) * (1.0 - lampNight);
        shallow += vec3(0.95, 1.0, 0.9) * caustic * 0.14;
        // Silt stirred up from the bottom clouds the shallows brown, and dirties deep water a little.
        float silt = clamp(mk.b * 1.4, 0.0, 1.0);
        shallow = mix(shallow, vec3(0.5, 0.41, 0.28), silt * 0.8);
        col = mix(col, vec3(0.19, 0.24, 0.22), silt * 0.3);
        col = mix(shallow, col, deep);
        // The shelf's edge: a pale rim on the shallow side, then a dark drop-off as the bottom falls away.
        float rim = smoothstep(0.12, 0.42, dm.r) * (1.0 - smoothstep(0.42, 0.52, dm.r));
        float drop = smoothstep(0.5, 0.6, dm.r) * (1.0 - smoothstep(0.6, 0.97, dm.r));
        col = mix(col, vec3(0.62, 0.9, 0.86), rim * 0.4);
        col *= 1.0 - drop * 0.38;

        // Foam where the sea meets the sand, breathing in and out; whitecaps on deep water; and the vehicles' foam,
        // broken up into lace.
        float edge = near + 0.06 * sin(time * 1.6 + (p.x + p.y) * 0.05);
        float ripple = 0.5 + 0.25 * (wave(p, d1, 0.21, 1.9) + wave(p, d2, 0.17, -1.3));
        float foam = smoothstep(0.86, 0.96, edge) * (0.5 + 0.5 * ripple) * 0.85;
        float caps = smoothstep(0.8, 1.0, wave(p, d3, 0.06, 0.9) * wave(p, d4, 0.05, 1.1)) * 0.08 * (1.0 - near) * deep;
        float lace = noise(p * 0.45 + vec2(time * 0.6, -time * 0.4)) * 0.6 + noise(p * 1.3 - time * 0.8) * 0.4;
        float wake = clamp(mk.r * 2.2 - (1.0 - lace) * 0.75, 0.0, 1.0) + clamp(mk.r - 0.6, 0.0, 1.0);
        float suds = clamp(foam + caps + wake + crest * 0.35 + chop * 0.1, 0.0, 1.0);
        vec3 base = mix(col, mix(vec3(0.95, 0.98, 1.0), vec3(0.8, 0.72, 0.58), silt * 0.6), suds);

        // Sun (or moon) on the water, seen from the camera.
        vec3 view = normalize(cameraPosition - vWorld);
        vec3 h = normalize(view + sun);
        float spec = pow(max(dot(n, h), 0.0), 90.0) * 0.9 * (1.0 - suds * 0.7);
        float diff = 0.75 + 0.25 * max(dot(n, sun), 0.0);
        col = base * diff * tint + glint * spec;
        if (lampNight > 0.0) {
          float calm = 1.0 - suds * 0.6;
          // The moon's path: a broad band where the swell tilts the water toward its reflection, made of tiny
          // sparkles that come and go.
          vec3 r = reflect(-view, normalize(mix(vec3(0.0, 1.0, 0.0), n, 0.5)));
          float az = atan(r.x, -r.z) - atan(moon.x, -moon.z);
          float el = asin(clamp(r.y, -1.0, 1.0)) - asin(moon.y);
          float path = exp(-az * az / 0.02 - el * el / 0.05);
          float sheen = exp(-az * az / 0.06 - el * el / 0.18);
          float sparkle = smoothstep(0.72, 0.95, noise(p * 3.1 + vec2(time * 3.0, -time * 2.2))) * smoothstep(0.3, 0.7, noise(p * 0.9 - time * 0.7));
          col += vec3(0.62, 0.7, 0.92) * (path * (0.08 + 2.2 * sparkle) + sheen * 0.05) * calm * lampNight;
          // The lamps' light falls on the water (on the sand in the shallows, the foam, little on deep water).
          vec4 ls = texture2D(lampMap, wuv);
          float flick = 0.84 + 0.16 * noise(vec2(lampTime * 8.0, ls.a * 23.0 * 13.0));
          vec3 e = ls.rgb * ls.rgb * 320.0;
          float twinkle = smoothstep(0.6, 0.9, noise(p * 2.2 + vec2(time * 2.4, -time * 1.7)));
          col += e * (base * 0.318 * mix(0.9, 0.3, deep * (1.0 - suds)) + 0.003 * (0.3 + 2.5 * twinkle) * calm) * flick * lampNight;
          // And they shine back off it: each lamp's mirror image, smeared toward the camera by the waves.
          vec2 cam = cameraPosition.xz;
          vec2 toCam = normalize(cam - p);
          vec2 q = p + (p - cam) * (11.0 / max(cameraPosition.y, 20.0)) + n.xz * 40.0;
          vec3 refl = vec3(0.0);
          for (int k = 0; k < 5; k++) refl += texture2D(lampGlare, (q + toCam * (float(k) - 1.5) * 11.0) / span).rgb;
          vec4 lq = texture2D(lampMap, q / span);
          float shimmer = 0.5 + 1.0 * smoothstep(0.35, 0.8, noise(p * 0.9 + vec2(0.0, time * 2.5)));
          refl = refl * 0.2 * shimmer + lq.rgb * lq.rgb * 0.5;
          col += refl * 2.4 * flick * calm * lampNight;
          // Headlights: their beams on the water, and glints off the waves in them.
          for (int i = 0; i < 4; i++) {
            vec3 c = headCol[i];
            if (c.r + c.g + c.b <= 0.0) continue;
            vec3 l = headPos[i] - vWorld;
            float d = length(l);
            l /= d;
            float cone = smoothstep(headCone[i].x, headCone[i].y, dot(-l, headDir[i]));
            if (cone <= 0.0) continue;
            float lit = cone / (1.0 + d * d * 0.0009);
            // Glints: the beam caught by the waves facing back up at the camera, sparkling as they move.
            float g = pow(max(dot(n, normalize(l + view)), 0.0), 24.0);
            float sparkle = 0.4 + 1.6 * smoothstep(0.5, 0.85, noise(p * 1.4 + vec2(time * 2.6, -time * 1.9)));
            col += c * lit * (base * mix(0.55, 0.25, deep * (1.0 - suds)) + (0.06 + 0.1 * sparkle + g * 1.4 * sparkle) * calm);
          }
        }
        // The flash of a blast lights the water round it, day or night, and glints off the waves.
        for (int i = 0; i < 4; i++) {
          if (flashPower[i] <= 0.0) continue;
          vec3 l = flashPos[i] - vWorld;
          float d = length(l);
          l /= d;
          float e = flashPower[i] / (d * d + 400.0);
          float g = pow(max(dot(n, normalize(l + view)), 0.0), 24.0);
          col += vec3(1.0, 0.62, 0.25) * e * (base * 0.5 + 0.06 + g * 1.5);
        }
        gl_FragColor = vec4(pow(col, vec3(2.2)), 1.0);
        #include <colorspace_fragment>
        // The sea runs cold on the thermal camera, the shallows a touch warmer than deep water; its surf and the
        // vehicles' wakes show a little warmer.
        if (thermal > 0.5) gl_FragColor = vec4(vec3(0.05 + 0.035 * (1.0 - deep) + 0.05 * suds + 0.015 * ripple), 1.0);
      }`,
  });
}
