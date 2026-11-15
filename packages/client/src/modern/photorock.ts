// The garden's rocks: real stone, from a CC0 photo scan (Poly Haven's Dry Riverbed Rock, credited in
// assets/art/pack/cc0/README.md). A rock has no uv of its own, so the scan is laid on it from the three axes at once
// (triplanar), each weighted by how squarely the rock's surface faces it, at the scale of the real garden.

import * as THREE from 'three';
import { ART } from './art.js';

const DIR = '/art/pack/cc0/rock';
/** How far the scan reaches before it repeats, in game units (a tank is about 20 long). */
const SPAN = 26;
/** How much the scan is lifted to sit in the sun with the toys (it is shot in soft daylight). */
const GAIN = 1.5;

/**
 * Stone for the rocks (vertex colours tint it a little, so not every rock is the same grey). Until the scan has
 * loaded the rocks are drawn in their flat colours; userData.ready is a promise of its loading.
 */
export function rockMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
  const on = { value: 0 };
  const colour = { value: null as THREE.Texture | null };
  const surface = { value: null as THREE.Texture | null };
  if (ART.photoRocks) {
    const load = new THREE.TextureLoader();
    const tex = (file: string, srgb: boolean) =>
      load.loadAsync(`${DIR}/${file}`).then((t) => {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.anisotropy = 4;
        if (srgb) t.colorSpace = THREE.SRGBColorSpace;
        return t;
      });
    m.userData.ready = Promise.all([tex('rock_diff.jpg', true), tex('rock_nrm.jpg', false)]).then(([c, s]) => {
      colour.value = c;
      surface.value = s;
      on.value = 1;
    });
  }
  m.onBeforeCompile = (shader) => {
    shader.uniforms.rockColour = colour;
    shader.uniforms.rockSurface = surface;
    shader.uniforms.rockOn = on;
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying vec3 vRockPos;\nvarying vec3 vRockNrm;\nvoid main() {')
      .replace('#include <project_vertex>', `#include <project_vertex>
  vRockPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vRockNrm = mat3(modelMatrix) * objectNormal;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', /* glsl */ `uniform sampler2D rockColour;
uniform sampler2D rockSurface;
uniform float rockOn;
varying vec3 vRockPos;
varying vec3 vRockNrm;
void main() {
  vec3 rockN = normalize(vRockNrm);
  vec3 rockW = pow(abs(rockN), vec3(4.0));
  rockW /= rockW.x + rockW.y + rockW.z;
  vec3 rockP = vRockPos / ${SPAN.toFixed(1)};
  float rockRough = 0.85;
  vec3 rockNormal = rockN;`)
      .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
  if (rockOn > 0.5) {
    vec3 c = texture2D(rockColour, rockP.zy).rgb * rockW.x + texture2D(rockColour, rockP.xz).rgb * rockW.y
      + texture2D(rockColour, rockP.xy + 0.5).rgb * rockW.z;
    vec4 sx = texture2D(rockSurface, rockP.zy);
    vec4 sy = texture2D(rockSurface, rockP.xz);
    vec4 sz = texture2D(rockSurface, rockP.xy + 0.5);
    // The rock's own grey (0.26 in linear light) tints the scan: a warmer or cooler stone, a lighter or darker one.
    diffuseColor.rgb = c * ${GAIN.toFixed(2)} * diffuseColor.rgb / 0.26;
    rockRough = sx.b * rockW.x + sy.b * rockW.y + sz.b * rockW.z;
    // Each axis's scan normal laid on the surface it faces (UDN blending).
    vec2 tx = sx.rg * 2.0 - 1.0;
    vec2 ty = sy.rg * 2.0 - 1.0;
    vec2 tz = sz.rg * 2.0 - 1.0;
    rockNormal = normalize(vec3(rockN.x, tx.y + rockN.y, tx.x + rockN.z) * rockW.x
      + vec3(ty.x + rockN.x, rockN.y, ty.y + rockN.z) * rockW.y
      + vec3(tz.x + rockN.x, tz.y + rockN.y, rockN.z) * rockW.z);
  }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
  roughnessFactor = rockRough;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  if (rockOn > 0.5) normal = normalize((viewMatrix * vec4(rockNormal, 0.0)).xyz);`);
  };
  return m;
}
