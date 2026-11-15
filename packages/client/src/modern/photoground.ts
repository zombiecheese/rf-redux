// The garden under the toys: real ground from CC0 photo scans (Poly Haven; assets/art/pack/cc0/README.md credits
// them), at the scale of the real garden the toys stand in, so a grain of sand is a grain of sand next to a tank.
// The ground's map says which material each point is (the splat); the shader blends the scans' colour, surface
// normal and roughness by it, with each scan's own light and dark parts deciding where one material gives way to
// the next, so the edges look like sand drifting over soil rather than a fade.

import * as THREE from 'three';
import { ART } from './art.js';

/** The scans, in the order of the texture arrays' layers. */
const LAYERS = ['sand', 'wetsand', 'soil', 'earth', 'lawn', 'gravel'] as const;
/** How far each scan reaches before it repeats, in game units (a tank is about 20 long, a tile 32). */
const SPAN = [260, 260, 220, 300, 180, 110];
/** How much each scan is lifted to sit with the toys under the sun (the scans are shot in soft daylight). */
const GAIN = [1.75, 1.45, 1.3, 1.3, 1.3, 1.35];
const DIR = '/art/pack/cc0/ground';

let loading: Promise<PhotoMaps> | null = null;
let loadedSize = 0;

export interface PhotoMaps {
  /** Each scan's colour (sRGB). */
  colour: THREE.DataArrayTexture;
  /** Each scan's surface: its normal's x and y (r, g) and its roughness (b). */
  surface: THREE.DataArrayTexture;
}

/** The scans as two texture arrays, loaded once at the size ART.groundDetail asks for. */
export function photoMaps(): Promise<PhotoMaps> {
  const size = ART.groundDetail;
  if (loading && loadedSize === size) return loading;
  loadedSize = size;
  loading = (async () => {
    const colour = new Uint8Array(size * size * 4 * LAYERS.length);
    const surface = new Uint8Array(size * size * 4 * LAYERS.length);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const g = canvas.getContext('2d', { willReadFrequently: true })!;
    const read = async (file: string, into: Uint8Array, layer: number) => {
      const img = new Image();
      img.src = `${DIR}/${file}`;
      await img.decode();
      g.drawImage(img, 0, 0, size, size);
      into.set(g.getImageData(0, 0, size, size).data, layer * size * size * 4);
    };
    await Promise.all(LAYERS.flatMap((name, i) => [read(`${name}_diff.jpg`, colour, i), read(`${name}_nrm.jpg`, surface, i)]));
    const array = (data: Uint8Array, srgb: boolean) => {
      const t = new THREE.DataArrayTexture(data, size, size, LAYERS.length);
      t.format = THREE.RGBAFormat;
      t.type = THREE.UnsignedByteType;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.magFilter = THREE.LinearFilter;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.generateMipmaps = true;
      t.anisotropy = 4;
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      t.needsUpdate = true;
      return t;
    };
    return { colour: array(colour, true), surface: array(surface, false) };
  })();
  return loading;
}

/**
 * Teaches a ground material (a MeshStandardMaterial whose map is the painted ground) the scans. splat holds each
 * point's sand, darker sand and lawn (r, g, b; the rest keeps the painted colour: roads, pads, stripes, planks), on the
 * same uv as the map. on is 0 until the scans have loaded. world is the map's size in game units.
 */
export function photoShader(shader: THREE.WebGLProgramParametersWithUniforms, splat: THREE.Texture, maps: { value: PhotoMaps | null }, on: THREE.IUniform, world: number): void {
  shader.uniforms.photoSplat = { value: splat };
  shader.uniforms.photoColour = { get value() { return maps.value?.colour ?? null; } };
  shader.uniforms.photoSurface = { get value() { return maps.value?.surface ?? null; } };
  shader.uniforms.photoOn = on;
  const spans = SPAN.map((s) => s.toFixed(1)).join(', ');
  const gains = GAIN.map((s) => s.toFixed(2)).join(', ');
  shader.fragmentShader = shader.fragmentShader
    .replace('void main() {', /* glsl */ `uniform sampler2D photoSplat;
uniform sampler2DArray photoColour;
uniform sampler2DArray photoSurface;
uniform float photoOn;
float photoHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float photoNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(photoHash(i), photoHash(i + vec2(1.0, 0.0)), f.x), mix(photoHash(i + vec2(0.0, 1.0)), photoHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
// Each scan at its own scale, turned a little differently so their repeats never line up.
vec3 photoUv(vec2 w, int i) {
  float spans[6] = float[6](${spans});
  float a = float(i) * 1.7;
  mat2 r = mat2(cos(a), sin(a), -sin(a), cos(a));
  return vec3(r * w / spans[i] + float(i) * 0.37, float(i));
}
void main() {`)
    .replace('#include <map_fragment>', /* glsl */ `#include <map_fragment>
  float photoKeep = 1.0;
  float photoRough = 1.0;
  vec3 photoNormal = vec3(0.0, 0.0, 1.0);
  if (photoOn > 0.5) {
    vec4 sp = texture2D(photoSplat, vMapUv);
    vec2 w = vMapUv * ${world.toFixed(1)};
    photoKeep = clamp(1.0 - (sp.r + sp.g + sp.b), 0.0, 1.0);
    // Wet sand along the sea: where the painted ground's land fades out at its blurred mip levels.
    float land = texture2D(map, vMapUv, 4.0).a;
    float wet = 1.0 - smoothstep(0.5, 0.8, land);
    float big = photoNoise(w / 420.0) * 0.65 + photoNoise(w / 130.0) * 0.35;
    float wts[6];
    // The art's sand and its darker sand are both sand, with beds of garden soil (and darker forest earth in them)
    // where the darker sand lies in patches.
    float bed = sp.g * smoothstep(0.5, 0.72, big);
    float sand = sp.r + sp.g - bed;
    wts[0] = sand * (1.0 - wet);
    wts[1] = sand * wet;
    float earth = smoothstep(0.62, 0.8, photoNoise(w / 160.0 + 5.0));
    wts[2] = bed * (1.0 - earth);
    wts[3] = bed * earth;
    wts[4] = sp.b;
    // And a scatter of gravel in the sand here and there.
    float grit = sand * smoothstep(0.72, 0.86, photoNoise(w / 90.0 + 13.0)) * 0.9;
    wts[0] -= grit * (1.0 - wet);
    wts[5] = grit;
    // Each scan's light parts stand up through the next: blend by weight plus height (its brightness).
    float gains[6] = float[6](${gains});
    vec4 cols[6];
    float best = 0.0;
    float hs[6];
    for (int i = 0; i < 6; i++) {
      hs[i] = -1.0;
      if (wts[i] > 0.02) {
        cols[i] = texture(photoColour, photoUv(w, i));
        cols[i].rgb *= gains[i];
        hs[i] = wts[i] + dot(cols[i].rgb, vec3(0.5, 0.4, 0.1)) * 0.4;
        best = max(best, hs[i]);
      }
    }
    vec3 col = vec3(0.0);
    vec3 nrm = vec3(0.0);
    float rough = 0.0;
    float sum = 0.0;
    for (int i = 0; i < 6; i++) {
      float f = max(hs[i] - best + 0.18, 0.0);
      if (f > 0.0) {
        vec4 s = texture(photoSurface, photoUv(w, i));
        col += cols[i].rgb * f;
        nrm += vec3(s.rg * 2.0 - 1.0, 0.0) * f;
        rough += s.b * f;
        sum += f;
      }
    }
    if (sum > 0.0) {
      col /= sum;
      nrm /= sum;
      rough /= sum;
      nrm.z = sqrt(max(0.0, 1.0 - dot(nrm.xy, nrm.xy)));
      // The scans are shot under soft daylight: lift them to sit with the toys under the sun.
      diffuseColor.rgb = mix(col, diffuseColor.rgb, photoKeep);
      photoRough = rough;
      photoNormal = nrm;
    } else photoKeep = 1.0;
  }`)
    .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
  roughnessFactor = mix(photoRough, roughnessFactor, photoKeep);`)
    .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  if (photoKeep < 1.0) {
    // The ground lies flat: the scan's x is east, its y north (-z), its up +y.
    vec3 photoUp = normalize((viewMatrix * vec4(photoNormal.x, photoNormal.z, -photoNormal.y, 0.0)).xyz);
    normal = normalize(mix(photoUp, normal, photoKeep));
  }`);
}
